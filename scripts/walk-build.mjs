// Builds the walk cycle from the hand-drawn frames in art/walk-kit:
//   1. chroma-key the flat #00FF00 masters (edge colours un-premultiplied, green spill removed, specks dropped)
//   2. register every frame to refs/walk-base.png by its head (one shared scale, per-frame offset), feet on the
//      ground line, then a small per-frame rescale about the feet fits the head bob to the guide's pelvis curve
//      and the colours are matched to the original standing art (see "colour match")
//   3. measure how far the planted foot moves back per frame (= per-frame root motion)
//   3b. the start/stop turn (out/4-turn/T1, T2 + the walk model), see "start/stop turn"
//   4. write the app sequences (walk-right + mirrored walk-left, turn-right/-left) and patch assets/character/manifest.json
//
//   node scripts/walk-build.mjs            -> uses all 16 frames if present, otherwise the 8 keys (preview)
//   node scripts/walk-build.mjs --keys     -> force the 8-key preview
//   node scripts/walk-build.mjs --no-turn  -> leave the turn out (the app then cross-fades stand <-> walk)
//   node scripts/walk-build.mjs --no-app   -> only process + review images
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '..');
const KIT = path.join(APP, 'art', 'walk-kit');
const OUT = path.join(KIT, 'processed');
const CHAR = path.join(APP, 'assets', 'character');
const argv = process.argv.slice(2);

const W = 1024, H = 1536, G = 1480, CX = 512, S = 1.45; // guide space (see scripts/walk-guides)
const DURATION = 1.12; // seconds per full cycle (two steps)
const STAND_FACE_OFFSET = 240 - 254; // stand face x minus stand originX (native px)

const read = (p) => PNG.sync.read(fs.readFileSync(p));
const write = (p, png) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, PNG.sync.write(png, { colorType: 6 })); };
const blank = (w, h) => { const p = new PNG({ width: w, height: h }); p.data.fill(0); return p; };
const tag = (i) => `W${String(i).padStart(2, '0')}`;

// ---------------------------------------------------------------- 1. key
function key(src) {
  const { width, height, data } = src;
  // background colour = median of the outer border
  const border = [];
  for (let x = 0; x < width; x += 4) for (const y of [2, height - 3]) border.push((y * width + x) * 4);
  for (let y = 0; y < height; y += 4) for (const x of [2, width - 3]) border.push((y * width + x) * 4);
  const med = (c) => { const v = border.map((i) => data[i + c]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  const out = blank(width, height), o = out.data;
  const D_OPAQUE = 14, D_CLEAR = 226;
  for (let i = 0; i < width * height * 4; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const d = g - Math.max(r, b);
    let a = d <= D_OPAQUE ? 1 : d >= D_CLEAR ? 0 : (D_CLEAR - d) / (D_CLEAR - D_OPAQUE);
    if (a < 0.04) { a = 0; continue; }
    // un-premultiply against the background, then clamp spill
    let R = (r - (1 - a) * bg[0]) / a, Gc = (g - (1 - a) * bg[1]) / a, B = (b - (1 - a) * bg[2]) / a;
    R = Math.max(0, Math.min(255, R)); B = Math.max(0, Math.min(255, B)); Gc = Math.max(0, Math.min(255, Gc));
    Gc = Math.min(Gc, Math.max(R, B) + 4);
    o[i] = R; o[i + 1] = Gc; o[i + 2] = B; o[i + 3] = Math.round(a * 255);
  }
  dropSpecks(out);
  return { png: out, bg };
}

/** Remove small islands that are not part of the figure. */
function dropSpecks(png, minArea = 260) {
  const { width, height, data } = png;
  const lab = new Int32Array(width * height).fill(-1);
  const stack = [];
  for (let s = 0; s < width * height; s++) {
    if (lab[s] !== -1 || data[s * 4 + 3] < 40) continue;
    const pix = []; lab[s] = s; stack.push(s);
    while (stack.length) {
      const p = stack.pop(); pix.push(p);
      const x = p % width, y = (p / width) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q >= 0 && lab[q] === -1 && data[q * 4 + 3] >= 40) { lab[q] = s; stack.push(q); }
      }
    }
    if (pix.length < minArea) for (const p of pix) data[p * 4 + 3] = 0;
  }
  // faint haze not touching anything solid
  for (let p = 0; p < width * height; p++) if (data[p * 4 + 3] > 0 && data[p * 4 + 3] < 40) {
    const x = p % width, y = (p / width) | 0;
    let near = false;
    for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height && lab[yy * width + xx] !== -1 && data[(yy * width + xx) * 4 + 3] >= 40) { near = true; break; }
    }
    if (!near) data[p * 4 + 3] = 0;
  }
}

// ---------------------------------------------------------------- colour match
// The generated drawings come out warmer, pinker and more saturated than the original standing art that the pet
// shows whenever it stops (refs/ich01A_101.png): white hair and stockings get a pink cast and lose their grey
// shading. Monotone curves, fitted by quantile matching, move the frames' lightness (L*) and chroma (C*) onto the
// standing art's; hue only turns a little for weak colours, so no colour can turn into a different one, and monotone
// curves keep every shading step in order. The stages, each fitted against the standing art:
//   base     whole figure, chroma per lightness band
//   classes  neutral (hair, stockings, blouse) and coloured (skirt, skin, bows) neighbourhoods separately
//   rim      the anti-aliased outline
//   display  per frame, at the size the pet is shown (also evens out the frames' individual casts)
// `node scripts/walk-build.mjs --no-colour` skips all of it.
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i));
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
function toLab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const fx = fLab((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), fy = fLab(0.2126 * R + 0.7152 * G + 0.0722 * B), fz = fLab((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function fromLab(L, a, b) {
  const fy = (L + 16) / 116, X = 0.95047 * fInv(fy + a / 500), Y = fInv(fy), Z = 1.08883 * fInv(fy - b / 200);
  const c = (v) => Math.max(0, Math.min(255, Math.round(gam(Math.max(0, v)))));
  return [c(3.2406 * X - 1.5372 * Y - 0.4986 * Z), c(-0.9689 * X + 1.8758 * Y + 0.0415 * Z), c(0.0557 * X - 0.204 * Y + 1.057 * Z)];
}
/** Monotone curve (lookup over [0, max] in `step`s) taking the distribution of `src` onto that of `dst`. */
function quantileCurve(src, dst, max, step) {
  const s = Float64Array.from(src).sort(), d = Float64Array.from(dst).sort(), n = Math.round(max / step) + 1;
  const cdf = (v) => { // mid-rank empirical CDF of the source
    let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; }
    let up = lo; while (up < s.length && s[up] === v) up++;
    return Math.min(1, Math.max(0, ((lo + up) / 2) / s.length));
  };
  const q = (u) => { const t = u * (d.length - 1), i = Math.floor(t); return i >= d.length - 1 ? d[d.length - 1] : d[i] + (d[i + 1] - d[i]) * (t - i); };
  const raw = Float64Array.from({ length: n }, (_, k) => q(cdf(k * step)) - k * step);
  const W = Math.round(1.5 / step), out = new Float32Array(n); // smooth the offset, then force monotone
  for (let k = 0; k < n; k++) { let a = 0, c = 0; for (let j = Math.max(0, k - W); j <= Math.min(n - 1, k + W); j++) { a += raw[j]; c++; } out[k] = Math.max(0, k * step + a / c); }
  for (let k = 1; k < n; k++) out[k] = Math.max(out[k], out[k - 1]);
  return { step, lut: out, at: (v) => { const t = Math.min(n - 1, Math.max(0, v / step)), i = Math.floor(t); return i >= n - 1 ? out[n - 1] : out[i] + (out[i + 1] - out[i]) * (t - i); } };
}
// Matching over the whole figure is not enough, for two reasons:
//  - In the standing art the soft greys of the hair and stockings sit at the same lightness as the pink skirt
//    shading, while the walk frames give that whole level one even, mild pink. So the chroma curve is fitted per
//    lightness band (windows L* ±BAND_HALF, BAND_STEP apart, interpolated in between): within a band the least
//    coloured pixels go grey and the most coloured go pinker, in their original order.
//  - The walk frames draw the lines and shadows inside white hair, stockings and blouse in pink, where the standing
//    art uses warm grey. At pet size (about a quarter of the drawing) those lines blend into the white around them
//    and the whole figure reads pink. A pixel-by-pixel curve cannot tell such a line from the skirt, so every pixel
//    is classed by its neighbourhood: the mean colour within CTX_R px (standing-art scale) is near-neutral in hair,
//    stockings and blouse and clearly coloured on skirt, skin and bows. Each class gets its own curves, fitted
//    against the same class in the standing art, and pixels near a boundary blend the two.
// Finally the hue of weakly coloured pixels is turned by the difference of the mean hue per chroma band (at most
// 20 degrees, fading out by chroma 40 so skirt, bows and eyes keep their hue).
const HUE_BIN = 2, HUE_FADE = [30, 40], HUE_MAX = 20 * Math.PI / 180;
const BAND_STEP = 2.5, BAND_HALF = 2.5, BAND_MIN = 400, C_GAIN_MAX = 3;
const CTX_R = 10, CTX_T = [4, 9]; // neighbourhood chroma <= 4: neutral class, >= 9: coloured class

function labPlanes(png) {
  const n = png.width * png.height, d = png.data;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) if (d[i * 4 + 3]) { const v = toLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); L[i] = v[0]; A[i] = v[1]; B[i] = v[2]; }
  return { L, A, B };
}
/** Per pixel weight of the neutral class from the mean a*, b* of the opaque pixels within r px. */
function neutralWeight(png, lab, r) {
  const { width: w, height: h, data: d } = png, W1 = w + 1;
  const sa = new Float64Array(W1 * (h + 1)), sb = new Float64Array(W1 * (h + 1)), sn = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = (y + 1) * W1 + x + 1, m = d[i * 4 + 3] >= 128 ? 1 : 0;
    sa[o] = m * lab.A[i] + sa[o - 1] + sa[o - W1] - sa[o - W1 - 1];
    sb[o] = m * lab.B[i] + sb[o - 1] + sb[o - W1] - sb[o - W1 - 1];
    sn[o] = m + sn[o - 1] + sn[o - W1] - sn[o - W1 - 1];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r) * W1, y1 = Math.min(h, y + r + 1) * W1;
    for (let x = 0; x < w; x++) {
      if (!d[(y * w + x) * 4 + 3]) continue;
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), box = (s) => s[y1 + x1] - s[y0 + x1] - s[y1 + x0] + s[y0 + x0];
      const n = box(sn), c = n ? Math.hypot(box(sa), box(sb)) / n : CTX_T[1];
      out[y * w + x] = Math.max(0, Math.min(1, (CTX_T[1] - c) / (CTX_T[1] - CTX_T[0])));
    }
  }
  return out;
}
/** Curves taking one class of the walk frames onto the same class of the standing art. */
function fitClass(src, tgt) {
  const cm = { L: quantileCurve(src.map((v) => v[0]), tgt.map((v) => v[0]), 100, 0.1) };
  const SL = src.map((v) => cm.L.at(v[0])), SC = src.map((v) => Math.hypot(v[1], v[2])), TC = tgt.map((v) => Math.hypot(v[1], v[2]));
  const global = quantileCurve(SC, TC, 140, 0.1);
  cm.bands = [];
  for (let c = 0; c <= 100; c += BAND_STEP) {
    const s = SC.filter((_, i) => Math.abs(SL[i] - c) <= BAND_HALF), t = TC.filter((_, i) => Math.abs(tgt[i][0] - c) <= BAND_HALF);
    cm.bands.push(s.length >= BAND_MIN && t.length >= BAND_MIN ? quantileCurve(s, t, 140, 0.1) : global);
  }
  cm.C = { at: (c, l) => { // chroma curve at lightness l (already mapped). The frames are more saturated than the
    // standing art at nearly every lightness, so a curve may add at most C_GAIN_MAX (guards the sparse ends of a band)
    const t = Math.max(0, Math.min(cm.bands.length - 1, l / BAND_STEP)), i = Math.floor(t), j = Math.min(cm.bands.length - 1, i + 1), f = t - i;
    const v = cm.bands[i].at(c) * (1 - f) + cm.bands[j].at(c) * f;
    return v > c ? Math.min(v, c + C_GAIN_MAX) : v;
  } };
  // mean hue per chroma band: target vs curve-mapped source
  const nb = Math.ceil(HUE_FADE[1] / HUE_BIN), acc = (arr, map) => {
    const s = Array.from({ length: nb }, () => [0, 0, 0]);
    arr.forEach(([, a, b], i) => { const c0 = Math.hypot(a, b), c = map ? cm.C.at(c0, SL[i]) : c0, k = Math.floor(c / HUE_BIN); if (k < nb) { s[k][0] += a; s[k][1] += b; s[k][2]++; } });
    return s;
  };
  const sb = acc(src, true), tb = acc(tgt, false);
  const raw = sb.map((s, k) => (s[2] > 200 && tb[k][2] > 200 ? Math.atan2(tb[k][1], tb[k][0]) - Math.atan2(s[1], s[0]) : 0)).map((d) => Math.atan2(Math.sin(d), Math.cos(d)));
  const hue = raw.map((_, k) => { let a = 0, c = 0; for (let j = Math.max(0, k - 1); j <= Math.min(nb - 1, k + 1); j++) { a += raw[j]; c++; } return Math.max(-HUE_MAX, Math.min(HUE_MAX, a / c)); });
  cm.hue = (c) => { const t = c / HUE_BIN - 0.5, i = Math.max(0, Math.min(nb - 1, Math.floor(t))), j = Math.min(nb - 1, i + 1), f = Math.max(0, Math.min(1, t - i));
    const fade = c <= HUE_FADE[0] ? 1 : c >= HUE_FADE[1] ? 0 : (HUE_FADE[1] - c) / (HUE_FADE[1] - HUE_FADE[0]);
    return (hue[i] * (1 - f) + hue[j] * f) * fade; };
  cm.map = (L, a, b) => {
    const C = Math.hypot(a, b), L2 = cm.L.at(L);
    if (C <= 1e-6) return [L2, a, b];
    const C2 = cm.C.at(C, L2), h = Math.atan2(b, a) + cm.hue(C2);
    return [L2, C2 * Math.cos(h), C2 * Math.sin(h)];
  };
  return cm;
}
function mapPlanes(lab, cm) {
  for (let i = 0; i < lab.L.length; i++) { const v = cm.map(lab.L[i], lab.A[i], lab.B[i]); lab.L[i] = v[0]; lab.A[i] = v[1]; lab.B[i] = v[2]; }
  return lab;
}
// The raw frames are too pink for the neighbourhood test (their hair would count as coloured), so the classes are
// taken after a first, whole-figure match (`base`), and the class curves continue from there.
function fitColourMatch(sources, target) {
  const sample = (png, lab, every, out, w) => { for (let i = 0; i < lab.L.length; i += every) if (png.data[i * 4 + 3] >= 250) (w ? out[w[i] >= 0.5 ? 0 : 1] : out).push([lab.L[i], lab.A[i], lab.B[i]]); };
  const r = Math.round(CTX_R * S), tLab = labPlanes(target), tgtAll = [], tgt = [[], []], srcAll = [], src = [[], []];
  sample(target, tLab, 1, tgtAll);
  sample(target, tLab, 1, tgt, neutralWeight(target, tLab, CTX_R));
  for (const p of sources) sample(p, labPlanes(p), 5, srcAll);
  const base = fitClass(srcAll, tgtAll);
  sources.forEach((p, k) => {
    const lab = mapPlanes(labPlanes(p), base), w = neutralWeight(p, lab, r);
    sample(p, lab, 5, src, w);
    if (process.env.CM_MASK && k === 4) for (const [name, png, ww] of [['mask-stand', target, neutralWeight(target, tLab, CTX_R)], ['mask-W04', p, w]]) { // neutral weight as grey
      const m = blank(png.width, png.height);
      for (let i = 0; i < ww.length; i++) if (png.data[i * 4 + 3]) { m.data.fill(Math.round(ww[i] * 255), i * 4, i * 4 + 3); m.data[i * 4 + 3] = 255; }
      write(path.join(OUT, `${name}.png`), m);
    }
  });
  const share = (c) => (100 * c[0].length / (c[0].length + c[1].length)).toFixed(0);
  const cm = { r, base, share: [share(src), share(tgt)], classes: [fitClass(src[0], tgt[0]), fitClass(src[1], tgt[1])] };
  // The outline. The standing art's line runs along the silhouette, so its anti-aliased edge pixels are dark (median
  // L* ~71) while the frames' are light (L* ~86-93): the walking figure melts into a light desktop and glows faintly
  // on a dark one. The semi-transparent edge pixels are matched to the standing art's own (the solid pixels just
  // inside already agree: L* ~92 in both).
  const rimSample = (png, lab, out) => { for (let i = 0; i < lab.L.length; i++) { const a = png.data[i * 4 + 3]; if (a > 20 && a < 250) out.push([lab.L[i], lab.A[i], lab.B[i]]); } };
  const rimSrc = [], rimTgt = [];
  rimSample(target, tLab, rimTgt);
  for (const p of sources) { const q = applyColourMatch(clonePng(p), cm, { display: false }); rimSample(q, labPlanes(q), rimSrc); }
  cm.rim = fitClass(rimSrc, rimTgt);
  // Last, a correction fitted at pet size and per frame. At pet size the thin lines blend into the fills around them,
  // so each frame is compared as the pet shows it (standing art at DISPLAY of native size, frames at DISPLAY / S).
  // Per frame, because every drawing came out with its own slight cast (some pinker, some greyer than the standing
  // art), which would also flicker while she walks.
  const dt = boxDown(target, DISPLAY);
  cm.displayTarget = [];
  sample(dt, labPlanes(dt), 1, cm.displayTarget);
  cm.sample = sample;
  return cm;
}
const DISPLAY = 0.36; // default on-screen size of the standing art (renderer assets.displayScale)
function clonePng(p) { const q = blank(p.width, p.height); q.data.set(p.data); return q; }
/** Area-average downscale (alpha-weighted colour). */
function boxDown(p, f) {
  const w = Math.max(1, Math.round(p.width * f)), h = Math.max(1, Math.round(p.height * f)), q = blank(w, h), s = p.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x / f), x1 = Math.min(p.width, Math.max(x0 + 1, Math.floor((x + 1) / f))), y0 = Math.floor(y / f), y1 = Math.min(p.height, Math.max(y0 + 1, Math.floor((y + 1) / f)));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * p.width + xx) * 4, al = s[i + 3]; r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; n++; }
    const o = (y * w + x) * 4;
    if (a) { q.data[o] = Math.round(r / a); q.data[o + 1] = Math.round(g / a); q.data[o + 2] = Math.round(b / a); q.data[o + 3] = Math.round(a / n); }
  }
  return q;
}
function applyColourMatch(png, cm, { display = true } = {}) {
  const d = png.data, lab = mapPlanes(labPlanes(png), cm.base), w = neutralWeight(png, lab, cm.r), [neu, col] = cm.classes;
  for (let i = 0; i < w.length; i++) {
    if (!d[i * 4 + 3]) continue;
    const n = neu.map(lab.L[i], lab.A[i], lab.B[i]), c = col.map(lab.L[i], lab.A[i], lab.B[i]), k = w[i];
    lab.L[i] = n[0] * k + c[0] * (1 - k); lab.A[i] = n[1] * k + c[1] * (1 - k); lab.B[i] = n[2] * k + c[2] * (1 - k);
    const [r, g, b] = fromLab(lab.L[i], lab.A[i], lab.B[i]);
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b;
  }
  if (cm.rim) for (let i = 0; i < w.length; i++) { // anti-aliased outline
    if (!d[i * 4 + 3] || d[i * 4 + 3] >= 250) continue;
    const v = cm.rim.map(lab.L[i], lab.A[i], lab.B[i]);
    lab.L[i] = v[0]; lab.A[i] = v[1]; lab.B[i] = v[2];
    const [r, g, b] = fromLab(v[0], v[1], v[2]);
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b;
  }
  if (display && cm.displayTarget) { // this frame at pet size vs the standing art at pet size
    const q = boxDown(png, DISPLAY / S), src = [];
    cm.sample(q, labPlanes(q), 1, src);
    const fix = fitClass(src, cm.displayTarget);
    mapPlanes(lab, fix);
    for (let i = 0; i < w.length; i++) if (d[i * 4 + 3]) { const [r, g, b] = fromLab(lab.L[i], lab.A[i], lab.B[i]); d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; }
  }
  return png;
}

// ---------------------------------------------------------------- measuring
function bounds(png, th = 128) {
  const { width, height, data } = png;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= th) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
function maskAt(png, f) { // downsampled boolean mask (fraction of opaque pixels per f x f block)
  const w = Math.floor(png.width / f), h = Math.floor(png.height / f), m = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) s += png.data[(((y * f + yy) * png.width) + x * f + xx) * 4 + 3] >= 128 ? 1 : 0;
    m[y * w + x] = s / (f * f);
  }
  return { w, h, m, f };
}
const C0 = { x: CX, y: 320 }; // transform pivot (around the head)
/** Soft IoU between base region and frame sampled through T^-1 (frame -> base: s*(p-C0)+C0+d). */
function iou(base, frame, region, s, dx, dy) {
  const f = base.f;
  let inter = 0, uni = 0;
  for (let y = region.y0; y < region.y1; y++) for (let x = region.x0; x < region.x1; x++) {
    const bx = x * f + f / 2, by = y * f + f / 2;
    const fx = (bx - C0.x - dx) / s + C0.x, fy = (by - C0.y - dy) / s + C0.y;
    const ix = Math.floor(fx / f), iy = Math.floor(fy / f);
    const a = base.m[y * base.w + x];
    const b = ix >= 0 && iy >= 0 && ix < frame.w && iy < frame.h ? frame.m[iy * frame.w + ix] : 0;
    inter += Math.min(a, b); uni += Math.max(a, b);
  }
  return uni ? inter / uni : 0;
}
function alignHead(basePng, framePng, headRows, fixedS) {
  let best = { s: fixedS || 1, dx: 0, dy: 0, v: -1 };
  // with fixedS only the offset is searched: a head-only scale estimate is good to ~1 %,
  // which over a 1400 px body is ~15 px of fake bob, so all frames share one scale
  const passes = fixedS ? [
    { f: 8, s: [fixedS, fixedS, 1], d: [-64, 64, 8] },
    { f: 4, s: [0, 0, 1], d: [-10, 10, 2], rel: true },
    { f: 2, s: [0, 0, 1], d: [-3, 3, 1], rel: true },
  ] : [
    { f: 8, s: [0.93, 1.07, 0.01], d: [-64, 64, 8] },
    { f: 4, s: [-0.012, 0.012, 0.004], d: [-10, 10, 2], rel: true },
    { f: 2, s: [-0.004, 0.004, 0.002], d: [-3, 3, 1], rel: true },
  ];
  for (const ps of passes) {
    const bm = maskAt(basePng, ps.f), fm = maskAt(framePng, ps.f);
    const region = { x0: Math.floor(140 / ps.f), x1: Math.floor(900 / ps.f), y0: Math.floor(headRows[0] / ps.f), y1: Math.floor(headRows[1] / ps.f) };
    const c = { ...best };
    for (let s = ps.s[0]; s <= ps.s[1] + 1e-9; s += ps.s[2]) for (let dx = ps.d[0]; dx <= ps.d[1]; dx += ps.d[2]) for (let dy = ps.d[0]; dy <= ps.d[1]; dy += ps.d[2]) {
      const S_ = ps.rel ? c.s + s : s, X_ = ps.rel ? c.dx + dx : dx, Y_ = ps.rel ? c.dy + dy : dy;
      const v = iou(bm, fm, region, S_, X_, Y_);
      if (v > best.v) best = { s: S_, dx: X_, dy: Y_, v };
    }
  }
  return best;
}
/** Resample frame through frame->base transform (bilinear, premultiplied). */
function transform(png, s, dx, dy) {
  const { width, height, data } = png, out = blank(width, height), o = out.data;
  const px = (x, y, c) => (x < 0 || y < 0 || x >= width || y >= height) ? 0 : data[(y * width + x) * 4 + c];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const fx = (x - C0.x - dx) / s + C0.x - 0.5 + 0.5 / s, fy = (y - C0.y - dy) / s + C0.y - 0.5 + 0.5 / s;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    let A = 0, R = 0, Gc = 0, B = 0;
    for (const [xx, yy, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x0 + 1, y0, tx * (1 - ty)], [x0, y0 + 1, (1 - tx) * ty], [x0 + 1, y0 + 1, tx * ty]]) {
      const a = px(xx, yy, 3) * w; A += a; R += px(xx, yy, 0) * a; Gc += px(xx, yy, 1) * a; B += px(xx, yy, 2) * a;
    }
    const i = (y * width + x) * 4;
    if (A > 0.5) { o[i] = R / A; o[i + 1] = Gc / A; o[i + 2] = B / A; o[i + 3] = Math.min(255, Math.round(A)); }
  }
  return out;
}
const shiftY = (png, dy) => transform(png, 1, 0, dy);

/** Lowest solid row (ignores stray antialias). */
function groundRow(png) {
  const { width, height, data } = png;
  for (let y = height - 1; y >= 0; y--) { let n = 0; for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= 128) n++; if (n >= 6) return y; }
  return height - 1;
}
/** Feet touching the floor: column runs [x0, x1] with solid pixels in the bottom `band` rows, left to right. */
function floorRuns(png, band = 12) {
  const { width, data } = png, cols = new Uint8Array(width), runs = [];
  for (let y = G - band; y <= G; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= 128) cols[x] = 1;
  let s = null, gap = 0;
  for (let x = 0; x <= width; x++) {
    if (x < width && cols[x]) { if (s === null) s = x; gap = 0; continue; }
    if (s === null) continue;
    if (++gap > 3 || x === width) { const e = x - gap; if (e - s + 1 >= 6) runs.push([s, e]); s = null; gap = 0; }
  }
  return runs;
}
/**
 * How far the planted foot moves back from each frame to the next (sprite px) = the root motion that keeps it
 * fixed on the desktop. The near foot carries the weight over guide frames 0-8, the far foot over 8-16. With the
 * stance phase p = i % 8, the planted foot is the front-most floor run before passing (p < 4) and the rear-most
 * after it; its fixed point is the heel from heel strike to flat foot (p < 2), then the toe (the heel lifts later).
 */
function plantedSlides(frames) {
  const runs = frames.map((f) => floorRuns(f.png));
  const pick = (rs, q) => (q < 4 ? rs[rs.length - 1] : rs[0]);
  return frames.map((f, k) => {
    const k2 = (k + 1) % frames.length, p = f.i % 8, q = p + ((frames[k2].i - f.i + 16) % 16);
    if (!runs[k].length || !runs[k2].length) return null;
    const ref = p < 2 ? 0 : 1, a = pick(runs[k], p)[ref], b = pick(runs[k2], q)[ref];
    return { from: tag(f.i), to: tag(frames[k2].i), foot: f.i < 8 ? 'near' : 'far', point: ref ? 'toe' : 'heel', x0: a, x1: b, slide: a - b };
  });
}
/**
 * Root motion per frame. Moving exactly by each measured slide pins the planted foot but makes the body lurch
 * wherever a drawing's foot is a little off; a constant speed makes the foot skate. Least squares over
 * u = motion - slide balances the two: the planted foot's offset from its own mean position during each stance
 * (frames k0..k0+L, a free anchor per stance) plus `lambda` x the change of speed between frames (cyclic).
 */
function solveRootMotion(slides, lambda = 1) {
  const n = slides.length, L = n / 2, nv = n + 2, rows = [], w = Math.sqrt(lambda);
  for (let s = 0; s < 2; s++) for (let j = 0; j <= L; j++) {
    const r = new Array(nv).fill(0); for (let k = s * L; k < s * L + j; k++) r[k] = 1; r[n + s] = -1; rows.push([r, 0]);
  }
  for (let k = 0; k < n; k++) {
    const r = new Array(nv).fill(0), p = (k + n - 1) % n; r[k] += w; r[p] -= w; rows.push([r, -w * (slides[k] - slides[p])]);
  }
  const M = Array.from({ length: nv }, () => new Array(nv + 1).fill(0)); // normal equations, Gauss-Jordan
  for (const [r, b] of rows) for (let i = 0; i < nv; i++) if (r[i]) { for (let j = 0; j < nv; j++) M[i][j] += r[i] * r[j]; M[i][nv] += r[i] * b; }
  for (let c = 0; c < nv; c++) {
    let p = c; for (let i = c + 1; i < nv; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    [M[c], M[p]] = [M[p], M[c]];
    for (let i = 0; i < nv; i++) if (i !== c) { const f = M[i][c] / M[c][c]; for (let j = c; j <= nv; j++) M[i][j] -= f * M[c][j]; }
  }
  const x = M.map((row, i) => row[nv] / row[i]), motion = slides.map((d, k) => d + x[k]);
  let footDev = 0;
  for (let s = 0; s < 2; s++) { let c = 0; for (let j = 0; j <= L; j++) { footDev = Math.max(footDev, Math.abs(c - x[n + s])); if (j < L) c += x[s * L + j]; } }
  const speedStep = Math.max(...motion.map((v, k) => Math.abs(v - motion[(k + n - 1) % n])));
  return { motion, footDev, speedStep };
}
function eyeCentre(png) { // centroid of dark violet pixels in the face band
  const { width, data } = png;
  let sx = 0, sy = 0, n = 0;
  for (let y = 240; y < 400; y++) for (let x = 380; x < 760; x++) {
    const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    if (data[i + 3] > 200 && b > g + 25 && r > g && r + g + b < 420) { sx += x; sy += y; n++; }
  }
  return n ? { x: sx / n, y: sy / n, n } : null;
}

// ---------------------------------------------------------------- main
const keysOnly = argv.includes('--keys');
const have = (i) => fs.existsSync(path.join(KIT, 'out', i % 2 ? '3-inbetweens' : '2-keys', `${tag(i)}.png`));
const all16 = !keysOnly && Array.from({ length: 16 }, (_, i) => i).every(have);
const ids = all16 ? Array.from({ length: 16 }, (_, i) => i) : [0, 2, 4, 6, 8, 10, 12, 14];
console.log(`walk-build: ${ids.length} frames (${all16 ? 'full cycle' : 'key preview'})`);

const base = key(read(path.join(KIT, 'refs', 'walk-base.png'))).png;
const bb = bounds(base);
const headRows = [Math.max(0, bb.y0 - 16), bb.y0 + 400];
const eye = eyeCentre(base);
console.log('base bounds', bb, 'eyes', eye && { x: Math.round(eye.x), y: Math.round(eye.y), n: eye.n });

const frames = [];
const report = [];
const freeScale = argv.includes('--free-scale');
const keyedAll = ids.map((i) => key(read(path.join(KIT, 'out', i % 2 ? '3-inbetweens' : '2-keys', `${tag(i)}.png`))));
const colour = argv.includes('--no-colour') ? null : fitColourMatch(keyedAll.map((k) => k.png), read(path.join(KIT, 'refs', 'ich01A_101.png')));
if (colour) {
  const pts = (c, xs) => xs.map((x) => `${x}->${c.at(x).toFixed(1)}`).join(' ');
  console.log(`colour match to the standing art (neutral-context share: frames ${colour.share[0]}%, standing art ${colour.share[1]}%)`);
  colour.classes.forEach((cl, k) => {
    console.log(`  ${k ? 'coloured' : 'neutral '} L* ${pts(cl.L, [30, 60, 75, 85, 92, 97])}`);
    for (const l of [60, 75, 85, 92]) console.log(`    C* at L*${l}: ${pts({ at: (c) => cl.C.at(c, l) }, [3, 6, 9, 12, 20, 30, 40])}`);
    console.log(`    hue turn (deg) at C* ${[2, 5, 9, 14, 20, 28, 35].map((c) => `${c}:${(cl.hue(c) * 180 / Math.PI).toFixed(1)}`).join(' ')}`);
  });
  console.log(`  outline band L* ${pts(colour.rim.L, [60, 75, 85, 92, 97])}`);
  console.log('  + per-frame correction at pet size');
}
const free = keyedAll.map((k) => alignHead(base, k.png, headRows));
const sorted = free.map((t) => t.s).sort((a, b) => a - b);
const sGlobal = +sorted[Math.floor(sorted.length / 2)].toFixed(3);
console.log(`head scales ${free.map((t) => t.s.toFixed(3)).join(' ')} -> ${freeScale ? 'per frame' : 'shared ' + sGlobal}`);
// pass 1: register (shared scale), ground, measure the drawn head bob
const meas = ids.map((i, k) => {
  const t = freeScale ? free[k] : alignHead(base, keyedAll[k].png, headRows, sGlobal);
  const dyGround = G - groundRow(transform(keyedAll[k].png, t.s, t.dx, 0));
  // head height relative to the base after grounding = drawn body bob (negative = lower)
  return { t, dyGround, bob: -(dyGround - t.dy) };
});

// pass 2: bob fit. The guide's pelvis curve is the target (contact 0, down -7, passing +4, up +12 px).
// The head-only scale is uncertain by ~1 %, so each frame may be rescaled about its foot point by up
// to BOB_MAX: that moves the head up to ~17 px while the feet stay planted and the change in size is
// invisible (~3 px on the head). Frames still off after the clamp are reported.
const stats = JSON.parse(fs.readFileSync(path.join(KIT, 'guides', 'stats.json'), 'utf8')).stats;
const target = (i) => (stats[i].pelvis - stats[0].pelvis) * S;
const LEVER = G - C0.y, BOB_MAX = 0.015;
const diffs = meas.map((m, k) => target(ids[k]) - m.bob);
const level = (Math.max(...diffs) + Math.min(...diffs)) / 2; // minimax: smallest worst-case rescale
const bobFix = !argv.includes('--no-bobfix');
for (const [k, i] of ids.entries()) {
  const { png: keyed, bg } = keyedAll[k];
  const { t, dyGround, bob } = meas[k];
  const want = bobFix ? diffs[k] - level : 0;
  const sc = 1 + Math.max(-BOB_MAX, Math.min(BOB_MAX, want / LEVER));
  // compose: register (s, dx) -> ground (dyGround) -> scale sc about the foot point P = (CX, G)
  const s = t.s * sc, dx = sc * t.dx, dy = (sc - 1) * (C0.y - G) + sc * dyGround;
  let reg = transform(keyed, s, dx, dy);
  const fixG = G - groundRow(reg);
  if (fixG) reg = shiftY(reg, fixG);
  if (colour) applyColourMatch(reg, colour);
  const b = bounds(reg);
  const fitted = bob + (sc - 1) * LEVER + level;
  write(path.join(OUT, `${tag(i)}.png`), reg);
  frames.push({ i, png: reg });
  report.push({ frame: tag(i), bg, scale: +s.toFixed(4), headScale: +t.s.toFixed(3), bobScale: +sc.toFixed(4), headDx: t.dx, headIoU: +t.v.toFixed(3), groundShift: dyGround + fixG,
    headBobPx: +bob.toFixed(1), targetBobPx: +target(i).toFixed(1), fittedBobPx: +fitted.toFixed(1), top: b.y0, height: b.y1 - b.y0 + 1 });
  const rel = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
  console.log(`${tag(i)}  IoU ${t.v.toFixed(3)}  drawn ${rel(bob - meas[0].bob)}  target ${rel(target(i))}  fix x${sc.toFixed(4)}  -> ${rel(fitted)}${Math.abs(want / LEVER) > BOB_MAX ? '  (clamped)' : ''}  top ${b.y0}`);
}

// planted-foot slide per frame (a missing or backward measurement falls back to the mean), then the root motion
const stance = plantedSlides(frames);
const okSlides = stance.filter((s) => s && s.slide > 0).map((s) => s.slide);
const meanSlide = okSlides.length ? okSlides.reduce((a, b) => a + b, 0) / okSlides.length : 81 * 16 / frames.length;
const slides = stance.map((s) => (s && s.slide > 0 ? s.slide : +meanSlide.toFixed(1)));
stance.forEach((s, k) => console.log(s ? `  ${s.from}->${s.to} ${s.foot} ${s.point.padEnd(4)} ${s.x0} -> ${s.x1}  slide ${s.slide}${slides[k] !== s.slide ? '  (ignored, using mean)' : ''}`
  : `  ${tag(frames[k].i)} planted foot not found, using mean`));
const root = solveRootMotion(slides);
console.log(`planted-foot slide per frame (px): ${slides.join(' ')}`);
console.log(`root motion per frame (px):        ${root.motion.map((v) => v.toFixed(1)).join(' ')}`);
console.log(`  planted foot within ${root.footDev.toFixed(1)} px of its stance position, speed changes <= ${root.speedStep.toFixed(1)} px/frame`);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ mode: all16 ? 'full' : 'keys', frames: report, stance, slides,
  rootMotion: root.motion.map((v) => +v.toFixed(2)), footDevPx: +root.footDev.toFixed(1), speedStepPx: +root.speedStep.toFixed(1) }, null, 1));

// ---------------------------------------------------------------- 2b. start/stop turn (Stage 4)
// standing art -> T1 -> T2 (-> T3) -> walk model -> walk; stopping plays it backwards. All of them are drawn on the guide
// canvas with the feet in place, so they share the walk's crop and the app anchors them (and the walk) at the
// standing art's foot point (CX, G) instead of keeping its face column. The walk enters and leaves at a passing
// frame, whose planted foot is under the walk model's feet. Per drawing:
//   - height: stepped from the standing art to the walk's passing frames (no head dip when the walk starts);
//   - x: image registration along the chain standing art -> T1 -> ... -> walk model: each pair of neighbours is
//     aligned by its best overlap, the two ends stay where they are, and the leftover is spread over the steps
//     (mostly over the pairs whose overlap is least certain), so the figure moves as evenly as the drawings allow;
//   - colours: the same match as the walk frames.
// The left turn uses its own drawings T1L, T2L (T3L) when present (turning toward screen left from the unmirrored standing
// art, so the ear bows and the tail stay on the same side as in the standing art and the mirrored walk); they are
// processed mirrored about CX so that the left crop, which mirrors, shows them as drawn. Without them the left turn
// mirrors T1, T2.
const turnFile = (name) => path.join(KIT, 'out', '4-turn', `${name}.png`);
const prefix = (names) => { const out = []; for (const n of names) { if (!fs.existsSync(turnFile(n))) break; out.push(n); } return out; };
const TURN_R = prefix(['T1', 'T2', 'T3']); // in-betweens in order (T1 nearest the standing art)
const turnOn = all16 && !argv.includes('--no-turn') && TURN_R.length >= 2;
const TURN_L = TURN_R.map((n) => `${n}L`);
const leftOwn = turnOn && prefix(TURN_L).length === TURN_L.length;
const ENTRY = [frames.length / 4, (3 * frames.length) / 4]; // indices of the passing frames (W04, W12)
// seconds on screen per drawing (in-betweens, then the walk model): slow out of the standing pose, quicker into the walk
const TURN_HOLDS = TURN_R.length === 3 ? [0.085, 0.075, 0.07, 0.06] : [0.1, 0.09, 0.07];
const turn = { right: [], left: [] };
function feetAndFace(png) { // bottom-40-row extents and the eye centre (canvas px)
  let l = W, r = -1;
  for (let y = G - 40; y <= G; y++) for (let x = 0; x < W; x++) if (png.data[(y * W + x) * 4 + 3] >= 128) { if (x < l) l = x; if (x > r) r = x; }
  const e = eyeCentre(png), b = bounds(png);
  return { feetL: l, feetR: r, eyes: e ? e.x : null, h: b.y1 - b.y0 + 1 };
}
/** Mirror about the canvas centre line as the app's left crop does (canvas x -> 2*CX - x). */
function mirrorX(png) {
  const out = blank(W, H);
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) {
    const i = (y * W + 2 * CX - x) * 4, o = (y * W + x) * 4;
    if (2 * CX - x < W) for (let c = 0; c < 4; c++) out.data[o + c] = png.data[i + c];
  }
  return out;
}
if (turnOn) {
  // the standing art placed exactly like refs/scale-reference.png (origin 254, baseline 969 -> CX, G)
  const art = read(path.join(KIT, 'refs', 'ich01A_101.png'));
  const stand = blank(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = (x + 0.5 - CX) / S + 254 - 0.5, fy = (y + 0.5 - G) / S + 969 - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    let A = 0, R = 0, Gc = 0, B = 0;
    for (const [xx, yy, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x0 + 1, y0, tx * (1 - ty)], [x0, y0 + 1, (1 - tx) * ty], [x0 + 1, y0 + 1, tx * ty]]) {
      if (xx < 0 || yy < 0 || xx >= art.width || yy >= art.height) continue;
      const i = (yy * art.width + xx) * 4, a = art.data[i + 3] * w; A += a; R += art.data[i] * a; Gc += art.data[i + 1] * a; B += art.data[i + 2] * a;
    }
    const o = (y * W + x) * 4;
    if (A > 0.5) { stand.data[o] = R / A; stand.data[o + 1] = Gc / A; stand.data[o + 2] = B / A; stand.data[o + 3] = Math.min(255, Math.round(A)); }
  }
  const entryH = frames.filter((f, k) => ENTRY.includes(k)).map((f) => feetAndFace(f.png).h);
  const toH = entryH.reduce((a, b) => a + b, 0) / entryH.length;
  const grounded = (png) => shiftY(png, G - groundRow(png));
  const end = feetAndFace(grounded(base));
  // j < K: in-betweens (j+1)/(K+1) of the way; j = K: the walk model (never shifted)
  const K = TURN_R.length;
  const prep = (src, j, from) => { // grounded and scaled to the stepped height, no horizontal shift yet
    const dy0 = G - groundRow(src);
    const h0 = feetAndFace(shiftY(src, dy0)).h;
    const sc = (from.h + (toH - from.h) * (j + 1) / (K + 2)) / h0;
    const dy = (1 - sc) * (G - C0.y) + sc * dy0;
    return { src, sc, h0, dy, png: transform(src, sc, 0, dy) };
  };
  const finish = (p, dx, name, show, mirrored) => {
    let reg = transform(p.src, p.sc, dx, p.dy); // fresh copy: p.png stays uncorrected for registration
    const fixG = G - groundRow(reg);
    if (fixG) reg = shiftY(reg, fixG);
    const m1 = feetAndFace(reg);
    if (colour) applyColourMatch(reg, colour);
    write(path.join(OUT, `${name}.png`), show(reg));
    console.log(`turn ${name}: scale x${p.sc.toFixed(4)} (height ${p.h0} -> ${m1.h}), shift ${dx >= 0 ? '+' : ''}${dx.toFixed(1)}px, feet ${m1.feetL}-${m1.feetR}, eyes ${m1.eyes?.toFixed(0)}${mirrored ? ' (mirrored space)' : ''}`);
    return { name, png: reg };
  };
  // registration at half size: grey composited on white plus coverage, compared where either image has the figure
  const RF = 2;
  const regSmall = (png) => {
    const w = W / RF, h = H / RF, g = new Float32Array(w * h), a = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, al = 0;
      for (let yy = 0; yy < RF; yy++) for (let xx = 0; xx < RF; xx++) {
        const i = ((y * RF + yy) * W + x * RF + xx) * 4, A = png.data[i + 3] / 255;
        s += (0.3 * png.data[i] + 0.55 * png.data[i + 1] + 0.15 * png.data[i + 2]) * A + 255 * (1 - A); al += A;
      }
      g[y * w + x] = s / RF / RF; a[y * w + x] = al / RF / RF;
    }
    return { w, h, g, a };
  };
  const regDiff = (A, B, d) => { // B moved right by d half-size px
    let s = 0, n = 0;
    for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
      const xb = x - d, ia = y * A.w + x, inB = xb >= 0 && xb < A.w;
      const bg = inB ? B.g[y * A.w + xb] : 255, ba = inB ? B.a[y * A.w + xb] : 0;
      if (A.a[ia] < 0.05 && ba < 0.05) continue;
      s += Math.abs(A.g[ia] - bg) + 255 * Math.abs(A.a[ia] - ba); n++;
    }
    return s / n;
  };
  const regPair = (A, B, R = 40) => { // full-size shift of B that best overlaps A, and how sharp that optimum is
    const e = []; for (let d = -R; d <= R; d++) e.push(regDiff(A, B, d));
    let k = 0; for (let i = 1; i < e.length; i++) if (e[i] < e[k]) k = i;
    let sub = 0, curv = 0.01;
    if (k > 0 && k < e.length - 1) { const den = e[k - 1] - 2 * e[k] + e[k + 1]; if (den > 0) { sub = 0.5 * (e[k - 1] - e[k + 1]) / den; curv = Math.max(curv, den); } }
    return { off: (k - R + sub) * RF, w: curv };
  };
  // shifts d_1..d_K with d_0 = d_K+1 = 0 that minimise sum w_i (d_i+1 - d_i - off_i)^2
  const chainShifts = (pngs) => {
    const sm = pngs.map(regSmall), r = [];
    for (let i = 0; i + 1 < sm.length; i++) r.push(regPair(sm[i], sm[i + 1]));
    const sumOff = r.reduce((s, p) => s + p.off, 0), sumInv = r.reduce((s, p) => s + 1 / p.w, 0);
    const d = [0];
    for (const p of r) d.push(d[d.length - 1] + p.off - sumOff * (1 / p.w) / sumInv);
    console.log(`turn registration: neighbour offsets ${r.map((p) => `${p.off.toFixed(1)} (w ${p.w.toFixed(2)})`).join(', ')}; leftover ${sumOff.toFixed(1)}px`);
    return d.slice(1, -1).map((v) => Math.max(-40, Math.min(40, Math.round(v * 2) / 2)));
  };
  const id = (p) => p;
  const fromRight = feetAndFace(stand);
  const baseP = prep(base, K, fromRight);
  const walkModel = finish(baseP, 0, 'B', id, false);
  const sequence = (names, first, from, load, show, mirrored) => {
    const ps = names.map((t, j) => prep(load(t), j, from));
    const dx = chainShifts([first, ...ps.map((p) => p.png), baseP.png]);
    return [...ps.map((p, j) => finish(p, dx[j], names[j], show, mirrored)), walkModel];
  };
  turn.right = sequence(TURN_R, stand, fromRight, (t) => key(read(turnFile(t))).png, id, false);
  console.log(`turn path (right): standing art feet ${fromRight.feetL}-${fromRight.feetR} eyes ${fromRight.eyes?.toFixed(0)} h ${fromRight.h} -> walk model feet ${end.feetL}-${end.feetR} eyes ${end.eyes?.toFixed(0)} -> passing frames h ${toH.toFixed(0)}`);
  if (leftOwn) {
    const standL = mirrorX(stand), fromLeft = feetAndFace(standL);
    turn.left = sequence(TURN_L, standL, fromLeft, (t) => mirrorX(key(read(turnFile(t))).png), mirrorX, true);
    console.log(`turn path (left, mirrored space): standing art feet ${fromLeft.feetL}-${fromLeft.feetR} eyes ${fromLeft.eyes?.toFixed(0)}`);
  } else {
    turn.left = turn.right;
    console.log(`turn (left): no ${TURN_L.join('/')}, mirroring the right turn`);
  }
}

// review sheets: checker + dark background, guides overlaid
function sheet(bgFn, name, overlayGuides = false) {
  const cw = 256, ch = 384, out = blank(cw * frames.length, ch);
  frames.forEach((f, k) => {
    const g = overlayGuides ? read(path.join(KIT, 'guides', `guide-${tag(f.i)}.png`)) : null;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
        const i = ((y * 4 + yy) * W + x * 4 + xx) * 4, al = f.png.data[i + 3] / 255;
        const [br, bg_, bb_] = g ? [g.data[i] * 0.55 + 115, g.data[i + 1] * 0.55 + 115, g.data[i + 2] * 0.55 + 115] : bgFn(x * 4 + xx, y * 4 + yy);
        r += f.png.data[i] * al + br * (1 - al); gg += f.png.data[i + 1] * al + bg_ * (1 - al); b += f.png.data[i + 2] * al + bb_ * (1 - al); a++;
      }
      const o = (y * cw * frames.length + k * cw + x) * 4;
      out.data[o] = r / a; out.data[o + 1] = gg / a; out.data[o + 2] = b / a; out.data[o + 3] = 255;
    }
    for (let x = 0; x < cw; x++) { const o = ((G / 4 | 0) * cw * frames.length + k * cw + x) * 4; out.data[o] = 220; out.data[o + 1] = 60; out.data[o + 2] = 90; }
  });
  write(path.join(OUT, name), out);
}
sheet((x, y) => ((x >> 4) + (y >> 4)) % 2 ? [205, 205, 210] : [245, 245, 248], 'review-checker.png');
sheet(() => [32, 30, 36], 'review-dark.png');
sheet(null, 'review-guides.png', true);

if (argv.includes('--no-app')) process.exit(0);

// ---------------------------------------------------------------- 3. app sequences
const N = frames.length;
let u = { x0: W, y0: H, x1: 0, y1: 0 };
for (const f of [...frames, ...turn.right, ...turn.left]) { const b = bounds(f.png, 8); u = { x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) }; }
const pad = 6;
const cx0 = Math.max(0, u.x0 - pad), cy0 = Math.max(0, u.y0 - pad), cx1 = Math.min(W - 1, u.x1 + pad), cy1 = Math.min(H - 1, G + 4);
const cw = cx1 - cx0 + 1, chh = cy1 - cy0 + 1;
const faceX = (eye ? eye.x : CX) - cx0;
// With the turn drawings the pet's root is the standing art's foot point (CX on the canvas, mirrored about it for
// the left walk). Without them the walk keeps the standing face column (the app cross-fades stand <-> walk).
const originOf = (dir) => (turn.right.length
  ? (dir === 'right' ? CX - cx0 : cx1 - CX)
  : Math.round(dir === 'right' ? faceX - STAND_FACE_OFFSET * S : cw - 1 - faceX - STAND_FACE_OFFSET * S));
const originX = originOf('right');
const baseline = G - cy0;
const crop = (png, mirror) => {
  const out = blank(cw, chh);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
    const sx = mirror ? cx1 - x : cx0 + x, si = ((cy0 + y) * W + sx) * 4, oi = (y * cw + x) * 4;
    out.data[oi] = png.data[si]; out.data[oi + 1] = png.data[si + 1]; out.data[oi + 2] = png.data[si + 2]; out.data[oi + 3] = png.data[si + 3];
  }
  return out;
};
const frameInfo = (png) => {
  const b = bounds(png, 96);
  let sx = 0, n = 0;
  for (let y = b.y0; y < Math.min(png.height, b.y0 + 30); y++) for (let x = b.x0; x <= b.x1; x++) if (png.data[(y * png.width + x) * 4 + 3] > 96) { sx += x; n++; }
  return [b.x0, b.y0, b.x1, b.y1, n ? Math.round(sx / n) : Math.round((b.x0 + b.x1) / 2)];
};
const info = { right: [], left: [] }, turnInfo = { right: [], left: [] };
for (const dir of ['right', 'left']) {
  const dirPath = path.join(CHAR, 'seq', `walk7-${dir}`);
  fs.rmSync(dirPath, { recursive: true, force: true });
  frames.forEach((f, k) => {
    const png = crop(f.png, dir === 'left');
    write(path.join(dirPath, `frame-${String(k).padStart(3, '0')}.png`), png);
    info[dir].push(frameInfo(png));
  });
  const turnPath = path.join(CHAR, 'seq', `turn7-${dir}`);
  fs.rmSync(turnPath, { recursive: true, force: true });
  turn[dir].forEach((f, k) => {
    const png = crop(f.png, dir === 'left');
    write(path.join(turnPath, `frame-${String(k).padStart(3, '0')}.png`), png);
    turnInfo[dir].push(frameInfo(png));
  });
}
// root motion per frame (solved above); the app moves the pet in step with the drawings (frame-locked),
// so the planted foot stays (nearly) fixed on the desktop and the body speeds up / slows down as drawn
const motion = root.motion.map((d) => +d.toFixed(2));
const median = +(motion.reduce((a, b) => a + b, 0) / N).toFixed(1);
const passingFrames = [N / 4, (3 * N) / 4]; // W04 and W12
const manifestFile = path.join(CHAR, 'manifest.json');
const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const seq = (dir) => ({
  path: `seq/walk7-${dir}/frame-{i}.png`, frames: N, width: cw, height: chh, baseline,
  originX: originOf(dir), scale: +(1 / S).toFixed(4), duration: DURATION, loop: true,
  facing: dir === 'right' ? 1 : -1, rootMotion: motion, passingFrames,
  ...(turn.right.length ? { turn: `turn-${dir}`, entryFrames: ENTRY } : {}),
  crop: [0, 0, cw, chh], bounds: info[dir], source: `art/walk-kit (${all16 ? '16 drawings' : '8-key preview'})`,
});
m.sequences['walk-right'] = seq('right');
m.sequences['walk-left'] = seq('left');
for (const dir of ['right', 'left']) {
  // turn-<dir>: T1, T2, walk model. Played forward before the walk and backward after it, frame by frame (holds).
  if (turn[dir].length) m.sequences[`turn-${dir}`] = {
    path: `seq/turn7-${dir}/frame-{i}.png`, frames: turn[dir].length, width: cw, height: chh, baseline,
    originX: originOf(dir), scale: +(1 / S).toFixed(4), duration: +TURN_HOLDS.reduce((a, b) => a + b, 0).toFixed(3), loop: false,
    facing: dir === 'right' ? 1 : -1, holds: TURN_HOLDS, crop: [0, 0, cw, chh], bounds: turnInfo[dir],
    source: `art/walk-kit Stage 4 (${turn[dir].map((f) => f.name).join(', ')}${dir === 'left' && turn.left === turn.right ? ', mirrored' : ''})`,
  };
  else delete m.sequences[`turn-${dir}`];
}
m.scales.walk = +(1 / S).toFixed(4);
fs.writeFileSync(manifestFile, JSON.stringify(m, null, 1));
console.log(`app: ${N} frames${turn.right.length ? ` + turn right (${turn.right.map((f) => f.name).join(', ')}), left (${turn.left.map((f) => f.name).join(', ')})` : ''} ${cw}x${chh}, baseline ${baseline}, originX ${originX} (${turn.right.length ? 'foot point' : 'face column'}), mean slide ${median}px/frame (${(median * N / S / DURATION).toFixed(0)} native px/s)`);
