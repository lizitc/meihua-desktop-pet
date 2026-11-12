// Copies the production character assets from the hand-off package into ./assets
// and derives a runtime manifest: unified world scale, contact baselines,
// root motion for in-place loops, expression catalogue, avatars and icons.
//
//   node scripts/prepare-assets.mjs [--src ../Meihua-Asset-Handoff-20261109] [--skip-copy]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const SRC = path.resolve(APP, arg('--src', '../Meihua-Asset-Handoff-20261109'));
const OUT = path.join(APP, 'assets', 'character');
const APP_ASSETS = path.join(APP, 'assets', 'app');
const SKIP_COPY = argv.includes('--skip-copy');

const PROD = path.join(SRC, '01_Production');
const LAYERED = path.join(SRC, '02_Layered_PNG');
const MAPS = path.join(SRC, '00_Maps');

if (!fs.existsSync(PROD)) {
  console.error(`素材目录不存在: ${SRC}`);
  process.exit(1);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const pad3 = (n) => String(n).padStart(3, '0');
const mkdir = (p) => fs.mkdirSync(p, { recursive: true });

function copyDir(from, to, filter = () => true) {
  mkdir(to);
  let n = 0;
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, ent.name), b = path.join(to, ent.name);
    if (ent.isDirectory()) n += copyDir(a, b, filter);
    else if (filter(ent.name)) {
      const st = fs.statSync(a);
      if (!fs.existsSync(b) || fs.statSync(b).size !== st.size) fs.copyFileSync(a, b);
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- image helpers
const pngCache = new Map();
function readPng(p) {
  if (!pngCache.has(p)) pngCache.set(p, PNG.sync.read(fs.readFileSync(p)));
  return pngCache.get(p);
}
function alphaBottom(png, threshold = 32) {
  const { width, height, data } = png;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > threshold) return y;
  }
  return -1;
}
function alphaBounds(png, threshold = 24) {
  const { width, height, data } = png;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > threshold) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
// Straight-alpha "over" into a float premultiplied buffer.
function over(buf, W, H, src, ox, oy) {
  for (let y = 0; y < src.height; y++) {
    const dy = y + oy; if (dy < 0 || dy >= H) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x + ox; if (dx < 0 || dx >= W) continue;
      const si = (y * src.width + x) * 4, di = (dy * W + dx) * 4;
      const a = src.data[si + 3] / 255; if (!a) continue;
      const k = 1 - a;
      buf[di] = src.data[si] * a + buf[di] * k;
      buf[di + 1] = src.data[si + 1] * a + buf[di + 1] * k;
      buf[di + 2] = src.data[si + 2] * a + buf[di + 2] * k;
      buf[di + 3] = a + buf[di + 3] * k;
    }
  }
}
// Box-filter resample of a premultiplied float region into a straight-alpha PNG.
function resampleRegion(buf, W, rx, ry, rw, rh, outW, outH, mask) {
  const out = new PNG({ width: outW, height: outH });
  const sx = rw / outW, sy = rh / outH;
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const xa = rx + x * sx, xb = rx + (x + 1) * sx, ya = ry + y * sy, yb = ry + (y + 1) * sy;
    for (let yy = Math.floor(ya); yy < Math.ceil(yb); yy++) for (let xx = Math.floor(xa); xx < Math.ceil(xb); xx++) {
      const i = (yy * W + xx) * 4;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3]; n++;
    }
    let A = n ? a / n : 0;
    if (mask) A *= mask(x, y);
    const o = (y * outW + x) * 4;
    const inv = a > 0 ? 1 / a : 0;
    out.data[o] = Math.round(Math.min(255, r * inv));
    out.data[o + 1] = Math.round(Math.min(255, g * inv));
    out.data[o + 2] = Math.round(Math.min(255, b * inv));
    out.data[o + 3] = Math.round(Math.min(1, A) * 255);
  }
  return out;
}

// ---------------------------------------------------------------- copy
// The crawl pose was retired (2026-11): its rigs, loop and transitions are not shipped.
// Its source art is still read below for calibration only.
const RETIRED = (id) => /crawl/.test(id);
const LAYERED_POSES = ['stand', 'sit', 'sleep', ...Array.from({ length: 4 }, (_, i) => `lower-${i}`)];
const clipsJson = readJson(path.join(PROD, 'transitions-v5', 'clips.json'));
const CLIP_IDS = Object.keys(clipsJson.clips).filter((id) => !RETIRED(id));

if (!SKIP_COPY) {
  let n = 0;
  for (const pose of LAYERED_POSES) n += copyDir(path.join(LAYERED, pose), path.join(OUT, 'rigs', pose));
  n += copyDir(path.join(PROD, 'walk-right', 'frames'), path.join(OUT, 'seq', 'walk-right'), (f) => /^frame-\d{3}\.png$/.test(f));
  n += copyDir(path.join(PROD, 'walk-left', 'frames'), path.join(OUT, 'seq', 'walk-left'), (f) => /^frame-\d{3}\.png$/.test(f));
  for (const clip of CLIP_IDS) {
    n += copyDir(path.join(PROD, 'transitions-v5', clip), path.join(OUT, 'seq', 'tr', clip), (f) => /^frame-\d{3}\.png$/.test(f));
  }
  console.log(`copied ${n} files`);
}

// ---------------------------------------------------------------- calibration
// Unified world space = native pixels of the approved standing art (508x1000).
// Factors were measured by matching the alpha bounds of shared endpoints:
//   transitions frame 0 (stand) 164x330  vs stand art 479x964      -> 2.921
//   transitions crawl endpoint 215x185   vs native crawl 356x305    -> 1.766
//   transitions sit endpoint 167x215     vs native sit 255x330      -> 1.908
//   transitions sleep endpoint 212x106   vs native sleep 480x239    -> 1.293
function measuredScale(nativeFile, transitionFile) {
  const a = alphaBounds(readPng(nativeFile)), b = alphaBounds(readPng(transitionFile));
  return { w: b.width / a.width, h: b.height / a.height, avg: (b.width / a.width + b.height / a.height) / 2 };
}
const standArt = alphaBounds(readPng(path.join(PROD, 'standing', 'base.png')));
const trStand = alphaBounds(readPng(path.join(PROD, 'transitions-v5', 'stand-sit', 'frame-000.png')));
const TR = (standArt.height / trStand.height + standArt.width / trStand.width) / 2;
const scaleOf = (native, trFile) => TR * measuredScale(native, trFile).avg;
const K = {
  stand: 1,
  walk: 1,
  tr: TR,
  crawl: scaleOf(path.join(PROD, 'crawl', 'key-00.png'), path.join(PROD, 'transitions-v5', 'stand-crawl', 'frame-072.png')),
  sit: scaleOf(path.join(PROD, 'poses', 'sit.png'), path.join(PROD, 'transitions-v5', 'stand-sit', 'frame-072.png')),
  sleep: scaleOf(path.join(PROD, 'poses', 'sleep.png'), path.join(PROD, 'transitions-v5', 'stand-sleep', 'frame-072.png')),
};
for (const k of Object.keys(K)) K[k] = Math.round(K[k] * 1000) / 1000;
console.log('scales', K);

const contact = (file) => alphaBottom(readPng(file), 40) + 1;
const BASE = {
  stand: contact(path.join(PROD, 'standing', 'base.png')),
  walk: Math.max(...[0, 16, 32, 48].map((i) => contact(path.join(PROD, 'walk-right', 'frames', `frame-${pad3(i)}.png`)))),
  crawl: Math.max(...[0, 16, 32, 48].map((i) => contact(path.join(PROD, 'crawl', 'frames', `frame-${pad3(i)}.png`)))),
  sit: contact(path.join(PROD, 'poses', 'sit.png')),
  sleep: contact(path.join(PROD, 'poses', 'sleep.png')),
  tr: Math.max(contact(path.join(PROD, 'transitions-v5', 'stand-sit', 'frame-000.png')), contact(path.join(PROD, 'transitions-v5', 'stand-crawl', 'frame-072.png'))),
  lower: contact(path.join(PROD, 'lower-keyframes', 'lower-0.png')),
};
console.log('contact baselines', BASE);

// ---------------------------------------------------------------- root motion
function groundRuns(file, baseline, band = 6) {
  const { width, height, data } = readPng(file);
  const runs = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    let hit = false;
    if (x < width) for (let y = Math.max(0, baseline - band); y <= Math.min(height - 1, baseline); y++) {
      if (data[(y * width + x) * 4 + 3] > 96) { hit = true; break; }
    }
    if (hit && start < 0) start = x;
    if (!hit && start >= 0) { if (x - start >= 3) runs.push({ l: start, r: x - 1 }); start = -1; }
  }
  return runs;
}
function rootMotion(dir, frames, baseline, smoothTaps = [1, 2, 3, 4, 3, 2, 1]) {
  const runs = Array.from({ length: frames }, (_, i) => groundRuns(path.join(dir, `frame-${pad3(i)}.png`), baseline));
  const raw = [];
  for (let i = 0; i < frames; i++) {
    const a = runs[i], b = runs[(i + 1) % frames];
    const deltas = [];
    for (const ra of a) for (const rb of b) {
      if (rb.r < ra.l - 40 || rb.l > ra.r + 40) continue;
      const d = rb.r - ra.r;
      if (d <= 3 && d >= -30) deltas.push(d);
    }
    deltas.sort((x, y) => x - y);
    raw.push(deltas.length ? -deltas[Math.floor(deltas.length / 2)] : null);
  }
  // fill gaps by circular interpolation
  for (let i = 0; i < frames; i++) if (raw[i] == null) {
    let p = i, q = i;
    while (raw[(p - 1 + frames) % frames] == null && p - i > -frames) p--;
    while (raw[(q + 1) % frames] == null && q - i < frames) q++;
    const pv = raw[(p - 1 + frames) % frames] ?? 0, qv = raw[(q + 1) % frames] ?? 0;
    raw[i] = (pv + qv) / 2;
  }
  const sum = smoothTaps.reduce((s, v) => s + v, 0), half = (smoothTaps.length - 1) / 2;
  const smooth = raw.map((_, i) => smoothTaps.reduce((s, w, k) => s + w * Math.max(0, raw[(i + k - half + frames * 4) % frames]), 0) / sum);
  return smooth.map((v) => Math.round(v * 100) / 100);
}
const walkMotion = rootMotion(path.join(PROD, 'walk-right', 'frames'), 64, BASE.walk - 1);
const walkCycle = walkMotion.reduce((s, v) => s + v, 0);
console.log(`walk: ${walkCycle.toFixed(1)} native px per cycle (${(walkCycle / 1.28).toFixed(1)} px/s)`);
// Crawl loop is nearly in place (paws drift ~1px/frame); use a gentle constant speed.

// Frames where the legs are closest together are the best walk start/stop points.
function legSpread(file, baseline) {
  const { width, data } = readPng(file);
  let x0 = width, x1 = -1;
  for (let y = baseline - 150; y < baseline - 20; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 96) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  }
  return x1 - x0;
}
const spreads = Array.from({ length: 64 }, (_, i) => ({ i, s: legSpread(path.join(PROD, 'walk-right', 'frames', `frame-${pad3(i)}.png`), BASE.walk) }));
const passing = [...spreads].sort((a, b) => a.s - b.s);
const passingFrames = [];
for (const p of passing) if (passingFrames.every((q) => Math.min(Math.abs(q - p.i), 64 - Math.abs(q - p.i)) > 12)) passingFrames.push(p.i);
passingFrames.length = Math.min(2, passingFrames.length);
console.log('walk passing frames', passingFrames, passingFrames.map((i) => spreads[i].s));

// ---------------------------------------------------------------- expressions
const standRig = readJson(path.join(LAYERED, 'stand', 'rig.json'));
const expressionIds = Object.keys(standRig.expressions);
// Semantic catalogue (verified against the rendered faces).
const EXPRESSIONS = {
  '101': { tag: 'calm', label: '平静微笑' },
  '101a': { tag: 'calm_blush', label: '平静·脸红' },
  '102': { tag: 'happy', label: '眯眼笑' },
  '102a': { tag: 'happy_blush', label: '眯眼笑·脸红' },
  '103': { tag: 'joy', label: '开怀笑' },
  '104': { tag: 'talk', label: '说话' },
  '104a': { tag: 'talk_blush', label: '说话·脸红' },
  '105': { tag: 'cheerful', label: '眯眼说话' },
  '105a': { tag: 'cheerful_blush', label: '眯眼说话·脸红' },
  '301': { tag: 'pensive', label: '思索' },
  '301a': { tag: 'pensive_blush', label: '思索·脸红' },
  '302': { tag: 'relaxed', label: '闭眼放松' },
  '401': { tag: 'excited', label: '惊喜' },
  '401a': { tag: 'excited_blush', label: '惊喜·脸红' },
  '402': { tag: 'puzzled', label: '疑惑' },
  '402a': { tag: 'puzzled_blush', label: '疑惑·脸红' },
  '403': { tag: 'surprised', label: '小吃惊' },
  '403a': { tag: 'surprised_blush', label: '小吃惊·脸红' },
  '501': { tag: 'shy', label: '害羞' },
  '502': { tag: 'shy_talk', label: '害羞说话' },
  '601': { tag: 'neutral', label: '平常' },
  '602': { tag: 'eyes_closed', label: '闭眼' },
  '603': { tag: 'attentive', label: '认真' },
  '604': { tag: 'neutral_talk', label: '平常说话' },
  '604a': { tag: 'neutral_talk_blush', label: '平常说话·脸红' },
  '701': { tag: 'flustered', label: '慌张脸红' },
  '701a': { tag: 'flustered_more', label: '超级脸红' },
  '901': { tag: 'sleepy', label: '半睁眼' },
  '902': { tag: 'pout', label: '小抱怨' },
};
// Emotion vocabulary exposed to the AI -> expression id.
const EMOTIONS = {
  calm: '101', happy: '102', joy: '103', cheerful: '105', excited: '401', surprised: '403', puzzled: '402',
  curious: '104', shy: '501', flustered: '701', embarrassed: '101a', pensive: '301', thinking: '301', relaxed: '302',
  sleepy: '901', pout: '902', annoyed: '902', serious: '603', neutral: '601', sad: '301a', touched: '102a', proud: '105',
  worried: '301a', love: '102a', eyes_closed: '602',
};
// Mouth shapes for lip-sync; blink uses closed-eye pieces of 602.
const LIPSYNC = { closed: null, half: '604', open: '104', wide: '401', smileOpen: '105' };

// ---------------------------------------------------------------- avatars & icons
function composeStand(exprId) {
  const W = standRig.width, H = standRig.height;
  const buf = new Float32Array(W * H * 4);
  const dir = path.join(LAYERED, 'stand');
  for (const l of standRig.layers) if (l.hidden) over(buf, W, H, readPng(path.join(dir, l.hidden.src)), l.hidden.x, l.hidden.y);
  for (const l of standRig.layers) if (l.visible) over(buf, W, H, readPng(path.join(dir, l.visible.src)), l.visible.x, l.visible.y);
  for (const piece of standRig.expressions[exprId] || []) over(buf, W, H, readPng(path.join(dir, piece.src)), piece.x, piece.y);
  return { buf, W, H };
}
const facesDir = path.join(OUT, 'faces');
mkdir(facesDir);
mkdir(APP_ASSETS);
const FACE = { x: 134, y: 40, size: 212 };
for (const id of expressionIds) {
  const { buf, W } = composeStand(id);
  const png = resampleRegion(buf, W, FACE.x, FACE.y, FACE.size, FACE.size, 128, 128);
  fs.writeFileSync(path.join(facesDir, `${id}.png`), PNG.sync.write(png));
}
console.log(`faces: ${expressionIds.length}`);

// App icon: round face medallion (berry ring) — generated, not copied from the old UI.
function medallion(size, exprId) {
  const { buf, W } = composeStand(exprId);
  const r = size / 2, ring = Math.max(1.5, size * 0.055), inner = r - ring;
  const face = resampleRegion(buf, W, FACE.x + 6, FACE.y + 4, FACE.size - 12, FACE.size - 12, size, size);
  const out = new PNG({ width: size, height: size });
  const berry = [214, 76, 112], cream = [255, 246, 238];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
    const o = (y * size + x) * 4;
    const outerA = Math.min(1, Math.max(0, r - d));          // anti-aliased disc
    const innerA = Math.min(1, Math.max(0, inner - d));
    // face over cream, inside inner disc
    const fa = face.data[o + 3] / 255;
    const fr = face.data[o] * fa + cream[0] * (1 - fa), fg = face.data[o + 1] * fa + cream[1] * (1 - fa), fb = face.data[o + 2] * fa + cream[2] * (1 - fa);
    out.data[o] = Math.round(fr * innerA + berry[0] * (1 - innerA));
    out.data[o + 1] = Math.round(fg * innerA + berry[1] * (1 - innerA));
    out.data[o + 2] = Math.round(fb * innerA + berry[2] * (1 - innerA));
    out.data[o + 3] = Math.round(outerA * 255);
  }
  return out;
}
fs.writeFileSync(path.join(APP_ASSETS, 'icon.png'), PNG.sync.write(medallion(256, '102')));
fs.writeFileSync(path.join(APP_ASSETS, 'icon-512.png'), PNG.sync.write(medallion(512, '102')));
fs.writeFileSync(path.join(APP_ASSETS, 'tray.png'), PNG.sync.write(medallion(32, '101')));
fs.writeFileSync(path.join(APP_ASSETS, 'tray@2x.png'), PNG.sync.write(medallion(64, '101')));
fs.writeFileSync(path.join(APP_ASSETS, 'tray-busy.png'), PNG.sync.write(medallion(32, '301')));
fs.writeFileSync(path.join(APP_ASSETS, 'tray-busy@2x.png'), PNG.sync.write(medallion(64, '301')));
{
  // Full standing preview (half resolution) for the panel.
  const { buf, W, H } = composeStand('101');
  const b = standRig.bounds;
  const png = resampleRegion(buf, W, b.x - 4, b.y - 2, b.width + 8, b.height + 4, Math.round((b.width + 8) / 2), Math.round((b.height + 4) / 2));
  fs.writeFileSync(path.join(OUT, 'stand-preview.png'), PNG.sync.write(png));
}

// ---------------------------------------------------------------- per-frame bounds
// [x0, y0, x1, y1, topX] per frame (topX = mean x of opaque pixels in the 30 rows
// below the top edge, used as the speech-bubble anchor) + a padded union crop so
// the runtime can decode only the useful region of each frame.
function frameInfo(file) {
  const { width, height, data } = PNG.sync.read(fs.readFileSync(file));
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  let sx = 0, n = 0;
  for (let y = y0; y < Math.min(height, y0 + 30); y++) for (let x = x0; x <= x1; x++) {
    if (data[(y * width + x) * 4 + 3] > 96) { sx += x; n++; }
  }
  return [x0, y0, x1, y1, n ? Math.round(sx / n) : Math.round((x0 + x1) / 2)];
}
function sequenceInfo(dir, frames, width, height) {
  const info = [];
  for (let i = 0; i < frames; i++) info.push(frameInfo(path.join(dir, `frame-${pad3(i)}.png`)));
  const pad = 4;
  const ux0 = Math.max(0, Math.min(...info.map((f) => f[0])) - pad), uy0 = Math.max(0, Math.min(...info.map((f) => f[1])) - pad);
  const ux1 = Math.min(width - 1, Math.max(...info.map((f) => f[2])) + pad), uy1 = Math.min(height - 1, Math.max(...info.map((f) => f[3])) + pad);
  return { bounds: info, crop: [ux0, uy0, ux1 - ux0 + 1, uy1 - uy0 + 1] };
}
const seqInfoCache = path.join(APP, 'assets', '.seqinfo.json');
const seqInfo = fs.existsSync(seqInfoCache) && !argv.includes('--rescan') ? readJson(seqInfoCache) : {};
const infoFor = (key, dir, frames, w, h) => {
  if (!seqInfo[key]) { seqInfo[key] = sequenceInfo(dir, frames, w, h); process.stdout.write(`  scanned ${key}\n`); }
  return seqInfo[key];
};
console.log('scanning sequence bounds…');
const walkInfo = infoFor('walk-right', path.join(PROD, 'walk-right', 'frames'), 64, 640, 1000);
const walkLeftInfo = infoFor('walk-left', path.join(PROD, 'walk-left', 'frames'), 64, 640, 1000);
const trInfo = {};
for (const id of CLIP_IDS) trInfo[id] = infoFor(`tr:${id}`, path.join(PROD, 'transitions-v5', id), clipsJson.clips[id].frames, clipsJson.width, clipsJson.height);
fs.writeFileSync(seqInfoCache, JSON.stringify(seqInfo));

// ---------------------------------------------------------------- manifest
const interaction = readJson(path.join(MAPS, 'interaction-reference.json'));
const rigEntry = (pose, family) => {
  const rig = readJson(path.join(LAYERED, pose, 'rig.json'));
  return { rig: `rigs/${pose}/rig.json`, width: rig.width, height: rig.height, scale: K[family], baseline: BASE[family], originX: rig.width / 2, family };
};
const rigs = {
  stand: rigEntry('stand', 'stand'),
  sit: rigEntry('sit', 'sit'),
  sleep: rigEntry('sleep', 'sleep'),
};

const WALK_ORIGIN_X = 359; // aligns walk face (345,220) with the standing face column (anchor x 240 of 508)
const transitions = {};
for (const id of CLIP_IDS) {
  const c = clipsJson.clips[id];
  transitions[id] = {
    path: `seq/tr/${id}/frame-{i}.png`, frames: c.frames, width: clipsJson.width, height: clipsJson.height,
    baseline: BASE.tr, originX: clipsJson.width / 2, scale: K.tr, duration: c.duration,
    from: c.from, to: c.to, preMirrored: !!c.preMirrored, internal: !!c.internal, gaitFrom: c.gaitFrom ?? null,
    crop: trInfo[id].crop, bounds: trInfo[id].bounds,
  };
}
// Rig head-top anchors (native coords of each rig canvas) for the speech bubble.
const rigAnchor = (pose) => {
  const rig = readJson(path.join(LAYERED, pose, 'rig.json'));
  const head = rig.layers.find((l) => l.id === 'headband' && l.visible) || rig.layers.find((l) => l.id === 'head' && l.visible);
  return head ? [Math.round(head.visible.x + head.visible.width / 2), head.visible.y] : [rig.width / 2, rig.bounds?.y ?? 0];
};
for (const id of Object.keys(rigs)) rigs[id].anchor = rigAnchor(id);
const manifest = {
  schema: 1,
  character: '御园莓华',
  generated: new Date().toISOString(),
  world: { unit: 'native px of approved standing art', standHeight: standArt.height, faceAnchor: standRig.anchor },
  scales: Object.fromEntries(Object.entries(K).filter(([k]) => !RETIRED(k))),
  rigs,
  sequences: {
    'walk-right': { path: 'seq/walk-right/frame-{i}.png', frames: 64, width: 640, height: 1000, baseline: BASE.walk, originX: WALK_ORIGIN_X, scale: K.walk, duration: 1.28, loop: true, facing: 1, rootMotion: walkMotion, passingFrames, crop: walkInfo.crop, bounds: walkInfo.bounds },
    'walk-left': { path: 'seq/walk-left/frame-{i}.png', frames: 64, width: 640, height: 1000, baseline: BASE.walk, originX: 640 - WALK_ORIGIN_X, scale: K.walk, duration: 1.28, loop: true, facing: -1, rootMotion: walkMotion, passingFrames, crop: walkLeftInfo.crop, bounds: walkLeftInfo.bounds },
  },
  transitions,
  expressions: {
    default: '101',
    catalogue: EXPRESSIONS,
    emotions: EMOTIONS,
    lipsync: LIPSYNC,
    blink: '602',
    facesDir: 'faces',
    faceCrop: FACE,
  },
  parts: Object.fromEntries(Object.entries(interaction.parts).filter(([k]) => !RETIRED(k))),
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('manifest written:', path.join(OUT, 'manifest.json'));

// The redrawn walk (art/walk-kit) replaces the handoff walk when its frames exist.
if (fs.existsSync(path.join(APP, 'art', 'walk-kit', 'out', '2-keys', 'W00.png')) && !argv.includes('--old-walk')) {
  console.log('applying redrawn walk from art/walk-kit …');
  await import('./walk-build.mjs');
}
