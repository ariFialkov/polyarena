// Mortal-Kombat style camera director.
//
// 'fight'    tracks the fighters' midpoint; distance AND field of view follow
//            their separation (tight telephoto when they're in each other's
//            face, wide when they spread out), with a slow orbit drift,
//            zoom-punches and dutch-tilt kicks on impacts.
// 'intro'    crane sweep in over the stage.
// 'focus'    close-up on one fighter (name call-outs, victory).
// 'ko'       slow low orbit around the fallen fighter.
// 'fatality' low dramatic angle, slow push-in.
// 'lobby'    lazy high orbit behind the betting table.
// 'wide'     establishing shot (decisions, between rounds).

import * as THREE from '../vendor/three.module.min.js';
import { clamp, lerp, randRange } from './util.js';

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

export class CameraDirector {
  constructor(camera) {
    this.cam = camera;
    this.pos = new THREE.Vector3(0, 4, 16);
    this.look = new THREE.Vector3(0, 1, 0);
    this.fov = 40;
    this.mode = 'lobby';
    this.modeT = 0;
    this.focusIdx = 0;
    this.fovKick = 0;
    this.roll = 0;
    this.shake = 0;
    this.orbitBias = 0;
    this.snap = 0;
    this.dist = 9;
    this._p = new THREE.Vector3();
    this._l = new THREE.Vector3();
  }

  setMode(mode, opts = {}) {
    if (mode !== this.mode || opts.restart) this.modeT = 0;
    this.mode = mode;
    if (opts.focus !== undefined) this.focusIdx = opts.focus;
    if (opts.snap) this.snap = opts.snap;
  }

  kick({ fov = 0, roll = 0, shake = 0, orbit = 0 } = {}) {
    this.fovKick += fov;
    this.roll += roll;
    this.shake = Math.max(this.shake, shake);
    this.orbitBias += orbit;
  }

  update(dt, t, fighters, aspect) {
    this.modeT += dt;
    const portrait = aspect < 0.9;
    const P = this._p, L = this._l;
    let fov = 40, rate = 4.5, lookRate = 6;
    const [a, b] = fighters;
    const ok = a && b;

    switch (this.mode) {
      case 'fight': {
        if (!ok) break;
        const ya = a.y + (a.rootY || 0), yb = b.y + (b.rootY || 0);
        const mid = (a.x + b.x) / 2, sep = Math.abs(a.x - b.x), air = Math.max(ya, yb);
        const s = smooth(0.9, 7, sep);
        fov = portrait ? lerp(52, 64, s) : lerp(29, 43, s);
        const vt = Math.tan(fov * DEG / 2), ht = vt * aspect;
        const W = sep / 2 + (portrait ? 0.95 : 1.45), H = 1.2 + air * 0.6;
        const dist = clamp(Math.max(W / ht, H / vt), 3.2, 19);
        this.dist = dist;
        const orbit = Math.sin(t * 0.21) * 0.09 + this.orbitBias;
        P.set(mid + Math.sin(orbit) * dist, 0.62 + dist * 0.105 + air * 0.45, Math.cos(orbit) * dist);
        L.set(mid, 1.02 + air * 0.5, 0);
        rate = this.snap > 0 ? 14 : 5;
        break;
      }
      case 'intro': {
        const k = smooth(0, 3.6, this.modeT);
        const ang = lerp(-0.95, -0.12, k);
        const dist = lerp(15, 8.5, k);
        P.set(Math.sin(ang) * dist, lerp(6.5, 2.1, k), Math.cos(ang) * dist);
        L.set(0, lerp(0.6, 1.1, k), 0);
        fov = lerp(46, 38, k);
        rate = 6;
        break;
      }
      case 'focus': {
        const f = fighters[this.focusIdx];
        if (!f) break;
        const side = f.x === 0 ? 1 : -Math.sign(f.x);   // shoot from the stage-center side
        const drift = Math.sin(this.modeT * 0.6) * 0.25;
        P.set(f.x + side * (0.9 + drift), 1.55, 2.7 - this.modeT * 0.08);
        L.set(f.x, 1.42, 0);
        fov = 30;
        rate = 5.5;
        break;
      }
      case 'ko': {
        const f = fighters[this.focusIdx];
        if (!f) break;
        const ang = 0.35 + this.modeT * 0.16;
        P.set(f.x + Math.sin(ang) * 3.6, 0.95, Math.cos(ang) * 3.6);
        L.set(f.x, 0.45, 0);
        fov = 34;
        rate = 2.6;
        break;
      }
      case 'fatality': {
        if (!ok) break;
        const mid = (a.x + b.x) / 2;
        const d = Math.max(3.6, 5.2 - this.modeT * 0.35);
        P.set(mid + 1.4, 0.45, d);
        L.set(mid, 1.5, 0);
        fov = 38;
        rate = 3;
        break;
      }
      case 'lobby': {
        const ang = Math.sin(this.modeT * 0.05) * 0.55;
        P.set(Math.sin(ang) * 12, 3.6 + Math.sin(this.modeT * 0.13) * 0.4, Math.cos(ang) * 12);
        L.set(0, 1.2, 0);
        fov = 42;
        rate = 2;
        break;
      }
      case 'wide':
      default: {
        const mid = ok ? (a.x + b.x) / 2 * 0.5 : 0;
        P.set(mid + Math.sin(this.modeT * 0.12) * 1.5, 2.5, 11.5);
        L.set(mid, 1.1, 0);
        fov = portrait ? 58 : 40;
        rate = 2.4;
        break;
      }
    }

    this.pos.x = damp(this.pos.x, P.x, rate, dt);
    this.pos.y = damp(this.pos.y, P.y, rate, dt);
    this.pos.z = damp(this.pos.z, P.z, rate * 0.85, dt);
    this.look.x = damp(this.look.x, L.x, lookRate, dt);
    this.look.y = damp(this.look.y, L.y, lookRate, dt);
    this.look.z = damp(this.look.z, L.z, lookRate, dt);
    this.fov = damp(this.fov, fov, 3.5, dt);

    // kicks decay back to rest
    this.fovKick *= Math.exp(-dt * 7);
    this.roll *= Math.exp(-dt * 5);
    this.orbitBias *= Math.exp(-dt * 1.5);
    this.shake = Math.max(0, this.shake - dt * 0.6);
    this.snap = Math.max(0, this.snap - dt);

    const c = this.cam;
    const sh = this.shake;
    c.position.set(
      this.pos.x + randRange(-1, 1) * sh,
      this.pos.y + randRange(-1, 1) * sh * 0.6,
      this.pos.z,
    );
    c.lookAt(this.look);
    if (this.roll) c.rotateZ(this.roll);
    c.fov = clamp(this.fov + this.fovKick, 18, 75);
    c.aspect = aspect;
    c.updateProjectionMatrix();
  }
}
