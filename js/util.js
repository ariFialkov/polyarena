// Shared helpers: RNG, math, formatting, DOM shortcuts.

export const rand = Math.random;

export function randRange(a, b) { return a + rand() * (b - a); }

export function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }

export function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

// Box-Muller normal sample
let spare = null;
export function randNormal(mean = 0, sd = 1) {
  if (spare !== null) { const v = spare; spare = null; return mean + sd * v; }
  let u = 0, v = 0, s = 0;
  do {
    u = rand() * 2 - 1;
    v = rand() * 2 - 1;
    s = u * u + v * v;
  } while (s === 0 || s >= 1);
  const m = Math.sqrt(-2 * Math.log(s) / s);
  spare = v * m;
  return mean + sd * u * m;
}

export function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

export function lerp(a, b, t) { return a + (b - a) * t; }

export function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

export function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 10000) return sign + '$' + (n / 1000).toFixed(1) + 'k';
  return sign + '$' + n.toFixed(n % 1 ? 2 : 0);
}

export function fmtOdds(payout) { return '×' + (payout >= 20 ? payout.toFixed(0) : payout.toFixed(2)); }

// Game clock: seconds -> M:SS
export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

export function el(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

export function $(sel) { return document.querySelector(sel); }
