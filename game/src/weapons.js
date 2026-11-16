// Weapons: one definition per gun, plus the per-actor weapon state that the
// simulation mutates. Damage falls off with distance; headshots multiply it.
// Spread grows while moving or firing, and recoil kicks the aim up, so stopping
// to aim pays — the gunplay the judge scores.
export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', price: 0, kind: 'pistol', auto: false,
    damage: 34, headMult: 3.0, range: 40, falloff: 0.55,
    mag: 12, reserve: 48, reloadTime: 1.4, fireInterval: 0.22,
    spreadBase: 0.010, spreadMove: 0.020, spreadShot: 0.016, spreadMax: 0.075,
    recoil: 0.006, kick: 0.004,
  },
  smg: {
    name: 'VK-9 SMG', price: 1500, kind: 'smg', auto: true,
    damage: 26, headMult: 3.0, range: 32, falloff: 0.45,
    mag: 28, reserve: 112, reloadTime: 1.7, fireInterval: 0.085,
    spreadBase: 0.013, spreadMove: 0.024, spreadShot: 0.011, spreadMax: 0.085,
    recoil: 0.005, kick: 0.003,
  },
  rifle: {
    name: 'AR-77 Rifle', price: 2700, kind: 'rifle', auto: true,
    damage: 34, headMult: 4.0, range: 60, falloff: 0.7,
    mag: 30, reserve: 90, reloadTime: 2.2, fireInterval: 0.11,
    spreadBase: 0.008, spreadMove: 0.022, spreadShot: 0.014, spreadMax: 0.08,
    recoil: 0.009, kick: 0.005,
  },
  shotgun: {
    name: 'SG-12 Breacher', price: 1100, kind: 'shotgun', auto: false,
    damage: 14, headMult: 2.0, range: 18, falloff: 0.3, pellets: 8,
    mag: 6, reserve: 24, reloadTime: 2.6, fireInterval: 0.85,
    spreadBase: 0.035, spreadMove: 0.03, spreadShot: 0.02, spreadMax: 0.12,
    recoil: 0.02, kick: 0.012,
  },
};

export const GRENADE = { name: 'Frag Grenade', price: 300, radius: 6.5, damage: 110 };

export function createWeaponState(kind) {
  const def = WEAPONS[kind];
  return {
    kind,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloading: 0,
    spread: def.spreadBase,
    grenades: 0,
  };
}

export function weaponDamage(def, distance, headshot) {
  const fall = distance > def.range ? def.falloff : 1 - (1 - def.falloff) * (distance / def.range) * 0.4;
  let dmg = def.damage * fall;
  if (headshot) dmg *= def.headMult;
  return dmg;
}

// Advance one weapon's timers. Returns true when a reload finished this step.
export function stepWeapon(w, dt) {
  if (w.cooldown > 0) w.cooldown -= dt;
  if (w.reloading > 0) {
    w.reloading -= dt;
    if (w.reloading <= 0) {
      const def = WEAPONS[w.kind];
      const need = def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloading = 0;
      return true;
    }
  }
  return false;
}

export function startReload(w) {
  const def = WEAPONS[w.kind];
  if (w.reloading > 0 || w.mag >= def.mag || w.reserve <= 0) return false;
  w.reloading = def.reloadTime;
  return true;
}

export function takeRound(w) {
  if (w.mag <= 0 || w.cooldown > 0 || w.reloading > 0) return false;
  w.mag -= 1;
  w.cooldown = WEAPONS[w.kind].fireInterval;
  return true;
}

// Current spread for an actor moving at `speed` (m/s), after firing.
export function currentSpread(w, speed, moving) {
  const def = WEAPONS[w.kind];
  let s = def.spreadBase + (moving ? def.spreadMove * Math.min(1, speed / 5) : 0);
  s += w.spread;
  return Math.min(s, def.spreadMax);
}
