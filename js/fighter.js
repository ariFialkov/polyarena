// Fighter: procedural pose animator on a named driver rig, optionally wearing
// an imported skinned model (js/models.js retargets the driver onto it).
//
// Positions are WORLD units: x along the stage, y = airborne height,
// z = depth. The arena's movement director owns x/vx/y/vy; this class only
// turns state into poses.

import * as THREE from '../vendor/three.module.min.js';
import { clamp, rand } from './util.js';
import { buildCharacterRig } from './charrig.js';
import { Retargeter } from './models.js';

export const DUR = {
  strike: 0.34, hit: 0.3, hurt: 0.5, block: 0.4, down: 0.9,
  cast: 0.5, flying: 0.5, slam: 0.65, dash: 0.26, backdash: 0.3, land: 0.16, taunt: 1.6,
};
export const BUSY = new Set(['strike', 'hit', 'hurt', 'block', 'cast', 'flying', 'slam', 'dash', 'backdash', 'land', 'taunt']);
export const FROZEN = new Set(['down', 'win', 'launched']);

export class Fighter {
  constructor(def, idx) {
    this.def = def;
    this.idx = idx;
    this.x = idx === 0 ? -1.2 : 1.2;
    this.z = 0;
    this.y = 0; this.vx = 0; this.vy = 0; this.kb = 0;
    this.intent = 'hold'; this.intentT = 0; this.want = 4;
    this.facing = idx === 0 ? 1 : -1;
    this.anim = 'idle';
    this.animT = 0;
    this.phase = rand() * 10;
    this.strikeType = 'punch';
    this.dissolve = 0;
    this.lunge = 0;
    this.smYaw = this.facing * Math.PI / 2;
    this.yawOffset = 0;
    this.faceCam = false;
    this.camYaw = 0;          // extra yaw used when facing the camera (portraits)
    this.warmSeed = rand() * 20;

    buildCharacterRig(this);  // driver groups (+ primitive meshes as fallback)
    this.targets = {};
    this.rate = 14;
    this.retarget = null;
  }

  // ---------------------------------------------------------------- model
  attachModel(model) {
    const L = this.def.look || {};
    this.root.scale.setScalar(1);
    this.root.traverse(o => { if (o.isMesh) o.visible = false; }); // hide primitives
    this.retarget = new Retargeter(model, this, 1.92 * (L.h || 1));
    this.root.add(this.retarget.container);
    this.mats = [];
    model.traverse(o => { if (o.isMesh) this.mats.push(o.material); });
    this.hasModel = true;
  }

  // effect anchors (model bones when available)
  headWorld(out = new THREE.Vector3()) {
    if (this.retarget) return this.retarget.boneWorld('Head', out).add(new THREE.Vector3(0, 0.08, 0));
    return this.neck.getWorldPosition(out).add(new THREE.Vector3(0, 0.15, 0));
  }
  chestWorld(out = new THREE.Vector3()) {
    if (this.retarget) return this.retarget.boneWorld('Spine2', out);
    return this.chest.getWorldPosition(out);
  }
  handWorld(side, out = new THREE.Vector3()) {
    if (this.retarget) return this.retarget.boneWorld(side > 0 ? 'LeftHand' : 'RightHand', out);
    return this.arms[side].el.getWorldPosition(out);
  }

  startStrike(type) {
    this.anim = 'strike';
    this.animT = 0;
    this.strikeType = type;
    this.strikeSide = this.strikeSide === 1 ? -1 : 1;
  }

  play(anim) { this.anim = anim; this.animT = 0; }

  setT(bone, x, y, z) { this.targets[bone] = { x, y, z }; }

  // ---------------------------------------------------------------- frame
  update(dt) {
    this.animT += dt;
    const moving = Math.abs(this.vx) > 0.6 && this.y <= 0.01;
    this.phase += dt * (moving ? 3 + Math.abs(this.vx) * 2.2 : 2.4);
    if (this.dissolve > 0 && this.dissolve < 1) {
      this.dissolve = Math.min(1, this.dissolve + dt * 0.8);
      for (const m of this.mats) { m.transparent = true; m.opacity = 1 - this.dissolve; }
      if (this.dissolve >= 1) this.root.visible = false; // shadow maps ignore opacity
    }
    if (BUSY.has(this.anim) && this.animT > DUR[this.anim]) this.play('idle');

    this.computePose();
    this.applyTargets(dt);

    const dir = this.facing;
    this.root.position.set(this.x + this.lunge * dir, this.y + (this.rootY || 0), this.z);
    // face down the stage, angled a touch toward camera for readability
    const yaw = this.faceCam ? this.camYaw : dir * Math.PI / 2 - dir * 0.3;
    this.smYaw += (yaw - this.smYaw) * Math.min(1, dt * 12);
    this.root.rotation.y = this.smYaw + this.yawOffset;

    if (this.retarget) this.retarget.apply();
  }

  computePose() {
    const t = this.animT, ph = this.phase;
    this.rate = 14;
    this.rootY = 0;
    this.yawOffset = 0;
    this.lunge = Math.max(0, this.lunge - 0.05);

    // base: bladed fighting stance, hands up
    const bob = Math.sin(ph * 2) * 0.025;
    this.setT('hipsPos', 0, bob - 0.05, 0);
    this.setT('hips', 0, 0, 0);
    this.setT('spine', 0.08, 0, 0);
    this.setT('chest', 0.06, 0, 0);
    this.setT('neck', -0.1, 0, 0);
    this.setT('shL', -0.8, 0.4, -0.45);
    this.setT('elL', -1.9, 0, 0);
    this.setT('shR', -0.6, -0.45, 0.45);
    this.setT('elR', -1.75, 0, 0);
    this.setT('thL', -0.22, 0, 0.12);
    this.setT('knL', 0.3, 0, 0);
    this.setT('thR', 0.18, 0, -0.12);
    this.setT('knR', 0.24, 0, 0);

    switch (this.anim) {
      case 'idle': {
        const s = Math.sin(ph * 1.3) * 0.08;
        this.setT('shL', -0.8 + s, 0.4, -0.45);
        this.setT('shR', -0.6 - s, -0.45, 0.45);
        this.setT('chest', 0.06, Math.sin(ph * 0.6) * 0.06, 0);
        break;
      }
      case 'walk': this.poseWalk(ph); break;
      case 'dash': {
        const k = Math.sin(clamp(t / DUR.dash, 0, 1) * Math.PI);
        this.rate = 22;
        this.setT('chest', 0.06 + k * 0.35, 0, 0);
        this.setT('spine', 0.08 + k * 0.2, 0, 0);
        this.setT('thL', -0.22 - k * 0.7, 0, 0.12); this.setT('knL', 0.3 + k * 0.4, 0, 0);
        this.setT('thR', 0.18 + k * 0.6, 0, -0.12); this.setT('knR', 0.24 + k * 0.5, 0, 0);
        this.setT('hipsPos', 0, -0.1 * k, 0);
        break;
      }
      case 'backdash': {
        const k = Math.sin(clamp(t / DUR.backdash, 0, 1) * Math.PI);
        this.rate = 22;
        this.rootY = k * 0.18;
        this.setT('chest', 0.06 - k * 0.3, 0, 0);
        this.setT('thL', -0.22 + k * 0.5, 0, 0.12); this.setT('knL', 0.3 + k * 0.8, 0, 0);
        this.setT('thR', 0.18 - k * 0.6, 0, -0.12); this.setT('knR', 0.24 + k * 0.5, 0, 0);
        break;
      }
      case 'land': {
        const k = 1 - clamp(t / DUR.land, 0, 1);
        this.setT('hipsPos', 0, -0.2 * k - 0.05, 0);
        this.setT('knL', 0.3 + k * 0.8, 0, 0); this.setT('knR', 0.24 + k * 0.8, 0, 0);
        this.setT('thL', -0.22 - k * 0.4, 0, 0.12); this.setT('thR', 0.18 - k * 0.4, 0, -0.12);
        break;
      }
      case 'strike': this.poseStrike(t); break;
      case 'cast': {
        const k = clamp(t / DUR.cast, 0, 1);
        const push = k < 0.35 ? 0 : Math.sin(clamp((k - 0.35) / 0.5, 0, 1) * Math.PI);
        const gather = k < 0.35 ? Math.sin((k / 0.35) * Math.PI * 0.5) : 1 - push;
        this.rate = 22;
        this.setT('shL', -0.5 - gather * 0.4 - push * 1.05, 0.4 - push * 0.35, -0.5 + push * 0.4);
        this.setT('shR', -0.4 - gather * 0.4 - push * 1.1, -0.45 + push * 0.4, 0.5 - push * 0.4);
        this.setT('elL', -1.6 + push * 1.45, 0, 0);
        this.setT('elR', -1.5 + push * 1.4, 0, 0);
        this.setT('chest', 0.18 - push * 0.25, 0, 0);
        this.setT('hipsPos', 0, -0.12, 0);
        break;
      }
      case 'flying': {
        const k = clamp(t / DUR.flying, 0, 1);
        const arc = Math.sin(k * Math.PI);
        this.rate = 24;
        this.rootY = arc * 0.7;
        this.setT('thL', -1.55 * arc, 0, 0.1);
        this.setT('knL', 0.15, 0, 0);
        this.setT('thR', -0.5 * arc, 0, -0.1);
        this.setT('knR', 1.9 * arc, 0, 0);
        this.setT('chest', -0.35 * arc, 0, 0);
        this.setT('spine', -0.15 * arc, 0, 0);
        this.setT('shL', -0.3, 0.9, -1);
        this.setT('shR', -0.3, -0.9, 1);
        break;
      }
      case 'slam': {
        const k = clamp(t / DUR.slam, 0, 1);
        this.rate = 22;
        if (k < 0.5) {
          const up = Math.sin((k / 0.5) * Math.PI * 0.5);
          this.rootY = up * 0.95;
          this.setT('shL', -2.5 * up - 0.5, 0.3, -0.2);
          this.setT('shR', -2.4 * up - 0.4, -0.3, 0.2);
          this.setT('elL', -0.5, 0, 0); this.setT('elR', -0.5, 0, 0);
          this.setT('knL', 0.9 * up + 0.2, 0, 0); this.setT('knR', 0.9 * up + 0.2, 0, 0);
        } else {
          const dn = Math.min(1, (k - 0.5) / 0.15);
          this.rootY = (1 - dn) * 0.95;
          this.setT('hipsPos', 0, -0.3 * dn, 0);
          this.setT('shL', -0.3 + dn * 0.5, 0.3, -0.6);
          this.setT('shR', -0.2 + dn * 0.5, -0.3, 0.6);
          this.setT('elL', -0.3, 0, 0); this.setT('elR', -0.3, 0, 0);
          this.setT('chest', 0.4 * dn, 0, 0);
          this.setT('spine', 0.25 * dn, 0, 0);
          this.setT('knL', 0.9, 0, 0); this.setT('knR', 0.9, 0, 0);
        }
        break;
      }
      case 'hit': case 'hurt': {
        const big = this.anim === 'hurt';
        const k = Math.sin(clamp(t / DUR[this.anim], 0, 1) * Math.PI);
        this.rate = 20;
        this.setT('neck', -0.1 - k * (big ? 0.8 : 0.5), k * 0.25, 0);
        this.setT('chest', 0.06 - k * (big ? 0.55 : 0.3), -k * 0.3, 0);
        this.setT('spine', 0.08 - k * 0.25, 0, 0);
        this.setT('hipsPos', 0, -k * (big ? 0.14 : 0.05) - 0.05, 0);
        if (big) {
          this.setT('shL', -0.2, 0.5, -0.8);
          this.setT('shR', -0.15, -0.5, 0.8);
          this.setT('elL', -0.6, 0, 0); this.setT('elR', -0.6, 0, 0);
          this.setT('knL', 0.6, 0, 0); this.setT('knR', 0.55, 0, 0);
        }
        break;
      }
      case 'block': {
        this.setT('shL', -1.3, 0.15, -0.15);
        this.setT('elL', -2.3, 0, 0);
        this.setT('shR', -1.25, -0.15, 0.15);
        this.setT('elR', -2.25, 0, 0);
        this.setT('chest', 0.22, 0, 0);
        this.setT('hipsPos', 0, -0.12, 0);
        break;
      }
      case 'down': {
        const p = easeOutBack(clamp(t / DUR.down, 0, 1));
        this.rate = 10;
        if (t < 0.32) this.rootY = Math.sin((t / 0.32) * Math.PI) * 0.6;
        this.setT('hips', -1.5 * p, 0, 0);
        this.setT('hipsPos', 0, -0.72 * p, -0.3 * p);
        this.setT('spine', 0.15 * p, 0, 0);
        this.setT('chest', 0.1 * p, 0, 0);
        this.setT('neck', 0.5 * p, 0, 0);
        this.setT('shL', -0.3 + p * (-1.9), 0.3, -0.9 * p);
        this.setT('shR', -0.3 + p * (-1.7), -0.3, 0.9 * p);
        this.setT('elL', -0.3, 0, 0); this.setT('elR', -0.35, 0, 0);
        this.setT('thL', 1.15 * p - 0.1, 0, 0.12);
        this.setT('thR', 1.3 * p, 0, -0.12);
        this.setT('knL', 0.45 * (1 - p) + 0.25, 0, 0);
        this.setT('knR', 0.3, 0, 0);
        break;
      }
      case 'launched': {
        const p = clamp(t / 1.6, 0, 1);
        this.rate = 20;
        this.rootY = Math.sin(Math.min(p * 1.25, 1) * Math.PI) * 2.2;
        this.setT('hips', -p * 7, 0, p * 2);
        this.setT('shL', -2.6, 0.4, 0); this.setT('shR', -2.5, -0.4, 0);
        this.setT('elL', -0.3, 0, 0); this.setT('elR', -0.3, 0, 0);
        this.setT('thL', 0.4, 0, 0.3); this.setT('thR', 0.6, 0, -0.3);
        if (p > 0.35 && this.dissolve === 0) this.dissolve = 0.001;
        break;
      }
      case 'win': this.poseWin(t); break;
      case 'taunt': this.poseFlex(t); break;
      case 'warmup': this.poseWarmup(t + this.warmSeed); break;
    }

    // airborne overlay (jumps): tuck the legs
    if (this.y > 0.05 && !['flying', 'slam', 'launched', 'down', 'strike'].includes(this.anim)) {
      const k = clamp(this.y / 0.6, 0, 1);
      this.setT('thL', -0.22 - 0.9 * k, 0, 0.12); this.setT('knL', 0.3 + 1.3 * k, 0, 0);
      this.setT('thR', 0.18 - 0.7 * k, 0, -0.12); this.setT('knR', 0.24 + 1.1 * k, 0, 0);
    }
  }

  poseWalk(ph) {
    const sw = Math.sin(ph);
    const back = Math.sign(this.vx) !== this.facing ? -1 : 1;
    this.setT('thL', -0.22 + sw * 0.55 * back, 0, 0.12);
    this.setT('knL', 0.35 + Math.max(0, -sw) * 0.6, 0, 0);
    this.setT('thR', 0.18 - sw * 0.55 * back, 0, -0.12);
    this.setT('knR', 0.35 + Math.max(0, sw) * 0.6, 0, 0);
    this.setT('hipsPos', 0, Math.abs(Math.cos(ph)) * 0.05 - 0.06, 0);
    this.setT('chest', 0.06 + back * 0.08, 0, 0);
  }

  poseWin(t) {
    const j = Math.abs(Math.sin(t * 5.5));
    this.setT('shL', -2.7 + j * 0.25, 0.35, -0.2);
    this.setT('shR', -2.65 - j * 0.25, -0.35, 0.2);
    this.setT('elL', -0.35, 0, 0);
    this.setT('elR', -0.4, 0, 0);
    this.setT('hipsPos', 0, j * 0.16, 0);
    this.setT('neck', -0.25, 0, 0);
    this.setT('knL', 0.3 + j * 0.5, 0, 0);
    this.setT('knR', 0.3 + j * 0.5, 0, 0);
  }

  // double-biceps flex
  poseFlex(t) {
    const p = Math.sin(t * 3) * 0.06;
    this.rate = 10;
    this.setT('shL', -0.15, 0, -1.45 + p);
    this.setT('elL', 0, 0, -1.7);
    this.setT('shR', -0.15, 0, 1.45 - p);
    this.setT('elR', 0, 0, 1.7);
    this.setT('chest', -0.12, 0, 0);
    this.setT('neck', -0.2, Math.sin(t * 1.4) * 0.25, 0);
    this.setT('hipsPos', 0, -0.04, 0);
    this.setT('thL', -0.1, 0, 0.2); this.setT('thR', 0.06, 0, -0.2);
    this.setT('knL', 0.1, 0, 0); this.setT('knR', 0.1, 0, 0);
  }

  // Lobby warm-up loop: bounce + shadow-box, shoulder rolls, flex, beckon.
  poseWarmup(t) {
    const cycle = 9.6, u = t % cycle;
    this.rate = 12;
    const bounce = Math.abs(Math.sin(t * 6)) * 0.07;
    if (u < 3.6) {
      // bouncing on the toes, throwing quick 1-2s
      this.setT('hipsPos', 0, bounce - 0.06, 0);
      const k = (u * 2.6) % 2;
      const punch = Math.max(0, Math.sin(Math.min(1, k % 1 / 0.45) * Math.PI));
      const lead = k < 1 ? 'L' : 'R', sgn = lead === 'L' ? 1 : -1;
      this.setT('sh' + lead, -0.8 - punch * 0.85, sgn * (0.4 - punch * 0.4), -sgn * 0.45 * (1 - punch));
      this.setT('el' + lead, -1.9 + punch * 1.8, 0, 0);
      this.setT('chest', 0.06, -sgn * punch * 0.4, 0);
      this.rate = 18;
    } else if (u < 5.6) {
      // shoulder rolls + neck roll, loose arms
      const a = (u - 3.6) * 4;
      this.setT('shL', -0.2 + Math.sin(a) * 0.5, 0, -0.3 + Math.cos(a) * 0.2);
      this.setT('shR', -0.2 + Math.sin(a + Math.PI) * 0.5, 0, 0.3 - Math.cos(a) * 0.2);
      this.setT('elL', -0.4, 0, 0); this.setT('elR', -0.4, 0, 0);
      this.setT('neck', Math.sin(a * 0.5) * 0.25, Math.cos(a * 0.5) * 0.35, 0);
      this.setT('hipsPos', 0, bounce * 0.6 - 0.04, 0);
    } else if (u < 7.8) {
      this.poseFlex(u);
    } else {
      // come-get-some beckon with the lead hand
      const w = Math.sin((u - 7.8) * 9);
      this.setT('shL', -1.25, 0.2, -0.1);
      this.setT('elL', -0.7 - Math.max(0, w) * 1.1, 0, 0);
      this.setT('shR', -0.6, -0.45, 0.45);
      this.setT('elR', -1.8, 0, 0);
      this.setT('chest', -0.08, 0.15, 0);
      this.setT('neck', -0.15, 0, 0);
    }
  }

  poseStrike(t) {
    const k = Math.sin(clamp(t / DUR.strike, 0, 1) * Math.PI);
    const sharp = Math.pow(k, 1.5);
    const S = this.strikeSide || 1;
    const lead = S === 1 ? 'L' : 'R', rear = S === 1 ? 'R' : 'L';
    const sgn = S;
    this.rate = 28;
    this.lunge = sharp * 0.3;

    switch (this.strikeType) {
      case 'punch':
        this.setT('sh' + lead, -0.8 - sharp * 0.85, sgn * (0.4 - sharp * 0.4), -sgn * 0.45 * (1 - sharp));
        this.setT('el' + lead, -1.9 + sharp * 1.8, 0, 0);
        this.setT('chest', 0.06, -sgn * sharp * 0.45, 0);
        break;
      case 'palm':
        this.setT('sh' + rear, -0.6 - sharp * 1.0, -sgn * (0.45 - sharp * 0.5), sgn * 0.45 * (1 - sharp));
        this.setT('el' + rear, -1.75 + sharp * 1.65, 0, 0);
        this.setT('chest', 0.08, sgn * sharp * 0.8, 0);
        this.setT('hips', 0, sgn * sharp * 0.4, 0);
        break;
      case 'backfist':
        this.setT('sh' + lead, -1.35 * sharp - 0.4, sgn * (0.4 - sharp * 1.3), 0);
        this.setT('el' + lead, -1.5 + sharp * 1.1, 0, 0);
        this.setT('chest', 0.05, -sgn * sharp * 1.0, 0);
        this.setT('hips', 0, -sgn * sharp * 0.5, 0);
        break;
      case 'elbow':
        this.setT('sh' + lead, -1.25 * sharp - 0.5, sgn * (0.4 - sharp * 0.9), 0);
        this.setT('el' + lead, -2.3, 0, 0);
        this.setT('chest', 0.1, -sgn * sharp * 0.8, 0);
        this.lunge = sharp * 0.36;
        break;
      case 'uppercut':
        this.setT('sh' + rear, -0.2 - sharp * 1.5, 0, sgn * 0.2);
        this.setT('el' + rear, -2.3 + sharp * 0.6, 0, 0);
        this.setT('chest', 0.35 - sharp * 0.6, sgn * sharp * 0.5, 0);
        this.setT('hipsPos', 0, -0.16 * (1 - sharp) - 0.04, 0);
        this.rootY = sharp * 0.12;
        break;
      case 'roundhouse': {
        const leg = rear, lsgn = leg === 'L' ? 1 : -1;
        this.setT('th' + leg, -1.5 * sharp + 0.1, lsgn * sharp * 0.5, 0);
        this.setT('kn' + leg, 1.9 - sharp * 1.8, 0, 0);
        this.setT('chest', 0.05 - sharp * 0.35, lsgn * sharp * 0.7, 0);
        this.setT('hips', 0, lsgn * sharp * 0.5, -lsgn * sharp * 0.15);
        this.setT('shL', -0.9, 0.5, -0.5);
        this.setT('shR', -0.85, -0.5, 0.5);
        break;
      }
      case 'snapkick': {
        const leg = rear;
        this.setT('th' + leg, -1.35 * sharp, 0, 0);
        this.setT('kn' + leg, 1.9 - sharp * 1.85, 0, 0);
        this.setT('chest', 0.05 - sharp * 0.25, 0, 0);
        break;
      }
      case 'spinkick': {
        const p = clamp(t / DUR.strike, 0, 1);
        const leg = lead, lsgn = leg === 'L' ? 1 : -1;
        this.yawOffset = -this.facing * Math.PI * 2 * easeInOut(p);
        this.setT('th' + leg, -1.4 * sharp, lsgn * sharp * 0.4, 0);
        this.setT('kn' + leg, 0.2, 0, 0);
        this.setT('chest', -0.15 * sharp, 0, 0);
        this.setT('shL', -0.4, 0.8, -0.9);
        this.setT('shR', -0.4, -0.8, 0.9);
        this.lunge = sharp * 0.25;
        this.rootY = sharp * 0.2;
        break;
      }
      case 'sweep': {
        const leg = lead, lsgn = leg === 'L' ? 1 : -1;
        this.yawOffset = -this.facing * Math.PI * 0.9 * Math.sin(clamp(t / DUR.strike, 0, 1) * Math.PI);
        this.setT('hipsPos', 0, -0.38 * k, 0);
        this.setT('th' + leg, -0.5 * sharp - 0.1, lsgn * sharp * 0.6, 0);
        this.setT('kn' + leg, 0.15, 0, 0);
        this.setT('th' + (leg === 'L' ? 'R' : 'L'), -0.4, 0, 0);
        this.setT('kn' + (leg === 'L' ? 'R' : 'L'), 1.6 * k, 0, 0);
        this.setT('chest', 0.35 * k, 0, 0);
        break;
      }
    }
  }

  applyTargets(dt) {
    const k = Math.min(1, dt * this.rate);
    const T = this.targets;
    const ap = (obj, tg) => {
      if (!tg) return;
      obj.rotation.x += (tg.x - obj.rotation.x) * k;
      obj.rotation.y += (tg.y - obj.rotation.y) * k;
      obj.rotation.z += (tg.z - obj.rotation.z) * k;
    };
    ap(this.hips, T.hips);
    ap(this.spine, T.spine);
    ap(this.chest, T.chest);
    ap(this.neck, T.neck);
    ap(this.arms[-1].sh, T.shL); ap(this.arms[-1].el, T.elL);
    ap(this.arms[1].sh, T.shR); ap(this.arms[1].el, T.elR);
    ap(this.legs[-1].th, T.thL); ap(this.legs[-1].kn, T.knL);
    ap(this.legs[1].th, T.thR); ap(this.legs[1].kn, T.knR);
    if (T.hipsPos) {
      this.hips.position.x += (T.hipsPos.x - this.hips.position.x) * k;
      this.hips.position.y += (this.hipsBaseY + T.hipsPos.y - this.hips.position.y) * k;
      this.hips.position.z += (T.hipsPos.z - this.hips.position.z) * k;
    }
  }
}

function easeOutBack(t) {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
