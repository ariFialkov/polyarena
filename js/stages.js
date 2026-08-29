// Stage system: themed 2.5D fight arenas (Mortal-Kombat/Smash style).
// Each stage builds its scenery into a THREE.Group, sets the palette
// (sky, fog, lighting tints), and may return a tick(dt, t) for ambient
// animation (petals, snow, fireflies, torch flicker, aurora...).
//
// Contract: build(g, ctx) where ctx = { THREE, mat, basic, ground, field }.
//   - mat(color, opts): flat-shaded standard material
//   - basic(color, opts): unlit material
//   - ground(color|texture opts): adds the fight floor, returns mesh
//   - field(opts): ambient particle field helper

import * as THREE from '../vendor/three.module.min.js';
import { rand, randRange } from './util.js';

// ---------------------------------------------------------------------------
// Ambient particle field (petals, snow, fireflies, embers, stars)
// ---------------------------------------------------------------------------
class Field {
  constructor(parent, { n = 120, box = [12, 8, 8], y0 = 0, color = 0xffffff, size = 0.08,
    fall = 0.5, drift = 0.4, swirl = 0, additive = false, opacity = 0.8, twinkle = 0 }) {
    this.box = box; this.y0 = y0; this.fall = fall; this.drift = drift;
    this.swirl = swirl; this.twinkle = twinkle;
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = randRange(-box[0], box[0]);
      this.pos[i * 3 + 1] = y0 + rand() * box[1];
      this.pos[i * 3 + 2] = randRange(-box[2], box[2] * 0.3);
      this.phase[i] = rand() * 9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    parent.add(this.points);
  }
  tick(dt, t) {
    const [bx, by, bz] = this.box;
    for (let i = 0; i < this.n; i++) {
      let x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      y -= this.fall * dt * (0.6 + 0.4 * Math.sin(this.phase[i]));
      x += Math.sin(t * 0.7 + this.phase[i]) * this.drift * dt;
      z += Math.cos(t * 0.5 + this.phase[i] * 2) * this.drift * 0.5 * dt;
      if (this.swirl) x += Math.sin(y * 1.3 + this.phase[i]) * this.swirl * dt;
      if (y < this.y0) { y = this.y0 + by; x = randRange(-bx, bx); }
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    }
    if (this.twinkle) this.mat.opacity = 0.5 + 0.4 * Math.abs(Math.sin(t * this.twinkle));
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Small scenery helpers (all low-poly primitives)
// ---------------------------------------------------------------------------
function helpers(g) {
  const mats = [];
  const mat = (color, opts = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts });
    mats.push(m); return m;
  };
  const basic = (color, opts = {}) => {
    const m = new THREE.MeshBasicMaterial({ color, ...opts });
    mats.push(m); return m;
  };
  const add = (geo, m, x, y, z, ry = 0) => {
    const me = new THREE.Mesh(geo, m);
    me.position.set(x, y, z);
    me.rotation.y = ry;
    g.add(me);
    return me;
  };
  const ground = (color, w = 11, d = 6.6) => {
    const me = add(new THREE.BoxGeometry(w, 0.5, d), mat(color, { roughness: 0.95 }), 0, -0.25, -0.6);
    me.receiveShadow = true;
    // pedestal skirt below the platform edge
    add(new THREE.BoxGeometry(w + 0.7, 1.4, d + 0.7), mat(0x14161f, { roughness: 1 }), 0, -1.1, -0.6);
    return me;
  };
  // simple conifer / leafy tree
  const pine = (x, z, s = 1, green = 0x1d4a30, snow = null) => {
    add(new THREE.CylinderGeometry(0.08 * s, 0.12 * s, 0.7 * s, 5), mat(0x3a2a1a), x, 0.35 * s, z);
    for (let i = 0; i < 3; i++) {
      add(new THREE.ConeGeometry((0.62 - i * 0.14) * s, 0.75 * s, 6), mat(green), x, (0.75 + i * 0.5) * s, z);
      if (snow) add(new THREE.ConeGeometry((0.45 - i * 0.11) * s, 0.3 * s, 6), mat(snow), x, (1.0 + i * 0.5) * s, z);
    }
  };
  const blob = (x, y, z, s, color) => {
    const me = add(new THREE.IcosahedronGeometry(s, 0), mat(color), x, y, z, rand() * 3);
    me.scale.y = randRange(0.7, 0.95);
    return me;
  };
  return { THREE, mat, basic, add, ground, pine, blob, mats };
}

// ---------------------------------------------------------------------------
// The stages
// ---------------------------------------------------------------------------
export const STAGES = [
  {
    id: 'jungle', label: 'JUNGLE TEMPLE',
    sky: ['#0a1a10', '#173a22', '#0a1a10'], fog: ['#10241a', 12, 24],
    hemi: [0x9fd8a8, 0x0c1a10, 0.55], key: 0xffefc8,
    build(g, h) {
      h.ground(0x4a5a42);
      // mossy stone platform trim
      h.add(new THREE.BoxGeometry(11.6, 0.22, 7.1), h.mat(0x59695a), 0, -0.48, -0.6);
      // ruin pillars
      for (const [x, z, hh] of [[-4.4, -2.6, 2.2], [4.4, -2.6, 1.6], [-3.2, -3.4, 2.8], [3.4, -3.6, 2.4]]) {
        h.add(new THREE.CylinderGeometry(0.28, 0.34, hh, 6), h.mat(0x6a7a68), x, hh / 2, z);
        h.add(new THREE.BoxGeometry(0.9, 0.25, 0.9), h.mat(0x5a6a58), x, hh + 0.12, z);
      }
      // giant trees + canopy wall
      for (const [x, z, s] of [[-5.4, -4.2, 1.5], [5.6, -4.5, 1.7], [-2, -5.2, 1.4], [2.4, -5.4, 1.6], [0, -6, 1.8]]) {
        h.add(new THREE.CylinderGeometry(0.22 * s, 0.34 * s, 1.7 * s, 6), h.mat(0x35261a), x, 0.85 * s, z);
        h.blob(x, 1.9 * s, z, 1.2 * s, 0x1c4426);
        h.blob(x + 0.8, 1.55 * s, z + 0.3, 0.85 * s, 0x235a2e);
        h.blob(x - 0.7, 1.5 * s, z - 0.2, 0.7 * s, 0x184020);
      }
      for (let i = 0; i < 10; i++) h.blob(randRange(-7, 7), randRange(0.4, 1), randRange(-4.6, -3.4), randRange(0.5, 1), 0x16351f);
      // hanging vines
      for (let i = 0; i < 7; i++) {
        const len = randRange(0.8, 1.8);
        h.add(new THREE.CylinderGeometry(0.025, 0.035, len, 4), h.mat(0x2c5a30), randRange(-5, 5), 3.1 - len / 2, randRange(-4, -2.5));
      }
      const fireflies = new Field(g, { n: 45, box: [7, 3.2, 4], y0: 0.4, color: 0xd8ffa0, size: 0.07, fall: 0.05, drift: 1.2, additive: true, twinkle: 1.6 });
      return { tick: (dt, t) => fireflies.tick(dt, t) };
    },
  },
  {
    id: 'castle', label: 'BLOOD KEEP',
    sky: ['#090812', '#241530', '#090812'], fog: ['#141020', 12, 26],
    hemi: [0x8878aa, 0x141018, 0.3], key: 0xffd9a8,
    build(g, h) {
      h.ground(0x4c4a55);
      h.add(new THREE.BoxGeometry(11.6, 0.22, 7.1), h.mat(0x3c3a45), 0, -0.48, -0.6);
      // keep wall with crenellations
      const wall = h.add(new THREE.BoxGeometry(13, 3.4, 1), h.mat(0x55515e), 0, 1.7, -4.4);
      wall.receiveShadow = true;
      for (let i = -6; i <= 6; i++) h.add(new THREE.BoxGeometry(0.55, 0.5, 1), h.mat(0x4c4855), i, 3.6, -4.4);
      // towers
      for (const x of [-5.5, 5.5]) {
        h.add(new THREE.CylinderGeometry(1, 1.15, 5.2, 8), h.mat(0x5a5665), x, 2.6, -4.6);
        h.add(new THREE.ConeGeometry(1.25, 1.6, 8), h.mat(0x35202a), x, 6, -4.6);
      }
      // banners
      for (const x of [-2.6, 2.6]) h.add(new THREE.BoxGeometry(0.7, 1.7, 0.05), h.mat(0x8c1024), x, 2.2, -3.88);
      // torches with flames
      const flames = [];
      for (const x of [-4, -1.3, 1.3, 4]) {
        h.add(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5), h.mat(0x2a2018), x, 1.9, -3.85);
        const fl = h.add(new THREE.ConeGeometry(0.13, 0.4, 6), h.basic(0xff9030, { transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }), x, 2.45, -3.85);
        const li = new THREE.PointLight(0xff8030, 6, 6, 1.8);
        li.position.set(x, 2.5, -3.6);
        g.add(li);
        flames.push({ fl, li, p: rand() * 9 });
      }
      // moon
      h.add(new THREE.SphereGeometry(0.9, 10, 8), h.basic(0xf0e8d0, { fog: false }), 6.5, 7.5, -9);
      const embers = new Field(g, { n: 40, box: [6, 3.5, 3], y0: 1.6, color: 0xff9040, size: 0.05, fall: -0.35, drift: 0.4, additive: true, opacity: 0.7 });
      return {
        tick(dt, t) {
          embers.tick(dt, t);
          for (const f of flames) {
            const k = 0.75 + 0.25 * Math.sin(t * 11 + f.p) * Math.sin(t * 7 + f.p * 2);
            f.li.intensity = 6 * k;
            f.fl.scale.set(k, 0.8 + 0.35 * k, k);
          }
        },
      };
    },
  },
  {
    id: 'space', label: 'ORBITAL KOLOSSEUM',
    sky: ['#030308', '#0a0a20', '#030308'], fog: ['#06060f', 16, 34],
    hemi: [0x8090ff, 0x0a0a18, 0.4], key: 0xcfe0ff,
    build(g, h) {
      // floating hex platform
      const plat = h.add(new THREE.CylinderGeometry(5.8, 5.0, 0.6, 6), h.mat(0x2a2f52, { metalness: 0.35, roughness: 0.5 }), 0, -0.3, 0);
      plat.receiveShadow = true;
      h.add(new THREE.CylinderGeometry(5.85, 5.85, 0.1, 6), h.basic(0x40d8ff, { transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }), 0, 0.02, 0);
      h.add(new THREE.CylinderGeometry(1.6, 0.2, 2.6, 6), h.mat(0x1c2040), 0, -1.9, 0);
      // ringed planet
      const planet = h.add(new THREE.SphereGeometry(2.2, 12, 10), h.mat(0x8c5a9c, { roughness: 0.7 }), -7, 6, -14);
      const ring = h.add(new THREE.TorusGeometry(3.2, 0.35, 2, 28), h.mat(0xc0a8e0), -7, 6, -14);
      ring.rotation.x = 1.9; ring.scale.z = 0.15;
      planet.material.fog = false; ring.material.fog = false;
      // floating crystals
      const crystals = [];
      for (let i = 0; i < 7; i++) {
        const c = h.add(new THREE.OctahedronGeometry(randRange(0.2, 0.5), 0),
          h.basic(0x70e8ff, { transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending }),
          randRange(-6, 6), randRange(1, 4.5), randRange(-5, -2.5));
        c.scale.y = 1.8;
        crystals.push({ c, p: rand() * 9, y: c.position.y });
      }
      const stars = new Field(g, { n: 240, box: [16, 12, 14], y0: 0, color: 0xffffff, size: 0.06, fall: 0, drift: 0.02, additive: true, twinkle: 0.8 });
      return {
        tick(dt, t) {
          stars.tick(dt, t);
          for (const cr of crystals) {
            cr.c.position.y = cr.y + Math.sin(t * 0.8 + cr.p) * 0.25;
            cr.c.rotation.y += dt * 0.6;
          }
        },
      };
    },
  },
  {
    id: 'whitehouse', label: 'THE WHITE HOUSE',
    sky: ['#1a2340', '#4a3e64', '#1a2340'], fog: ['#252a48', 13, 28],
    hemi: [0xaab0e0, 0x1c2030, 0.55], key: 0xfff0d8,
    build(g, h) {
      h.ground(0x3e5a34); // lawn
      h.add(new THREE.BoxGeometry(12, 0.18, 2.4), h.mat(0x8a8a92), 0, -0.4, 2.6); // front path edge
      // facade
      const fw = 11;
      const fac = h.add(new THREE.BoxGeometry(fw, 3.2, 1.2), h.mat(0xe8e6e0, { roughness: 0.7 }), 0, 1.6, -4.4);
      fac.receiveShadow = true;
      // portico + columns
      h.add(new THREE.BoxGeometry(5, 0.4, 1.8), h.mat(0xf0eee8), 0, 3.1, -3.6);
      const pedi = h.add(new THREE.CylinderGeometry(0.75, 0.75, 4.6, 3), h.mat(0xf0eee8), 0, 3.62, -3.55);
      pedi.rotation.z = Math.PI / 2;           // prism axis along X
      pedi.rotation.x = Math.PI;               // flat face down, ridge up
      pedi.scale.set(1, 1, 0.55);              // slimmer front-to-back
      for (const x of [-1.9, -0.95, 0, 0.95, 1.9]) {
        h.add(new THREE.CylinderGeometry(0.14, 0.16, 2.9, 7), h.mat(0xfaf8f2), x, 1.45, -3.15);
      }
      // windows
      for (const x of [-4.6, -3.6, 2.6, 3.6, 4.6]) for (const y of [1.0, 2.2]) {
        h.add(new THREE.BoxGeometry(0.5, 0.75, 0.06), h.basic(0xffe9a0), x, y, -3.76);
      }
      // roof balustrade + flag
      h.add(new THREE.BoxGeometry(fw, 0.28, 1.2), h.mat(0xd8d6d0), 0, 3.35, -4.4);
      h.add(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 4), h.mat(0xcccccc), 0, 4.6, -4.4);
      const flag = h.add(new THREE.BoxGeometry(0.85, 0.5, 0.03), h.mat(0xb3202a), 0.46, 5.15, -4.4);
      // fountain
      h.add(new THREE.CylinderGeometry(0.9, 1, 0.35, 8), h.mat(0x9a98a0), -4.2, 0.17, 1.9);
      h.add(new THREE.CylinderGeometry(0.75, 0.75, 0.1, 8), h.basic(0x5a9cd8), -4.2, 0.32, 1.9);
      // hedges
      for (const x of [-2.8, 2.8]) h.add(new THREE.BoxGeometry(1.6, 0.5, 0.6), h.mat(0x2e4a28), x, 0.25, -2.9);
      const leaves = new Field(g, { n: 30, box: [7, 4, 4], y0: 0.1, color: 0xc08040, size: 0.06, fall: 0.4, drift: 0.8, swirl: 0.5, opacity: 0.85 });
      return { tick: (dt, t) => { leaves.tick(dt, t); flag.rotation.y = Math.sin(t * 2.2) * 0.18; } };
    },
  },
  {
    id: 'siberia', label: 'SIBERIAN SUMMIT',
    sky: ['#0c1220', '#28405c', '#0c1220'], fog: ['#1c2c40', 11, 24],
    hemi: [0xbcd4f0, 0x18202e, 0.5], key: 0xd8e8ff,
    build(g, h) {
      const gr = h.ground(0xdde6ee); // snow
      gr.material.roughness = 0.98;
      h.add(new THREE.BoxGeometry(11.6, 0.22, 7.1), h.mat(0xb8c4d4), 0, -0.48, -0.6);
      // mountain backdrop
      for (const [x, z, s] of [[-6, -8, 5], [0, -10, 7], [6.5, -8.5, 5.5], [-3, -9, 6]]) {
        h.add(new THREE.ConeGeometry(s * 0.75, s, 5), h.mat(0x4a566a), x, s / 2 - 0.6, z);
        h.add(new THREE.ConeGeometry(s * 0.3, s * 0.42, 5), h.mat(0xe8eef6), x, s - s * 0.22 - 0.6, z);
      }
      // pines with snow
      for (const [x, z, s] of [[-4.8, -2.8, 1.3], [4.6, -3, 1.5], [-3.4, -3.6, 1], [3.2, -3.8, 1.1], [5.5, -2.2, 0.9], [-5.7, -2.1, 1]]) {
        h.pine(x, z, s, 0x1c3a2c, 0xe8f0f8);
      }
      // ice boulders
      for (let i = 0; i < 5; i++) h.blob(randRange(-5, 5), 0.2, randRange(-3.2, -2.4), randRange(0.25, 0.5), 0xc8d8ea);
      // aurora sheets
      const auroras = [];
      for (const [x, c] of [[-3, 0x40e890], [1.5, 0x50c8ff], [5, 0x9060ff]]) {
        const a = h.add(new THREE.PlaneGeometry(3.2, 5.5),
          h.basic(c, { transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
          x, 7.5, -11);
        a.rotation.x = 0.15;
        auroras.push({ a, p: rand() * 9 });
      }
      const snow = new Field(g, { n: 220, box: [9, 7, 5], y0: 0, color: 0xffffff, size: 0.06, fall: 0.8, drift: 0.9, swirl: 0.4, opacity: 0.9 });
      return {
        tick(dt, t) {
          snow.tick(dt, t);
          for (const au of auroras) {
            au.a.material.opacity = 0.09 + 0.08 * Math.abs(Math.sin(t * 0.5 + au.p));
            au.a.rotation.z = Math.sin(t * 0.3 + au.p) * 0.12;
          }
        },
      };
    },
  },
  {
    id: 'sakura', label: 'SAKURA GARDEN',
    sky: ['#2a1830', '#684458', '#2a1830'], fog: ['#3a2440', 12, 26],
    hemi: [0xffc8d8, 0x201622, 0.55], key: 0xfff0e0,
    build(g, h) {
      h.ground(0x5a6a4a);
      h.add(new THREE.BoxGeometry(11.6, 0.22, 7.1), h.mat(0x8a8578), 0, -0.48, -0.6);
      // torii gate
      const red = h.mat(0xc42838);
      for (const x of [-1.5, 1.5]) h.add(new THREE.CylinderGeometry(0.16, 0.2, 3.1, 7), red, x, 1.55, -3.6);
      const beam = h.add(new THREE.BoxGeometry(4.6, 0.34, 0.42), red, 0, 3.3, -3.6);
      beam.rotation.z = 0; h.add(new THREE.BoxGeometry(3.6, 0.24, 0.34), red, 0, 2.6, -3.6);
      h.add(new THREE.BoxGeometry(4.9, 0.16, 0.5), h.mat(0x35202a), 0, 3.52, -3.6);
      // blossom trees
      for (const [x, z, s] of [[-4.6, -3, 1.5], [4.8, -3.2, 1.7], [-6, -2, 1.1], [6.2, -1.8, 1]]) {
        const tr = h.add(new THREE.CylinderGeometry(0.14 * s, 0.22 * s, 1.6 * s, 5), h.mat(0x4a3020), x, 0.8 * s, z);
        tr.rotation.z = randRange(-0.15, 0.15);
        h.blob(x + 0.2, 1.9 * s, z, 0.95 * s, 0xf4a8c0);
        h.blob(x - 0.55, 1.5 * s, z + 0.25, 0.6 * s, 0xf8bccd);
        h.blob(x + 0.7, 1.45 * s, z - 0.2, 0.55 * s, 0xee9ab4);
      }
      // stone lanterns
      for (const x of [-2.6, 2.6]) {
        h.add(new THREE.CylinderGeometry(0.12, 0.16, 0.55, 6), h.mat(0x8a8880), x, 0.27, 2.4);
        h.add(new THREE.BoxGeometry(0.34, 0.28, 0.34), h.mat(0x9a988e), x, 0.68, 2.4);
        h.add(new THREE.BoxGeometry(0.12, 0.1, 0.12), h.basic(0xffd890), x, 0.66, 2.28);
        h.add(new THREE.ConeGeometry(0.3, 0.22, 4), h.mat(0x7a7870), x, 0.9, 2.4);
      }
      // distant pagoda silhouette
      for (let i = 0; i < 3; i++) {
        h.add(new THREE.BoxGeometry(1.6 - i * 0.35, 0.7, 1.6 - i * 0.35), h.mat(0x2c1e28), -7.5, 0.7 + i * 0.85, -7);
        h.add(new THREE.ConeGeometry(1.35 - i * 0.28, 0.5, 4), h.mat(0x8c2030), -7.5, 1.3 + i * 0.85, -7, Math.PI / 4);
      }
      const petals = new Field(g, { n: 160, box: [8, 5.5, 5], y0: 0, color: 0xffb8cc, size: 0.075, fall: 0.45, drift: 1.1, swirl: 0.8, opacity: 0.9 });
      return { tick: (dt, t) => petals.tick(dt, t) };
    },
  },
  {
    id: 'beach', label: 'SUNSET SHORES',
    sky: ['#2c1a3c', '#e86840', '#f8a850'], fog: ['#7a4048', 13, 30],
    hemi: [0xffb890, 0x2a1c28, 0.6], key: 0xffc890,
    build(g, h) {
      const sand = h.ground(0xdcc490);
      sand.material.roughness = 1;
      // ocean
      const ocean = h.add(new THREE.PlaneGeometry(40, 18), h.mat(0x2c6a86, { roughness: 0.2, metalness: 0.35 }), 0, -0.12, -12);
      ocean.rotation.x = -Math.PI / 2;
      // sun on horizon
      h.add(new THREE.SphereGeometry(1.6, 12, 10), h.basic(0xffcf70, { fog: false }), 3, 1.2, -19);
      const glowTex = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const x = c.getContext('2d');
        const gr = x.createRadialGradient(64, 64, 4, 64, 64, 62);
        gr.addColorStop(0, 'rgba(255,190,110,0.85)');
        gr.addColorStop(0.5, 'rgba(255,150,80,0.3)');
        gr.addColorStop(1, 'rgba(255,150,80,0)');
        x.fillStyle = gr;
        x.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
      })();
      const glow = h.add(new THREE.PlaneGeometry(10, 10), h.basic(0xffffff, { map: glowTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }), 3, 1.6, -18.8);
      // palms
      const palms = [];
      for (const [x, z, lean] of [[-4.9, -2.4, 0.35], [5.1, -2.8, -0.3], [-6.2, -1.6, 0.5]]) {
        const trunk = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.11 - i * 0.012, 0.13 - i * 0.012, 0.62, 5), h.mat(0x8a6a45));
          seg.position.set(Math.sin(lean) * i * 0.22, 0.28 + i * 0.56, 0);
          seg.rotation.z = -lean * 0.7;
          trunk.add(seg);
        }
        const top = new THREE.Group();
        top.position.set(Math.sin(lean) * 1.05, 3.05, 0);
        for (let i = 0; i < 6; i++) {
          const frond = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.5, 4), h.mat(0x2c6a3a));
          const a = (i / 6) * Math.PI * 2;
          frond.position.set(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55);
          frond.rotation.z = Math.cos(a) * 1.25;
          frond.rotation.x = -Math.sin(a) * 1.25;
          top.add(frond);
        }
        trunk.add(top);
        trunk.position.set(x, 0, z);
        g.add(trunk);
        palms.push({ top, p: rand() * 9 });
      }
      // rocks + starfish props
      for (let i = 0; i < 4; i++) h.blob(randRange(-5, 5), 0.15, randRange(2, 2.9), randRange(0.18, 0.4), 0x9a8a78);
      h.add(new THREE.CylinderGeometry(0.02, 0.35, 0.1, 5), h.mat(0xe86a50), 2.2, 0.05, 2.3);
      const spray = new Field(g, { n: 50, box: [10, 1.6, 2], y0: 0.05, color: 0xfff4e0, size: 0.05, fall: 0.25, drift: 1.3, opacity: 0.5 });
      return {
        tick(dt, t) {
          spray.tick(dt, t);
          ocean.position.y = -0.12 + Math.sin(t * 0.8) * 0.05;
          glow.material.opacity = 0.8 + 0.15 * Math.sin(t * 1.3);
          for (const p of palms) p.top.rotation.z = Math.sin(t * 1.4 + p.p) * 0.07;
        },
      };
    },
  },
];

let bag = [];
export function pickStage() {
  if (!bag.length) bag = STAGES.map((s, i) => i).sort(() => rand() - 0.5);
  return STAGES[bag.pop()];
}

// Build a stage into the scene. Returns { group, tick, dispose }.
export function buildStage(scene, stage) {
  const g = new THREE.Group();
  const h = helpers(g);
  const res = stage.build(g, h) || {};
  scene.add(g);
  return {
    group: g,
    tick: res.tick || null,
    dispose() {
      scene.remove(g);
      g.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      });
    },
  };
}

// Vertical gradient texture for the sky dome.
export function skyTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 256, 0, 0);
  stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), s));
  x.fillStyle = grad;
  x.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}
