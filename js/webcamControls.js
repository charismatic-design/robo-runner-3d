/**
 * WebcamControls:
 * Optional hands-free / gesture control mode using MediaPipe Tasks Vision (FaceLandmarker).
 * 100% on-device client-side computer vision — zero backend or external servers required.
 *
 * Mappings:
 * - Horizontal head/nose lean -> 3 lanes (Left, Center, Right) with deadzone margins.
 * - Upward nod/tilt -> Jump!
 * - Downward duck -> Slide & Fast-Fall!
 *
 * Features:
 * - Strict hysteresis & cooldown debouncing (prevents action spamming).
 * - Real-time mirrored canvas overlay with glowing landmark dots and lane guide lines.
 * - Graceful permission and error handling with clear fallback UI messaging.
 * - Zero impact on existing keyboard / touch swipe controls.
 */

const MEDIAPIPE_VISION_BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MEDIAPIPE_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FACE_LANDMARKER_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

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
    this.faceLandmarker = null;
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

    // Deadzone and action sensitivities
    this.deadzoneX = 0.065;      // +/- 6.5% width for Center lane
    this.jumpThreshold = 0.055;   // Head tilts up 5.5% relative to neutral -> Jump
    this.slideThreshold = 0.060;  // Head ducks down 6.0% relative to neutral -> Slide
    this.hysteresisY = 0.030;     // Must return within 3.0% before re-triggering

    // Action debounce timers (ms)
    this.lastJumpTime = 0;
    this.lastSlideTime = 0;
    this.jumpCooldown = 450;
    this.slideCooldown = 450;
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
   * Lazily loads MediaPipe Tasks Vision bundle and initializes FaceLandmarker
   * with lightweight inference configuration (numFaces: 1, blendshapes/matrices disabled).
   */
  async initVision() {
    if (this.faceLandmarker) return;

    try {
      // Dynamically import vision bundle from CDN
      const visionModule = await import(MEDIAPIPE_VISION_BUNDLE);
      const FilesetResolver = visionModule.FilesetResolver;
      const FaceLandmarker = visionModule.FaceLandmarker;

      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);

      // Attempt GPU delegate with graceful fallback to CPU
      try {
        this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_MODEL,
            delegate: 'GPU'
          },
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
          runningMode: 'VIDEO'
        });
      } catch (gpuError) {
        console.warn('WebcamControls: GPU delegate unavailable, using CPU fallback:', gpuError);
        this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_MODEL,
            delegate: 'CPU'
          },
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
          runningMode: 'VIDEO'
        });
      }
    } catch (err) {
      console.error('WebcamControls: Failed to initialize MediaPipe FaceLandmarker:', err);
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

      // 2. Request user webcam (Capped to lightweight resolution & framerate for optimal RAM/CPU)
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

    // Explicitly release MediaPipe FaceLandmarker WebAssembly buffers & GPU memory
    if (this.faceLandmarker) {
      try {
        this.faceLandmarker.close();
      } catch (e) {
        console.warn('WebcamControls: Error closing FaceLandmarker:', e);
      }
      this.faceLandmarker = null;
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
   */
  calibrate() {
    this.isCalibrated = false;
    if (this.actionBadge) {
      this.actionBadge.textContent = 'CALIBRATED';
      this.actionBadge.style.color = '#10b981';
      this.actionBadge.style.borderColor = '#10b981';
      setTimeout(() => {
        if (this.actionBadge) {
          this.actionBadge.style.color = '';
          this.actionBadge.style.borderColor = '';
        }
      }, 800);
    }
  }

  /**
   * Continuous animation loop that runs vision inference throttled to ~15-20 FPS.
   */
  detectLoop() {
    if (!this.isActive || !this.video || !this.faceLandmarker) return;

    const now = performance.now();

    // Throttle MediaPipe landmark detection to ~15-20 FPS (50ms interval) instead of every requestAnimationFrame
    if (now - this.lastDetectTime >= this.detectThrottleMs &&
        this.video.readyState >= 2 &&
        this.video.currentTime !== this.lastVideoTime) {
      this.lastDetectTime = now;
      this.lastVideoTime = this.video.currentTime;
      try {
        const results = this.faceLandmarker.detectForVideo(this.video, now);
        // Only redraw the corner overlay canvas when a new detection runs
        this.processLandmarks(results);
      } catch (err) {
        console.warn('WebcamControls: Inference warning:', err);
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this.detectLoop());
  }

  /**
   * Interprets detected landmarks and maps them to Lane, Jump, and Slide actions.
   */
  processLandmarks(results) {
    if (!this.canvas || !this.ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) {
      this.drawNoFaceGuide(w, h);
      return;
    }

    const landmarks = results.faceLandmarks[0];

    // Landmark 1: Nose Tip (primary stable anchor point)
    // Landmark 10: Forehead top, Landmark 152: Chin, Landmark 33 & 263: Eye corners
    const nose = landmarks[1];
    if (!nose) return;

    // Normalizing coordinates for mirrored selfie perspective:
    // When user physically moves LEFT, in the mirrored view they shift LEFT
    const mirroredX = 1 - nose.x;
    const mirroredY = nose.y;

    // Auto-calibrate on first stable frame if not yet calibrated
    if (!this.isCalibrated) {
      this.neutralX = mirroredX;
      this.neutralY = mirroredY;
      this.isCalibrated = true;
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

    // 2. VERTICAL ACTION DEBOUNCING (JUMP & SLIDE)
    const now = performance.now();
    let verticalAction = null;

    // Jump detection (head nods/tilts UP -> dy is negative)
    if (dy < -this.jumpThreshold) {
      if (this.canJump && (now - this.lastJumpTime > this.jumpCooldown)) {
        this.onJump();
        this.canJump = false;
        this.lastJumpTime = now;
        verticalAction = 'JUMP!';
      }
    } else if (dy > -this.hysteresisY) {
      // Re-arm jump when head returns towards neutral
      this.canJump = true;
    }

    // Slide detection (head ducks DOWN -> dy is positive)
    if (dy > this.slideThreshold) {
      if (this.canSlide && (now - this.lastSlideTime > this.slideCooldown)) {
        this.onSlide();
        this.canSlide = false;
        this.lastSlideTime = now;
        verticalAction = 'SLIDE!';
      }
    } else if (dy < this.hysteresisY) {
      // Re-arm slide when head returns towards neutral
      this.canSlide = true;
    }

    // Update Action Badge UI
    this.updateGestureBadge(targetLane, verticalAction);

    // Draw visual feedback overlay on canvas
    this.drawOverlay(w, h, landmarks, nose, dx, dy, targetLane, verticalAction);
  }

  /**
   * Updates the on-screen gesture badge text and accent coloring.
   */
  updateGestureBadge(lane, verticalAction) {
    if (!this.actionBadge) return;

    if (verticalAction === 'JUMP!') {
      this.actionBadge.textContent = '⬆ JUMP!';
      this.actionBadge.style.color = '#ffd000';
      this.actionBadge.style.borderColor = '#ffd000';
    } else if (verticalAction === 'SLIDE!') {
      this.actionBadge.textContent = '⬇ SLIDE!';
      this.actionBadge.style.color = '#00f0ff';
      this.actionBadge.style.borderColor = '#00f0ff';
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
   * Draws mirrored landmark points and lane deadzone guide lines on canvas.
   */
  drawOverlay(w, h, landmarks, nose, dx, dy, lane, verticalAction) {
    const ctx = this.ctx;

    // 1. Draw Lane Division Guide Lines
    // Guide lines are drawn relative to calibrated neutral point
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

    // Horizontal threshold lines for Jump and Slide
    const jumpLineY = (this.neutralY - this.jumpThreshold) * h;
    const slideLineY = (this.neutralY + this.slideThreshold) * h;

    ctx.strokeStyle = 'rgba(255, 208, 0, 0.2)';
    ctx.beginPath();
    ctx.moveTo(0, jumpLineY);
    ctx.lineTo(w, jumpLineY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(0, slideLineY);
    ctx.lineTo(w, slideLineY);
    ctx.stroke();
    ctx.restore();

    // 2. Draw subtle facial landmark points
    ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
    const keyLandmarkIndices = [10, 152, 234, 454, 33, 263, 61, 291];
    for (const idx of keyLandmarkIndices) {
      const pt = landmarks[idx];
      if (pt) {
        // Mirrored X for rendering
        const lx = (1 - pt.x) * w;
        const ly = pt.y * h;
        ctx.beginPath();
        ctx.arc(lx, ly, 2, 0, Math.PI * 2);
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
    ctx.shadowBlur = 12;

    // Outer pulse ring
    ctx.beginPath();
    ctx.arc(nosePx, nosePy, 8, 0, Math.PI * 2);
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Solid core dot
    ctx.beginPath();
    ctx.arc(nosePx, nosePy, 4.5, 0, Math.PI * 2);
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
