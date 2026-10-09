// Driver rig: an invisible named skeleton of groups (hips, spine, chest,
// neck, arms{sh,el}, legs{th,kn}) posed by the procedural animator in
// fighter.js. It only drives a model (js/models.js Retargeter) in the rare
// case the motion-capture library fails to load. Fighters never show
// placeholder geometry: nothing is drawn until the real model is ready.

import * as THREE from '../vendor/three.module.min.js';

export function buildDriverRig(f) {
  const L = f.def.look || {};
  const bulk = L.bulk || 1, shoulders = L.shoulders || 1;
  const grp = () => new THREE.Group();
  f.mats = [];
  f.root = grp();
  f.hipsBaseY = 0.87;
  f.hips = grp(); f.hips.position.y = f.hipsBaseY;
  f.root.add(f.hips);
  f.spine = grp(); f.spine.position.y = 0.14; f.hips.add(f.spine);
  f.chest = grp(); f.chest.position.y = 0.24; f.spine.add(f.chest);
  f.neck = grp(); f.neck.position.y = 0.38; f.chest.add(f.neck);
  f.arms = {};
  for (const side of [-1, 1]) {
    const sh = grp(); sh.position.set(side * 0.28 * shoulders * (0.9 + bulk * 0.1), 0.30, 0); f.chest.add(sh);
    const el = grp(); el.position.y = -0.32; sh.add(el);
    f.arms[side] = { sh, el };
  }
  f.legs = {};
  for (const side of [-1, 1]) {
    const th = grp(); th.position.set(side * 0.13 * (0.9 + bulk * 0.12), -0.06, 0); f.hips.add(th);
    const kn = grp(); kn.position.y = -0.42; th.add(kn);
    f.legs[side] = { th, kn };
  }
  if (L.h && L.h !== 1) f.root.scale.setScalar(L.h);
}
