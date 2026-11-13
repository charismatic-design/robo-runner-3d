import * as THREE from 'three';

/**
 * ObstacleManager:
 * - Color-coded for instant visual readability:
 *   * LOW HURDLES (Must Jump): Crisp glowing Neon Red/Orange (0xff3300)
 *   * HIGH OVERHEAD GATES (Must Slide): Crisp glowing Electric Cyan (0x00f0ff) with thin posts & open ground gap
 *   * TALL SOLID WALLS (Must Switch Lanes): Solid Dark Metallic (0x161c28) with Yellow Hazard stripes (0xffd000)
 *   * MOVING / DYNAMIC HAZARDS: Glowing Purple/Magenta (0xd946ef) with Directional Chevrons
 *
 * Strict Minimum Z-Spacing & Progression Tuning:
 * - Level 1: Warm-up (speed: 0.58). Single simple waves only. Min Z-gap: 42 units (interval: 1.8s). Zero moving, zero combos.
 * - Level 2: Moderate (speed: 0.65). 2-lane blocks + Jump/Slide in 3rd, slow drones/sliders (speed: 1.8). Min Z-gap: 33 units (interval: 1.45s).
 * - Level 3: Brisk Arcade (speed: 0.74). 2-step sequences (>= 26 units gap), drop gates, late-shift fake-outs, fast drones (speed: 2.6). Min Z-gap: 27 units (interval: 1.15s).
 * - Level 4+: High Speed / Master (speed: 0.88+). 3-step gauntlets, alternating rhythm waves, zig-zag corridors (all >= 22 units gap). Min Z-gap: 22 units (interval: 0.88s).
 *
 * Fail-Safe Z-Distance Enforcement:
 * - Guarantees that no matter the frame delta, two separate obstacle waves are NEVER spawned closer than minZDistance along Z.
 */
export class ObstacleManager {
  constructor(scene) {
    this.scene = scene;
    this.lanes = [-3, 0, 3];
    this.obstacles = [];
    this.spawnDistance = -100;
    this.despawnZ = 12;

    this.timer = 0;
    this.level = 1;
    this.baseSpawnInterval = 1.8;
    this.minZDistance = 42;
    this.dodgedCount = 0;

    // High-visibility universal color-coded materials
    this.initMaterials();
  }

  initMaterials() {
    // 1. LOW HURDLES (Must Jump) - Crisp Glowing Neon Red/Orange
    this.jumpHurdleMat = new THREE.MeshStandardMaterial({
      color: 0xff3300,
      emissive: 0xff2200,
      emissiveIntensity: 1.8,
      roughness: 0.2
    });

    this.jumpPostMat = new THREE.MeshStandardMaterial({
      color: 0x1f1414,
      metalness: 0.8,
      roughness: 0.3
    });

    // 2. HIGH OVERHEAD GATES (Must Slide) - Crisp Glowing Electric Cyan/Blue
    this.slideGateMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.8,
      roughness: 0.2
    });

    this.slidePostMat = new THREE.MeshStandardMaterial({
      color: 0x121e28,
      metalness: 0.8,
      roughness: 0.3
    });

    // 3. TALL SOLID WALLS (Must Switch Lanes) - Solid Dark Metallic / Yellow Hazard
    this.tallWallMat = new THREE.MeshStandardMaterial({
      color: 0x161c28,
      metalness: 0.8,
      roughness: 0.3
    });

    this.hazardYellowMat = new THREE.MeshStandardMaterial({
      color: 0xffd000,
      emissive: 0xffaa00,
      emissiveIntensity: 1.3,
      roughness: 0.3
    });

    // 4. MOVING / DYNAMIC HAZARDS - Glowing Purple/Magenta
    this.movingHazardMat = new THREE.MeshStandardMaterial({
      color: 0xd946ef,
      emissive: 0xc026d3,
      emissiveIntensity: 1.8,
      roughness: 0.2
    });

    this.chevronArrowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide
    });
  }

  /**
   * Universal color-coding is preserved across all levels for instant reflex recognition.
   */
  setBiome(level) {
    // Intentionally keep obstacle functional colors constant and high-contrast
  }

  /**
   * Calibrates spawn intervals and strict minimum Z-distances per level.
   */
  setLevel(level) {
    this.level = Math.max(1, level);
    if (this.level === 1) {
      this.baseSpawnInterval = 1.8;
      this.minZDistance = 42;
    } else if (this.level === 2) {
      this.baseSpawnInterval = 1.45;
      this.minZDistance = 33;
    } else if (this.level === 3) {
      this.baseSpawnInterval = 1.15;
      this.minZDistance = 27;
    } else if (this.level === 4) {
      this.baseSpawnInterval = 0.88;
      this.minZDistance = 22;
    } else {
      // Level 5+
      this.baseSpawnInterval = Math.max(0.72, 0.88 - (this.level - 4) * 0.04);
      this.minZDistance = 21;
    }
  }

  /**
   * Helper: Creates a sharp 3D directional chevron indicator (> or <)
   */
  createChevronIndicator(dir) {
    // dir > 0 points right, dir < 0 points left
    const g = new THREE.Group();
    const sign = dir > 0 ? 1 : -1;
    const barGeo = new THREE.BoxGeometry(0.28, 0.08, 0.05);

    const topBar = new THREE.Mesh(barGeo, this.chevronArrowMat);
    topBar.rotation.z = sign * (Math.PI / 4);
    topBar.position.set(-sign * 0.08, 0.09, 0);
    g.add(topBar);

    const botBar = new THREE.Mesh(barGeo, this.chevronArrowMat);
    botBar.rotation.z = -sign * (Math.PI / 4);
    botBar.position.set(-sign * 0.08, -0.09, 0);
    g.add(botBar);

    return g;
  }

  /**
   * Procedural obstacle wave generation dispatched cleanly per level.
   */
  spawn() {
    if (this.level === 1) {
      this.spawnLevel1();
    } else if (this.level === 2) {
      this.spawnLevel2();
    } else if (this.level === 3) {
      this.spawnLevel3();
    } else {
      this.spawnLevel4Plus();
    }
  }

  /**
   * LEVEL 1 (0–500) — "Cyber Toy-Lab / Warm-Up":
   * Comfortable, manageable speed (0.58).
   * Single, simple waves with generous spacing (min 42 units of clear track):
   * - 1 tall block (2 open lanes)
   * - 2 tall blocks (1 open lane)
   * - Single full-width Low Hurdle (100% requires Jump)
   * - Single full-width High Gate (100% requires Slide)
   * ZERO moving hazards, ZERO combos.
   */
  spawnLevel1() {
    const r = Math.random();
    const z = this.spawnDistance;

    if (r < 0.28) {
      // 1 Tall Wall (2 open lanes)
      const lane = this.lanes[Math.floor(Math.random() * 3)];
      this.createTallPylon(lane, z);
    } else if (r < 0.54) {
      // 2 Tall Walls (1 open lane)
      const openIdx = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx) {
          this.createTallPylon(this.lanes[i], z);
        }
      }
    } else if (r < 0.77) {
      // Full-Track Low Hurdle (Neon Red / Orange) -> Must JUMP
      this.createFullTrackLowLaser(z);
    } else {
      // Full-Track High Overhead Gate (Electric Cyan) -> Must SLIDE
      this.createFullTrackOverheadGate(z);
    }
  }

  /**
   * LEVEL 2 (500–1,500) — "Reactor Overdrive / Moderate":
   * +12% speed (0.65).
   * Spacing: min 33 units.
   * - 2-lane blockades mixed with Jump or Slide in the 3rd lane.
   * - Full-track Jump or Slide.
   * - Occasional slow-moving horizontal drones/barriers (speed: 1.8).
   * - Still generous spacing, ZERO rapid multi-step combos.
   */
  spawnLevel2() {
    const r = Math.random();
    const z = this.spawnDistance;

    if (r < 0.22) {
      // 2 Tall Walls + Jump Hurdle in the 3rd lane (Forced Jump in that specific lane)
      const openIdx = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx) {
          this.createTallPylon(this.lanes[i], z);
        } else {
          this.createLowLaser(this.lanes[i], z);
        }
      }
    } else if (r < 0.44) {
      // 2 Tall Walls + Slide Gate in the 3rd lane (Forced Slide in that specific lane)
      const openIdx = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx) {
          this.createTallPylon(this.lanes[i], z);
        } else {
          this.createSingleHighGate(this.lanes[i], z);
        }
      }
    } else if (r < 0.62) {
      // Full-Track Low Hurdle (Forced Jump)
      this.createFullTrackLowLaser(z);
    } else if (r < 0.80) {
      // Full-Track High Overhead Gate (Forced Slide)
      this.createFullTrackOverheadGate(z);
    } else if (r < 0.90) {
      // Slow Patrolling Drone (speed: 1.8)
      const startLane = this.lanes[Math.floor(Math.random() * 3)];
      this.createPatrollingDrone(startLane, z, 1.8);
    } else {
      // Slow Sliding Barrier (slideSpeed: 1.8)
      const startLane = this.lanes[Math.floor(Math.random() * 3)];
      this.createSlidingGate(startLane, z, 1.8);
    }
  }

  /**
   * LEVEL 3 (1,500–3,000) — "Bio-Hazard Sector / Brisk Arcade":
   * Brisk speed (0.74).
   * Spacing: min 27 units.
   * - Occasional 2-step sequences with >= 26 units gap.
   * - Falling drop-gates.
   * - Faster moving patrollers / sliders (speed: 2.6).
   * - Fake-out / late-shift obstacles.
   */
  spawnLevel3() {
    const r = Math.random();
    const z = this.spawnDistance;

    if (r < 0.30) {
      // 2-Step Sequence with generous 26 units gap
      this.createTwoStepSequence(z, 26);
    } else if (r < 0.48) {
      // Fake-Out / Late-Shift Obstacle
      this.createLateShiftObstacle(z);
    } else if (r < 0.64) {
      // Falling Drop-Gate
      if (Math.random() < 0.5) {
        this.createDropGate(0, z, true);
      } else {
        const lane = this.lanes[Math.floor(Math.random() * 3)];
        this.createDropGate(lane, z, false);
      }
    } else if (r < 0.80) {
      // Faster Patrolling Drone (speed: 2.6)
      const startLane = this.lanes[Math.floor(Math.random() * 3)];
      this.createPatrollingDrone(startLane, z, 2.6);
    } else {
      // Full-Track Jump or Slide
      if (Math.random() < 0.5) {
        this.createFullTrackLowLaser(z);
      } else {
        this.createFullTrackOverheadGate(z);
      }
    }
  }

  /**
   * LEVEL 4+ (3,000+) — "Crimson Lockdown & Beyond / Master":
   * High speed (0.88 to 1.02+).
   * Spacing: min 22 units.
   * - 3-step multi-input gauntlets (>= 22 units gap).
   * - Alternating rhythm waves (Jump -> Fast-Fall Slide -> Lane Switch, 22 units gap).
   * - High-speed zig-zag corridors (22 units gap).
   * - Late-shift obstacles, drop gates, and high-speed drones.
   */
  spawnLevel4Plus() {
    const r = Math.random();
    const z = this.spawnDistance;

    if (r < 0.28) {
      // Alternating Rhythm Wave (Jump -> Fast-Fall Slide -> Wall Blockade, 22 units gap)
      this.createAlternatingRhythmWave(z, 22);
    } else if (r < 0.54) {
      // 3-Step Multi-Input Gauntlet (22 units gap)
      this.createMultiInputGauntlet(z, 22);
    } else if (r < 0.74) {
      // High-Speed Zig-Zag Corridor (22 units gap)
      this.createZigZagCorridor(z, 22);
    } else if (r < 0.88) {
      // Late-Shift Fake-Out Obstacle
      this.createLateShiftObstacle(z);
    } else {
      // Full-Track Drop-Gate
      this.createDropGate(0, z, true);
    }
  }

  /**
   * LOW HURDLE (Must Jump) - Single Lane
   * Crisp glowing Neon Red/Orange bar at ground level (yMin: 0, yMax: 0.85).
   */
  createLowLaser(xPos, zPos) {
    const group = new THREE.Group();
    const height = 0.82;

    // Thin dark side posts with red glowing beacon caps
    [-1.05, 1.05].forEach(lx => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, height, 10), this.jumpPostMat);
      post.position.set(lx, height / 2, 0);
      post.castShadow = true;
      group.add(post);

      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), this.jumpHurdleMat);
      cap.position.set(lx, height + 0.1, 0);
      group.add(cap);
    });

    // Glowing Neon Red hurdle bar
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.24, 0.22), this.jumpHurdleMat);
    beam.position.set(0, height * 0.72, 0);
    group.add(beam);

    // Dark foot bar
    const foot = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.14, 0.3), this.jumpPostMat);
    foot.position.set(0, 0.07, 0);
    foot.castShadow = true;
    group.add(foot);

    group.position.set(xPos, 0, zPos);
    this.scene.add(group);

    const box = new THREE.Box3();
    this.obstacles.push({
      mesh: group,
      box: box,
      halfWidth: 1.15,
      halfDepth: 0.35,
      yMin: 0.0,
      yMax: 0.85, // Cleared cleanly by Jump!
      passed: false
    });
  }

  /**
   * LOW HURDLE (Must Jump) - Full 3-Lane Track Sweep
   * Spans across ALL 3 lanes at ground level. 100% Forced JUMP!
   */
  createFullTrackLowLaser(zPos) {
    const group = new THREE.Group();
    const trackWidth = 9.4;
    const height = 0.82;

    // Left & Right Support Towers
    [-4.6, 4.6].forEach(x => {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.3, height + 0.15, 0.35), this.jumpPostMat);
      tower.position.set(x, height / 2, 0);
      tower.castShadow = true;
      group.add(tower);

      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), this.jumpHurdleMat);
      cap.position.set(x, height + 0.15, 0);
      group.add(cap);
    });

    // Full-track glowing Neon Red hurdle beam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(trackWidth, 0.26, 0.22), this.jumpHurdleMat);
    beam.position.set(0, height * 0.72, 0);
    group.add(beam);

    // Foot base
    const foot = new THREE.Mesh(new THREE.BoxGeometry(trackWidth, 0.14, 0.32), this.jumpPostMat);
    foot.position.set(0, 0.07, 0);
    foot.castShadow = true;
    group.add(foot);

    group.position.set(0, 0, zPos);
    this.scene.add(group);

    const box = new THREE.Box3();
    this.obstacles.push({
      mesh: group,
      box: box,
      halfWidth: trackWidth / 2,
      halfDepth: 0.35,
      yMin: 0.0,
      yMax: 0.85,
      passed: false
    });
  }

  /**
   * HIGH OVERHEAD GATE (Must Slide) - Single Lane
   * Crisp glowing Electric Cyan beam elevated at y = 1.85.
   * Thin side pillars so the gap underneath (y: 0 to 1.12) is 100% open and obvious!
   */
  createSingleHighGate(xPos, zPos) {
    const group = new THREE.Group();
    const width = 2.4;
    const towerHeight = 3.3;

    // Ultra-thin side pillars
    [-1.1, 1.1].forEach(lx => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.16, towerHeight, 0.16), this.slidePostMat);
      col.position.set(lx, towerHeight / 2, 0);
      col.castShadow = true;
      group.add(col);
    });

    // Top structural bar
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.25, 0.22), this.slidePostMat);
    topBar.position.set(0, 3.0, 0);
    topBar.castShadow = true;
    group.add(topBar);

    // Glowing Electric Cyan hurdle beam (bottom edge at y = 1.15)
    const cyanBeam = new THREE.Mesh(new THREE.BoxGeometry(width - 0.1, 0.38, 0.22), this.slideGateMat);
    cyanBeam.position.set(0, 1.85, 0);
    group.add(cyanBeam);

    group.position.set(xPos, 0, zPos);
    this.scene.add(group);

    const box = new THREE.Box3();
    this.obstacles.push({
      mesh: group,
      box: box,
      halfWidth: 1.15,
      halfDepth: 0.3,
      yMin: 1.12, // High barrier: ground (y: 0 to 1.12) is 100% clear for slide!
      yMax: 3.2,
      passed: false
    });
  }

  /**
   * HIGH OVERHEAD GATE (Must Slide) - Full 3-Lane Track
   * Elevated barrier hovering across ALL 3 lanes. 100% Forced SLIDE!
   */
  createFullTrackOverheadGate(zPos) {
    const group = new THREE.Group();
    const trackWidth = 9.4;
    const towerHeight = 3.4;

    // Side Pillars outside lanes
    [-4.6, 4.6].forEach(x => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.2, towerHeight, 0.2), this.slidePostMat);
      col.position.set(x, towerHeight / 2, 0);
      col.castShadow = true;
      group.add(col);
    });

    // Elevated structural top frame
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(trackWidth, 0.3, 0.25), this.slidePostMat);
    topBeam.position.set(0, 3.05, 0);
    topBeam.castShadow = true;
    group.add(topBeam);

    // Full-track glowing Electric Cyan beam
    const cyanBeam = new THREE.Mesh(new THREE.BoxGeometry(trackWidth, 0.42, 0.22), this.slideGateMat);
    cyanBeam.position.set(0, 1.85, 0);
    group.add(cyanBeam);

    group.position.set(0, 0, zPos);
    this.scene.add(group);

    const box = new THREE.Box3();
    this.obstacles.push({
      mesh: group,
      box: box,
      halfWidth: trackWidth / 2,
      halfDepth: 0.3,
      yMin: 1.12,
      yMax: 3.2,
      passed: false
    });
  }

  /**
   * TALL SOLID WALL (Must Switch Lanes)
   * Solid Dark Metallic block with glowing Yellow Hazard stripes and top beacon.
   * Completely unpassable from y = 0 to y = 3.0!
   */
  createTallPylon(xPos, zPos) {
    const group = new THREE.Group();
    const height = 3.0;
    const width = 2.2;
    const depth = 0.9;

    // Dark metallic main pylon
    const mainPylon = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), this.tallWallMat);
    mainPylon.position.set(0, height / 2, 0);
    mainPylon.castShadow = true;
    mainPylon.receiveShadow = true;
    group.add(mainPylon);

    // Glowing Yellow Hazard Chevron Band across center
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(width + 0.05, 0.6, depth + 0.05), this.hazardYellowMat);
    stripe.position.set(0, height * 0.5, 0);
    group.add(stripe);

    // Top glowing yellow warning beacon
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), this.hazardYellowMat);
    beacon.position.set(0, height + 0.14, 0);
    group.add(beacon);

    group.position.set(xPos, 0, zPos);
    this.scene.add(group);

    const box = new THREE.Box3();
    this.obstacles.push({
      mesh: group,
      box: box,
      halfWidth: 1.1,
      halfDepth: 0.45,
      yMin: 0.0,
      yMax: 3.0,
      passed: false
    });
  }

  /**
   * 2-STEP SEQUENCE (Level 3)
   * Two clear, distinct obstacles separated by at least 26 units of clear track.
   */
  createTwoStepSequence(zPos, spacing = 26) {
    const pattern = Math.random();

    if (pattern < 0.35) {
      // Step 1: Full Jump Hurdle
      this.createFullTrackLowLaser(zPos);
      // Step 2 (26 units later): 2 Tall Walls leaving 1 open lane
      const openIdx = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx) {
          this.createTallPylon(this.lanes[i], zPos - spacing);
        }
      }
    } else if (pattern < 0.70) {
      // Step 1: Full Slide Gate
      this.createFullTrackOverheadGate(zPos);
      // Step 2 (26 units later): 2 Tall Walls leaving 1 open lane
      const openIdx = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx) {
          this.createTallPylon(this.lanes[i], zPos - spacing);
        }
      }
    } else {
      // Step 1: 2 Tall Walls (1 lane open)
      const openIdx1 = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx1) {
          this.createTallPylon(this.lanes[i], zPos);
        }
      }
      // Step 2 (26 units later): Shift to another open lane with Jump Hurdle in old lane
      const openIdx2 = (openIdx1 + (Math.random() < 0.5 ? 1 : 2)) % 3;
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx2) {
          this.createTallPylon(this.lanes[i], zPos - spacing);
        } else {
          this.createLowLaser(this.lanes[i], zPos - spacing);
        }
      }
    }
  }

  /**
   * FAKE-OUT / LATE-SHIFT OBSTACLE (Level 3+)
   * Starts in one lane, and at z = -42 rapidly slides horizontally into the neighbouring lane,
   * flashing glowing purple directional chevrons to test pure reaction reflexes!
   */
  createLateShiftObstacle(zPos) {
    const group = new THREE.Group();
    const height = 3.0;
    const width = 2.2;
    const depth = 0.9;

    // Pick start lane and target lane
    const startIdx = Math.floor(Math.random() * 3);
    const fromX = this.lanes[startIdx];
    const shiftRight = startIdx === 0 ? true : (startIdx === 2 ? false : Math.random() < 0.5);
    const toIdx = shiftRight ? startIdx + 1 : startIdx - 1;
    const toX = this.lanes[toIdx];

    // Dark metallic body with Purple/Magenta moving hazard trim
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), this.tallWallMat);
    body.position.set(0, height / 2, 0);
    body.castShadow = true;
    group.add(body);

    const purpleBand = new THREE.Mesh(new THREE.BoxGeometry(width + 0.05, 0.5, depth + 0.05), this.movingHazardMat);
    purpleBand.position.set(0, height * 0.5, 0);
    group.add(purpleBand);

    // Top purple beacon
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), this.movingHazardMat);
    beacon.position.set(0, height + 0.14, 0);
    group.add(beacon);

    // Directional chevron on front face pointing in the shift direction!
    const chevron = this.createChevronIndicator(shiftRight ? 1 : -1);
    chevron.position.set(0, height * 0.5, depth / 2 + 0.04);
    group.add(chevron);

    group.position.set(fromX, 0, zPos);
    group.userData = {
      isLateShift: true,
      shifted: false,
      triggerZ: -42,
      targetX: toX,
      shiftSpeed: 18
    };
    this.scene.add(group);

    const box = new THREE.Box3();
    this.obstacles.push({
      mesh: group,
      box: box,
      halfWidth: 1.1,
      halfDepth: 0.45,
      yMin: 0.0,
      yMax: 3.0,
      passed: false
    });
  }

  /**
   * 3-STEP MULTI-INPUT GAUNTLET (Level 4+)
   * Strictly enforces >= 22 units Z-spacing between each step so player jump/slide recoveries finish:
   * Pattern A: Jump Center -> Shift Left & Slide -> Shift Center & Jump
   * Pattern B: Slide Center -> Shift Right & Jump -> Shift Center & Slide
   */
  createMultiInputGauntlet(zPos, spacing = 22) {
    const patternA = Math.random() < 0.5;

    if (patternA) {
      // Step 1 at zPos: Low Red Hurdle in Center (x = 0). Left & Right blocked by Tall Walls. -> JUMP CENTER
      this.createLowLaser(0, zPos);
      this.createTallPylon(-3, zPos);
      this.createTallPylon(3, zPos);

      // Step 2 at zPos - spacing: High Cyan Gate in Left (x = -3). Center & Right blocked. -> SWITCH LEFT & SLIDE
      this.createSingleHighGate(-3, zPos - spacing);
      this.createTallPylon(0, zPos - spacing);
      this.createTallPylon(3, zPos - spacing);

      // Step 3 at zPos - spacing * 2: Low Red Hurdle in Center (x = 0). Left & Right blocked. -> SWITCH CENTER & JUMP
      this.createLowLaser(0, zPos - spacing * 2);
      this.createTallPylon(-3, zPos - spacing * 2);
      this.createTallPylon(3, zPos - spacing * 2);
    } else {
      // Step 1 at zPos: High Cyan Gate in Center (x = 0). -> SLIDE CENTER
      this.createSingleHighGate(0, zPos);
      this.createTallPylon(-3, zPos);
      this.createTallPylon(3, zPos);

      // Step 2 at zPos - spacing: Low Red Hurdle in Right (x = 3). -> SWITCH RIGHT & JUMP
      this.createLowLaser(3, zPos - spacing);
      this.createTallPylon(-3, zPos - spacing);
      this.createTallPylon(0, zPos - spacing);

      // Step 3 at zPos - spacing * 2: High Cyan Gate in Center (x = 0). -> SWITCH CENTER & SLIDE
      this.createSingleHighGate(0, zPos - spacing * 2);
      this.createTallPylon(-3, zPos - spacing * 2);
      this.createTallPylon(3, zPos - spacing * 2);
    }
  }

  /**
   * ALTERNATING RHYTHM WAVE (Level 4+)
   * Strictly enforces >= 22 units Z-spacing between actions:
   * 1. Full-Track Low Red Jump Hurdle (JUMP)
   * 2. Full-Track High Cyan Slide Gate 22 units later (FAST-FALL SLIDE)
   * 3. 2-Lane Tall Solid Yellow Wall Blockade 22 units later (LANE SWITCH)
   */
  createAlternatingRhythmWave(zPos, spacing = 22) {
    // 1. Full-Track Jump Hurdle across all 3 lanes (JUMP)
    this.createFullTrackLowLaser(zPos);

    // 2. Full-Track High Overhead Gate across all 3 lanes (FAST-FALL SLIDE)
    this.createFullTrackOverheadGate(zPos - spacing);

    // 3. 2-Lane Blockade leaving only 1 lane open (LANE SWITCH)
    const openLaneIdx = Math.floor(Math.random() * 3);
    for (let i = 0; i < 3; i++) {
      if (i !== openLaneIdx) {
        this.createTallPylon(this.lanes[i], zPos - spacing * 2);
      }
    }
  }

  /**
   * HIGH-SPEED ZIG-ZAG CORRIDOR (Level 4+)
   * Spaced 22 units apart along Z.
   */
  createZigZagCorridor(zPos, spacing = 22) {
    // Step 1: Blocks Left and Center, Right open
    this.createLowLaser(this.lanes[0], zPos);
    this.createTallPylon(this.lanes[1], zPos);

    // Step 2: Blocks Right and Center, Left open
    this.createSingleHighGate(this.lanes[2], zPos - spacing);
    this.createTallPylon(this.lanes[1], zPos - spacing);

    // Step 3: Blocks Left and Right, Center requires jump
    this.createTallPylon(this.lanes[0], zPos - spacing * 2);
    this.createTallPylon(this.lanes[2], zPos - spacing * 2);
    this.createLowLaser(this.lanes[1], zPos - spacing * 2);
  }

  /**
   * PATROLLING DRONE (Level 2+)
   * Faceted purple drone oscillating smoothly across lanes with glowing eye.
   */
  createPatrollingDrone(xPos, zPos, speed = 2.4) {
    const group = new THREE.Group();

    const droneGeo = new THREE.DodecahedronGeometry(0.7);
    const drone = new THREE.Mesh(droneGeo, this.movingHazardMat);
    drone.position.set(0, 1.35, 0);
    drone.castShadow = true;
    group.add(drone);

    const eyeGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const eye = new THREE.Mesh(eyeGeo, this.hazardYellowMat);
    eye.position.set(0, 1.35, 0.45);
    group.add(eye);

    group.position.set(xPos, 0, zPos);
    group.userData = {
      isDrone: true,
      isPatroller: true,
      originX: xPos,
      patrolRange: 2.6,
      speed: speed,
      offset: Math.random() * Math.PI * 2
    };
    this.scene.add(group);

    const box = new THREE.Box3();
    this.obstacles.push({
      mesh: group,
      box: box,
      halfWidth: 0.9,
      halfDepth: 0.6,
      yMin: 0.6,
      yMax: 2.1,
      passed: false
    });
  }

  /**
   * SLIDING BARRIER (Level 2+)
   * Purple sliding frame sweeping toward target lane with directional chevron.
   */
  createSlidingGate(xPos, zPos, speed = 2.0) {
    const group = new THREE.Group();
    const height = 1.8;
    const targetX = xPos === 0 ? (Math.random() < 0.5 ? -3 : 3) : 0;
    const sign = targetX > xPos ? 1 : -1;

    // Dark posts
    [-0.9, 0.9].forEach(lx => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, height, 0.25), this.tallWallMat);
      p.position.set(lx, height / 2, 0);
      p.castShadow = true;
      group.add(p);
    });

    // Purple moving beam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.25), this.movingHazardMat);
    beam.position.set(0, height * 0.6, 0);
    group.add(beam);

    // Directional chevron arrow indicating movement direction
    const chevron = this.createChevronIndicator(sign);
    chevron.position.set(0, height * 0.6, 0.16);
    group.add(chevron);

    group.position.set(xPos, 0, zPos);
    group.userData = {
      isSliding: true,
      originX: xPos,
      targetX: targetX,
      slideSpeed: speed
    };
    this.scene.add(group);

    const box = new THREE.Box3();
    this.obstacles.push({
      mesh: group,
      box: box,
      halfWidth: 1.05,
      halfDepth: 0.35,
      yMin: 0.0,
      yMax: 1.8,
      passed: false
    });
  }

  /**
   * FALLING DROP-GATE (Level 3+)
   */
  createDropGate(xPos, zPos, isFullTrack = false) {
    const group = new THREE.Group();
    const width = isFullTrack ? 9.4 : 2.4;
    const towerHeight = 3.6;

    // Side Posts
    const postXPositions = isFullTrack ? [-4.6, 4.6] : [-1.05, 1.05];
    postXPositions.forEach(lx => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, towerHeight, 0.3), this.tallWallMat);
      col.position.set(lx, towerHeight / 2, 0);
      col.castShadow = true;
      group.add(col);
    });

    // Top Beam
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, 0.3), this.tallWallMat);
    topBeam.position.set(0, towerHeight - 0.15, 0);
    topBeam.castShadow = true;
    group.add(topBeam);

    // Warning Beacon on top
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), this.jumpHurdleMat);
    beacon.position.set(0, towerHeight + 0.12, 0);
    group.add(beacon);

    // Heavy Falling Crusher Slab (Neon Red Jump Hurdle)
    const slabGroup = new THREE.Group();
    const crusherMesh = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.55, 0.25), this.jumpHurdleMat);
    slabGroup.add(crusherMesh);

    const crusherTeeth = new THREE.Mesh(new THREE.BoxGeometry(width - 0.15, 0.18, 0.3), this.hazardYellowMat);
    crusherTeeth.position.set(0, -0.28, 0);
    slabGroup.add(crusherTeeth);

    slabGroup.position.set(0, 2.2, 0);
    group.add(slabGroup);

    group.position.set(isFullTrack ? 0 : xPos, 0, zPos);
    this.scene.add(group);

    const box = new THREE.Box3();
    this.obstacles.push({
      mesh: group,
      slabGroup: slabGroup,
      beacon: beacon,
      isDropGate: true,
      dropped: false,
      box: box,
      halfWidth: (width - 0.2) / 2,
      halfDepth: 0.35,
      yMin: 1.3,
      yMax: 3.3,
      passed: false
    });
  }

  /**
   * Advances obstacles, handles late-shift animation, updates Box3 bounding boxes,
   * enforces strict minimum Z-distances between waves, and tests collisions.
   */
  update(delta, gameSpeed, playerBox) {
    let collided = false;
    const moveDist = gameSpeed * delta * 60;

    // Strict Minimum Z-Distance Fail-Safe Enforcement:
    // Determine the furthest-back obstacle (closest to spawn line at z = -100).
    let minObstacleZ = 0;
    if (this.obstacles.length > 0) {
      let minZ = this.obstacles[0].mesh.position.z;
      for (let i = 1; i < this.obstacles.length; i++) {
        const oz = this.obstacles[i].mesh.position.z;
        if (oz < minZ) minZ = oz;
      }
      minObstacleZ = minZ;
    }

    const distanceTraveled = this.obstacles.length === 0 ? 999 : (minObstacleZ - this.spawnDistance);
    const canSpawnByDistance = distanceTraveled >= this.minZDistance;

    // Spawn countdown: only spawn if timer is ready AND previous wave has cleared safe Z-distance
    this.timer += delta;
    if (this.timer >= this.baseSpawnInterval && canSpawnByDistance) {
      this.timer = 0;
      this.spawn();
    }

    const now = Date.now() * 0.001;

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const item = this.obstacles[i];
      const mesh = item.mesh;

      // Move toward player
      mesh.position.z += moveDist;

      // Fake-Out / Late-Shift Obstacle logic
      if (mesh.userData.isLateShift) {
        const u = mesh.userData;
        if (mesh.position.z > u.triggerZ) {
          u.shifted = true;
        }
        if (u.shifted) {
          mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, u.targetX, delta * u.shiftSpeed);
        }
      }

      // Drop-Gate dynamic drop animation & hitbox morph
      if (item.isDropGate) {
        if (item.beacon) {
          item.beacon.scale.setScalar(1 + Math.sin(now * 15) * 0.25);
        }
        if (mesh.position.z > -46 && !item.dropped) {
          item.dropped = true;
        }
        if (item.dropped && item.slabGroup) {
          item.slabGroup.position.y = THREE.MathUtils.lerp(item.slabGroup.position.y, 0.38, delta * 16);
          if (item.slabGroup.position.y < 0.95) {
            item.yMin = 0.0;
            item.yMax = 0.85; // Requires JUMP!
          }
        }
      }

      // Patrolling Drone horizontal oscillation
      if (mesh.userData.isPatroller) {
        const u = mesh.userData;
        mesh.position.x = u.originX + Math.sin(now * u.speed + u.offset) * u.patrolRange;
        mesh.position.x = Math.max(-3.2, Math.min(3.2, mesh.position.x));
      }

      // Sliding Barrier movement
      if (mesh.userData.isSliding) {
        const u = mesh.userData;
        mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, u.targetX, delta * u.slideSpeed);
      }

      // Drone vertical bobbing
      if (mesh.userData.isDrone) {
        mesh.rotation.y += delta * 2.8;
        mesh.position.y = Math.sin(now * 4 + mesh.position.x) * 0.15;
      }

      // Precise oriented Box3 calculation
      const mx = mesh.position.x;
      const mz = mesh.position.z;
      item.box.min.set(mx - item.halfWidth, item.yMin, mz - item.halfDepth);
      item.box.max.set(mx + item.halfWidth, item.yMax, mz + item.halfDepth);

      // Collision test against player Box3
      if (playerBox && item.box.intersectsBox(playerBox)) {
        collided = true;
      }

      // Dodged counter
      if (!item.passed && mesh.position.z > 0.5) {
        item.passed = true;
        this.dodgedCount++;
      }

      // Despawn past camera
      if (mesh.position.z > this.despawnZ) {
        this.scene.remove(mesh);
        this.obstacles.splice(i, 1);
      }
    }

    return collided;
  }

  /**
   * Dissolve / instantly clear all active obstacles.
   */
  clear() {
    this.obstacles.forEach(item => {
      this.scene.remove(item.mesh);
    });
    this.obstacles = [];
    this.timer = 0;
  }
}
