// Cleans the hidden underpaint of the lop ears (stand rig). The underpaint is what shows when an ear swings away
// from the head; the cut-out had picked up the bows, a navy fragment, stray outline strokes and a faint ghost of the
// ear, which popped out next to the ear whenever it moved. Keeps only solid ear-coloured fill connected to the ear,
// paints over the bows with the surrounding ear colour and drops the rest.
//   node scripts/ear-clean.mjs            (originals kept once in art/ear-fix/orig, review image in art/ear-fix)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { read, write, blank } from './lib/art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RIG = path.join(ROOT, 'assets/character/rigs/stand');
const OUT = path.join(ROOT, 'art/ear-fix');
const json = JSON.parse(fs.readFileSync(path.join(RIG, 'rig.json'), 'utf8'));

const morph = (m, w, h, r, op) => {
  // square structuring element, separable
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = op === 'min' ? 1 : 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; const s = xx < 0 || xx >= w ? 0 : m[y * w + xx]; v = op === 'min' ? Math.min(v, s) : Math.max(v, s); }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = op === 'min' ? 1 : 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; const s = yy < 0 || yy >= h ? 0 : tmp[yy * w + x]; v = op === 'min' ? Math.min(v, s) : Math.max(v, s); }
    out[y * w + x] = v;
  }
  return out;
};
const components = (m, w, h) => {
  const lab = new Int32Array(m.length).fill(-1), sizes = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || lab[i] >= 0) continue;
    const id = sizes.length, st = [i]; lab[i] = id; let n = 0;
    while (st.length) {
      const j = st.pop(); n++;
      const x = j % w, y = (j / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (m[k] && lab[k] < 0) { lab[k] = id; st.push(k); }
      }
    }
    sizes.push(n);
  }
  return { lab, sizes };
};

fs.mkdirSync(path.join(OUT, 'orig'), { recursive: true });
const report = [];
for (const id of ['ear-left', 'ear-right']) {
  const L = json.layers.find((l) => l.id === id);
  const H = L.hidden, V = L.visible;
  const orig = path.join(OUT, 'orig', H.src);
  if (!fs.existsSync(orig)) fs.copyFileSync(path.join(RIG, H.src), orig);
  const src = read(orig), vis = read(path.join(RIG, V.src));
  const w = src.width, h = src.height, d = src.data;
  // ear colour: light and nearly grey (the ear is white with grey-lilac shading); bows are saturated, lines darker
  const earCol = (i) => { const r = d[i], g = d[i + 1], b = d[i + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx > 196 && mx - mn < 34; };
  const solid = new Uint8Array(w * h), coloured = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] < 140) continue;
    if (earCol(i * 4)) solid[i] = 1; else coloured[i] = 1;
  }
  // thin strokes go (2 px opening); only fill touching the visible ear stays
  const opened = morph(morph(solid, w, h, 2, 'min'), w, h, 2, 'max');
  const near = new Uint8Array(w * h);
  for (let y = 0; y < vis.height; y++) for (let x = 0; x < vis.width; x++) {
    if (vis.data[(y * vis.width + x) * 4 + 3] < 128) continue;
    const hx = x + V.x - H.x, hy = y + V.y - H.y;
    if (hx >= 0 && hy >= 0 && hx < w && hy < h) near[hy * w + hx] = 1;
  }
  const touch = morph(near, w, h, 3, 'max');
  const { lab, sizes } = components(opened, w, h);
  const keepId = new Set();
  for (let i = 0; i < lab.length; i++) if (lab[i] >= 0 && touch[i] && sizes[lab[i]] >= 60) keepId.add(lab[i]);
  // only a band along the ear (the part tucked under the hair and headband): fill further out is a ghost of the
  // ear that floats free as soon as it swings. Near the root (where it hides under the headband) a wider band.
  const dist = new Float32Array(w * h).fill(1e9), bq = [];
  for (let i = 0; i < near.length; i++) if (near[i]) { dist[i] = 0; bq.push(i); }
  for (let qi = 0; qi < bq.length; qi++) {
    const j = bq[qi], x = j % w, y = (j / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = yy * w + xx;
      if (dist[k] > dist[j] + 1) { dist[k] = dist[j] + 1; bq.push(k); }
    }
  }
  const [px, py] = L.pivot;
  const band = (i) => { const x = (i % w) + H.x, y = ((i / w) | 0) + H.y; return dist[i] <= (Math.hypot(x - px, y - py) < 34 ? 22 : 9); };
  const keep = new Uint8Array(w * h);
  for (let i = 0; i < lab.length; i++) if (lab[i] >= 0 && keepId.has(lab[i]) && band(i)) keep[i] = 1;
  // bows / fragments enclosed by the kept fill are painted over with the nearest ear colour (closing finds them)
  const closed = morph(morph(keep, w, h, 4, 'max'), w, h, 4, 'min');
  const fill = new Uint8Array(w * h);
  for (let i = 0; i < fill.length; i++) fill[i] = keep[i] || (closed[i] && (solid[i] || coloured[i])) ? 1 : 0;
  const out = blank(w, h), o = out.data;
  const srcOf = new Int32Array(w * h).fill(-1), q = [];
  for (let i = 0; i < keep.length; i++) if (keep[i]) { srcOf[i] = i; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const j = q[qi], x = j % w, y = (j / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = yy * w + xx;
      if (fill[k] && srcOf[k] < 0) { srcOf[k] = srcOf[j]; q.push(k); }
    }
  }
  let kept = 0, painted = 0, dropped = 0;
  for (let i = 0; i < w * h; i++) {
    if (!fill[i] || srcOf[i] < 0) { if (d[i * 4 + 3]) dropped++; continue; }
    const s = keep[i] ? i : srcOf[i];
    if (!keep[i]) painted++; else kept++;
    o[i * 4] = d[s * 4]; o[i * 4 + 1] = d[s * 4 + 1]; o[i * 4 + 2] = d[s * 4 + 2]; o[i * 4 + 3] = 255;
  }
  write(path.join(RIG, H.src), out);
  report.push(`${H.src}: kept ${kept}, painted over ${painted}, dropped ${dropped}`);
}
console.log(report.join('\n'));

// The right ear's bows are a separate piece whose white surround meets the ear along an antialiased cut; drawn as
// two pieces that seam lets the background through as a faint outline. The ear piece gets the bow piece merged in
// (alpha added back up, as the two partition the art); the bow piece still draws on top, now over solid ear.
{
  const ear = json.layers.find((l) => l.id === 'ear-right').visible, bow = json.layers.find((l) => l.id === 'ear-bow-right').visible;
  const orig = path.join(OUT, 'orig', ear.src);
  if (!fs.existsSync(orig)) fs.copyFileSync(path.join(RIG, ear.src), orig);
  const e = read(orig), b = read(path.join(RIG, bow.src));
  let merged = 0;
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
    const ex = x + bow.x - ear.x, ey = y + bow.y - ear.y;
    if (ex < 0 || ey < 0 || ex >= e.width || ey >= e.height) continue;
    const i = (y * b.width + x) * 4, j = (ey * e.width + ex) * 4, ba = b.data[i + 3], ea = e.data[j + 3];
    if (!ba) continue;
    const sum = ba + ea;
    for (let c = 0; c < 3; c++) e.data[j + c] = Math.round((b.data[i + c] * ba + e.data[j + c] * ea) / sum);
    e.data[j + 3] = Math.min(255, sum);
    merged++;
  }
  write(path.join(RIG, ear.src), e);
  console.log(`${ear.src}: merged ${merged} bow pixels`);
}
