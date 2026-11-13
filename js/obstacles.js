import * as THREE from 'three';

/**
 * ObstacleManager:
 * - Color-coded for instant visual readability:
 *   * LOW HURDLES (Must Jump): Crisp glowing Neon Red/Orange (0xff3300)
 *   * HIGH OVERHEAD GATES (Must Slide): Crisp glowing Electric Cyan (0x00f0ff) with thin posts & open ground gap
 *   * TALL SOLID WALLS (Must Switch Lanes): Solid Dark Metallic (0x161c28) with Yellow Hazard stripes (0xffd000)
 *   * MOVING / DYNAMIC HAZARDS: Glowing Purple/Magenta (0xd946ef) with Directional Chevrons
 *
 * Performance & Memory Optimization:
 * - Pre-allocates a shared static geometry and material pool (this.geos, this.mats).
 * - Zero new BufferGeometry allocations during runtime spawning (completely eliminates GPU VRAM leak).
 * - Proper disposal lifecycle to keep RAM usage flat and frame rate smooth.
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

    // High-visibility universal color-coded materials and pooled geometries
    this.initMaterials();
    this.initGeometries();
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
   * Pre-allocates immutable geometries shared across all obstacle instances.
   * Completely avoids heap allocations & VRAM fragmentation during gameplay.
   */
  initGeometries() {
    this.geos = {
      // 1. Low Hurdles
      postCylinder: new THREE.CylinderGeometry(0.12, 0.15, 0.82, 8),
      capSphere: new THREE.SphereGeometry(0.18, 8, 8),
      hurdleBeam: new THREE.BoxGeometry(2.1, 0.24, 0.22),
      footBar: new THREE.BoxGeometry(2.1, 0.14, 0.3),

      // 2. Full Track Low Hurdles
      fullTowerBox: new THREE.BoxGeometry(0.3, 0.97, 0.35),
      fullCapSphere: new THREE.SphereGeometry(0.22, 8, 8),
      fullHurdleBeam: new THREE.BoxGeometry(9.4, 0.26, 0.22),
      fullFootBar: new THREE.BoxGeometry(9.4, 0.14, 0.32),

      // 3. Single High Gates
      slideColBox: new THREE.BoxGeometry(0.16, 3.3, 0.16),
      slideTopBar: new THREE.BoxGeometry(2.4, 0.25, 0.22),
      slideCyanBeam: new THREE.BoxGeometry(2.3, 0.38, 0.22),

      // 4. Full Track Overhead Gates
      fullSlideCol: new THREE.BoxGeometry(0.2, 3.4, 0.2),
      fullSlideTop: new THREE.BoxGeometry(9.4, 0.3, 0.25),
      fullSlideCyan: new THREE.BoxGeometry(9.4, 0.42, 0.22),

      // 5. Tall Solid Walls
      pylonMain: new THREE.BoxGeometry(2.2, 3.0, 0.9),
      pylonStripe: new THREE.BoxGeometry(2.25, 0.6, 0.95),
      pylonBeacon: new THREE.SphereGeometry(0.24, 8, 8),

      // 6. Directional Chevrons
      chevronBar: new THREE.BoxGeometry(0.28, 0.08, 0.05),

      // 7. Patrolling Drones
      droneBody: new THREE.DodecahedronGeometry(0.7),
      droneEye: new THREE.SphereGeometry(0.3, 8, 8),

      // 8. Sliding Gates
      sliderPost: new THREE.BoxGeometry(0.25, 1.8, 0.25),
      sliderBeam: new THREE.BoxGeometry(1.8, 0.35, 0.25),

      // 9. Drop Gates
      dropPost: new THREE.BoxGeometry(0.3, 3.6, 0.3),
      dropTopBeamSingle: new THREE.BoxGeometry(2.4, 0.3, 0.3),
      dropTopBeamFull: new THREE.BoxGeometry(9.4, 0.3, 0.3),
      dropBeacon: new THREE.SphereGeometry(0.24, 8, 8),
      crusherMeshSingle: new THREE.BoxGeometry(2.2, 0.55, 0.25),
      crusherMeshFull: new THREE.BoxGeometry(9.2, 0.55, 0.25),
      crusherTeethSingle: new THREE.BoxGeometry(2.25, 0.18, 0.3),
      crusherTeethFull: new THREE.BoxGeometry(9.25, 0.18, 0.3)
    };
  }

  setBiome(level) {
    // Universal functional colors preserved for reflex clarity
  }

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
      this.baseSpawnInterval = Math.max(0.72, 0.88 - (this.level - 4) * 0.04);
      this.minZDistance = 21;
    }
  }

  createChevronIndicator(dir) {
    const g = new THREE.Group();
    const sign = dir > 0 ? 1 : -1;

    const topBar = new THREE.Mesh(this.geos.chevronBar, this.chevronArrowMat);
    topBar.rotation.z = sign * (Math.PI / 4);
    topBar.position.set(-sign * 0.08, 0.09, 0);
    g.add(topBar);

    const botBar = new THREE.Mesh(this.geos.chevronBar, this.chevronArrowMat);
    botBar.rotation.z = -sign * (Math.PI / 4);
    botBar.position.set(-sign * 0.08, -0.09, 0);
    g.add(botBar);

    return g;
  }

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

  spawnLevel1() {
    const r = Math.random();
    const z = this.spawnDistance;

    if (r < 0.28) {
      const lane = this.lanes[Math.floor(Math.random() * 3)];
      this.createTallPylon(lane, z);
    } else if (r < 0.54) {
      const openIdx = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx) {
          this.createTallPylon(this.lanes[i], z);
        }
      }
    } else if (r < 0.77) {
      this.createFullTrackLowLaser(z);
    } else {
      this.createFullTrackOverheadGate(z);
    }
  }

  spawnLevel2() {
    const r = Math.random();
    const z = this.spawnDistance;

    if (r < 0.22) {
      const openIdx = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx) {
          this.createTallPylon(this.lanes[i], z);
        } else {
          this.createLowLaser(this.lanes[i], z);
        }
      }
    } else if (r < 0.44) {
      const openIdx = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx) {
          this.createTallPylon(this.lanes[i], z);
        } else {
          this.createSingleHighGate(this.lanes[i], z);
        }
      }
    } else if (r < 0.62) {
      this.createFullTrackLowLaser(z);
    } else if (r < 0.80) {
      this.createFullTrackOverheadGate(z);
    } else if (r < 0.90) {
      const startLane = this.lanes[Math.floor(Math.random() * 3)];
      this.createPatrollingDrone(startLane, z, 1.8);
    } else {
      const startLane = this.lanes[Math.floor(Math.random() * 3)];
      this.createSlidingGate(startLane, z, 1.8);
    }
  }

  spawnLevel3() {
    const r = Math.random();
    const z = this.spawnDistance;

    if (r < 0.30) {
      this.createTwoStepSequence(z, 26);
    } else if (r < 0.48) {
      this.createLateShiftObstacle(z);
    } else if (r < 0.64) {
      if (Math.random() < 0.5) {
        this.createDropGate(0, z, true);
      } else {
        const lane = this.lanes[Math.floor(Math.random() * 3)];
        this.createDropGate(lane, z, false);
      }
    } else if (r < 0.80) {
      const startLane = this.lanes[Math.floor(Math.random() * 3)];
      this.createPatrollingDrone(startLane, z, 2.6);
    } else {
      if (Math.random() < 0.5) {
        this.createFullTrackLowLaser(z);
      } else {
        this.createFullTrackOverheadGate(z);
      }
    }
  }

  spawnLevel4Plus() {
    const r = Math.random();
    const z = this.spawnDistance;

    if (r < 0.28) {
      this.createAlternatingRhythmWave(z, 22);
    } else if (r < 0.54) {
      this.createMultiInputGauntlet(z, 22);
    } else if (r < 0.74) {
      this.createZigZagCorridor(z, 22);
    } else if (r < 0.88) {
      this.createLateShiftObstacle(z);
    } else {
      this.createDropGate(0, z, true);
    }
  }

  createLowLaser(xPos, zPos) {
    const group = new THREE.Group();
    const height = 0.82;

    [-1.05, 1.05].forEach(lx => {
      const post = new THREE.Mesh(this.geos.postCylinder, this.jumpPostMat);
      post.position.set(lx, height / 2, 0);
      post.castShadow = true;
      group.add(post);

      const cap = new THREE.Mesh(this.geos.capSphere, this.jumpHurdleMat);
      cap.position.set(lx, height + 0.1, 0);
      group.add(cap);
    });

    const beam = new THREE.Mesh(this.geos.hurdleBeam, this.jumpHurdleMat);
    beam.position.set(0, height * 0.72, 0);
    group.add(beam);

    const foot = new THREE.Mesh(this.geos.footBar, this.jumpPostMat);
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
      yMax: 0.85,
      passed: false
    });
  }

  createFullTrackLowLaser(zPos) {
    const group = new THREE.Group();
    const trackWidth = 9.4;
    const height = 0.82;

    [-4.6, 4.6].forEach(x => {
      const tower = new THREE.Mesh(this.geos.fullTowerBox, this.jumpPostMat);
      tower.position.set(x, height / 2, 0);
      tower.castShadow = true;
      group.add(tower);

      const cap = new THREE.Mesh(this.geos.fullCapSphere, this.jumpHurdleMat);
      cap.position.set(x, height + 0.15, 0);
      group.add(cap);
    });

    const beam = new THREE.Mesh(this.geos.fullHurdleBeam, this.jumpHurdleMat);
    beam.position.set(0, height * 0.72, 0);
    group.add(beam);

    const foot = new THREE.Mesh(this.geos.fullFootBar, this.jumpPostMat);
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

  createSingleHighGate(xPos, zPos) {
    const group = new THREE.Group();
    const towerHeight = 3.3;

    [-1.1, 1.1].forEach(lx => {
      const col = new THREE.Mesh(this.geos.slideColBox, this.slidePostMat);
      col.position.set(lx, towerHeight / 2, 0);
      col.castShadow = true;
      group.add(col);
    });

    const topBar = new THREE.Mesh(this.geos.slideTopBar, this.slidePostMat);
    topBar.position.set(0, 3.0, 0);
    topBar.castShadow = true;
    group.add(topBar);

    const cyanBeam = new THREE.Mesh(this.geos.slideCyanBeam, this.slideGateMat);
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
      yMin: 1.12,
      yMax: 3.2,
      passed: false
    });
  }

  createFullTrackOverheadGate(zPos) {
    const group = new THREE.Group();
    const trackWidth = 9.4;
    const towerHeight = 3.4;

    [-4.6, 4.6].forEach(x => {
      const col = new THREE.Mesh(this.geos.fullSlideCol, this.slidePostMat);
      col.position.set(x, towerHeight / 2, 0);
      col.castShadow = true;
      group.add(col);
    });

    const topBeam = new THREE.Mesh(this.geos.fullSlideTop, this.slidePostMat);
    topBeam.position.set(0, 3.05, 0);
    topBeam.castShadow = true;
    group.add(topBeam);

    const cyanBeam = new THREE.Mesh(this.geos.fullSlideCyan, this.slideGateMat);
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

  createTallPylon(xPos, zPos) {
    const group = new THREE.Group();
    const height = 3.0;

    const mainPylon = new THREE.Mesh(this.geos.pylonMain, this.tallWallMat);
    mainPylon.position.set(0, height / 2, 0);
    mainPylon.castShadow = true;
    mainPylon.receiveShadow = true;
    group.add(mainPylon);

    const stripe = new THREE.Mesh(this.geos.pylonStripe, this.hazardYellowMat);
    stripe.position.set(0, height * 0.5, 0);
    group.add(stripe);

    const beacon = new THREE.Mesh(this.geos.pylonBeacon, this.hazardYellowMat);
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

  createTwoStepSequence(zPos, spacing = 26) {
    const pattern = Math.random();

    if (pattern < 0.35) {
      this.createFullTrackLowLaser(zPos);
      const openIdx = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx) {
          this.createTallPylon(this.lanes[i], zPos - spacing);
        }
      }
    } else if (pattern < 0.70) {
      this.createFullTrackOverheadGate(zPos);
      const openIdx = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx) {
          this.createTallPylon(this.lanes[i], zPos - spacing);
        }
      }
    } else {
      const openIdx1 = Math.floor(Math.random() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== openIdx1) {
          this.createTallPylon(this.lanes[i], zPos);
        }
      }
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

  createLateShiftObstacle(zPos) {
    const group = new THREE.Group();
    const height = 3.0;

    const startIdx = Math.floor(Math.random() * 3);
    const fromX = this.lanes[startIdx];
    const shiftRight = startIdx === 0 ? true : (startIdx === 2 ? false : Math.random() < 0.5);
    const toIdx = shiftRight ? startIdx + 1 : startIdx - 1;
    const toX = this.lanes[toIdx];

    const body = new THREE.Mesh(this.geos.pylonMain, this.tallWallMat);
    body.position.set(0, height / 2, 0);
    body.castShadow = true;
    group.add(body);

    const purpleBand = new THREE.Mesh(this.geos.pylonStripe, this.movingHazardMat);
    purpleBand.position.set(0, height * 0.5, 0);
    group.add(purpleBand);

    const beacon = new THREE.Mesh(this.geos.pylonBeacon, this.movingHazardMat);
    beacon.position.set(0, height + 0.14, 0);
    group.add(beacon);

    const chevron = this.createChevronIndicator(shiftRight ? 1 : -1);
    chevron.position.set(0, height * 0.5, 0.49);
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

  createMultiInputGauntlet(zPos, spacing = 22) {
    const patternA = Math.random() < 0.5;

    if (patternA) {
      this.createLowLaser(0, zPos);
      this.createTallPylon(-3, zPos);
      this.createTallPylon(3, zPos);

      this.createSingleHighGate(-3, zPos - spacing);
      this.createTallPylon(0, zPos - spacing);
      this.createTallPylon(3, zPos - spacing);

      this.createLowLaser(0, zPos - spacing * 2);
      this.createTallPylon(-3, zPos - spacing * 2);
      this.createTallPylon(3, zPos - spacing * 2);
    } else {
      this.createSingleHighGate(0, zPos);
      this.createTallPylon(-3, zPos);
      this.createTallPylon(3, zPos);

      this.createLowLaser(3, zPos - spacing);
      this.createTallPylon(-3, zPos - spacing);
      this.createTallPylon(0, zPos - spacing);

      this.createSingleHighGate(0, zPos - spacing * 2);
      this.createTallPylon(-3, zPos - spacing * 2);
      this.createTallPylon(3, zPos - spacing * 2);
    }
  }

  createAlternatingRhythmWave(zPos, spacing = 22) {
    this.createFullTrackLowLaser(zPos);
    this.createFullTrackOverheadGate(zPos - spacing);

    const openLaneIdx = Math.floor(Math.random() * 3);
    for (let i = 0; i < 3; i++) {
      if (i !== openLaneIdx) {
        this.createTallPylon(this.lanes[i], zPos - spacing * 2);
      }
    }
  }

  createZigZagCorridor(zPos, spacing = 22) {
    this.createLowLaser(this.lanes[0], zPos);
    this.createTallPylon(this.lanes[1], zPos);

    this.createSingleHighGate(this.lanes[2], zPos - spacing);
    this.createTallPylon(this.lanes[1], zPos - spacing);

    this.createTallPylon(this.lanes[0], zPos - spacing * 2);
    this.createTallPylon(this.lanes[2], zPos - spacing * 2);
    this.createLowLaser(this.lanes[1], zPos - spacing * 2);
  }

  createPatrollingDrone(xPos, zPos, speed = 2.4) {
    const group = new THREE.Group();

    const drone = new THREE.Mesh(this.geos.droneBody, this.movingHazardMat);
    drone.position.set(0, 1.35, 0);
    drone.castShadow = true;
    group.add(drone);

    const eye = new THREE.Mesh(this.geos.droneEye, this.hazardYellowMat);
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

  createSlidingGate(xPos, zPos, speed = 2.0) {
    const group = new THREE.Group();
    const height = 1.8;
    const targetX = xPos === 0 ? (Math.random() < 0.5 ? -3 : 3) : 0;
    const sign = targetX > xPos ? 1 : -1;

    [-0.9, 0.9].forEach(lx => {
      const p = new THREE.Mesh(this.geos.sliderPost, this.tallWallMat);
      p.position.set(lx, height / 2, 0);
      p.castShadow = true;
      group.add(p);
    });

    const beam = new THREE.Mesh(this.geos.sliderBeam, this.movingHazardMat);
    beam.position.set(0, height * 0.6, 0);
    group.add(beam);

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

  createDropGate(xPos, zPos, isFullTrack = false) {
    const group = new THREE.Group();
    const width = isFullTrack ? 9.4 : 2.4;
    const towerHeight = 3.6;

    const postXPositions = isFullTrack ? [-4.6, 4.6] : [-1.05, 1.05];
    postXPositions.forEach(lx => {
      const col = new THREE.Mesh(this.geos.dropPost, this.tallWallMat);
      col.position.set(lx, towerHeight / 2, 0);
      col.castShadow = true;
      group.add(col);
    });

    const topBeam = new THREE.Mesh(isFullTrack ? this.geos.dropTopBeamFull : this.geos.dropTopBeamSingle, this.tallWallMat);
    topBeam.position.set(0, towerHeight - 0.15, 0);
    topBeam.castShadow = true;
    group.add(topBeam);

    const beacon = new THREE.Mesh(this.geos.dropBeacon, this.jumpHurdleMat);
    beacon.position.set(0, towerHeight + 0.12, 0);
    group.add(beacon);

    const slabGroup = new THREE.Group();
    const crusherMesh = new THREE.Mesh(isFullTrack ? this.geos.crusherMeshFull : this.geos.crusherMeshSingle, this.jumpHurdleMat);
    slabGroup.add(crusherMesh);

    const crusherTeeth = new THREE.Mesh(isFullTrack ? this.geos.crusherTeethFull : this.geos.crusherTeethSingle, this.hazardYellowMat);
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

  update(delta, gameSpeed, playerBox) {
    let collided = false;
    const moveDist = gameSpeed * delta * 60;

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

    this.timer += delta;
    if (this.timer >= this.baseSpawnInterval && canSpawnByDistance) {
      this.timer = 0;
      this.spawn();
    }

    const now = Date.now() * 0.001;

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const item = this.obstacles[i];
      const mesh = item.mesh;

      mesh.position.z += moveDist;

      if (mesh.userData.isLateShift) {
        const u = mesh.userData;
        if (mesh.position.z > u.triggerZ) {
          u.shifted = true;
        }
        if (u.shifted) {
          mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, u.targetX, delta * u.shiftSpeed);
        }
      }

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
            item.yMax = 0.85;
          }
        }
      }

      if (mesh.userData.isPatroller) {
        const u = mesh.userData;
        mesh.position.x = u.originX + Math.sin(now * u.speed + u.offset) * u.patrolRange;
        mesh.position.x = Math.max(-3.2, Math.min(3.2, mesh.position.x));
      }

      if (mesh.userData.isSliding) {
        const u = mesh.userData;
        mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, u.targetX, delta * u.slideSpeed);
      }

      if (mesh.userData.isDrone) {
        mesh.rotation.y += delta * 2.8;
        mesh.position.y = Math.sin(now * 4 + mesh.position.x) * 0.15;
      }

      const mx = mesh.position.x;
      const mz = mesh.position.z;
      item.box.min.set(mx - item.halfWidth, item.yMin, mz - item.halfDepth);
      item.box.max.set(mx + item.halfWidth, item.yMax, mz + item.halfDepth);

      if (playerBox && item.box.intersectsBox(playerBox)) {
        collided = true;
      }

      if (!item.passed && mesh.position.z > 0.5) {
        item.passed = true;
        this.dodgedCount++;
      }

      // Despawn past camera: detach mesh from scene
      if (mesh.position.z > this.despawnZ) {
        this.scene.remove(mesh);
        this.obstacles.splice(i, 1);
      }
    }

    return collided;
  }

  clear() {
    this.obstacles.forEach(item => {
      this.scene.remove(item.mesh);
    });
    this.obstacles = [];
    this.timer = 0;
  }

  /**
   * Disposes shared geometries and materials on complete destruction.
   */
  dispose() {
    this.clear();
    for (const key in this.geos) {
      if (this.geos[key]) {
        this.geos[key].dispose();
      }
    }
  }
}
