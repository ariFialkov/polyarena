// Screen-space VFX layer (2D canvas over the whole stage): bot chips flying
// to their zones with glowing trails, spark bursts, heat embers, rings,
// coin/confetti showers. Coordinates are CSS pixels relative to #stage.

import { rand, randRange } from './util.js';

export class FX {
  constructor(canvas, stageEl) {
    this.cv = canvas;
    this.stage = stageEl;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.flights = [];
    this.rings = [];
    this.resize();
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
    this.ox = r.left; this.oy = r.top;
  }

  // element center in stage coords
  center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left - this.ox + r.width / 2, y: r.top - this.oy + r.height / 2, w: r.width, h: r.height };
  }

  // A chip arcs from `from` to `to`, then calls onLand.
  flyChip(from, to, { color = '#ffd54a', label = '', dur = 0.7, onLand } = {}) {
    const mx = (from.x + to.x) / 2 + randRange(-60, 60);
    const my = Math.min(from.y, to.y) - randRange(60, 140);
    this.flights.push({ from, to, cx: mx, cy: my, t: 0, dur, color, label, onLand, trail: [] });
  }

  sparks(x, y, { n = 18, color = '#ffd54a', speed = 220, life = 0.6, size = 2.4, gravity = 380 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, s = randRange(0.3, 1) * speed;
      this.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life, t: 0, color, size: randRange(size * 0.5, size * 1.3), g: gravity });
    }
  }

  embers(x, y, w, { n = 3, color = '#ff8a1f' } = {}) {
    for (let i = 0; i < n; i++) {
      this.parts.push({ kind: 'ember', x: x + randRange(-w / 2, w / 2), y, vx: randRange(-12, 12), vy: randRange(-70, -35), life: randRange(0.7, 1.3), t: 0, color, size: randRange(1.5, 3.4), g: -10, ph: rand() * 9 });
    }
  }

  ring(x, y, { color = '#ffd54a', r0 = 10, r1 = 90, life = 0.55, width = 3 } = {}) {
    this.rings.push({ x, y, color, r0, r1, life, t: 0, width });
  }

  coins(x, y, n = 40) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + randRange(-1.1, 1.1), s = randRange(260, 620);
      this.parts.push({ kind: 'coin', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: randRange(1.4, 2.2), t: 0, size: randRange(5, 9), g: 900, spin: rand() * 9, spd: randRange(6, 14) });
    }
  }

  confetti(x, y, n = 60) {
    const cols = ['#ff2d6f', '#19e3ff', '#ffd54a', '#3dff9a', '#a35cff', '#ffffff'];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + randRange(-1.3, 1.3), s = randRange(200, 560);
      this.parts.push({ kind: 'conf', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: randRange(1.6, 2.6), t: 0, color: cols[i % cols.length], size: randRange(4, 8), g: 520, spin: rand() * 9, spd: randRange(5, 12), drag: 0.985 });
    }
  }

  update(dt) {
    for (const f of this.flights) {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = 1 - Math.pow(1 - k, 2);
      const u = 1 - e;
      f.x = u * u * f.from.x + 2 * u * e * f.cx + e * e * f.to.x;
      f.y = u * u * f.from.y + 2 * u * e * f.cy + e * e * f.to.y;
      f.trail.push({ x: f.x, y: f.y });
      if (f.trail.length > 14) f.trail.shift();
      if (k >= 1 && !f.done) {
        f.done = true;
        this.sparks(f.to.x, f.to.y, { n: 16, color: f.color, speed: 200 });
        this.ring(f.to.x, f.to.y, { color: f.color, r1: 70 });
        if (f.onLand) f.onLand();
      }
    }
    this.flights = this.flights.filter(f => !f.done);
    for (const p of this.parts) {
      p.t += dt;
      p.vy += p.g * dt;
      if (p.drag) { p.vx *= p.drag; p.vy *= p.drag; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'ember') p.x += Math.sin(p.t * 6 + p.ph) * 0.6;
    }
    this.parts = this.parts.filter(p => p.t < p.life && p.y < this.H + 40);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter(r => r.t < r.life);
  }

  draw() {
    const c = this.ctx;
    const idle = !this.parts.length && !this.flights.length && !this.rings.length;
    if (idle && this.clean) return;       // nothing drawn last frame either
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    this.clean = idle;
    if (idle) return;

    c.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const k = r.t / r.life;
      c.strokeStyle = r.color;
      c.globalAlpha = (1 - k) * 0.9;
      c.lineWidth = r.width * (1 - k * 0.6);
      c.beginPath();
      c.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2)), 0, Math.PI * 2);
      c.stroke();
    }
    for (const p of this.parts) {
      if (p.kind !== 'spark' && p.kind !== 'ember') continue;
      const a = 1 - p.t / p.life;
      c.globalAlpha = p.kind === 'ember' ? a * (0.6 + 0.4 * Math.sin(p.t * 20 + p.ph)) : a;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size * (p.kind === 'ember' ? 1 : a + 0.3), 0, Math.PI * 2);
      c.fill();
    }
    for (const f of this.flights) {
      for (let i = 1; i < f.trail.length; i++) {
        const a = f.trail[i - 1], b = f.trail[i];
        c.globalAlpha = (i / f.trail.length) * 0.8;
        c.strokeStyle = f.color;
        c.lineWidth = 2 + i * 0.7;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    for (const f of this.flights) drawChip(c, f.x, f.y, 12, f.color, f.label);
    for (const p of this.parts) {
      if (p.kind === 'coin') {
        const a = Math.min(1, (p.life - p.t) * 2);
        c.globalAlpha = a;
        const sx = Math.abs(Math.cos(p.t * p.spd + p.spin));
        const g = c.createRadialGradient(p.x - p.size * 0.3, p.y - p.size * 0.3, 1, p.x, p.y, p.size);
        g.addColorStop(0, '#fff6c9'); g.addColorStop(0.5, '#ffd54a'); g.addColorStop(1, '#b67a00');
        c.fillStyle = g;
        c.beginPath(); c.ellipse(p.x, p.y, p.size * (0.25 + sx * 0.75), p.size, 0, 0, Math.PI * 2); c.fill();
      } else if (p.kind === 'conf') {
        c.globalAlpha = Math.min(1, (p.life - p.t) * 1.5);
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.t * p.spd + p.spin);
        c.fillStyle = p.color;
        c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * Math.abs(Math.cos(p.t * p.spd)) + 1);
        c.restore();
      }
    }
    c.globalAlpha = 1;
  }
}

function drawChip(c, x, y, r, color, label) {
  c.save();
  c.shadowColor = color; c.shadowBlur = 14;
  c.fillStyle = color;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.shadowBlur = 0;
  c.setLineDash([4, 3]);
  c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 2.5;
  c.beginPath(); c.arc(x, y, r - 2, 0, Math.PI * 2); c.stroke();
  c.setLineDash([]);
  if (label) {
    c.fillStyle = '#fff';
    c.font = '700 11px Rajdhani, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, x, y + 1);
  }
  c.restore();
}
