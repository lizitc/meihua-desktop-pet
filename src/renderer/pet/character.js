// Character controller: pose graph, locomotion, drag/fall physics and compositing.
// World unit = native px of the standing art; screen = CSS px (DIP) of the pet window.
import { mat } from './gl.js';

const RIG_FOR = { stand: 'stand', sit: 'sit', sleep: 'sleep' };
const ORDER = ['sit', 'sleep'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => t * t * (3 - 2 * t);

class Cancelled extends Error {}

export class Character {
  constructor(renderer, assets, manifest) {
    this.r = renderer;
    this.a = assets;
    this.m = manifest;
    this.pose = 'stand';
    this.facing = 1;              // heading for walking and orientation of sit/sleep
    this.mode = 'idle';
    this.view = { kind: 'rig', id: 'stand', mirror: false };
    this.fade = null;
    this.geom = { W: 420, H: 600, footX: 210, footY: 590, scale: 0.36 };
    this.root = { x: 0, y: 0 };
    this.displays = [];
    this.body = { y: 0, vy: 0, sy: 1, vsy: 0, sx: 1, vsx: 0, rot: 0, vrot: 0, flip: 1, pivotY: 0, lean: 0, rise: 0 };
    this.dragTrail = [];           // recent drag samples for the release velocity
    this.fly = null;               // flight after a fling: { bounces, ceilArmed, t }
    this.vel = { x: 0, y: 0 }; this.prevVelX = 0; this.accX = 0;
    this.walkStride = 1;          // stride stretch of the current/last walk (root motion multiplier)
    this.targets = new Map();
    this.frameNo = 0;
    this.rendered = new Map();
    this.env = { gazeX: 0, gazeY: 0, mood: { wag: 0.25, ears: 0 } };
    this.token = { cancelled: false };
    this.waiters = [];
    this.onRoot = () => {};
    this.flags = { gravity: true, allowMove: true, sink: false };
    this.anim = null;           // per-frame driver for the current mode
    this.lastAnchor = null;
  }

  // ------------------------------------------------------------ geometry
  setGeometry(g) { this.geom = { ...this.geom, ...g }; }
  setDisplays(d) { this.displays = d || []; }

  get s() { return this.geom.scale; }

  displayAt(x, y = this.root.y - 4) {
    let best = null, bestD = Infinity;
    for (const d of this.displays) {
      const b = d.bounds;
      const dx = x < b.x ? b.x - x : x > b.x + b.width ? x - b.x - b.width : 0;
      const dy = y < b.y ? b.y - y : y > b.y + b.height ? y - b.y - b.height : 0;
      const dd = dx + dy;
      if (dd < bestD) { bestD = dd; best = d; }
    }
    return best;
  }

  floorY() {
    const d = this.displayAt(this.root.x);
    return d ? d.workArea.y + d.workArea.height : this.root.y;
  }

  /** Feet below the taskbar line (only kept while flags.sink allows it; she climbs back up otherwise). */
  get sunk() { return this.root.y > this.floorY() + 0.5; }

  /** Window css y below which nothing is drawn (the taskbar edge) while she is tucked in below it; else null. */
  get clipY() {
    if (!this.sunk) return null;
    return this.floorY() - this.windowOrigin().y;
  }

  walkBounds() {
    const d = this.displayAt(this.root.x);
    if (!d) return [this.root.x - 300, this.root.x + 300];
    const m = 150 * this.s + 30;
    return [d.workArea.x + m, d.workArea.x + d.workArea.width - m];
  }

  /** Window origin (integer DIP) for the current root — mirrors the main process formula. */
  windowOrigin() {
    const o = { x: Math.round(this.root.x - this.geom.W / 2), y: Math.round(this.root.y - this.geom.footY) };
    // The OS moves the window asynchronously; while it lags a little, draw relative to
    // where the window actually is so the character stays put on screen.
    const sx = window.screenX, sy = window.screenY;
    if (Number.isFinite(sx) && Math.abs(sx - o.x) <= 40 && Math.abs(sy - o.y) <= 40) return { x: sx, y: sy };
    return o;
  }

  foot() {
    const o = this.windowOrigin();
    return { x: this.root.x - o.x, y: this.root.y - o.y + (this.body.y + this.body.rise) * this.s };
  }

  defOf(view) {
    if (view.kind === 'rig') return this.m.rigs[view.id];
    return this.a.seqDef(view.id);
  }

  /** Matrix mapping native coords of `view` to window CSS px. */
  viewMatrix(view) {
    const def = this.defOf(view);
    const k = def.scale * this.s;
    const f = this.foot();
    const mir = view.mirror ? -1 : 1;
    let m = [mir * k, 0, 0, k, f.x - mir * def.originX * k, f.y - def.baseline * k];
    // keyframe dissolve: the drawing is stretched about the ground line so its anchor meets the moving target
    if (view.warp) m = mat.mul(m, view.warp);
    const b = this.body;
    const rot = b.rot + b.lean;
    const sx = b.flip * b.sx * (1 + (b.ex || 0)), sy = b.sy * (1 + (b.ey || 0));
    if (rot || sx !== 1 || sy !== 1) {
      const pivotY = f.y - b.pivotY * this.s;
      m = mat.mul(mat.about(f.x, rot ? pivotY : f.y, rot, sx, sy), m);
    }
    return m;
  }

  // ------------------------------------------------------------ async plumbing
  #tick() { return new Promise((res) => this.waiters.push(res)); }

  async #frames(token, fn) {
    // run fn(dt) every frame until it returns true
    for (;;) {
      const dt = await this.#tick();
      if (token.cancelled) throw new Cancelled();
      if (fn(dt)) return;
    }
  }

  cancel() {
    this.token.cancelled = true;
    this.token = { cancelled: false };
    return this.token;
  }

  /** Run an exclusive action; cancels the previous one. Resolves false when interrupted. */
  get airborne() { return this.mode === 'drag' || this.mode === 'fall' || this.mode === 'fly'; }

  async run(fn) {
    if (this.airborne) return false;
    const token = this.cancel();
    this.#settle();
    try { await fn(token); return true; } catch (e) {
      if (!(e instanceof Cancelled)) { console.error(e); if (this.token === token) this.#settle(); }
      return false;
    }
  }

  /** Interrupt whatever is running and return to the resting view of the current pose. */
  stop() {
    if (this.airborne) return;
    this.cancel();
    this.#settle();
  }

  #settle() {
    this.body.flip = 1;
    if (this.mode === 'walk') this.pose = 'stand';
    if (this.mode !== 'idle') { this.mode = 'idle'; this.vel.x = 0; }
    if (this.view.kind === 'seq' && this.a.rig(RIG_FOR[this.pose])) this.setView(this.rigView(), 0.12);
  }

  wait(token, seconds) {
    let t = 0;
    return this.#frames(token, (dt) => (t += dt) >= seconds);
  }

  // ------------------------------------------------------------ views & fades
  setView(view, fadeDur = 0) {
    if (fadeDur > 0) this.fade = { from: this.view, t: 0, dur: fadeDur };
    else this.fade = null;
    this.view = view;
  }

  // Sitting and sleeping are drawn one way only (the bows belong on her right ear), so they are never mirrored.
  rigView(pose = this.pose) {
    return { kind: 'rig', id: RIG_FOR[pose], mirror: false };
  }

  get rig() { return this.view.kind === 'rig' ? this.a.rig(this.view.id) : null; }

  // ------------------------------------------------------------ transitions
  /** Legs from one pose to another along stand <-> sit <-> sleep: [{ clip, reverse, to }]. */
  route(from, to) {
    if (from === to) return [];
    const chain = ['stand', ...ORDER];
    const i = chain.indexOf(from), j = chain.indexOf(to);
    if (i < 0 || j < 0) return [];
    const legs = [];
    for (let k = i; k !== j; k += Math.sign(j - i)) {
      const a = chain[Math.min(k, k + Math.sign(j - i))], b = chain[Math.max(k, k + Math.sign(j - i))];
      legs.push({ clip: `${a}-${b}`, reverse: j < i, to: chain[k + Math.sign(j - i)] });
    }
    return legs;
  }

  async playClip(token, clip, { reverse = false, mirror = false, fadeIn = 0.1, speed = 1 } = {}) {
    await this.a.ensure(clip);
    if (token.cancelled) throw new Cancelled();
    const def = this.a.seqDef(clip);
    if (def.keys) return this.#playKeys(token, clip, def, reverse, fadeIn, speed);
    const n = def.frames;
    let t = 0;
    const dur = def.duration / speed;
    this.mode = 'transition';
    this.setView({ kind: 'seq', id: clip, frame: reverse ? n - 1 : 0, mirror }, fadeIn);
    await this.#frames(token, (dt) => {
      t += dt;
      const p = clamp(t / dur, 0, 1);
      const idx = Math.min(n - 1, Math.floor(p * (n - 1) + 0.5));
      this.view.frame = reverse ? n - 1 - idx : idx;
      return p >= 1;
    });
  }

  /**
   * Keyframe transition (def.keys): each drawing is held, then dissolves into the next. During a dissolve both drawings
   * are stretched about the ground line (feet / seat stay put) so their anchors (the neck bow) meet at a point that
   * travels from one to the other: the figure seems to move down / up instead of two figures cross-fading in place.
   */
  async #playKeys(token, clip, def, reverse, fadeIn, speed) {
    const n = def.frames, K = def.keys;
    const order = Array.from({ length: n }, (_, i) => (reverse ? n - 1 - i : i));
    const holds = order.map((f) => (K.holds?.[f] ?? 0) / speed);
    const blends = order.slice(0, -1).map((f, i) => (reverse ? K.blends[n - 2 - i] : K.blends[f]) / speed);
    const anchor = (f) => K.anchors?.[f] || null;
    const base = def.baseline;
    const warp = (A, T) => {
      if (!A || !T) return null;
      const span = base - A[1];
      if (span < 20) return null;
      const sy = clamp((base - T[1]) / span, 0.8, 1.25);
      const shx = clamp((T[0] - A[0]) / span, -0.35, 0.35);
      // x' = x - shx*(y - base), y' = base + (y - base)*sy
      return [1, 0, -shx, sy, shx * base, base * (1 - sy)];
    };
    this.mode = 'transition';
    // the rig hands over to the first drawing (the same picture) with a short fade
    this.setView({ kind: 'seq', id: clip, frame: order[0], mirror: false }, fadeIn);
    const segs = [];
    order.forEach((f, i) => {
      if (holds[i] > 0) segs.push({ kind: 'hold', f, dur: holds[i] });
      if (i < n - 1) segs.push({ kind: 'blend', a: f, b: order[i + 1], dur: Math.max(0.04, blends[i]) });
    });
    let si = 0, t = 0;
    const first = Math.max(fadeIn, 0.001);
    await this.wait(token, first * 0.6);
    await this.#frames(token, (dt) => {
      t += dt;
      while (si < segs.length && t >= segs[si].dur) { t -= segs[si].dur; si++; }
      if (si >= segs.length) {
        this.fade = null;
        this.view = { kind: 'seq', id: clip, frame: order[n - 1], mirror: false };
        return true;
      }
      const s = segs[si];
      if (s.kind === 'hold') { this.fade = null; this.view = { kind: 'seq', id: clip, frame: s.f, mirror: false }; return false; }
      const u = clamp(t / s.dur, 0, 1), e = ease(u);
      const A = anchor(s.a), B = anchor(s.b);
      const T = A && B ? [A[0] + (B[0] - A[0]) * e, A[1] + (B[1] - A[1]) * e] : null;
      this.view = { kind: 'seq', id: clip, frame: s.b, mirror: false, warp: warp(B, T) };
      this.fade = { from: { kind: 'seq', id: clip, frame: s.a, mirror: false, warp: warp(A, T) }, t: u * s.dur, dur: s.dur, manual: true };
      return false;
    });
  }

  async goPose(target, facing = this.facing, token = this.token) {
    if (this.pose === target && this.mode === 'idle') { if (target === 'stand') this.facing = facing; return; }
    const legs = this.route(this.pose, target);
    if (!legs.length) return;
    await this.a.loadRig(RIG_FOR[target]);
    for (const [i, leg] of legs.entries()) {
      await this.playClip(token, leg.clip, { reverse: leg.reverse, fadeIn: i ? 0.001 : 0.1 });
      this.pose = leg.to;
    }
    if (target === 'stand') this.facing = facing;
    this.mode = 'idle';
    this.setView(this.rigView(), 0.14);
  }

  /**
   * Heading only: standing she turns as she starts to walk (the turn drawings); sitting and lying she is drawn one way
   * only, so facing just sets where she heads once she gets up.
   */
  async turn(facing) {
    this.facing = facing;
  }

  // ------------------------------------------------------------ locomotion
  /**
   * Walk to x. The walk starts and ends on a passing frame (feet nearly together). With turn drawings
   * (def.turn) she first turns on the spot (standing art -> T1 -> T2 -> T3 -> walk model) and turns back at the end;
   * without them the standing art cross-fades into the walk. The stop is planned before the first step: the
   * passing frame whose arrival is nearest the target, with the stride stretched by up to STRETCH to land on it
   * (the root motion follows the stretch, so the planted foot still stays put) and never leaving the walk bounds.
   */
  async walkTo(x, token = this.token, { rate = 0.9 } = {}) {
    const [lo, hi] = this.walkBounds();
    const tx = clamp(x, lo, hi);
    if (Math.abs(tx - this.root.x) < 24) return;
    if (this.pose !== 'stand') await this.goPose('stand', this.facing, token);
    const dir = tx > this.root.x ? 1 : -1;
    const seq = dir > 0 ? 'walk-right' : 'walk-left';
    await this.a.ensure(seq);
    const def = this.a.seqDef(seq);
    let turnId = def.turn && this.a.seqDef(def.turn) ? def.turn : null;
    if (turnId) await this.a.ensure(turnId).catch((err) => { console.warn('[walk] turn', err.message); turnId = null; });
    if (token.cancelled) throw new Cancelled();
    const turn = turnId ? this.a.seqDef(turnId) : null;
    const motion = def.rootMotion;
    const n = def.frames;
    const k = def.scale * this.s;
    const fps = n / def.duration;
    const stops = def.entryFrames?.length ? def.entryFrames : def.passingFrames?.length ? def.passingFrames : [0, n / 2];
    // world distance covered while advancing `df` frames from phase `from` (unstretched)
    const advance = (from, df) => {
      let dist = 0, p = from, remain = df;
      while (remain > 1e-6) {
        const f = Math.floor(p + 1e-9) % n;
        const step = Math.min(remain, Math.floor(p + 1e-9) + 1 - p);
        dist += motion[f] * step; p += step; remain -= step;
      }
      return dist * k;
    };
    const plan = this.#planWalk(Math.abs(tx - this.root.x), dir, stops, n, advance, lo, hi);
    const f = plan.stretch;
    this.walkStride = f;
    this.facing = dir;
    this.mode = 'walk';
    if (turn) await this.#playTurn(token, turnId, turn, false);
    let phase = plan.entry, played = 0;
    // `travel` is the continuous position (velocity). The pet itself is drawn at the position of the frame on
    // screen (frame-locked root motion): it moves only when the drawing changes, by that frame's planted-foot
    // slide, so the supporting foot stays fixed on the desktop instead of drifting and snapping.
    let travel = this.root.x;
    const lockedX = () => {
      const fr = Math.floor(phase + 1e-6);
      return travel - dir * f * motion[fr % n] * Math.max(0, phase - fr) * k;
    };
    this.setView({ kind: 'seq', id: seq, frame: plan.entry, mirror: false }, turn ? 0 : 0.14);
    const slowOver = n / 2; // ease off over the last step
    let ramp = turn ? 0.3 : 0;
    await this.#frames(token, (dt) => {
      ramp = Math.min(1, ramp + dt / 0.45);
      let rr = rate * (0.45 + 0.55 * ease(ramp));
      const left = plan.frames - played;
      if (left < slowOver) rr *= 0.55 + 0.45 * (left / slowOver);
      const df = Math.min(dt * fps * rr, left);
      const dist = f * advance(phase, df);
      phase = (phase + df) % n;
      played += df;
      travel += dir * dist;
      this.root.x = lockedX();
      this.vel.x = (dir * dist) / Math.max(dt, 1e-3);
      this.view.frame = Math.floor(phase + 1e-6) % n;
      this.onRoot(this.root);
      return plan.frames - played <= 1e-6;
    });
    this.vel.x = 0;
    if (turn) await this.#playTurn(token, turnId, turn, true);
    this.mode = 'idle';
    this.pose = 'stand';
    this.setView(this.rigView('stand'), turn ? 0.05 : 0.22);
  }

  /** Entry frame, number of frames and stride stretch for a walk of `want` DIP (see walkTo). */
  #planWalk(want, dir, stops, n, advance, lo, hi) {
    const STRETCH = 0.12, x0 = this.root.x;
    let best = null;
    for (const entry of stops) {
      for (let frames = 1; frames <= n * 200; frames++) {
        if (!stops.includes((entry + frames) % n)) continue;
        const d = advance(entry, frames);
        const stretch = clamp(want / d, 1 - STRETCH, 1 + STRETCH);
        const end = x0 + dir * stretch * d, err = Math.abs(stretch * d - want);
        if (end >= lo - 12 && end <= hi + 12 && (!best || err < best.err - 1e-6)) best = { entry, frames, stretch, err };
        if (d * (1 - STRETCH) > want) break;
      }
    }
    if (best) return best;
    // a short walk ending at the screen edge: one step, shortened to fit
    const entry = stops[0];
    let frames = 1;
    while (!stops.includes((entry + frames) % n)) frames++;
    return { entry, frames, stretch: Math.max(0.5, want / advance(entry, frames)), err: 0 };
  }

  /** Turn on the spot: the in-betweens then the walk model (forward) or back (reverse), each held def.holds[i] seconds. */
  async #playTurn(token, id, def, reverse) {
    const holds = def.holds?.length === def.frames ? def.holds : new Array(def.frames).fill(def.duration / def.frames);
    const order = Array.from({ length: def.frames }, (_, i) => (reverse ? def.frames - 1 - i : i));
    for (const [j, fr] of order.entries()) {
      // a short fade only where the layered standing rig meets the first drawing
      this.setView({ kind: 'seq', id, frame: fr, mirror: false }, !reverse && j === 0 ? 0.05 : 0);
      await this.wait(token, holds[fr]);
    }
  }

  // ------------------------------------------------------------ gestures (layered, non-exclusive)
  hop(power = 1) {
    if (this.airborne) return;
    this.body.vy = -460 * power; this.hopping = true;
  }

  /** Jelly wobble: a vertical squash with the sideways bulge in counter-phase (roughly volume preserving). */
  squash(amount = 0.08) { this.body.vsy -= amount * 18; this.body.vsx += amount * 11; }

  /** A sideways wobble (e.g. poked on the side). */
  jiggle(amount = 0.06, side = 1) { this.body.vsx -= amount * 16; this.body.vsy += amount * 9; this.body.vrot += side * amount * 5; }

  // ------------------------------------------------------------ drag & fall
  /** grabY: window-local y of the cursor; the body swings about that point. */
  beginDrag(grabY) {
    this.cancel();
    this.mode = 'drag';
    this.pose = 'stand';
    this.fade = null;
    if (this.view.kind !== 'rig' || this.view.id !== 'stand') this.setView(this.rigView('stand'), 0.16);
    const f = this.foot();
    this.body.pivotY = clamp(Number.isFinite(grabY) ? (f.y - grabY) / this.s : 820, 300, 960);
    this.body.y = 0; this.body.vy = 0; this.body.lean = 0; this.body.rise = 0;
    this.vel.x = 0; this.vel.y = 0;
    this.lastDrag = null;
    this.dragTrail = [];
    this.fly = null;
  }

  dragTo(root, t) {
    if (this.mode !== 'drag') return;
    if (this.lastDrag) {
      const dt = Math.max(0.004, (t - this.lastDrag.t) / 1000);
      const vx = (root.x - this.lastDrag.x) / dt;
      this.vel.x = this.vel.x * 0.6 + vx * 0.4;
      this.vel.y = (root.y - this.lastDrag.y) / dt;
    }
    this.lastDrag = { x: root.x, y: root.y, t };
    const now = performance.now();
    this.dragTrail.push({ x: root.x, y: root.y, t, at: now });
    while (this.dragTrail.length > 2 && now - this.dragTrail[0].at > 140) this.dragTrail.shift();
    this.root = { ...root };
  }

  /** Throw velocity (DIP/s) from the last ~90 ms of the drag; zero if the cursor had come to rest. */
  #releaseVelocity() {
    const tr = this.dragTrail, now = performance.now();
    if (tr.length < 2 || now - tr[tr.length - 1].at > 70) return { x: 0, y: 0 };
    const last = tr[tr.length - 1];
    let first = tr[0];
    for (const p of tr) if (last.t - p.t <= 90) { first = p; break; }
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.012) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }

  /** opts.bounce: a quick throw sends her flying and bouncing off the screen edges. */
  endDrag(root, opts = {}) {
    if (root) this.root = { ...root };
    this.mode = 'idle';
    const v = this.#releaseVelocity();
    const speed = Math.hypot(v.x, v.y);
    this.dragTrail = [];
    if (opts.bounce !== false && speed > 650) {
      const MAX = 4200;
      const k = speed > MAX ? MAX / speed : 1;
      this.vel.x = v.x * k; this.vel.y = v.y * k;
      this.mode = 'fly';
      this.fly = { bounces: 0, hits: 0, ceilArmed: this.root.y >= this.#ceilY(), t: 0 };
      this.body.pivotY = 470;
      this.onFling?.(speed * k);
      return;
    }
    const floor = this.floorY();
    if (this.flags.gravity && this.root.y < floor - 3) {
      this.mode = 'fall';
      this.vel.y = Math.min(0, this.vel.y) * 0.3;
    } else {
      this.body.pivotY = 0;
    }
  }

  // ------------------------------------------------------------ flight (thrown)
  #ceilY(d = this.displayAt(this.root.x)) { return d ? d.workArea.y + 900 * this.s : -Infinity; }

  /** True when another display continues the desktop past (x, y). */
  #screenAt(x, y) {
    return this.displays.some((d) => x >= d.bounds.x && x < d.bounds.x + d.bounds.width && y >= d.bounds.y && y < d.bounds.y + d.bounds.height);
  }

  #impact(kind, speed) {
    const b = this.body;
    const k = clamp(speed / 3800, 0.05, 0.2);
    if (kind === 'left' || kind === 'right') {
      b.sx = 1 - k; b.vsx = 0; b.sy = 1 + k * 0.55; b.vsy = 0;
      b.vrot += (kind === 'left' ? 1 : -1) * k * 14;
    } else {
      b.sy = 1 - k; b.vsy = 0; b.sx = 1 + k * 0.6; b.vsx = 0;
    }
    this.fly.hits++;
    this.onImpact?.(kind, speed);
  }

  #flyStep(dt) {
    const v = this.vel, b = this.body, f = this.fly;
    f.t += dt;
    if (this.flags.gravity) v.y += 2600 * dt;
    else { const damp = Math.exp(-dt * 1.4); v.x *= damp; v.y *= damp; }
    v.x *= Math.exp(-dt * 0.3);
    let x = this.root.x + v.x * dt, y = this.root.y + v.y * dt;
    const d = this.displayAt(x, y - 4);
    if (d) {
      const wa = d.workArea, half = 140 * this.s, top = 900 * this.s, mid = y - top / 2;
      if (x < wa.x + half && v.x < 0 && !this.#screenAt(wa.x - 10, mid)) {
        x = wa.x + half; const sp = -v.x; v.x = sp * 0.62; v.y *= 0.92; this.#impact('left', sp);
      } else if (x > wa.x + wa.width - half && v.x > 0 && !this.#screenAt(wa.x + wa.width + 10, mid)) {
        x = wa.x + wa.width - half; const sp = v.x; v.x = -sp * 0.62; v.y *= 0.92; this.#impact('right', sp);
      }
      const ceil = wa.y + top;
      if (y >= ceil) f.ceilArmed = true;
      else if (f.ceilArmed && v.y < 0 && !this.#screenAt(x, wa.y - 10)) { y = ceil; const sp = -v.y; v.y = sp * 0.5; this.#impact('top', sp); }
      const floor = wa.y + wa.height;
      if (y >= floor && v.y >= 0) {
        y = floor;
        if (v.y > 560 && f.bounces < 5) { const sp = v.y; v.y = -sp * 0.42; v.x *= 0.72; f.bounces++; this.#impact('floor', sp); }
        else return this.#endFlight(true, v.y);
      }
    }
    this.root = { x, y };
    this.onRoot(this.root);
    // lean into the throw; stretch a little along fast motion
    const sp = Math.hypot(v.x, v.y);
    const target = clamp(v.x * 0.00016, -0.42, 0.42);
    b.vrot += (60 * (target - b.rot) - 7 * b.vrot) * dt;
    b.rot += b.vrot * dt;
    const st = clamp(sp / 9000, 0, 0.07);
    const vertical = Math.abs(v.y) > Math.abs(v.x);
    b.vsy += ((vertical ? st : -st * 0.4) * 40) * dt;
    b.vsx += ((vertical ? -st * 0.4 : st) * 40) * dt;
    if (!this.flags.gravity && sp < 50 && f.t > 0.3) this.#endFlight(false, 0);
  }

  #endFlight(onFloor, vy) {
    const b = this.body;
    if (onFloor) { this.root.y = this.floorY(); b.vsy -= Math.min(2.4, vy / 380); b.vsx += Math.min(1.4, vy / 600); }
    this.vel.x = 0; this.vel.y = 0;
    this.mode = 'idle';
    const f = this.fly;
    this.fly = null;
    this.onRoot(this.root);
    this.landed?.({ flight: f });
  }

  // ------------------------------------------------------------ per-frame update
  update(dt) {
    this.frameNo++;
    const waiters = this.waiters; this.waiters = [];
    for (const w of waiters) w(dt);
    if (this.fade && !this.fade.manual) { this.fade.t += dt; if (this.fade.t >= this.fade.dur) this.fade = null; }

    const b = this.body;
    // hop / landing
    if (b.y < 0 || b.vy) {
      b.vy += 2900 * dt; b.y += b.vy * dt;
      if (b.y >= 0) { if (b.vy > 200) b.vsy -= Math.min(2.2, b.vy / 300); b.y = 0; b.vy = 0; this.hopping = false; }
    }
    // jelly springs (squash / bulge): under-damped so impacts wobble a few times
    const sAcc = 230 * (1 - b.sy) - 11 * b.vsy;
    b.vsy += sAcc * dt; b.sy += b.vsy * dt; b.sy = clamp(b.sy, 0.8, 1.16);
    const xAcc = 200 * (1 - b.sx) - 10 * b.vsx;
    b.vsx += xAcc * dt; b.sx += b.vsx * dt; b.sx = clamp(b.sx, 0.8, 1.2);
    if (Math.abs(b.sx - 1) < 2e-4 && Math.abs(b.vsx) < 2e-3) { b.sx = 1; b.vsx = 0; }
    if (Math.abs(b.sy - 1) < 2e-4 && Math.abs(b.vsy) < 2e-3) { b.sy = 1; b.vsy = 0; }
    // swing (drag) spring: angle follows horizontal velocity like a pendulum
    if (this.mode === 'drag') {
      const target = clamp(-this.vel.x * 0.00028, -0.32, 0.32);
      const acc = 40 * (target - b.rot) - 5 * b.vrot;
      b.vrot += acc * dt; b.rot += b.vrot * dt;
      this.vel.x *= Math.exp(-dt * 6);
    } else if (this.mode === 'fly') {
      this.#flyStep(dt);
    } else {
      const acc = 70 * (0 - b.rot) - 9 * b.vrot;
      b.vrot += acc * dt; b.rot += b.vrot * dt;
      if (Math.abs(b.rot) < 1e-4 && Math.abs(b.vrot) < 1e-3) { b.rot = 0; b.vrot = 0; if (this.mode !== 'drag') b.pivotY = 0; }
    }
    // falling with gravity
    if (this.mode === 'fall') {
      const floor = this.floorY();
      this.vel.y += 2600 * dt;
      this.root.y += this.vel.y * dt;
      this.root.x += this.vel.x * dt * 0.4;
      this.vel.x *= Math.exp(-dt * 3);
      if (this.root.y >= floor) {
        this.root.y = floor;
        b.vsy -= Math.min(2.6, this.vel.y / 380);
        this.vel.y = 0; this.mode = 'idle';
        this.landed?.();
      }
      this.onRoot(this.root);
    }
    // tucked in below the taskbar without permission (gravity or bouncing back on): climb back up onto it
    if (!this.airborne && !this.flags.sink && this.sunk) {
      const floor = this.floorY();
      const d = this.root.y - floor;
      this.root.y = d < 1 ? floor : floor + d * Math.exp(-dt * 7);
      if (this.root.y === floor) { b.vsy -= 0.6; b.vsx += 0.35; }
      this.onRoot(this.root);
    }
    // acceleration estimate (world px/s^2) for secondary motion
    const vxWorld = this.vel.x / this.s;
    this.accX = (vxWorld - this.prevVelX) / Math.max(dt, 1e-3);
    this.prevVelX = vxWorld;

    // rig simulation
    const env = {
      rootVelX: vxWorld, rootAccX: clamp(this.accX, -6000, 6000), sleeping: this.pose === 'sleep',
      rootVelY: this.vel.y / this.s, flying: this.mode === 'fly',
      dangle: this.airborne ? 1 : 0, headTilt: this.env.headTilt || 0, headDrop: this.env.headDrop || 0,
      noBlink: this.env.noBlink,
    };
    const toUpdate = new Set();
    if (this.view.kind === 'rig') toUpdate.add(this.view.id);
    if (this.fade?.from.kind === 'rig') toUpdate.add(this.fade.from.id);
    for (const id of toUpdate) {
      const rig = this.a.rig(id);
      if (!rig) continue;
      rig.mood = this.env.mood;
      const mir = this.fade?.from.id === id ? this.fade.from.mirror : this.view.mirror;
      rig.setGaze((mir ? -1 : 1) * this.env.gazeX, this.env.gazeY);
      rig.update(dt, env);
    }
  }

  // ------------------------------------------------------------ rendering
  #drawView(view, weight, add, slot = 'a') {
    const r = this.r, dpr = r.dpr;
    const def = this.defOf(view);
    if (!def) return false;
    const M = this.viewMatrix(view);
    const corners = (x0, y0, x1, y1) => {
      const c = [];
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) { const p = mat.apply(M, x, y); c.push(p[0] * dpr, p[1] * dpr); }
      return c;
    };
    if (view.kind === 'rig') {
      const rig = this.a.rig(view.id);
      if (!rig) return false;
      const k = def.scale * this.s * dpr;
      const q = k <= 1 ? 1 : Math.min(2, k);
      let tgt = this.targets.get(view.id);
      const size = rig.targetSize(q);
      tgt = r.target(size.w, size.h, tgt);
      this.targets.set(view.id, tgt);
      if (this.rendered.get(view.id) !== this.frameNo) {
        rig.render(r, tgt, q);
        this.rendered.set(view.id, this.frameNo);
      }
      r.begin(null, false);
      r.blend(add ? 'add' : 'normal');
      const mg = rig.margin;
      r.drawQuad(tgt, corners(-mg, -mg, rig.W + mg, rig.H + mg), [0, 1, 1, 0], weight, -0.35);
      return true;
    }
    const fr = this.a.frame(view.id, view.frame, slot);
    if (!fr) return false;
    const [cx, cy, cw, ch] = fr.crop;
    r.begin(null, false);
    r.blend(add ? 'add' : 'normal');
    r.drawQuad(fr.tex, corners(cx, cy, cx + cw, cy + ch), [0, 0, 1, 1], weight, -0.2);
    return true;
  }

  render() {
    const r = this.r;
    r.clipY = this.clipY;
    r.begin(null, true);
    if (this.fade) {
      const a = ease(clamp(this.fade.t / this.fade.dur, 0, 1));
      const okFrom = this.#drawView(this.fade.from, 1 - a, true, 'b');
      const okTo = this.#drawView(this.view, a, true, 'a');
      if (!okTo && okFrom) this.#drawView(this.fade.from, a, true, 'b');
      r.blend('normal');
    } else if (!this.#drawView(this.view, 1, false) && this.fallback) this.#drawView(this.fallback, 1, false);
  }

  // ------------------------------------------------------------ queries
  /** Head-top anchor in window CSS px (for the speech bubble). */
  anchor() {
    const view = this.view;
    const def = this.defOf(view);
    if (!def) return this.lastAnchor || { x: this.geom.W / 2, y: this.geom.footY - 360 };
    let nx, ny;
    if (view.kind === 'rig') { [nx, ny] = def.anchor || [def.width / 2, 0]; ny += 6; }
    else { const b = def.bounds?.[view.frame] || [0, 0, def.width, def.height, def.width / 2]; nx = b[4]; ny = b[1] + 4; }
    const p = mat.apply(this.viewMatrix(view), nx, ny);
    const a = { x: p[0], y: p[1] };
    if (this.lastAnchor) { a.x = this.lastAnchor.x + (a.x - this.lastAnchor.x) * 0.35; a.y = this.lastAnchor.y + (a.y - this.lastAnchor.y) * 0.35; }
    this.lastAnchor = a;
    return a;
  }

  /** Window point of the face (manifest faceAnchor + offset in native px) while the standing rig shows. */
  facePoint(dy = 0, dx = 0) {
    const fa = this.m.world?.faceAnchor;
    if (!fa || this.view.kind !== 'rig' || this.view.id !== 'stand') return null;
    const p = mat.apply(this.viewMatrix(this.view), fa.x + dx, fa.y + dy);
    return { x: p[0], y: p[1] };
  }

  /** Native coords of a window point for the current view. */
  toNative(x, y, view = this.view) {
    return mat.apply(mat.invert(this.viewMatrix(view)), x, y);
  }

  family() {
    if (this.mode === 'walk' || this.mode === 'transition') return null;
    if (this.view.kind === 'rig') return this.pose;
    return null;
  }

  /** Which body part is under a window point (interaction map in native coords). */
  partAt(x, y) {
    const fam = this.family();
    const map = fam && this.m.parts[fam];
    if (!map) return null;
    const [nx, ny] = this.toNative(x, y);
    const order = ['ear-left', 'ear-right', 'hand-left', 'hand-right', 'foot-left', 'foot-right', 'face', 'head', 'tail', 'chest',
      'thigh-left', 'thigh-right', 'calf-left', 'calf-right', 'skirt', 'leg-left', 'leg-right', 'body', 'hair'];
    for (const id of order) {
      for (const p of map.filter((q) => q.id === id)) {
        if (((nx - p.cx) / p.rx) ** 2 + ((ny - p.cy) / p.ry) ** 2 <= 1) {
          const rig = this.rig;
          const side = rig ? (nx < (rig.headPivot?.[0] ?? p.cx) ? -1 : 1) : 0;
          return { ...p, native: [nx, ny], side };
        }
      }
    }
    return null;
  }

  isBusy() { return this.mode !== 'idle'; }
}

export { Cancelled };
