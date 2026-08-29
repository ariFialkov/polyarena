// True-3D arena renderer (Three.js) with a locked front camera for a 2.5D read.
// Exposes the same Arena API as the old 2D canvas renderer, so engine/sim/UI
// are untouched. Fighters are low-poly, flat-shaded humanoids built on a named
// bone hierarchy (hips→spine→chest→head, shoulders→elbows, thighs→knees) with
// a procedural pose system — designed so skinned glTF rigs can replace the
// primitive meshes later without changing the choreography layer.
//
// Logical coordinates match the old renderer: fighter.x in [-1..1] across the
// ring (main.js walks entrances from ±1.5), mapped to world via RING_X.

import * as THREE from '../vendor/three.module.min.js';
import { clamp, lerp, rand, randRange } from './util.js';

const RING_X = 2.6;   // logical x=1 -> world 2.6
const RING_Z = 1.15;
const DUR = { strike: 0.42, hit: 0.35, hurt: 0.62, block: 0.5, down: 0.9 };

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

export class Arena {
  constructor(canvas) {
    this.cv = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x090b14, 13, 26);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    this.camBase = new THREE.Vector3(0, 2.35, 8.6);
    this.camLook = new THREE.Vector3(0, 1.05, 0);
    this.camPunch = 0;        // 0..1 KO punch-in
    this.camera.position.copy(this.camBase);

    this.fighters = [null, null];
    this.shake = 0;
    this.slowmo = 1;
    this.time = 0;

    // DOM flash overlay (white hit flash / red fatality wash)
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'fx-flash';
    canvas.parentElement.appendChild(this.flashEl);
    this.flash = 0; this.redFlash = 0;

    this.buildEnvironment();
    this.particles = new ParticlePool(this.scene, 420);
    this.resize();
  }

  resize() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // frame the ring on narrow screens by pulling back
    this.camera.fov = w / h < 0.9 ? 50 : 38;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------ environment ------------------------------

  buildEnvironment() {
    const S = this.scene;

    // lighting
    S.add(new THREE.HemisphereLight(0x7880b8, 0x120e1c, 0.5));
    const key = new THREE.SpotLight(0xfff2dd, 190, 30, 0.55, 0.45, 1.6);
    key.position.set(0, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0015;
    S.add(key, key.target);
    const spotA = new THREE.SpotLight(0xff5060, 90, 30, 0.5, 0.6, 1.8);
    spotA.position.set(-6, 8, 2);
    const spotB = new THREE.SpotLight(0x5080ff, 90, 30, 0.5, 0.6, 1.8);
    spotB.position.set(6, 8, 2);
    S.add(spotA, spotA.target, spotB, spotB.target);

    // arena wall (gradient cylinder) + dark outer floor
    const wallTex = makeGradientTexture(['#05060c', '#10142a', '#05060c']);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(17, 17, 14, 24, 1, true),
      new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide, fog: false })
    );
    wall.position.y = 4;
    S.add(wall);
    S.background = new THREE.Color(0x05060c);

    const outer = new THREE.Mesh(
      new THREE.CircleGeometry(18, 28),
      new THREE.MeshStandardMaterial({ color: 0x0c0e1a, roughness: 0.95 })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.92;
    S.add(outer);

    this.buildRing(S);
    this.buildCrowd(S);
    this.buildLightCones(S);
  }

  buildRing(S) {
    // mat with painted canvas texture
    const matTex = makeRingMatTexture();
    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(7.6, 0.14, 5.6),
      [
        new THREE.MeshStandardMaterial({ color: 0x23273d, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0x23273d, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ color: 0x23273d, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0x23273d, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0x23273d, roughness: 0.9 }),
      ]
    );
    mat.position.y = -0.07;
    mat.receiveShadow = true;
    S.add(mat);

    // apron / platform with logo strip
    const apronTex = makeApronTexture();
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(7.6, 0.85, 5.6),
      new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.9 })
    );
    apron.position.y = -0.565;
    S.add(apron);

    // posts + turnbuckle pads
    const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.65, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xb9bdd4, metalness: 0.7, roughness: 0.35 });
    const padGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.5, 6);
    for (const [px, pz] of [[-3.6, -2.6], [3.6, -2.6], [-3.6, 2.6], [3.6, 2.6]]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(px, 0.75, pz);
      post.castShadow = true;
      S.add(post);
      const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({
        color: px < 0 ? 0xc0392b : 0x2b4aa0, roughness: 0.7,
      }));
      pad.position.set(px * 0.97, 1.0, pz * 0.96);
      pad.rotation.z = px < 0 ? -0.15 : 0.15;
      S.add(pad);
    }

    // sagging ropes: 3 heights x 4 sides
    const ropeColors = [0xd84545, 0xe8e8f0, 0x4576d8];
    const corners = [
      [new THREE.Vector3(-3.6, 0, -2.6), new THREE.Vector3(3.6, 0, -2.6)],
      [new THREE.Vector3(3.6, 0, -2.6), new THREE.Vector3(3.6, 0, 2.6)],
      [new THREE.Vector3(3.6, 0, 2.6), new THREE.Vector3(-3.6, 0, 2.6)],
      [new THREE.Vector3(-3.6, 0, 2.6), new THREE.Vector3(-3.6, 0, -2.6)],
    ];
    for (let h = 0; h < 3; h++) {
      const y = 0.55 + h * 0.42;
      const ropeMat = new THREE.MeshStandardMaterial({ color: ropeColors[h], roughness: 0.6 });
      for (const [a, b] of corners) {
        const p1 = a.clone().setY(y), p2 = b.clone().setY(y);
        const mid = p1.clone().lerp(p2, 0.5); mid.y -= 0.06;
        const curve = new THREE.CatmullRomCurve3([p1, mid, p2]);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.032, 5), ropeMat);
        S.add(tube);
      }
    }
  }

  buildCrowd(S) {
    const bodyGeo = new THREE.CapsuleGeometry(0.17, 0.3, 2, 6);
    const headGeo = new THREE.IcosahedronGeometry(0.11, 0);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    const headMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });

    const seats = [];
    const addStand = (rows, perRow, fn) => {
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < perRow; i++) {
          if (rand() < 0.12) continue; // empty seats
          seats.push({ ...fn(r, i), phase: rand() * 9, amp: randRange(0.015, 0.05), speed: randRange(1.5, 3.5) });
        }
      }
    };
    // back stand
    addStand(5, 34, (r, i) => ({
      x: -8 + i * 0.485 + randRange(-0.08, 0.08),
      y: 0.1 + r * 0.62,
      z: -4.6 - r * 0.85,
    }));
    // side stands
    addStand(4, 14, (r, i) => ({
      x: -5.3 - r * 0.85,
      y: 0.1 + r * 0.62,
      z: -3.4 + i * 0.5,
    }));
    addStand(4, 14, (r, i) => ({
      x: 5.3 + r * 0.85,
      y: 0.1 + r * 0.62,
      z: -3.4 + i * 0.5,
    }));

    this.crowdSeats = seats;
    this.crowdBodies = new THREE.InstancedMesh(bodyGeo, bodyMat, seats.length);
    this.crowdHeads = new THREE.InstancedMesh(headGeo, headMat, seats.length);
    const c = new THREE.Color();
    for (let i = 0; i < seats.length; i++) {
      c.setHSL(rand(), randRange(0.25, 0.6), randRange(0.18, 0.42));
      this.crowdBodies.setColorAt(i, c);
      c.setHSL(randRange(0.05, 0.11), randRange(0.3, 0.6), randRange(0.25, 0.75));
      this.crowdHeads.setColorAt(i, c);
    }
    S.add(this.crowdBodies, this.crowdHeads);
    this._dummy = new THREE.Object3D();
    this.updateCrowd(0);

    // bleacher slabs beneath
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x151830, roughness: 0.95 });
    for (let r = 0; r < 5; r++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(17, 0.5, 0.9), slabMat);
      slab.position.set(0, -0.2 + r * 0.62, -4.65 - r * 0.85);
      S.add(slab);
    }
    for (const sx of [-1, 1]) {
      for (let r = 0; r < 4; r++) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 7.5), slabMat);
        slab.position.set(sx * (5.35 + r * 0.85), -0.2 + r * 0.62, -0.2);
        S.add(slab);
      }
    }
  }

  buildLightCones(S) {
    const coneTex = makeGradientTexture(['rgba(255,255,255,0.4)', 'rgba(255,255,255,0)']);
    const geo = new THREE.ConeGeometry(2.4, 8, 16, 1, true);
    for (const [x, color] of [[-3.2, 0xff4d5e], [3.2, 0x4d7dff]]) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: coneTex, color, transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }));
      m.position.set(x, 4.6, -0.4);
      S.add(m);
    }
  }

  updateCrowd(t) {
    const d = this._dummy;
    for (let i = 0; i < this.crowdSeats.length; i++) {
      const s = this.crowdSeats[i];
      const bob = Math.sin(t * s.speed + s.phase) * s.amp + (this.hype ? Math.abs(Math.sin(t * 6 + s.phase)) * 0.09 : 0);
      d.position.set(s.x, s.y + bob, s.z);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      this.crowdBodies.setMatrixAt(i, d.matrix);
      d.position.y += 0.32;
      d.updateMatrix();
      this.crowdHeads.setMatrixAt(i, d.matrix);
    }
    this.crowdBodies.instanceMatrix.needsUpdate = true;
    this.crowdHeads.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------ fighters ------------------------------

  setFighters(A, B) {
    for (const f of this.fighters) if (f) this.scene.remove(f.root);
    this.fighters = [new Fighter(A, 0), new Fighter(B, 1)];
    for (const f of this.fighters) this.scene.add(f.root);
    this.shake = 0; this.flash = 0; this.redFlash = 0; this.slowmo = 1;
    this.camPunch = 0; this.hype = false;
  }

  fighter(i) { return this.fighters[i]; }

  // ------------------------------ action triggers ------------------------------

  strike(by, type, landed, hurt = false) {
    const f = this.fighters[by], o = this.fighters[1 - by];
    if (!f || !o) return;
    f.startStrike(type);
    if (landed) {
      o.anim = hurt ? 'hurt' : 'hit';
      o.animT = -DUR.strike * 0.45; // impact lands mid-swing
      setTimeout(() => this.impactFx(1 - by, hurt), 150);
    } else if (rand() < 0.5) {
      o.anim = 'block'; o.animT = 0;
    }
  }

  impactFx(victim, hurt) {
    const v = this.fighters[victim];
    if (!v) return;
    const p = v.headWorld();
    this.particles.burst(p, hurt ? 16 : 7, {
      color: hurt ? 0xff5a3c : 0xffd75e, speed: hurt ? 3.2 : 1.8,
      life: 0.5, size: hurt ? 0.09 : 0.06, gravity: 5,
    });
    this.shake = Math.max(this.shake, hurt ? 0.09 : 0.035);
    if (hurt) this.flash = Math.max(this.flash, 0.25);
  }

  knockdown(loserIdx) {
    const l = this.fighters[loserIdx];
    l.anim = 'down'; l.animT = 0;
    this.shake = 0.22; this.flash = 0.9;
    this.slowmo = 0.22; this.camPunchTarget = 1; this.hype = true;
    setTimeout(() => { this.slowmo = 1; }, 1500);
    this.particles.burst(l.headWorld(), 30, { color: 0xffdf80, speed: 4.5, life: 0.9, size: 0.1, gravity: 6 });
  }

  fatality(winnerIdx) {
    const w = this.fighters[winnerIdx], l = this.fighters[1 - winnerIdx];
    this.redFlash = 1;
    w.anim = 'win'; w.animT = 0;
    l.anim = 'launched'; l.animT = 0;
    const p = l.hips.getWorldPosition(new THREE.Vector3());
    this.particles.burst(p, 60, { color: 0xff2840, speed: 4, life: 1.6, size: 0.12, gravity: 2, rise: 2.5 });
    this.particles.burst(p, 40, { color: 0xffb060, speed: 2.5, life: 2.2, size: 0.08, gravity: 0, rise: 3.5 });
  }

  celebrate(winnerIdx) {
    const w = this.fighters[winnerIdx];
    if (w) { w.anim = 'win'; w.animT = 0; }
    this.hype = true;
  }

  // ------------------------------ frame update ------------------------------

  update(dt, fighting) {
    const sdt = dt * this.slowmo;
    this.time += sdt;
    const [a, b] = this.fighters;
    if (a && b) {
      if (fighting) this.updateMovement(sdt, a, b);
      a.update(sdt, b);
      b.update(sdt, a);
    }
    this.particles.update(sdt);
    this.shake = Math.max(0, this.shake - dt * 0.55);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.redFlash = Math.max(0, this.redFlash - dt * 0.5);
    this.camPunch = lerp(this.camPunch, this.camPunchTarget || 0, Math.min(1, dt * 2.2));
    if (this.camPunchTarget && this.slowmo === 1) this.camPunchTarget = Math.max(0.35, this.camPunchTarget - dt * 0.3);
  }

  // same footwork logic as the 2D renderer, in logical coords
  updateMovement(dt, a, b) {
    for (const f of [a, b]) {
      if (['down', 'win', 'launched'].includes(f.anim)) continue;
      const opp = f === a ? b : a;
      const dir = Math.sign(opp.x - f.x) || (f.idx === 0 ? 1 : -1);
      const dist = Math.abs(opp.x - f.x);
      const want = 0.36 + Math.sin(f.phase * 0.35 + f.idx * 3) * 0.09;
      let vx = 0;
      if (dist > want + 0.03) vx = dir * 0.34;
      else if (dist < want - 0.03) vx = -dir * 0.26;
      f.x = clamp(f.x + vx * dt, -0.95, 0.95);
      f.z = clamp(f.z + Math.sin(f.phase * 0.23 + f.idx * 5) * 0.05 * dt, -0.45, 0.5);
      f.facing = dir;
      if (['strike', 'hit', 'hurt', 'block'].includes(f.anim)) {
        if (f.animT > (DUR[f.anim] || 0.4)) { f.anim = 'idle'; f.animT = 0; }
      } else {
        f.anim = Math.abs(vx) > 0.05 ? 'walk' : 'idle';
      }
    }
  }

  draw() {
    const t = this.time;
    this.updateCrowd(t);

    // camera: locked forward, subtle life, shake, KO punch-in
    const punch = this.camPunch;
    const px = randRange(-1, 1) * this.shake, py = randRange(-1, 1) * this.shake * 0.6;
    const focusX = this.fighters[0] && this.fighters[1]
      ? ((this.fighters[0].x + this.fighters[1].x) / 2) * RING_X * 0.45 : 0;
    this.camera.position.set(
      this.camBase.x + Math.sin(t * 0.3) * 0.08 + focusX * (0.3 + punch * 0.5) + px,
      this.camBase.y + Math.sin(t * 0.47) * 0.05 - punch * 0.55 + py,
      this.camBase.z - punch * 2.6
    );
    this.camera.lookAt(this.camLook.x + focusX * punch, this.camLook.y + Math.sin(t * 0.4) * 0.03, this.camLook.z);

    this.flashEl.style.background = this.redFlash > 0.01
      ? `rgba(150,10,25,${(this.redFlash * 0.5).toFixed(3)})`
      : `rgba(255,255,255,${this.flash.toFixed(3)})`;
    this.flashEl.style.opacity = (this.flash > 0.01 || this.redFlash > 0.01) ? 1 : 0;

    this.renderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------------------
// Fighter rig: named bone hierarchy + procedural pose targets with smoothing.
// ---------------------------------------------------------------------------

class Fighter {
  constructor(def, idx) {
    this.def = def;
    this.idx = idx;
    this.x = idx === 0 ? -0.45 : 0.45;   // logical coords (match old renderer)
    this.z = 0;
    this.facing = idx === 0 ? 1 : -1;
    this.anim = 'idle';
    this.animT = 0;
    this.phase = rand() * 10;
    this.strikeType = 'jab';
    this.dissolve = 0;
    this.lunge = 0;

    this.buildRig();
    this.targets = {};   // boneName -> {x,y,z}
    this.rate = 14;
  }

  buildRig() {
    const d = this.def;
    const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({
      color, roughness: 0.62, metalness: 0.04, flatShading: true, transparent: true, ...opts,
    });
    this.mats = [];
    const M = (c, o) => { const m = mat(c, o); this.mats.push(m); return m; };
    const skin = M(d.skin), skinD = M(shade(d.skin, -22)), trunks = M(d.trunks),
      accent = M(d.accent, { roughness: 0.4 }), hair = M(d.hair, { roughness: 0.8 });

    const grp = () => new THREE.Group();
    const mesh = (geo, m, x, y, z) => {
      const me = new THREE.Mesh(geo, m);
      me.position.set(x, y, z);
      me.castShadow = true;
      return me;
    };

    // root faces +Z in local space; rotation.y = facing * PI/2 turns it down the ring axis
    this.root = grp();
    this.hipsBaseY = 0.87;
    this.hips = grp(); this.hips.position.y = this.hipsBaseY;
    this.root.add(this.hips);

    // pelvis + trunks
    this.hips.add(mesh(new THREE.CylinderGeometry(0.20, 0.23, 0.3, 6), trunks, 0, 0.02, 0));

    // spine / chest
    this.spine = grp(); this.spine.position.y = 0.14; this.hips.add(this.spine);
    this.spine.add(mesh(new THREE.CylinderGeometry(0.185, 0.165, 0.24, 6), skin, 0, 0.1, 0));
    this.chest = grp(); this.chest.position.y = 0.24; this.spine.add(this.chest);
    this.chest.add(mesh(new THREE.CylinderGeometry(0.26, 0.18, 0.4, 6), skin, 0, 0.16, 0));

    // head
    this.neck = grp(); this.neck.position.y = 0.38; this.chest.add(this.neck);
    this.neck.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 6), skinD, 0, 0.03, 0));
    const head = mesh(new THREE.IcosahedronGeometry(0.145, 1), skin, 0, 0.17, 0.01);
    this.neck.add(head);
    const hairMesh = mesh(new THREE.IcosahedronGeometry(0.15, 1), hair, 0, 0.21, -0.04);
    hairMesh.scale.set(1.02, 0.75, 1.02);
    this.neck.add(hairMesh);
    for (const ex of [-0.055, 0.055]) {
      this.neck.add(mesh(new THREE.SphereGeometry(0.018, 6, 4), M('#14141c'), ex, 0.19, 0.135));
    }

    // arms: shoulder -> elbow -> glove
    this.arms = {};
    for (const side of [-1, 1]) {
      const sh = grp(); sh.position.set(side * 0.28, 0.30, 0); this.chest.add(sh);
      sh.add(mesh(new THREE.SphereGeometry(0.09, 6, 5), skin, 0, 0, 0));
      sh.add(mesh(new THREE.CapsuleGeometry(0.072, 0.24, 2, 6), skin, 0, -0.16, 0));
      const el = grp(); el.position.y = -0.32; sh.add(el);
      el.add(mesh(new THREE.CapsuleGeometry(0.06, 0.2, 2, 6), skinD, 0, -0.13, 0));
      el.add(mesh(new THREE.IcosahedronGeometry(0.1, 1), accent, 0, -0.3, 0.01));
      this.arms[side] = { sh, el };
    }

    // legs: thigh -> knee (+boot)
    this.legs = {};
    for (const side of [-1, 1]) {
      const th = grp(); th.position.set(side * 0.13, -0.06, 0); this.hips.add(th);
      th.add(mesh(new THREE.CapsuleGeometry(0.1, 0.3, 2, 6), trunks, 0, -0.18, 0));
      const kn = grp(); kn.position.y = -0.42; th.add(kn);
      kn.add(mesh(new THREE.CapsuleGeometry(0.078, 0.28, 2, 6), skin, 0, -0.17, 0));
      const boot = mesh(new THREE.BoxGeometry(0.13, 0.1, 0.28), accent, 0, -0.4, 0.05);
      kn.add(boot);
      this.legs[side] = { th, kn };
    }
  }

  headWorld() {
    return this.neck.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0));
  }

  startStrike(type) {
    this.anim = 'strike';
    this.animT = 0;
    this.strikeType = type;
    // alternate arms for variety on arm strikes
    this.strikeSide = this.strikeSide === 1 ? -1 : 1;
  }

  // -------- pose computation --------

  setT(bone, x, y, z) { this.targets[bone] = { x, y, z }; }

  update(dt, opp) {
    this.animT += dt;
    this.phase += dt * (this.anim === 'walk' ? 7 : 2.4);
    if (this.dissolve > 0 && this.dissolve < 1) {
      this.dissolve = Math.min(1, this.dissolve + dt * 0.8);
      const op = 1 - this.dissolve;
      for (const m of this.mats) m.opacity = op;
    }

    this.computePose();
    this.applyTargets(dt);

    // world placement
    const dir = this.facing;
    this.root.position.set(this.x * RING_X + this.lunge * dir, this.rootY || 0, this.z * RING_Z);
    // face down the ring axis, angled a touch toward camera for readability
    const yaw = dir * Math.PI / 2 - dir * 0.22;
    this.root.rotation.y += (yaw - this.root.rotation.y) * Math.min(1, dt * 10);
  }

  computePose() {
    const t = this.animT, ph = this.phase;
    this.rate = 14;
    this.rootY = 0;
    this.lunge = Math.max(0, this.lunge - 0.04);

    // base guard
    const bob = Math.sin(ph) * 0.02;
    this.setT('hipsPos', 0, bob, 0);
    this.setT('hips', 0, 0, 0);
    this.setT('spine', 0.06, 0, 0);
    this.setT('chest', 0.05, 0, 0);
    this.setT('neck', -0.06, 0, 0);
    this.setT('shL', -0.85, 0.3, -0.25);
    this.setT('elL', -1.5, 0, 0);
    this.setT('shR', -0.8, -0.3, 0.25);
    this.setT('elR', -1.45, 0, 0);
    this.setT('thL', -0.08, 0, 0.05);
    this.setT('knL', 0.12, 0, 0);
    this.setT('thR', 0.05, 0, -0.05);
    this.setT('knR', 0.1, 0, 0);

    switch (this.anim) {
      case 'idle': {
        const s = Math.sin(ph * 1.3) * 0.06;
        this.setT('shL', -0.85 + s, 0.3, -0.25);
        this.setT('shR', -0.8 - s, -0.3, 0.25);
        this.setT('chest', 0.05, Math.sin(ph * 0.6) * 0.05, 0);
        break;
      }
      case 'walk': {
        const sw = Math.sin(ph);
        this.setT('thL', -0.12 + sw * 0.5, 0, 0.05);
        this.setT('knL', 0.3 + Math.max(0, -sw) * 0.5, 0, 0);
        this.setT('thR', 0.08 - sw * 0.5, 0, -0.05);
        this.setT('knR', 0.3 + Math.max(0, sw) * 0.5, 0, 0);
        this.setT('hipsPos', 0, Math.abs(Math.cos(ph)) * 0.04, 0);
        break;
      }
      case 'strike': this.poseStrike(t); break;
      case 'hit': case 'hurt': {
        const big = this.anim === 'hurt';
        const k = Math.sin(clamp(t / DUR[this.anim], 0, 1) * Math.PI);
        this.rate = 18;
        this.setT('neck', -0.06 - k * (big ? 0.75 : 0.45), k * 0.2, 0);
        this.setT('chest', 0.05 - k * (big ? 0.5 : 0.25), -k * 0.3, 0);
        this.setT('spine', 0.06 - k * 0.2, 0, 0);
        this.setT('hipsPos', 0, -k * (big ? 0.12 : 0.04), 0);
        if (big) {
          this.setT('shL', -0.2, 0.5, -0.7);
          this.setT('shR', -0.15, -0.5, 0.7);
          this.setT('knL', 0.6, 0, 0); this.setT('knR', 0.55, 0, 0);
        }
        break;
      }
      case 'block': {
        this.setT('shL', -1.2, 0.15, -0.15);
        this.setT('elL', -2.2, 0, 0);
        this.setT('shR', -1.15, -0.15, 0.15);
        this.setT('elR', -2.15, 0, 0);
        this.setT('chest', 0.18, 0, 0);
        this.setT('hipsPos', 0, -0.05, 0);
        break;
      }
      case 'down': {
        const p = easeOutBack(clamp(t / DUR.down, 0, 1));
        this.rate = 10;
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
        // fatality: launched up, spinning, then gone
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
      case 'win': {
        const j = Math.abs(Math.sin(t * 5.5));
        this.setT('shL', -2.7 + j * 0.25, 0.35, -0.2);
        this.setT('shR', -2.65 - j * 0.25, -0.35, 0.2);
        this.setT('elL', -0.35, 0, 0);
        this.setT('elR', -0.4, 0, 0);
        this.setT('hipsPos', 0, j * 0.16, 0);
        this.setT('neck', -0.25, 0, 0);
        this.setT('knL', 0.3 + j * 0.5, 0, 0);
        this.setT('knR', 0.3 + j * 0.5, 0, 0);
        break;
      }
    }
  }

  poseStrike(t) {
    const k = Math.sin(clamp(t / DUR.strike, 0, 1) * Math.PI); // windup->extend->retract
    const sharp = Math.pow(k, 1.5);
    const S = this.strikeSide || 1;
    const lead = S === 1 ? 'L' : 'R', rear = S === 1 ? 'R' : 'L';
    const sgn = S; // lead arm side sign
    this.rate = 26;
    this.lunge = sharp * 0.28;

    switch (this.strikeType) {
      case 'jab':
        this.setT('sh' + lead, -0.85 - sharp * 0.75, sgn * (0.3 - sharp * 0.3), -sgn * 0.25 * (1 - sharp));
        this.setT('el' + lead, -1.5 + sharp * 1.4, 0, 0);
        this.setT('chest', 0.05, -sgn * sharp * 0.45, 0);
        break;
      case 'cross':
        this.setT('sh' + rear, -0.8 - sharp * 0.8, -sgn * (0.3 - sharp * 0.35), sgn * 0.25 * (1 - sharp));
        this.setT('el' + rear, -1.45 + sharp * 1.35, 0, 0);
        this.setT('chest', 0.08, sgn * sharp * 0.8, 0);
        this.setT('hips', 0, sgn * sharp * 0.4, 0);
        break;
      case 'hook':
        this.setT('sh' + lead, -1.35 * sharp - 0.4, sgn * (0.3 - sharp * 1.1), 0);
        this.setT('el' + lead, -1.6, 0, 0);
        this.setT('chest', 0.05, -sgn * sharp * 0.9, 0);
        this.setT('hips', 0, -sgn * sharp * 0.45, 0);
        break;
      case 'upper':
        this.setT('sh' + rear, -0.2 - sharp * 1.3, 0, sgn * 0.2);
        this.setT('el' + rear, -2.3 + sharp * 0.6, 0, 0);
        this.setT('chest', 0.35 - sharp * 0.55, sgn * sharp * 0.5, 0);
        this.setT('hipsPos', 0, -0.1 * (1 - sharp), 0);
        break;
      case 'kick': {
        // rear-leg roundhouse
        const leg = rear === 'L' ? 'L' : 'R', lsgn = leg === 'L' ? 1 : -1;
        this.setT('th' + leg, -1.5 * sharp + 0.1, lsgn * sharp * 0.5, 0);
        this.setT('kn' + leg, 1.9 - sharp * 1.8, 0, 0);
        this.setT('chest', 0.05 - sharp * 0.35, lsgn * sharp * 0.7, 0);
        this.setT('hips', 0, lsgn * sharp * 0.5, -lsgn * sharp * 0.15);
        this.setT('shL', -0.9, 0.5, -0.5);
        this.setT('shR', -0.85, -0.5, 0.5);
        break;
      }
      case 'knee': {
        const leg = rear === 'L' ? 'L' : 'R';
        this.setT('th' + leg, -1.75 * sharp, 0, 0);
        this.setT('kn' + leg, 2.1 * sharp + 0.2, 0, 0);
        this.setT('chest', 0.05 + sharp * 0.35, 0, 0);
        this.setT('spine', 0.06 + sharp * 0.25, 0, 0);
        this.setT('shL', -0.55 + sharp * 0.6, 0.25, -0.35);
        this.setT('shR', -0.5 + sharp * 0.6, -0.25, 0.35);
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

// ---------------------------------------------------------------------------
// Particles: pooled THREE.Points with per-particle velocity/life.
// ---------------------------------------------------------------------------

class ParticlePool {
  constructor(scene, n) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.size = new Float32Array(n);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
      map: makeDotTexture(), blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.tmpColor = new THREE.Color();
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -50;
  }

  burst(p, count, { color = 0xffd75e, speed = 2, life = 0.6, gravity = 5, rise = 0 } = {}) {
    this.tmpColor.set(color);
    for (let j = 0; j < count; j++) {
      const i = this.cursor = (this.cursor + 1) % this.n;
      this.pos[i * 3] = p.x + randRange(-0.1, 0.1);
      this.pos[i * 3 + 1] = p.y + randRange(-0.1, 0.1);
      this.pos[i * 3 + 2] = p.z + randRange(-0.1, 0.1);
      const th = rand() * Math.PI * 2, sp = randRange(0.3, 1) * speed;
      this.vel[i * 3] = Math.cos(th) * sp;
      this.vel[i * 3 + 1] = randRange(0.2, 1) * speed * 0.8 + rise;
      this.vel[i * 3 + 2] = Math.sin(th) * sp * 0.5;
      this.life[i] = this.maxLife[i] = life * randRange(0.6, 1.3);
      this.grav[i] = gravity;
      const v = randRange(0.7, 1.1);
      this.col[i * 3] = this.tmpColor.r * v;
      this.col[i * 3 + 1] = this.tmpColor.g * v;
      this.col[i * 3 + 2] = this.tmpColor.b * v;
    }
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col[i * 3] *= 0.98; this.col[i * 3 + 1] *= 0.98; this.col[i * 3 + 2] *= 0.98;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -50;
    }
    if (any) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Canvas textures
// ---------------------------------------------------------------------------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function makeRingMatTexture() {
  const [c, x] = makeCanvas(1024, 768);
  const g = x.createRadialGradient(512, 384, 60, 512, 384, 620);
  g.addColorStop(0, '#2c3157');
  g.addColorStop(0.7, '#232746');
  g.addColorStop(1, '#1b1e38');
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 768);
  // wear noise
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${rand() < 0.5 ? '0,0,20' : '160,170,220'},${randRange(0.015, 0.05)})`;
    x.beginPath();
    x.arc(rand() * 1024, rand() * 768, randRange(2, 18), 0, 7);
    x.fill();
  }
  // center ring + logo
  x.strokeStyle = 'rgba(255,200,60,0.5)';
  x.lineWidth = 6;
  x.beginPath(); x.arc(512, 384, 200, 0, 7); x.stroke();
  x.fillStyle = 'rgba(255,200,60,0.30)';
  x.font = '900 92px system-ui';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('POLYARENA', 512, 384);
  // border stripes
  x.strokeStyle = 'rgba(200,60,70,0.55)';
  x.lineWidth = 26;
  x.strokeRect(30, 30, 964, 708);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function makeApronTexture() {
  const [c, x] = makeCanvas(1024, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#1a1e3a');
  g.addColorStop(1, '#0e1122');
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 256);
  x.fillStyle = 'rgba(255,200,60,0.8)';
  x.font = '900 110px system-ui';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('POLYARENA', 512, 128);
  x.fillStyle = 'rgba(255,80,90,0.9)';
  x.fillRect(0, 8, 1024, 10);
  x.fillRect(0, 238, 1024, 10);
  return new THREE.CanvasTexture(c);
}

function makeGradientTexture(stops) {
  const [c, x] = makeCanvas(4, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}

function makeDotTexture() {
  const [c, x] = makeCanvas(64, 64);
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function easeOutBack(t) {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return (r << 16) | (g << 8) | b;
}
