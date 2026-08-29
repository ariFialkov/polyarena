// Character rig builder: data-driven low-poly caricature fighters.
// Consumes def.look (build, skin, hair, facial features, outfit, extras) and
// assembles the SAME bone hierarchy the animator expects:
//   root -> hips -> spine -> chest -> neck ; arms {sh,el} ; legs {th,kn}
// so every move/special works on every character. Swapping these primitive
// parts for skinned glTF meshes later only touches this file.

import * as THREE from '../vendor/three.module.min.js';

export function buildCharacterRig(f) {
  const d = f.def;
  const L = d.look || {};
  const skin = L.skin || d.skin || '#e0b090';
  const hairC = L.hairColor || d.hair || '#302018';

  f.mats = [];
  const M = (c, o = {}) => {
    const m = new THREE.MeshStandardMaterial({
      color: c, roughness: 0.62, metalness: 0.04, flatShading: true, transparent: true, ...o,
    });
    f.mats.push(m);
    return m;
  };
  const grp = () => new THREE.Group();
  const mesh = (geo, m, x, y, z) => {
    const me = new THREE.Mesh(geo, m);
    me.position.set(x, y, z);
    me.castShadow = true;
    return me;
  };

  const bulk = L.bulk || 1, belly = L.belly || 0, shoulders = L.shoulders || 1;
  const mSkin = M(skin), mHair = M(hairC, { roughness: 0.8 });
  const top = L.top || '#444a66', bottom = L.bottom || '#2a2e44', shoe = L.shoe || '#16161e';
  const mTop = M(top), mBottom = M(bottom), mShoe = M(shoe);

  // ---------------- core skeleton ----------------
  f.root = grp();
  f.hipsBaseY = 0.87;
  f.hips = grp(); f.hips.position.y = f.hipsBaseY;
  f.root.add(f.hips);

  f.spine = grp(); f.spine.position.y = 0.14; f.hips.add(f.spine);
  f.chest = grp(); f.chest.position.y = 0.24; f.spine.add(f.chest);
  f.neck = grp(); f.neck.position.y = 0.38; f.chest.add(f.neck);

  // ---------------- torso by outfit ----------------
  const pelvisGeo = new THREE.CylinderGeometry(0.20 * bulk, 0.23 * bulk, 0.3, 6);
  const spineGeo = new THREE.CylinderGeometry(0.185 * bulk * (1 + belly * 0.7), 0.165 * bulk, 0.24, 6);
  const chestGeo = new THREE.CylinderGeometry(0.26 * bulk, 0.18 * bulk * (1 + belly * 0.6), 0.4, 6);
  const outfit = L.outfit || 'gi';
  const torsoMat = { suit: mTop, pantsuit: mTop, chef: mTop, military: mTop, frock: mTop, demon: mTop, tee: mTop, jersey: mTop, leotard: mTop, crop: mTop, gi: mTop, bare: mSkin, armor: bronzeM(M) }[outfit] || mTop;

  const pelvis = mesh(pelvisGeo, outfit === 'leotard' ? mTop : mBottom, 0, 0.02, 0);
  f.hips.add(pelvis);
  const spineMesh = mesh(spineGeo, outfit === 'crop' ? mSkin : torsoMat, 0, 0.1, 0);
  if (belly) { spineMesh.scale.z = 1 + belly; spineMesh.position.z = belly * 0.05; }
  f.spine.add(spineMesh);
  const chestMesh = mesh(chestGeo, torsoMat, 0, 0.16, 0);
  f.chest.add(chestMesh);

  // outfit decorations — dz clears the chest cylinder, dzS the spine
  const dz = 0.245 * bulk;
  const dzS = 0.215 * bulk * (1 + belly * 0.5);
  const dec = (geo, m, x, y, z, target = f.chest) => { const me = mesh(geo, m, x, y, z); target.add(me); return me; };
  switch (outfit) {
    case 'suit': case 'pantsuit': {
      const mShirt = M(L.shirt || '#f2f2f4');
      dec(new THREE.BoxGeometry(0.14, 0.3, 0.05), mShirt, 0, 0.18, dz - 0.02);           // shirt V
      const mLapel = M(shade(top, -18));
      dec(new THREE.BoxGeometry(0.07, 0.26, 0.03), mLapel, -0.09, 0.17, dz);
      dec(new THREE.BoxGeometry(0.07, 0.26, 0.03), mLapel, 0.09, 0.17, dz);
      if (L.tieColor) {
        const tie = dec(new THREE.BoxGeometry(0.07, 0.34, 0.025), M(L.tieColor), 0, 0.06, dz);
        tie.rotation.x = 0.06;
        dec(new THREE.BoxGeometry(0.08, 0.06, 0.03), M(L.tieColor), 0, 0.3, dz); // knot
      }
      if (L.extras?.includes('bowtie')) {
        dec(new THREE.BoxGeometry(0.11, 0.05, 0.04), M('#101014'), 0, 0.3, dz);
      }
      break;
    }
    case 'chef': {
      const btn = M('#20242c');
      for (const sx of [-0.05, 0.05]) for (let i = 0; i < 3; i++) {
        dec(new THREE.SphereGeometry(0.014, 5, 4), btn, sx, 0.06 + i * 0.1, dz);
      }
      dec(new THREE.BoxGeometry(0.3, 0.34, 0.03), M('#181a20'), 0, -0.1, dzS, f.spine); // apron
      break;
    }
    case 'military': case 'frock': {
      const mPanel = M(L.panel || '#e8e2d0');
      dec(new THREE.BoxGeometry(0.16, 0.34, 0.04), mPanel, 0, 0.14, dz - 0.01);
      const gold = M('#d8a828', { metalness: 0.6, roughness: 0.35 });
      for (let i = 0; i < 3; i++) {
        dec(new THREE.SphereGeometry(0.014, 5, 4), gold, -0.055, 0.04 + i * 0.11, dz + 0.01);
        dec(new THREE.SphereGeometry(0.014, 5, 4), gold, 0.055, 0.04 + i * 0.11, dz + 0.01);
      }
      if (L.extras?.includes('epaulettes')) {
        for (const sx of [-1, 1]) {
          dec(new THREE.BoxGeometry(0.13, 0.03, 0.13), gold, sx * 0.26 * shoulders, 0.33, 0);
          dec(new THREE.CylinderGeometry(0.055, 0.07, 0.06, 6), gold, sx * 0.3 * shoulders, 0.29, 0);
        }
      }
      if (L.extras?.includes('cravat')) dec(new THREE.SphereGeometry(0.055, 6, 5), M('#f4f0e2'), 0, 0.31, dz - 0.03);
      break;
    }
    case 'armor': {
      const bronze = bronzeM(M);
      dec(new THREE.BoxGeometry(0.2, 0.03, 0.02), bronze, 0, 0.12, dz);
      dec(new THREE.BoxGeometry(0.2, 0.03, 0.02), bronze, 0, 0.02, dzS, f.spine);
      // pteruges skirt
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const p = mesh(new THREE.BoxGeometry(0.07, 0.16, 0.02), M('#7a5a2c'), Math.cos(a) * 0.2, -0.15, Math.sin(a) * 0.2);
        p.rotation.y = -a + Math.PI / 2;
        f.hips.add(p);
      }
      if (L.extras?.includes('cape')) {
        const cape = mesh(new THREE.BoxGeometry(0.42, 0.72, 0.02), M('#8c1a24', { roughness: 0.9 }), 0, -0.1, -0.2);
        cape.rotation.x = 0.16;
        f.chest.add(cape);
      }
      break;
    }
    case 'demon': {
      const stud = M('#c8ccd8', { metalness: 0.8, roughness: 0.3 });
      for (let i = 0; i < 6; i++) {
        dec(new THREE.SphereGeometry(0.016, 5, 4), stud, -0.1 + (i % 3) * 0.1, 0.1 + Math.floor(i / 3) * 0.16, dz);
      }
      for (const sx of [-1, 1]) { // shoulder spikes
        const sp = mesh(new THREE.ConeGeometry(0.05, 0.16, 5), stud, sx * 0.28 * shoulders, 0.4, 0);
        sp.rotation.z = -sx * 0.5;
        f.chest.add(sp);
      }
      break;
    }
    case 'jersey': {
      if (L.number) {
        const tex = textTexture(L.number, '#ffffff');
        const pl = mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true }), 0, 0.16, -dz - 0.012);
        pl.rotation.y = Math.PI;
        f.mats.push(pl.material);
        f.chest.add(pl);
      }
      break;
    }
    case 'tee': {
      if (L.logo) {
        const tex = textTexture(L.logo, L.logoColor || '#ffffff');
        const pl = mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ map: tex, transparent: true }), 0, 0.16, dz + 0.012);
        f.mats.push(pl.material);
        f.chest.add(pl);
      }
      break;
    }
    case 'bare': {
      const pec = M(shade(skin, -14));
      for (const sx of [-1, 1]) {
        const p = mesh(new THREE.SphereGeometry(0.085, 6, 5), pec, sx * 0.09, 0.2, 0.13 * bulk);
        p.scale.set(1.1, 0.8, 0.55);
        f.chest.add(p);
      }
      break;
    }
    case 'leotard': {
      const spark = M(L.trim || '#e8c040', { metalness: 0.7, roughness: 0.3 });
      dec(new THREE.BoxGeometry(0.2, 0.04, 0.02), spark, 0, 0.22, dz);
      dec(new THREE.BoxGeometry(0.14, 0.03, 0.02), spark, 0, 0.05, dzS, f.spine);
      break;
    }
    case 'crop': {
      if (L.extras?.includes('chain')) {
        const gold = M('#e8c040', { metalness: 0.85, roughness: 0.25 });
        const ch = mesh(new THREE.TorusGeometry(0.11, 0.016, 4, 10), gold, 0, 0.26, 0.1);
        ch.rotation.x = 1.25;
        f.chest.add(ch);
      }
      break;
    }
    case 'gi': default: {
      dec(new THREE.BoxGeometry(0.3, 0.07, 0.04), M(shade(top, -24)), 0, 0.3, dz);
      f.hips.add(mesh(new THREE.CylinderGeometry(0.215 * bulk, 0.215 * bulk, 0.09, 6), M(d.accent, { roughness: 0.5 }), 0, 0.14, 0));
      break;
    }
  }
  if (L.extras?.includes('pearls')) {
    const pearl = M('#f0ece2', { roughness: 0.3 });
    const pn = mesh(new THREE.TorusGeometry(0.085, 0.018, 4, 10), pearl, 0, 0.365, 0.14);
    pn.rotation.x = 1.3;
    f.chest.add(pn);
  }

  // ---------------- head ----------------
  const paint = L.facepaint === 'demon';
  const mFace = paint
    ? M('#e8e8ee', { roughness: 0.5, emissive: '#e8e8ee', emissiveIntensity: 0.14 })
    : M(skin, { emissive: skin, emissiveIntensity: 0.24 });
  f.mats.push(mFace);
  f.neck.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 6), paint ? mFace : M(shade(skin, -22)), 0, 0.03, 0));
  const head = mesh(new THREE.IcosahedronGeometry(0.145, 1), mFace, 0, 0.17, 0.01);
  if (L.jaw) head.scale.set(1, 1 + L.jaw, 1); // squarer/longer face
  f.neck.add(head);
  // ears
  for (const sx of [-1, 1]) f.neck.add(mesh(new THREE.SphereGeometry(0.03, 5, 4), mFace, sx * 0.135, 0.16, 0));
  // nose
  const nScale = L.nose || 1;
  const nose = mesh(new THREE.ConeGeometry(0.032 * nScale, 0.085 * nScale, 5), mFace, 0, 0.145, 0.14);
  nose.rotation.x = Math.PI / 2 + 0.3;
  f.neck.add(nose);
  // eyes: sclera + pupil
  for (const sx of [-1, 1]) {
    f.neck.add(mesh(new THREE.SphereGeometry(0.027, 6, 5), M('#f4f4f6', { roughness: 0.3 }), sx * 0.058, 0.195, 0.115));
    f.neck.add(mesh(new THREE.SphereGeometry(0.013, 5, 4), M('#14141a'), sx * 0.058, 0.195, 0.138));
  }
  // brows
  const browM = M(L.browColor || hairC);
  const browTilt = { angry: 0.42, raised: -0.2, neutral: 0.08 }[L.brows || 'neutral'];
  for (const sx of [-1, 1]) {
    const b = mesh(new THREE.BoxGeometry(0.062, 0.016, 0.02), browM, sx * 0.058, 0.235, 0.138);
    b.rotation.z = -sx * browTilt;
    f.neck.add(b);
  }
  // demon face paint: black wings around the eyes + tongue
  if (paint) {
    const blk = M('#101016');
    for (const sx of [-1, 1]) {
      const w1 = mesh(new THREE.BoxGeometry(0.085, 0.03, 0.015), blk, sx * 0.075, 0.225, 0.14);
      w1.rotation.z = sx * 0.55;
      const w2 = mesh(new THREE.BoxGeometry(0.075, 0.026, 0.015), blk, sx * 0.075, 0.165, 0.14);
      w2.rotation.z = -sx * 0.5;
      f.neck.add(w1, w2);
    }
  }
  if (L.extras?.includes('tongue')) {
    const t = mesh(new THREE.BoxGeometry(0.045, 0.11, 0.02), M('#c02838', { roughness: 0.5 }), 0, 0.055, 0.13);
    t.rotation.x = 0.35;
    f.neck.add(t);
  }
  // facial hair
  const mFacial = M(L.facialColor || hairC, { roughness: 0.85 });
  switch (L.facial) {
    case 'mustache':
      f.neck.add(mesh(new THREE.BoxGeometry(0.095, 0.026, 0.03), mFacial, 0, 0.105, 0.138));
      break;
    case 'handlebar': {
      f.neck.add(mesh(new THREE.BoxGeometry(0.1, 0.028, 0.03), mFacial, 0, 0.105, 0.138));
      for (const sx of [-1, 1]) {
        const dsc = mesh(new THREE.BoxGeometry(0.022, 0.05, 0.025), mFacial, sx * 0.062, 0.075, 0.135);
        dsc.rotation.z = -sx * 0.25;
        f.neck.add(dsc);
      }
      break;
    }
    case 'goatee':
      f.neck.add(mesh(new THREE.BoxGeometry(0.055, 0.05, 0.03), mFacial, 0, 0.055, 0.132));
      break;
    case 'fullbeard': {
      const bd = mesh(new THREE.IcosahedronGeometry(0.115, 1), mFacial, 0, 0.055, 0.025);
      bd.scale.set(0.98, 0.72, 0.92);
      f.neck.add(bd);
      f.neck.add(mesh(new THREE.BoxGeometry(0.095, 0.026, 0.03), mFacial, 0, 0.11, 0.128));
      break;
    }
  }

  // hair
  const addCap = (dy = 0, s = 1) => {
    const h = mesh(new THREE.IcosahedronGeometry(0.15, 1), mHair, 0, 0.21 + dy, -0.04);
    h.scale.set(1.02 * s, 0.75, 1.02 * s);
    f.neck.add(h);
    return h;
  };
  switch (L.hair || 'cap') {
    case 'bald': break;
    case 'cap': addCap(); break;
    case 'combover': {
      const c = addCap(0, 1.05);
      c.scale.y = 0.66;
      const swoop = mesh(new THREE.BoxGeometry(0.27, 0.045, 0.2), mHair, 0.015, 0.262, 0.082);
      swoop.rotation.x = -0.42;
      swoop.rotation.z = -0.1;
      f.neck.add(swoop);
      break;
    }
    case 'bob': {
      addCap(0.015, 1.1);
      for (const sx of [-1, 1]) {
        const side = mesh(new THREE.BoxGeometry(0.05, 0.16, 0.14), mHair, sx * 0.135, 0.13, -0.02);
        f.neck.add(side);
      }
      f.neck.add(mesh(new THREE.BoxGeometry(0.22, 0.16, 0.05), mHair, 0, 0.13, -0.115));
      break;
    }
    case 'bun': {
      addCap();
      f.neck.add(mesh(new THREE.SphereGeometry(0.06, 6, 5), mHair, 0, 0.3, -0.1));
      break;
    }
    case 'ponytail': {
      addCap();
      const p = mesh(new THREE.CapsuleGeometry(0.035, 0.2, 2, 5), mHair, 0, 0.16, -0.16);
      p.rotation.x = 0.5;
      f.neck.add(p);
      break;
    }
    case 'mullet': {
      addCap();
      f.neck.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), mHair, 0, 0.06, -0.13));
      break;
    }
    case 'long': {
      addCap(0.01, 1.06);
      for (const sx of [-1, 1]) f.neck.add(mesh(new THREE.BoxGeometry(0.06, 0.3, 0.1), mHair, sx * 0.13, 0.05, -0.05));
      f.neck.add(mesh(new THREE.BoxGeometry(0.2, 0.32, 0.06), mHair, 0, 0.04, -0.12));
      break;
    }
    case 'afro': {
      for (const [dx, dy, dz, s] of [[0, 0.3, -0.03, 0.13], [-0.1, 0.26, 0, 0.1], [0.1, 0.26, 0, 0.1], [0, 0.24, -0.12, 0.11], [-0.07, 0.32, -0.09, 0.09], [0.07, 0.32, -0.09, 0.09]]) {
        f.neck.add(mesh(new THREE.IcosahedronGeometry(s, 1), mHair, dx, dy, dz));
      }
      break;
    }
    case 'wig': {
      const c = addCap(0.005, 1.06);
      for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) {
        const roll = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 6), mHair, sx * 0.135, 0.16 - i * 0.075, -0.01);
        roll.rotation.x = Math.PI / 2;
        f.neck.add(roll);
      }
      const tail = mesh(new THREE.CapsuleGeometry(0.03, 0.12, 2, 5), mHair, 0, 0.08, -0.15);
      tail.rotation.x = 0.35;
      f.neck.add(tail);
      f.neck.add(mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), M('#202430'), 0, 0.14, -0.15));
      break;
    }
    case 'flat': {
      const c = addCap(0.02, 1.0);
      c.scale.y = 0.55;
      f.neck.add(mesh(new THREE.BoxGeometry(0.2, 0.06, 0.19), mHair, 0, 0.29, -0.03));
      break;
    }
  }

  // headwear + face extras
  if (L.extras?.includes('bicorne')) {
    const hatM = M('#181a22', { roughness: 0.7 });
    const hat = mesh(new THREE.ConeGeometry(0.26, 0.17, 4), hatM, 0, 0.33, -0.01);
    hat.scale.set(2.05, 1, 0.6);
    hat.rotation.y = Math.PI / 4;
    f.neck.add(hat);
    f.neck.add(mesh(new THREE.SphereGeometry(0.025, 5, 4), M('#d8a828', { metalness: 0.6 }), 0, 0.32, 0.115));
  }
  if (L.extras?.includes('helm')) {
    const bronze = bronzeM(M);
    const dome = mesh(new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), bronze, 0, 0.19, -0.01);
    f.neck.add(dome);
    f.neck.add(mesh(new THREE.BoxGeometry(0.03, 0.09, 0.02), bronze, 0, 0.2, 0.145)); // nose guard
    const crest = mesh(new THREE.BoxGeometry(0.035, 0.09, 0.3), M('#c02030', { roughness: 0.8 }), 0, 0.36, -0.03);
    crest.rotation.x = -0.15;
    f.neck.add(crest);
  }
  if (L.extras?.includes('sunglasses')) {
    const blk = M('#0c0c12', { roughness: 0.25 });
    f.neck.add(mesh(new THREE.BoxGeometry(0.2, 0.05, 0.03), blk, 0, 0.195, 0.145));
  }
  if (L.extras?.includes('toque')) { // chef hat option (unused by default)
    f.neck.add(mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.18, 8), M('#f2f2f4'), 0, 0.37, -0.02));
  }

  // ---------------- arms ----------------
  const sleeves = { suit: 'long', pantsuit: 'long', chef: 'long', military: 'long', frock: 'long', demon: 'long', tee: 'short', jersey: 'short', gi: 'wrap', crop: 'none', bare: 'none', leotard: 'sleeve', armor: 'none' }[outfit] || 'none';
  const armR = 0.072 * (0.85 + bulk * 0.25);
  const foreR = 0.062 * (0.85 + bulk * 0.25);
  f.arms = {};
  for (const side of [-1, 1]) {
    const sh = grp(); sh.position.set(side * 0.28 * shoulders * (0.9 + bulk * 0.1), 0.30, 0); f.chest.add(sh);
    const upperM = (sleeves === 'long' || sleeves === 'short' || sleeves === 'sleeve') ? mTop : mSkin;
    sh.add(mesh(new THREE.SphereGeometry(0.09 * (0.8 + bulk * 0.25), 6, 5), upperM, 0, 0, 0));
    sh.add(mesh(new THREE.CapsuleGeometry(armR, 0.24, 2, 6), upperM, 0, -0.16, 0));
    const el = grp(); el.position.y = -0.32; sh.add(el);
    let foreM = mSkin;
    if (sleeves === 'long') foreM = mTop;
    if (sleeves === 'wrap') foreM = M(d.accent, { roughness: 0.5 });
    if (outfit === 'armor') foreM = bronzeM(M);
    if (outfit === 'demon') foreM = M('#c8ccd8', { metalness: 0.7, roughness: 0.35 });
    el.add(mesh(new THREE.CapsuleGeometry(foreR, 0.2, 2, 6), foreM, 0, -0.13, 0));
    el.add(mesh(new THREE.IcosahedronGeometry(0.075, 1), mSkin, 0, -0.29, 0.01));
    f.arms[side] = { sh, el };
  }

  // ---------------- legs ----------------
  const legStyle = { leotard: 'skin', jersey: 'shorts', crop: 'shorts', armor: 'greaves', military: 'boots', bare: 'pants' }[outfit] || 'pants';
  f.legs = {};
  for (const side of [-1, 1]) {
    const th = grp(); th.position.set(side * 0.13 * (0.9 + bulk * 0.12), -0.06, 0); f.hips.add(th);
    const thM = legStyle === 'skin' ? mSkin : mBottom;
    th.add(mesh(new THREE.CapsuleGeometry(0.1 * (0.85 + bulk * 0.2), 0.3, 2, 6), thM, 0, -0.18, 0));
    const kn = grp(); kn.position.y = -0.42; th.add(kn);
    let shinM = mBottom;
    if (legStyle === 'skin' || legStyle === 'shorts') shinM = mSkin;
    if (legStyle === 'greaves') shinM = bronzeM(M);
    if (legStyle === 'boots') shinM = mShoe;
    kn.add(mesh(new THREE.CapsuleGeometry(0.078 * (0.85 + bulk * 0.2), 0.28, 2, 6), shinM, 0, -0.17, 0));
    if (legStyle === 'shorts' && L.sock) {
      kn.add(mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.14, 6), M(L.sock), 0, -0.32, 0));
    }
    kn.add(mesh(new THREE.BoxGeometry(0.13, 0.09, 0.26), mShoe, 0, -0.4, 0.05));
    f.legs[side] = { th, kn };
  }

  // overall stature
  if (L.h && L.h !== 1) f.root.scale.setScalar(L.h);
}

function bronzeM(M) {
  return M('#d8a850', { metalness: 0.4, roughness: 0.32, emissive: '#6a4a14', emissiveIntensity: 0.35 });
}

function textTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.font = '900 96px system-ui';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 64, 68);
  return new THREE.CanvasTexture(c);
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const cl = v => Math.min(255, Math.max(0, v));
  const r = cl((n >> 16) + amt), g = cl(((n >> 8) & 255) + amt), b = cl((n & 255) + amt);
  return (r << 16) | (g << 8) | b;
}
