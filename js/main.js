import * as THREE from 'three';
import { Environment, BIOMES, LEVEL_THEMES } from './environment.js';
import { Player } from './player.js';
import { ObstacleManager } from './obstacles.js';
import { WebcamControls } from './webcamControls.js';

/**
 * Main Game Controller
 * Manages game states:
 * - 'START'
 * - 'PLAYING'
 * - 'PAUSED' (Freeze simulation, modal overlay, delta flush on resume)
 * - 'LEVEL_COMPLETE' (4.0s Unobstructed Hero Victory Dance & Theme Morph)
 * - 'DYING' (2.2s Dramatic Crash Focus & Particle Burst)
 * - 'GAMEOVER'
 */
class Game {
  constructor() {
    this.state = 'START';
    this.score = 0;
    this.highScore = parseInt(localStorage.getItem('roborunner_highscore') || '0', 10);
    this.level = 1;

    // Aggressive speed curve for "Very Hard" progression
    this.baseSpeed = this.getBaseSpeedForLevel(1);
    this.gameSpeed = this.baseSpeed;
    this.lastMilestone = 0;

    // Clock
    this.clock = new THREE.Clock();

    // DOM UI Elements
    this.initDOMElements();

    // 1. Initialize 3D Environment & Canvas
    this.container = document.getElementById('webgl-container');
    this.environment = new Environment(this.container);

    // 2. Initialize Procedural Obstacle Manager
    this.obstacleManager = new ObstacleManager(this.environment.scene);
    this.obstacleManager.setLevel(this.level);

    // 3. Audio Synthesizer (Zero-asset HTML5 Web Audio)
    this.initAudio();

    // 4. Initialize Player & Model Loading
    this.player = new Player(
      this.environment.scene,
      (percent) => this.onLoadProgress(percent),
      () => this.onModelLoaded()
    );

    // 5. Initialize Optional Webcam Gesture Controls (MediaPipe AI Vision)
    this.initWebcamControls();

    // 6. Setup Controls & Listeners
    this.setupEventListeners();

    // 7. Start Main Animation Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  /**
   * Progressive score thresholds:
   * Level 1: 0 to 500
   * Level 2: 500 to 1,500
   * Level 3: 1,500 to 3,000
   * Level 4: 3,000 to 5,000
   * Level 5: 5,000 to 10,000
   * Level 6: 10,000 to 25,000
   * Level 7+: Multiply previous threshold by 2.5x
   */
  getTargetThreshold(lvl) {
    const predefined = [0, 500, 1500, 3000, 5000, 10000, 25000];
    if (lvl <= 6) {
      return predefined[lvl];
    }
    let threshold = predefined[6];
    for (let l = 7; l <= lvl; l++) {
      threshold = Math.round(threshold * 2.5);
    }
    return threshold;
  }

  getPrevThreshold(lvl) {
    if (lvl <= 1) return 0;
    return this.getTargetThreshold(lvl - 1);
  }

  /**
   * Baseline forward running speeds per level:
   * Level 1: Moderate & comfortable warm-up (0.58)
   * Level 2: Slightly faster (+12% -> 0.65)
   * Level 3: Brisk arcade speed (+27% -> 0.74)
   * Level 4+: Fast expert overdrive (0.88+)
   */
  getBaseSpeedForLevel(lvl) {
    switch (lvl) {
      case 1: return 0.58;
      case 2: return 0.65;
      case 3: return 0.74;
      case 4: return 0.88;
      default: return 1.02 + (lvl - 5) * 0.12;
    }
  }

  initDOMElements() {
    this.startScreen = document.getElementById('start-screen');
    this.gameOverScreen = document.getElementById('game-over-screen');
    this.pauseScreen = document.getElementById('pause-screen');
    this.hud = document.getElementById('hud');

    this.startBtn = document.getElementById('start-btn');
    this.restartBtn = document.getElementById('restart-btn');
    this.resumeBtn = document.getElementById('resume-btn');
    this.pauseRestartBtn = document.getElementById('pause-restart-btn');

    this.hudLevel = document.getElementById('hud-level');
    this.hudScore = document.getElementById('hud-score');
    this.hudSpeed = document.getElementById('hud-speed');
    this.hudProgressText = document.getElementById('hud-progress-text');
    this.hudProgressFill = document.getElementById('hud-progress-fill');

    this.finalScoreEl = document.getElementById('final-score');
    this.finalLevelEl = document.getElementById('final-level');
    this.highScoreEl = document.getElementById('high-score');
    this.statDodgedEl = document.getElementById('stat-dodged');

    this.loadingContainer = document.getElementById('loading-container');
    this.loadingBarFill = document.getElementById('loading-bar-fill');
    this.loadingText = document.getElementById('loading-text');
    this.statusText = document.getElementById('status-text');

    this.milestoneBanner = document.getElementById('milestone-banner');
    this.milestoneText = document.getElementById('milestone-text');

    this.impactOverlay = document.getElementById('impact-overlay');
    this.warpOverlay = document.getElementById('warp-overlay');

    // Stage Announcement Title Card
    this.stageCard = document.getElementById('stage-card');
    this.stageCardPill = document.getElementById('stage-card-pill');
    this.stageCardNum = document.getElementById('stage-card-num');
    this.stageCardName = document.getElementById('stage-card-name');
    this.stageCardDesc = document.getElementById('stage-card-desc');

    // Level Clear Top Banner (Non-obstructive at top: 12%)
    this.levelClearBanner = document.getElementById('level-clear-banner');
    this.levelClearTitle = document.getElementById('level-clear-title');
    this.levelClearSubtitle = document.getElementById('level-clear-subtitle');
    this.countdownBarFill = document.getElementById('countdown-bar-fill');

    this.btnPauseToggle = document.getElementById('btn-pause-toggle');
    this.pauseIcon = document.getElementById('pause-icon');
    this.audioToggleBtn = document.getElementById('btn-audio-toggle');
    this.audioIcon = document.getElementById('audio-icon');

    // Webcam Gesture Controls & System Toast
    this.btnWebcamToggle = document.getElementById('btn-webcam-toggle');
    this.webcamIcon = document.getElementById('webcam-icon');
    this.toastEl = document.getElementById('game-toast');
    this.toastMsgEl = document.getElementById('toast-msg');
    this.toastIconEl = document.getElementById('toast-icon');
    this.toastTimer = null;
  }

  /**
   * Sound effects synthesizer using the Web Audio API
   */
  initAudio() {
    this.isMuted = false;
    this.audioCtx = null;

    const initContext = () => {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.audioCtx = new AudioContext();
        }
      }
    };

    window.addEventListener('click', initContext, { once: true });
    window.addEventListener('keydown', initContext, { once: true });
  }

  playSound(type) {
    if (this.isMuted || !this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;

      if (type === 'jump') {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.18);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);

        osc.start(now);
        osc.stop(now + 0.18);

      } else if (type === 'slide') {
        const bufferSize = this.audioCtx.sampleRate * 0.22;
        const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }

        const noise = this.audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(550, now);
        filter.frequency.exponentialRampToValueAtTime(160, now + 0.22);
        filter.Q.value = 2.2;

        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(0.32, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.audioCtx.destination);

        noise.start(now);
        noise.stop(now + 0.22);

      } else if (type === 'lane') {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(450, now);
        osc.frequency.exponentialRampToValueAtTime(280, now + 0.08);

        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

        osc.start(now);
        osc.stop(now + 0.08);

      } else if (type === 'milestone') {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.connect(gain);
          gain.connect(this.audioCtx.destination);

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.08);

          gain.gain.setValueAtTime(0.25, now + idx * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.25);

          osc.start(now + idx * 0.08);
          osc.stop(now + idx * 0.08 + 0.25);
        });

      } else if (type === 'victory') {
        const melody = [
          { f: 523.25, t: 0.0,  d: 0.18 }, // C5
          { f: 659.25, t: 0.12, d: 0.18 }, // E5
          { f: 783.99, t: 0.24, d: 0.25 }, // G5
          { f: 1046.5, t: 0.42, d: 0.45 }, // C6
          { f: 1318.5, t: 0.65, d: 0.70 }  // E6
        ];

        melody.forEach(n => {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.connect(gain);
          gain.connect(this.audioCtx.destination);

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(n.f, now + n.t);

          gain.gain.setValueAtTime(0.22, now + n.t);
          gain.gain.exponentialRampToValueAtTime(0.005, now + n.t + n.d);

          osc.start(now + n.t);
          osc.stop(now + n.t + n.d);
        });

      } else if (type === 'crash') {
        const bufferSize = this.audioCtx.sampleRate * 0.45;
        const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }

        const noise = this.audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.frequency.exponentialRampToValueAtTime(50, now + 0.45);

        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(0.7, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.audioCtx.destination);

        noise.start(now);
        noise.stop(now + 0.45);

      } else if (type === 'warp') {
        // Hyperspace Warp Surge Sound (Ascending pitch sweep + sub-bass boom)
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(75, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.45);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.005, now + 0.55);

        osc.start(now);
        osc.stop(now + 0.55);

        // Sub-bass thud
        const subOsc = this.audioCtx.createOscillator();
        const subGain = this.audioCtx.createGain();
        subOsc.connect(subGain);
        subGain.connect(this.audioCtx.destination);

        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(140, now);
        subOsc.frequency.exponentialRampToValueAtTime(35, now + 0.4);

        subGain.gain.setValueAtTime(0.5, now);
        subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

        subOsc.start(now);
        subOsc.stop(now + 0.4);
      }
    } catch (e) {
      console.warn('Audio synthesis notice:', e);
    }
  }

  toggleAudio() {
    this.isMuted = !this.isMuted;
    this.audioIcon.textContent = this.isMuted ? '🔇' : '🔊';
  }

  /**
   * Initializes optional hands-free Webcam Gesture Mode (MediaPipe Tasks Vision)
   */
  initWebcamControls() {
    this.webcamControls = new WebcamControls({
      onLaneChange: (laneIndex) => {
        if (this.state === 'PLAYING') {
          const changed = this.player.setLane(laneIndex);
          if (changed) {
            this.playSound('lane');
          }
        }
      },
      onJump: () => {
        if (this.state === 'PLAYING') {
          if (!this.player.isJumping) {
            this.player.jump();
            this.playSound('jump');
          }
        }
      },
      onSlide: () => {
        if (this.state === 'PLAYING') {
          this.player.slide();
          this.playSound('slide');
        }
      },
      onStatusChange: ({ isActive, isLoading }) => {
        if (this.btnWebcamToggle) {
          if (isLoading) {
            this.btnWebcamToggle.classList.add('loading');
            this.btnWebcamToggle.classList.remove('active');
            this.btnWebcamToggle.setAttribute('title', 'Initializing MediaPipe AI Vision...');
          } else if (isActive) {
            this.btnWebcamToggle.classList.remove('loading');
            this.btnWebcamToggle.classList.add('active');
            this.btnWebcamToggle.setAttribute('title', 'Webcam Gesture Mode: ON (Click or press C to turn off)');
            this.showToast('📹 Webcam Gesture Mode ACTIVE! Lean head to steer, nod up to jump, duck to slide.', 4000);
          } else {
            this.btnWebcamToggle.classList.remove('loading');
            this.btnWebcamToggle.classList.remove('active');
            this.btnWebcamToggle.setAttribute('title', 'Toggle Webcam Gesture Controls (C)');
          }
        }
      },
      onError: (errMsg) => {
        this.showToast(errMsg, 5000);
        if (this.btnWebcamToggle) {
          this.btnWebcamToggle.classList.remove('loading');
          this.btnWebcamToggle.classList.remove('active');
        }
      }
    });
  }

  toggleWebcam() {
    if (this.webcamControls) {
      this.webcamControls.toggle();
    }
  }

  showToast(msg, duration = 3500) {
    if (!this.toastEl || !this.toastMsgEl) return;
    this.toastMsgEl.textContent = msg;
    this.toastEl.classList.remove('hidden');

    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      if (this.toastEl) {
        this.toastEl.classList.add('hidden');
      }
    }, duration);
  }

  onLoadProgress(percent) {
    if (this.loadingBarFill) {
      this.loadingBarFill.style.width = `${percent}%`;
    }
    if (this.loadingText) {
      this.loadingText.textContent = `Downloading RobotExpressive 3D Asset: ${percent}%`;
    }
  }

  onModelLoaded() {
    if (this.statusText) {
      this.statusText.textContent = 'ROBOT READY • DANCING';
    }
    if (this.loadingContainer) {
      this.loadingContainer.style.display = 'none';
    }
    if (this.startBtn) {
      this.startBtn.disabled = false;
      this.startBtn.focus();
    }
  }

  setupEventListeners() {
    window.addEventListener('keydown', (e) => {
      // Audio toggle
      if (e.key === 'm' || e.key === 'M') {
        this.toggleAudio();
        return;
      }

      // Webcam Gesture Mode toggle via C
      if (e.code === 'KeyC' || e.key === 'c' || e.key === 'C') {
        this.toggleWebcam();
        return;
      }

      // Pause toggle via P or Escape
      if (e.code === 'KeyP' || e.key === 'p' || e.key === 'P' || e.code === 'Escape' || e.key === 'Escape') {
        if (this.state === 'PLAYING') {
          this.pauseGame();
          return;
        } else if (this.state === 'PAUSED') {
          this.resumeGame();
          return;
        }
      }

      if (this.state === 'START' && (e.code === 'Space' || e.key === 'Enter') && !this.startBtn.disabled) {
        this.startGame();
        return;
      }

      if (this.state === 'GAMEOVER' && (e.code === 'Space' || e.key === 'Enter')) {
        this.startGame();
        return;
      }

      if (this.state === 'PLAYING') {
        if (e.code === 'KeyA' || e.key === 'ArrowLeft') {
          this.player.moveLeft();
          this.playSound('lane');
        } else if (e.code === 'KeyD' || e.key === 'ArrowRight') {
          this.player.moveRight();
          this.playSound('lane');
        } else if (e.code === 'Space' || e.code === 'KeyW' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!this.player.isJumping) {
            this.player.jump();
            this.playSound('jump');
          }
        } else if (e.code === 'KeyS' || e.key === 'ArrowDown') {
          e.preventDefault();
          this.player.slide();
          this.playSound('slide');
        }
      }
    });

    this.startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.startGame();
    });

    this.restartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.startGame();
    });

    // Pause Controls
    this.btnPauseToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.state === 'PLAYING') {
        this.pauseGame();
      } else if (this.state === 'PAUSED') {
        this.resumeGame();
      }
    });

    this.resumeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resumeGame();
    });

    this.pauseRestartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pauseScreen.classList.add('hidden');
      this.startGame();
    });

    this.audioToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAudio();
    });

    if (this.btnWebcamToggle) {
      this.btnWebcamToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleWebcam();
      });
    }

    window.addEventListener('resize', () => {
      this.environment.onResize();
    });

    // Touch & Swipe Controls
    let touchStartX = 0;
    let touchStartY = 0;
    window.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
      if (this.state !== 'PLAYING' || e.changedTouches.length === 0) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      const threshold = 30;

      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > threshold) {
          this.player.moveRight();
          this.playSound('lane');
        } else if (dx < -threshold) {
          this.player.moveLeft();
          this.playSound('lane');
        }
      } else {
        if (dy < -threshold) {
          // Swipe Up: Jump
          this.player.jump();
          this.playSound('jump');
        } else if (dy > threshold) {
          // Swipe Down: Slide & Fast-Fall
          this.player.slide();
          this.playSound('slide');
        }
      }
    }, { passive: true });
  }

  /**
   * Pause the active run: freezes simulation and clock.
   */
  pauseGame() {
    if (this.state !== 'PLAYING') return;
    this.state = 'PAUSED';
    this.clock.stop();
    this.pauseIcon.textContent = '▶';
    this.pauseScreen.classList.remove('hidden');
  }

  /**
   * Resume paused run: flushes clock delta gap so obstacles never teleport.
   */
  resumeGame() {
    if (this.state !== 'PAUSED') return;
    this.pauseScreen.classList.add('hidden');
    this.pauseIcon.textContent = '⏸';
    this.clock.start();
    this.clock.getDelta(); // Flush delta spike!
    this.state = 'PLAYING';
  }

  /**
   * Resets game to Level 1 and begins run.
   */
  startGame() {
    this.score = 0;
    this.lastMilestone = 0;
    this.level = 1;
    this.baseSpeed = this.getBaseSpeedForLevel(1);
    this.gameSpeed = this.baseSpeed;

    // Reset components & themes
    this.player.reset();
    this.player.setSpeedTier(1);
    this.obstacleManager.clear();
    this.obstacleManager.setLevel(1);
    this.obstacleManager.setBiome(1);
    this.environment.setBiome(1);
    this.environment.setCameraMode('DEFAULT');
    this.environment.stopVictoryCelebration();

    // UI Updates
    this.startScreen.classList.add('hidden');
    this.gameOverScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.levelClearBanner.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.pauseIcon.textContent = '⏸';

    this.updateHUD();
    this.showStageCard(1);

    this.state = 'PLAYING';
    this.clock.start();
    this.clock.getDelta();
  }

  /**
   * Updates HUD labels and progressive level target indicator.
   */
  updateHUD() {
    const prevTarget = this.getPrevThreshold(this.level);
    const nextTarget = this.getTargetThreshold(this.level);
    const currentScore = Math.floor(this.score);

    this.hudLevel.textContent = this.level;
    this.hudScore.textContent = currentScore;
    this.hudSpeed.textContent = (this.gameSpeed / 0.58).toFixed(1) + 'x';

    // HUD Counter: "NEXT LVL: 120 / 500"
    this.hudProgressText.textContent = `NEXT LVL: ${currentScore} / ${nextTarget}`;

    // Fill percentage inside current level bracket
    const span = Math.max(1, nextTarget - prevTarget);
    const progressInSpan = Math.max(0, currentScore - prevTarget);
    const percent = Math.min(100, Math.max(0, (progressInSpan / span) * 100));
    this.hudProgressFill.style.width = `${percent}%`;
  }

  /**
   * Displays the cinematic Stage Announcement Card (e.g. STAGE 02 // REACTOR OVERDRIVE)
   * with custom biome borders, glow, and theme colors.
   */
  showStageCard(level) {
    const themeKey = Math.min(5, Math.max(1, level));
    const biome = BIOMES[themeKey] || BIOMES[5];
    if (this.stageCard) {
      if (this.stageCardNum) this.stageCardNum.textContent = biome.code;
      if (this.stageCardName) this.stageCardName.textContent = biome.name.toUpperCase();
      if (this.stageCardDesc) this.stageCardDesc.textContent = biome.desc;

      const hex = biome.divider.toString(16).padStart(6, '0');
      if (this.stageCardPill) {
        this.stageCardPill.style.borderColor = `#${hex}`;
        this.stageCardPill.style.boxShadow = `0 0 45px rgba(${parseInt(hex.slice(0,2),16)}, ${parseInt(hex.slice(2,4),16)}, ${parseInt(hex.slice(4,6),16)}, 0.45), 0 20px 50px rgba(0, 0, 0, 0.7)`;
      }
      if (this.stageCardNum) {
        this.stageCardNum.style.background = `#${hex}`;
      }
      if (this.stageCardName) {
        this.stageCardName.style.textShadow = `0 0 20px #${hex}`;
      }

      this.stageCard.classList.remove('hidden');

      if (this.stageCardTimeout) clearTimeout(this.stageCardTimeout);
      this.stageCardTimeout = setTimeout(() => {
        this.stageCard.classList.add('hidden');
      }, 2500);
    }
  }

  /**
   * Cinematic Death Sequence (2.2s Delay before Game Over Screen)
   */
  startDeathSequence() {
    this.state = 'DYING';
    this.playSound('crash');

    // Impact Screen Flash
    this.impactOverlay.classList.remove('flash');
    void this.impactOverlay.offsetWidth; // Force reflow
    this.impactOverlay.classList.add('flash');

    // Camera Shake & Radial Sparks
    this.environment.shake(0.55, 0.65);
    this.environment.triggerImpactSparks(this.player.group.position);

    // Zoom camera toward fallen robot
    this.environment.setCameraMode('DEATH_ZOOM');

    // Trigger Robot Death Animation (clampWhenFinished = true)
    this.player.die();

    // Wait exactly 2.2 seconds before showing Game Over modal
    setTimeout(() => {
      if (this.state === 'DYING') {
        this.finishGameOver();
      }
    }, 2200);
  }

  /**
   * Transitions to GAMEOVER screen after cinematic death concludes.
   */
  finishGameOver() {
    this.state = 'GAMEOVER';

    const finalVal = Math.floor(this.score);
    if (finalVal > this.highScore) {
      this.highScore = finalVal;
      localStorage.setItem('roborunner_highscore', this.highScore.toString());
    }

    this.finalScoreEl.textContent = finalVal;
    this.finalLevelEl.textContent = this.level;
    this.highScoreEl.textContent = this.highScore;
    this.statDodgedEl.textContent = this.obstacleManager.dodgedCount;

    this.hud.classList.add('hidden');
    this.gameOverScreen.classList.remove('hidden');
    this.restartBtn.focus();
  }

  /**
   * Level-Clear Victory Dance Sequence:
   * 1. Clear obstacles immediately.
   * 2. Ground player in center lane (x = 0, y = 0), face camera (rotation.y = 0).
   * 3. Lerp camera to front-facing hero shot with spotlight.
   * 4. Call fadeToAction('Dance', 0.2) with LoopRepeat.
   * 5. Non-obstructive top banner at top: 12% leaving robot completely visible.
   * 6. Uninterrupted 4.0s dance duration before next level launches!
   */
  startLevelClearSequence() {
    this.state = 'LEVEL_COMPLETE';

    // 1. Clear obstacles immediately
    this.obstacleManager.clear();

    // 2. Force player grounded in center lane, rotate 180 to face camera, trigger Dance
    this.player.celebrateVictory();

    // 3. Move camera to front-facing hero angle with spotlight on robot
    this.environment.setCameraMode('HERO_DANCE');

    // 4. Synth fanfare & victory confetti
    this.playSound('victory');
    this.environment.startVictoryCelebration(0);

    // 5. Sleek transparent top banner (leaves screen center 100% unobstructed)
    const nextLevel = this.level + 1;
    const nextThemeKey = Math.min(5, nextLevel);
    const nextTheme = LEVEL_THEMES[nextThemeKey] || LEVEL_THEMES[5];

    this.levelClearTitle.textContent = `LEVEL ${this.level} CLEARED!`;
    this.levelClearSubtitle.textContent = `GET READY FOR LEVEL ${nextLevel} (${nextTheme.name.toUpperCase()})`;
    this.levelClearBanner.classList.remove('hidden');

    // Animate Countdown Timer Bar over 4.0 seconds
    const duration = 4000;
    const startTime = performance.now();

    const updateCountdown = () => {
      if (this.state !== 'LEVEL_COMPLETE') return;
      const elapsed = performance.now() - startTime;
      const fillPct = Math.max(0, 100 - (elapsed / duration) * 100);

      if (this.countdownBarFill) {
        this.countdownBarFill.style.width = `${fillPct}%`;
      }

      if (elapsed < duration) {
        requestAnimationFrame(updateCountdown);
      }
    };
    requestAnimationFrame(updateCountdown);

    // 6. After 4 full seconds of dancing, rotate robot back and launch next level!
    setTimeout(() => {
      if (this.state === 'LEVEL_COMPLETE') {
        this.launchNextLevel();
      }
    }, duration);
  }

  /**
   * Transitions from Victory Dance into the next level.
   */
  launchNextLevel() {
    this.level++;
    this.levelClearBanner.classList.add('hidden');
    this.environment.stopVictoryCelebration();

    // 1. Trigger explosive warp transition: surges FOV to 86, pulses shockwave overlay & shifts biome
    this.environment.triggerWarpTransition(this.level);

    // 2. Rotate robot back down track (rotation.y = Math.PI) and resume Running animation
    this.player.resumeRunning();

    // 3. Update Player speed tier (Level 4+ lane switch speed boost)
    this.player.setSpeedTier(this.level);

    // 4. Reset camera to default running view
    this.environment.setCameraMode('DEFAULT');

    // 5. Configure obstacle manager with level spawn intervals and matching biome skin
    this.obstacleManager.setLevel(this.level);
    this.obstacleManager.setBiome(this.level);

    // 6. Warp sound surge & cinematic stage card announcement
    this.playSound('warp');
    this.showStageCard(this.level);

    this.baseSpeed = this.getBaseSpeedForLevel(this.level);
    this.gameSpeed = this.baseSpeed;

    this.updateHUD();

    // Flush clock delta before resuming run
    this.clock.getDelta();

    // Resume playing state
    this.state = 'PLAYING';
  }

  /**
   * Milestone flair: plays ThumbsUp emote every 100 points
   */
  checkMilestone() {
    const currentMilestone = Math.floor(this.score / 100);
    if (currentMilestone > this.lastMilestone) {
      this.lastMilestone = currentMilestone;
      const milestonePoints = currentMilestone * 100;

      this.player.triggerMilestone();
      this.playSound('milestone');

      this.milestoneText.textContent = `${milestonePoints} METERS! ROBOT IS PUMPED! 👍`;
      this.milestoneBanner.classList.add('visible');

      if (this.milestoneTimeout) clearTimeout(this.milestoneTimeout);
      this.milestoneTimeout = setTimeout(() => {
        this.milestoneBanner.classList.remove('visible');
      }, 2600);
    }
  }

  /**
   * Main Game Animation Loop
   */
  animate() {
    requestAnimationFrame(this.animate);

    // When paused, do not update physics, timers, score, or obstacles. Keep scene rendered.
    if (this.state === 'PAUSED') {
      this.environment.render();
      return;
    }

    const delta = Math.min(this.clock.getDelta(), 0.1);

    if (this.state === 'PLAYING') {
      // Calibrated score rate: ~40s of comfortable survival to reach 500 points in Level 1
      const baseScoreRate = 12.5;
      this.score += delta * baseScoreRate * (this.gameSpeed / 0.58);

      // Smooth subtle speed acceleration within level
      const prevTarget = this.getPrevThreshold(this.level);
      const nextTarget = this.getTargetThreshold(this.level);
      const span = nextTarget - prevTarget;
      const currentInSpan = Math.max(0, this.score - prevTarget);
      this.gameSpeed = this.baseSpeed + Math.min(0.20, (currentInSpan / span) * 0.15);

      this.updateHUD();

      // Check 100-point flair
      this.checkMilestone();

      // Check Level Clear condition against current progressive target
      if (this.score >= nextTarget) {
        this.startLevelClearSequence();
        return;
      }

      // Update Player physics & animations
      this.player.update(delta);

      // Emit continuous ground friction sparks when sliding
      if (this.player.isSliding) {
        this.environment.triggerSlideSparks(this.player.group.position);
      }

      // Update Environment scrolling
      this.environment.update(delta, this.gameSpeed, this.player.group.position.x, true);

      // Update Obstacles and test collision
      const collided = this.obstacleManager.update(delta, this.gameSpeed, this.player.collisionBox);
      if (collided) {
        this.startDeathSequence();
      }

    } else if (this.state === 'LEVEL_COMPLETE') {
      // Victory Dance: Robot dances uninterrupted facing camera with spotlight, mixer keeps updating
      this.player.update(delta);
      this.environment.update(delta, 0, 0, false);

    } else if (this.state === 'DYING') {
      // Cinematic Death: Robot plays out Death animation, track stopped, camera zooms in with sparks
      this.player.update(delta);
      this.environment.update(delta, 0, this.player.group.position.x, false);

    } else if (this.state === 'START') {
      // Robot keeps dancing/waving on Start screen
      this.player.update(delta);
      this.environment.update(delta, 0.04, 0, true);

    } else if (this.state === 'GAMEOVER') {
      // Clamped final death pose
      this.player.update(delta);
      this.environment.update(delta, 0, this.player.group.position.x, false);
    }

    // Render 3D Scene
    this.environment.render();
  }
}

// Instantiate game when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  window.gameInstance = new Game();
});
