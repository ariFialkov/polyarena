// True-3D fight renderer (Three.js) with a locked front camera for a 2.5D read.
// Mortal-Kombat style: themed stages (js/stages.js), ninja-garbed low-poly
// fighters on a named bone rig, a martial-arts move set, and per-fighter
// specials (fireball projectile, teleport strike, flying kick, ground-slam
// shockwave) with full VFX. Same Arena API the game has always used.

import * as THREE from '../vendor/three.module.min.js';
import { clamp, lerp, rand, randRange } from './util.js';
import { buildStage, skyTexture } from './stages.js';
import { sfx } from './audio.js';

const RING_X = 2.6;   // logical x=1 -> world 2.6
const RING_Z = 1.15;
const DUR = {
  strike: 0.42, hit: 0.35, hurt: 0.62, block: 0.5, down: 0.9,
  cast: 0.55, flying: 0.6, slam: 0.75,
};
export const SPECIALS = ['fireball', 'teleport', 'flyingkick', 'shockwave'];

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

export class Arena {
  constructor(canvas) {
    this.cv = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x10141f, 12, 26);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    this.camBase = new THREE.Vector3(0, 2.35, 8.6);
    this.camLook = new THREE.Vector3(0, 1.05, 0);
    this.camPunch = 0;
    this.camera.position.copy(this.camBase);

    this.fighters = [null, null];
    this.shake = 0;
    this.slowmo = 1;
    this.time = 0;
    this.projectiles = [];
    this.rings = [];
    this.timers = [];

    // shared lights (tinted per stage)
    this.hemi = new THREE.HemisphereLight(0x8890c8, 0x14101e, 0.5);
    this.key = new THREE.SpotLight(0xfff2dd, 190, 34, 0.55, 0.45, 1.6);
    this.key.position.set(0, 9, 6);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0015;
    this.rim = new THREE.DirectionalLight(0x8090ff, 0.5);
    this.rim.position.set(0, 4, -6);
    this.scene.add(this.hemi, this.key, this.key.target, this.rim);

    // sky dome + abyss floor below stage edges
    this.sky = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 22, 26, 24, 1, true),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false })
    );
    this.sky.position.y = 6;
    this.abyss = new THREE.Mesh(
      new THREE.CircleGeometry(30, 24),
      new THREE.MeshBasicMaterial({ color: 0x05060c })
    );
    this.abyss.rotation.x = -Math.PI / 2;
    this.abyss.position.y = -2.5;
    this.scene.add(this.sky, this.abyss);

    // DOM flash overlay
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'fx-flash';
    canvas.parentElement.appendChild(this.flashEl);
    this.flash = 0; this.redFlash = 0;

    this.particles = new ParticlePool(this.scene, 520);
    this.resize();
  }

  resize() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.9 ? 50 : 38;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------ stage ------------------------------

  setStage(stage) {
    if (this.stageObj) this.stageObj.dispose();
    if (this.sky.material.map) this.sky.material.map.dispose();
    this.stage = stage;
    this.stageObj = buildStage(this.scene, stage);
    this.sky.material.map = skyTexture(stage.sky);
    this.sky.material.needsUpdate = true;
    this.scene.background = new THREE.Color(stage.sky[0]);
    this.scene.fog.color.set(stage.fog[0]);
    this.scene.fog.near = stage.fog[1];
    this.scene.fog.far = stage.fog[2];
    this.hemi.color.set(stage.hemi[0]);
    this.hemi.groundColor.set(stage.hemi[1]);
    this.hemi.intensity = stage.hemi[2];
    this.key.color.set(stage.key);
  }

  // ------------------------------ fighters ------------------------------

  setFighters(A, B) {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const p of this.projectiles) this.removeProjectile(p);
    this.projectiles = [];
    for (const f of this.fighters) if (f) this.scene.remove(f.root);
    this.fighters = [new Fighter(A, 0), new Fighter(B, 1)];
    for (const f of this.fighters) this.scene.add(f.root);
    this.shake = 0; this.flash = 0; this.redFlash = 0; this.slowmo = 1;
    this.camPunch = 0; this.camPunchTarget = 0;
  }

  fighter(i) { return this.fighters[i]; }

  later(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

  // ------------------------------ actions ------------------------------

  strike(by, type, landed, hurt = false) {
    const f = this.fighters[by], o = this.fighters[1 - by];
    if (!f || !o) return;

    switch (type) {
      case 'fireball': return this.doFireball(f, o);
      case 'teleport': return this.doTeleport(f, o);
      case 'flyingkick': return this.doFlyingKick(f, o);
      case 'shockwave': return this.doShockwave(f, o);
    }

    f.startStrike(type);
    if (landed) {
      o.anim = hurt ? 'hurt' : 'hit';
      o.animT = -DUR.strike * 0.45;
      this.later(150, () => this.impactFx(1 - by, hurt));
    } else if (rand() < 0.5) {
      o.anim = 'block'; o.animT = 0;
    }
  }

  // ---- specials ----

  doFireball(f, o) {
    f.anim = 'cast'; f.animT = 0;
    sfx.fireball();
    const color = new THREE.Color(f.def.accent);
    this.later(200, () => {
      const from = f.chest.getWorldPosition(new THREE.Vector3());
      from.y += 0.1;
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.2, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })
      );
      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.34, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      mesh.add(shell);
      const light = new THREE.PointLight(color, 14, 6, 1.8);
      mesh.position.copy(from);
      light.position.copy(from);
      this.scene.add(mesh, light);
      this.projectiles.push({ mesh, light, from, victim: o, caster: f, t: 0, dur: 0.6, color: color.getHex() });
    });
  }

  removeProjectile(p) {
    this.scene.remove(p.mesh, p.light);
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
  }

  doTeleport(f, o) {
    const pos = f.hips.getWorldPosition(new THREE.Vector3());
    this.particles.burst(pos, 26, { color: f.def.accent, speed: 2.2, life: 0.5, size: 0.08, gravity: -1 });
    f.root.visible = false;
    sfx.teleport();
    this.later(240, () => {
      // reappear on the far side of the opponent
      f.x = clamp(o.x + (f.x < o.x ? 0.32 : -0.32), -0.95, 0.95);
      f.root.position.x = f.x * RING_X;
      f.root.visible = true;
      const p2 = f.hips.getWorldPosition(new THREE.Vector3());
      p2.x = f.x * RING_X;
      this.particles.burst(p2, 26, { color: f.def.accent, speed: 2.2, life: 0.5, size: 0.08, gravity: -1 });
      f.startStrike('backfist');
      this.later(140, () => {
        o.anim = 'hurt'; o.animT = 0;
        this.impactFx(o.idx, true);
        sfx.bigHit();
      });
    });
  }

  doFlyingKick(f, o) {
    f.anim = 'flying'; f.animT = 0;
    sfx.whoosh();
    this.later(260, () => {
      o.anim = 'hurt'; o.animT = 0;
      this.impactFx(o.idx, true);
      sfx.bigHit();
    });
  }

  doShockwave(f, o) {
    f.anim = 'slam'; f.animT = 0;
    this.later(400, () => {
      const pos = f.root.position.clone();
      pos.y = 0.04;
      this.spawnRing(pos, f.def.accent);
      this.particles.burst(pos, 24, { color: 0xcabb99, speed: 2.6, life: 0.7, size: 0.09, gravity: 4, rise: 1.5 });
      this.shake = Math.max(this.shake, 0.14);
      sfx.slam();
      o.anim = 'hurt'; o.animT = 0;
      this.later(90, () => this.impactFx(o.idx, false));
    });
  }

  spawnRing(pos, color) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.5, 26),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    this.scene.add(m);
    this.rings.push({ m, t: 0 });
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
    if (hurt) this.flash = Math.max(this.flash, 0.22);
  }

  knockdown(loserIdx) {
    const l = this.fighters[loserIdx];
    l.anim = 'down'; l.animT = 0;
    this.shake = 0.22; this.flash = 0.9;
    this.slowmo = 0.22; this.camPunchTarget = 1;
    this.later(1500, () => { this.slowmo = 1; });
    this.particles.burst(l.headWorld(), 30, { color: 0xffdf80, speed: 4.5, life: 0.9, size: 0.1, gravity: 6 });
    this.spawnRing(new THREE.Vector3(l.root.position.x, 0.04, l.root.position.z), 0xffd75e);
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
    // projectiles
    for (const p of this.projectiles) {
      p.t += sdt;
      const k = clamp(p.t / p.dur, 0, 1);
      const to = p.victim.chest.getWorldPosition(new THREE.Vector3());
      p.mesh.position.lerpVectors(p.from, to, k);
      p.mesh.position.y += Math.sin(k * Math.PI) * 0.25;
      p.light.position.copy(p.mesh.position);
      p.mesh.scale.setScalar(1 + Math.sin(this.time * 22) * 0.18);
      if (rand() < 0.7) this.particles.burst(p.mesh.position, 1, { color: p.color, speed: 0.5, life: 0.35, size: 0.06, gravity: 0 });
      if (k >= 1) {
        this.particles.burst(p.mesh.position, 18, { color: p.color, speed: 3, life: 0.55, size: 0.09, gravity: 2 });
        p.victim.anim = 'hurt'; p.victim.animT = 0;
        this.impactFx(p.victim.idx, true);
        sfx.bigHit();
        this.removeProjectile(p);
        p.dead = true;
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.dead);
    // shockwave rings
    for (const r of this.rings) {
      r.t += sdt;
      const k = r.t / 0.6;
      r.m.scale.setScalar(1 + k * 9);
      r.m.material.opacity = Math.max(0, 0.85 * (1 - k));
      if (k >= 1) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); r.dead = true; }
    }
    this.rings = this.rings.filter(r => !r.dead);

    if (this.stageObj && this.stageObj.tick) this.stageObj.tick(sdt, this.time);
    this.particles.update(sdt);
    this.shake = Math.max(0, this.shake - dt * 0.55);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.redFlash = Math.max(0, this.redFlash - dt * 0.5);
    this.camPunch = lerp(this.camPunch, this.camPunchTarget || 0, Math.min(1, dt * 2.2));
    if (this.camPunchTarget && this.slowmo === 1) this.camPunchTarget = Math.max(0.35, this.camPunchTarget - dt * 0.3);
  }

  updateMovement(dt, a, b) {
    for (const f of [a, b]) {
      if (['down', 'win', 'launched'].includes(f.anim)) continue;
      const opp = f === a ? b : a;
      const dir = Math.sign(opp.x - f.x) || (f.idx === 0 ? 1 : -1);
      const dist = Math.abs(opp.x - f.x);
      const want = 0.36 + Math.sin(f.phase * 0.35 + f.idx * 3) * 0.09;
      let vx = 0;
      const busy = ['strike', 'hit', 'hurt', 'block', 'cast', 'flying', 'slam'].includes(f.anim);
      if (!busy) {
        if (dist > want + 0.03) vx = dir * 0.34;
        else if (dist < want - 0.03) vx = -dir * 0.26;
        f.x = clamp(f.x + vx * dt, -0.95, 0.95);
        f.z = clamp(f.z + Math.sin(f.phase * 0.23 + f.idx * 5) * 0.05 * dt, -0.45, 0.5);
      }
      f.facing = dir;
      if (busy) {
        if (f.animT > (DUR[f.anim] || 0.4)) { f.anim = 'idle'; f.animT = 0; }
      } else {
        f.anim = Math.abs(vx) > 0.05 ? 'walk' : 'idle';
      }
    }
  }

  draw() {
    const t = this.time;
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
// Fighter rig: ninja-garbed low-poly humanoid, procedural pose targets.
// ---------------------------------------------------------------------------

class Fighter {
  constructor(def, idx) {
    this.def = def;
    this.idx = idx;
    this.x = idx === 0 ? -0.45 : 0.45;
    this.z = 0;
    this.facing = idx === 0 ? 1 : -1;
    this.anim = 'idle';
    this.animT = 0;
    this.phase = rand() * 10;
    this.strikeType = 'punch';
    this.dissolve = 0;
    this.lunge = 0;
    this.smYaw = 0;
    this.yawOffset = 0;

    this.buildRig();
    this.targets = {};
    this.rate = 14;
  }

  buildRig() {
    const d = this.def;
    const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({
      color, roughness: 0.62, metalness: 0.04, flatShading: true, transparent: true, ...opts,
    });
    this.mats = [];
    const M = (c, o) => { const m = mat(c, o); this.mats.push(m); return m; };
    const skin = M(d.skin), gi = M(d.trunks), giD = M(shade(d.trunks, -24)),
      wrap = M(d.accent, { roughness: 0.5 }), hair = M(d.hair, { roughness: 0.8 }),
      dark = M('#16161e');

    const grp = () => new THREE.Group();
    const mesh = (geo, m, x, y, z) => {
      const me = new THREE.Mesh(geo, m);
      me.position.set(x, y, z);
      me.castShadow = true;
      return me;
    };

    this.root = grp();
    this.hipsBaseY = 0.87;
    this.hips = grp(); this.hips.position.y = this.hipsBaseY;
    this.root.add(this.hips);

    // pants top + sash belt
    this.hips.add(mesh(new THREE.CylinderGeometry(0.20, 0.23, 0.3, 6), gi, 0, 0.02, 0));
    this.hips.add(mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.09, 6), wrap, 0, 0.14, 0));
    // sash tail
    this.hips.add(mesh(new THREE.BoxGeometry(0.1, 0.3, 0.03), wrap, 0.12, -0.05, -0.19));

    // gi vest torso
    this.spine = grp(); this.spine.position.y = 0.14; this.hips.add(this.spine);
    this.spine.add(mesh(new THREE.CylinderGeometry(0.185, 0.165, 0.24, 6), gi, 0, 0.1, 0));
    this.chest = grp(); this.chest.position.y = 0.24; this.spine.add(this.chest);
    this.chest.add(mesh(new THREE.CylinderGeometry(0.26, 0.18, 0.4, 6), gi, 0, 0.16, 0));
    // crossed collar detail
    this.chest.add(mesh(new THREE.BoxGeometry(0.3, 0.07, 0.04), giD, 0, 0.3, 0.17));

    // head: skin + mask + headband with tails
    this.neck = grp(); this.neck.position.y = 0.38; this.chest.add(this.neck);
    this.neck.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 6), skin, 0, 0.03, 0));
    this.neck.add(mesh(new THREE.IcosahedronGeometry(0.145, 1), skin, 0, 0.17, 0.01));
    const hairMesh = mesh(new THREE.IcosahedronGeometry(0.15, 1), hair, 0, 0.21, -0.04);
    hairMesh.scale.set(1.02, 0.75, 1.02);
    this.neck.add(hairMesh);
    // mask over the lower face
    const mask = mesh(new THREE.CylinderGeometry(0.135, 0.12, 0.1, 8), gi, 0, 0.115, 0.025);
    mask.scale.z = 1.06;
    this.neck.add(mask);
    // headband + tails
    this.neck.add(mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.045, 8), wrap, 0, 0.215, 0));
    this.neck.add(mesh(new THREE.BoxGeometry(0.045, 0.24, 0.02), wrap, 0.05, 0.09, -0.15));
    this.neck.add(mesh(new THREE.BoxGeometry(0.045, 0.18, 0.02), wrap, -0.03, 0.11, -0.16));
    // eyes
    for (const ex of [-0.055, 0.055]) {
      this.neck.add(mesh(new THREE.SphereGeometry(0.018, 6, 4), M('#0c0c12'), ex, 0.185, 0.135));
    }

    // arms: bare shoulders, wrapped forearms, small fists
    this.arms = {};
    for (const side of [-1, 1]) {
      const sh = grp(); sh.position.set(side * 0.28, 0.30, 0); this.chest.add(sh);
      sh.add(mesh(new THREE.SphereGeometry(0.09, 6, 5), gi, 0, 0, 0));
      sh.add(mesh(new THREE.CapsuleGeometry(0.072, 0.24, 2, 6), skin, 0, -0.16, 0));
      const el = grp(); el.position.y = -0.32; sh.add(el);
      el.add(mesh(new THREE.CapsuleGeometry(0.062, 0.2, 2, 6), wrap, 0, -0.13, 0));
      el.add(mesh(new THREE.IcosahedronGeometry(0.075, 1), skin, 0, -0.29, 0.01));
      this.arms[side] = { sh, el };
    }

    // legs: gi pants, wrapped shins, tabi feet
    this.legs = {};
    for (const side of [-1, 1]) {
      const th = grp(); th.position.set(side * 0.13, -0.06, 0); this.hips.add(th);
      th.add(mesh(new THREE.CapsuleGeometry(0.1, 0.3, 2, 6), gi, 0, -0.18, 0));
      const kn = grp(); kn.position.y = -0.42; th.add(kn);
      kn.add(mesh(new THREE.CapsuleGeometry(0.078, 0.28, 2, 6), wrap, 0, -0.17, 0));
      kn.add(mesh(new THREE.BoxGeometry(0.12, 0.09, 0.26), dark, 0, -0.4, 0.05));
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
    this.strikeSide = this.strikeSide === 1 ? -1 : 1;
  }

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

    const dir = this.facing;
    this.root.position.set(this.x * RING_X + this.lunge * dir, this.rootY || 0, this.z * RING_Z);
    const yaw = dir * Math.PI / 2 - dir * 0.22;
    this.smYaw += (yaw - this.smYaw) * Math.min(1, dt * 10);
    this.root.rotation.y = this.smYaw + this.yawOffset;
  }

  computePose() {
    const t = this.animT, ph = this.phase;
    this.rate = 14;
    this.rootY = 0;
    this.yawOffset = 0;
    this.lunge = Math.max(0, this.lunge - 0.04);

    // base: open martial-arts stance, hands ready
    const bob = Math.sin(ph) * 0.02;
    this.setT('hipsPos', 0, bob - 0.03, 0);
    this.setT('hips', 0, 0, 0);
    this.setT('spine', 0.06, 0, 0);
    this.setT('chest', 0.05, 0, 0);
    this.setT('neck', -0.06, 0, 0);
    this.setT('shL', -0.75, 0.4, -0.5);
    this.setT('elL', -1.05, 0, 0);
    this.setT('shR', -0.55, -0.45, 0.5);
    this.setT('elR', -0.85, 0, 0);
    this.setT('thL', -0.14, 0, 0.1);
    this.setT('knL', 0.2, 0, 0);
    this.setT('thR', 0.1, 0, -0.1);
    this.setT('knR', 0.16, 0, 0);

    switch (this.anim) {
      case 'idle': {
        const s = Math.sin(ph * 1.3) * 0.07;
        this.setT('shL', -0.75 + s, 0.4, -0.5);
        this.setT('shR', -0.55 - s, -0.45, 0.5);
        this.setT('chest', 0.05, Math.sin(ph * 0.6) * 0.06, 0);
        break;
      }
      case 'walk': {
        const sw = Math.sin(ph);
        this.setT('thL', -0.14 + sw * 0.5, 0, 0.1);
        this.setT('knL', 0.3 + Math.max(0, -sw) * 0.5, 0, 0);
        this.setT('thR', 0.1 - sw * 0.5, 0, -0.1);
        this.setT('knR', 0.3 + Math.max(0, sw) * 0.5, 0, 0);
        this.setT('hipsPos', 0, Math.abs(Math.cos(ph)) * 0.04 - 0.03, 0);
        break;
      }
      case 'strike': this.poseStrike(t); break;
      case 'cast': {
        // gather energy then thrust both palms forward
        const k = clamp(t / DUR.cast, 0, 1);
        const push = k < 0.35 ? 0 : Math.sin(clamp((k - 0.35) / 0.5, 0, 1) * Math.PI);
        const gather = k < 0.35 ? Math.sin((k / 0.35) * Math.PI * 0.5) : 1 - push;
        this.rate = 22;
        this.setT('shL', -0.5 - gather * 0.4 - push * 1.05, 0.4 - push * 0.35, -0.5 + push * 0.4);
        this.setT('shR', -0.4 - gather * 0.4 - push * 1.1, -0.45 + push * 0.4, 0.5 - push * 0.4);
        this.setT('elL', -1.6 + push * 1.45, 0, 0);
        this.setT('elR', -1.5 + push * 1.4, 0, 0);
        this.setT('chest', 0.18 - push * 0.25, 0, 0);
        this.setT('hipsPos', 0, -0.08, 0);
        break;
      }
      case 'flying': {
        // leaping side kick with trailing leg tucked
        const k = clamp(t / DUR.flying, 0, 1);
        const arc = Math.sin(k * Math.PI);
        this.rate = 24;
        this.rootY = arc * 0.55;
        this.lunge = arc * 0.85;
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
        // leap up and smash the ground
        const k = clamp(t / DUR.slam, 0, 1);
        this.rate = 22;
        if (k < 0.5) {
          const up = Math.sin((k / 0.5) * Math.PI * 0.5);
          this.rootY = up * 0.75;
          this.setT('shL', -2.5 * up - 0.5, 0.3, -0.2);
          this.setT('shR', -2.4 * up - 0.4, -0.3, 0.2);
          this.setT('elL', -0.5, 0, 0); this.setT('elR', -0.5, 0, 0);
          this.setT('knL', 0.9 * up + 0.2, 0, 0); this.setT('knR', 0.9 * up + 0.2, 0, 0);
        } else {
          const dn = Math.min(1, (k - 0.5) / 0.18);
          this.rootY = (1 - dn) * 0.75;
          this.setT('hipsPos', 0, -0.28 * dn, 0);
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
        this.setT('hipsPos', 0, -0.08, 0);
        break;
      }
      case 'down': {
        const p = easeOutBack(clamp(t / DUR.down, 0, 1));
        this.rate = 10;
        // uppercut pop before the fall
        if (t < 0.32) this.rootY = Math.sin((t / 0.32) * Math.PI) * 0.5;
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
    const k = Math.sin(clamp(t / DUR.strike, 0, 1) * Math.PI);
    const sharp = Math.pow(k, 1.5);
    const S = this.strikeSide || 1;
    const lead = S === 1 ? 'L' : 'R', rear = S === 1 ? 'R' : 'L';
    const sgn = S;
    this.rate = 26;
    this.lunge = sharp * 0.28;

    switch (this.strikeType) {
      case 'punch':
        this.setT('sh' + lead, -0.75 - sharp * 0.85, sgn * (0.4 - sharp * 0.4), -sgn * 0.4 * (1 - sharp));
        this.setT('el' + lead, -1.05 + sharp * 0.95, 0, 0);
        this.setT('chest', 0.05, -sgn * sharp * 0.45, 0);
        break;
      case 'palm':
        this.setT('sh' + rear, -0.55 - sharp * 1.0, -sgn * (0.45 - sharp * 0.5), sgn * 0.4 * (1 - sharp));
        this.setT('el' + rear, -0.85 + sharp * 0.8, 0, 0);
        this.setT('chest', 0.08, sgn * sharp * 0.8, 0);
        this.setT('hips', 0, sgn * sharp * 0.4, 0);
        break;
      case 'backfist':
        this.setT('sh' + lead, -1.35 * sharp - 0.4, sgn * (0.4 - sharp * 1.3), 0);
        this.setT('el' + lead, -1.3 + sharp * 0.9, 0, 0);
        this.setT('chest', 0.05, -sgn * sharp * 1.0, 0);
        this.setT('hips', 0, -sgn * sharp * 0.5, 0);
        break;
      case 'elbow':
        this.setT('sh' + lead, -1.25 * sharp - 0.5, sgn * (0.4 - sharp * 0.9), 0);
        this.setT('el' + lead, -2.3, 0, 0);
        this.setT('chest', 0.1, -sgn * sharp * 0.8, 0);
        this.lunge = sharp * 0.34;
        break;
      case 'uppercut':
        this.setT('sh' + rear, -0.2 - sharp * 1.35, 0, sgn * 0.2);
        this.setT('el' + rear, -2.3 + sharp * 0.6, 0, 0);
        this.setT('chest', 0.35 - sharp * 0.6, sgn * sharp * 0.5, 0);
        this.setT('hipsPos', 0, -0.14 * (1 - sharp) - 0.03, 0);
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
        this.lunge = sharp * 0.2;
        break;
      }
      case 'sweep': {
        const leg = lead, lsgn = leg === 'L' ? 1 : -1;
        this.yawOffset = -this.facing * Math.PI * 0.9 * Math.sin(clamp(t / DUR.strike, 0, 1) * Math.PI);
        this.setT('hipsPos', 0, -0.34 * k, 0);
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

// ---------------------------------------------------------------------------
// Particles: pooled THREE.Points.
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
      this.col[i * 3] *= 0.98; this.col[i * 3 + 1] *= 0.98; this.col[i * 3 + 2] *= 0.98;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -50;
    }
    if (any) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
  }
}

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d');
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

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return (r << 16) | (g << 8) | b;
}
