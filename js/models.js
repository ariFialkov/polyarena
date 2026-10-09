// Imported character models (GLB, converted from the uploaded rigged FBX
// files by tools/convert-models.mjs) and the retargeter that drives them.
//
// Fallback path (used only if the motion-capture library fails to load; see
// js/anim.js for the normal path): the procedural animator poses an
// invisible "driver" rig (the named bone groups built by charrig.js: hips, spine, chest, neck, arms{sh,el},
// legs{th,kn}). Every frame the Retargeter copies the driver's limb
// orientations onto the model's humanoid skeleton in WORLD space:
//
//     boneWorld = driverWorld * align * boneRestWorld
//
// `align` rotates the bone's bind-pose direction (T-pose arms point sideways)
// onto the driver's rest direction (arms hang down), so the math never
// depends on how a particular rig's local bone axes are oriented. Any model
// with standard humanoid bone names (Hips, Spine, LeftArm, ...) works.

import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/jsm/utils/SkeletonUtils.js';

const BASE = 'assets/models/';
const cache = new Map();   // key -> Promise<THREE.Object3D>
const loader = new GLTFLoader();

// Preload (or fetch the cached promise for) a model's source scene.
export function loadModel(key) {
  if (!cache.has(key)) {
    cache.set(key, loader.loadAsync(BASE + key + '.glb').then(g => {
      g.scene.traverse(o => {
        if (o.isBone) o.name = o.name.replace(/^(smartrig|mixamorig)[:_]?/i, '');
      });
      return g.scene;
    }));
  }
  return cache.get(key);
}

// A fresh, independently animatable copy (geometry and textures shared,
// materials cloned so per-fighter fades don't leak between instances).
export async function instantiateModel(key) {
  const src = await loadModel(key);
  const inst = cloneSkinned(src);
  inst.traverse(o => {
    if (o.isMesh) {
      o.material = o.material.clone();
      const m = o.material;
      // A little self-illumination from the albedo keeps faces readable
      // under the darker stage lighting.
      if (m.map) {
        m.emissive = new THREE.Color(0xffffff);
        m.emissiveMap = m.map;
        m.emissiveIntensity = 0.16;
      }
      o.castShadow = true;
      o.frustumCulled = false; // bones move the mesh outside its bind bounds
    }
  });
  return inst;
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

// [model bone, driver accessor, child bone used for direction, driver rest dir]
// Driver arms/legs[+1] sit on +X; the models face +Z, so their LEFT is +X.
const MAP = [
  ['Hips', d => d.hips, null, null],
  ['Spine', d => d.spine, 'Spine1', UP],
  ['Spine2', d => d.chest, 'Neck', UP],
  ['Neck', d => d.neck, 'Head', UP],
  ['LeftArm', d => d.arms[1].sh, 'LeftForeArm', DOWN],
  ['LeftForeArm', d => d.arms[1].el, 'LeftHand', DOWN],
  ['RightArm', d => d.arms[-1].sh, 'RightForeArm', DOWN],
  ['RightForeArm', d => d.arms[-1].el, 'RightHand', DOWN],
  ['LeftUpLeg', d => d.legs[1].th, 'LeftLeg', DOWN],
  ['LeftLeg', d => d.legs[1].kn, 'LeftFoot', DOWN],
  ['RightUpLeg', d => d.legs[-1].th, 'RightLeg', DOWN],
  ['RightLeg', d => d.legs[-1].kn, 'RightFoot', DOWN],
];

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion();

export class Retargeter {
  // model: instantiated scene. driver: Fighter with driver groups.
  // targetHeight: desired standing height in root-local units.
  constructor(model, driver, targetHeight) {
    this.model = model;
    this.driver = driver;
    this.container = new THREE.Group();
    this.container.add(model);

    // --- measure the bind pose in the container (= character) frame ---
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y;
    const s = targetHeight / height;
    this.container.scale.setScalar(s);
    this.container.updateMatrixWorld(true);

    const bones = {};
    model.traverse(o => { if (o.isBone) bones[o.name] = o; });
    this.bones = bones;
    this.hipsBone = bones.Hips;
    if (!this.hipsBone) throw new Error('model has no Hips bone');

    const worldQ = b => b.getWorldQuaternion(new THREE.Quaternion());
    const worldP = b => b.getWorldPosition(new THREE.Vector3());

    this.rest = new Map();   // bone -> rest local quaternion (fists applied)
    model.traverse(o => { if (o.isBone) this.rest.set(o, o.quaternion.clone()); });

    this.entries = new Map(); // bone -> { get, align*restWorld }
    for (const [name, get, childName, restDir] of MAP) {
      const b = bones[name];
      if (!b) continue;
      const R0 = worldQ(b);
      const A = new THREE.Quaternion();
      const child = childName && bones[childName];
      if (child && restDir) {
        const d0 = worldP(child).sub(worldP(b)).normalize();
        A.setFromUnitVectors(d0, restDir);
      }
      this.entries.set(b, { get, AR0: A.multiply(R0) });
    }

    this.makeFists(bones, worldQ, worldP);

    // hips translation follows the driver's hips (crouches, falls, jumps)
    this.hipsRestY = worldP(this.hipsBone).y; // container-local, already scaled
    this.basePos = new THREE.Vector3();
    this.armature = this.hipsBone.parent;
  }

  // Curl finger joints toward the palm so hands read as fists.
  makeFists(bones, worldQ, worldP) {
    for (const side of ['Left', 'Right']) {
      const idx = bones[side + 'HandIndex1'], pinky = bones[side + 'HandPinky1'];
      const hand = bones[side + 'Hand'];
      if (!idx || !hand) continue;
      // knuckle line; orient so a positive curl moves fingertips palm-ward (down in T-pose)
      const axis = worldP(idx).sub(worldP(pinky || hand)).normalize();
      const fingerDir = worldP(idx).sub(worldP(hand)).normalize();
      const test = fingerDir.clone().applyAxisAngle(axis, 0.3);
      if (test.y > fingerDir.y) axis.negate();
      for (const f of FINGERS) {
        for (let j = 1; j <= 3; j++) this.curl(bones[side + 'Hand' + f + j], axis, 1.25, worldQ);
      }
      for (let j = 2; j <= 3; j++) this.curl(bones[side + 'HandThumb' + j], axis, 0.55, worldQ);
    }
  }

  // local' = Wp^-1 * Q(axis, angle) * Wp * local   (rotation about a world axis
  // at this joint, expressed in the parent's frame)
  curl(bone, axis, angle, worldQ) {
    if (!bone || !bone.parent) return;
    const Wp = worldQ(bone.parent);
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const local = Wp.clone().invert().multiply(q).multiply(Wp).multiply(bone.quaternion);
    this.rest.set(bone, local);
  }

  // Call after the driver rig has been posed and the fighter root placed.
  apply() {
    const d = this.driver;
    const k = this.hipsRestY / d.hipsBaseY;
    this.container.position.set(
      this.basePos.x + d.hips.position.x * k,
      this.basePos.y + (d.hips.position.y - d.hipsBaseY) * k,
      this.basePos.z + d.hips.position.z * k,
    );
    d.root.updateMatrixWorld(true);
    this.visit(this.hipsBone, this.armature.getWorldQuaternion(_q2));
  }

  visit(bone, parentWQ) {
    const e = this.entries.get(bone);
    const wq = new THREE.Quaternion();
    if (e) {
      e.get(this.driver).getWorldQuaternion(wq).multiply(e.AR0);
      bone.quaternion.copy(_qi.copy(parentWQ).invert().multiply(wq));
    } else {
      bone.quaternion.copy(this.rest.get(bone));
      wq.copy(parentWQ).multiply(bone.quaternion);
    }
    for (const c of bone.children) if (c.isBone) this.visit(c, wq);
  }

  boneWorld(name, out = new THREE.Vector3()) {
    const b = this.bones[name];
    return b ? b.getWorldPosition(out) : null;
  }
}
