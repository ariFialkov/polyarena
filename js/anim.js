// Mixamo animation runtime.
//
// The library (assets/anims/anims.bin + anims.json, built by
// tools/convert-anims.mjs) holds 122 clips recorded on one Mixamo skeleton.
// Each fighter gets a ClipRig: an invisible copy of that skeleton driven by a
// THREE.AnimationMixer (so clips crossfade), and an AnimRetarget that copies
// the skeleton's pose onto the fighter's own model every frame:
//
//     Qt_char(t) = Qs(t) * inv(Qs_rest) * R * Qt_rest
//
// in the character's frame, where R aligns each target bone's rest direction
// with the source's. That keeps the clip's motion while each model keeps its
// own proportions and bone rolls. `mirror` reflects the motion across the
// character's sagittal plane (and swaps Left/Right) so the fighter on the
// right side of the screen mirrors the one on the left, like a 2D fighter.

import * as THREE from '../vendor/three.module.min.js';

const BASE = 'assets/anims/';
const QS = Math.SQRT1_2 / 32767;
const SRC_HIPS_Y = 104.275;                 // Mixamo Y Bot rest hips height (cm)

let libPromise = null;
export let LIB = null;

export function loadAnimLib() {
  if (!libPromise) {
    libPromise = Promise.all([
      fetch(BASE + 'anims.json').then(r => { if (!r.ok) throw new Error('anims.json ' + r.status); return r.json(); }),
      fetch(BASE + 'anims.bin').then(r => { if (!r.ok) throw new Error('anims.bin ' + r.status); return r.arrayBuffer(); }),
    ]).then(([meta, buf]) => (LIB = buildLib(meta, buf)));
  }
  return libPromise;
}

function unpackQuat(d, o, out, j) {
  const big = d[o] & 3;
  const a = (d[o] & ~3) * QS, b = d[o + 1] * QS, c = d[o + 2] * QS;
  const w = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
  const r = [a, b, c];
  for (let i = 0, k = 0; i < 4; i++) out[j + i] = i === big ? w : r[k++];
}

function buildLib(meta, buf) {
  const clips = {};
  const nb = meta.body.length, nf = meta.fingers.length;
  for (const [id, c] of Object.entries(meta.clips)) {
    const F = c.frames;
    const d = new Int16Array(buf, c.offset, F * (nb * 3 + 1) + nf * 3);
    const times = new Float32Array(F);
    for (let i = 0; i < F; i++) times[i] = Math.min(c.dur, i / meta.fps);
    const rot = meta.body.map(() => new Float32Array(F * 4));
    const hips = new Float32Array(F * 3);
    let o = 0;
    for (let i = 0; i < F; i++) {
      for (let j = 0; j < nb; j++) { unpackQuat(d, o, rot[j], i * 4); o += 3; }
      hips[i * 3 + 1] = d[o++] / 10;
    }
    const tracks = meta.body.map((n, j) => new THREE.QuaternionKeyframeTrack(n + '.quaternion', times, rot[j]));
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hips));
    for (const n of meta.fingers) {
      const q = new Float32Array(4);
      unpackQuat(d, o, q, 0); o += 3;
      tracks.push(new THREE.QuaternionKeyframeTrack(n + '.quaternion', [0], q));
    }
    clips[id] = new THREE.AnimationClip(id, c.dur, tracks);
  }
  return { meta, clips, alt: {} };
}

export function clipMeta(id) { return LIB && LIB.meta.clips[id]; }
export function hasClip(id) { return !!(LIB && LIB.clips[id]); }

function makeSkeleton() {
  const root = new THREE.Group();
  const bones = {};
  const list = LIB.meta.skeleton.map(s => {
    const b = new THREE.Bone();
    b.name = s.name;
    b.position.fromArray(s.pos);
    b.quaternion.fromArray(s.quat);
    bones[s.name] = b;
    return b;
  });
  LIB.meta.skeleton.forEach((s, i) => (s.parent >= 0 ? list[s.parent] : root).add(list[i]));
  root.updateMatrixWorld(true);
  return { root, bones };
}

// root travel (cm, [lateral, forward]) at time t, from the 15 fps path
function rootAt(m, t) {
  const r = m.root, f = Math.max(0, Math.min(r.length - 1, t * 15));
  const i = Math.floor(f), k = f - i, j = Math.min(r.length - 1, i + 1);
  return [r[i][0] + (r[j][0] - r[i][0]) * k, r[i][1] + (r[j][1] - r[i][1]) * k];
}

// ---------------------------------------------------------------------------
// ClipRig: one invisible Mixamo skeleton + mixer per fighter.
// ---------------------------------------------------------------------------
export class ClipRig {
  constructor() {
    const s = makeSkeleton();
    this.root = s.root;
    this.bones = s.bones;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.cur = null;
    this.id = null;
    this.flip = false;
    this.rm = 0;
    this.rmPrev = [0, 0];
    this.hipsY = true;
  }

  // opts: fade (s), loop, ts (time scale), start (s), rm (root-motion scale), hipsY
  play(id, { fade = 0.15, loop = false, ts = 1, start = 0, rm = 0, hipsY = true } = {}) {
    let clip = LIB.clips[id];
    if (!clip) return false;
    // replaying the clip that is still fading uses an alternate copy so the
    // two can crossfade (an action can't fade into itself)
    if (this.id === id && this.cur) {
      this.flip = !this.flip;
      if (this.flip) clip = LIB.alt[id] || (LIB.alt[id] = clip.clone());
    } else this.flip = false;
    const act = this.mixer.clipAction(clip);
    act.reset();
    act.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    act.clampWhenFinished = !loop;
    act.timeScale = ts;
    act.time = start;
    act.setEffectiveWeight(1);
    act.play();
    if (this.cur && this.cur !== act && fade > 0) {
      this.cur.fadeOut(fade);
      act.fadeIn(fade);
    } else if (this.cur && this.cur !== act) {
      this.cur.stop();
    }
    this.cur = act;
    this.id = id;
    this.meta = LIB.meta.clips[id];
    this.loop = loop;
    this.rm = rm;
    this.rmPrev = rootAt(this.meta, start);
    this.hipsY = hipsY;
    return true;
  }

  set timeScale(v) { if (this.cur) this.cur.timeScale = v; }
  get time() { return this.cur ? this.cur.time : 0; }
  get done() { return !this.cur || (!this.loop && this.cur.time >= this.meta.dur - 1e-3); }

  // Advance; returns this frame's root-motion delta [lateral, forward] in cm.
  update(dt) {
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    if (!this.cur || !this.rm) return null;
    const r = rootAt(this.meta, this.cur.time);
    const d = [(r[0] - this.rmPrev[0]) * this.rm, (r[1] - this.rmPrev[1]) * this.rm];
    this.rmPrev = r;
    return d;
  }
}

// ---------------------------------------------------------------------------
// AnimRetarget: ClipRig pose -> a model's skeleton, in the container's frame.
// ---------------------------------------------------------------------------
const strip = n => n.replace(/^(mixamorig|smartrig)[:_]?/i, '');
const swap = n => n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n;
const mirrorQ = (q, out = new THREE.Quaternion()) => out.set(q.x, -q.y, -q.z, q.w);
const CHILD = { Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head' };

export class AnimRetarget {
  // rig: ClipRig; model: the fighter's model (rest pose); container: the
  // Group whose local frame is the character frame (model faces +Z in it).
  constructor(rig, model, container, restPose) {
    this.rig = rig;
    this.model = model;
    this.container = container;
    // measure the model in its bind pose
    const saved = restPose.map(([b]) => [b, b.position.clone(), b.quaternion.clone()]);
    for (const [b, p, q] of restPose) { b.position.copy(p); b.quaternion.copy(q); }
    container.updateMatrixWorld(true);

    const tgt = {};
    model.traverse(o => { if (o.isBone) tgt[strip(o.name)] = o; });
    this.tgt = tgt;
    const cInv = container.getWorldQuaternion(new THREE.Quaternion()).invert();
    const relQ = b => cInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
    const relP = b => container.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
    const childOf = (map, n) => (CHILD[n] && map[CHILD[n]]) || (map[n] && map[n].children.find(c => c.isBone));

    // source rest (the rig's own skeleton in its root frame = identity)
    const src = rig.bones;
    const sRestQ = {}, sRestDir = {};
    rig.root.updateMatrixWorld(true);
    for (const [n, b] of Object.entries(src)) {
      sRestQ[n] = b.getWorldQuaternion(new THREE.Quaternion());
      const c = childOf(src, n);
      if (c) sRestDir[n] = c.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
    }
    this.restLocal = new Map();
    model.traverse(o => { if (o.isBone) this.restLocal.set(o, o.quaternion.clone()); });

    this.entries = new Map();
    for (const [n, b] of Object.entries(tgt)) {
      if (!src[n]) continue;
      const Qt = relQ(b);
      const c = childOf(tgt, n);
      const dt = c ? relP(c).sub(relP(b)).normalize() : null;
      const mk = (sn, mir) => {
        let Qs = sRestQ[sn], ds = sRestDir[sn];
        if (!Qs) return null;
        if (mir) { Qs = mirrorQ(Qs); ds = ds && new THREE.Vector3(-ds.x, ds.y, ds.z); }
        const R = new THREE.Quaternion();
        if (dt && ds) R.setFromUnitVectors(dt, ds);
        return { bone: src[sn], mir, QsInv: Qs.clone().invert(), RQt: R.multiply(Qt) };
      };
      this.entries.set(b, { n: mk(n, false), m: mk(swap(n), true) });
    }

    this.hips = tgt.Hips;
    this.hipsRest = relP(this.hips);
    // hips height above the toes, measured on both skeletons (skinned-mesh
    // bounding boxes are cached and unreliable before the first render)
    const toeY = (map, P) => Math.min(...['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']
      .filter(n => map[n]).map(n => P(map[n]).y));
    const sToe = toeY(src, b => b.getWorldPosition(new THREE.Vector3()));
    this.scale = (this.hipsRest.y - toeY(tgt, relP)) / (SRC_HIPS_Y - sToe);   // container units per source cm
    this.srcHipsRestY = src.Hips.position.y;

    for (const [b, p, q] of saved) { b.position.copy(p); b.quaternion.copy(q); }
    this._q = new THREE.Quaternion(); this._w = new THREE.Quaternion(); this._p = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._outs = new Map();
  }

  // per-bone scratch world quaternion
  outQ(bone) {
    let q = this._outs.get(bone);
    if (!q) this._outs.set(bone, q = new THREE.Quaternion());
    return q;
  }

  // Pose the model from the rig (call after rig.update and after the
  // character's root transform is current).
  apply(mirror = false) {
    const cQ = this.container.getWorldQuaternion(this._w);
    const qs = this._q;
    const visit = (bone, parentWQ) => {
      const e = this.entries.get(bone);
      const v = e && (mirror ? e.m : e.n);
      const wq = this.outQ(bone);
      if (v) {
        qs.setFromRotationMatrix(v.bone.matrixWorld);   // rig root is unscaled
        if (v.mir) mirrorQ(qs, qs);
        wq.copy(cQ).multiply(qs).multiply(v.QsInv).multiply(v.RQt);
        bone.quaternion.copy(parentWQ).invert().multiply(wq);
      } else {
        bone.quaternion.copy(this.restLocal.get(bone));
        wq.copy(parentWQ).multiply(bone.quaternion);
      }
      for (const c of bone.children) if (c.isBone) visit(c, wq);
    };
    visit(this.hips, this.hips.parent.getWorldQuaternion(this._p));

    // hips height follows the clip (crouches, falls); travel is root motion
    const dy = this.rig.hipsY ? (this.rig.bones.Hips.position.y - this.srcHipsRestY) * this.scale : 0;
    const p = this._v.copy(this.hipsRest);
    p.y += dy;
    this.container.localToWorld(p);
    this.hips.position.copy(this.hips.parent.worldToLocal(p));
  }
}
