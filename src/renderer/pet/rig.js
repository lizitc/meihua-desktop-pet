// Layered rig renderer. Pieces of the original art are drawn as grid meshes in native
// canvas space, moved by a bone hierarchy (rotation about the authored pivots) and by
// smooth displacement fields (hair, skirt, eye warp) so neighbouring pieces never tear.
// Order: every hidden underpaint -> every visible piece -> one expression set.
//
// The pieces were cut from one flat illustration, so whatever a piece covered was only
// roughly completed. Motion therefore stays inside what the art supports:
//  - soft joints: a part bends out of its root (blending from the parent's transform near
//    the pivot to its own further along the bone) instead of turning as a rigid card, so
//    ears, arms, legs and tail stay attached and never uncover their roots;
//  - the hands hold the skirt hem: the cloth around each hand follows the hand, and the
//    skirt's own sway fades out there; the tail, tucked under the hem, rides with the hem;
//  - a neck band lets the head move without opening a seam at the collar, and the side
//    locks and the lower back hair are tied to both head and body;
//  - limits are asymmetric where the art allows more one way (lop ears swing outward,
//    never across the face), and they are soft (an elastic stop, not a hard bounce).
import { mat } from './gl.js';

const GRID = 24;
const MARGIN = 56;

const JOINTS = {
  head: { k: 70, c: 13, lim: 0.08 },
  torso: { k: 70, c: 14, lim: 0.03 },
  // lop ears: a flap that lifts much further than ~12° stops reading as hanging cloth (and uncovers the head)
  'ear-left': { k: 80, c: 7.5, min: -0.07, max: 0.22, noOver: true },
  'ear-right': { k: 80, c: 7.5, min: -0.22, max: 0.07, noOver: true },
  tail: { k: 42, c: 4.2, lim: 0.42 },
  'arm-upper-left': { k: 55, c: 9, lim: 0.04 },
  'arm-lower-left': { k: 60, c: 8, lim: 0.09 },
  'hand-left': { k: 70, c: 7, lim: 0.15 },
  'arm-upper-right': { k: 55, c: 9, lim: 0.04 },
  'arm-lower-right': { k: 60, c: 8, lim: 0.09 },
  'hand-right': { k: 70, c: 7, lim: 0.15 },
  'thigh-left': { k: 60, c: 9, lim: 0.055 },
  'shin-left': { k: 60, c: 8, lim: 0.07 },
  'foot-left': { k: 80, c: 7, lim: 0.18 },
  'thigh-right': { k: 60, c: 9, lim: 0.055 },
  'shin-right': { k: 60, c: 8, lim: 0.07 },
  'foot-right': { k: 80, c: 7, lim: 0.18 },
};
// Scalar springs driving displacement fields (values in native px).
const FIELDS = {
  hairL: { k: 26, c: 3.6, lim: 26 },
  hairR: { k: 24, c: 3.4, lim: 26 },
  hairFront: { k: 50, c: 6, lim: 8 },
  skirt: { k: 34, c: 4.6, lim: 7 },
  headDy: { k: 90, c: 14, lim: 6 },
  headDx: { k: 60, c: 12, lim: 5 },
  breath: { k: 0, c: 0, lim: 1 },
};
// Soft joints: [start, end] of the bend as fractions of the part's length along its bone.
const SOFT = {
  'ear-left': [0.16, 0.72], 'ear-right': [0.16, 0.72], tail: [0.15, 0.8],
  'arm-upper-left': [0.02, 0.45], 'arm-upper-right': [0.02, 0.45],
  'arm-lower-left': [0, 0.35], 'arm-lower-right': [0, 0.35],
  'hand-left': [0, 0.3], 'hand-right': [0, 0.3],
  'thigh-left': [0.06, 0.45], 'thigh-right': [0.06, 0.45],
  'shin-left': [0, 0.3], 'shin-right': [0, 0.3],
  'foot-left': [0, 0.35], 'foot-right': [0, 0.35],
};
const SKIRT = new Set(['skirt', 'apron', 'skirt-ruffles']);
// face expressions drawn with closed eyes (and 602, the blink drawing)
const CLOSED_EYES = new Set(['102', '102a', '103', '105', '105a', '302', '602']);
// Hidden underpaint is ~90% opaque; it is lifted to full opacity so exposed completions read as solid.
export const HIDDEN_ALPHA_GAIN = 1.16;
// Mesh cell size (native px): soft-bent parts and the skirt need finer cells so pieces drawn on top of each other
// (ear and bow, sleeve and cuff) bend identically.
const GRID_SOFT = 8, GRID_CLOTH = 12;

/**
 * Layers moved by a soft joint (the joint itself or a decoration hanging from it). Their hidden underpaint is split
 * into a solid fill and a thin seam rim (see Assets); the rim only fills antialiasing seams at rest, so it fades out
 * once the part has moved away from its neighbours.
 */
export function softLayers(json) {
  const byId = new Map(json.layers.map((l) => [l.id, l]));
  const out = new Set();
  for (const l of json.layers) {
    for (let cur = l.id; cur && cur !== 'head' && cur !== 'torso'; cur = byId.get(cur)?.parent) if (SOFT[cur]) { out.add(l.id); break; }
  }
  return out;
}

/** Map interaction-part ids to the rig reaction they drive. */
const PART_DRIVE = {
  'ear-left': { joint: 'ear-left', sign: 1 },
  'ear-right': { joint: 'ear-right', sign: -1 },
  tail: { joint: 'tail', sign: 1 },
  'hand-left': { joint: 'arm-lower-left', sign: 1, also: 'hand-left' },
  'hand-right': { joint: 'arm-lower-right', sign: -1, also: 'hand-right' },
  'leg-left': { joint: 'shin-left', sign: 1, also: 'foot-left' },
  'leg-right': { joint: 'shin-right', sign: -1, also: 'foot-right' },
  'calf-left': { joint: 'shin-left', sign: 1, also: 'foot-left' },
  'calf-right': { joint: 'shin-right', sign: -1, also: 'foot-right' },
  'thigh-left': { joint: 'thigh-left', sign: 1, also: 'shin-left' },
  'thigh-right': { joint: 'thigh-right', sign: -1, also: 'shin-right' },
  face: { field: 'headDy' },
  chest: { field: 'breathBump' },
  'foot-left': { joint: 'foot-left', sign: 1 },
  'foot-right': { joint: 'foot-right', sign: -1 },
  head: { field: 'headDy' },
  hair: { field: 'hair' },
  skirt: { field: 'skirt' },
  body: { field: 'breathBump' },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lo = (j) => (j.min ?? -j.lim);
const hi = (j) => (j.max ?? j.lim);

function gridMesh(renderer, rect, nx, ny) {
  const verts = (nx + 1) * (ny + 1);
  const base = new Float32Array(verts * 2);
  const uvs = new Float32Array(verts * 2);
  let i = 0;
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
    base[i] = rect.x + (rect.width * x) / nx; base[i + 1] = rect.y + (rect.height * y) / ny;
    uvs[i] = x / nx; uvs[i + 1] = y / ny; i += 2;
  }
  const idx = new Uint16Array(nx * ny * 6);
  let k = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const a = y * (nx + 1) + x, b = a + 1, c = a + nx + 1, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
  }
  return { gpu: renderer.mesh(uvs, idx), base, pos: new Float32Array(verts * 2) };
}

/** One step of a spring with an elastic (soft) stop at [min, max]. */
function springStep(s, h, min, max) {
  let acc = s.k * (clamp(s.t, min, max) - s.a) - s.c * s.v;
  if (s.a > max) acc -= s.k * 5 * (s.a - max) + s.c * 1.5 * s.v;
  else if (s.a < min) acc -= s.k * 5 * (s.a - min) + s.c * 1.5 * s.v;
  s.v += acc * h; s.a += s.v * h;
  const over = 0.22 * (max - min);
  if (s.a > max + over) { s.a = max + over; if (s.v > 0) s.v = 0; } else if (s.a < min - over) { s.a = min - over; if (s.v < 0) s.v = 0; }
}

export class Rig {
  constructor(renderer, id, def, json, textures) {
    this.renderer = renderer;
    this.id = id;
    this.def = def;
    this.json = json;
    this.W = json.width; this.H = json.height;
    this.margin = MARGIN;
    this.time = Math.random() * 100;
    this.nodes = new Map();
    for (const l of json.layers) {
      this.nodes.set(l.id, { id: l.id, group: l.group, parent: l.parent || null, pivot: l.pivot, rot: 0, sx: 1, sy: 1, dx: 0, dy: 0, m: mat.identity() });
    }
    this.order = this.#topo();
    this.joints = {};
    for (const [jid, cfg] of Object.entries(JOINTS)) if (this.nodes.has(jid)) this.joints[jid] = { ...cfg, a: 0, v: 0, t: 0, pull: false };
    this.fields = {};
    for (const [fid, cfg] of Object.entries(FIELDS)) this.fields[fid] = { ...cfg, a: 0, v: 0, t: 0 };
    /** Extra joint/field targets layered on top of the procedural ones (idle animations). */
    this.offsets = {};
    this.pieces = [];
    const soft = softLayers(json);
    const add = (layer, slot, kind, extra = {}) => {
      if (!slot) return;
      const tex = extra.tex || textures.get(slot.src);
      if (!tex) return;
      const eye = layer === 'eye-left' || layer === 'eye-right';
      const cell = soft.has(layer) ? GRID_SOFT : SKIRT.has(layer) || layer === 'head' ? GRID_CLOTH : GRID;
      // eyes: a fine mesh so the iris can slide while the lash line around it stays put
      const nx = eye ? 14 : Math.max(1, Math.ceil(slot.width / cell));
      const ny = eye ? 14 : Math.max(1, Math.ceil(slot.height / cell));
      const iris = eye ? json.irisByPiece?.[slot.src] || null : null;
      this.pieces.push({ layer, kind, tex, rect: slot, mesh: gridMesh(renderer, slot, nx, ny), iris, ...extra });
    };
    for (const l of json.layers) {
      add(l.id, l.hidden, 'hidden');
      if (l.hidden && textures.has(l.hidden.src + '#rim')) add(l.id, l.hidden, 'hidden', { tex: textures.get(l.hidden.src + '#rim'), rim: true });
    }
    for (const l of json.layers) add(l.id, l.visible, 'visible');
    this.expressions = {};
    for (const [exprId, list] of Object.entries(json.expressions || {})) {
      this.expressions[exprId] = [];
      for (const p of list) {
        const before = this.pieces.length;
        add(p.layer, p, 'expr', { expr: exprId });
        if (this.pieces.length > before) this.expressions[exprId].push(this.pieces.pop());
      }
    }
    this.hasFace = Object.keys(this.expressions).length > 0;
    this.#measure();
    this.#softSetup();
    this.grips = [];
    // expression state
    this.expr = this.hasFace ? (this.expressions['101'] ? '101' : Object.keys(this.expressions)[0]) : null;
    this.prevExpr = null; this.exprFade = 1;
    this.blink = { t: -1, next: 1.5 + Math.random() * 3, closed: 0, double: false };
    this.mouth = 0; this.mouthShape = null; this.mouthHold = 0;
    // eyes (x, y) react fast, the head (hx, hy) follows slowly; (jx, jy) small flicks while she holds a look
    this.gaze = { x: 0, y: 0, tx: 0, ty: 0, hx: 0, hy: 0, jx: 0, jy: 0, nextJ: 1 };
    this.mood = { wag: 0.25, ears: 0 };
    this.pull = null;
    this.target = null;
  }

  #topo() {
    const out = [], seen = new Set();
    const visit = (n) => { if (!n || seen.has(n.id)) return; if (n.parent) visit(this.nodes.get(n.parent)); seen.add(n.id); out.push(n); };
    for (const n of this.nodes.values()) visit(n);
    return out;
  }

  #measure() {
    const span = (pred) => {
      let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
      for (const p of this.pieces) if (pred(p.layer)) { y0 = Math.min(y0, p.rect.y); y1 = Math.max(y1, p.rect.y + p.rect.height); x0 = Math.min(x0, p.rect.x); x1 = Math.max(x1, p.rect.x + p.rect.width); }
      return Number.isFinite(y0) ? { x0, x1, y0, y1 } : null;
    };
    this.hairSpan = span((l) => l.startsWith('hair-back'));
    this.skirtSpan = span((l) => SKIRT.has(l));
    const head = this.nodes.get('head');
    this.headPivot = head ? head.pivot : [this.W / 2, this.H / 3];
    const eyes = {};
    for (const side of ['eye-left', 'eye-right']) {
      const l = this.json.layers.find((x) => x.id === side && x.visible);
      if (!l) continue;
      const v = l.visible;
      const e = { cx: v.x + v.width / 2, cy: v.y + v.height * 0.56, rx: v.width * 0.5, ry: v.height * 0.5, lid: v.y + v.height * 0.62 };
      // the iris (scripts/eye-irises.mjs); without it, an estimate in the middle of the piece
      const ir = this.json.irises?.[side];
      e.iris = ir ? { ...ir } : { cx: e.cx, cy: e.cy, rx: v.width * 0.26, ry: v.height * 0.27 };
      // how far the iris may travel (native px): sideways ~13 % of the eye, less upward (the lid is right above)
      e.travel = { x: v.width * 0.13, up: v.height * 0.035, down: v.height * 0.055 };
      eyes[side] = e;
    }
    this.eyes = eyes;
  }

  /** Per layer: the soft joint that moves it (itself or its nearest jointed ancestor below the trunk). */
  #softSetup() {
    const rectOf = (lid) => this.json.layers.find((l) => l.id === lid)?.visible || null;
    const joints = new Map();
    for (const [jid, [f0, f1]] of Object.entries(SOFT)) {
      const n = this.nodes.get(jid), r = rectOf(jid);
      if (!n || !r || !this.joints[jid]) continue;
      const [px, py] = n.pivot;
      let dx = r.x + r.width / 2 - px, dy = r.y + r.height / 2 - py;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) { dx = 0; dy = 1; } else { dx /= len; dy /= len; }
      let L = 1;
      for (const [cx, cy] of [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]]) L = Math.max(L, (cx - px) * dx + (cy - py) * dy);
      joints.set(jid, { id: jid, parent: n.parent ? this.nodes.get(n.parent) : null, px, py, dx, dy, r0: f0 * L, r1: Math.max(f0 * L + 4, f1 * L) });
    }
    this.soft = new Map();
    for (const l of this.json.layers) {
      for (let cur = l.id; cur && cur !== 'head' && cur !== 'torso'; cur = this.nodes.get(cur)?.parent) {
        if (joints.has(cur)) { this.soft.set(l.id, joints.get(cur)); break; }
      }
    }
    this.handRects = {};
    for (const side of ['left', 'right']) { const r = rectOf(`hand-${side}`); if (r && this.soft.has(`hand-${side}`)) this.handRects[side] = r; }
  }

  // ------------------------------------------------------------ public controls
  setExpression(id) {
    if (!this.hasFace || !this.expressions[id] || id === this.expr) return;
    this.prevExpr = this.expr; this.expr = id; this.exprFade = 0;
  }

  triggerBlink(double = false) { if (this.hasFace && this.blink.t < 0) { this.blink.t = 0; this.blink.double = double; } }

  setGaze(x, y) { this.gaze.tx = clamp(x, -1, 1); this.gaze.ty = clamp(y, -1, 1); }

  /** level 0..1 drives the mouth piece choice for lip-sync. */
  setMouth(level) { this.mouth = clamp(level, 0, 1); }

  /** Kick a joint toward its positive (sign > 0) or negative limit; amt 1 reaches about the limit. */
  kick(id, sign, amt = 1) {
    const j = this.joints[id];
    if (!j) return;
    const range = sign > 0 ? hi(j) : -lo(j);
    j.v += sign * amt * Math.sqrt(j.k) * range * 1.1;
  }

  poke(partId, strength = 1, side = 0) {
    const d = PART_DRIVE[partId];
    if (!d) return;
    const s = clamp(strength, 0.2, 1.6);
    if (d.joint && this.joints[d.joint]) {
      this.kick(d.joint, d.sign, s);
      if (d.also) this.kick(d.also, d.sign, s * 0.9);
    } else if (d.field === 'headDy') { this.fields.headDy.v += 40 * s; if (this.joints.head) this.joints.head.v += (side || 0.5) * 0.45 * s; }
    else if (d.field === 'hair') { const f = side < 0 ? this.fields.hairL : this.fields.hairR; f.v += 90 * s * (side < 0 ? -1 : 1); }
    else if (d.field === 'skirt') { this.fields.skirt.v += 30 * s * (side || 1); }
    else if (d.field === 'breathBump') { this.fields.headDy.v -= 22 * s; }
  }

  /** Start/continue pulling a part toward a native-space point. */
  pullPart(partId, grab, point) {
    const d = PART_DRIVE[partId];
    if (!d) return;
    this.pull = { partId, d, grab, point };
  }

  releasePull() { this.pull = null; }

  // ------------------------------------------------------------ simulation
  update(dt, env = {}) {
    this.time += dt;
    const t = this.time;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    // procedural targets
    const g = this.gaze;
    // micro-saccades: every second or two the eyes flick a little around the point they look at
    g.nextJ -= dt;
    if (g.nextJ <= 0) {
      g.nextJ = 0.7 + Math.random() * 1.6;
      g.jx = (Math.random() - 0.5) * 0.12; g.jy = (Math.random() - 0.5) * 0.08;
    }
    const ek = 1 - Math.exp(-dt * (env.gazeSpeed || 15));
    const hk = 1 - Math.exp(-dt * (env.headSpeed || 3.2));
    g.x += (clamp(g.tx + g.jx, -1, 1) - g.x) * ek; g.y += (clamp(g.ty + g.jy, -1, 1) - g.y) * ek;
    g.hx += (g.tx - g.hx) * hk; g.hy += (g.ty - g.hy) * hk;
    const sleeping = !!env.sleeping;
    const accX = env.rootAccX || 0;
    const velX = env.rootVelX || 0;
    const wind = Math.sin(t * 0.9) * 0.5 + Math.sin(t * 2.3 + 1.3) * 0.3 + Math.sin(t * 0.37) * 0.4;

    const J = this.joints, F = this.fields;
    for (const j of Object.values(J)) { j.t = 0; j.pull = false; }
    // the head turns toward the look (slower and less than the eyes) and nods a little up / down with it
    if (J.head) J.head.t = g.hx * 0.055 + (env.headTilt || 0) + Math.sin(t * 0.7) * 0.006;
    F.headDx.t = g.hx * 3.6; F.headDy.t = (env.headDrop || 0) + g.hy * 2.6;
    const earBase = this.mood.ears; // + down / - perk
    if (J['ear-left']) J['ear-left'].t = -earBase * 0.12 + Math.sin(t * 1.3) * 0.015;
    if (J['ear-right']) J['ear-right'].t = earBase * 0.12 + Math.sin(t * 1.1 + 2) * 0.015;
    if (J.tail) {
      const wag = sleeping ? 0.05 : this.mood.wag;
      const freq = 0.6 + wag * 2.6;
      J.tail.t = Math.sin(t * freq * Math.PI * 2) * (0.06 + wag * 0.32);
    }
    const dangle = env.dangle || 0;
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? 1 : -1;
      const sway = Math.sin(t * 1.4 + (side === 'left' ? 0 : 1.7));
      if (J[`arm-upper-${side}`]) J[`arm-upper-${side}`].t = sway * 0.008 + dangle * sign * 0.025 - velX * 0.00002;
      // while held up, both legs swing together like one pendulum (a gap opening between them would uncover the art)
      if (J[`thigh-${side}`]) J[`thigh-${side}`].t = dangle * (Math.sin(t * 2.6) * 0.035 + Math.sin(t * 3.7 + sign) * 0.006) - velX * 0.00004 * dangle;
      if (J[`shin-${side}`]) J[`shin-${side}`].t = dangle * (0.03 + Math.sin(t * 2.6 - 0.6) * 0.02);
    }
    // the lower hair is tied to the head: it follows the head's sideways motion a little late
    const headSide = (J.head ? J.head.a * 140 : 0) + F.headDx.a * 1.2;
    F.hairL.t = wind * 1.2 - velX * 0.006 + headSide * 0.55; F.hairR.t = wind * 1.0 - velX * 0.006 + headSide * 0.55;
    F.hairFront.t = wind * 0.4 + headSide * 0.25; F.skirt.t = wind * 0.35 - velX * 0.006;
    if (env.flying) {
      // thrown: the lop ears lift while she drops and the cloth flutters in the airflow
      const lift = Math.max(-1, Math.min(1, (env.rootVelY || 0) / 2600));
      const air = Math.min(1, Math.hypot(velX, env.rootVelY || 0) / 5000);
      if (J['ear-left']) J['ear-left'].t += lift * 0.3;
      if (J['ear-right']) J['ear-right'].t -= lift * 0.3;
      F.skirt.t += Math.sin(t * 15) * air * 3;
      F.hairL.t += Math.sin(t * 11) * air * 2.5; F.hairR.t += Math.sin(t * 12 + 1) * air * 2.5;
    }
    for (const [id, v] of Object.entries(this.offsets)) { if (J[id]) J[id].t += v; else if (F[id]) F[id].t += v; }
    // breathing (handled kinematically)
    const breathRate = sleeping ? 0.22 : 0.3;
    F.breath.a = Math.sin(t * Math.PI * 2 * breathRate) * (sleeping ? 1.6 : 1) * (env.breathScale ?? 1);

    // external torque from body motion
    const headPrevV = J.head ? J.head.v : 0;
    // pulls override joint targets
    if (this.pull) this.#applyPull();

    for (let s = 0; s < steps; s++) {
      for (const j of Object.values(J)) { const m = j.pull && !j.noOver ? 1.25 : 1; springStep(j, h, lo(j) * m, hi(j) * m); }
      for (const [name, f] of Object.entries(F)) if (name !== 'breath') springStep(f, h, -f.lim, f.lim);
    }
    // secondary motion: head angular acceleration & body acceleration excite hair/ears
    const headAcc = J.head ? (J.head.v - headPrevV) / Math.max(dt, 1e-3) : 0;
    F.hairL.v += (-accX * 0.012 - headAcc * 3) * dt;
    F.hairR.v += (-accX * 0.012 - headAcc * 3) * dt;
    F.skirt.v += -accX * 0.01 * dt;
    if (J['ear-left']) J['ear-left'].v += (accX * 0.0016 + headAcc * 0.25) * dt;
    if (J['ear-right']) J['ear-right'].v += (accX * 0.0016 + headAcc * 0.25) * dt;
    if (J.tail) J.tail.v += -accX * 0.002 * dt;

    // random ear twitch (outward: the way lop ears flick)
    if (!sleeping && Math.random() < dt * 0.08) {
      const side = Math.random() < 0.5 ? 'ear-left' : 'ear-right';
      this.kick(side, side === 'ear-left' ? 1 : -1, 0.35 + Math.random() * 0.3);
    }

    // expressions / blink / mouth
    if (this.exprFade < 1) this.exprFade = Math.min(1, this.exprFade + dt / 0.14);
    const b = this.blink;
    if (this.hasFace && !sleeping) {
      if (b.t < 0) {
        b.next -= dt;
        if (b.next <= 0 && !env.noBlink) { b.t = 0; b.double = !b.secondOf && Math.random() < 0.18; b.secondOf = false; }
      }
      if (b.t >= 0) {
        b.t += dt;
        const D = 0.2;
        const ph = b.t / D;
        b.closed = ph < 0.4 ? smooth(0, 0.4, ph) : ph < 0.62 ? 1 : 1 - smooth(0.62, 1, ph);
        if (ph >= 1) {
          b.closed = 0;
          b.t = -1;
          b.next = b.double ? 0.11 : 2.2 + Math.random() * 4.5;
          b.secondOf = b.double;
          b.double = false;
        }
      }
    } else b.closed = 0;
    this.mouthHold -= dt;
    if (this.mouthHold <= 0) {
      const m = this.mouth;
      const shape = m < 0.12 ? null : m < 0.42 ? 'half' : 'open';
      if (shape !== this.mouthShape) { this.mouthShape = shape; this.mouthHold = 0.055; }
    }
  }

  #applyPull() {
    const { d, grab, point } = this.pull;
    if (d.joint && this.joints[d.joint]) {
      const j = this.joints[d.joint];
      const node = this.nodes.get(d.joint);
      const [px, py] = mat.apply(this.#parentMatrix(node), node.pivot[0], node.pivot[1]);
      const a0 = Math.atan2(grab[1] - py, grab[0] - px), a1 = Math.atan2(point[1] - py, point[0] - px);
      let da = a1 - a0; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      // the ears give way softly (saturating) instead of stopping hard at the limit
      j.t = j.noOver ? (da > 0 ? hi(j) * Math.tanh(da / hi(j)) : lo(j) * Math.tanh(da / lo(j))) : clamp(da, lo(j) * 1.25, hi(j) * 1.25);
      j.pull = true;
      if (d.also && this.joints[d.also]) { const k = this.joints[d.also]; k.t = clamp(da * 0.8, lo(k) * 1.25, hi(k) * 1.25); k.pull = true; }
    } else if (d.field === 'hair') {
      const dx = clamp(point[0] - grab[0], -40, 40);
      const f = grab[0] < this.headPivot[0] ? this.fields.hairL : this.fields.hairR;
      f.t = dx * 0.6;
    } else if (d.field === 'skirt') this.fields.skirt.t = clamp(point[0] - grab[0], -30, 30) * 0.22;
    else if (d.field === 'headDy') { this.fields.headDy.t = clamp(point[1] - grab[1], -5, 6); if (this.joints.head) this.joints.head.t = clamp((point[0] - grab[0]) * 0.002, -0.07, 0.07); }
  }

  #parentMatrix(node) {
    const p = node.parent && this.nodes.get(node.parent);
    return p ? p.m : mat.identity();
  }

  // ------------------------------------------------------------ geometry
  #pose() {
    const F = this.fields;
    for (const n of this.order) {
      const j = this.joints[n.id];
      let rot = j ? j.a : 0, sx = 1, sy = 1, dx = 0, dy = 0;
      if (n.id === 'torso') sy = 1 + F.breath.a * 0.0065;
      if (n.id === 'head') { dx = F.headDx.a; dy = F.headDy.a - F.breath.a * 0.6; }
      const local = mat.about(n.pivot[0], n.pivot[1], rot, sx, sy, dx, dy);
      n.m = n.parent && this.nodes.get(n.parent) ? mat.mul(this.nodes.get(n.parent).m, local) : local;
    }
    // where each hand holds the hem: the cloth around it follows the hand
    this.grips = [];
    for (const [side, r] of Object.entries(this.handRects)) {
      const id = `hand-${side}`;
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const p = this.#softPos(this.soft.get(id), id, cx, cy, cx, cy);
      const s = Math.max(r.width, r.height) * 0.8;
      this.grips.push({ x: cx, y: cy, dx: p[0] - cx, dy: p[1] - cy, s2: s * s });
    }
  }

  /** Position of rest point (x, y) (deformed to (px, py) before skinning) on a soft-jointed layer. */
  #softPos(s, layer, x, y, px, py) {
    const m = this.nodes.get(layer).m;
    const ax = m[0] * px + m[2] * py + m[4], ay = m[1] * px + m[3] * py + m[5];
    const w = smooth(s.r0, s.r1, (x - s.px) * s.dx + (y - s.py) * s.dy);
    if (w >= 1) return [ax, ay];
    const P = s.parent ? s.parent.m : null;
    const bx = P ? P[0] * px + P[2] * py + P[4] : px, by = P ? P[1] * px + P[3] * py + P[5] : py;
    return [bx + (ax - bx) * w, by + (ay - by) * w];
  }

  /** Skirt displacement at rest point (x, y): its sway, faded out where the hands hold it, plus the hands' pull. */
  #skirtDisp(x, y) {
    const F = this.fields, ss = this.skirtSpan;
    const u = clamp((y - ss.y0) / (ss.y1 - ss.y0), 0, 1);
    const cx = (ss.x0 + ss.x1) / 2, half = (ss.x1 - ss.x0) / 2;
    const nx = (x - cx) / half;
    let dx = F.skirt.a * Math.pow(u, 1.5) + Math.sin(nx * 3.1 + this.time * 2.4) * 0.6 * u * u;
    let dy = Math.cos(nx * 4 - this.time * 2) * 0.4 * u * u + Math.abs(F.skirt.a) * 0.05 * u * Math.sign(nx || 1) * nx;
    let gs = 0, gx = 0, gy = 0;
    for (const g of this.grips) {
      const k = Math.exp(-((x - g.x) ** 2 + (y - g.y) ** 2) / g.s2);
      gs += k; gx += k * g.dx; gy += k * g.dy;
    }
    if (gs > 1) { gx /= gs; gy /= gs; gs = 1; }
    return [dx * (1 - gs) + gx, dy * (1 - gs) + gy];
  }

  /** Deform a rest-space point belonging to `layer` and return its posed position. */
  #point(layer, x, y, out, o) {
    const F = this.fields;
    let px = x, py = y;
    // eye: the iris slides with the gaze inside a fixed lash line; blink squash
    if ((layer === 'eye-left' || layer === 'eye-right') && this.eyes[layer] && !this.eyesShut) {
      const e = this.eyes[layer], ir = this.pieceIris || e.iris;
      const nx = (x - e.cx) / e.rx, ny = (y - e.cy) / e.ry;
      const r2 = nx * nx + ny * ny;
      if (r2 < 1) {
        // weight 1 over the iris, fading out across the white; 0 at the piece outline and on the lashes above
        const di = Math.hypot((x - ir.cx) / (ir.rx * 1.12), (y - ir.cy) / (ir.ry * 1.12));
        const top = smooth(ir.cy - ir.ry * 1.4, ir.cy - ir.ry * 0.9, y);
        const w = (1 - smooth(1, 1.9, di)) * (1 - smooth(0.74, 0.98, Math.sqrt(r2))) * top;
        const gx = this.gaze.x, gy = this.gaze.y;
        px += gx * e.travel.x * w;
        py += (gy < 0 ? gy * e.travel.up : gy * e.travel.down) * w;
        const squash = this.blink.closed * 0.62;
        const ww = (1 - r2) * (1 - r2);
        if (squash > 0) py = e.lid + (py - e.lid) * (1 - squash * (0.35 + 0.65 * ww));
      }
    }
    const node = this.nodes.get(layer);
    const head = this.nodes.get('head'), torso = this.nodes.get('torso');
    let X, Y;
    if (layer.startsWith('hair-back') && this.hairSpan) {
      // seamless back hair: blend head and torso bones along the strand + sway field
      const hs = this.hairSpan;
      const u = clamp((y - hs.y0) / (hs.y1 - hs.y0), 0, 1);
      const sway = (layer.startsWith('hair-back-left') ? F.hairL.a : F.hairR.a) * Math.pow(u, 1.7);
      const lx = px + sway, ly = py - Math.abs(sway) * 0.08 * u;
      const wHead = 1 - smooth(hs.y0 + 60, hs.y0 + 260, y);
      const a = mat.apply(head ? head.m : mat.identity(), lx, ly);
      const b = mat.apply(torso ? torso.m : mat.identity(), lx, ly);
      X = a[0] * wHead + b[0] * (1 - wHead); Y = a[1] * wHead + b[1] * (1 - wHead);
    } else if ((layer === 'hair-front-left' || layer === 'hair-front-right') && head) {
      // side locks hang from the head but rest on the chest: the top follows the head, the tips mostly the body
      const top = this.headPivot[1] - 80;
      const u = clamp((y - top) / 220, 0, 1);
      const lx = px + F.hairFront.a * u * u * (layer === 'hair-front-left' ? 1 : 0.8);
      const wBody = torso ? smooth(this.headPivot[1] - 24, this.headPivot[1] + 52, y) * 0.85 : 0;
      const a = mat.apply(head.m, lx, py), b = torso ? mat.apply(torso.m, lx, py) : a;
      X = a[0] + (b[0] - a[0]) * wBody; Y = a[1] + (b[1] - a[1]) * wBody;
    } else if (layer === 'head' && head && torso) {
      // neck band: the bottom of the head piece (neck) stays with the body, the face moves with the head
      const w = smooth(-6, 22, this.headPivot[1] - y);
      const a = mat.apply(head.m, px, py);
      if (w >= 1) { X = a[0]; Y = a[1]; } else { const b = mat.apply(torso.m, px, py); X = b[0] + (a[0] - b[0]) * w; Y = b[1] + (a[1] - b[1]) * w; }
    } else if (this.skirtSpan && SKIRT.has(layer)) {
      const d = this.#skirtDisp(x, y);
      const m = node ? node.m : mat.identity();
      X = m[0] * (px + d[0]) + m[2] * (py + d[1]) + m[4]; Y = m[1] * (px + d[0]) + m[3] * (py + d[1]) + m[5];
    } else if (this.soft.has(layer)) {
      [X, Y] = this.#softPos(this.soft.get(layer), layer, x, y, px, py);
      if (layer === 'tail' && this.skirtSpan) { const d = this.#skirtDisp(x, y); X += d[0]; Y += d[1]; }
    } else if (node) {
      const m = node.m;
      X = m[0] * px + m[2] * py + m[4]; Y = m[1] * px + m[3] * py + m[5];
    } else { X = px; Y = py; }
    out[o] = (X + this.margin) * this.q;
    out[o + 1] = (Y + this.margin) * this.q;
  }

  /** Seam rims of a moving part fade out between 1.2 and 4.5 px of displacement (they only fit the rest pose). */
  #rimAlpha(p) {
    const s = this.soft.get(p.layer);
    if (!s) return 1;
    const cx = p.rect.x + p.rect.width / 2, cy = p.rect.y + p.rect.height / 2;
    const q = this.#softPos(s, p.layer, cx, cy, cx, cy);
    let dx = q[0] - cx, dy = q[1] - cy;
    if (p.layer === 'tail' && this.skirtSpan) { const d = this.#skirtDisp(cx, cy); dx += d[0]; dy += d[1]; }
    return 1 - smooth(1.2, 4.5, Math.hypot(dx, dy));
  }

  #drawPiece(r, piece, alpha = 1) {
    const { base, pos, gpu } = piece.mesh;
    // closed eyes (smiling arcs, the blink drawing) have no iris to move
    this.eyesShut = piece.kind === 'expr' && CLOSED_EYES.has(piece.expr);
    this.pieceIris = piece.iris;
    for (let i = 0; i < base.length; i += 2) this.#point(piece.layer, base[i], base[i + 1], pos, i);
    r.drawMesh(gpu, pos, piece.tex, alpha);
  }

  #exprPieces(id) {
    const list = this.expressions[id];
    if (!list) return [];
    const out = [];
    const blinkSrc = this.blink.closed > 0.55 ? this.expressions['602'] : null;
    const mouthSrc = this.mouthShape ? this.expressions[this.#mouthExpr(id)] : null;
    for (const p of list) {
      if (blinkSrc && (p.layer === 'eye-left' || p.layer === 'eye-right') && !CLOSED_EYES.has(id)) {
        out.push(blinkSrc.find((q) => q.layer === p.layer) || p);
      } else if (mouthSrc && p.layer === 'mouth') out.push(mouthSrc.find((q) => q.layer === 'mouth') || p);
      else out.push(p);
    }
    return out;
  }

  #mouthExpr(id) {
    const happy = ['102', '102a', '103', '105', '105a'];
    const excited = ['401', '401a', '403', '403a', '402', '402a'];
    if (this.mouthShape === 'open') return happy.includes(id) ? '105' : excited.includes(id) ? '401' : ['501', '502', '701', '701a'].includes(id) ? '502' : ['901', '902'].includes(id) ? '902' : '104';
    return happy.includes(id) ? '105' : ['901', '902'].includes(id) ? '902' : '604';
  }

  /** Size of the off-screen canvas for quality factor q. */
  targetSize(q) { return { w: (this.W + this.margin * 2) * q, h: (this.H + this.margin * 2) * q }; }

  render(r, target, q) {
    this.q = q;
    this.#pose();
    r.begin(target, true);
    r.blend('normal');
    for (const p of this.pieces) {
      if (p.kind !== 'hidden') continue;
      const a = p.rim ? this.#rimAlpha(p) : 1;
      if (a > 0.01) this.#drawPiece(r, p, a);
    }
    for (const p of this.pieces) if (p.kind === 'visible') this.#drawPiece(r, p);
    if (this.hasFace) {
      if (this.prevExpr && this.exprFade < 1) {
        for (const p of this.#exprPieces(this.prevExpr)) this.#drawPiece(r, p);
        for (const p of this.#exprPieces(this.expr)) this.#drawPiece(r, p, this.exprFade);
      } else for (const p of this.#exprPieces(this.expr)) this.#drawPiece(r, p);
    }
    r.end(target);
  }

  /** Posed position (native rig space) of a rest-space point on a layer. */
  posed(layer, x, y) {
    const out = [0, 0];
    const q = this.q || 1;
    this.q = 1;
    const m = this.margin; this.margin = 0;
    this.#point(layer, x, y, out, 0);
    this.margin = m; this.q = q;
    return out;
  }
}
