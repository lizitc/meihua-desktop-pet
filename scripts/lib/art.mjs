// Shared image helpers for the art build scripts (green-screen keying, colour match to the standing art, resampling).
// The keying and colour match are the same procedures as scripts/walk-build.mjs (see the notes there).
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

export const read = (p) => PNG.sync.read(fs.readFileSync(p));
export const write = (p, png) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, PNG.sync.write(png, { colorType: 6 })); };
export const blank = (w, h) => { const p = new PNG({ width: w, height: h }); p.data.fill(0); return p; };
export function clonePng(p) { const q = blank(p.width, p.height); q.data.set(p.data); return q; }

// ---------------------------------------------------------------- key
/** Chroma-key a flat green master: edge colours un-premultiplied, spill clamped, specks dropped. */
export function key(src) {
  const { width, height, data } = src;
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
    if (a < 0.04) continue;
    let R = (r - (1 - a) * bg[0]) / a, Gc = (g - (1 - a) * bg[1]) / a, B = (b - (1 - a) * bg[2]) / a;
    R = Math.max(0, Math.min(255, R)); B = Math.max(0, Math.min(255, B)); Gc = Math.max(0, Math.min(255, Gc));
    Gc = Math.min(Gc, Math.max(R, B) + 4);
    o[i] = R; o[i + 1] = Gc; o[i + 2] = B; o[i + 3] = Math.round(a * 255);
  }
  dropSpecks(out);
  return out;
}

/** Remove small islands that are not part of the figure, and faint haze not touching anything solid. */
export function dropSpecks(png, minArea = 260) {
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

// ---------------------------------------------------------------- colour match (see walk-build.mjs)
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
function quantileCurve(src, dst, max, step) {
  const s = Float64Array.from(src).sort(), d = Float64Array.from(dst).sort(), n = Math.round(max / step) + 1;
  const cdf = (v) => {
    let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; }
    let up = lo; while (up < s.length && s[up] === v) up++;
    return Math.min(1, Math.max(0, ((lo + up) / 2) / s.length));
  };
  const q = (u) => { const t = u * (d.length - 1), i = Math.floor(t); return i >= d.length - 1 ? d[d.length - 1] : d[i] + (d[i + 1] - d[i]) * (t - i); };
  const raw = Float64Array.from({ length: n }, (_, k) => q(cdf(k * step)) - k * step);
  const W = Math.round(1.5 / step), out = new Float32Array(n);
  for (let k = 0; k < n; k++) { let a = 0, c = 0; for (let j = Math.max(0, k - W); j <= Math.min(n - 1, k + W); j++) { a += raw[j]; c++; } out[k] = Math.max(0, k * step + a / c); }
  for (let k = 1; k < n; k++) out[k] = Math.max(out[k], out[k - 1]);
  return { step, lut: out, at: (v) => { const t = Math.min(n - 1, Math.max(0, v / step)), i = Math.floor(t); return i >= n - 1 ? out[n - 1] : out[i] + (out[i + 1] - out[i]) * (t - i); } };
}
const HUE_BIN = 2, HUE_FADE = [30, 40], HUE_MAX = 20 * Math.PI / 180;
const BAND_STEP = 2.5, BAND_HALF = 2.5, BAND_MIN = 400, C_GAIN_MAX = 3;
const CTX_R = 10, CTX_T = [4, 9];
function labPlanes(png) {
  const n = png.width * png.height, d = png.data;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) if (d[i * 4 + 3]) { const v = toLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); L[i] = v[0]; A[i] = v[1]; B[i] = v[2]; }
  return { L, A, B };
}
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
function fitClass(src, tgt) {
  const cm = { L: quantileCurve(src.map((v) => v[0]), tgt.map((v) => v[0]), 100, 0.1) };
  const SL = src.map((v) => cm.L.at(v[0])), SC = src.map((v) => Math.hypot(v[1], v[2])), TC = tgt.map((v) => Math.hypot(v[1], v[2]));
  const global = quantileCurve(SC, TC, 140, 0.1);
  cm.bands = [];
  for (let c = 0; c <= 100; c += BAND_STEP) {
    const s = SC.filter((_, i) => Math.abs(SL[i] - c) <= BAND_HALF), t = TC.filter((_, i) => Math.abs(tgt[i][0] - c) <= BAND_HALF);
    cm.bands.push(s.length >= BAND_MIN && t.length >= BAND_MIN ? quantileCurve(s, t, 140, 0.1) : global);
  }
  cm.C = { at: (c, l) => {
    const t = Math.max(0, Math.min(cm.bands.length - 1, l / BAND_STEP)), i = Math.floor(t), j = Math.min(cm.bands.length - 1, i + 1), f = t - i;
    const v = cm.bands[i].at(c) * (1 - f) + cm.bands[j].at(c) * f;
    return v > c ? Math.min(v, c + C_GAIN_MAX) : v;
  } };
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
const DISPLAY = 0.36;
/** Area-average downscale (alpha-weighted colour). */
export function boxDown(p, f) {
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
/** Fit the colour match of `sources` (drawings at S canvas px per standing-art px) onto the standing art `target`. */
export function fitColourMatch(sources, target, S = 1.45) {
  const sample = (png, lab, every, out, w) => { for (let i = 0; i < lab.L.length; i += every) if (png.data[i * 4 + 3] >= 250) (w ? out[w[i] >= 0.5 ? 0 : 1] : out).push([lab.L[i], lab.A[i], lab.B[i]]); };
  const r = Math.round(CTX_R * S), tLab = labPlanes(target), tgtAll = [], tgt = [[], []], srcAll = [], src = [[], []];
  sample(target, tLab, 1, tgtAll);
  sample(target, tLab, 1, tgt, neutralWeight(target, tLab, CTX_R));
  for (const p of sources) sample(p, labPlanes(p), 5, srcAll);
  const base = fitClass(srcAll, tgtAll);
  for (const p of sources) { const lab = mapPlanes(labPlanes(p), base); sample(p, lab, 5, src, neutralWeight(p, lab, r)); }
  const cm = { r, S, base, classes: [fitClass(src[0], tgt[0]), fitClass(src[1], tgt[1])] };
  const rimSample = (png, lab, out) => { for (let i = 0; i < lab.L.length; i++) { const a = png.data[i * 4 + 3]; if (a > 20 && a < 250) out.push([lab.L[i], lab.A[i], lab.B[i]]); } };
  const rimSrc = [], rimTgt = [];
  rimSample(target, tLab, rimTgt);
  for (const p of sources) { const q = applyColourMatch(clonePng(p), cm, { display: false }); rimSample(q, labPlanes(q), rimSrc); }
  cm.rim = fitClass(rimSrc, rimTgt);
  const dt = boxDown(target, DISPLAY);
  cm.displayTarget = [];
  sample(dt, labPlanes(dt), 1, cm.displayTarget);
  cm.sample = sample;
  return cm;
}
export function applyColourMatch(png, cm, { display = true } = {}) {
  const d = png.data, lab = mapPlanes(labPlanes(png), cm.base), w = neutralWeight(png, lab, cm.r), [neu, col] = cm.classes;
  for (let i = 0; i < w.length; i++) {
    if (!d[i * 4 + 3]) continue;
    const n = neu.map(lab.L[i], lab.A[i], lab.B[i]), c = col.map(lab.L[i], lab.A[i], lab.B[i]), k = w[i];
    lab.L[i] = n[0] * k + c[0] * (1 - k); lab.A[i] = n[1] * k + c[1] * (1 - k); lab.B[i] = n[2] * k + c[2] * (1 - k);
    const [r, g, b] = fromLab(lab.L[i], lab.A[i], lab.B[i]);
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b;
  }
  if (cm.rim) for (let i = 0; i < w.length; i++) {
    if (!d[i * 4 + 3] || d[i * 4 + 3] >= 250) continue;
    const v = cm.rim.map(lab.L[i], lab.A[i], lab.B[i]);
    lab.L[i] = v[0]; lab.A[i] = v[1]; lab.B[i] = v[2];
    const [r, g, b] = fromLab(v[0], v[1], v[2]);
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b;
  }
  if (display && cm.displayTarget) {
    const q = boxDown(png, DISPLAY / cm.S), src = [];
    cm.sample(q, labPlanes(q), 1, src);
    const fix = fitClass(src, cm.displayTarget);
    mapPlanes(lab, fix);
    for (let i = 0; i < w.length; i++) if (d[i * 4 + 3]) { const [r, g, b] = fromLab(lab.L[i], lab.A[i], lab.B[i]); d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; }
  }
  return png;
}

// ---------------------------------------------------------------- geometry
/** Bounding box of pixels with alpha >= th: { x0, y0, x1, y1 } (inclusive). */
export function bounds(png, th = 128) {
  const { width, height, data } = png;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= th) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
/**
 * Resample `src` into a W x H image through the affine map dst -> src: sx = a*x + c*y + e, sy = b*x + d*y + f
 * (given as `inv` = [a, b, c, d, e, f] on pixel centres). Bilinear, premultiplied alpha.
 */
export function warpAffine(src, inv, W, H) {
  const out = blank(W, H), o = out.data, sw = src.width, sh = src.height, d = src.data;
  const [a, b, c, dd, e, f] = inv;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = a * (x + 0.5) + c * (y + 0.5) + e - 0.5, sy = b * (x + 0.5) + dd * (y + 0.5) + f - 0.5;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
    if (x0 < -1 || y0 < -1 || x0 >= sw || y0 >= sh) continue;
    let A = 0, R = 0, G = 0, B = 0;
    for (const [xx, yy, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x0 + 1, y0, tx * (1 - ty)], [x0, y0 + 1, (1 - tx) * ty], [x0 + 1, y0 + 1, tx * ty]]) {
      if (xx < 0 || yy < 0 || xx >= sw || yy >= sh || w <= 0) continue;
      const i = (yy * sw + xx) * 4, al = d[i + 3] * w;
      A += al; R += d[i] * al; G += d[i + 1] * al; B += d[i + 2] * al;
    }
    if (A > 0.5) { const j = (y * W + x) * 4; o[j] = R / A; o[j + 1] = G / A; o[j + 2] = B / A; o[j + 3] = Math.min(255, Math.round(A)); }
  }
  return out;
}
/** Crop a region (clamped) into a new image. */
export function crop(png, x, y, w, h) {
  const out = blank(w, h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const sx = x + xx, sy = y + yy;
    if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) continue;
    const i = (sy * png.width + sx) * 4, j = (yy * w + xx) * 4;
    out.data[j] = png.data[i]; out.data[j + 1] = png.data[i + 1]; out.data[j + 2] = png.data[i + 2]; out.data[j + 3] = png.data[i + 3];
  }
  return out;
}
/** Alpha-composite `top` over `base` (same size), in place on base. */
export function over(base, top) {
  const b = base.data, t = top.data;
  for (let i = 0; i < b.length; i += 4) {
    const ta = t[i + 3] / 255; if (!ta) continue;
    const ba = b[i + 3] / 255, oa = ta + ba * (1 - ta);
    for (let c = 0; c < 3; c++) b[i + c] = (t[i + c] * ta + b[i + c] * ba * (1 - ta)) / oa;
    b[i + 3] = Math.round(oa * 255);
  }
  return base;
}
