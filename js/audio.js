// WebAudio synth SFX — no assets needed. Muted until first user gesture.

let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSound(on) { enabled = on; }
export function soundOn() { return enabled; }

function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
  const a = ac();
  if (!a || !enabled) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, vol = 0.25, delay = 0) {
  const a = ac();
  if (!a || !enabled) return;
  const t0 = a.currentTime + delay;
  const len = a.sampleRate * dur;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = a.createBufferSource();
  s.buffer = buf;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t0);
  s.connect(g).connect(a.destination);
  s.start(t0);
}

export const sfx = {
  chip() { tone(1900, 0.05, 'square', 0.06); tone(2400, 0.05, 'square', 0.05, null, 0.03); },
  bell() { for (let i = 0; i < 3; i++) { tone(880, 0.7, 'triangle', 0.22, 870, i * 0.45); tone(1320, 0.5, 'sine', 0.1, null, i * 0.45); } },
  bellEnd() { tone(880, 1.1, 'triangle', 0.25, 860); },
  hit() { noise(0.09, 0.18); tone(160, 0.1, 'square', 0.12, 90); },
  bigHit() { noise(0.16, 0.3); tone(110, 0.22, 'square', 0.2, 55); },
  whiff() { noise(0.06, 0.06); },
  ko() { noise(0.5, 0.4); tone(70, 0.8, 'sawtooth', 0.3, 35); },
  fatality() { tone(220, 1.4, 'sawtooth', 0.25, 40); noise(0.9, 0.3, 0.1); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.16, null, i * 0.13)); },
  lose() { [400, 340, 260].forEach((f, i) => tone(f, 0.4, 'triangle', 0.14, null, i * 0.2)); },
  cash() { [1200, 1600, 2100].forEach((f, i) => tone(f, 0.12, 'square', 0.09, null, i * 0.07)); },
  tick() { tone(1000, 0.07, 'square', 0.08); },
  whoosh() { noise(0.18, 0.12); tone(300, 0.22, 'sine', 0.08, 900); },
  fireball() { tone(180, 0.4, 'sawtooth', 0.14, 700); noise(0.3, 0.1, 0.05); },
  teleport() { tone(1400, 0.25, 'sine', 0.12, 200); tone(200, 0.25, 'sine', 0.1, 1400, 0.22); },
  slam() { noise(0.35, 0.35); tone(90, 0.45, 'square', 0.25, 40); },
};
