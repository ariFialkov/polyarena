// 2.5D canvas renderer: perspective ring, crowd, spotlights, and procedural
// vector fighters with animation states (idle/walk/strike/hit/block/down/win).
// All drawing is resolution-independent; world x is -1..1 across the ring.

import { clamp, lerp, rand, randRange } from './util.js';

const ANIM = {
  STRIKE_T: 0.38, HIT_T: 0.35, HURT_T: 0.6, MISS_T: 0.4,
};

export class Arena {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.fighters = [null, null];
    this.fx = [];          // particles / flashes
    this.shake = 0;
    this.flash = 0;        // white flash alpha
    this.redFlash = 0;
    this.slowmo = 1;
    this.crowdSeed = [];
    for (let i = 0; i < 260; i++) {
      this.crowdSeed.push({ x: rand(), y: rand(), p: rand(), s: randRange(0.5, 1) });
    }
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    this.cv.width = w * dpr;
    this.cv.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
    this.scaleBase = Math.min(h / 400, w / 620);
  }

  setFighters(A, B) {
    this.fighters = [makeFighter(A, 0), makeFighter(B, 1)];
    this.fx = [];
    this.shake = 0; this.flash = 0; this.redFlash = 0;
  }

  fighter(i) { return this.fighters[i]; }

  // ------ world -> screen ------
  // Ring floor: y=0 plane; depth z in [-1(front), 1(back)] shrinks things.
  proj(x, z, y = 0) {
    const cx = this.W / 2;
    const floorY = this.H * 0.78;
    const scale = 1 - z * 0.12;
    const sx = cx + x * this.W * 0.30 * scale;
    const sy = floorY - z * this.H * 0.06 - y * scale;
    return { x: sx, y: sy, s: scale };
  }

  // ------ animation triggers ------
  strike(by, type, landed, hurt = false) {
    const f = this.fighters[by], o = this.fighters[1 - by];
    if (!f || !o) return;
    f.anim = 'strike'; f.animT = 0; f.strikeType = type;
    if (landed) {
      o.anim = hurt ? 'hurt' : 'hit';
      o.animT = -ANIM.STRIKE_T * 0.5; // impact lands mid-swing
      setTimeout(() => this.impactFx(1 - by, hurt), 160);
    } else if (rand() < 0.5) {
      o.anim = 'block'; o.animT = 0;
    }
  }

  impactFx(victim, hurt) {
    const v = this.fighters[victim];
    if (!v) return;
    const p = this.proj(v.x, v.z, v.h * 0.72);
    const n = hurt ? 14 : 7;
    for (let i = 0; i < n; i++) {
      this.fx.push({
        kind: 'spark', x: p.x, y: p.y,
        vx: randRange(-90, 90), vy: randRange(-160, -20),
        life: randRange(0.25, 0.6), t: 0,
        color: hurt ? '#ff5a3c' : '#ffd75e', r: randRange(1.5, 3.5),
      });
    }
    this.shake = Math.max(this.shake, hurt ? 9 : 4);
  }

  knockdown(loserIdx) {
    const l = this.fighters[loserIdx];
    l.anim = 'down'; l.animT = 0;
    this.shake = 16; this.flash = 0.85; this.slowmo = 0.25;
    setTimeout(() => { this.slowmo = 1; }, 1400);
    const p = this.proj(l.x, l.z, 40);
    for (let i = 0; i < 26; i++) {
      this.fx.push({
        kind: 'spark', x: p.x, y: p.y,
        vx: randRange(-220, 220), vy: randRange(-260, -30),
        life: randRange(0.4, 1), t: 0, color: '#ffdf80', r: randRange(2, 5),
      });
    }
  }

  fatality(winnerIdx) {
    const w = this.fighters[winnerIdx], l = this.fighters[1 - winnerIdx];
    this.redFlash = 1;
    w.anim = 'win'; w.animT = 0;
    l.dissolve = 0.0001; // start dissolving
    const p = this.proj(l.x, l.z, l.h * 0.5);
    for (let i = 0; i < 70; i++) {
      this.fx.push({
        kind: 'soul', x: p.x + randRange(-20, 20), y: p.y + randRange(-50, 50),
        vx: randRange(-40, 40), vy: randRange(-140, -40),
        life: randRange(0.8, 2.2), t: 0, color: rand() < 0.5 ? '#ff2840' : '#ffb060', r: randRange(2, 5),
      });
    }
  }

  celebrate(winnerIdx) {
    const w = this.fighters[winnerIdx];
    if (w) { w.anim = 'win'; w.animT = 0; }
  }

  // ------ per-frame update ------
  update(dt, fighting) {
    dt *= this.slowmo;
    const [a, b] = this.fighters;
    if (a && b) {
      for (const f of this.fighters) {
        f.animT += dt;
        f.phase += dt * (f.anim === 'walk' ? 7 : 2.2);
        if (f.dissolve > 0) f.dissolve = Math.min(1, f.dissolve + dt * 0.7);
      }
      if (fighting) this.updateMovement(dt, a, b);
    }
    for (const p of this.fx) {
      p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'spark') p.vy += 500 * dt;
    }
    this.fx = this.fx.filter(p => p.t < p.life);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.redFlash = Math.max(0, this.redFlash - dt * 0.5);
  }

  // Simple footwork: keep striking range with drift, circle a little.
  updateMovement(dt, a, b) {
    for (const f of [a, b]) {
      if (['down', 'win'].includes(f.anim)) continue;
      const opp = f === a ? b : a;
      const dir = Math.sign(opp.x - f.x) || (f.idx === 0 ? 1 : -1);
      const dist = Math.abs(opp.x - f.x);
      const want = 0.34 + Math.sin(f.phase * 0.35 + f.idx * 3) * 0.1;
      let vx = 0;
      if (dist > want + 0.03) vx = dir * 0.24;
      else if (dist < want - 0.03) vx = -dir * 0.2;
      f.x = clamp(f.x + vx * dt, -0.85, 0.85);
      f.z = clamp(f.z + Math.sin(f.phase * 0.23 + f.idx * 5) * 0.05 * dt, -0.4, 0.5);
      f.facing = dir;
      if (['strike', 'hit', 'hurt', 'block'].includes(f.anim)) {
        const limit = { strike: ANIM.STRIKE_T, hit: ANIM.HIT_T, hurt: ANIM.HURT_T, block: 0.5 }[f.anim];
        if (f.animT > limit) { f.anim = 'idle'; f.animT = 0; }
      } else {
        f.anim = Math.abs(vx) > 0.05 ? 'walk' : 'idle';
      }
    }
  }

  // ------ drawing ------
  draw(t) {
    const { ctx, W, H } = this;
    if (!W) return;
    ctx.save();
    if (this.shake > 0) ctx.translate(randRange(-this.shake, this.shake), randRange(-this.shake, this.shake) * 0.6);

    this.drawBackdrop(t);
    this.drawRing(t);

    // painter's order by depth
    const fs = this.fighters.filter(Boolean).sort((p, q) => p.z - q.z).reverse();
    for (const f of fs) drawFighter(this, f, t);

    // fx
    for (const p of this.fx) {
      const a = 1 - p.t / p.life;
      this.ctx.globalAlpha = a;
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.r * (p.kind === 'soul' ? 1 + p.t : 1), 0, 7);
      this.ctx.fill();
      this.ctx.globalAlpha = 1;
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.redFlash > 0) {
      ctx.fillStyle = `rgba(160,10,20,${this.redFlash * 0.45})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  drawBackdrop(t) {
    const { ctx, W, H } = this;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#06070d');
    g.addColorStop(0.55, '#0d1020');
    g.addColorStop(1, '#151a2e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // arena bowl: tiered stands silhouette behind the ring
    const tiers = 5;
    const bandTop = H * 0.24, bandBot = H * 0.60;
    for (let i = 0; i < tiers; i++) {
      const y = bandTop + (i / tiers) * (bandBot - bandTop);
      const hgt = (bandBot - bandTop) / tiers + 2;
      ctx.fillStyle = `rgba(${18 + i * 4},${21 + i * 5},${38 + i * 8},1)`;
      ctx.fillRect(0, y, W, hgt);
    }
    // crowd: flickering heads seated along the tiers
    for (const c of this.crowdSeed) {
      const tier = Math.floor(c.y * tiers);
      const y = bandTop + ((tier + 0.55) / tiers) * (bandBot - bandTop) + c.p * 4;
      const x = c.x * W;
      const near = tier / tiers;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * (0.5 + c.p) + c.p * 20));
      ctx.fillStyle = `rgba(${110 + c.p * 90},${105 + c.s * 70},${150 + c.p * 80},${0.15 + 0.3 * tw * (0.4 + near)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.8 + near * 3.2 * c.s, 0, 7);
      ctx.fill();
    }
    // glow above the ring apron
    const glow = ctx.createLinearGradient(0, bandBot - 10, 0, bandBot + H * 0.1);
    glow.addColorStop(0, 'rgba(255,200,90,0)');
    glow.addColorStop(1, 'rgba(255,200,90,0.07)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, bandBot - 10, W, H * 0.1 + 10);

    // spotlights
    for (const [sx, hue] of [[0.22, '255,60,80'], [0.78, '80,140,255']]) {
      const gx = W * sx;
      const grad = ctx.createLinearGradient(gx, 0, gx, H * 0.85);
      grad.addColorStop(0, `rgba(${hue},0.16)`);
      grad.addColorStop(1, `rgba(${hue},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(gx - W * 0.02, 0);
      ctx.lineTo(gx + W * 0.02, 0);
      ctx.lineTo(gx + W * 0.2, H * 0.85);
      ctx.lineTo(gx - W * 0.2, H * 0.85);
      ctx.fill();
    }
  }

  drawRing(t) {
    const { ctx, W, H } = this;
    const fl = (x, z) => this.proj(x, z);
    // canvas floor (trapezoid)
    const p1 = fl(-1.25, 1), p2 = fl(1.25, 1), p3 = fl(1.55, -1.4), p4 = fl(-1.55, -1.4);
    const g = ctx.createLinearGradient(0, p1.y, 0, p3.y);
    g.addColorStop(0, '#2a2f45');
    g.addColorStop(0.5, '#353b58');
    g.addColorStop(1, '#252a40');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
    ctx.closePath(); ctx.fill();

    // center logo
    const c = fl(0, -0.1);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(1, 0.32);
    ctx.strokeStyle = 'rgba(255,200,60,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, W * 0.13, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,200,60,0.12)';
    ctx.font = `900 ${W * 0.05}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('POLYARENA', 0, 0);
    ctx.restore();

    // back ropes + posts
    const posts = [[-1.25, 1], [1.25, 1]];
    for (const [px, pz] of posts) {
      const b = fl(px, pz);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(b.x - 4, b.y - 92 * b.s, 8, 92 * b.s);
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath(); ctx.arc(b.x, b.y - 92 * b.s, 5, 0, 7); ctx.fill();
    }
    for (let i = 1; i <= 3; i++) {
      const y = i * 28;
      const a = fl(-1.25, 1), b = fl(1.25, 1);
      ctx.strokeStyle = ['#d84545', '#e8e8f0', '#4576d8'][i - 1];
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - y * a.s);
      ctx.quadraticCurveTo(W / 2, a.y - y * a.s + 6, b.x, b.y - y * b.s);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Fighters
// ---------------------------------------------------------------------------

function makeFighter(def, idx) {
  return {
    def, idx,
    x: idx === 0 ? -0.45 : 0.45,
    z: 0,
    facing: idx === 0 ? 1 : -1,
    h: 120,                    // pixel height at scale 1
    anim: 'idle', animT: 0, strikeType: 'jab',
    phase: rand() * 10,
    dissolve: 0,
  };
}

function drawFighter(arena, f, t) {
  const { ctx } = arena;
  const p = arena.proj(f.x, f.z);
  const s = p.s * arena.scaleBase;
  const skin = f.def.skin, trunks = f.def.trunks, hair = f.def.hair;

  if (f.dissolve >= 1) return;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(s * f.facing, s);
  if (f.dissolve > 0) ctx.globalAlpha = 1 - f.dissolve;

  // shadow
  ctx.save();
  ctx.scale(1 / (s || 1) * s, 1); // keep
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 4, 42, 10, 0, 0, 7);
  ctx.fill();
  ctx.restore();

  const bob = Math.sin(f.phase) * 3;
  let lean = 0, crouch = 0, armF = 0, armB = 0, legSpread = 22, fallen = 0, kick = 0;

  switch (f.anim) {
    case 'idle':
      armF = 0.15 + Math.sin(f.phase * 1.3) * 0.06;
      armB = 0.1 + Math.cos(f.phase * 1.1) * 0.05;
      break;
    case 'walk':
      legSpread = 22 + Math.sin(f.phase) * 10;
      armF = 0.18; armB = 0.12;
      break;
    case 'strike': {
      const k = Math.sin(Math.min(1, f.animT / ANIM.STRIKE_T) * Math.PI);
      if (['kick', 'knee'].includes(f.strikeType)) { kick = k; lean = -k * 0.15; }
      else { armF = 0.15 + k * 0.95; lean = k * 0.22; }
      crouch = k * 6;
      break;
    }
    case 'hit': case 'hurt': {
      const k = Math.sin(clamp(f.animT / ANIM.HIT_T, 0, 1) * Math.PI);
      lean = -k * (f.anim === 'hurt' ? 0.4 : 0.22);
      crouch = k * (f.anim === 'hurt' ? 12 : 5);
      armF = 0.2; armB = 0.15;
      break;
    }
    case 'block':
      armF = 0.45; armB = 0.4; crouch = 4;
      break;
    case 'down':
      fallen = clamp(f.animT / 0.6, 0, 1);
      break;
    case 'win':
      armF = 0.15 + Math.abs(Math.sin(f.animT * 6)) * 0.9;
      armB = armF;
      crouch = -Math.abs(Math.sin(f.animT * 6)) * 6;
      break;
  }

  if (fallen > 0) {
    // rotate onto back
    ctx.rotate(-fallen * Math.PI / 2 * 0.94);
    ctx.translate(fallen * -10, fallen * -6);
  }
  ctx.rotate(lean * 0.35);

  const hipY = -46 + crouch * 0.5 + bob * 0.3;
  const chestY = -86 + crouch + bob;
  const headY = -108 + crouch + bob;

  ctx.lineCap = 'round';

  // back arm (behind torso)
  limb(ctx, 8, chestY + 6, -14 - armB * 10, chestY + 26 - armB * 40, -6 - armB * 46, chestY + 34 - armB * 66, 7, shade(skin, -18));

  // legs
  const legLift = kick * 40;
  limb(ctx, -2, hipY, -legSpread * 0.5, -22, -legSpread * 0.6 - 4, 0, 9, shade(trunks, -12)); // back leg
  limb(ctx, 4, hipY, legSpread * 0.6 + kick * 18, -24 - legLift, legSpread * 0.8 + kick * 34, -legLift * 0.9, 9, trunks); // front leg

  // torso
  ctx.strokeStyle = skin;
  ctx.lineWidth = 17;
  ctx.beginPath();
  ctx.moveTo(0, hipY);
  ctx.lineTo(3, chestY);
  ctx.stroke();
  // trunks
  ctx.strokeStyle = trunks;
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(-1, hipY + 6);
  ctx.lineTo(0, hipY - 8);
  ctx.stroke();
  // chest highlight
  ctx.strokeStyle = shade(skin, 12);
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(2, chestY + 16);
  ctx.lineTo(3, chestY + 2);
  ctx.stroke();

  // head
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(6 + lean * 8, headY, 11, 0, 7);
  ctx.fill();
  // hair
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.arc(4 + lean * 8, headY - 3, 11, Math.PI * 0.95, Math.PI * 2.02);
  ctx.fill();
  // eye
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(11 + lean * 8, headY - 1, 1.6, 0, 7);
  ctx.fill();

  // front arm (glove color = accent)
  const punchX = 10 + armF * 52, punchY = chestY + 8 - armF * 14;
  limb(ctx, 6, chestY + 4, 16 + armF * 22, chestY + 18 - armF * 12, punchX, punchY, 7, skin);
  ctx.fillStyle = f.def.accent;
  ctx.beginPath();
  ctx.arc(punchX, punchY, 7.5, 0, 7);
  ctx.fill();
  // back glove
  ctx.fillStyle = shade(f.def.accent, -25);
  ctx.beginPath();
  ctx.arc(-6 - armB * 46, chestY + 34 - armB * 66, 6.5, 0, 7);
  ctx.fill();

  ctx.restore();
}

function limb(ctx, x1, y1, x2, y2, x3, y3, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(x2, y2, x3, y3);
  ctx.stroke();
}

const shadeCache = new Map();
function shade(hex, amt) {
  const key = hex + amt;
  if (shadeCache.has(key)) return shadeCache.get(key);
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  const out = `rgb(${r},${g},${b})`;
  shadeCache.set(key, out);
  return out;
}
