// Builds the redrawn sitting / sleeping poses and their transitions from art/sit-kit (Codex drawings on #00FF00):
//   1. key the chosen drawings, match their colours to the standing art
//   2. measure each drawing's head size against the standing art (correlation, see headScale) and bring every
//      drawing to the standing art's scale; feet / seat stay on the ground line
//   3. transitions: keyframes stand > K1 > K2 > K3 > sit and sit > L1 > L2 > sleep (seq/tr2/...); the app holds each
//      key and dissolves to the next, stretching both drawings about the ground so the neck bow travels smoothly
//   4. the sit and sleep rigs are re-cut from the new drawings: every pixel goes to the layer that covered it in the
//      old rig (aligned by silhouette), the eyes are re-cut around the new irises, and the old hidden underpaint is
//      clipped to the new silhouette. Old rig folders are kept in art/sit-kit/old-rigs.
//   node scripts/sit-build.mjs [--measure] [--no-app]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { read, write, blank, clonePng, key, fitColourMatch, applyColourMatch, bounds, warpAffine, crop, over } from './lib/art.mjs';
import { findIris } from './eye-irises.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '..');
const KIT = path.join(APP, 'art', 'sit-kit');
const OUT = path.join(KIT, 'processed');
const CHAR = path.join(APP, 'assets', 'character');
const argv = process.argv.slice(2);
const W = 1024, H = 1536, G = 1480, CX = 512, S = 1.45; // guide space (art/sit-kit/tools/prep.mjs)

const manifest = JSON.parse(fs.readFileSync(path.join(CHAR, 'manifest.json'), 'utf8'));
const PICK = { K1: 'K1-try-2', K2: 'K2-try-2', K3: 'K3-try-2', S: 'S-try-2', L1: 'L1-try-2', L2: 'L2-try-3', Z: 'Z-try-2' };

// ---------------------------------------------------------------- measuring
function blobs(png, test, region) {
  const { width: w, height: h, data: d } = png;
  const [rx0, ry0, rx1, ry1] = region || [0, 0, w, h];
  const m = new Uint8Array(w * h);
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) { const i = (y * w + x) * 4; if (d[i + 3] > 200 && test(d[i], d[i + 1], d[i + 2])) m[y * w + x] = 1; }
  const lab = new Int32Array(w * h).fill(-1), out = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s] >= 0) continue;
    const st = [s]; lab[s] = s; let n = 0, sx = 0, sy = 0;
    while (st.length) {
      const p = st.pop(); n++; sx += p % w; sy += (p / w) | 0;
      const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if (q >= 0 && m[q] && lab[q] < 0) { lab[q] = s; st.push(q); }
    }
    out.push({ n, x: sx / n, y: sy / n });
  }
  return out.sort((a, b) => b.n - a.n);
}
const isRed = (r, g, b) => r > 170 && g < 100 && b < 130 && r - g > 100;
const isIris = (r, g, b) => b > g + 16 && r > g - 6 && r + g + b < 580;
function measure(png) {
  const bb = bounds(png);
  const bow = blobs(png, isRed)[0] || null;
  // eyes: the two largest violet blobs in the upper part of the head
  const top = [bb.x0, bb.y0, bb.x1 + 1, Math.min(png.height, bb.y0 + 520)];
  // the pair of sizeable violet blobs side by side (the navy ear bow is a violet blob too, but has no partner)
  const ir = blobs(png, isIris, top).filter((b) => b.n > 150).slice(0, 8);
  let eyes = null;
  for (let i = 0; i < ir.length; i++) for (let j = i + 1; j < ir.length; j++) {
    const [l, r] = ir[i].x < ir[j].x ? [ir[i], ir[j]] : [ir[j], ir[i]];
    const d = Math.hypot(r.x - l.x, r.y - l.y);
    if (Math.abs(l.y - r.y) < 30 && d > 60 && d < 200 && Math.min(l.n, r.n) / Math.max(l.n, r.n) > 0.3 && (!eyes || l.n + r.n > eyes.l.n + eyes.r.n)) eyes = { l, r, d };
  }
  return { bb, bow, eyes };
}
const fmt = (m) => `bbox ${m.bb.x0},${m.bb.y0}-${m.bb.x1},${m.bb.y1}  bow ${m.bow ? `${m.bow.n}px @${m.bow.x.toFixed(0)},${m.bow.y.toFixed(0)}` : '-'}  eyes ${m.eyes ? `d=${m.eyes.d.toFixed(1)} @${((m.eyes.l.x + m.eyes.r.x) / 2).toFixed(0)},${((m.eyes.l.y + m.eyes.r.y) / 2).toFixed(0)}` : '-'}`;

/** Scale about the ground point (CX, G). */
const scaleAboutGround = (png, s) => warpAffine(png, [1 / s, 0, 0, 1 / s, CX - CX / s, G - G / s], W, H);
// The rig grids the old drawings were placed from (prep.mjs). Fixed here, so a re-run cuts the same way after the
// manifest scale has been updated.
const BASE = {
  stand: { width: 508, height: 1000, scale: 1, baseline: 969, originX: 254 },
  sit: { width: 512, height: 384, scale: 1.908, baseline: 360, originX: 256 },
  sleep: { width: 512, height: 384, scale: 1.293, baseline: 360, originX: 256 },
};
/** Rig flat (native rig px) -> guide space, as prep.mjs places it. */
function placeRig(rigId, flat) {
  const r = BASE[rigId], k = r.scale * S;
  return warpAffine(flat, [1 / k, 0, 0, 1 / k, r.originX - CX / k, r.baseline - G / k], W, H);
}
/** Guide space -> rig native grid (inverse of placeRig). */
function toRig(rigId, png) {
  const r = BASE[rigId], k = r.scale * S;
  return warpAffine(png, [k, 0, 0, k, CX - r.originX * k, G - r.baseline * k], r.width, r.height);
}

// Head size against the standing art: normalised cross-correlation of the head (headband, ears, face) at a range of
// scales, coarse to fine. Returns the scale that brings the drawing's head to the standing art's.
function lumaDown(png, f) {
  const w = Math.floor(png.width / f), h = Math.floor(png.height / f), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) {
      const i = ((y * f + yy) * png.width + x * f + xx) * 4, a = png.data[i + 3] / 255;
      s += (0.3 * png.data[i] + 0.59 * png.data[i + 1] + 0.11 * png.data[i + 2]) * a + 128 * (1 - a);
    }
    out[y * w + x] = s / (f * f);
  }
  return { w, h, d: out };
}
const HEAD_RECT = [250, 60, 730, 470]; // the standing art's head in guide space
function headScale(standPng, png) {
  let best = null;
  for (const [f, sR, sStep, pR, pStep] of [[8, [0.82, 1.18], 0.02, null, 1], [4, null, 0.01, 2, 1], [2, null, 0.005, 2, 1]]) {
    const T = lumaDown(standPng, f), F = lumaDown(png, f);
    const [x0, y0, x1, y1] = HEAD_RECT.map((v) => Math.round(v / f));
    const tp = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) tp.push([x - x0, y - y0, T.d[y * T.w + x]]);
    const tm = tp.reduce((a, p) => a + p[2], 0) / tp.length, tv = Math.sqrt(tp.reduce((a, p) => a + (p[2] - tm) ** 2, 0));
    const score = (s, ox, oy) => {
      let sf = 0, sff = 0, sft = 0, n = 0;
      for (const [tx, ty, t] of tp) {
        const X = Math.round(ox + tx * s), Y = Math.round(oy + ty * s);
        const v = X >= 0 && Y >= 0 && X < F.w && Y < F.h ? F.d[Y * F.w + X] : 128;
        sf += v; sff += v * v; sft += v * (t - tm); n++;
      }
      const fv = Math.sqrt(Math.max(1e-6, sff - sf * sf / n));
      return sft / (fv * tv);
    };
    const scales = [], pos = [];
    if (!best) { for (let s = sR[0]; s <= sR[1] + 1e-9; s += sStep) scales.push(s); }
    else for (let k = -2; k <= 2; k++) scales.push(best.s + k * sStep);
    const bb = bounds(png);
    let cand = null;
    for (const s of scales) {
      const range = best
        ? { xs: [best.x * best.f / f - pR, best.x * best.f / f + pR], ys: [best.y * best.f / f - pR, best.y * best.f / f + pR] }
        : { xs: [(bb.x0 - 140) / f, (bb.x1 - 200) / f], ys: [(bb.y0 - 120) / f, (bb.y0 + 120) / f] };
      for (let oy = Math.round(range.ys[0]); oy <= Math.round(range.ys[1]); oy += pStep) for (let ox = Math.round(range.xs[0]); ox <= Math.round(range.xs[1]); ox += pStep) {
        const v = score(s, ox, oy);
        if (!cand || v > cand.v) cand = { s, x: ox, y: oy, v, f };
      }
    }
    best = cand;
  }
  return { scale: 1 / best.s, ncc: best.v, at: [best.x * best.f, best.y * best.f] };
}

// ---------------------------------------------------------------- 1. key + colour
fs.mkdirSync(OUT, { recursive: true });
const standArt = read(path.join(KIT, 'refs', 'ich01A_101.png'));
const stand = placeRig('stand', standArt);
const keyed = {};
for (const [id, file] of Object.entries(PICK)) keyed[id] = key(read(path.join(KIT, 'out', `${file}.png`)));
console.log('keyed', Object.keys(keyed).join(' '));
const meas = { stand: measure(stand) };
for (const id of Object.keys(keyed)) meas[id] = measure(keyed[id]);
for (const [id, m] of Object.entries(meas)) console.log(id.padEnd(5), fmt(m));
if (argv.includes('--measure')) {
  for (const id of Object.keys(keyed)) { const r = headScale(stand, keyed[id]); console.log(`${id.padEnd(5)} head scale ${r.scale.toFixed(3)} (ncc ${r.ncc.toFixed(3)} at ${r.at})`); }
  process.exit(0);
}

const colour = fitColourMatch(Object.values(keyed), standArt, S);
const art = {};
for (const [id, p] of Object.entries(keyed)) art[id] = applyColourMatch(p, colour);
console.log('colour matched to the standing art');

// ---------------------------------------------------------------- 2. scale
// Size against the standing art, from `node scripts/sit-build.mjs --measure` (headScale, head correlation). The frontal
// drawings match well (NCC ~0.8): K1 0.962, K2 0.935, K3 0.971, S 0.971. Tilted and lying heads match poorly (NCC ~0.6),
// so L1 / L2 / Z are set between the sitting drawing and the measured Z (0.939).
const SCALE = { K1: 0.962, K2: 0.935, K3: 0.971, S: 0.971, L1: 0.96, L2: 0.945, Z: 0.94 };
/** Lowest solid row. */
function groundRow(png) {
  const { width, height, data } = png;
  for (let y = height - 1; y >= 0; y--) { let n = 0; for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= 128) n++; if (n >= 6) return y; }
  return height - 1;
}
const shiftY = (png, dy) => warpAffine(png, [1, 0, 0, 1, 0, -dy], W, H);
// every drawing rests on the ground line first (the drawings land within a few px of it)
const grounded = {};
for (const [id, p] of Object.entries(art)) {
  const dy = G - groundRow(p);
  grounded[id] = Math.abs(dy) <= 40 ? shiftY(p, dy) : p;
  if (Math.abs(dy) > 0) console.log(`${id}: ground ${dy > 0 ? '+' : ''}${dy} px${Math.abs(dy) > 40 ? ' (left as drawn)' : ''}`);
}
const final = { stand };
for (const [id, p] of Object.entries(grounded)) final[id] = scaleAboutGround(p, SCALE[id]);
for (const [id, p] of Object.entries(final)) write(path.join(OUT, `${id}.png`), p);

// ---------------------------------------------------------------- 3. transitions
const CLIPS = {
  'stand-sit': { from: 'stand', to: 'sit', frames: ['stand', 'K1', 'K2', 'K3', 'S'], holds: [0, 0.1, 0.11, 0.1, 0], blends: [0.16, 0.2, 0.2, 0.2] },
  'sit-sleep': { from: 'sit', to: 'sleep', frames: ['S', 'L1', 'L2', 'Z'], holds: [0, 0.2, 0.26, 0], blends: [0.32, 0.34, 0.38] },
};
const neckBow = (png) => measure(png).bow;
function headX(png, b) { // x centre of the top 150 rows (speech bubble anchor)
  let sx = 0, n = 0;
  for (let y = b.y0; y < Math.min(png.height, b.y0 + 150); y++) for (let x = b.x0; x <= b.x1; x++) if (png.data[(y * png.width + x) * 4 + 3] >= 128) { sx += x; n++; }
  return n ? sx / n : (b.x0 + b.x1) / 2;
}
const trDefs = {};
for (const [clip, c] of Object.entries(CLIPS)) {
  const imgs = c.frames.map((id) => final[id]);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const p of imgs) { const b = bounds(p, 8); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4); x1 = Math.min(W - 1, x1 + 4); y1 = Math.min(H - 1, y1 + 4);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const dir = path.join(CHAR, 'seq', 'tr2', clip);
  if (!argv.includes('--no-app')) fs.rmSync(dir, { recursive: true, force: true });
  const anchors = [], fb = [];
  imgs.forEach((p, i) => {
    const q = crop(p, x0, y0, cw, ch);
    if (!argv.includes('--no-app')) write(path.join(dir, `frame-${String(i).padStart(3, '0')}.png`), q);
    const bow = neckBow(p), b = bounds(p);
    anchors.push(bow ? [+(bow.x - x0).toFixed(1), +(bow.y - y0).toFixed(1)] : null);
    fb.push([b.x0 - x0, b.y0 - y0, b.x1 - x0, b.y1 - y0, Math.round(headX(p, b) - x0)]);
  });
  const duration = +(c.holds.reduce((a, b) => a + b, 0) + c.blends.reduce((a, b) => a + b, 0)).toFixed(3);
  trDefs[clip] = {
    path: `seq/tr2/${clip}/frame-{i}.png`, frames: imgs.length, width: cw, height: ch, baseline: G - y0, originX: CX - x0,
    scale: +(1 / S).toFixed(4), duration, from: c.from, to: c.to, preMirrored: false, internal: false, gaitFrom: null,
    keys: { holds: c.holds, blends: c.blends, anchors }, crop: [0, 0, cw, ch], bounds: fb,
    source: `art/sit-kit (${c.frames.map((id) => PICK[id] || 'standing art').join(', ')})`,
  };
  console.log(`${clip}: ${imgs.length} keys, ${cw}x${ch}, ${duration}s, anchors ${JSON.stringify(anchors)}`);
}

// ---------------------------------------------------------------- 4. rigs
const OLD_RIGS = path.join(KIT, 'old-rigs');
const HANDOFF = path.resolve(APP, '..', 'Meihua-Asset-Handoff-20261109', '01_Production', 'poses');
/** Nearest-label fill: unlabelled opaque pixels take the label of the nearest labelled one (multi-source BFS). */
function fillLabels(lab, alpha, w, h) {
  const q = new Int32Array(w * h); let qh = 0, qt = 0;
  for (let i = 0; i < w * h; i++) if (lab[i] >= 0) q[qt++] = i;
  while (qh < qt) {
    const p = q[qh++], x = p % w, y = (p / w) | 0;
    for (const t of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (t >= 0 && lab[t] < 0 && alpha[t] > 0) { lab[t] = lab[p]; q[qt++] = t; }
    }
  }
}
function buildRig(rigId, newGuide, { recutEyes }) {
  const base = BASE[rigId], dir = path.join(CHAR, 'rigs', rigId), backup = path.join(OLD_RIGS, rigId);
  if (!fs.existsSync(backup)) { fs.cpSync(dir, backup, { recursive: true }); console.log(`${rigId}: old rig kept in ${path.relative(APP, backup)}`); }
  const rig = JSON.parse(fs.readFileSync(path.join(backup, 'rig.json'), 'utf8'));
  const N = toRig(rigId, newGuide), w = N.width, h = N.height;
  const old = read(path.join(HANDOFF, `${rigId}.png`));
  // global alignment old -> new (scale about the ground point, shift), by silhouette IoU
  const oc = [base.originX, base.baseline];
  const am = (p) => { const m = new Float32Array(w * h); for (let i = 0; i < w * h; i++) m[i] = p.data[i * 4 + 3] / 255; return m; };
  const mo = am(old), mn = am(N);
  const iou = (s, dx, dy) => {
    let I = 0, U = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const ox = Math.round((x - oc[0] - dx) / s + oc[0]), oy = Math.round((y - oc[1] - dy) / s + oc[1]);
      const a = ox >= 0 && oy >= 0 && ox < w && oy < h ? mo[oy * w + ox] : 0, b = mn[y * w + x];
      I += Math.min(a, b); U += Math.max(a, b);
    }
    return U ? I / U : 0;
  };
  let T = { s: 1, dx: 0, dy: 0, v: iou(1, 0, 0) };
  const v0 = T.v;
  for (const st of [{ s: 0.02, d: 4, r: [0.9, 1.1], R: 16 }, { s: 0.005, d: 1, rel: true, r: [-0.02, 0.02], R: 4 }]) {
    const c = { ...T };
    for (let s = st.r[0]; s <= st.r[1] + 1e-9; s += st.s) for (let dx = -st.R; dx <= st.R; dx += st.d) for (let dy = -st.R; dy <= st.R; dy += st.d) {
      const S_ = st.rel ? c.s + s : s, X = st.rel ? c.dx + dx : dx, Y = st.rel ? c.dy + dy : dy;
      const v = iou(S_, X, Y);
      if (v > T.v) T = { s: S_, dx: X, dy: Y, v };
    }
  }
  console.log(`${rigId}: silhouette old->new  scale ${T.s.toFixed(3)} shift ${T.dx},${T.dy}  IoU ${v0.toFixed(3)} -> ${T.v.toFixed(3)}`);
  const fwd = (x, y) => [(x - oc[0]) * T.s + oc[0] + T.dx, (y - oc[1]) * T.s + oc[1] + T.dy];
  const inv = [1 / T.s, 0, 0, 1 / T.s, oc[0] - (oc[0] + T.dx) / T.s, oc[1] - (oc[1] + T.dy) / T.s]; // new px -> old px
  // old label map (topmost visible layer), warped into the new drawing
  const layers = rig.layers;
  const idx = new Map(layers.map((l, i) => [l.id, i]));
  const oldLab = new Int32Array(w * h).fill(-1);
  for (const pass of [128, 24]) for (const l of layers) {
    if (!l.visible) continue;
    const p = read(path.join(backup, l.visible.src)), li = idx.get(l.id);
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      const a = p.data[(y * p.width + x) * 4 + 3], X = x + l.visible.x, Y = y + l.visible.y;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      if (pass === 128 ? a >= 128 : a >= 24 && oldLab[Y * w + X] < 0) oldLab[Y * w + X] = li;
    }
  }
  const lab = new Int32Array(w * h).fill(-1), alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; alpha[i] = N.data[i * 4 + 3];
    if (!alpha[i]) continue;
    const ox = Math.round(inv[0] * (x + 0.5) + inv[4] - 0.5), oy = Math.round(inv[3] * (y + 0.5) + inv[5] - 0.5);
    if (ox >= 0 && oy >= 0 && ox < w && oy < h) lab[i] = oldLab[oy * w + ox];
  }
  fillLabels(lab, alpha, w, h);
  // eyes re-cut around the new irises (the redrawn eyes are smaller and sit a little differently)
  const irises = {};
  if (recutEyes) for (const side of ['eye-left', 'eye-right']) {
    const l = layers[idx.get(side)];
    if (!l?.visible) continue;
    const [cx, cy] = fwd(l.visible.x + l.visible.width / 2, l.visible.y + l.visible.height / 2);
    const R = Math.max(l.visible.width, l.visible.height) * 0.9;
    const rx0 = Math.max(0, Math.round(cx - R)), ry0 = Math.max(0, Math.round(cy - R));
    const ir = findIris(crop(N, rx0, ry0, Math.round(2 * R), Math.round(2 * R)), rx0, ry0);
    if (!ir) { console.warn(`${rigId}: ${side} iris not found, eye kept as transferred`); continue; }
    const ex = Math.max(ir.rx * 1.9, 6), ey = Math.max(ir.ry * 1.55, 6), ecy = ir.cy - ir.ry * 0.15;
    const li = idx.get(side);
    const OVER = new Set(['head', 'bangs', 'eye-left', 'eye-right', 'hair-front-left', 'hair-front-right'].map((id) => idx.get(id)));
    for (let y = Math.floor(ecy - ey); y <= Math.ceil(ecy + ey); y++) for (let x = Math.floor(ir.cx - ex); x <= Math.ceil(ir.cx + ex); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (alpha[i] && ((x - ir.cx) / ex) ** 2 + ((y - ecy) / ey) ** 2 <= 1 && OVER.has(lab[i])) lab[i] = li;
    }
    const { n, ...keep } = ir; irises[side] = keep;
    console.log(`${rigId}: ${side} iris ${JSON.stringify(keep)}`);
  }
  // write the pieces
  const out = { ...rig, layers: [], source: `art/sit-kit ${rigId === 'sit' ? PICK.S : PICK.Z} (re-cut with scripts/sit-build.mjs)` };
  const dilated = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; for (let dy = -2; dy <= 2 && !m; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && alpha[Y * w + X] > 8) { m = 1; break; } }
    dilated[y * w + x] = m;
  }
  if (!argv.includes('--no-app')) for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) fs.rmSync(path.join(dir, f));
  const rest = blank(w, h);
  layers.forEach((l, li) => {
    const nl = { ...l, pivot: l.pivot ? fwd(l.pivot[0], l.pivot[1]).map((v) => +v.toFixed(1)) : l.pivot };
    // visible piece
    let bx0 = w, by0 = h, bx1 = -1, by1 = -1, n = 0;
    for (let i = 0; i < w * h; i++) if (lab[i] === li) { const x = i % w, y = (i / w) | 0; bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); n++; }
    if (n && l.visible) {
      const pw = bx1 - bx0 + 1, ph = by1 - by0 + 1, p = blank(pw, ph);
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const i = y * w + x; if (lab[i] !== li) continue;
        const j = ((y - by0) * pw + x - bx0) * 4; for (let c = 0; c < 4; c++) p.data[j + c] = N.data[i * 4 + c];
      }
      nl.visible = { src: l.visible.src, x: bx0, y: by0, width: pw, height: ph };
      nl.visiblePixels = n;
      if (!argv.includes('--no-app')) write(path.join(dir, l.visible.src), p);
      const full = blank(w, h); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const j = (y * pw + x) * 4, i = ((y + by0) * w + x + bx0) * 4; for (let c = 0; c < 4; c++) full.data[i + c] = p.data[j + c]; }
      over(rest, full);
    } else if (l.visible) { nl.visible = null; nl.visiblePixels = 0; }
    // hidden underpaint: the old completion moved with the drawing, clipped to the new silhouette
    if (l.hidden) {
      const hp = read(path.join(backup, l.hidden.src));
      const [hx, hy] = fwd(l.hidden.x, l.hidden.y);
      const hw = Math.ceil(l.hidden.width * T.s) + 2, hh = Math.ceil(l.hidden.height * T.s) + 2;
      const X0 = Math.floor(hx), Y0 = Math.floor(hy);
      const q = warpAffine(hp, [1 / T.s, 0, 0, 1 / T.s, (X0 - hx) / T.s, (Y0 - hy) / T.s], hw, hh);
      let m = 0;
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
        const X = X0 + x, Y = Y0 + y, j = (y * hw + x) * 4;
        if (X < 0 || Y < 0 || X >= w || Y >= h || !dilated[Y * w + X]) q.data[j + 3] = 0; else if (q.data[j + 3]) m++;
      }
      nl.hidden = { src: l.hidden.src, x: X0, y: Y0, width: hw, height: hh };
      nl.hiddenPixels = m;
      if (!argv.includes('--no-app')) write(path.join(dir, l.hidden.src), q);
    }
    out.layers.push(nl);
  });
  if (rig.anchor) out.anchor = Array.isArray(rig.anchor) ? fwd(...rig.anchor).map(Math.round) : { x: Math.round(fwd(rig.anchor.x, rig.anchor.y)[0]), y: Math.round(fwd(rig.anchor.x, rig.anchor.y)[1]) };
  const b = bounds(N, 8); out.bounds = rig.bounds && !Array.isArray(rig.bounds) ? { x: b.x0, y: b.y0, width: b.x1 - b.x0 + 1, height: b.y1 - b.y0 + 1 } : [b.x0, b.y0, b.x1 + 1, b.y1 + 1];
  if (Object.keys(irises).length) out.irises = irises; else delete out.irises;
  delete out.irisByPiece;
  if (!argv.includes('--no-app')) fs.writeFileSync(path.join(dir, 'rig.json'), JSON.stringify(out, null, 2) + '\n');
  write(path.join(OUT, `rig-${rigId}-rest.png`), rest);
  write(path.join(OUT, `rig-${rigId}-new.png`), N);
  // the label map as a colour image (review)
  const lm = blank(w, h);
  for (let i = 0; i < w * h; i++) if (lab[i] >= 0) { const hue = (lab[i] * 137.5) % 360, c = (k) => { const t = (k + hue / 30) % 12; return 255 * (0.55 - 0.45 * Math.max(-1, Math.min(t - 3, 9 - t, 1))); }; lm.data[i * 4] = c(0); lm.data[i * 4 + 1] = c(8); lm.data[i * 4 + 2] = c(4); lm.data[i * 4 + 3] = 255; }
  write(path.join(OUT, `rig-${rigId}-labels.png`), lm);
  return { T, fwd };
}
const sitFix = buildRig('sit', grounded.S, { recutEyes: true });
const sleepFix = buildRig('sleep', grounded.Z, { recutEyes: false });

// ---------------------------------------------------------------- 5. manifest
if (!argv.includes('--no-app')) {
  const m = JSON.parse(fs.readFileSync(path.join(CHAR, 'manifest.json'), 'utf8'));
  const oldTr = path.join(KIT, 'old-tr');
  for (const id of Object.keys(m.transitions || {})) {
    const src = path.join(CHAR, path.dirname(m.transitions[id].path));
    if (fs.existsSync(src) && src.includes(`${path.sep}tr${path.sep}`)) { fs.mkdirSync(oldTr, { recursive: true }); fs.renameSync(src, path.join(oldTr, id)); console.log(`old transition ${id} moved to ${path.relative(APP, path.join(oldTr, id))}`); }
  }
  const trRoot = path.join(CHAR, 'seq', 'tr');
  if (fs.existsSync(trRoot) && !fs.readdirSync(trRoot).length) fs.rmdirSync(trRoot);
  m.transitions = trDefs;
  m.rigs.sit.scale = +(BASE.sit.scale * SCALE.S).toFixed(4);
  m.rigs.sleep.scale = +(BASE.sleep.scale * SCALE.Z).toFixed(4);
  m.scales.sit = m.rigs.sit.scale; m.scales.sleep = m.rigs.sleep.scale; m.scales.tr = +(1 / S).toFixed(4);
  // the touch areas (manifest parts) are authored on the rig grid; the redraw kept the silhouette, so they still fit
  for (const [rigId, fix] of [['sit', sitFix], ['sleep', sleepFix]]) {
    if (Math.abs(fix.T.s - 1) > 0.02 || Math.hypot(fix.T.dx, fix.T.dy) > 4) console.warn(`${rigId}: the drawing moved against the old rig — check manifest.parts.${rigId}`);
  }
  m.generated = new Date().toISOString();
  fs.writeFileSync(path.join(CHAR, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  console.log(`manifest: sit scale ${m.rigs.sit.scale}, sleep scale ${m.rigs.sleep.scale}, transitions ${Object.keys(trDefs).join(', ')}`);
}

// ---------------------------------------------------------------- review sheets
for (const [clip, c] of Object.entries(CLIPS)) {
  const imgs = c.frames.map((id) => final[id]);
  const sc = 0.32, tw = Math.round(W * sc), th = Math.round(H * sc), sheet = blank(imgs.length * tw, th);
  imgs.forEach((p, k) => {
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const i = (Math.floor(y / sc) * W + Math.floor(x / sc)) * 4, j = (y * sheet.width + k * tw + x) * 4, a = p.data[i + 3] / 255;
      const bg = ((x >> 3) + (y >> 3)) & 1 ? 225 : 245;
      for (let ch = 0; ch < 3; ch++) sheet.data[j + ch] = p.data[i + ch] * a + bg * (1 - a);
      if (Math.abs(y / sc - G) < 1.6 / sc) { sheet.data[j] = 255; sheet.data[j + 1] = 60; sheet.data[j + 2] = 60; }
      sheet.data[j + 3] = 255;
    }
  });
  write(path.join(OUT, `sheet-${clip}.png`), sheet);
}
console.log('review sheets ->', path.relative(APP, OUT));
