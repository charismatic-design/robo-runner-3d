import * as THREE from 'three';

/**
 * Distinct World Biomes per Level
 */
export const BIOMES = {
  1: {
    id: 1,
    name: 'Cyber Toy-Lab',
    code: 'STAGE 01',
    desc: 'CALIBRATION TRACK // 3-LANE TEST INITIATED',
    bg: 0x0c1424,
    fog: 0x0c1424,
    fogNear: 85,
    fogFar: 145,
    hemiSky: 0x70d6ff,
    hemiGround: 0x182030,
    dirLight: 0xfff5e6,
    rim: 0x00f0ff,
    divider: 0x00f0ff,
    rails: 0xffd000,
    pylonCap: 0x00f0ff,
    archNeon: 0xffd000,
    laneColor: 0x182030,
    centerLaneColor: 0x202b3e,
    targetFOV: 60,
    particleMode: 'NONE'
  },
  2: {
    id: 2,
    name: 'Reactor Overdrive',
    code: 'STAGE 02',
    desc: 'DOUBLE-STACK COMBOS & MOVING DRONES ACTIVE',
    bg: 0x140a04,
    fog: 0x140a04,
    fogNear: 85,
    fogFar: 145,
    hemiSky: 0xff9900,
    hemiGround: 0x260d00,
    dirLight: 0xffe0b2,
    rim: 0xff5500,
    divider: 0xff6600,
    rails: 0xffaa00,
    pylonCap: 0xff3300,
    archNeon: 0xff7700,
    laneColor: 0x20120b,
    centerLaneColor: 0x2e1910,
    targetFOV: 60,
    particleMode: 'NONE'
  },
  3: {
    id: 3,
    name: 'Bio-Hazard Acid Sector',
    code: 'STAGE 03',
    desc: 'LATE-SHIFT WALLS & RHYTHM WAVES ACTIVE',
    bg: 0x04120a,
    fog: 0x04120a,
    fogNear: 85,
    fogFar: 145,
    hemiSky: 0x4ade80,
    hemiGround: 0x052e16,
    dirLight: 0xe8f5e9,
    rim: 0x22c55e,
    divider: 0x10b981,
    rails: 0x84cc16,
    pylonCap: 0x22c55e,
    archNeon: 0x10b981,
    laneColor: 0x0d1a12,
    centerLaneColor: 0x132419,
    targetFOV: 62,
    particleMode: 'NONE'
  },
  4: {
    id: 4,
    name: 'Crimson Security Lockdown',
    code: 'STAGE 04',
    desc: 'HIGH-SPEED ZIG-ZAG CORRIDORS ACTIVE',
    bg: 0x080103,
    fog: 0x080103,
    fogNear: 85,
    fogFar: 145,
    hemiSky: 0xff3355,
    hemiGround: 0x280005,
    dirLight: 0xffebee,
    rim: 0xff0033,
    divider: 0xff0033,
    rails: 0xff1744,
    pylonCap: 0xff0033,
    archNeon: 0xff1744,
    laneColor: 0x180608,
    centerLaneColor: 0x24080c,
    targetFOV: 64,
    particleMode: 'NONE'
  },
  5: {
    id: 5,
    name: 'Quantum Glitch Void',
    code: 'STAGE 05',
    desc: 'COMPLEX 4-STEP GAUNTLETS ACTIVE',
    bg: 0x0d031c,
    fog: 0x0d031c,
    fogNear: 85,
    fogFar: 145,
    hemiSky: 0xc084fc,
    hemiGround: 0x1e0838,
    dirLight: 0xf3e8ff,
    rim: 0xfbbf24,
    divider: 0xd946ef,
    rails: 0xf59e0b,
    pylonCap: 0xfbbf24,
    archNeon: 0xd946ef,
    laneColor: 0x1a0a2e,
    centerLaneColor: 0x261042,
    targetFOV: 65,
    particleMode: 'NONE'
  }
};

export const LEVEL_THEMES = BIOMES;

/**
 * Environment class handles distinct world biomes, dynamic props,
 * camera FOV transitions, particle systems (embers, acid rain, starlines),
 * and explosive warp transitions.
 */
export class Environment {
  constructor(container) {
    this.container = container;

    // 1. Scene & Atmosphere Setup
    this.scene = new THREE.Scene();
    this.currentLevel = 1;
    const initialBiome = BIOMES[1];

    this.bgColor = new THREE.Color(initialBiome.bg);
    this.scene.background = this.bgColor;
    this.scene.fog = new THREE.Fog(initialBiome.fog, initialBiome.fogNear, initialBiome.fogFar);

    // Target colors for smooth lerping
    this.targetBg = new THREE.Color(initialBiome.bg);
    this.targetFog = new THREE.Color(initialBiome.fog);
    this.targetHemiSky = new THREE.Color(initialBiome.hemiSky);
    this.targetHemiGround = new THREE.Color(initialBiome.hemiGround);
    this.targetDirLight = new THREE.Color(initialBiome.dirLight);
    this.targetRim = new THREE.Color(initialBiome.rim);
    this.targetDivider = new THREE.Color(initialBiome.divider);
    this.targetRails = new THREE.Color(initialBiome.rails);
    this.targetPylonCap = new THREE.Color(initialBiome.pylonCap);
    this.targetArchNeon = new THREE.Color(initialBiome.archNeon);
    this.targetLaneColor = new THREE.Color(initialBiome.laneColor);
    this.targetCenterLaneColor = new THREE.Color(initialBiome.centerLaneColor);

    // 2. Camera Setup & Dynamic FOV
    const aspect = window.innerWidth / window.innerHeight;
    this.targetFOV = initialBiome.targetFOV;
    this.camera = new THREE.PerspectiveCamera(this.targetFOV, aspect, 0.1, 220);
    this.defaultCamPos = new THREE.Vector3(0, 5, 10);
    this.defaultLookAt = new THREE.Vector3(0, 1.5, -4);
    this.camera.position.copy(this.defaultCamPos);
    this.currentLookAt = this.defaultLookAt.clone();
    this.targetCamPos = this.defaultCamPos.clone();
    this.targetLookAt = this.defaultLookAt.clone();
    this.cameraMode = 'DEFAULT'; // 'DEFAULT', 'HERO_DANCE', 'DEATH_ZOOM'

    // Camera Shake Parameters
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeTimer = 0;

    // 3. Renderer Setup (Disabled antialias & capped at 1.5x pixel ratio for maximum FPS on high-DPI screens)
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.container.appendChild(this.renderer.domElement);

    // 4. Track Parameters
    this.lanes = [-3, 0, 3];
    this.trackLength = 160;
    this.scrollingObjects = [];
    this.rotatingBeacons = [];
    this.quantumDebris = [];

    // 5. Initialize Lighting, Track, Props & Particles
    this.setupLighting(initialBiome);
    this.buildTrack(initialBiome);
    this.buildDecorations(initialBiome);
    this.initParticleSystems();
    this.initBiomeParticles(initialBiome.particleMode);
  }

  setupLighting(biome) {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(biome.hemiSky, biome.hemiGround, 0.65);
    this.hemiLight.position.set(0, 30, 0);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(biome.dirLight, 1.4);
    this.dirLight.position.set(12, 22, 10);
    this.dirLight.castShadow = true;
    // Capped shadow map at 1024x1024 with tight bounds to slash GPU VRAM and overdraw
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 1.0;
    this.dirLight.shadow.camera.far = 70;
    this.dirLight.shadow.camera.left = -10;
    this.dirLight.shadow.camera.right = 10;
    this.dirLight.shadow.camera.top = 15;
    this.dirLight.shadow.camera.bottom = -10;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    this.rimLight = new THREE.DirectionalLight(biome.rim, 0.85);
    this.rimLight.position.set(-10, 10, -25);
    this.scene.add(this.rimLight);

    // Hero Spotlight for Level-Clear Victory Dance
    this.heroSpotlight = new THREE.SpotLight(0xfff8d0, 0, 30, Math.PI / 4, 0.35, 1.0);
    this.heroSpotlight.position.set(0, 6.5, 3.5);
    this.heroSpotlight.target.position.set(0, 1.2, 0);
    this.scene.add(this.heroSpotlight);
    this.scene.add(this.heroSpotlight.target);
  }

  buildTrack(biome) {
    const laneWidth = 2.6;
    const laneThickness = 0.4;
    const laneLength = this.trackLength;

    // Sub-floor
    const baseGeo = new THREE.BoxGeometry(11, 0.4, laneLength);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x060910,
      roughness: 0.9,
      metalness: 0.1
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.set(0, -laneThickness - 0.2, -laneLength / 2 + 10);
    baseMesh.receiveShadow = true;
    this.scene.add(baseMesh);

    // Outer Lanes Material
    this.outerLaneMat = new THREE.MeshStandardMaterial({
      color: biome.laneColor,
      roughness: 0.45,
      metalness: 0.35
    });

    // Center Lane Material
    this.centerLaneMat = new THREE.MeshStandardMaterial({
      color: biome.centerLaneColor,
      roughness: 0.4,
      metalness: 0.4
    });

    [-3, 0, 3].forEach(x => {
      const laneGeo = new THREE.BoxGeometry(laneWidth, laneThickness, laneLength);
      const laneMat = x === 0 ? this.centerLaneMat : this.outerLaneMat;
      const laneMesh = new THREE.Mesh(laneGeo, laneMat);
      laneMesh.position.set(x, -laneThickness / 2, -laneLength / 2 + 10);
      laneMesh.receiveShadow = true;
      this.scene.add(laneMesh);
    });

    // Glowing Divider Stripes / Slime Troughs
    this.dividerMat = new THREE.MeshStandardMaterial({
      color: biome.divider,
      emissive: biome.divider,
      emissiveIntensity: 0.85,
      roughness: 0.2
    });

    [-1.5, 1.5].forEach(x => {
      const dividerGeo = new THREE.BoxGeometry(0.14, 0.06, laneLength);
      const dividerMesh = new THREE.Mesh(dividerGeo, this.dividerMat);
      dividerMesh.position.set(x, 0.02, -laneLength / 2 + 10);
      this.scene.add(dividerMesh);
    });

    // Glowing Guardrails / Laser Cage Rails
    this.railMat = new THREE.MeshStandardMaterial({
      color: biome.rails,
      emissive: biome.rails,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.8
    });

    [-4.6, 4.6].forEach(x => {
      const railGeo = new THREE.BoxGeometry(0.32, 0.48, laneLength);
      const railMesh = new THREE.Mesh(railGeo, this.railMat);
      railMesh.position.set(x, 0.16, -laneLength / 2 + 10);
      railMesh.castShadow = true;
      railMesh.receiveShadow = true;
      this.scene.add(railMesh);
    });

    // Scrolling Floor Chevrons
    this.chevronGroup = new THREE.Group();
    const chevronGeo = new THREE.PlaneGeometry(0.8, 1.2);
    const chevronMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.25,
      depthWrite: false
    });

    const step = 8;
    for (let z = 15; z > -laneLength + 15; z -= step) {
      for (const lx of this.lanes) {
        const marker = new THREE.Mesh(chevronGeo, chevronMat);
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(lx, 0.015, z);
        this.chevronGroup.add(marker);
      }
    }
    this.scene.add(this.chevronGroup);
  }

  buildDecorations(biome) {
    this.decorGroup = new THREE.Group();
    this.scene.add(this.decorGroup);

    const pylonGeo = new THREE.BoxGeometry(0.4, 3.5, 0.4);
    const pylonBodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a2130,
      roughness: 0.5,
      metalness: 0.8
    });

    this.pylonCapMat = new THREE.MeshStandardMaterial({
      color: biome.pylonCap,
      emissive: biome.pylonCap,
      emissiveIntensity: 1.4
    });

    const lightCapGeo = new THREE.SphereGeometry(0.28, 8, 8);
    const pylonSpacing = 16;
    const totalPylons = 12;

    // Shared beacon cone geometry & material across all 24 pylons
    const beaconConeGeo = new THREE.ConeGeometry(0.8, 3.5, 8);
    beaconConeGeo.rotateX(Math.PI / 2);
    beaconConeGeo.translate(0, 0, 1.75);
    const beaconConeMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    for (let i = 0; i < totalPylons; i++) {
      const z = -i * pylonSpacing + 10;
      [-5.8, 5.8].forEach(x => {
        const pylon = new THREE.Group();
        const body = new THREE.Mesh(pylonGeo, pylonBodyMat);
        body.position.y = 1.75;
        body.castShadow = true;
        pylon.add(body);

        const cap = new THREE.Mesh(lightCapGeo, this.pylonCapMat);
        cap.position.y = 3.6;
        pylon.add(cap);

        // Rotating Amber Warning Beacon Beam (Level 2 Reactor Overdrive)
        const beaconCone = new THREE.Mesh(beaconConeGeo, beaconConeMat);
        beaconCone.position.set(0, 3.6, 0);
        pylon.add(beaconCone);
        this.rotatingBeacons.push(beaconCone);

        pylon.position.set(x, 0, z);
        this.decorGroup.add(pylon);
        this.scrollingObjects.push(pylon);
      });
    }

    // Overhead Sci-Fi Testing Arches (Shared geometries & frame material)
    this.archNeonMat = new THREE.MeshStandardMaterial({
      color: biome.archNeon,
      emissive: biome.archNeon,
      emissiveIntensity: 1.1
    });

    this.archFrameMat = new THREE.MeshStandardMaterial({
      color: 0x242e40,
      roughness: 0.4,
      metalness: 0.7
    });

    this.archColGeo = new THREE.BoxGeometry(0.5, 6, 0.5);
    this.archTopGeo = new THREE.BoxGeometry(12.5, 0.5, 0.5);
    this.archNeonGeo = new THREE.BoxGeometry(11, 0.15, 0.2);

    const archSpacing = 48;
    const totalArches = 4;
    for (let i = 0; i < totalArches; i++) {
      const z = -i * archSpacing - 10;
      const arch = this.createLabArch();
      arch.position.set(0, 0, z);
      this.decorGroup.add(arch);
      this.scrollingObjects.push(arch);
    }

    // Floating Quantum Debris / Asteroids for Level 5+
    this.quantumDebrisGroup = new THREE.Group();
    this.scene.add(this.quantumDebrisGroup);

    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x9333ea,
      emissive: 0xd946ef,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.9,
      wireframe: false
    });

    for (let i = 0; i < 18; i++) {
      const geo = i % 2 === 0 ? new THREE.OctahedronGeometry(1.2 + Math.random() * 1.5) : new THREE.IcosahedronGeometry(1.0 + Math.random());
      const mesh = new THREE.Mesh(geo, debrisMat);
      mesh.position.set(
        (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 14),
        3 + Math.random() * 14,
        -Math.random() * 160
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      mesh.userData = {
        rotX: (Math.random() - 0.5) * 1.5,
        rotY: (Math.random() - 0.5) * 1.5
      };
      this.quantumDebrisGroup.add(mesh);
      this.quantumDebris.push(mesh);
    }
    this.quantumDebrisGroup.visible = false;
  }

  createLabArch() {
    const archGroup = new THREE.Group();

    const leftCol = new THREE.Mesh(this.archColGeo, this.archFrameMat);
    leftCol.position.set(-6, 3, 0);
    leftCol.castShadow = true;
    archGroup.add(leftCol);

    const rightCol = new THREE.Mesh(this.archColGeo, this.archFrameMat);
    rightCol.position.set(6, 3, 0);
    rightCol.castShadow = true;
    archGroup.add(rightCol);

    const topBeam = new THREE.Mesh(this.archTopGeo, this.archFrameMat);
    topBeam.position.set(0, 6, 0);
    topBeam.castShadow = true;
    archGroup.add(topBeam);

    const neonStrip = new THREE.Mesh(this.archNeonGeo, this.archNeonMat);
    neonStrip.position.set(0, 5.7, 0);
    archGroup.add(neonStrip);

    return archGroup;
  }

  /**
   * Initializes Impact Sparks & Victory Confetti systems.
   */
  initParticleSystems() {
    // 1. Impact Spark Particles
    this.maxSparks = 70;
    const sparkPositions = new Float32Array(this.maxSparks * 3);
    const sparkColors = new Float32Array(this.maxSparks * 3);
    this.sparkVelocities = [];

    const sparkPalette = [new THREE.Color(0xffffff), new THREE.Color(0xffd000), new THREE.Color(0xff3366), new THREE.Color(0x00f0ff)];

    for (let i = 0; i < this.maxSparks; i++) {
      sparkPositions[i * 3] = 0;
      sparkPositions[i * 3 + 1] = -100;
      sparkPositions[i * 3 + 2] = 0;

      const col = sparkPalette[Math.floor(Math.random() * sparkPalette.length)];
      sparkColors[i * 3] = col.r;
      sparkColors[i * 3 + 1] = col.g;
      sparkColors[i * 3 + 2] = col.b;

      this.sparkVelocities.push({ x: 0, y: 0, z: 0, life: 0, maxLife: 1 });
    }

    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));

    this.sparkMat = new THREE.PointsMaterial({
      size: 0.35,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.sparkPoints = new THREE.Points(this.sparkGeo, this.sparkMat);
    this.scene.add(this.sparkPoints);

    // 2. Victory Confetti Particles
    this.maxConfetti = 120;
    const confettiPositions = new Float32Array(this.maxConfetti * 3);
    const confettiColors = new Float32Array(this.maxConfetti * 3);
    this.confettiData = [];

    const confettiPalette = [new THREE.Color(0xffd000), new THREE.Color(0x00f0ff), new THREE.Color(0xff2a85), new THREE.Color(0x22c55e), new THREE.Color(0xffffff)];

    for (let i = 0; i < this.maxConfetti; i++) {
      confettiPositions[i * 3] = (Math.random() - 0.5) * 12;
      confettiPositions[i * 3 + 1] = -100;
      confettiPositions[i * 3 + 2] = (Math.random() - 0.5) * 12;

      const col = confettiPalette[Math.floor(Math.random() * confettiPalette.length)];
      confettiColors[i * 3] = col.r;
      confettiColors[i * 3 + 1] = col.g;
      confettiColors[i * 3 + 2] = col.b;

      this.confettiData.push({
        baseX: (Math.random() - 0.5) * 10,
        speedY: 1.5 + Math.random() * 2.5,
        freq: 2 + Math.random() * 4,
        phase: Math.random() * Math.PI * 2
      });
    }

    this.confettiGeo = new THREE.BufferGeometry();
    this.confettiGeo.setAttribute('position', new THREE.BufferAttribute(confettiPositions, 3));
    this.confettiGeo.setAttribute('color', new THREE.BufferAttribute(confettiColors, 3));

    this.confettiMat = new THREE.PointsMaterial({
      size: 0.28,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.confettiPoints = new THREE.Points(this.confettiGeo, this.confettiMat);
    this.scene.add(this.confettiPoints);
    this.isVictoryActive = false;
  }

  /**
   * Air above the track is kept 100% clean and clear of particles.
   */
  initBiomeParticles(initialMode) {
    this.particleMode = 'NONE';
    this.maxBiomeParticles = 0;
    this.biomeParticleGeo = new THREE.BufferGeometry();
    this.biomeParticleMat = new THREE.PointsMaterial({ opacity: 0, transparent: true });
    this.biomeParticlePoints = new THREE.Points(this.biomeParticleGeo, this.biomeParticleMat);
    this.biomeParticlePoints.visible = false;
  }

  triggerImpactSparks(position) {
    const posAttr = this.sparkGeo.attributes.position;
    this.sparkMat.opacity = 1;

    for (let i = 0; i < this.maxSparks; i++) {
      posAttr.setXYZ(i, position.x, position.y + 0.9, position.z);

      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.3) * Math.PI;
      const speed = 7 + Math.random() * 15;

      this.sparkVelocities[i] = {
        x: Math.cos(angle) * Math.cos(elevation) * speed,
        y: Math.sin(elevation) * speed + 3,
        z: Math.sin(angle) * Math.cos(elevation) * speed,
        life: 0.8 + Math.random() * 0.6,
        maxLife: 1.4
      };
    }
    posAttr.needsUpdate = true;
  }

  triggerSlideSparks(position) {
    const posAttr = this.sparkGeo.attributes.position;
    this.sparkMat.opacity = Math.max(this.sparkMat.opacity, 0.85);

    for (let count = 0; count < 3; count++) {
      const i = Math.floor(Math.random() * this.maxSparks);
      posAttr.setXYZ(
        i,
        position.x + (Math.random() - 0.5) * 0.45,
        0.05 + Math.random() * 0.08,
        position.z + 0.15 + Math.random() * 0.2
      );

      this.sparkVelocities[i] = {
        x: (Math.random() - 0.5) * 3,
        y: 1.2 + Math.random() * 2.5,
        z: 3 + Math.random() * 5,
        life: 0.18 + Math.random() * 0.15,
        maxLife: 0.35
      };
    }
    posAttr.needsUpdate = true;
  }

  startVictoryCelebration(robotX = 0) {
    this.isVictoryActive = true;
    this.confettiMat.opacity = 0.95;
    const posAttr = this.confettiGeo.attributes.position;

    for (let i = 0; i < this.maxConfetti; i++) {
      const data = this.confettiData[i];
      data.baseX = robotX + (Math.random() - 0.5) * 8;
      posAttr.setXYZ(i, data.baseX, 4 + Math.random() * 6, (Math.random() - 0.5) * 6);
    }
    posAttr.needsUpdate = true;
  }

  stopVictoryCelebration() {
    this.isVictoryActive = false;
    this.confettiMat.opacity = 0;
  }

  shake(intensity = 0.45, duration = 0.55) {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeTimer = duration;
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
  }

  /**
   * Clean transition effect when a level starts:
   * Smoothly adjusts FOV and applies clean biome track palette.
   */
  triggerWarpTransition(nextLevel) {
    const themeKey = Math.min(5, Math.max(1, nextLevel));
    const biome = BIOMES[themeKey] || BIOMES[5];

    // Subtle smooth FOV adaptation (no disorienting warp fish-eye)
    this.targetFOV = biome.targetFOV;

    // Set Biome theme
    this.setBiome(nextLevel);
  }

  /**
   * Applies the distinct Biome visual parameters (crisp track colors, sky, and side architecture).
   */
  setBiome(level) {
    const themeKey = Math.min(5, Math.max(1, level));
    const biome = BIOMES[themeKey] || BIOMES[5];
    this.currentLevel = themeKey;
    this.targetFOV = biome.targetFOV;
    this.particleMode = 'NONE';

    this.targetBg.setHex(biome.bg);
    this.targetFog.setHex(biome.fog);
    this.scene.fog.near = biome.fogNear;
    this.scene.fog.far = biome.fogFar;

    this.targetHemiSky.setHex(biome.hemiSky);
    this.targetHemiGround.setHex(biome.hemiGround);
    this.targetDirLight.setHex(biome.dirLight);
    this.targetRim.setHex(biome.rim);
    this.targetDivider.setHex(biome.divider);
    this.targetRails.setHex(biome.rails);
    this.targetPylonCap.setHex(biome.pylonCap);
    this.targetArchNeon.setHex(biome.archNeon);
    this.targetLaneColor.setHex(biome.laneColor);
    this.targetCenterLaneColor.setHex(biome.centerLaneColor);

    // Beacons opacity (Level 2 Reactor Overdrive side pylons outside track)
    const isReactor = (themeKey === 2);
    this.rotatingBeacons.forEach(b => {
      b.material.opacity = isReactor ? 0.35 : 0;
    });

    // Quantum debris visibility (Level 5+) kept on distant flanks
    if (this.quantumDebrisGroup) {
      this.quantumDebrisGroup.visible = (themeKey >= 5);
    }
  }

  // Backwards compatibility alias
  setLevelTheme(level) {
    this.setBiome(level);
  }

  /**
   * Main per-frame update loop.
   */
  update(delta, gameSpeed, playerX = 0, isScrolling = true) {
    const now = Date.now() * 0.001;

    // 1. Smoothly interpolate Biome Theme colors
    const lerpRate = delta * 3.5;
    this.scene.background.lerp(this.targetBg, lerpRate);
    this.scene.fog.color.lerp(this.targetFog, lerpRate);
    this.hemiLight.color.lerp(this.targetHemiSky, lerpRate);
    this.hemiLight.groundColor.lerp(this.targetHemiGround, lerpRate);
    this.dirLight.color.lerp(this.targetDirLight, lerpRate);
    this.rimLight.color.lerp(this.targetRim, lerpRate);

    this.dividerMat.color.lerp(this.targetDivider, lerpRate);
    this.dividerMat.emissive.lerp(this.targetDivider, lerpRate);

    this.railMat.color.lerp(this.targetRails, lerpRate);
    this.railMat.emissive.lerp(this.targetRails, lerpRate);

    this.pylonCapMat.color.lerp(this.targetPylonCap, lerpRate);
    this.pylonCapMat.emissive.lerp(this.targetPylonCap, lerpRate);

    this.archNeonMat.color.lerp(this.targetArchNeon, lerpRate);
    this.archNeonMat.emissive.lerp(this.targetArchNeon, lerpRate);

    this.outerLaneMat.color.lerp(this.targetLaneColor, lerpRate);
    this.centerLaneMat.color.lerp(this.targetCenterLaneColor, lerpRate);

    // Clean, crisp directional lighting across all levels (no strobe distraction)
    this.dirLight.intensity = 1.4;

    // Chromatic floor shift for Level 5+ Quantum Glitch Void
    if (this.currentLevel >= 5) {
      const hue = (now * 0.15) % 1;
      this.centerLaneMat.emissive.setHSL(hue, 0.7, 0.15);
      this.dividerMat.emissive.setHSL((hue + 0.5) % 1, 0.9, 0.4);
    }

    // Rotate amber warning beacons (Level 2)
    if (this.currentLevel === 2) {
      for (let i = 0; i < this.rotatingBeacons.length; i++) {
        this.rotatingBeacons[i].rotation.y += delta * 4.5;
      }
    }

    // Spin quantum debris (Level 5+)
    if (this.currentLevel >= 5) {
      for (let i = 0; i < this.quantumDebris.length; i++) {
        const d = this.quantumDebris[i];
        d.rotation.x += d.userData.rotX * delta;
        d.rotation.y += d.userData.rotY * delta;
      }
    }

    // 2. Track & Decoration Scrolling
    if (isScrolling && gameSpeed > 0) {
      const moveDist = gameSpeed * delta * 60;

      for (let i = 0; i < this.chevronGroup.children.length; i++) {
        const marker = this.chevronGroup.children[i];
        marker.position.z += moveDist;
        if (marker.position.z > 15) {
          marker.position.z -= (this.trackLength - 20);
        }
      }

      for (let i = 0; i < this.scrollingObjects.length; i++) {
        const obj = this.scrollingObjects[i];
        obj.position.z += moveDist;
        if (obj.position.z > 20) {
          obj.position.z -= 192;
        }
      }
    }

    // 3. Camera Positioning & Smooth FOV Morphing
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetFOV, delta * 5);
    this.camera.updateProjectionMatrix();

    if (this.cameraMode === 'HERO_DANCE') {
      this.targetCamPos.set(0, 2.5, 4.5);
      this.targetLookAt.set(0, 1.2, 0);
      this.heroSpotlight.intensity = THREE.MathUtils.lerp(this.heroSpotlight.intensity, 4.5, delta * 6);
    } else if (this.cameraMode === 'DEATH_ZOOM') {
      this.targetCamPos.set(playerX * 0.6, 2.6, 5.8);
      this.targetLookAt.set(playerX * 0.6, 0.4, 0);
      this.heroSpotlight.intensity = THREE.MathUtils.lerp(this.heroSpotlight.intensity, 0, delta * 6);
    } else {
      const targetCameraX = playerX * 0.25;
      this.targetCamPos.set(targetCameraX, 5, 10);
      this.targetLookAt.set(targetCameraX * 0.4, 1.5, -4);
      this.heroSpotlight.intensity = THREE.MathUtils.lerp(this.heroSpotlight.intensity, 0, delta * 6);
    }

    const camLerpRate = delta * (this.cameraMode === 'HERO_DANCE' ? 4.5 : 5.5);
    this.camera.position.lerp(this.targetCamPos, camLerpRate);
    this.currentLookAt.lerp(this.targetLookAt, camLerpRate);

    // Camera Shake on impact crash only (rock-steady during high speed runs)
    if (this.shakeTimer > 0) {
      this.shakeTimer -= delta;
      const progress = Math.max(0, this.shakeTimer / this.shakeDuration);
      const amp = this.shakeIntensity * progress;
      this.camera.position.x += (Math.random() - 0.5) * amp;
      this.camera.position.y += (Math.random() - 0.5) * amp;
    }

    this.camera.lookAt(this.currentLookAt);

    // 4. Update Particle Systems (localized sparks only)
    this.updateParticles(delta);
  }

  updateParticles(delta) {
    if (this.sparkMat.opacity > 0.01) {
      const posAttr = this.sparkGeo.attributes.position;
      let anyAlive = false;

      for (let i = 0; i < this.maxSparks; i++) {
        const vel = this.sparkVelocities[i];
        if (vel.life > 0) {
          anyAlive = true;
          vel.life -= delta;
          vel.y -= 26 * delta;

          const px = posAttr.getX(i) + vel.x * delta;
          const py = Math.max(0.05, posAttr.getY(i) + vel.y * delta);
          const pz = posAttr.getZ(i) + vel.z * delta;

          posAttr.setXYZ(i, px, py, pz);
        }
      }
      posAttr.needsUpdate = true;
      if (!anyAlive) {
        this.sparkMat.opacity = Math.max(0, this.sparkMat.opacity - delta * 3);
      }
    }

    if (this.isVictoryActive) {
      const posAttr = this.confettiGeo.attributes.position;
      const time = Date.now() * 0.003;

      for (let i = 0; i < this.maxConfetti; i++) {
        const data = this.confettiData[i];
        let py = posAttr.getY(i) - data.speedY * delta;
        if (py < 0) {
          py = 7 + Math.random() * 3;
        }

        const px = data.baseX + Math.sin(time * data.freq + data.phase) * 0.8;
        const pz = Math.cos(time * data.freq + data.phase) * 1.5;

        posAttr.setXYZ(i, px, py, pz);
      }
      posAttr.needsUpdate = true;
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
