// Loading of character assets: rig piece textures and baked frame sequences.
// Sequence frames are decoded once, cropped to their useful area and resized to
// the on-screen resolution, then uploaded to a GPU texture on demand.
import { Rig, HIDDEN_ALPHA_GAIN, softLayers } from './rig.js';

export const ASSET_BASE = 'meihua://app/assets/character/';

/** Grey-scale erosion (op = Math.min) or dilation (Math.max) with a (2r+1)^2 square, separable. */
function morph(src, w, h, r, op) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = src[y * w + x];
    for (let k = -r; k <= r; k++) { const xx = x + k; v = op(v, xx < 0 || xx >= w ? (op === Math.min ? 0 : v) : src[y * w + xx]); }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = tmp[y * w + x];
    for (let k = -r; k <= r; k++) { const yy = y + k; v = op(v, yy < 0 || yy >= h ? (op === Math.min ? 0 : v) : tmp[yy * w + x]); }
    out[y * w + x] = v;
  }
  return out;
}

/** Decodes an image to straight-alpha ImageData. */
async function decodeImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const raw = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const cv = new OffscreenCanvas(raw.width, raw.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(raw, 0, 0);
  raw.close?.();
  return ctx.getImageData(0, 0, cv.width, cv.height);
}

/** 8-connected components of alpha > thr: { lab (Int32, -1 = empty), comps: [{ n, px: Int32Array }] }. */
function components(img, thr = 12) {
  const { width: w, height: h, data } = img;
  const lab = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] !== -1 || data[i * 4 + 3] <= thr) continue;
    const id = comps.length, px = [];
    lab[i] = id; stack.push(i);
    while (stack.length) {
      const k = stack.pop(); px.push(k);
      const x = k % w, y = (k - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const kk = yy * w + xx;
        if (lab[kk] === -1 && data[kk * 4 + 3] > thr) { lab[kk] = id; stack.push(kk); }
      }
    }
    comps.push({ n: px.length, px });
  }
  return { lab, comps };
}

/**
 * Removes small detached fragments of a piece that were covered at rest by the layers drawn above it (`cov`, the
 * rest coverage of the whole canvas, width W) or hug their edge. In the source illustration they were hidden or read
 * as the upper part's outline; once parts move they show up as stray strokes (e.g. the ear's edge left on the back
 * hair). The rest appearance barely changes.
 */
function stripOccludedOrphans(img, ox, oy, cov, W, H, maxN) {
  const { width: w, height: h, data } = img;
  const { lab, comps } = components(img);
  if (comps.length < 2) return 0;
  let main = 0;
  for (let i = 1; i < comps.length; i++) if (comps[i].n > comps[main].n) main = i;
  const limit = Math.min(maxN, comps[main].n * 0.12);
  let removed = 0;
  for (let c = 0; c < comps.length; c++) {
    const { n, px } = comps[c];
    if (c === main || n > limit) continue;
    let covered = 0;   // covered by, or hugging (2 px), the pieces above: an outline bit of the part on top
    for (const k of px) {
      const x = ox + (k % w), y = oy + ((k / w) | 0);
      let m = 0;
      for (let dy = -2; dy <= 2 && m < 150; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && cov[yy * W + xx] > m) m = cov[yy * W + xx];
      }
      if (m >= 150) covered++;
    }
    if (covered < n * 0.8) continue;
    for (const k of px) {
      data[k * 4 + 3] = 0;
      const x = k % w, y = (k - x) / w;   // and its faint anti-aliased fringe
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const kk = yy * w + xx;
        if (lab[kk] === -1) data[kk * 4 + 3] = 0;
      }
    }
    removed += n;
  }
  return removed;
}

/** Adds a piece's alpha (placed at ox, oy) into the coverage map. */
function accumulate(cov, W, H, img, ox, oy) {
  const { width: w, height: h, data } = img;
  for (let y = 0; y < h; y++) {
    const yy = oy + y;
    if (yy < 0 || yy >= H) continue;
    for (let x = 0; x < w; x++) {
      const xx = ox + x;
      if (xx < 0 || xx >= W) continue;
      const a = data[(y * w + x) * 4 + 3], i = yy * W + xx;
      if (a) cov[i] = 255 - (((255 - cov[i]) * (255 - a)) / 255 | 0);
    }
  }
}

/**
 * Hidden underpaint with its alpha lifted (alpha * gain, capped), premultiplied for upload. With `split`, the
 * thin structures (seam rims, removed by a 2 px opening) come back as a second bitmap: { body, rim }.
 */
async function hiddenBitmaps(img, gain, split) {
  const w = img.width, h = img.height;
  const d = img.data;
  const opts = { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' };
  if (!split) {
    for (let i = 3; i < d.length; i += 4) if (d[i]) d[i] = Math.min(255, Math.round(d[i] * gain));
    return { body: await createImageBitmap(img, opts) };
  }
  const A = new Uint8Array(w * h);
  for (let i = 0; i < A.length; i++) A[i] = d[i * 4 + 3];
  const open = morph(morph(A, w, h, 2, Math.min), w, h, 2, Math.max);
  const rim = new ImageData(new Uint8ClampedArray(d), w, h);
  for (let i = 0; i < A.length; i++) {
    const b = Math.min(A[i], open[i]);
    d[i * 4 + 3] = Math.min(255, Math.round(b * gain));
    rim.data[i * 4 + 3] = Math.min(255, Math.round((A[i] - b) * gain));
  }
  return { body: await createImageBitmap(img, opts), rim: await createImageBitmap(rim, opts) };
}

async function fetchBitmap(url, crop, resize) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  const opts = { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' };
  if (resize) Object.assign(opts, { resizeWidth: resize.w, resizeHeight: resize.h, resizeQuality: 'high' });
  return crop ? createImageBitmap(blob, crop[0], crop[1], crop[2], crop[3], opts) : createImageBitmap(blob, opts);
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return out;
}

export async function loadManifest() {
  const res = await fetch(ASSET_BASE + 'manifest.json');
  return res.json();
}

export class Assets {
  constructor(renderer, manifest) {
    this.r = renderer;
    this.m = manifest;
    this.rigs = new Map();
    this.rigLoading = new Map();
    this.seqs = new Map();
    this.budget = 420 * 1024 * 1024;
    this.pinned = new Set(['walk-right', 'walk-left', 'turn-right', 'turn-left']);
    this.slots = new Map();
    this.displayScale = 0.36;
    this.dpr = 1;
  }

  setResolution(scale, dpr) {
    const changed = Math.abs(scale - this.displayScale) > 1e-3 || Math.abs(dpr - this.dpr) > 1e-3;
    this.displayScale = scale; this.dpr = dpr;
    if (changed) {
      for (const [id, e] of this.seqs) {
        if (e.bitmaps) for (const b of e.bitmaps) b?.close?.();
        this.seqs.delete(id);
      }
      this.slots.clear();
    }
    return changed;
  }

  // ------------------------------------------------------------ rigs
  rig(id) { return this.rigs.get(id) || null; }

  loadRig(id) {
    if (this.rigs.has(id)) return Promise.resolve(this.rigs.get(id));
    if (this.rigLoading.has(id)) return this.rigLoading.get(id);
    const def = this.m.rigs[id];
    if (!def) return Promise.reject(new Error(`no rig ${id}`));
    const p = (async () => {
      const dir = ASSET_BASE + def.rig.replace(/rig\.json$/, '');
      const json = await (await fetch(ASSET_BASE + def.rig)).json();
      const files = new Set(), hidden = new Map();
      const moving = softLayers(json);
      for (const l of json.layers) { if (l.visible) files.add(l.visible.src); if (l.hidden) { files.add(l.hidden.src); hidden.set(l.hidden.src, moving.has(l.id)); } }
      for (const list of Object.values(json.expressions || {})) for (const p of list) files.add(p.src);
      // Decode every layer piece, strip occluded orphan fragments (top-down in draw order, hidden underpaint
      // last, against the coverage of all visible pieces), then upload.
      const pieces = new Set();
      for (const l of json.layers) { if (l.visible) pieces.add(l.visible.src); if (l.hidden) pieces.add(l.hidden.src); }
      const decoded = new Map();
      await pool([...pieces], 12, async (src) => decoded.set(src, await decodeImage(dir + src)));
      const W = json.width, H = json.height, cov = new Uint8Array(W * H);
      const byOrder = json.layers.filter((l) => l.visible).sort((a, b) => (b.drawOrder ?? 0) - (a.drawOrder ?? 0));
      for (const l of byOrder) {
        const img = decoded.get(l.visible.src);
        stripOccludedOrphans(img, l.visible.x, l.visible.y, cov, W, H, 400);
        accumulate(cov, W, H, img, l.visible.x, l.visible.y);
      }
      for (const l of json.layers) if (l.hidden) stripOccludedOrphans(decoded.get(l.hidden.src), l.hidden.x, l.hidden.y, cov, W, H, 120);
      const opts = { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' };
      const textures = new Map();
      await pool([...files], 12, async (src) => {
        if (hidden.has(src)) {
          const { body, rim } = await hiddenBitmaps(decoded.get(src), HIDDEN_ALPHA_GAIN, hidden.get(src));
          textures.set(src, this.r.texture(body)); body.close?.();
          if (rim) { textures.set(src + '#rim', this.r.texture(rim)); rim.close?.(); }
          return;
        }
        const bmp = decoded.has(src) ? await createImageBitmap(decoded.get(src), opts) : await fetchBitmap(dir + src);
        textures.set(src, this.r.texture(bmp));
        bmp.close?.();
      });
      const rig = new Rig(this.r, id, def, json, textures);
      this.rigs.set(id, rig);
      this.rigLoading.delete(id);
      return rig;
    })();
    this.rigLoading.set(id, p);
    return p;
  }

  // ------------------------------------------------------------ sequences
  seqDef(id) { return this.m.sequences[id] || this.m.transitions[id] || null; }

  isReady(id) { return !!this.seqs.get(id)?.ready; }

  ensure(id) {
    const def = this.seqDef(id);
    if (!def) return Promise.reject(new Error(`no sequence ${id}`));
    let e = this.seqs.get(id);
    if (e) { e.used = performance.now(); return e.promise; }
    const crop = def.crop;
    const ts = Math.min(1, this.displayScale * def.scale * this.dpr * 1.08);
    const resize = ts < 0.98 ? { w: Math.max(8, Math.round(crop[2] * ts)), h: Math.max(8, Math.round(crop[3] * ts)) } : null;
    e = { id, def, crop, resize, bitmaps: new Array(def.frames), ready: false, used: performance.now(), bytes: 0 };
    this.seqs.set(id, e);
    e.promise = pool(Array.from({ length: def.frames }, (_, i) => i), 6, async (i) => {
      const url = ASSET_BASE + def.path.replace('{i}', String(i).padStart(3, '0'));
      const bmp = await fetchBitmap(url, crop, resize);
      e.bitmaps[i] = bmp;
      e.bytes += bmp.width * bmp.height * 4;
    }).then(() => { e.ready = true; this.#evict(id); return e; }).catch((err) => { this.seqs.delete(id); throw err; });
    return e.promise;
  }

  #evict(keep) {
    let total = 0;
    for (const e of this.seqs.values()) total += e.bytes;
    if (total <= this.budget) return;
    const victims = [...this.seqs.values()].filter((e) => e.ready && e.id !== keep && !this.pinned.has(e.id)).sort((a, b) => a.used - b.used);
    for (const v of victims) {
      if (total <= this.budget) break;
      for (const b of v.bitmaps) b?.close?.();
      total -= v.bytes;
      this.seqs.delete(v.id);
    }
  }

  /** Texture holding frame i of sequence id (uploaded into a reusable slot). */
  frame(id, i, slotName = 'a') {
    const e = this.seqs.get(id);
    if (!e?.ready) return null;
    e.used = performance.now();
    const idx = Math.max(0, Math.min(e.def.frames - 1, i | 0));
    const bmp = e.bitmaps[idx];
    let slot = this.slots.get(slotName);
    if (!slot) { slot = { tex: this.r.texture(bmp, { mipmap: true }), key: '' }; this.slots.set(slotName, slot); }
    const key = `${id}#${idx}`;
    if (slot.key !== key) { this.r.updateTexture(slot.tex, bmp); slot.key = key; }
    return { tex: slot.tex, crop: e.crop, def: e.def };
  }
}
