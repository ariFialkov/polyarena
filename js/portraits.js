// Portrait studio: live 3D "cutout" renders of fighters for the lobby table
// (warm-up loops) and the result card (victory pose). Shares the arena's
// WebGL renderer (textures/shaders are uploaded once) by rendering each slot
// into a scissored region of the arena canvas with a transparent clear and
// copying it into the slot's own 2D canvas.

import * as THREE from '../vendor/three.module.min.js';
import { Fighter } from './fighter.js';
import { instantiateModel } from './models.js';

const RIMS = {
  A: [0xff2d6f, 0xff8a1f],
  B: [0x19e3ff, 0x3d7bff],
};

export class PortraitStudio {
  constructor(renderer) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
    this.scene.add(new THREE.HemisphereLight(0xb0a0e0, 0x140a24, 0.75));
    this.key = new THREE.DirectionalLight(0xfff4e8, 2.6);
    this.key.position.set(1.2, 3, 4);
    this.rimL = new THREE.DirectionalLight(0xffffff, 5);
    this.rimL.position.set(-3, 2.2, -2.5);
    this.rimR = new THREE.DirectionalLight(0xffffff, 5);
    this.rimR.position.set(3, 2.2, -2.5);
    this.scene.add(this.key, this.rimL, this.rimR);
    this.slots = new Map();   // name -> slot
    this.token = 0;
  }

  // Put `def` into slot `name`, drawing into `canvas`.
  set(name, canvas, def, { side = 'A', yaw = 0.5, anim = 'warmup' } = {}) {
    this.remove(name);
    const f = new Fighter(def, 0);
    f.x = 0; f.faceCam = true; f.camYaw = yaw; f.smYaw = yaw;
    f.play(anim);
    f.baseAnim = anim;
    f.root.visible = false;
    this.scene.add(f.root);
    const slot = { canvas, ctx: canvas.getContext('2d'), fighter: f, side, token: ++this.token };
    this.slots.set(name, slot);
    if (def.model) {
      instantiateModel(def.model).then(m => {
        if (this.slots.get(name) === slot) f.attachModel(m);
      }).catch(() => {});
    }
    return slot;
  }

  remove(name) {
    const s = this.slots.get(name);
    if (!s) return;
    this.scene.remove(s.fighter.root);
    this.slots.delete(name);
  }

  clear() { for (const k of [...this.slots.keys()]) this.remove(k); }

  // quick hype reaction (bet landed on this fighter)
  react(name) {
    const s = this.slots.get(name);
    if (!s || s.fighter.anim === 'taunt') return;
    s.fighter.play('taunt');
  }

  render(dt) {
    if (!this.slots.size) return;
    // cutouts refresh at up to 30 fps: each one is copied out of the WebGL
    // canvas, which stalls the GPU pipeline, so do it as rarely as looks smooth
    this.carry = (this.carry || 0) + dt;
    if (this.carry < 1 / 30) return;
    dt = Math.min(0.1, this.carry); this.carry = 0;
    const r = this.r;
    const pr = r.getPixelRatio();
    const mainW = r.domElement.width, mainH = r.domElement.height;
    const live = [...this.slots.values()].filter(s => s.canvas.isConnected && s.canvas.clientWidth > 0);
    if (!live.length) return;
    const lane = mainW / live.length;
    const prevClear = r.getClearAlpha();

    r.setScissorTest(true);
    live.forEach((s, i) => {
      const f = s.fighter;
      if (f.anim === 'idle') f.play(f.baseAnim);
      f.update(dt);

      // size the slot canvas to its layout box
      const dpr = Math.min(1.25, window.devicePixelRatio || 1);
      const tw = Math.max(2, Math.round(s.canvas.clientWidth * dpr));
      const th = Math.max(2, Math.round(s.canvas.clientHeight * dpr));
      if (s.canvas.width !== tw || s.canvas.height !== th) { s.canvas.width = tw; s.canvas.height = th; }
      const k = Math.min(1, lane / tw, mainH / th);
      const rw = Math.floor(tw * k), rh = Math.floor(th * k);
      const x = Math.floor(i * lane);

      // frame knees-up, slightly low angle
      const H = 1.92 * ((f.def.look && f.def.look.h) || 1);
      const y0 = H * 0.22, y1 = H * 1.14;
      const cy = (y0 + y1) / 2, span = y1 - y0;
      this.cam.aspect = tw / th;
      const vt = Math.tan(this.cam.fov * Math.PI / 360);
      let dist = (span / 2) / vt;
      dist = Math.max(dist, (H * 0.42) / (vt * this.cam.aspect));  // fit width
      this.cam.position.set(0, cy - 0.12, dist);
      this.cam.lookAt(0, cy, 0);
      this.cam.updateProjectionMatrix();

      const [c1, c2] = RIMS[s.side] || RIMS.A;
      this.rimL.color.setHex(s.side === 'A' ? c1 : c2);
      this.rimR.color.setHex(s.side === 'A' ? c2 : c1);

      for (const o of this.slots.values()) o.fighter.root.visible = o === s;
      r.setViewport(x / pr, 0, rw / pr, rh / pr);
      r.setScissor(x / pr, 0, rw / pr, rh / pr);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(this.scene, this.cam);

      s.ctx.clearRect(0, 0, tw, th);
      s.ctx.drawImage(r.domElement, x, mainH - rh, rw, rh, 0, 0, tw, th);
    });
    r.setScissorTest(false);
    r.setClearColor(0x000000, prevClear);
  }
}
