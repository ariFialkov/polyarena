// 3D fight renderer (Three.js). Mortal-Kombat presentation: wide themed
// stages (js/stages.js), a dynamic camera director (js/camera.js), fast and
// expansive fighter movement (dashes, backdashes, jumps, knockback, zoning),
// imported rigged models (js/models.js) and special-move VFX.
//
// Choreography (js/sim.js) decides WHAT happens and WHEN; this file decides
// WHERE: main.js streams upcoming attacks via anticipate(), and the movement
// director closes the distance just in time for each scripted hit.

import * as THREE from '../vendor/three.module.min.js';
import { clamp, rand, randRange, pick } from './util.js';
import { buildStage, skyTexture } from './stages.js';
import { Fighter, BUSY, FROZEN } from './fighter.js';
import { instantiateModel } from './models.js';
import { CameraDirector } from './camera.js';
import { clipMeta } from './anim.js';
import { chooseMove } from './styles.js';
import { sfx } from './audio.js';

export const SPECIALS = ['fireball', 'teleport', 'flyingkick', 'shockwave'];
const MELEE = 0.92;     // root-to-root distance for landed hand/foot strikes
const MIN_SEP = 0.6;
const KB_DECAY = 5.5;
const BODY_R = 0.2;     // strike target depth in front of the victim's root
// specials connect this long after their scripted moment (main.js applies
// their damage then): fireballs release on time and fly, kicks/slams land late
const SPECIAL_DELAY = { fireball: 0, flyingkick: 0.3, shockwave: 0.33 };
const SPECIAL_STATE = { fireball: 'cast', flyingkick: 'flying', shockwave: 'slam' };
const HEAVY = new Set(['backfist', 'roundhouse', 'spinkick', 'palm', 'elbow']);

// impulse that travels `dist` in roughly `T` seconds under KB_DECAY
const impulseFor = (dist, T) => dist * KB_DECAY / (1 - Math.exp(-KB_DECAY * T));

export class Arena {
  constructor(canvas) {
    this.cv = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x10141f, 14, 34);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    this.director = new CameraDirector(this.camera);

    this.fighters = [null, null];
    this.slowmo = 1;
    this.hitstop = 0;
    this.time = 0;
    this.projectiles = [];
    this.rings = [];
    this.timers = [];
    this.antic = null;
    this.mode = 'lobby';
    this.matchToken = 0;

    // lights (tinted per stage); the key spot follows the action
    this.hemi = new THREE.HemisphereLight(0x8890c8, 0x14101e, 0.5);
    this.key = new THREE.SpotLight(0xfff2dd, 230, 40, 0.62, 0.5, 1.5);
    this.key.position.set(0, 10, 7);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0015;
    this.rim = new THREE.DirectionalLight(0x8090ff, 0.6);
    this.rim.position.set(0, 4, -6);
    this.scene.add(this.hemi, this.key, this.key.target, this.rim);

    this.sky = new THREE.Mesh(
      new THREE.CylinderGeometry(42, 42, 40, 32, 1, true),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false })
    );
    this.sky.position.y = 10;
    this.abyss = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: 0x05060c }));
    this.abyss.rotation.x = -Math.PI / 2;
    this.abyss.position.y = -3;
    this.scene.add(this.sky, this.abyss);

    this.flashEl = document.createElement('div');
    this.flashEl.className = 'fx-flash';
    canvas.parentElement.appendChild(this.flashEl);
    this.flash = 0; this.redFlash = 0;

    this.particles = new ParticlePool(this.scene, 700);
    this.resize();
  }

  get aspect() { return (this.W || 1) / (this.H || 1); }
  get portrait() { return this.aspect < 0.9; }
  // how far apart fighters may roam (the camera must still frame them)
  get bound() { return this.portrait ? 3.1 : 6.6; }
  get maxSep() { return this.portrait ? 3.6 : 9.5; }

  resize() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
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
    this.fogBase = [stage.fog[1], stage.fog[2]];
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
    this.fighters[0].x = -3; this.fighters[1].x = 3;
    this.fighters[0].opp = this.fighters[1]; this.fighters[1].opp = this.fighters[0];
    this.plan = null;
    this.clock = 0;
    this.lastHitAt = -9;
    for (const f of this.fighters) { this.scene.add(f.root); f.play('warmup'); }
    this.flash = 0; this.redFlash = 0; this.slowmo = 1; this.hitstop = 0;
    this.antic = null;
    const token = ++this.matchToken;
    for (const f of this.fighters) {
      if (!f.def.model) continue;
      instantiateModel(f.def.model).then(m => {
        if (token === this.matchToken) f.attachModel(m);
      }).catch(err => console.warn('model load failed', f.def.model, err));
    }
  }

  fighter(i) { return this.fighters[i]; }

  later(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

  setMode(mode) {
    this.mode = mode;
    const [a, b] = this.fighters;
    if (mode === 'lobby' && a && b) {
      a.x = -3; b.x = 3;
      for (const f of this.fighters) { f.faceCam = true; f.camYaw = f.idx === 0 ? 0.45 : -0.45; f.play('warmup'); f.baseAnim = 'warmup'; }
      this.director.setMode('lobby', { restart: true });
    }
    if (mode === 'break') {
      for (const f of this.fighters) if (!FROZEN.has(f.anim)) f.play('idle');
      this.director.setMode('wide', { restart: true });
    }
    if (mode === 'intro' && a && b) {
      a.x = -this.bound - 2.5; b.x = this.bound + 2.5;
      a.faceCam = b.faceCam = false;
      a.play('idle'); b.play('idle');
      this.director.setMode('intro', { restart: true });
    }
    if (mode === 'fight') {
      for (const f of this.fighters) { f.faceCam = false; f.intentT = 0; }
      this.director.setMode('fight');
    }
  }

  cam(mode, opts) { this.director.setMode(mode, opts); }

  // Upcoming scripted attack (from main.js each frame): who, how soon (real
  // seconds), and what. Lets the movement director set up the exchange.
  //
  // With motion clips, the attack is PLANNED as soon as its event is next:
  // the fighter's style kit picks a clip that fits the time left, the
  // spacing is set from the clip's reach and travel, and the clip launches
  // early (its wind-up plays before the scripted moment) with its speed
  // re-tuned every frame so the impact frame lands exactly on the event.
  anticipate(by, inSec, strike, ev) {
    if (by == null) { this.antic = null; return; }
    let kind = 'melee';
    if (strike === 'fireball') kind = 'ranged';
    else if (strike === 'teleport') kind = 'teleport';
    else if (strike === 'flyingkick') kind = 'flying';
    else if (strike === 'shockwave') kind = 'slam';
    this.antic = { by, inSec, kind };
    const f = this.fighters[by], o = this.fighters[1 - by];
    if (!ev || !f || !o || !f.rig || this.mode !== 'fight') return;
    let p = this.plan;
    if (!p || p.ev !== ev) p = this.plan = this.makePlan(f, o, ev, inSec);
    if (!p) return;
    if (p.range) this.antic.range = p.range;
    const tImp = inSec + p.delay;
    if (!p.launched) {
      if (tImp <= p.impact + 1e-3 && !FROZEN.has(f.anim)) this.launch(p, f, o, tImp);
    } else if (f.plan === p && f.rig.cur && f.rig.id === p.clip && f.anim !== 'hit' && f.anim !== 'hurt') {
      const rem = p.impact - f.rig.time;
      if (rem > 0.01 && tImp > 0.01) f.rig.timeScale = clamp(rem / tImp, 0.5, 3);
    }
    // the defender gets the guard up just before a blocked strike lands
    if (ev.type === 'miss' && p.launched && !p.guarded && tImp < 0.2 && o.rig && !FROZEN.has(o.anim)) {
      p.guarded = true;
      o.guard();
    }
  }

  makePlan(f, o, ev, inSec) {
    const special = ev.type === 'strike' && SPECIALS.includes(ev.strike);
    if (special && ev.strike === 'teleport') return null;
    let clip, impact, delay = 0;
    if (special) {
      clip = f.kit.special.clip;
      impact = f.kit.special.impact || clipMeta(clip).impact;
      delay = SPECIAL_DELAY[ev.strike];
    } else {
      // an opener has room to lunge or leap in; mid-combo hits stay compact
      const opener = this.clock - this.lastHitAt + inSec > 1.1;
      const type = ev.type === 'ko' ? 'uppercut' : ev.strike;
      clip = chooseMove(f.kit, type, { window: inSec, opener: opener || ev.type === 'ko', heavy: ev.type === 'hurt', recent: f.recent });
      impact = clipMeta(clip).impact;
    }
    const m = clipMeta(clip);
    if (!m) return null;
    f.recent = [clip, ...f.recent].slice(0, 3);
    const k = f.k;
    const reach = Math.max(30, m.reach || 50) * k + BODY_R;
    const travel = Math.max(0, m.travel || 0) * k;
    const range = ev.strike === 'fireball' || ev.strike === 'shockwave' ? 0
      : clamp(reach + (travel > 0.12 ? travel : 0), MIN_SEP + 0.05, 4.2);
    return { ev, clip, impact, delay, reach, travel, range, special, kind: ev.strike, launched: false };
  }

  launch(p, f, o, tImp) {
    const ts = clamp(p.impact / Math.max(tImp, 0.01), 0.75, 2.6);
    const start = Math.max(0, p.impact - tImp * ts);
    const dist = Math.abs(o.x - f.x);
    const planted = p.kind === 'fireball' || p.kind === 'shockwave';
    const rm = p.travel > 0.12 && !planted ? clamp((dist - p.reach) / p.travel, 0, 1.3) : 0;
    const m = clipMeta(p.clip);
    const state = p.special ? SPECIAL_STATE[p.kind] : 'strike';
    const len = Math.min((m.dur - start) / ts, (p.impact - start) / ts + 0.5);
    f.act(p.clip, { state, ts, start, rm, fade: 0.1, len });
    f.plan = p;
    p.launched = true;
    p.rm = rm;
    p.start = start;
    // grappling KO: the victim is taken down with the attacker
    if (p.ev.type === 'ko' && p.clip === 'takedown' && o.rig) {
      o.act('ko_takedown', { state: 'down', ts, start, rm: 1, fade: 0.1, len: Infinity });
    }
  }

  // Unplanned clip attack (late event / plan skipped): start the clip just
  // before its impact so the hit still reads. Returns seconds to impact.
  launchNow(f, o, clip, lead, state = 'strike', impact) {
    const m = clipMeta(clip);
    impact = impact || m.impact;
    const start = Math.max(0, impact - lead);
    const dist = Math.abs(o.x - f.x);
    const reach = Math.max(30, m.reach || 50) * f.k + BODY_R;
    const travel = Math.max(0, m.travel || 0) * f.k;
    const rm = travel > 0.12 ? clamp((dist - reach) / travel, 0, 1.3) : 0;
    f.act(clip, { state, start, rm, fade: 0.06, len: impact - start + 0.45 });
    return impact - start;
  }

  // Land a clip strike on the victim: reaction by height and weight.
  reactTo(o, m, { hurt = false, heavy = false, ko = false } = {}) {
    if (!o.rig) { o.play(hurt ? 'hurt' : 'hit'); return; }
    if (o.anim === 'down' || (o.rig.meta && o.rig.meta.cat === 'ko')) return;
    if (ko) { o.fall(m && m.height < 50 ? 'ko_back' : null); return; }
    const zone = m && m.height < 125 ? 'body' : 'head';
    o.react(hurt ? 2 : heavy ? 1 : 0, zone);
  }

  // ------------------------------ actions ------------------------------

  strike(by, type, landed, hurt = false, ev = null) {
    const f = this.fighters[by], o = this.fighters[1 - by];
    if (!f || !o) return;
    const p = ev && this.plan && this.plan.ev === ev && this.plan.launched && f.plan === this.plan
      && f.rig && f.rig.id === this.plan.clip ? this.plan : null;
    this.lastHitAt = this.clock;
    if (f.rig) return this.clipStrike(f, o, type, landed, hurt, ev, p);

    switch (type) {
      case 'fireball': return this.doFireball(f, o);
      case 'teleport': return this.doTeleport(f, o);
      case 'flyingkick': return this.doFlyingKick(f, o);
      case 'shockwave': return this.doShockwave(f, o);
    }

    // late? close the gap with a burst so the hit visibly connects
    const dist = Math.abs(o.x - f.x), dir = Math.sign(o.x - f.x) || 1;
    if (dist > MELEE + 0.45) f.kb += dir * impulseFor(dist - MELEE, 0.12);

    f.startStrike(type);
    if (landed) {
      o.play(hurt ? 'hurt' : 'hit');
      o.animT = -0.12;
      this.later(110, () => this.impactFx(1 - by, hurt));
    } else if (rand() < 0.6) {
      o.play('block');
      this.later(110, () => {
        this.particles.burst(o.chestWorld(), 5, { color: 0x9fd8ff, speed: 1.5, life: 0.25, gravity: 2 });
        o.kb += -dir * 1.6;
      });
    }
  }

  clipStrike(f, o, type, landed, hurt, ev, p) {
    switch (type) {
      case 'fireball': return this.doFireball(f, o, p);
      case 'teleport': return this.doTeleport(f, o);
      case 'flyingkick': return this.doFlyingKick(f, o, p);
      case 'shockwave': return this.doShockwave(f, o, p);
    }
    const dist = Math.abs(o.x - f.x), dir = Math.sign(o.x - f.x) || 1;
    let lead = 0, clip;
    if (p) {
      clip = p.clip;
      f.rig.timeScale = 1;
      lead = Math.max(0, p.impact - f.rig.time);
      if (lead > 0.06) lead = 0.06;            // close enough: land it now
    } else {
      const ko = ev && ev.type === 'ko';
      clip = chooseMove(f.kit, ko ? 'uppercut' : type, { window: 0.12, opener: ko, heavy: hurt, recent: f.recent });
      f.recent = [clip, ...f.recent].slice(0, 3);
      lead = this.launchNow(f, o, clip, 0.12);
    }
    const m = clipMeta(clip);
    // no root travel and out of reach? close the gap so the hit connects
    const reach = Math.max(30, m.reach || 50) * f.k + BODY_R;
    if (landed && dist > reach + 0.35 && !(p && p.rm > 0)) f.kb += dir * impulseFor(dist - reach, Math.max(0.08, lead));
    const hit = () => {
      if (landed) {
        this.reactTo(o, m, { hurt, heavy: HEAVY.has(type), ko: ev && ev.type === 'ko' });
        this.impactFx(o.idx, hurt);
      } else {
        if (!(p && p.guarded) && !FROZEN.has(o.anim)) o.guard();
        this.particles.burst(o.chestWorld(), 5, { color: 0x9fd8ff, speed: 1.5, life: 0.25, gravity: 2 });
        o.kb += -dir * 1.6;
      }
    };
    if (lead > 0.02) this.later(lead * 1000, hit); else hit();
  }

  // ---- specials ----

  doFireball(f, o, p) {
    let release = 180, flight = null;
    if (f.rig) {
      const sp = f.kit.special;
      if (p) release = 0;
      else release = this.launchNow(f, o, sp.clip, 0.15, 'cast', sp.impact) * 1000;
      flight = 0.45;
    } else f.play('cast');
    sfx.fireball();
    const color = new THREE.Color(f.def.accent);
    this.director.kick({ orbit: -f.facing * 0.08 });
    this.later(release, () => {
      const sp = f.kit.special, m = f.rig && clipMeta(sp.clip);
      const from = f.rig ? f.limbWorld(sp.from === 'head' ? 'HEAD' : m.limb || 'RH') : f.handWorld(f.facing > 0 ? 1 : -1);
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.2, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })
      );
      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.36, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      core.add(shell);
      const light = new THREE.PointLight(color, 18, 7, 1.8);
      core.position.copy(from);
      this.scene.add(core, light);
      const dist = Math.abs(o.x - f.x);
      this.projectiles.push({ mesh: core, light, from, victim: o, caster: f, t: 0, dur: flight || clamp(dist / 10, 0.18, 0.6), color: color.getHex() });
    });
  }

  removeProjectile(p) {
    this.scene.remove(p.mesh, p.light);
    p.mesh.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });
  }

  doTeleport(f, o) {
    this.particles.burst(f.chestWorld(), 30, { color: f.def.accent, speed: 2.4, life: 0.5, gravity: -1 });
    f.root.visible = false;
    sfx.teleport();
    this.later(200, () => {
      let side = Math.sign(o.x - f.x) || 1;            // go past the opponent
      if (Math.abs(o.x + side * 0.9) > this.bound) side = -side;
      f.x = o.x + side * 0.9;
      f.kb = 0; f.vx = 0;
      f.facing = -side;
      f.smYaw = f.facing * Math.PI / 2;
      f.root.visible = true;
      this.director.setMode('fight', { snap: 0.35 });
      this.director.kick({ fov: -2, roll: f.facing * 0.04 });
      this.particles.burst(new THREE.Vector3(f.x, 1.1, f.z), 30, { color: f.def.accent, speed: 2.4, life: 0.5, gravity: -1 });
      if (f.rig) {
        const clip = f.kit.special.clip;
        const lead = this.launchNow(f, o, clip, 0.13, 'strike', f.kit.special.impact);
        this.later(lead * 1000, () => { this.reactTo(o, clipMeta(clip), { hurt: true }); this.impactFx(o.idx, true); sfx.bigHit(); });
        return;
      }
      f.startStrike('backfist');
      this.later(110, () => { this.impactFx(o.idx, true); sfx.bigHit(); });
    });
  }

  doFlyingKick(f, o, p) {
    const dist = Math.abs(o.x - f.x), dir = Math.sign(o.x - f.x) || 1;
    if (f.rig) {
      const sp = f.kit.special;
      const lead = p ? Math.max(0, p.impact - f.rig.time) / Math.max(0.5, f.rig.cur.timeScale)
        : this.launchNow(f, o, sp.clip, 0.3, 'flying', sp.impact);
      sfx.whoosh();
      this.director.kick({ fov: 2.5 });
      this.later(lead * 1000, () => {
        this.reactTo(o, clipMeta(sp.clip), { hurt: true });
        this.impactFx(o.idx, true); sfx.bigHit();
      });
      return;
    }
    f.play('flying');
    f.kb += dir * impulseFor(Math.max(0, dist - MELEE * 0.8), 0.25);
    sfx.whoosh();
    this.director.kick({ fov: 2.5 });
    this.later(240, () => { this.impactFx(o.idx, true); sfx.bigHit(); });
  }

  doShockwave(f, o, p) {
    let slamAt = 360;
    if (f.rig) {
      const sp = f.kit.special;
      slamAt = 1000 * (p ? Math.max(0, p.impact - f.rig.time) / Math.max(0.5, f.rig.cur.timeScale)
        : this.launchNow(f, o, sp.clip, 0.33, 'slam', sp.impact));
    } else f.play('slam');
    this.later(slamAt, () => {
      const pos = new THREE.Vector3(f.x, 0.04, f.z);
      this.spawnRing(pos, f.def.accent);
      this.particles.burst(pos, 30, { color: 0xcabb99, speed: 3, life: 0.7, gravity: 4, rise: 1.6 });
      this.director.kick({ shake: 0.16, fov: 3 });
      sfx.slam();
      this.later(90, () => {
        this.impactFx(o.idx, false);
        o.play('hurt');
        o.vy = 4.5;
        o.kb += Math.sign(o.x - f.x) * 6;
      });
    });
  }

  spawnRing(pos, color) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.5, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    this.scene.add(m);
    this.rings.push({ m, t: 0 });
  }

  impactFx(victimIdx, hurt) {
    const v = this.fighters[victimIdx], a = this.fighters[1 - victimIdx];
    if (!v || !a) return;
    const p = v.headWorld();
    p.y -= 0.15;
    this.particles.burst(p, hurt ? 20 : 9, {
      color: hurt ? 0xff5a3c : 0xffd75e, speed: hurt ? 3.6 : 2,
      life: 0.5, gravity: 5,
    });
    const away = Math.sign(v.x - a.x) || 1;
    v.kb += away * (hurt ? 5.6 : 2.7);
    if (hurt && rand() < 0.35) v.vy = 3.2;
    this.hitstop = hurt ? 0.075 : 0.03;
    this.director.kick({
      fov: hurt ? -3.2 : -1.2,
      roll: (hurt ? 0.05 : 0.018) * (rand() < 0.5 ? -1 : 1),
      shake: hurt ? 0.09 : 0.03,
    });
    if (hurt) this.flash = Math.max(this.flash, 0.2);
  }

  knockdown(loserIdx) {
    const l = this.fighters[loserIdx];
    l.play('down');
    l.kb += Math.sign(l.x - this.fighters[1 - loserIdx].x) * (l.rig ? 1.2 : 5);
    this.flash = 0.9;
    this.slowmo = 0.22;
    this.later(1500, () => { this.slowmo = 1; });
    this.director.setMode('ko', { focus: loserIdx, restart: true });
    this.director.kick({ shake: 0.22, fov: -4, roll: 0.06 });
    this.particles.burst(l.headWorld(), 36, { color: 0xffdf80, speed: 4.8, life: 0.9, gravity: 6 });
    this.spawnRing(new THREE.Vector3(l.x, 0.04, l.z), 0xffd75e);
  }

  fatality(winnerIdx) {
    const w = this.fighters[winnerIdx], l = this.fighters[1 - winnerIdx];
    this.redFlash = 1;
    w.play('win'); w.faceCam = true; w.camYaw = -w.facing * 0.5;
    l.play('launched');
    this.director.setMode('fatality', { restart: true });
    const p = l.chestWorld();
    this.particles.burst(p, 70, { color: 0xff2840, speed: 4, life: 1.6, gravity: 2, rise: 2.5 });
    this.particles.burst(p, 45, { color: 0xffb060, speed: 2.5, life: 2.2, gravity: 0, rise: 3.5 });
  }

  celebrate(winnerIdx) {
    const w = this.fighters[winnerIdx];
    if (!w) return;
    w.play('win'); w.faceCam = true; w.camYaw = -w.facing * 0.35;
    this.director.setMode('focus', { focus: winnerIdx, restart: true });
  }

  // ------------------------------ frame update ------------------------------

  update(dt) {
    let sdt = dt * this.slowmo;
    if (this.hitstop > 0) { this.hitstop -= dt; sdt *= 0.04; }
    this.time += sdt;
    this.clock += dt;
    const [a, b] = this.fighters;
    if (a && b) {
      if (this.mode === 'fight') this.updateMovement(sdt);
      else if (this.mode === 'intro') this.updateIntro(sdt);
      else this.updatePhysics(sdt);
      a.update(sdt);
      b.update(sdt);
    }
    this.updateProjectiles(sdt);
    for (const r of this.rings) {
      r.t += sdt;
      const k = r.t / 0.6;
      r.m.scale.setScalar(1 + k * 11);
      r.m.material.opacity = Math.max(0, 0.85 * (1 - k));
      if (k >= 1) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); r.dead = true; }
    }
    this.rings = this.rings.filter(r => !r.dead);

    if (this.stageObj && this.stageObj.tick) this.stageObj.tick(sdt, this.time);
    this.particles.update(sdt);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.redFlash = Math.max(0, this.redFlash - dt * 0.5);
  }

  updateProjectiles(sdt) {
    for (const p of this.projectiles) {
      p.t += sdt;
      const k = clamp(p.t / p.dur, 0, 1);
      const to = p.victim.chestWorld();
      p.mesh.position.lerpVectors(p.from, to, k);
      p.mesh.position.y += Math.sin(k * Math.PI) * 0.2;
      p.light.position.copy(p.mesh.position);
      p.mesh.scale.setScalar(1 + Math.sin(this.time * 24) * 0.18);
      this.particles.burst(p.mesh.position, 2, { color: p.color, speed: 0.6, life: 0.35, gravity: 0 });
      if (k >= 1) {
        this.particles.burst(p.mesh.position, 24, { color: p.color, speed: 3.4, life: 0.55, gravity: 2 });
        p.victim.play('hurt');
        this.impactFx(p.victim.idx, true);
        sfx.bigHit();
        this.removeProjectile(p);
        p.dead = true;
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.dead);
  }

  // Shared integration: knockback impulses, gravity, landing, bounds.
  integrate(f, dt, desiredVx, accel) {
    const grounded = f.y <= 0 && f.vy <= 0;
    f.vx += (desiredVx - f.vx) * (1 - Math.exp(-(grounded ? accel : 1.2) * dt));
    f.x += (f.vx + f.kb) * dt;
    f.kb *= Math.exp(-KB_DECAY * dt);
    if (!grounded) {
      f.vy -= 22 * dt;
      f.y += f.vy * dt;
      if (f.y <= 0) {
        f.y = 0; f.vy = 0;
        if (!FROZEN.has(f.anim) && !BUSY.has(f.anim)) f.play('land');
        this.particles.burst(new THREE.Vector3(f.x, 0.05, f.z), 6, { color: 0xb8a888, speed: 1.2, life: 0.4, gravity: 3 });
      }
    }
    f.x = clamp(f.x, -this.bound - 3, this.bound + 3);
  }

  updatePhysics(dt) {
    for (const f of this.fighters) {
      this.integrate(f, dt, 0, 8);
      if (this.mode === 'lobby' && f.anim === 'idle') f.play('warmup');
    }
  }

  updateIntro(dt) {
    const marks = [-2.1, 2.1];
    this.fighters.forEach((f, i) => {
      f.kb = f.kb || 0;
      const dx = marks[i] - f.x;
      const v = Math.abs(dx) > 0.08 ? Math.sign(dx) * Math.min(4.2, Math.abs(dx) * 3) : 0;
      this.integrate(f, dt, v, 8);
      f.facing = i === 0 ? 1 : -1;
      if (!BUSY.has(f.anim) && f.anim !== 'taunt') f.anim = Math.abs(f.vx) > 0.4 ? 'walk' : 'idle';
    });
  }

  updateMovement(dt) {
    const [a, b] = this.fighters;
    for (const f of [a, b]) {
      const o = f === a ? b : a;
      f.kb = f.kb || 0;
      if (FROZEN.has(f.anim)) { this.integrate(f, dt, 0, 8); continue; }
      const dist = Math.abs(o.x - f.x), dir = Math.sign(o.x - f.x) || (f.idx === 0 ? 1 : -1);
      if (f.y <= 0) f.facing = dir;
      const spd = 0.8 + (f.def.speed || 70) / 200;  // 1.03 .. 1.29
      let desired = 0, accel = 10;
      const mine = this.antic && this.antic.by === f.idx ? this.antic : null;
      const P = this.plan && this.plan.launched ? this.plan : null;   // clip attack in flight
      const myP = P && P.ev.by === f.idx && f.plan === P && f.rig && f.rig.id === P.clip ? P : null;

      if (myP && f.rig.time < myP.impact) {
        // wind-up in progress: root motion carries the lunge; make up
        // whatever is still missing so the impact frame meets the target
        const frac = clamp((f.rig.time - myP.start) / Math.max(0.01, myP.impact - myP.start), 0, 1);
        const need = dist - myP.reach - myP.travel * myP.rm * (1 - frac);
        const tImp = mine ? Math.max(0.1, mine.inSec + myP.delay) : 0.3;
        desired = Math.abs(need) > 0.05 ? dir * clamp(need / tImp, -3, 10) : 0;
        accel = 20;
      } else if (P && P.ev.by !== f.idx && !FROZEN.has(f.anim) && mine == null) {
        desired = 0; // stand in for the incoming blow
      } else if (mine && mine.inSec < Math.max(0.5, (P || this.plan || {}).impact || 0)) {
        // set up the scripted attack
        if (mine.kind === 'ranged') {
          if (dist < 2.8) desired = -dir * 6 * spd;
        } else if (mine.kind === 'flying') {
          if (dist < 2.2) desired = -dir * 5;
        } else if (mine.kind === 'melee' || (mine.range && mine.kind === 'flying')) {
          const need = dist - (mine.range || MELEE);
          if (need > 0.05) {
            const v = need / Math.max(mine.inSec, 0.08);
            desired = dir * Math.min(v * 1.2, 15);
            accel = 18;
            if (v > 5 && f.y <= 0 && (f.anim === 'idle' || f.anim === 'walk')) {
              f.play('dash');
              this.particles.burst(new THREE.Vector3(f.x, 0.05, f.z), 5, { color: 0xb8a888, speed: 1.4, life: 0.35, gravity: 3 });
            }
          } else if (need < -0.3) desired = -dir * 2.5;
        }
      } else if (this.antic && this.antic.by !== f.idx && this.antic.inSec < 0.35 && this.antic.kind === 'melee') {
        desired = 0; // brace for the incoming exchange
      } else {
        // exchange just ended: break apart to reset spacing
        if (f.engaged && dist < 2.2 && f.y <= 0) {
          const room = this.bound - f.x * -dir;     // space behind me
          const oRoom = this.bound - o.x * dir;
          if (room >= oRoom || rand() < 0.3) { f.intent = 'backdash'; this.doIntent(f, o, dist, dir, spd); }
        }
        f.intentT = (f.intentT || 0) - dt;
        if (f.intentT <= 0) this.pickIntent(f, o, dist, dir, spd);
        switch (f.intent) {
          case 'approach': desired = dir * 3.0 * spd; break;
          case 'retreat': desired = -dir * 2.6 * spd; break;
          case 'zone': desired = dist < f.want - 0.3 ? -dir * 3 * spd : dist > f.want + 0.3 ? dir * 3 * spd : 0; break;
          default: desired = 0;
        }
        // gentle pull back toward center stage; keep the pair framable
        desired += -f.x * 0.22;
        if (dist > this.maxSep) desired = dir * 4;
      }
      f.engaged = !!(mine && mine.inSec < 0.6) || !!(this.antic && this.antic.inSec < 0.6);
      if (myP) {
        if (f.rig.time >= myP.impact) desired = 0;     // recovery: hold ground
      } else if (BUSY.has(f.anim) && f.anim !== 'dash' && f.anim !== 'backdash') desired *= 0.25;
      this.integrate(f, dt, desired, accel);

      // edge handling: cornered fighters push off or jump out
      if (Math.abs(f.x) > this.bound) {
        f.x = Math.sign(f.x) * this.bound;
        f.kb = 0;
        if (f.intent === 'retreat') f.intentT = 0;
      }
      if (f.y <= 0 && !BUSY.has(f.anim) && !FROZEN.has(f.anim)) {
        f.anim = Math.abs(f.vx) > 0.7 ? 'walk' : 'idle';
      }
    }
    // no overlapping
    const d = b.x - a.x;
    if (Math.abs(d) < MIN_SEP && a.y < 0.5 && b.y < 0.5) {
      const push = (MIN_SEP - Math.abs(d)) / 2 * (Math.sign(d) || 1);
      a.x -= push; b.x += push;
    }
  }

  // Neutral-game decisions: spacing, dashes, jumps, zoning.
  pickIntent(f, o, dist, dir, spd) {
    const agg = (f.def.aggression || 70) / 100;
    const zoner = f.def.special && f.def.special.kind === 'fireball';
    const nearEdge = Math.abs(f.x) > this.bound - 1.4 && Math.sign(f.x) === -dir;
    const opts = nearEdge ? [
      // cornered: get out
      ['jumpover', dist < 2.4 ? 0.5 : 0.1],
      ['dashin', 0.3],
      ['approach', 0.25],
      ['hold', 0.08],
    ] : [
      ['hold', 0.2],
      ['approach', dist > 3 ? 0.35 + agg * 0.3 : 0.06],
      ['retreat', dist < 2.6 ? 0.32 : 0.1],
      ['backdash', dist < 2.6 ? 0.3 : 0.05],
      ['dashin', dist > 2.4 ? 0.22 * (0.6 + agg) : 0],
      ['jump', 0.22],
      ['zone', zoner ? 0.4 : 0],
    ];
    const total = opts.reduce((s, x) => s + x[1], 0);
    let r = rand() * total, choice = 'hold';
    for (const [k, w] of opts) { r -= w; if (r <= 0) { choice = k; break; } }
    f.intent = choice;
    this.doIntent(f, o, dist, dir, spd);
  }

  doIntent(f, o, dist, dir, spd) {
    const choice = f.intent;
    f.intentT = randRange(0.35, 1.15);
    const dust = () => this.particles.burst(new THREE.Vector3(f.x, 0.05, f.z), 6, { color: 0xb8a888, speed: 1.5, life: 0.35, gravity: 3 });
    switch (choice) {
      case 'backdash':
        f.kb += -dir * impulseFor(randRange(1.4, 2.6), 0.3) / 3.2;
        f.play('backdash'); dust(); f.intentT = 0.4;
        break;
      case 'dashin':
        f.kb += dir * impulseFor(Math.min(dist - 1.3, randRange(1.6, 3)), 0.3) / 3.2 * spd;
        f.play('dash'); dust(); f.intentT = 0.35;
        break;
      case 'jump': {
        f.vy = randRange(6.5, 8);
        f.kb += (rand() < 0.6 ? dir : -dir) * randRange(2.5, 4.5);
        dust();
        f.intentT = 0.8;
        break;
      }
      case 'jumpover': {
        // vault over the opponent and land on the far side
        f.vy = 9.5;
        f.kb += dir * impulseFor(dist + 1.5, 0.8);
        dust();
        f.intentT = 1.0;
        break;
      }
      case 'zone': f.want = randRange(3.6, Math.min(5.8, this.maxSep - 0.5)); break;
    }
  }

  // ------------------------------ render ------------------------------

  draw(dt = 1 / 60) {
    const [a, b] = this.fighters;
    this.director.update(dt * (this.hitstop > 0 ? 0.3 : 1), this.time, this.fighters, this.aspect);
    // fog and key light follow the camera/action
    if (this.fogBase) {
      const extra = Math.max(0, this.director.dist - 8);
      this.scene.fog.near = this.fogBase[0] + extra;
      this.scene.fog.far = this.fogBase[1] + extra * 1.4;
    }
    const mid = a && b ? (a.x + b.x) / 2 : 0;
    this.key.position.x += (mid - this.key.position.x) * 0.08;
    this.key.target.position.set(this.key.position.x, 0, 0);

    this.flashEl.style.background = this.redFlash > 0.01
      ? `rgba(150,10,25,${(this.redFlash * 0.5).toFixed(3)})`
      : `rgba(255,255,255,${this.flash.toFixed(3)})`;
    this.flashEl.style.opacity = (this.flash > 0.01 || this.redFlash > 0.01) ? 1 : 0;

    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.W, this.H);
    this.renderer.render(this.scene, this.camera);
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
      size: 0.1, vertexColors: true, transparent: true, opacity: 0.95,
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

