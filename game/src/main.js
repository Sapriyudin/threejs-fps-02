// Meridian Yard: a round-based tactical FPS. Vanguard (you + 4 bots) attacks
// two charge sites against Crimson (5 bots). Win a round by planting the
// charge and letting it detonate, or by eliminating the defenders; lose it by
// being wiped out, running out of time, or letting them defuse. Money earned
// each round buys guns, grenades and armor between rounds. First to 5 rounds
// takes the match.
//
// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. ?shot=start|play|buy|end with &seed=N sets up a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, clamp } from './rng.js';
import { createAudio } from './audio.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { WEAPONS, GRENADE, createWeaponState, takeRound, stepWeapon, startReload, weaponDamage, currentSpread } from './weapons.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5;
const CHARGE_TIME = 35;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 30, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene, random);
const bots = createBots(scene, world, random);
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

// The game's single state object: everything the sim and the render read.
const G = {
  phase: 'menu', // menu | buy | playing | roundEnd | matchEnd
  round: 1,
  score: { us: 0, them: 0 },
  money: 800,
  timer: ROUND_TIME,
  time: 0,
  charge: { state: 'carried', carrier: 'player', site: null, x: 0, z: 0, timer: CHARGE_TIME },
  weapon: createWeaponState('pistol'),
  owned: { pistol: true },
  grenades: 0,
  kills: 0,
  plantProgress: 0,
  defuseProgress: 0,
  roundEndAt: -10,
  frozen: false,
  started: false,
};
const body = player.state;
const botMeshes = [];
for (const bot of bots.list) botMeshes.push(bot.mesh.body, bot.mesh.head);
const shootables = world.shootables.concat(botMeshes);

// --- Weapon viewmodel: a low-poly rifle held in front of the camera ---
const viewmodel = new THREE.Group();
const vmMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.6, metalness: 0.4 });
function vmBox(w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || vmMat);
  m.position.set(x, y, z);
  viewmodel.add(m);
  return m;
}
vmBox(0.09, 0.12, 0.5, 0, 0, 0);
vmBox(0.05, 0.05, 0.34, 0, 0.02, -0.4);
vmBox(0.07, 0.18, 0.1, 0, -0.14, 0.05);
vmBox(0.08, 0.1, 0.16, 0, 0, 0.28);
vmBox(0.03, 0.03, 0.12, 0, 0.09, -0.2);
viewmodel.position.set(0.24, -0.27, -0.55);
viewmodel.scale.setScalar(0.75);
camera.add(viewmodel);
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc44d, transparent: true, opacity: 0 });
const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
flash.position.set(0.26, -0.2, -0.95);
camera.add(flash);
let flashLife = 0;
let vmKick = 0;

// --- Tracers: a small reusable pool, no allocation per shot ---
const tracers = [];
for (let i = 0; i < 6; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc44d, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIdx = 0;
function spawnTracer(from, to) {
  const t = tracers[tracerIdx];
  tracerIdx = (tracerIdx + 1) % tracers.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.material.opacity = 0.85;
  t.life = 0.07;
}

// --- Grenades: thrown, bounced, exploded ---
const grenades = [];
const grenadeMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6 }),
);
function throwGrenade() {
  if (G.grenades <= 0 || G.phase !== 'playing') return;
  G.grenades -= 1;
  const mesh = grenadeMesh.clone();
  mesh.position.copy(camera.position);
  scene.add(mesh);
  camera.getWorldDirection(direction);
  grenades.push({
    mesh,
    vel: direction.clone().multiplyScalar(16).add(new THREE.Vector3(0, 3.5, 0)),
    fuse: 1.6,
  });
  audio.grenade();
  bots.hearNoise({ x: body.position.x, z: body.position.z }, 30, 'us');
}
function explodeGrenade(g) {
  scene.remove(g.mesh);
  audio.explode();
  const p = g.mesh.position;
  flashLife = 0.12;
  flashMat.opacity = 1;
  const victims = [];
  if (body.alive) victims.push({ kind: 'player', pos: body.position, dist: Math.hypot(p.x - body.position.x, p.z - body.position.z) });
  for (const bot of bots.list) {
    if (!bot.alive) continue;
    victims.push({ kind: 'bot', bot, dist: Math.hypot(p.x - bot.position.x, p.z - bot.position.z) });
  }
  for (const v of victims) {
    if (v.dist > GRENADE.radius) continue;
    const dmg = GRENADE.damage * (1 - v.dist / GRENADE.radius) + 20;
    if (v.kind === 'player') damagePlayer(dmg, null, false);
    else applyBotDamage(v.bot, dmg, 'body', null);
  }
  bots.hearNoise({ x: p.x, z: p.z }, 40, 'us');
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  viewmodel.position.z = -0.5 + vmKick;
  vmKick *= 0.82;
  if (flashLife > 0) {
    flashLife -= FIXED_STEP;
    flashMat.opacity = Math.max(0, flashLife / 0.12);
  }
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= FIXED_STEP;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
    }
  }
}

// --- Shooting: the player's hits are raycast against bodies, headshots pay ---
function shootPlayer() {
  const w = G.weapon;
  if (!takeRound(w)) {
    if (w.mag === 0) startReload(w);
    return false;
  }
  const def = WEAPONS[w.kind];
  const spread = currentSpread(w, player.groundSpeed(), input.state.keys.size > 0);
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hits = raycaster.intersectObjects(shootables, false);
  const hit = hits[0];
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  if (hit) spawnTracer(muzzle, hit.point);
  else spawnTracer(muzzle, tmpVec.copy(camera.position).addScaledVector(direction, 60));
  audio.shot(def.kind);
  flashLife = 0.05;
  flashMat.opacity = 1;
  vmKick = 0.06;
  w.spread = Math.min(def.spreadMax, w.spread + def.spreadShot);
  player.recoil(def.recoil, (random() * 2 - 1) * def.kick);
  bots.hearNoise({ x: body.position.x, z: body.position.z }, 26, 'us');
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const headshot = hit.object.userData.part === 'head';
    const dmg = weaponDamage(def, hit.distance, headshot);
    applyBotDamage(bot, dmg, headshot ? 'head' : 'body', 'player');
  }
  hud.setAmmo(w.mag, w.reserve, def.name);
  return true;
}

function applyBotDamage(bot, dmg, part, attacker) {
  if (!bot.alive) return;
  bot.hp -= dmg;
  const killed = bot.hp <= 0;
  if (attacker === 'player') {
    hud.hitMarker(killed);
    audio.hit();
    if (killed) audio.kill();
  }
  if (!killed) return;
  bot.alive = false;
  bot.hp = 0;
  bot.mesh.group.visible = false;
  const killerName = attacker === 'player' ? 'You' : attacker ? attacker.name : 'Grenade';
  hud.killfeed(killerName, bot.name, attacker === 'player' ? WEAPONS[G.weapon.kind].name : 'Rifle', part === 'head');
  if (attacker === 'player') {
    G.kills += 1;
    G.money += 300;
    hud.setMoney(G.money);
  }
  if (bot.carrier) {
    bot.carrier = false;
    G.charge.state = 'dropped';
    G.charge.carrier = null;
    G.charge.x = bot.position.x;
    G.charge.z = bot.position.z;
    hud.banner('Charge dropped', 'A teammate can pick it up');
  }
  checkRoundEnd();
}

function damagePlayer(dmg, attacker, headshot) {
  if (!body.alive || G.phase !== 'playing') return;
  player.damage(dmg);
  hud.flashDamage();
  audio.hurt();
  hud.setHealth(body.hp, body.armor);
  if (!body.alive) {
    if (document.pointerLockElement) document.exitPointerLock();
    if (G.charge.carrier === 'player') {
      G.charge.state = 'dropped';
      G.charge.carrier = null;
      G.charge.x = body.position.x;
      G.charge.z = body.position.z;
      hud.banner('Charge dropped', 'A teammate can pick it up');
    }
    checkRoundEnd();
  }
}

// --- Bot callbacks: the hooks bots.js calls into the main loop ---
const botCtx = {
  get player() {
    return { pos: body.position, eye: body.eye, alive: body.alive, crouched: body.crouched, speed: player.groundSpeed() };
  },
  get charge() { return G.charge; },
  onBotShot() { audio.enemyShot(); },
  onBotMiss() {},
  damagePlayer(dmg, bot, headshot) { damagePlayer(dmg, bot, headshot); },
  damageBot(bot, dmg, part, attacker) { applyBotDamage(bot, dmg, part, attacker); },
  onPlant(bot) {
    G.charge.state = 'planted';
    G.charge.timer = CHARGE_TIME;
    G.charge.site = bot.targetSite;
    G.charge.x = bot.position.x;
    G.charge.z = bot.position.z;
    G.money += 300;
    hud.setMoney(G.money);
    hud.banner('CHARGE PLANTED', `${bot.targetSite} site — ${CHARGE_TIME}s to detonation`);
    audio.plant();
  },
  onPlantStart(bot) { hud.banner('Charge being planted', bot.name); },
  onDefuse(bot) {
    G.charge.state = 'defused';
    endRound(false, `${bot.name} defused the charge.`);
  },
  onDefuseStart(bot) { hud.banner('Charge being defused', bot.name); },
  onChargePickup(bot) {
    bot.carrier = true;
    G.charge.state = 'carried';
    G.charge.carrier = bot;
    hud.banner('Charge picked up', bot.name);
  },
};

// --- Rounds, economy, buy phase ---
function startMatch() {
  G.round = 1;
  G.score = { us: 0, them: 0 };
  G.money = 800;
  G.kills = 0;
  G.owned = { pistol: true };
  G.grenades = 0;
  body.armor = 0;
  G.weapon = createWeaponState('pistol');
  startRound();
}

function startRound() {
  G.phase = 'playing';
  G.timer = ROUND_TIME;
  G.charge = { state: 'carried', carrier: 'player', site: null, x: 0, z: 0, timer: CHARGE_TIME };
  G.plantProgress = 0;
  bots.reset(G.round);
  const spawn = world.spawns.us[0];
  player.reset(spawn[0], spawn[1], 0);
  hud.setHealth(100, body.armor);
  hud.setAmmo(G.weapon.mag, G.weapon.reserve, WEAPONS[G.weapon.kind].name);
  hud.setMoney(G.money);
  hud.setTimer(G.timer);
  hud.setRound(G.round, MAX_ROUNDS);
  hud.setScore(G.score.us, G.score.them);
  hud.setAlive(5, 5);
  hud.setCharge('You carry the charge — plant it at A or B');
  hud.hideOverlay();
  hud.banner(`ROUND ${G.round}`, 'Plant the charge or eliminate Crimson');
}

function endRound(usWon, reason) {
  if (G.phase !== 'playing') return;
  G.phase = 'roundEnd';
  G.roundEndAt = G.time;
  if (usWon) {
    G.score.us += 1;
    G.money += 3250;
    audio.roundWin();
  } else {
    G.score.them += 1;
    G.money += 1900;
    audio.roundLose();
  }
  hud.setScore(G.score.us, G.score.them);
  hud.setMoney(G.money);
  hud.setCharge(null);
  hud.hideBanner();
  if (document.pointerLockElement) document.exitPointerLock();
  if (G.score.us >= WIN_ROUNDS || G.score.them >= WIN_ROUNDS || G.round >= MAX_ROUNDS) {
    G.phase = 'matchEnd';
    hud.showOverlay('end', { win: G.score.us > G.score.them, us: G.score.us, them: G.score.them, reason });
    return;
  }
  hud.showOverlay('round', { win: usWon, reason });
}

function checkRoundEnd() {
  if (G.phase !== 'playing') return;
  const usAlive = bots.aliveCount('us') + (body.alive ? 1 : 0);
  const themAlive = bots.aliveCount('them');
  if (themAlive === 0) endRound(true, 'Crimson team eliminated.');
  else if (usAlive === 0) endRound(false, 'Vanguard team eliminated.');
}

function buyItems() {
  return [
    { key: 'rifle', name: 'AR-77 Rifle', price: WEAPONS.rifle.price, owned: !!G.owned.rifle },
    { key: 'smg', name: 'VK-9 SMG', price: WEAPONS.smg.price, owned: !!G.owned.smg },
    { key: 'shotgun', name: 'SG-12 Breacher', price: WEAPONS.shotgun.price, owned: !!G.owned.shotgun },
    { key: 'grenade', name: 'Frag Grenade', price: GRENADE.price, owned: G.grenades >= 2 },
    { key: 'armor', name: 'Kevlar Armor', price: 650, owned: body.armor >= 100 },
  ];
}

function openBuy() {
  G.phase = 'buy';
  if (document.pointerLockElement) document.exitPointerLock();
  hud.showBuy(G.money, buyItems());
}

function buy(key) {
  if (G.phase !== 'buy') return;
  if (key === 'grenade') {
    if (G.money >= GRENADE.price && G.grenades < 2) {
      G.money -= GRENADE.price;
      G.grenades += 1;
      audio.click();
    }
  } else if (key === 'armor') {
    if (G.money >= 650 && body.armor < 100) {
      G.money -= 650;
      body.armor = 100;
      audio.click();
    }
  } else if (WEAPONS[key] && !G.owned[key] && G.money >= WEAPONS[key].price) {
    G.money -= WEAPONS[key].price;
    G.owned[key] = true;
    G.weapon = createWeaponState(key);
    audio.click();
  } else if (WEAPONS[key] && G.owned[key]) {
    G.weapon = createWeaponState(key);
    audio.click();
  }
  hud.setMoney(G.money);
  hud.setHealth(body.hp, body.armor);
  hud.setAmmo(G.weapon.mag, G.weapon.reserve, WEAPONS[G.weapon.kind].name);
  hud.showBuy(G.money, buyItems());
}

hud.onPlay(() => {
  audio.unlock();
  if (G.phase === 'menu' || G.phase === 'matchEnd') {
    startMatch();
  } else if (G.phase === 'roundEnd') {
    G.round += 1;
    openBuy();
  } else if (G.phase === 'buy') {
    startRound();
  } else if (G.phase === 'playing') {
    input.requestLock();
  }
});
hud.onBuy(buy);

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    G.started = true;
    hud.hideOverlay();
    hud.hideBuy();
    if (G.phase === 'buy') startRound();
  } else if (G.phase === 'playing' && body.alive) {
    hud.showOverlay('paused');
  }
}

// --- Fixed-step simulation ---
let accumulator = 0;
let lastTime = performance.now();
let stepCount = 0;
let footstepTimer = 0;

function step(dt) {
  G.time += dt;
  stepCount += 1;
  world.update(dt, G.time);
  if (G.phase === 'playing') {
    G.timer -= dt;
    if (G.timer <= 0 && G.charge.state !== 'planted') {
      endRound(false, 'Time expired — Crimson held the sites.');
    }
    if (G.charge.state === 'planted') {
      G.charge.timer -= dt;
      hud.setCharge(`CHARGE PLANTED — ${Math.ceil(G.charge.timer)}s`);
      if (Math.floor(G.charge.timer * 2) !== Math.floor((G.charge.timer + dt) * 2)) audio.beep();
      if (G.charge.timer <= 0) {
        audio.explode();
        endRound(true, 'The charge detonated.');
      }
    }
    // Player plant channel: hold E inside a site while carrying the charge.
    if (G.charge.carrier === 'player' && input.state.keys.has('KeyE')) {
      const site = nearestSite();
      if (site) {
        G.plantProgress += dt / PLANT_TIME;
        hud.setCharge(`Planting at ${site}… ${Math.floor(G.plantProgress * 100)}%`);
        if (G.plantProgress >= 1) {
          G.charge.state = 'planted';
          G.charge.timer = CHARGE_TIME;
          G.charge.site = site;
          G.charge.x = world.sites[site].x;
          G.charge.z = world.sites[site].z;
          G.money += 300;
          hud.setMoney(G.money);
          hud.banner('CHARGE PLANTED', `${site} site — ${CHARGE_TIME}s to detonation`);
          audio.plant();
        }
      } else {
        G.plantProgress = 0;
      }
    } else {
      G.plantProgress = 0;
    }
    // Footsteps.
    const speed = player.groundSpeed();
    if (speed > 1.5 && body.onGround) {
      footstepTimer -= dt;
      if (footstepTimer <= 0) {
        footstepTimer = 0.38;
        audio.footstep();
      }
    }
    // Grenades.
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 14 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      if (g.mesh.position.y < 0.1) {
        g.mesh.position.y = 0.1;
        g.vel.y *= -0.35;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.fuse <= 0) {
        grenades.splice(i, 1);
        explodeGrenade(g);
      }
    }
    bots.step(dt, botCtx, G.time);
    hud.setAlive(bots.aliveCount('us') + (body.alive ? 1 : 0), bots.aliveCount('them'));
    hud.setTimer(G.timer);
    hud.drawMinimap(world, body, bots.list, G.charge.state === 'planted' ? G.charge : null);
  }
  // Weapon timers always run so a reload finishes while the menu is open.
  if (stepWeapon(G.weapon, dt)) hud.setAmmo(G.weapon.mag, G.weapon.reserve, WEAPONS[G.weapon.kind].name);
  G.weapon.spread = Math.max(WEAPONS[G.weapon.kind].spreadBase, G.weapon.spread - dt * 0.05);
}

function nearestSite() {
  for (const name of ['A', 'B']) {
    const s = world.sites[name];
    if (Math.hypot(s.x - body.position.x, s.z - body.position.z) < 3.2) return name;
  }
  return null;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!G.frozen) {
    const look = input.takeLook();
    if (G.phase === 'playing' && body.alive) player.look(look.x, look.y);
    if (G.phase === 'playing' && body.alive) {
      player.step(dt, input.state.keys);
      const w = G.weapon;
      if (input.state.firing && w.auto && w.ready !== false && w.cooldown <= 0) shootPlayer();
      if (input.state.firing && !w.auto && w.cooldown <= 0) {
        // Semi-auto: fire once per click; the input holds firing until release.
        shootPlayer();
        input.state.firing = false;
      }
      if (input.state.keys.has('KeyR')) startReload(w);
      if (input.state.keys.has('KeyG')) {
        throwGrenade();
        input.state.keys.delete('KeyG');
      }
      if (input.state.keys.has('Digit1') && G.owned.pistol) { G.weapon = createWeaponState('pistol'); input.state.keys.delete('Digit1'); }
      if (input.state.keys.has('Digit2') && G.owned.smg) { G.weapon = createWeaponState('smg'); input.state.keys.delete('Digit2'); }
      if (input.state.keys.has('Digit3') && G.owned.rifle) { G.weapon = createWeaponState('rifle'); input.state.keys.delete('Digit3'); }
      if (input.state.keys.has('Digit4') && G.owned.shotgun) { G.weapon = createWeaponState('shotgun'); input.state.keys.delete('Digit4'); }
      if (input.state.keys.has('KeyB') && G.phase === 'playing') {
        input.state.keys.delete('KeyB');
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    hud.setSpread(currentSpread(G.weapon, player.groundSpeed(), input.state.keys.size > 0));
  }
  renderer.render(scene, camera);
}

// --- Deterministic captures for screenshots ---
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = clamp(Math.asin(Math.max(-1, Math.min(1, dy / len))), -1.45, 1.45);
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  if (name === 'start') {
    body.position.set(0, 0, 19);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 2, -10));
    hud.showOverlay('start');
  } else if (name === 'play') {
    startMatch();
    body.position.set(-24, 0, 8);
    body.yaw = 0;
    settle(30);
    const enemy = bots.list.find((b) => b.team === 'them' && b.alive);
    if (enemy) {
      enemy.position.set(-24, 0, -10);
      enemy.mesh.group.position.copy(enemy.position);
      aimAt(new THREE.Vector3(-24, 1.4, -10));
      shootPlayer();
      settle(6);
      aimAt(new THREE.Vector3(-24, 1.4, -10));
    }
    G.money = 1400;
    G.score = { us: 1, them: 0 };
    hud.setMoney(1400);
    hud.setTimer(78);
    hud.setScore(1, 0);
  } else if (name === 'buy') {
    startMatch();
    G.phase = 'buy';
    G.money = 3200;
    G.owned = { pistol: true, smg: true };
    hud.showBuy(G.money, buyItems());
    body.position.set(0, 0, 19);
    settle(20);
  } else if (name === 'end') {
    startMatch();
    G.score = { us: 2, them: 1 };
    G.round = 4;
    hud.setRound(4, MAX_ROUNDS);
    hud.setScore(2, 1);
    endRound(true, 'Crimson team eliminated.');
    settle(20);
  }
  hud.setScore(G.score.us, G.score.them);
  hud.setAmmo(G.weapon.mag, G.weapon.reserve, WEAPONS[G.weapon.kind].name);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      G.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.showOverlay('start');
hud.setHealth(100, 0);
hud.setAmmo(G.weapon.mag, G.weapon.reserve, WEAPONS[G.weapon.kind].name);
hud.setMoney(G.money);
hud.setTimer(ROUND_TIME);
hud.setRound(1, MAX_ROUNDS);
hud.setScore(0, 0);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
