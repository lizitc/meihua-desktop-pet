// Finds the iris in each eye piece of a rig and stores it in rig.json as `irises` (native rig px):
//   { "eye-left": { cx, cy, rx, ry }, "eye-right": { ... } }
// The renderer moves only the iris (and the white around it) when she looks around; the lash line stays put.
//   node scripts/eye-irises.mjs stand [sit]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RIGS = path.resolve(here, '..', 'assets', 'character', 'rigs');

/** Iris = the violet / dark-violet pixels of the piece (largest blob), measured by its moments. */
export function findIris(png, ox = 0, oy = 0) {
  const { width: w, height: h, data: d } = png;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
    if (a > 160 && b > g + 18 && r + g + b < 560) m[i] = 1;
  }
  // largest 4-connected blob
  const lab = new Int32Array(w * h).fill(-1);
  let best = null;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s] >= 0) continue;
    const st = [s], px = []; lab[s] = s;
    while (st.length) {
      const p = st.pop(); px.push(p);
      const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if (q >= 0 && m[q] && lab[q] < 0) { lab[q] = s; st.push(q); }
    }
    if (!best || px.length > best.length) best = px;
  }
  if (!best || best.length < 12) return null;
  let sx = 0, sy = 0;
  for (const p of best) { sx += p % w; sy += (p / w) | 0; }
  const cx = sx / best.length, cy = sy / best.length;
  let vx = 0, vy = 0;
  for (const p of best) { vx += (p % w - cx) ** 2; vy += (((p / w) | 0) - cy) ** 2; }
  // a filled ellipse has variance r^2 / 4 along each axis
  const rx = 2 * Math.sqrt(vx / best.length), ry = 2 * Math.sqrt(vy / best.length);
  return { cx: +(ox + cx + 0.5).toFixed(1), cy: +(oy + cy + 0.5).toFixed(1), rx: +rx.toFixed(1), ry: +ry.toFixed(1), n: best.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const id of process.argv.slice(2)) {
    const file = path.join(RIGS, id, 'rig.json');
    const rig = JSON.parse(fs.readFileSync(file, 'utf8'));
    const irises = {};
    for (const side of ['eye-left', 'eye-right']) {
      // the neutral face expression when the rig has one, else the visible eye piece
      const slot = rig.expressions?.['101']?.find((p) => p.layer === side) || rig.layers.find((l) => l.id === side)?.visible;
      if (!slot) continue;
      const png = PNG.sync.read(fs.readFileSync(path.join(RIGS, id, slot.src)));
      const iris = findIris(png, slot.x, slot.y);
      if (!iris) { console.warn(id, side, 'no iris found'); continue; }
      const { n, ...keep } = iris;
      irises[side] = keep;
      console.log(id, side, slot.src, JSON.stringify(iris), 'piece', slot.width + 'x' + slot.height);
    }
    rig.irises = irises;
    // every expression's own eye drawing (the iris sits a little differently in each face)
    const byPiece = {};
    for (const list of Object.values(rig.expressions || {})) for (const p of list) {
      if ((p.layer !== 'eye-left' && p.layer !== 'eye-right') || byPiece[p.src] !== undefined) continue;
      const iris = findIris(PNG.sync.read(fs.readFileSync(path.join(RIGS, id, p.src))), p.x, p.y);
      // a usable iris is a decent blob near the base iris (not a closed-eye line or a sparkle)
      const base = irises[p.layer];
      const ok = iris && iris.n >= 60 && (!base || Math.hypot(iris.cx - base.cx, iris.cy - base.cy) < 9);
      if (ok) { const { n, ...keep } = iris; byPiece[p.src] = keep; }
    }
    rig.irisByPiece = byPiece;
    console.log(id, 'expression eye pieces with an iris:', Object.keys(byPiece).length);
    fs.writeFileSync(file, JSON.stringify(rig, null, 2) + '\n');
  }
}
