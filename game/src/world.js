// Meridian Yard: an original dusk industrial yard. Two charge sites (A west,
// B east), a mid lane, a long east lane and a west tunnel, built from concrete,
// containers and crates. Every solid is an AABB collider; the waypoint graph
// the bots walk is drawn from the same layout, so routes always fit the map.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function concreteTexture(rng) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#8a8f94';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i += 1) {
      const g = 110 + Math.floor(rng() * 60);
      ctx.fillStyle = `rgba(${g},${g + 4},${g + 8},0.25)`;
      ctx.fillRect(rng() * s, rng() * s, 2 + rng() * 5, 2 + rng() * 5);
    }
    ctx.strokeStyle = 'rgba(40,44,48,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
    ctx.beginPath();
    ctx.moveTo(0, s / 2);
    ctx.lineTo(s, s / 2);
    ctx.stroke();
  });
}

function containerTexture(base, rng) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, 0, 4, s);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + 8, 0, 3, s);
    }
    for (let i = 0; i < 40; i += 1) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.12})`;
      ctx.fillRect(rng() * s, rng() * s, 8 + rng() * 30, 4 + rng() * 8);
    }
  });
}

function groundTexture(rng) {
  return canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#33383e';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i += 1) {
      const g = 40 + Math.floor(rng() * 26);
      ctx.fillStyle = `rgba(${g},${g + 3},${g + 6},0.5)`;
      ctx.fillRect(rng() * s, rng() * s, 2, 2);
    }
    ctx.strokeStyle = 'rgba(20,22,26,0.5)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i += 1) {
      const y = (i + 0.5) * s / 6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(240,168,48,0.55)';
    ctx.lineWidth = 4;
    ctx.setLineDash([24, 18]);
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

export function createWorld(scene, rng) {
  const colliders = [];
  const shootables = [];
  const group = new THREE.Group();
  scene.add(group);

  const concrete = concreteTexture(rng);
  const groundTex = groundTexture(rng);
  groundTex.repeat.set(6, 4);
  const matGround = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 });
  const matConcrete = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.9 });
  const matDark = new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.9 });
  const matSteel = new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.55, metalness: 0.5 });
  const matRust = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.85, metalness: 0.2 });
  const matCrate = new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.9 });
  const matBlue = new THREE.MeshStandardMaterial({ map: containerTexture('#2e5a7a', rng), roughness: 0.8, metalness: 0.3 });
  const matRed = new THREE.MeshStandardMaterial({ map: containerTexture('#7a2e2e', rng), roughness: 0.8, metalness: 0.3 });
  const matGreen = new THREE.MeshStandardMaterial({ map: containerTexture('#3a5a3a', rng), roughness: 0.8, metalness: 0.3 });

  const sun = new THREE.DirectionalLight(0xffb36b, 1.7);
  sun.position.set(-30, 38, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8a9ab8, 0x2a241c, 0.7));

  const ground = new THREE.Mesh(new THREE.BoxGeometry(68, 0.5, 48), matGround);
  ground.position.set(0, -0.25, 0);
  ground.receiveShadow = true;
  group.add(ground);

  function box(x, y, z, w, h, d, mat, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push({
        min: new THREE.Vector3(x - w / 2, y, z - d / 2),
        max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
      });
      shootables.push(mesh);
    }
    return mesh;
  }

  // Perimeter walls.
  box(0, 0, -23.5, 68, 5, 1, matConcrete);
  box(0, 0, 23.5, 68, 5, 1, matConcrete);
  box(-33.5, 0, 0, 1, 5, 48, matConcrete);
  box(33.5, 0, 0, 1, 5, 48, matConcrete);

  // Mid structures: central silo kept off the mid lane so the long sightline
  // down the middle stays open, cross walls, containers, crates.
  box(-5, 0, -2, 5, 4.5, 5, matRust);
  box(-12, 0, 4, 1, 3, 10, matConcrete);
  box(12, 0, -6, 1, 3, 10, matConcrete);
  box(-20, 0, -10, 6, 2.6, 2.4, matBlue);
  box(-20, 2.6, -10, 6, 2.6, 2.4, matRed);
  box(20, 0, 8, 6, 2.6, 2.4, matGreen);
  box(20, 2.6, 8, 6, 2.6, 2.4, matBlue);
  box(-6, 0, -14, 4, 2.6, 2.4, matRed);
  box(8, 0, 14, 4, 2.6, 2.4, matBlue);
  box(-28, 0, 12, 1, 3, 8, matConcrete);
  box(28, 0, -12, 1, 3, 8, matConcrete);
  box(-8, 0, 18, 8, 1.2, 1.2, matCrate);
  box(10, 0, -18, 8, 1.2, 1.2, matCrate);
  box(-16, 0, -18, 1.2, 1.2, 1.2, matCrate);
  box(16, 0, 18, 1.2, 1.2, 1.2, matCrate);
  box(-2, 0, 8, 1.2, 1.2, 1.2, matCrate);
  box(4, 0, -10, 1.2, 1.2, 1.2, matCrate);
  // Overhead gantry beams (visual cover, not solid at head height).
  box(0, 4.4, 0, 20, 0.6, 0.6, matSteel, false);
  box(-22, 4.4, -6, 0.6, 0.6, 16, matSteel, false);

  // Site markers: glowing ground rings + floating beacon signs.
  function siteMarker(x, z, color, label) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.0, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);
    group.add(ring);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.2, 0.15),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 }),
    );
    sign.position.set(x, 4.2, z);
    group.add(sign);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#14161a';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#e9e6df';
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 68);
    const tex = new THREE.CanvasTexture(canvas);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
    );
    face.position.set(x, 4.2, z + 0.09);
    group.add(face);
    return { ring, sign, face };
  }
  const siteA = siteMarker(-26, -16, PALETTE.siteA, 'A');
  const siteB = siteMarker(26, -16, PALETTE.siteB, 'B');

  // Waypoint graph: nodes the bots walk. Links are indices into this list.
  const waypoints = [
    { x: 0, z: 18, links: [1, 2] },      // 0 Vanguard spawn
    { x: 0, z: 8, links: [0, 3, 4] },    // 1 mid south
    { x: -18, z: 14, links: [0, 5] },    // 2 west lane south
    { x: 0, z: 0, links: [1, 6, 7] },    // 3 mid
    { x: 18, z: 14, links: [1, 8] },     // 4 east lane south
    { x: -26, z: 4, links: [2, 9] },     // 5 west lane
    { x: -14, z: -8, links: [3, 9, 10] },// 6 mid north-west
    { x: 14, z: -8, links: [3, 10, 11] },// 7 mid north-east
    { x: 26, z: 4, links: [4, 11] },     // 8 east lane
    { x: -26, z: -14, links: [5, 6] },   // 9 Site A
    { x: 0, z: -14, links: [6, 7, 12] }, // 10 top mid
    { x: 26, z: -14, links: [7, 8] },    // 11 Site B
    { x: 0, z: -19, links: [10] },       // 12 Crimson spawn
  ];

  return {
    colliders,
    shootables,
    sites: {
      A: { x: -26, z: -16, waypoint: 9 },
      B: { x: 26, z: -16, waypoint: 11 },
    },
    spawns: {
      us: [[-4, 19], [-2, 20], [0, 19], [2, 20], [4, 19]],
      them: [[-4, -19], [-2, -20], [0, -19], [2, -20], [4, -19]],
    },
    waypoints,
    update(dt, t) {
      const pulse = 0.55 + 0.25 * Math.sin(t * 2.4);
      siteA.ring.material.opacity = pulse;
      siteB.ring.material.opacity = pulse;
      siteA.sign.position.y = 4.2 + 0.15 * Math.sin(t * 1.6);
      siteB.sign.position.y = 4.2 + 0.15 * Math.sin(t * 1.6 + 1.2);
    },
  };
}
