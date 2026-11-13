# ⚡ Robo Runner 3D

> A high-performance, modular 3D Endless Runner built with **Three.js (v0.160.0)**, **WebGL**, **MediaPipe AI Vision**, and vanilla **ES Modules**. Features the official Three.js `RobotExpressive` character, full skeletal animation mixing, athletic jump/slide physics, procedural reflex-driven hazard generation, multi-stage dynamic biomes, real-time Web Audio sound synthesis, and an optional **Hands-Free Webcam Gesture Mode** powered by on-device computer vision.

![Three.js](https://img.shields.io/badge/Three.js-v0.160.0-black?style=flat-square&logo=three.js)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Tasks%20Vision-00f0ff?style=flat-square&logo=google)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B%20Modules-yellow?style=flat-square&logo=javascript)
![HTML5](https://img.shields.io/badge/HTML5-Canvas%20%2F%20UI-orange?style=flat-square&logo=html5)
![CSS3](https://img.shields.io/badge/CSS3-Glassmorphism-blue?style=flat-square&logo=css3)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

---

## 🎮 Gameplay & Preview

```text
       ___________________________________________________________
      |  [LVL 01]   SCORE: 000420   SPEED: 1.0x   TARGET: [420/500] |
      |___________________________________________________________|
      |                                                           |
      |                          [SKYBOX]                         |
      |                                                           |
      |          /\                                 /\            |
      |     ====/  \===============================/  \====       |
      |        /    \    [CYBER TOY-LAB ARCS]     /    \          |
      |       |      |                           |      |         |
      |       |      |                           |      |         |
      |       |      |      [CYAN SLIDE GATE]    |      |         |
      |       |      |      ===============      |      |         |
      |       |      |                           |      |         |
      |       |      |                           |      |         |
      |       |      |      [RED JUMP HURDLE]    |      |         |
      |       |      |          [====]           |      |         |
      |       |  🤖  |                           |      |         |
      |       |  /\  |                           |      |         |
      |_______|_/__\_|___________________________|______|_________|
      |  LANE 1 (-3)         LANE 2 (0)          LANE 3 (+3)      |
```

> **Demo Placeholder:**
> Add gameplay captures or recordings into `docs/screenshots/`:
> - `docs/screenshots/gameplay.png` — High-speed arcade running action
> - `docs/screenshots/victory.png` — Hero victory dance sequence with spotlight & confetti
> - `docs/screenshots/death.png` — Slow-motion cinematic impact & sparks

---

## ✨ Features

- **Robotic Character & Full Animation Blending:**
  - Loads official `RobotExpressive.glb` with CDN mirrors and graceful procedural fallback.
  - Smooth animation transitions using `THREE.AnimationMixer` (`Running`, `Jump`, `Death`, `Dance`, `Wave`, `ThumbsUp`).
- **Snappy 3-Lane Mechanics & Physics:**
  - Fast horizontal lane shifting between `[-3, 0, 3]` with banking/leaning physics.
  - Snappy, athletic parabolic jump arc.
  - **Slide & Duck Mechanics:** Compresses hitbox height by 60% to cleanly duck beneath elevated overhead gates.
  - **Fast-Fall Air Cancel:** Tap `S` or `Down` mid-air to immediately slam the robot to the ground and chain into a slide.
- **Color-Coded Hazard System (Instant Reflex Readability):**
  - 🔴 **Neon Red / Orange (`#ff3300`)**: Low Hurdle & Falling Crusher — **100% Requires Jump**
  - 🔵 **Electric Cyan (`#00f0ff`)**: Elevated Overhead Gate — **100% Requires Slide**
  - 🟡 **Dark Metallic + Yellow Hazard (`#ffd000`)**: Tall Solid Wall — **Must Switch Lanes**
  - 🟣 **Neon Magenta / Purple (`#d946ef`)**: Dynamic Moving Hazards — Oscillating Drones & Sliding Barriers with directional chevrons
- **Fail-Safe Procedural Spawner:**
  - Strict minimum Z-distance tracking (`minZDistance`) ensures obstacles never bunch up or spawn unfairly close, regardless of framerate variations.
  - Fair level progression curve: Level 1 is a clean warm-up with single waves; Level 2 introduces mixed gates and slow drones; Level 3 introduces 2-step sequences and drop-gates; Level 4+ introduces 3-step gauntlets and rhythm waves.
- **Dynamic Multi-Stage Biomes:**
  - Stage 1: **Cyber Toy-Lab** (Bright cyan neon grid, clean white/blue sky)
  - Stage 2: **Reactor Overdrive** (Amber molten lighting, industrial hazards)
  - Stage 3: **Bio-Hazard Acid Sector** (Toxic green acid lighting and rails)
  - Stage 4: **Crimson Security Lockdown** (Void black sky, red laser warning beacons, wider FOV)
  - Stage 5+: **Quantum Glitch Void** (Deep nebula purple & gold cosmic atmosphere)
- **Cinematic State Sequences:**
  - **Victory Dance (`LEVEL_COMPLETE`):** Non-obstructive top banner, camera smoothly dollies into a hero shot, robot turns 180° to face the camera and dances under spotlights with celebratory confetti.
  - **Cinematic Death (`DYING`):** Camera shake, impact spark particles, slow-motion zoom, and 2.2-second delay before Game Over screen appears.
- **Synthesized Web Audio Sound Engine:**
  - Custom polyphonic audio synthesizer using Web Audio API (sine, square, triangle wave synthesis with exponential gain envelopes).
  - Procedural sound effects for jumps, slides, crashes, level warp surges, button clicks, and countdown beeps with zero external audio assets needed.
- **Webcam Gesture Mode (Optional Hands-Free AI Controls):**
  - Powered by **MediaPipe Tasks Vision (`FaceDetector` / BlazeFace Short-Range, ~220 KB)** via CDN.
  - **100% Client-Side & Private:** All computer vision inference runs locally on your GPU/CPU via WebAssembly — zero video or camera frames are ever sent across the network.
  - **Real-Time Mirrored Preview Widget:** Floating corner display featuring a live mirrored video stream, active nose tracker dot, facial landmarks, and visual lane deadzone guides.
  - **Intuitive Head Mappings:**
    - **Lean Left / Right:** Switches between the 3 lanes with calibrated deadzone margins.
    - **Nod / Tilt Up (Δy < -0.022):** Triggers Jump with cooldown debouncing.
    - **Duck Down (Δy > +0.048):** Triggers Slide & Fast-Fall ducking (calibrated to ignore slight pre-jump dips).
  - **Shared 600ms Vertical Action Lock:** Triggering Slide blocks Jump for 600ms (preventing accidental rebound jumps when returning from a duck), and Jump blocks Slide for 600ms, with a tight neutral re-arm band (`-0.010 <= Δy <= +0.015`).
  - **Auto-Recalibration:** Automatically recalibrates neutral resting posture `y0` whenever a new game starts or when Webcam Mode first activates once a face is detected. Manual calibration is always available via `🎯`.
  - **Graceful Error Handling:** If camera access is denied or unavailable, a friendly toast appears and the game continues seamlessly on keyboard & touch controls.
- **Full Pause System:**
  - Pause anytime with `P`, `ESC`, or the HUD button without desyncing delta clocks or teleporting obstacles.

---

## 🕹️ Controls

| Action | Keyboard | Touch / Mobile | Webcam Gesture Mode (Optional) |
| :--- | :--- | :--- | :--- |
| **Move Left** | `A` or `←` | Swipe Left | **Lean Head Left** |
| **Move Center** | — | — | **Center Head** |
| **Move Right** | `D` or `→` | Swipe Right | **Lean Head Right** |
| **Jump** | `Space` / `W` / `↑` | Swipe Up | **Nod / Tilt Head Up** |
| **Slide & Duck** | `S` or `↓` | Swipe Down | **Duck Head Down** |
| **Fast-Fall** | `S` or `↓` *(Mid-Air)* | Swipe Down *(Mid-Air)* | **Duck Head Down** *(Mid-Air)* |
| **Toggle Webcam Mode**| `C` | Tap 📹 Button in HUD | Toggle Hands-Free Vision Controls |
| **Recalibrate Head** | — | Tap 🎯 in Preview | Resets Neutral Center Resting Position |
| **Pause / Resume** | `P` or `Esc` | Tap Pause Button (⏸) | Suspends game loop |
| **Mute / Unmute** | `M` | Tap Audio Button (🔊) | Toggles sound effects |

---

## 🏗️ Architecture & File Structure

```text
├── index.html          # HTML5 entry point, ES Module importmap, HUD & modal overlays
├── style.css           # Modern arcade styling, glassmorphic HUD, responsive layouts
├── js/
│   ├── main.js         # Game loop coordinator, finite state machine, Web Audio sound engine
│   ├── environment.js  # Three.js scene, lighting, camera modes, 5+ biomes, particle effects
│   ├── player.js       # RobotExpressive character loader, animation mixer, jump/slide physics
│   ├── obstacles.js    # Procedural obstacle spawner, minimum Z-spacing, Box3 colliders
│   └── webcamControls.js # MediaPipe Tasks Vision (FaceLandmarker) gesture tracker & overlay
└── .gitignore          # Excludes OS artifacts, node_modules, build caches, and env files
```

### Module Responsibilities

1. **`js/main.js` (Game Controller & Loop):**
   - Implements a finite state machine: `START`, `PLAYING`, `PAUSED`, `LEVEL_COMPLETE`, `DYING`, `GAMEOVER`.
   - Manages the progressive score threshold formula and HUD updates.
   - Houses the procedural Web Audio synthesizer.
   - Coordinates user inputs from keyboard, touch, and webcam gesture controllers.
2. **`js/environment.js` (World & Render Engine):**
   - Configures `THREE.WebGLRenderer` with `ACESFilmicToneMapping` and `PCFSoftShadowMap`.
   - Handles camera positioning and transitions (`DEFAULT`, `HERO_DANCE`, `DEATH_ZOOM`).
   - Manages track recycling, overhead arches, side pylons, and biome theme interpolation.
3. **`js/player.js` (Character Controller):**
   - Loads `RobotExpressive.glb` via `GLTFLoader` with multi-tier CDN fallbacks and a procedural fallback mesh.
   - Blends character actions via `THREE.AnimationMixer`.
   - Calculates physics for jump arcs, slide compression, and fast-fall slams.
   - Updates oriented `THREE.Box3` bounding volume dynamically adjusted for crouching.
4. **`js/obstacles.js` (Hazard Manager):**
   - Enforces strict minimum Z-distance tracking (`minZDistance`) per level.
   - Generates single waves, 2-step sequences, late-shift fake-outs, and 3-step gauntlets.
   - Performs intersection tests against player collision box.
5. **`js/webcamControls.js` (AI Vision Gesture Controller):**
   - Dynamically loads MediaPipe Tasks Vision (`FaceLandmarker`) and GPU/CPU WASM runtimes from CDN.
   - Manages webcam video stream (`navigator.mediaDevices.getUserMedia`).
   - Computes head/nose position relative to calibrated neutral point.
   - Applies deadzone thresholds to map 3 lanes and triggers debounced Jump/Slide actions.
   - Renders real-time mirrored canvas overlay with glowing landmark dots, deadzone guides, and action badges.
   - Gracefully handles camera permissions and device errors without interrupting the game loop.

---

## 🚀 Setup & Run Instructions

This project uses modern browser **ES Modules** and loads 3D `.glb` assets over fetch, which requires serving the files over a local web server (opening `file:///` directly is restricted by browser CORS security).

### Option 1: Python (Recommended — Preinstalled on macOS/Linux)

```bash
# Navigate to the project directory
cd /path/to/Game

# Start a local HTTP server
python3 -m http.server 8080
```

Open your browser and navigate to:
```text
http://localhost:8080
```

### Option 2: Node.js (`npx`)

```bash
# Using 'serve'
npx serve -l 8080

# Or using 'http-server'
npx http-server -p 8080 -c-1
```

### Option 3: VS Code Live Server

1. Open the project folder in VS Code.
2. Install the **Live Server** extension (`ritwickdey.LiveServer`).
3. Right-click `index.html` and choose **"Open with Live Server"**.

---

## 🛠️ Tech Stack

- **Graphics Library:** [Three.js v0.160.0](https://threejs.org/) via unpkg ES Module Import Map
- **Computer Vision:** [Google MediaPipe Tasks Vision v0.10.14](https://developers.google.com/mediapipe/solutions/vision/face_landmarker) (FaceLandmarker) via jsDelivr CDN
- **3D Character Model:** `RobotExpressive.glb` (Official Three.js examples asset by [Tom Haas / mrdoob](https://github.com/mrdoob/three.js/tree/master/examples/models/gltf/RobotExpressive))
- **Audio:** Web Audio API (procedural oscillator-based synthesis)
- **Styling:** CSS3 Glassmorphism (`backdrop-filter: blur`), CSS Grid, Flexbox
- **Typography:** Google Fonts (`Chakra Petch`, `Outfit`)
- **Language:** Vanilla Modern JavaScript (ES6+ Modules, zero build tools or bundler dependencies required)

---

## 📝 License

This project is licensed under the [MIT License](LICENSE). 3D character asset courtesy of the Three.js project.
