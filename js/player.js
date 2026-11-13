import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Player class manages the RobotExpressive character:
 * - GLTF loading and fallback mechanisms
 * - AnimationMixer state transitions (Dance, Running, Jump, Death, ThumbsUp, Wave)
 * - 3-Lane switching with smooth lerping and lean dynamics
 * - Vertical jump physics
 * - Smooth Y-axis rotation (facing camera during victory dance, facing track during run)
 * - Bounding box for obstacle collision detection
 */
export class Player {
  constructor(scene, onProgress, onLoadCallback) {
    this.scene = scene;
    this.lanes = [-3, 0, 3];
    this.currentLaneIndex = 1; // start at center lane (0)
    this.targetX = this.lanes[this.currentLaneIndex];
    this.laneSwitchSpeed = 24; // Ultra-snappy baseline lane responsiveness

    // Physics parameters (snappy, athletic jump arc)
    this.y = 0;
    this.verticalVelocity = 0;
    this.gravity = 48;
    this.jumpStrength = 15.5;
    this.isJumping = false;
    this.isDead = false;
    this.isVictory = false;

    // Slide / Duck & Fast-Fall parameters
    this.isSliding = false;
    this.slideDuration = 0.55;
    this.slideTimer = 0;
    this.fastFallSpeed = -48; // Instantaneous downward slam on S/Down mid-air
    this.slideQueuedOnLanding = false;

    // Rotation targets: Math.PI = faces down track; 0 = faces camera
    this.targetRotationY = Math.PI;

    // Animation Mixer & Actions
    this.mixer = null;
    this.actions = {};
    this.activeAction = null;
    this.activeActionName = '';

    // Container group
    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);
    this.scene.add(this.group);

    // Collision Box bounds
    this.collisionBox = new THREE.Box3();
    this.boxCenter = new THREE.Vector3();
    this.boxDimensions = new THREE.Vector3(1.1, 1.8, 0.9);

    this.isLoaded = false;
    this.loadModel(onProgress, onLoadCallback);
  }

  /**
   * Loads RobotExpressive.glb with fallback mirrors to ensure high reliability.
   */
  loadModel(onProgress, onLoadCallback) {
    const loader = new GLTFLoader();

    // Primary requested URL
    const primaryUrl = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
    // Fallback CDN mirrors
    const fallbackUrls = [
      'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
      'https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
      'https://unpkg.com/three@0.160.0/examples/models/gltf/RobotExpressive/RobotExpressive.glb'
    ];

    const tryLoad = (urls) => {
      const url = urls[0];
      loader.load(
        url,
        (gltf) => {
          this.initRobotModel(gltf);
          this.isLoaded = true;
          if (onLoadCallback) onLoadCallback();
        },
        (xhr) => {
          if (xhr.lengthComputable && onProgress) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            onProgress(percent);
          }
        },
        (error) => {
          console.warn(`Failed loading model from ${url}:`, error);
          if (urls.length > 1) {
            console.log('Attempting backup mirror...');
            tryLoad(urls.slice(1));
          } else {
            console.error('All model sources failed. Initializing stylized placeholder.');
            this.createFallbackModel();
            this.isLoaded = true;
            if (onLoadCallback) onLoadCallback();
          }
        }
      );
    };

    tryLoad([primaryUrl, ...fallbackUrls]);
  }

  /**
   * Initializes the GLTF model, materials, shadows, and animations.
   */
  initRobotModel(gltf) {
    this.model = gltf.scene;

    // Scale appropriately (~0.35) and set initial rotation facing down track
    this.model.scale.set(0.35, 0.35, 0.35);
    this.model.rotation.y = this.targetRotationY;
    this.model.position.set(0, 0, 0);

    // Enable soft shadow casting & receiving on all meshes
    this.model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material.roughness = 0.4;
          child.material.metalness = 0.2;
        }
      }
    });

    this.group.add(this.model);

    // Setup Animation Mixer
    this.mixer = new THREE.AnimationMixer(this.model);

    // Register all built-in clips
    gltf.animations.forEach((clip) => {
      const action = this.mixer.clipAction(clip);
      this.actions[clip.name] = action;
    });

    // Listen for finished events on one-shot emotes
    this.mixer.addEventListener('finished', (e) => {
      if (this.isDead || this.isVictory) return;

      // When milestone celebration finishes, return to Running
      if (e.action === this.actions['ThumbsUp'] || e.action === this.actions['Yes']) {
        this.fadeToAction('Running', 0.25);
      }
    });

    // Default to Dance/Wave on Start screen
    if (this.actions['Dance']) {
      this.fadeToAction('Dance', 0.2);
    } else if (this.actions['Wave']) {
      this.fadeToAction('Wave', 0.2);
    } else if (this.actions['Idle']) {
      this.fadeToAction('Idle', 0.2);
    }
  }

  /**
   * Seamless crossfade helper between animations.
   */
  fadeToAction(name, duration = 0.2) {
    if (!this.actions || !this.actions[name]) {
      console.warn(`Animation action "${name}" not available.`);
      return;
    }

    const nextAction = this.actions[name];
    const prevAction = this.activeAction;

    if (prevAction === nextAction && nextAction.isRunning()) {
      return;
    }

    // Configure loop and clamp rules per action type
    if (name === 'Death') {
      nextAction.clampWhenFinished = true;
      nextAction.loop = THREE.LoopOnce;
    } else if (name === 'Jump') {
      nextAction.clampWhenFinished = true;
      nextAction.loop = THREE.LoopOnce;
    } else if (name === 'ThumbsUp' || name === 'Yes') {
      nextAction.clampWhenFinished = false;
      nextAction.loop = THREE.LoopOnce;
    } else if (name === 'Wave' || name === 'Dance') {
      nextAction.clampWhenFinished = false;
      nextAction.loop = THREE.LoopRepeat;
    } else {
      nextAction.clampWhenFinished = false;
      nextAction.loop = THREE.LoopRepeat;
    }

    nextAction.reset();
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);
    nextAction.fadeIn(duration);
    nextAction.play();

    if (prevAction && prevAction !== nextAction) {
      prevAction.fadeOut(duration);
    }

    this.activeAction = nextAction;
    this.activeActionName = name;
  }

  /**
   * Forces player onto the ground (y = 0) in center lane (x = 0),
   * smoothly rotates robot 180 degrees to face camera (rotation.y = 0),
   * and triggers the celebratory Dance animation loop.
   */
  celebrateVictory() {
    this.isVictory = true;
    this.isJumping = false;
    this.verticalVelocity = 0;
    this.y = 0;
    this.group.position.y = 0;
    this.currentLaneIndex = 1;
    this.targetX = 0;
    this.group.position.x = 0;
    this.group.rotation.set(0, 0, 0);

    this.targetRotationY = 0; // Face camera
    if (this.model) {
      this.model.rotation.y = 0;
    }

    if (this.actions['Dance']) {
      this.fadeToAction('Dance', 0.2);
    }
  }

  /**
   * Rotates robot back down the track (rotation.y = Math.PI) and resumes Running.
   */
  resumeRunning() {
    this.isVictory = false;
    this.targetRotationY = Math.PI; // Face down track
    if (this.actions['Running']) {
      this.fadeToAction('Running', 0.2);
    }
  }

  /**
   * Handle lane switching left
   */
  moveLeft() {
    if (this.isDead || this.isVictory) return;
    if (this.currentLaneIndex > 0) {
      this.currentLaneIndex--;
      this.targetX = this.lanes[this.currentLaneIndex];
    }
  }

  /**
   * Handle lane switching right
   */
  moveRight() {
    if (this.isDead || this.isVictory) return;
    if (this.currentLaneIndex < this.lanes.length - 1) {
      this.currentLaneIndex++;
      this.targetX = this.lanes[this.currentLaneIndex];
    }
  }

  /**
   * Trigger vertical jump physics and play Jump animation.
   * Cancels any active slide immediately.
   */
  jump() {
    if (this.isDead || this.isVictory || this.isJumping) return;

    if (this.isSliding) {
      this.isSliding = false;
      this.slideTimer = 0;
      this.slideQueuedOnLanding = false;
    }

    this.isJumping = true;
    this.verticalVelocity = this.jumpStrength;

    if (this.actions['Jump']) {
      this.fadeToAction('Jump', 0.1);
    }
  }

  /**
   * Trigger slide or fast-fall air cancel:
   * - If airborne: fast-falls immediately to the ground and queues slide upon landing.
   * - If grounded: enters 0.65s ducking slide, compresses model, and shrinks hitbox.
   */
  slide() {
    if (this.isDead || this.isVictory) return;

    // Fast-Fall Air Cancel
    if (this.isJumping) {
      this.verticalVelocity = this.fastFallSpeed;
      this.slideQueuedOnLanding = true;
      return;
    }

    // Ground Slide
    this.isSliding = true;
    this.slideTimer = this.slideDuration;
    if (this.actions['Sitting']) {
      this.fadeToAction('Sitting', 0.1);
    }
  }

  /**
   * Concludes slide and smoothly resumes running.
   */
  endSlide() {
    this.isSliding = false;
    this.slideTimer = 0;
    this.slideQueuedOnLanding = false;
    if (!this.isDead && !this.isVictory && this.activeActionName !== 'Jump') {
      this.fadeToAction('Running', 0.15);
    }
  }

  /**
   * Milestone flair: plays ThumbsUp or Yes emote
   */
  triggerMilestone() {
    if (this.isDead || this.isVictory) return;
    if (this.actions['ThumbsUp']) {
      this.fadeToAction('ThumbsUp', 0.15);
    } else if (this.actions['Yes']) {
      this.fadeToAction('Yes', 0.15);
    }
  }

  /**
   * Trigger game over death animation
   */
  die() {
    this.isDead = true;
    this.isVictory = false;
    if (this.actions['Death']) {
      this.fadeToAction('Death', 0.12);
    }
  }

  /**
   * Sets player responsiveness tier based on level:
   * Base speed 24, Level 4+ boosted to 30 for lightning-fast multi-input gauntlets.
   */
  setSpeedTier(level) {
    if (level >= 4) {
      this.laneSwitchSpeed = 30;
    } else {
      this.laneSwitchSpeed = 24;
    }
  }

  /**
   * Reset player state for a new game session
   */
  reset() {
    this.setSpeedTier(1);
    this.isDead = false;
    this.isVictory = false;
    this.isJumping = false;
    this.isSliding = false;
    this.slideTimer = 0;
    this.slideQueuedOnLanding = false;
    this.verticalVelocity = 0;
    this.y = 0;
    this.currentLaneIndex = 1;
    this.targetX = this.lanes[this.currentLaneIndex];
    this.targetRotationY = Math.PI;

    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);

    if (this.model) {
      this.model.scale.set(0.35, 0.35, 0.35);
      this.model.rotation.set(0, Math.PI, 0);
    }

    if (this.actions['Running']) {
      this.fadeToAction('Running', 0.2);
    }
  }

  /**
   * Per-frame physics, animation mixer progression, Y-rotation lerping, and bounding box.
   */
  update(delta) {
    // 1. Advance Skeletal Animation (Crucial: runs during PLAYING, DYING, and LEVEL_COMPLETE)
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // Victory Dance Mode: lock position grounded in center lane, face camera, and keep Dancing
    if (this.isVictory) {
      this.isJumping = false;
      this.isSliding = false;
      this.slideTimer = 0;
      this.slideQueuedOnLanding = false;
      this.verticalVelocity = 0;
      this.y = 0;
      this.group.position.set(0, 0, 0);
      this.group.rotation.set(0, 0, 0);

      if (this.model) {
        this.model.scale.set(0.35, 0.35, 0.35);
        this.model.rotation.x = 0;
        this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, 0, delta * 12);
      }
      return;
    }

    // 2. Smooth Model Y-Axis Rotation (Facing camera vs facing track)
    if (this.model) {
      this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, this.targetRotationY, delta * 8);
    }

    // 3. Smooth Lane Lerping on X axis
    const currentX = this.group.position.x;
    const lerpedX = THREE.MathUtils.lerp(currentX, this.targetX, delta * this.laneSwitchSpeed);
    this.group.position.x = lerpedX;

    // Dynamic bank / lean angle when changing lanes
    if (!this.isDead && !this.isVictory) {
      const laneDeltaX = this.targetX - lerpedX;
      this.group.rotation.z = -laneDeltaX * 0.14;
    } else {
      this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, 0, delta * 8);
    }

    // 4. Vertical Jump & Fast-Fall Physics
    if (this.isJumping) {
      this.verticalVelocity -= this.gravity * delta;
      this.y += this.verticalVelocity * delta;

      if (this.y <= 0) {
        this.y = 0;
        this.verticalVelocity = 0;
        this.isJumping = false;

        // If player fast-fell by pressing Slide mid-air, enter Slide immediately on touchdown!
        if (this.slideQueuedOnLanding) {
          this.slideQueuedOnLanding = false;
          this.isSliding = true;
          this.slideTimer = this.slideDuration;
          if (this.actions['Sitting']) {
            this.fadeToAction('Sitting', 0.1);
          }
        } else if (!this.isDead && !this.isVictory && this.activeActionName === 'Jump') {
          this.fadeToAction('Running', 0.15);
        }
      }
    }
    this.group.position.y = this.y;

    // 5. Slide / Duck Duration & Procedural Squash Deformation
    if (this.isSliding) {
      this.slideTimer -= delta;
      if (this.slideTimer <= 0) {
        this.endSlide();
      }
    }

    if (this.model) {
      const targetScaleY = this.isSliding ? 0.18 : 0.35;
      const targetScaleXZ = this.isSliding ? 0.42 : 0.35;
      const targetRotX = this.isSliding ? 0.22 : 0;

      this.model.scale.y = THREE.MathUtils.lerp(this.model.scale.y, targetScaleY, delta * 20);
      this.model.scale.x = THREE.MathUtils.lerp(this.model.scale.x, targetScaleXZ, delta * 20);
      this.model.scale.z = THREE.MathUtils.lerp(this.model.scale.z, targetScaleXZ, delta * 20);
      this.model.rotation.x = THREE.MathUtils.lerp(this.model.rotation.x, targetRotX, delta * 20);
    }

    // 6. Update Collision Box (Explicitly shrink height by 60% while sliding)
    const px = this.group.position.x;
    const py = this.group.position.y;
    if (this.isSliding) {
      // Shrunk top height to 0.78, cleanly fitting under overhead gates at y = 1.12
      this.collisionBox.min.set(px - 0.55, py, -0.45);
      this.collisionBox.max.set(px + 0.55, py + 0.78, 0.45);
    } else {
      // Standard running hitbox height (1.8)
      this.collisionBox.min.set(px - 0.55, py, -0.45);
      this.collisionBox.max.set(px + 0.55, py + 1.8, 0.45);
    }
  }

  /**
   * Emergency procedural toy robot fallback if network blocks external GLTF download.
   */
  createFallbackModel() {
    this.model = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffd000, roughness: 0.3, metalness: 0.2 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.5 });
    const cyanMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 0.8 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.6), bodyMat);
    torso.position.y = 0.9;
    torso.castShadow = true;
    this.model.add(torso);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), bodyMat);
    head.position.y = 1.7;
    head.castShadow = true;
    this.model.add(head);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.1), cyanMat);
    visor.position.set(0, 1.7, -0.26);
    this.model.add(visor);

    const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8), darkMat);
    leftLeg.position.set(-0.25, 0.4, 0);
    leftLeg.castShadow = true;
    this.model.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8), darkMat);
    rightLeg.position.set(0.25, 0.4, 0);
    rightLeg.castShadow = true;
    this.model.add(rightLeg);

    this.group.add(this.model);
  }
}
