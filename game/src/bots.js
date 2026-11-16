// Bots: 5v5 AI. Each bot walks the waypoint graph, holds positions, reacts to
// what it sees and hears, and shoots with real raycast hit detection. Attackers
// pick a site, push it, plant the charge and defend it; defenders hold the
// sites and defuse. Accuracy falls with distance and target movement, and a
// reaction delay keeps them fair.
import * as THREE from 'three';
import { WEAPONS, createWeaponState, takeRound, stepWeapon, startReload, weaponDamage } from './weapons.js';
import { clamp, pick, range } from './rng.js';

const BOT_NAMES_US = ['Dara', 'Ivo', 'Kemi', 'Raka'];
const BOT_NAMES_THEM = ['Vex', 'Moro', 'Sable', 'Nyx', 'Orin'];

function bfsPath(graph, from, to) {
  if (from === to) return [to];
  const prev = new Array(graph.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const next of graph[cur].links) {
      if (prev[next] === -1) {
        prev[next] = cur;
        if (next === to) {
          const path = [to];
          let n = cur;
          while (n !== from) { path.unshift(n); n = prev[n]; }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [to];
}

function makeBotMesh(scene, team) {
  const color = team === 'us' ? 0x3a8ad9 : 0xd94a3a;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.32), bodyMat);
  body.position.y = 0.95;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), darkMat);
  head.position.y = 1.55;
  head.castShadow = true;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.3), darkMat);
  legs.position.y = 0.28;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.7), darkMat);
  gun.position.set(0.2, 1.15, 0.3);
  group.add(body, head, legs, gun);
  group.traverse((m) => { if (m.isMesh) m.userData.botGroup = group; });
  body.userData.part = 'body';
  head.userData.part = 'head';
  scene.add(group);
  return { group, body, head };
}

export function createBots(scene, world, rng) {
  const bots = [];
  const graph = world.waypoints;
  const raycaster = new THREE.Raycaster();
  const dir = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const los = new THREE.Vector3();

  function spawnBot(team, name, spawn, weaponKind, skill) {
    const mesh = makeBotMesh(scene, team);
    const bot = {
      team, name, mesh,
      position: mesh.group.position,
      yaw: 0, hp: 100, alive: true,
      weapon: createWeaponState(weaponKind),
      skill,
      state: 'patrol',
      waypoint: 0,
      path: [],
      pathIdx: 0,
      targetSite: null,
      carrier: false,
      channel: 0,
      channelKind: null,
      react: 0,
      burstLeft: 0,
      burstPause: 0,
      think: 0,
      heard: null,
      strafe: 0,
      strafeDir: 1,
      speed: 3.1,
      visibleEnemy: null,
      visibleAt: -10,
      kills: 0,
    };
    bot.position.set(spawn[0], 0, spawn[1]);
    mesh.body.userData.bot = bot;
    mesh.head.userData.bot = bot;
    bots.push(bot);
    return bot;
  }

  function reset(round) {
    for (const bot of bots) {
      bot.hp = 100;
      bot.alive = true;
      bot.mesh.group.visible = true;
      bot.weapon = createWeaponState(bot.weapon.kind);
      bot.channel = 0;
      bot.channelKind = null;
      bot.carrier = false;
      bot.heard = null;
      bot.visibleEnemy = null;
      bot.state = 'patrol';
    }
    const us = bots.filter((b) => b.team === 'us');
    const them = bots.filter((b) => b.team === 'them');
    us.forEach((b, i) => {
      const s = world.spawns.us[i];
      b.position.set(s[0], 0, s[1]);
      b.yaw = Math.PI;
    });
    them.forEach((b, i) => {
      const s = world.spawns.them[i];
      b.position.set(s[0], 0, s[1]);
      b.yaw = 0;
    });
    const site = rng() < 0.5 ? 'A' : 'B';
    them.forEach((b) => { b.targetSite = site; b.state = 'hold'; });
    // Defenders: two hold A, two hold B, one roams mid.
    const holds = [world.sites.A.waypoint, world.sites.B.waypoint, world.sites.A.waypoint, world.sites.B.waypoint];
    them.forEach((b, i) => {
      b.holdWaypoint = holds[Math.min(i, 3)];
      b.state = i === 4 ? 'patrol' : 'hold';
    });
    // Attackers push the chosen site together; the player carries the charge.
    us.forEach((b) => { b.targetSite = site; b.state = 'patrol'; });
    void round;
  }

  function nearestWaypoint(pos) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < graph.length; i += 1) {
      const d = (graph[i].x - pos.x) ** 2 + (graph[i].z - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function setPath(bot, dest) {
    const fromIdx = nearestWaypoint(bot.position);
    bot.path = bfsPath(graph, fromIdx, dest);
    bot.pathIdx = 0;
  }

  function losClear(a, b) {
    from.copy(a);
    dir.copy(b).sub(a);
    const dist = dir.length();
    if (dist < 0.01) return true;
    dir.normalize();
    raycaster.set(from, dir);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(world.shootables, false);
    return hits.length === 0;
  }

  function collides(px, pz) {
    for (let i = 0; i < collidersLen(); i += 1) {
      const c = world.colliders[i];
      if (px + 0.35 > c.min.x && px - 0.35 < c.max.x && pz + 0.35 > c.min.z && pz - 0.35 < c.max.z) return true;
    }
    return false;
  }
  function collidersLen() { return world.colliders.length; }

  // One bot's turn in the fixed step. ctx carries the player, the charge and
  // the callbacks the main loop owns (damage, noise, events).
  function stepBot(bot, dt, ctx, time) {
    if (!bot.alive) return;
    stepWeapon(bot.weapon, dt);
    bot.think -= dt;
    bot.burstPause -= dt;
    bot.react -= dt;

    // --- Perception: nearest visible enemy (player or opposing bot) ---
    let enemy = null;
    let enemyDist = Infinity;
    let enemyHead = false;
    const candidates = [];
    if (ctx.player.alive && bot.team === 'them') candidates.push({ kind: 'player', pos: ctx.player.pos, eye: ctx.player.eye, crouched: ctx.player.crouched, speed: ctx.player.speed });
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      candidates.push({ kind: 'bot', bot: other, pos: other.position, eye: 1.55, crouched: false, speed: other.speed });
    }
    for (const cand of candidates) {
      to.set(cand.pos.x, cand.pos.y + cand.eye, cand.pos.z);
      const dx = to.x - bot.position.x;
      const dy = to.y - 1.45;
      const dz = to.z - bot.position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 48) continue;
      const ang = Math.atan2(-dx, -dz);
      let diff = ang - bot.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 1.9 && dist > 4) continue;
      from.set(bot.position.x, 1.45, bot.position.z);
      if (!losClear(from, to)) continue;
      if (dist < enemyDist) {
        enemy = cand;
        enemyDist = dist;
        enemyHead = true;
      }
    }
    if (enemy) {
      bot.visibleEnemy = enemy;
      bot.visibleAt = time;
      if (bot.react <= 0 && bot.state !== 'attack') bot.react = range(rng, 0.25, 0.6);
    } else if (time - bot.visibleAt > 1.2) {
      bot.visibleEnemy = null;
    }

    // --- Channel: plant or defuse ---
    if (bot.channelKind) {
      bot.channel -= dt;
      if (bot.channel <= 0) {
        const kind = bot.channelKind;
        bot.channelKind = null;
        if (kind === 'plant') ctx.onPlant(bot);
        else if (kind === 'defuse') ctx.onDefuse(bot);
      }
      return;
    }

    // --- Combat ---
    if (bot.visibleEnemy && bot.react <= 0) {
      bot.state = 'attack';
      const e = bot.visibleEnemy;
      to.set(e.pos.x, e.pos.y + e.eye * (enemyHead ? 0.95 : 0.6), e.pos.z);
      const dx = to.x - bot.position.x;
      const dz = to.z - bot.position.z;
      // Bot mesh faces +z, so yaw = atan2(dx, dz).
      bot.yaw = Math.atan2(dx, dz);
      // Strafe while fighting, so fights move.
      bot.strafe -= dt;
      if (bot.strafe <= 0) {
        bot.strafe = range(rng, 0.6, 1.4);
        bot.strafeDir = rng() < 0.5 ? -1 : 1;
      }
      const side = Math.cos(bot.yaw) * bot.strafeDir;
      const fwd = -Math.sin(bot.yaw) * bot.strafeDir;
      moveBot(bot, side * 1.6 * dt, fwd * 1.6 * dt, ctx);
      if (bot.burstLeft <= 0 && bot.burstPause <= 0) {
        bot.burstLeft = 2 + Math.floor(rng() * 3);
        bot.burstPause = range(rng, 0.5, 1.1);
      }
      if (bot.burstLeft > 0 && bot.weapon.cooldown <= 0 && bot.weapon.mag > 0) {
        bot.burstLeft -= 1;
        fireAt(bot, e, enemyDist, ctx);
      } else if (bot.weapon.mag === 0) {
        startReload(bot.weapon);
      }
      return;
    }

    // --- Objective / routes ---
    // Vanguard (us) attacks: push the chosen site, plant the charge, then
    // defend it. Crimson (them) defends the sites and defuses.
    const charge = ctx.charge;
    if (bot.team === 'us') {
      if (charge.state === 'planted') {
        if (bot.think <= 0) {
          bot.think = 1;
          setPath(bot, charge.site === 'A' ? world.sites.A.waypoint : world.sites.B.waypoint);
        }
      } else if (charge.state === 'dropped') {
        if (bot.think <= 0) {
          bot.think = 0.8;
          setPath(bot, nearestWaypoint({ x: charge.x, z: charge.z }));
        }
        const d = Math.hypot(charge.x - bot.position.x, charge.z - bot.position.z);
        if (d < 1.6) ctx.onChargePickup(bot);
      } else if (bot.carrier) {
        const site = bot.targetSite === 'A' ? world.sites.A : world.sites.B;
        const d = Math.hypot(site.x - bot.position.x, site.z - bot.position.z);
        if (d < 2.5) {
          bot.channelKind = 'plant';
          bot.channel = 3.2;
          ctx.onPlantStart(bot);
        } else if (bot.think <= 0) {
          bot.think = 0.8;
          setPath(bot, site.waypoint);
        }
      } else if (bot.think <= 0) {
        bot.think = 0.8;
        const site = bot.targetSite === 'A' ? world.sites.A : world.sites.B;
        setPath(bot, site.waypoint);
      }
    } else if (charge.state === 'planted') {
      const site = charge.site === 'A' ? world.sites.A : world.sites.B;
      const d = Math.hypot(site.x - bot.position.x, site.z - bot.position.z);
      if (d < 2.5) {
        bot.channelKind = 'defuse';
        bot.channel = 5;
        ctx.onDefuseStart(bot);
      } else if (bot.think <= 0) {
        bot.think = 0.8;
        setPath(bot, site.waypoint);
      }
    } else if (bot.state === 'hold') {
      if (bot.think <= 0) {
        bot.think = 1.5;
        setPath(bot, bot.holdWaypoint);
      }
    } else if (bot.heard && bot.think <= 0) {
      bot.think = 1;
      setPath(bot, nearestWaypoint(bot.heard));
    } else if (bot.think <= 0) {
      bot.think = 2;
      setPath(bot, pick(rng, [3, 6, 7, 10]));
    }

    // Walk the current path.
    if (bot.path.length > 0 && bot.pathIdx < bot.path.length) {
      const node = graph[bot.path[bot.pathIdx]];
      const dx = node.x - bot.position.x;
      const dz = node.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.1) {
        bot.pathIdx += 1;
      } else {
        const stepLen = bot.speed * dt;
        const mx = (dx / dist) * stepLen;
        const mz = (dz / dist) * stepLen;
        bot.yaw = Math.atan2(dx, dz);
        moveBot(bot, mx, mz, ctx);
      }
    }
  }

  function moveBot(bot, dx, dz, ctx) {
    const nx = bot.position.x + dx;
    if (!collides(nx, bot.position.z)) bot.position.x = nx;
    const nz = bot.position.z + dz;
    if (!collides(bot.position.x, nz)) bot.position.z = nz;
    bot.mesh.group.position.copy(bot.position);
    bot.mesh.group.rotation.y = bot.yaw;
    void ctx;
  }

  function fireAt(bot, enemy, dist, ctx) {
    if (!takeRound(bot.weapon)) return;
    const def = WEAPONS[bot.weapon.kind];
    const movePenalty = (enemy.speed || 0) > 2 ? 0.65 : 1;
    const crouchBonus = enemy.crouched ? 0.8 : 1;
    const skill = bot.skill;
    let hitChance = clamp((0.55 - dist * 0.009) * skill * movePenalty * crouchBonus, 0.08, 0.6);
    // Line of sight was already checked; the shot can still be blocked by
    // the target stepping behind cover between perception and firing.
    from.set(bot.position.x, 1.45, bot.position.z);
    to.set(enemy.pos.x, enemy.pos.y + enemy.eye, enemy.pos.z);
    dir.copy(to).sub(from);
    const d = dir.length();
    dir.normalize();
    raycaster.set(from, dir);
    raycaster.far = d + 1;
    if (raycaster.intersectObjects(world.shootables, false).length > 0) return;
    ctx.onBotShot(bot);
    if (rng() >= hitChance) {
      ctx.onBotMiss(bot, enemy);
      return;
    }
    const headshot = rng() < 0.18;
    const dmg = weaponDamage(def, dist, headshot);
    if (enemy.kind === 'player') ctx.damagePlayer(dmg, bot, headshot);
    else ctx.damageBot(enemy.bot, dmg, headshot ? 'head' : 'body', bot);
  }

  // Build the two teams.
  for (let i = 0; i < 4; i += 1) {
    spawnBot('us', BOT_NAMES_US[i], world.spawns.us[i], i === 0 ? 'rifle' : i === 1 ? 'smg' : 'rifle', range(rng, 0.75, 0.95));
  }
  for (let i = 0; i < 5; i += 1) {
    spawnBot('them', BOT_NAMES_THEM[i], world.spawns.them[i], i === 0 ? 'rifle' : i === 2 ? 'shotgun' : i === 3 ? 'smg' : 'rifle', range(rng, 0.7, 0.95));
  }

  return {
    list: bots,
    reset,
    hearNoise(pos, radius, team) {
      for (const bot of bots) {
        if (!bot.alive || bot.team === team) continue;
        const d = Math.hypot(pos.x - bot.position.x, pos.z - bot.position.z);
        if (d < radius) bot.heard = { x: pos.x, z: pos.z };
      }
    },
    step(dt, ctx, time) {
      for (const bot of bots) stepBot(bot, dt, ctx, time);
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
  };
}
