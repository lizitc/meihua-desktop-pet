// Prepares the green-canvas references for the sit / sleep redraw (art/sit-kit/refs).
// Every pose is placed in the walk kit's guide space: 1024x1536, ground line y=1480, centre x=512,
// 1.45 canvas px per native px, so the standing art, the redrawn sit and the in-betweens share one scale.
//   node art/sit-kit/tools/prep.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '..', '..', '..');
const require = createRequire(path.join(APP, 'package.json'));
const { PNG } = require('pngjs');
const KIT = path.join(APP, 'art', 'sit-kit');
const REFS = path.join(KIT, 'refs');
const HANDOFF = path.resolve(APP, '..', 'Meihua-Asset-Handoff-20261109');
const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'assets', 'character', 'manifest.json'), 'utf8'));

export const CANVAS = { W: 1024, H: 1536, G: 1480, CX: 512, S: 1.45 };

/** Bilinear resample with premultiplied alpha. */
export function resample(src, k, ox, oy, W, H) {
  const out = new PNG({ width: W, height: H });
  const sw = src.width, sh = src.height, d = src.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = (x + 0.5 - ox) / k - 0.5, sy = (y + 0.5 - oy) / k - 0.5;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (const [xx, yy, w] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]]) {
      if (xx < 0 || yy < 0 || xx >= sw || yy >= sh || w <= 0) continue;
      const i = (yy * sw + xx) * 4, al = d[i + 3] / 255;
      r += d[i] * al * w; g += d[i + 1] * al * w; b += d[i + 2] * al * w; a += al * w;
    }
    const j = (y * W + x) * 4;
    if (a > 1e-4) { out.data[j] = r / a; out.data[j + 1] = g / a; out.data[j + 2] = b / a; }
    out.data[j + 3] = Math.round(a * 255);
  }
  return out;
}

/** Composite over flat #00FF00. */
export function onGreen(png) {
  const o = new PNG({ width: png.width, height: png.height });
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3] / 255;
    o.data[i] = png.data[i] * a; o.data[i + 1] = png.data[i + 1] * a + 255 * (1 - a); o.data[i + 2] = png.data[i + 2] * a; o.data[i + 3] = 255;
  }
  return o;
}

/** Place a rig's flat art (rig px) in guide space. */
export function place(rigId, flat) {
  const r = manifest.rigs[rigId];
  const k = r.scale * CANVAS.S;
  return resample(flat, k, CANVAS.CX - r.originX * k, CANVAS.G - r.baseline * k, CANVAS.W, CANVAS.H);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(REFS, { recursive: true });
  for (const pose of ['sit', 'sleep']) {
    const flat = PNG.sync.read(fs.readFileSync(path.join(HANDOFF, '01_Production', 'poses', `${pose}.png`)));
    const placed = place(pose, flat);
    fs.writeFileSync(path.join(REFS, `${pose}-placed.png`), PNG.sync.write(placed));
    fs.writeFileSync(path.join(REFS, `${pose}-green.png`), PNG.sync.write(onGreen(placed)));
    console.log(pose, 'scale', (manifest.rigs[pose].scale * CANVAS.S).toFixed(3));
  }
  for (const f of ['stand-green.png', 'ich01A_101.png']) fs.copyFileSync(path.join(APP, 'art', 'walk-kit', 'refs', f), path.join(REFS, f));
  console.log('refs ->', REFS);
}
