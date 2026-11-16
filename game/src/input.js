// Keyboard + mouse input with pointer lock. The game reads keys as a Set of
// codes and mouse look as accumulated deltas, so the simulation never touches
// DOM events directly.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    lookX: 0,
    lookY: 0,
    locked: false,
  };

  function onKeyDown(e) {
    if (e.code === 'Space') e.preventDefault();
    state.keys.add(e.code);
  }
  function onKeyUp(e) {
    state.keys.delete(e.code);
  }
  function onMouseMove(e) {
    if (!state.locked) return;
    state.lookX += e.movementX || 0;
    state.lookY += e.movementY || 0;
  }
  function onMouseDown(e) {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
  }
  function onMouseUp(e) {
    if (e.button === 0) state.firing = false;
  }
  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) state.firing = false;
    if (onLockChange) onLockChange(state.locked);
  }
  function onBlur() {
    state.keys.clear();
    state.firing = false;
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);
  window.addEventListener('blur', onBlur);

  return {
    state,
    requestLock() {
      try { canvas.requestPointerLock(); } catch { /* pointer lock unavailable */ }
    },
    takeLook() {
      const out = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return out;
    },
  };
}
