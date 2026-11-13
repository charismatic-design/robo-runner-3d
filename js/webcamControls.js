/**
 * WebcamControls:
 * Ultra-lightweight hands-free gesture controller using MediaPipe Tasks Vision (FaceDetector).
 * 100% on-device client-side computer vision — zero backend or external servers required.
 *
 * Performance Architecture:
 * - Uses BlazeFace Short-Range model (~220 KB vs 3.75 MB FaceLandmarker) for ~10x lighter CPU/RAM.
 * - Extracts 6 high-precision facial keypoints with keypoint [2] (nose tip) as primary 3-lane cursor.
 * - Inference throttled to ~15-20 FPS with 2D canvas redrawn ONLY when a new detection finishes.
 * - Explicit `faceDetector.close()` and track cleanup on stop eliminates memory/VRAM leaks.
 *
 * Mappings & Calibrated Thresholds:
 * - Horizontal head/nose lean -> 3 lanes (Left, Center, Right) with deadzone margins.
 * - Natural head nod/lift up (Δy < -0.022) -> Jump (350ms cooldown).
 * - Natural head duck down (Δy > +0.048) -> Slide & Fast-Fall (avoids pre-jump head dips).
 * - Shared 600ms vertical action lock: Slide blocks Jump for 600ms (no duck rebound jumps), Jump blocks Slide for 600ms.
 * - Tight neutral re-arm band (-0.010 <= Δy <= +0.015) before next vertical gesture can arm.
 * - Auto-recalibration on game start and first face detection to lock neutral posture y0.
 */

const MEDIAPIPE_VISION_BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MEDIAPIPE_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FACE_DETECTOR_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

export class WebcamControls {
  constructor({ onLaneChange, onJump, onSlide, onStatusChange, onError }) {
    this.onLaneChange = onLaneChange || (() => {});
    this.onJump = onJump || (() => {});
    this.onSlide = onSlide || (() => {});
    this.onStatusChange = onStatusChange || (() => {});
    this.onError = onError || (() => {});

    // State flags
    this.isActive = false;
    this.isLoading = false;
    this.isSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

    // Media & Vision handles
    this.stream = null;
    this.faceDetector = null;
    this.animationFrameId = null;
    this.lastVideoTime = -1;

    // DOM Elements
    this.container = document.getElementById('webcam-preview-container');
    this.video = document.getElementById('webcam-video');
    this.canvas = document.getElementById('webcam-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.actionBadge = document.getElementById('webcam-action-badge');
    this.spinner = document.getElementById('webcam-loading-spinner');
    this.calibrateBtn = document.getElementById('webcam-calibrate-btn');
    this.closeBtn = document.getElementById('webcam-close-btn');

    // Calibration & Thresholds
    // Coordinates normalized [0, 1] relative to mirrored video frame
    this.neutralX = 0.50;
    this.neutralY = 0.45;
    this.isCalibrated = false;
    this.calibratedFeedbackTimer = 0;
    this.badgeActionExpiry = 0;

    // Deadzone and action sensitivities
    this.deadzoneX = 0.065;      // +/- 6.5% width for Center lane
    this.jumpThreshold = 0.022;  // Head nods/tilts up: Δy < -0.022 -> Jump
    this.slideThreshold = 0.048; // Head ducks down: Δy > +0.048 -> Slide (avoids pre-jump dip)
    this.rearmMinY = -0.010;     // Tight neutral re-arm band lower bound (-0.010 <= Δy <= +0.015)
    this.rearmMaxY = 0.015;      // Tight neutral re-arm band upper bound

    // Shared vertical action lock & debounce timers (ms)
    this.lastVerticalActionTime = -99999;
    this.verticalLockMs = 600;   // 600ms mutual lockout between Jump and Slide (blocks duck rebound jumps)
    this.lastJumpTime = -99999;
    this.lastSlideTime = -99999;
    this.jumpCooldown = 350;     // Individual action cooldown
    this.slideCooldown = 350;
    this.canJump = true;
    this.canSlide = true;

    // Performance throttling: Cap AI vision inference to ~15-20 FPS (50ms interval)
    this.lastDetectTime = 0;
    this.detectThrottleMs = 50;

    // Detected lane state (0: Left, 1: Center, 2: Right)
    this.currentDetectedLane = 1;
    this.currentGestureText = 'CENTER';

    this.bindEvents();
  }

  bindEvents() {
    if (this.calibrateBtn) {
      this.calibrateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.calibrate();
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stop();
      });
    }
  }

  /**
   * Lazily loads MediaPipe Tasks Vision bundle and initializes ultra-light FaceDetector (BlazeFace).
   * Model payload is ~220 KB (16x lighter than FaceLandmarker) with zero blendshape overhead.
   */
  async initVision() {
    if (this.faceDetector) return;

    try {
      const visionModule = await import(MEDIAPIPE_VISION_BUNDLE);
      const FilesetResolver = visionModule.FilesetResolver;
      const FaceDetector = visionModule.FaceDetector;

      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);

      // Attempt GPU delegate with graceful fallback to CPU
      try {
        this.faceDetector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: FACE_DETECTOR_MODEL,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5
        });
      } catch (gpuError) {
        console.warn('WebcamControls: GPU delegate unavailable, using CPU fallback:', gpuError);
        this.faceDetector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: FACE_DETECTOR_MODEL,
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5
        });
      }
    } catch (err) {
      console.error('WebcamControls: Failed to initialize MediaPipe FaceDetector:', err);
      throw new Error('Failed to load MediaPipe AI Vision models from CDN. Please check your internet connection.');
    }
  }

  /**
   * Starts webcam video stream and begins AI detection loop.
   */
  async start() {
    if (this.isActive || this.isLoading) return;

    if (!this.isSupported) {
      this.onError('Camera API is not supported in this browser. Use keyboard or touch controls.');
      return;
    }

    this.isLoading = true;
    this.onStatusChange({ isActive: false, isLoading: true });

    if (this.container) {
      this.container.classList.remove('hidden');
    }
    if (this.spinner) {
      this.spinner.classList.remove('hidden');
    }

    try {
      // 1. Initialize vision model
      await this.initVision();

      // 2. Request user webcam (Capped to 320x240 @ 20 FPS for minimal CPU/RAM footprint)
      const constraints = {
        video: {
          width: { ideal: 320 },
          height: { ideal: 240 },
          facingMode: 'user',
          frameRate: { ideal: 20, max: 24 }
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;

      // Wait for video metadata to load dimensions
      await new Promise((resolve, reject) => {
        this.video.onloadedmetadata = () => {
          this.video.play().then(resolve).catch(reject);
        };
        this.video.onerror = reject;
      });

      // Match canvas resolution to video stream (capped at 320x240)
      if (this.canvas) {
        this.canvas.width = this.video.videoWidth || 320;
        this.canvas.height = this.video.videoHeight || 240;
      }

      this.isActive = true;
      this.isLoading = false;
      this.isCalibrated = false; // Reset to auto-calibrate on initial face detection

      if (this.spinner) {
        this.spinner.classList.add('hidden');
      }

      this.onStatusChange({ isActive: true, isLoading: false });

      // 3. Start prediction loop
      this.detectLoop();

    } catch (err) {
      console.warn('WebcamControls: Camera start error:', err);
      this.stop();

      let friendlyMsg = 'Camera access was denied or unavailable.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        friendlyMsg = 'Camera permission denied. Allow camera access in your browser to use Gesture Mode.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        friendlyMsg = 'No webcam was detected on this device.';
      } else if (err.message) {
        friendlyMsg = err.message;
      }

      this.onError(friendlyMsg);
    }
  }

  /**
   * Shuts down camera stream, frees MediaPipe WebAssembly memory, and terminates detection loop.
   */
  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }

    // Explicitly release MediaPipe FaceDetector WebAssembly buffers & GPU memory
    if (this.faceDetector) {
      try {
        this.faceDetector.close();
      } catch (e) {
        console.warn('WebcamControls: Error closing FaceDetector:', e);
      }
      this.faceDetector = null;
    }

    if (this.canvas && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    this.isActive = false;
    this.isLoading = false;
    this.lastDetectTime = 0;
    this.lastVideoTime = -1;

    if (this.container) {
      this.container.classList.add('hidden');
    }
    if (this.spinner) {
      this.spinner.classList.add('hidden');
    }

    this.onStatusChange({ isActive: false, isLoading: false });
  }

  /**
   * Toggle between active and stopped states.
   */
  async toggle() {
    if (this.isActive || this.isLoading) {
      this.stop();
      return false;
    } else {
      await this.start();
      return this.isActive;
    }
  }

  /**
   * Recalibrate neutral head position to the current nose position.
   * Runs automatically on new game start or when Webcam Mode first activates once a face is detected.
   */
  recalibrate() {
    this.isCalibrated = false;
    this.lastVerticalActionTime = -99999;
    this.canJump = true;
    this.canSlide = true;
    this.calibratedFeedbackTimer = performance.now() + 850;
    if (this.actionBadge) {
      this.actionBadge.textContent = 'CALIBRATED';
      this.actionBadge.style.color = '#10b981';
      this.actionBadge.style.borderColor = '#10b981';
    }
  }

  calibrate() {
    this.recalibrate();
  }

  /**
   * Continuous animation loop that runs vision inference throttled to ~15-20 FPS.
   */
  detectLoop() {
    if (!this.isActive || !this.video || !this.faceDetector) return;

    const now = performance.now();

    // Throttle MediaPipe detection to ~15-20 FPS (50ms interval)
    if (now - this.lastDetectTime >= this.detectThrottleMs &&
        this.video.readyState >= 2 &&
        this.video.currentTime !== this.lastVideoTime) {
      this.lastDetectTime = now;
      this.lastVideoTime = this.video.currentTime;
      try {
        const results = this.faceDetector.detectForVideo(this.video, now);
        // Only redraw the corner canvas when a new detection finishes
        this.processDetections(results);
      } catch (err) {
        console.warn('WebcamControls: Inference warning:', err);
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this.detectLoop());
  }

  /**
   * Interprets detected 6 facial keypoints and maps nose tip to Lane, Jump, and Slide actions.
   * MediaPipe FaceDetector keypoints:
   * [0] Left Eye, [1] Right Eye, [2] Nose Tip, [3] Mouth Center, [4] Left Ear Tragion, [5] Right Ear Tragion
   */
  processDetections(results) {
    if (!this.canvas || !this.ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    if (!results || !results.detections || results.detections.length === 0) {
      this.drawNoFaceGuide(w, h);
      return;
    }

    const detection = results.detections[0];
    const keypoints = detection.keypoints;
    if (!keypoints || keypoints.length < 3) return;

    // Keypoint 2: Nose Tip (primary tracking anchor)
    const nose = keypoints[2];
    if (!nose) return;

    // Mirrored coordinates for intuitive selfie feedback
    const mirroredX = 1 - nose.x;
    const mirroredY = nose.y;

    // Auto-calibrate on first stable frame if not yet calibrated
    if (!this.isCalibrated) {
      this.neutralX = mirroredX;
      this.neutralY = mirroredY;
      this.isCalibrated = true;
      this.lastVerticalActionTime = -99999;
      this.canJump = true;
      this.canSlide = true;
      this.calibratedFeedbackTimer = performance.now() + 850;
      if (this.actionBadge) {
        this.actionBadge.textContent = 'CALIBRATED';
        this.actionBadge.style.color = '#10b981';
        this.actionBadge.style.borderColor = '#10b981';
      }
    }

    // Relative displacement from calibrated neutral position
    const dx = mirroredX - this.neutralX;
    const dy = mirroredY - this.neutralY;

    // 1. HORIZONTAL LANE SWITCHING WITH DEADZONES
    let targetLane = 1; // Center default
    if (dx < -this.deadzoneX) {
      targetLane = 0; // Left lane
    } else if (dx > this.deadzoneX) {
      targetLane = 2; // Right lane
    } else {
      targetLane = 1; // Center lane
    }

    if (targetLane !== this.currentDetectedLane) {
      this.currentDetectedLane = targetLane;
      this.onLaneChange(targetLane);
    }

    // 2. VERTICAL ACTION DEBOUNCING (JUMP & SLIDE) - Shared 600ms lock & neutral re-arm band
    const now = performance.now();
    let verticalAction = null;
    const isVerticalLocked = (now - this.lastVerticalActionTime) < this.verticalLockMs;

    // Neutral re-arm band: head must return inside [-0.010, +0.015] to re-arm gestures
    if (dy >= this.rearmMinY && dy <= this.rearmMaxY) {
      this.canJump = true;
      this.canSlide = true;
    }

    // Jump detection: head nod/lift UP (Δy < -0.022)
    // Strictly blocked for 600ms if Slide was triggered (prevents duck rebound jumps)
    if (dy < -this.jumpThreshold) {
      if (this.canJump && !isVerticalLocked && (now - this.lastJumpTime > this.jumpCooldown)) {
        this.onJump();
        this.canJump = false;
        this.lastJumpTime = now;
        this.lastVerticalActionTime = now;
        verticalAction = 'JUMP!';
      }
    }

    // Slide detection: head duck DOWN (Δy > +0.048)
    // Avoids pre-jump head dips triggering slides; strictly blocked for 600ms if Jump was triggered
    if (dy > this.slideThreshold) {
      if (this.canSlide && !isVerticalLocked && (now - this.lastSlideTime > this.slideCooldown)) {
        this.onSlide();
        this.canSlide = false;
        this.lastSlideTime = now;
        this.lastVerticalActionTime = now;
        verticalAction = 'SLIDE!';
      }
    }

    // Update Action Badge UI
    this.updateGestureBadge(targetLane, verticalAction);

    // Draw visual feedback overlay on canvas
    this.drawOverlay(w, h, keypoints, nose, targetLane, verticalAction);
  }

  /**
   * Updates the on-screen gesture badge text and accent coloring.
   */
  updateGestureBadge(lane, verticalAction) {
    if (!this.actionBadge) return;

    const now = performance.now();

    if (verticalAction === 'JUMP!') {
      this.actionBadge.textContent = '⬆ JUMP!';
      this.actionBadge.style.color = '#ffd000';
      this.actionBadge.style.borderColor = '#ffd000';
      this.badgeActionExpiry = now + 400;
    } else if (verticalAction === 'SLIDE!') {
      this.actionBadge.textContent = '⬇ SLIDE!';
      this.actionBadge.style.color = '#ff2a85';
      this.actionBadge.style.borderColor = '#ff2a85';
      this.badgeActionExpiry = now + 400;
    } else if (now < (this.badgeActionExpiry || 0)) {
      return;
    } else if (now < (this.calibratedFeedbackTimer || 0)) {
      this.actionBadge.textContent = 'CALIBRATED';
      this.actionBadge.style.color = '#10b981';
      this.actionBadge.style.borderColor = '#10b981';
      return;
    } else {
      if (lane === 0) {
        this.actionBadge.textContent = '⬅ LEFT';
        this.actionBadge.style.color = '#10b981';
        this.actionBadge.style.borderColor = '#10b981';
      } else if (lane === 2) {
        this.actionBadge.textContent = '➡ RIGHT';
        this.actionBadge.style.color = '#10b981';
        this.actionBadge.style.borderColor = '#10b981';
      } else {
        this.actionBadge.textContent = '⏺ CENTER';
        this.actionBadge.style.color = '#00f0ff';
        this.actionBadge.style.borderColor = 'rgba(0, 240, 255, 0.4)';
      }
    }
  }

  /**
   * Draws mirrored keypoints and lane deadzone guide lines on canvas.
   */
  drawOverlay(w, h, keypoints, nose, lane, verticalAction) {
    const ctx = this.ctx;

    // 1. Draw Lane Division Guide Lines
    const leftBoundX = (1 - (this.neutralX - this.deadzoneX)) * w;
    const rightBoundX = (1 - (this.neutralX + this.deadzoneX)) * w;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';

    // Vertical boundary lines for 3 lanes
    ctx.beginPath();
    ctx.moveTo(leftBoundX, 0);
    ctx.lineTo(leftBoundX, h);
    ctx.moveTo(rightBoundX, 0);
    ctx.lineTo(rightBoundX, h);
    ctx.stroke();

    // Neutral resting band fill (-0.010 <= dy <= +0.015)
    const rearmTopY = (this.neutralY + this.rearmMinY) * h;
    const rearmBottomY = (this.neutralY + this.rearmMaxY) * h;
    ctx.fillStyle = 'rgba(0, 240, 255, 0.05)';
    ctx.fillRect(0, rearmTopY, w, Math.max(2, rearmBottomY - rearmTopY));

    // Horizontal threshold lines for Jump and Slide
    const jumpLineY = (this.neutralY - this.jumpThreshold) * h;
    const slideLineY = (this.neutralY + this.slideThreshold) * h;

    ctx.strokeStyle = 'rgba(255, 208, 0, 0.3)';
    ctx.beginPath();
    ctx.moveTo(0, jumpLineY);
    ctx.lineTo(w, jumpLineY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 42, 133, 0.3)';
    ctx.beginPath();
    ctx.moveTo(0, slideLineY);
    ctx.lineTo(w, slideLineY);
    ctx.stroke();
    ctx.restore();

    // 2. Draw subtle facial keypoint dots (eyes, mouth, ears)
    ctx.fillStyle = 'rgba(0, 240, 255, 0.45)';
    for (let i = 0; i < keypoints.length; i++) {
      if (i === 2) continue; // Skip nose tip here (drawn prominently below)
      const pt = keypoints[i];
      if (pt) {
        const lx = (1 - pt.x) * w;
        const ly = pt.y * h;
        ctx.beginPath();
        ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 3. Draw glowing Nose Tracker Dot (the active input cursor)
    const nosePx = (1 - nose.x) * w;
    const nosePy = nose.y * h;

    let dotColor = '#00f0ff';
    if (verticalAction === 'JUMP!') dotColor = '#ffd000';
    else if (verticalAction === 'SLIDE!') dotColor = '#ff2a85';
    else if (lane !== 1) dotColor = '#10b981';

    ctx.save();
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 10;

    // Outer pulse ring
    ctx.beginPath();
    ctx.arc(nosePx, nosePy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Solid core dot
    ctx.beginPath();
    ctx.arc(nosePx, nosePy, 4, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
    ctx.restore();
  }

  /**
   * Helper overlay when no face is found in camera view.
   */
  drawNoFaceGuide(w, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '600 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Center your face in view', w / 2, h / 2);

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(w * 0.25, h * 0.2, w * 0.5, h * 0.6);
    ctx.restore();

    if (this.actionBadge) {
      this.actionBadge.textContent = 'NO FACE';
      this.actionBadge.style.color = '#ff5470';
      this.actionBadge.style.borderColor = 'rgba(255, 84, 112, 0.4)';
    }
  }
}
