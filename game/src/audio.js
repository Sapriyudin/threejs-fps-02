// Procedural WebAudio sounds: no audio files, no network. Every effect is a
// short oscillator / noise burst shaped by an envelope, mixed into one master
// gain so the game stays quiet when the tab is muted or audio is unavailable.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function tone(freq, dur, type, vol, slideTo) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, vol, freq, q) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q || 1;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'rifle') { noise(0.12, 0.9, 900, 0.7); tone(160, 0.08, 'square', 0.25, 60); }
      else if (kind === 'smg') { noise(0.08, 0.7, 1400, 0.8); tone(220, 0.05, 'square', 0.2, 90); }
      else if (kind === 'shotgun') { noise(0.22, 1.0, 500, 0.6); tone(110, 0.14, 'square', 0.3, 40); }
      else { noise(0.09, 0.8, 1100, 0.8); tone(200, 0.06, 'square', 0.22, 80); }
    },
    enemyShot() { noise(0.1, 0.35, 800, 0.7); },
    reload() { tone(500, 0.05, 'square', 0.12); setTimeout(() => tone(700, 0.05, 'square', 0.12), 160); },
    hit() { tone(1200, 0.05, 'sine', 0.25); },
    kill() { tone(880, 0.07, 'sine', 0.25); setTimeout(() => tone(1320, 0.09, 'sine', 0.25), 70); },
    hurt() { tone(180, 0.12, 'sawtooth', 0.25, 90); },
    footstep() { noise(0.05, 0.12, 300, 1); },
    plant() { tone(660, 0.1, 'sine', 0.2); setTimeout(() => tone(660, 0.1, 'sine', 0.2), 180); },
    beep() { tone(990, 0.08, 'sine', 0.22); },
    explode() { noise(0.7, 1.0, 180, 0.5); tone(60, 0.5, 'sine', 0.5, 30); },
    grenade() { noise(0.3, 0.6, 400, 0.8); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.14, 'sine', 0.22), i * 110)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'sine', 0.2), i * 120)); },
    click() { tone(800, 0.03, 'square', 0.1); },
  };
}
