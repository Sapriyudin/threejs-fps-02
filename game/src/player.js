// The player body: WASD movement with acceleration, crouching and jumping,
// AABB collision against the world's colliders, and health/armor. The camera
// eye sits on top of the body; the simulation never allocates in step().
import * as THREE from 'three';
import { clamp } from './rng.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.38;
const HEIGHT = 1.72;

export function createPlayer(colliders) {
  const state = {
    position: new THREE.Vector3(0, 0, 10),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    onGround: true,
    hp: 100,
    armor: 0,
    alive: true,
    recoilPitch: 0,
  };
  function collides(px, pz) {
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (px + RADIUS > c.min.x && px - RADIUS < c.max.x && pz + RADIUS > c.min.z && pz - RADIUS < c.max.z) {
        if (state.position.y < c.max.y && state.position.y + HEIGHT > c.min.y) return true;
      }
    }
    return false;
  }

  function moveAxis(dx, dz) {
    const nx = state.position.x + dx;
    if (!collides(nx, state.position.z)) state.position.x = nx;
    const nz = state.position.z + dz;
    if (!collides(state.position.x, nz)) state.position.z = nz;
  }

  return {
    state,
    reset(x, z, yaw) {
      const keepArmor = state.armor;
      state.position.set(x, 0, z);
      state.velocity.set(0, 0, 0);
      state.yaw = yaw;
      state.pitch = 0;
      state.eye = EYE_STAND;
      state.crouched = false;
      state.onGround = true;
      state.hp = 100;
      state.armor = keepArmor;
      state.alive = true;
      state.recoilPitch = 0;
    },
    look(dx, dy) {
      state.yaw -= dx * 0.0022;
      state.pitch = clamp(state.pitch - dy * 0.0022 + state.recoilPitch, -1.45, 1.45);
      state.recoilPitch = 0;
    },
    recoil(pitch, yaw) {
      state.recoilPitch += pitch;
      state.yaw += yaw;
    },
    damage(amount) {
      if (!state.alive) return 0;
      let left = amount;
      if (state.armor > 0) {
        const absorbed = Math.min(state.armor, left * 0.5);
        state.armor -= absorbed;
        left -= absorbed;
      }
      state.hp -= left;
      if (state.hp <= 0) {
        state.hp = 0;
        state.alive = false;
      }
      return left;
    },
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
    step(dt, keys) {
      if (!state.alive) return;
      const crouch = keys.has('ControlLeft') || keys.has('KeyC');
      state.crouched = crouch;
      state.eye += ((crouch ? EYE_CROUCH : EYE_STAND) - state.eye) * Math.min(1, dt * 12);
      const speed = crouch ? 2.1 : keys.has('ShiftLeft') ? 6.4 : 4.6;
      let fx = 0;
      let fz = 0;
      if (keys.has('KeyW')) fz -= 1;
      if (keys.has('KeyS')) fz += 1;
      if (keys.has('KeyA')) fx -= 1;
      if (keys.has('KeyD')) fx += 1;
      const len = Math.hypot(fx, fz) || 1;
      fx /= len;
      fz /= len;
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      // forward = (-sin, -cos), right = (cos, -sin); W is fz=-1.
      const wx = fx * cos + fz * sin;
      const wz = -fx * sin + fz * cos;
      const accel = state.onGround ? 10 : 4;
      state.velocity.x += (wx * speed - state.velocity.x) * Math.min(1, accel * dt);
      state.velocity.z += (wz * speed - state.velocity.z) * Math.min(1, accel * dt);
      if (keys.has('Space') && state.onGround) {
        state.velocity.y = 5.2;
        state.onGround = false;
      }
      state.velocity.y -= 14 * dt;
      moveAxis(state.velocity.x * dt, state.velocity.z * dt);
      state.position.y += state.velocity.y * dt;
      if (state.position.y <= 0) {
        state.position.y = 0;
        state.velocity.y = 0;
        state.onGround = true;
      }
    },
  };
}
