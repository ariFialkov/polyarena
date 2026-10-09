// Shrink the character GLBs by storing vertex attributes compactly
// (KHR_mesh_quantization, supported by three.js's GLTFLoader):
//
//   NORMAL      float32 x3  ->  int8 x3 normalized (padded to 4 bytes)
//   TEXCOORD_0  float32 x2  ->  uint16 x2 normalized   (when UVs lie in 0..1)
//   WEIGHTS_0   float32 x4  ->  uint8 x4 normalized    (renormalized to 255)
//   JOINTS_0    uint16 x4   ->  uint8 x4               (when < 256 bones)
//
// Positions, indices, skin matrices and the texture are copied unchanged.
// About a third smaller per model, with no visible difference.
//
//   cd tools && npm run quantize-models            (all of assets/models)
//   cd tools && npm run quantize-models -- ibra    (just one)
//
// Already-quantized files are skipped, so it's safe to re-run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../assets/models');
const only = process.argv[2];

const F32 = 5126, U16 = 5123, U8 = 5121, I8 = 5120;
const SIZE = { [F32]: 4, [U16]: 2, [U8]: 1, [I8]: 1, 5125: 4 };
const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin };
}

function writeGlb(json, bin) {
  const pad = (b, fill) => { const n = (4 - (b.length % 4)) % 4; return n ? Buffer.concat([b, Buffer.alloc(n, fill)]) : b; };
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const b = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, j, bh, b]);
}

// read accessor `i` as an array of tuples (numbers)
function readAccessor(json, bin, i) {
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
  const n = COMPS[a.type], sz = SIZE[a.componentType];
  const stride = bv.byteStride || n * sz;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const get = { [F32]: 'readFloatLE', [U16]: 'readUInt16LE', [U8]: 'readUInt8', [I8]: 'readInt8' }[a.componentType];
  const out = new Array(a.count);
  for (let k = 0; k < a.count; k++) {
    const t = new Array(n);
    for (let c = 0; c < n; c++) t[c] = bin[get](base + k * stride + c * sz);
    out[k] = t;
  }
  return out;
}

function quantize(file) {
  const src = fs.readFileSync(file);
  const { json, bin } = readGlb(src);
  if ((json.extensionsUsed || []).includes('KHR_mesh_quantization')) return console.log(path.basename(file), 'already quantized');

  // new attribute payloads: accessor index -> { data: Buffer, stride, componentType, normalized, min?, max? }
  const repl = new Map();
  for (const mesh of json.meshes) for (const prim of mesh.primitives) {
    if (prim.targets) continue;
    const at = prim.attributes;
    if (at.NORMAL != null && json.accessors[at.NORMAL].componentType === F32) {
      const v = readAccessor(json, bin, at.NORMAL), d = Buffer.alloc(v.length * 4);
      v.forEach((t, k) => {
        const l = Math.hypot(t[0], t[1], t[2]) || 1;
        for (let c = 0; c < 3; c++) d.writeInt8(Math.max(-127, Math.min(127, Math.round(t[c] / l * 127))), k * 4 + c);
      });
      repl.set(at.NORMAL, { data: d, stride: 4, componentType: I8, normalized: true });
    }
    if (at.TEXCOORD_0 != null && json.accessors[at.TEXCOORD_0].componentType === F32) {
      const v = readAccessor(json, bin, at.TEXCOORD_0);
      if (v.every(t => t[0] >= 0 && t[0] <= 1 && t[1] >= 0 && t[1] <= 1)) {
        const d = Buffer.alloc(v.length * 4);
        v.forEach((t, k) => { d.writeUInt16LE(Math.round(t[0] * 65535), k * 4); d.writeUInt16LE(Math.round(t[1] * 65535), k * 4 + 2); });
        repl.set(at.TEXCOORD_0, { data: d, stride: 4, componentType: U16, normalized: true });
      }
    }
    if (at.WEIGHTS_0 != null && json.accessors[at.WEIGHTS_0].componentType === F32) {
      const v = readAccessor(json, bin, at.WEIGHTS_0), d = Buffer.alloc(v.length * 4);
      v.forEach((t, k) => {
        const s = t.reduce((x, y) => x + y, 0) || 1;
        const q = t.map(w => Math.round(w / s * 255));
        // keep the sum exactly 255: fix rounding on the largest weight
        const big = q.indexOf(Math.max(...q));
        q[big] += 255 - q.reduce((x, y) => x + y, 0);
        q.forEach((w, c) => d.writeUInt8(Math.max(0, w), k * 4 + c));
      });
      repl.set(at.WEIGHTS_0, { data: d, stride: 4, componentType: U8, normalized: true });
    }
    if (at.JOINTS_0 != null && json.accessors[at.JOINTS_0].componentType === U16) {
      const v = readAccessor(json, bin, at.JOINTS_0);
      if (v.every(t => t.every(j => j < 256))) {
        const d = Buffer.alloc(v.length * 4);
        v.forEach((t, k) => t.forEach((j, c) => d.writeUInt8(j, k * 4 + c)));
        repl.set(at.JOINTS_0, { data: d, stride: 4, componentType: U8, normalized: false });
      }
    }
  }

  // rebuild the binary chunk: one buffer view per accessor/image, 4-byte aligned
  const parts = [];
  let off = 0;
  const views = [];
  const addView = (data, extra) => {
    const padN = (4 - (off % 4)) % 4;
    if (padN) { parts.push(Buffer.alloc(padN)); off += padN; }
    views.push({ buffer: 0, byteOffset: off, byteLength: data.length, ...extra });
    parts.push(data); off += data.length;
    return views.length - 1;
  };
  const oldViews = json.bufferViews;
  const viewMap = new Map();   // old view index -> new (for untouched views)
  json.accessors.forEach((a, i) => {
    const r = repl.get(i);
    if (r) {
      a.bufferView = addView(r.data, { byteStride: r.stride, target: 34962 });
      a.byteOffset = 0;
      a.componentType = r.componentType;
      if (r.normalized) a.normalized = true; else delete a.normalized;
      delete a.min; delete a.max;
    }
  });
  json.accessors.forEach((a, i) => {
    if (repl.has(i) || a.bufferView == null) return;
    const ov = oldViews[a.bufferView];
    if (!viewMap.has(ov)) {
      const data = bin.subarray(ov.byteOffset || 0, (ov.byteOffset || 0) + ov.byteLength);
      const extra = {};
      if (ov.byteStride) extra.byteStride = ov.byteStride;
      if (ov.target) extra.target = ov.target;
      viewMap.set(ov, addView(Buffer.from(data), extra));
    }
    a.bufferView = viewMap.get(ov);
  });
  for (const img of json.images || []) {
    if (img.bufferView == null) continue;
    const ov = oldViews[img.bufferView];
    if (!viewMap.has(ov)) viewMap.set(ov, addView(Buffer.from(bin.subarray(ov.byteOffset || 0, (ov.byteOffset || 0) + ov.byteLength)), {}));
    img.bufferView = viewMap.get(ov);
  }
  json.bufferViews = views;
  const newBin = Buffer.concat(parts);
  json.buffers = [{ byteLength: newBin.length }];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'KHR_mesh_quantization'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'KHR_mesh_quantization'])];
  const out = writeGlb(json, newBin);
  fs.writeFileSync(file, out);
  console.log(`${path.basename(file)}: ${(src.length / 1024).toFixed(0)} KB -> ${(out.length / 1024).toFixed(0)} KB`);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.glb') && (!only || f === only + '.glb'));
for (const f of files) quantize(path.join(dir, f));
