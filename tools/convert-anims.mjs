// Convert the Mixamo animation library into web-ready files.
//
//   cd tools && npm install && npm run convert-anims
//
// Reads  assets/anims/src/Polyarena_Animations.zip   (Mixamo FBX, Without Skin)
//        tools/anims.manifest.json                    (clip id -> file + hints)
// Writes assets/anims/anims.bin   every clip sampled at 30 fps, in place:
//                                 body bone rotations packed "smallest three"
//                                 (3 x int16) + hips height, plus one static
//                                 finger pose per clip
//        assets/anims/anims.json  the Mixamo rest skeleton, bone order, and per
//                                 clip: byte offset, frames, duration, loop,
//                                 hips travel path (applied as root motion in
//                                 game) and for strikes the striking limb,
//                                 impact time, reach and impact height
//                                 (auto-detected; override "impact" in the
//                                 manifest)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const zipPath = path.join(root, 'assets/anims/src/Polyarena_Animations.zip');
const outDir = path.join(root, 'assets/anims');
const threeDir = path.join(here, 'node_modules/three');

// Minimal ZIP reader (stored + deflate entries) via the central directory.
function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || name.includes('__MACOSX') || path.basename(name).startsWith('._')) continue;
    const data0 = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(data0, data0 + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`unsupported compression in ${name}`);
    // key: path below the top-level folder, e.g. "Kicks/Kicking-2.fbx"
    files.set(name.split('/').slice(1).join('/'), data);
  }
  return files;
}

const manifest = JSON.parse(fs.readFileSync(path.join(here, 'anims.manifest.json'), 'utf8'));
delete manifest._doc;
const zip = readZip(fs.readFileSync(zipPath));
for (const [id, m] of Object.entries(manifest)) {
  if (!zip.has(m.file)) throw new Error(`${id}: "${m.file}" not found in the zip`);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let body = null, type = 'application/octet-stream';
  if (url === '/' || url === '/convert-anims.html') { body = fs.readFileSync(path.join(here, 'convert-anims.html')); type = 'text/html'; }
  else if (url.startsWith('/three/')) {
    const f = path.join(threeDir, url.slice(7));
    if (f.startsWith(threeDir) && fs.existsSync(f)) { body = fs.readFileSync(f); type = 'text/javascript'; }
  } else if (url.startsWith('/clip/')) {
    const m = manifest[url.slice(6)];
    body = m && zip.get(m.file);
  }
  if (!body) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': type });
  res.end(body);
});
await new Promise(r => server.listen(0, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://localhost:${server.address().port}/convert-anims.html`);
  await page.waitForFunction(() => document.title === 'ready');
  const { meta, blobs } = await page.evaluate(m => window.convert(m), manifest);
  const parts = [];
  let offset = 0;
  for (const id of Object.keys(meta.clips)) {
    const b = Buffer.from(blobs[id], 'base64');
    meta.clips[id].offset = offset;
    offset += b.length;
    parts.push(b);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const bin = Buffer.concat(parts);
  fs.writeFileSync(path.join(outDir, 'anims.bin'), bin);
  fs.writeFileSync(path.join(outDir, 'anims.json'), JSON.stringify(meta));
  console.log(`${Object.keys(meta.clips).length} clips, ${meta.body.length} body + ${meta.fingers.length} finger bones -> anims.bin ${Math.round(bin.length / 1024)} KB, anims.json ${Math.round(JSON.stringify(meta).length / 1024)} KB`);
} finally {
  await browser.close();
  server.close();
}
