// Convert uploaded rigged FBX characters into web-ready GLBs.
//
//   cd tools && npm install && npm run convert-models [-- name1 name2 ...]
//
// Reads  assets/models/src/<name>.fbx
// Writes assets/models/<name>.glb  (skinned mesh + skeleton, texture embedded
//                                   as JPEG at MAX_TEX, bones renamed to plain
//                                   humanoid names: Hips, Spine, LeftArm, ...)
//
// Why: the FBX files reference their texture through a Blender ".fbm" folder
// the web loader cannot read, and the 2048px embedded JPEG is ~75% of each
// file. The GLB fixes the texture and is a fraction of the size.
//
// Needs a Chromium binary (set CHROMIUM_PATH, defaults to the Playwright one).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const srcDir = path.join(root, 'assets/models/src');
const outDir = path.join(root, 'assets/models');
const threeDir = path.join(here, 'node_modules/three');
const MAX_TEX = Number(process.env.MAX_TEX || 1024);

// Find the embedded JPEG: an FBX raw ('R') property whose payload starts with
// the JPEG SOI marker. Takes the largest one.
function extractTexture(buf) {
  let best = null;
  for (let p = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff])); p >= 5; p = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), p + 3)) {
    if (buf[p - 5] !== 0x52) continue; // 'R'
    const len = buf.readUInt32LE(p - 4);
    if (p + len <= buf.length && (!best || len > best.length)) best = buf.subarray(p, p + len);
  }
  return best;
}

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(srcDir).filter(f => f.endsWith('.fbx')).map(f => f.replace(/\.fbx$/, ''));

const textures = {};
for (const n of names) {
  const tex = extractTexture(fs.readFileSync(path.join(srcDir, n + '.fbx')));
  if (!tex) throw new Error(`${n}: no embedded JPEG texture found`);
  textures[n] = tex;
}

const types = { '.js': 'text/javascript', '.html': 'text/html', '.fbx': 'application/octet-stream', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = null, body = null;
  if (url === '/' || url === '/convert.html') file = path.join(here, 'convert.html');
  else if (url.startsWith('/three/')) file = path.join(threeDir, url.slice(7));
  else if (url.startsWith('/src/')) file = path.join(srcDir, path.basename(url));
  else if (url.startsWith('/tex/')) body = textures[path.basename(url, '.jpg')];
  if (file && file.startsWith(root) || file && file.startsWith(threeDir)) {
    if (fs.existsSync(file)) body = fs.readFileSync(file);
  }
  if (!body) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(url)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://localhost:${port}/convert.html`);
  await page.waitForFunction(() => document.title === 'ready');
  for (const n of names) {
    const { b64, stats } = await page.evaluate(([n, m]) => window.convert(n, m), [n, MAX_TEX]);
    const out = Buffer.from(b64, 'base64');
    fs.writeFileSync(path.join(outDir, n + '.glb'), out);
    const srcKB = Math.round(fs.statSync(path.join(srcDir, n + '.fbx')).size / 1024);
    console.log(`${n}: ${srcKB} KB fbx -> ${Math.round(out.length / 1024)} KB glb | verts ${stats.welded}, ${stats.bones.length} bones`);
  }
} finally {
  await browser.close();
  server.close();
}
