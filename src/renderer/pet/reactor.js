// Whole-body reactions. Touching, pulling or stroking one part ripples through the whole figure: the body leans
// and counter-balances, the torso bends, the head turns and ducks, the arms help keep balance, and she looks at
// whatever is happening to her. Every channel is a damped spring chasing a target, so motion follows through and
// overshoots a little when a pull lets go, instead of snapping back.
//
// Output (`out`) uses the same channels as the idle acts and is layered on top of them by Idle.update:
//   out.j: joint / field offsets   out.lean (rad)   out.rise (native px, negative = up)   out.ex / out.ey (stretch)
//   out.gaze ({x, y} or null)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Saturating response: about linear for small v, levelling off at ±L. */
const sat = (v, L, S) => L * Math.tanh(v / S);

// Spring per channel. Under-damped (ζ ≈ 0.5–0.65) so a released pull swings back past rest once.
const CH = {
  lean: { k: 52, c: 8, lim: 0.1 },
  rise: { k: 150, c: 14, lim: 16 },
  ex: { k: 170, c: 13, lim: 0.05 },
  ey: { k: 170, c: 13, lim: 0.05 },
  torso: { k: 85, c: 10, lim: 0.04 },
  head: { k: 95, c: 11, lim: 0.1 },
  headDx: { k: 120, c: 13, lim: 4.5 },
  headDy: { k: 120, c: 13, lim: 6.5 },
  'arm-lower-left': { k: 80, c: 9, lim: 0.08 },
  'arm-lower-right': { k: 80, c: 9, lim: 0.08 },
  'hand-left': { k: 90, c: 9, lim: 0.12 },
  'hand-right': { k: 90, c: 9, lim: 0.12 },
  'thigh-left': { k: 90, c: 10, lim: 0.05 },
  'thigh-right': { k: 90, c: 10, lim: 0.05 },
  'foot-left': { k: 100, c: 10, lim: 0.15 },
  'foot-right': { k: 100, c: 10, lim: 0.15 },
};
const BODY = new Set(['lean', 'rise', 'ex', 'ey']);

/**
 * Touch reactions by part: `pose` is held with an envelope (in, hold, out seconds), `kick` adds velocity for a
 * jolt, `gaze` points the eyes while the reaction plays. `s` is the side of the touch (-1 left, 1 right).
 */
const TOUCH = {
  head: (s) => ({ pose: { headDy: 2.6, ey: -0.012, head: 0.035 * s, headDx: 1.2 * s, torso: 0.008 * s, lean: 0.01 * s }, env: [0.08, 0.7, 0.6], kick: { rise: -5 }, gaze: { x: 0.2 * s, y: -0.5 } }),
  ear: (s) => ({ pose: { head: -0.055 * s, headDx: -2.6 * s, headDy: 3.4, torso: -0.016 * s, lean: -0.022 * s, ey: -0.014 }, env: [0.05, 0.45, 0.55], kick: { lean: -0.02 * s, ey: -0.015 }, gaze: { x: 0.6 * s, y: -0.6 } }),
  tail: (s) => ({ pose: { head: 0.05 * s, headDx: 3 * s, torso: 0.02 * s, lean: 0.025 * s, ey: 0.012 }, env: [0.06, 1.0, 0.6], kick: { ey: 0.028 }, gaze: { x: 0.95 * s, y: 0.55 } }),
  hand: (s) => ({ pose: { head: 0.04 * s, headDx: 1.8 * s, headDy: 1.5, torso: 0.014 * s, lean: 0.018 * s }, env: [0.1, 0.9, 0.6], gaze: { x: 0.75 * s, y: 0.55 } }),
  leg: (s) => ({ pose: { lean: -0.026 * s, torso: -0.012 * s, headDy: 2.2, ey: -0.01, [s < 0 ? 'thigh-left' : 'thigh-right']: 0.035 * -s, [s < 0 ? 'foot-left' : 'foot-right']: 0.1 * -s }, env: [0.05, 0.55, 0.5], kick: { rise: -6 }, gaze: { x: 0.4 * s, y: 0.9 } }),
  skirt: (s) => ({ pose: { ey: -0.028, headDy: 3.8, lean: -0.02 * s, 'arm-lower-left': -0.055, 'arm-lower-right': 0.055, 'hand-left': -0.08, 'hand-right': 0.08 }, env: [0.06, 1.1, 0.6], kick: { lean: -0.025 * s }, gaze: { x: 0, y: 0.95 } }),
  body: (s) => ({ pose: { lean: -0.03 * s, head: 0.03 * s, headDy: 2, ex: 0.01 }, env: [0.03, 0.25, 0.5], kick: { lean: -0.035 * s, head: 0.05 * s, headDy: 3 }, gaze: null }),
  hair: (s) => ({ pose: { head: 0.045 * s, headDx: 2.2 * s, torso: 0.008 * s, lean: 0.008 * s }, env: [0.08, 0.6, 0.6], gaze: { x: 0.7 * s, y: -0.2 } }),
  // cheek: a shy little duck of the head, turning a bit away and glancing down
  face: (s) => ({ pose: { head: -0.04 * s, headDx: -1.6 * s, headDy: 2.4, torso: -0.006 * s, ey: -0.008 }, env: [0.07, 0.8, 0.6], kick: { headDy: 1.5 }, gaze: { x: -0.35 * s, y: 0.55 } }),
  // chest: flinches, hunches, arms come in front of her, looks away
  chest: (s) => ({ pose: { ey: -0.024, headDy: 3.6, lean: 0.018 * s, torso: 0.012 * s, head: -0.04 * s, 'arm-lower-left': -0.06, 'arm-lower-right': 0.06, 'hand-left': -0.1, 'hand-right': 0.1 }, env: [0.05, 1.0, 0.6], kick: { ey: -0.02, lean: 0.025 * s }, gaze: { x: -0.7 * s, y: 0.6 } }),
  // thigh: knees in, hands press the hem down, eyes down
  thigh: (s) => ({ pose: { ey: -0.02, headDy: 3.2, lean: -0.018 * s, 'arm-lower-left': -0.05, 'arm-lower-right': 0.05, 'hand-left': -0.08, 'hand-right': 0.08, 'thigh-left': 0.03, 'thigh-right': -0.03 }, env: [0.06, 0.9, 0.6], kick: { ey: -0.015 }, gaze: { x: 0.2 * s, y: 0.95 } }),
};
const touchKind = (id) => (id.startsWith('ear') ? 'ear' : id.startsWith('hand') ? 'hand' : id.startsWith('thigh') ? 'thigh'
  : id.startsWith('leg') || id.startsWith('calf') || id.startsWith('foot') ? 'leg' : TOUCH[id] ? id : 'body');

export class Reactor {
  constructor({ character }) {
    this.c = character;
    this.ch = {};
    for (const id of Object.keys(CH)) this.ch[id] = { x: 0, v: 0, t: 0 };
    this.pulses = [];             // { pose, env:[in, hold, out], t, gaze }
    this.strokeAt = 0; this.strokeX = 0; this.strokeY = 0;
    this.pullInfo = null;         // { kind, last: {dx, dy}, t }
    this.listening = false;
    this.time = 0;
    this.out = { j: {}, lean: 0, rise: 0, ex: 0, ey: 0, gaze: null };
  }

  /** True while a reaction, stroke or pull is shaping her posture (used to keep idle acts from starting). */
  get busy() { return this.pulses.length > 0 || !!this.pullInfo || performance.now() - this.strokeAt < 600; }
  get gaze() { return this.out.gaze; }

  #ok() { const c = this.c; return c.mode === 'idle' && c.view.kind === 'rig'; }

  /** Velocity jolt; each value is roughly the peak displacement it causes (channel units). */
  #kick(k) {
    for (const [id, v] of Object.entries(k || {})) { const s = this.ch[id]; if (s) s.v += v * Math.sqrt(CH[id].k); }
  }

  // ---------------------------------------------------------- events from Behavior / Input
  touch(partId, side = 0, strength = 1) {
    if (!this.#ok()) return;
    const s = side || (Math.random() < 0.5 ? -1 : 1);
    const def = TOUCH[touchKind(partId || 'body')](s);
    const k = clamp(strength, 0.4, 1.4);
    const pose = {};
    for (const [id, v] of Object.entries(def.pose)) pose[id] = v * k;
    this.pulses.push({ pose, env: def.env, t: 0, gaze: def.gaze });
    if (def.kick) { const kk = {}; for (const [id, v] of Object.entries(def.kick)) kk[id] = v * k; this.#kick(kk); }
    if (this.pulses.length > 4) this.pulses.shift();
  }

  /** A custom enveloped pose: env = [in, hold, out] seconds; opts.kick adds a jolt, opts.gaze points the eyes. */
  pose(pose, env = [0.1, 0.6, 0.5], { kick, gaze = null } = {}) {
    if (!this.#ok()) return;
    this.pulses.push({ pose, env, t: 0, gaze });
    if (kick) this.#kick(kick);
    if (this.pulses.length > 4) this.pulses.shift();
  }

  /** Pats: each stroke reversal nudges her to lean into the hand. */
  pat() {
    if (!this.#ok()) return;
    this.pulses.push({ pose: { headDy: -1.6, rise: -2.5, ey: 0.008 }, env: [0.15, 0.4, 0.7], t: 0, gaze: null });
    if (this.pulses.length > 4) this.pulses.shift();
  }

  /** Pointer position over the head while stroking (native px of the rig). */
  stroke(nx, ny) {
    const rig = this.c.rig;
    if (!rig?.headPivot) return;
    this.strokeX = nx - rig.headPivot[0];
    this.strokeY = ny - rig.headPivot[1];
    this.strokeAt = performance.now();
  }

  pullStart(partId) { this.pullInfo = { kind: touchKind(partId), id: partId, last: { dx: 0, dy: 0 }, t: 0 }; }

  pullRelease(partId, dist = 0) {
    const p = this.pullInfo;
    this.pullInfo = null;
    if (!p) return;
    // let go: the springs swing back on their own; sensitive parts add a recoil the other way
    const s = Math.sign(p.last.dx) || 0, T = Math.min(1, Math.hypot(p.last.dx, p.last.dy) / 160);
    if (p.kind === 'ear' || p.kind === 'tail' || p.kind === 'skirt') this.#kick({ lean: -0.03 * s * T, head: -0.04 * s * T, ey: -0.02 * T });
    else if (p.kind === 'hand') this.#kick({ lean: -0.022 * s * T, ey: -0.012 * T });
    else if (p.kind === 'leg') this.#kick({ lean: 0.025 * s * T, rise: -6 * T });
    if (dist > 30) this.c.squash?.(0.03 + 0.03 * T);
  }

  /** Small nod while the owner types to her. */
  nod(amount = 1) {
    if (!this.#ok()) return;
    this.#kick({ headDy: 2.2 * amount, head: (Math.random() - 0.5) * 0.03 * amount });
  }

  setListening(on) { this.listening = !!on; }

  /** Drop everything (e.g. picked up). */
  reset() {
    this.pulses = []; this.pullInfo = null; this.strokeAt = 0;
    for (const s of Object.values(this.ch)) { s.x = 0; s.v = 0; s.t = 0; }
  }

  // ---------------------------------------------------------- per frame
  update(dt, env = {}) {
    this.time += dt;
    const o = this.out;
    o.j = {}; o.lean = 0; o.rise = 0; o.ex = 0; o.ey = 0; o.gaze = null;
    const ok = this.#ok();
    if (!ok) {
      // airborne or walking: let go quickly so nothing lingers into the next pose
      if (this.c.airborne) { this.reset(); return; }
      this.pulses = []; this.pullInfo = null;
    }
    for (const s of Object.values(this.ch)) s.t = 0;
    const T = this.ch;
    const add = (id, v) => { if (T[id]) T[id].t += v; };
    let gaze = null, gazeW = 0;

    // touch pulses (enveloped poses)
    for (const p of this.pulses) {
      p.t += dt;
      const [a, h, r] = p.env;
      const e = p.t < a ? smooth(0, a, p.t) : p.t < a + h ? 1 : 1 - smooth(a + h, a + h + r, p.t);
      for (const [id, v] of Object.entries(p.pose)) add(id, v * e);
      if (p.gaze && e > gazeW) { gaze = p.gaze; gazeW = e; }
    }
    this.pulses = this.pulses.filter((p) => p.t < p.env[0] + p.env[1] + p.env[2]);

    // live pull: the whole body answers the direction and strength of the pull
    const rig = this.c.rig;
    // a pull that ended without a release event (pointer lost) must not keep her "busy"
    if (this.pullInfo && !rig?.pull) { this.pullInfo.lost = (this.pullInfo.lost || 0) + dt; if (this.pullInfo.lost > 0.4) this.pullInfo = null; }
    const pull = ok && this.pullInfo && rig?.pull ? rig.pull : null;
    if (pull && this.pullInfo) {
      const P = this.pullInfo;
      P.t += dt;
      const dx = pull.point[0] - pull.grab[0], dy = pull.point[1] - pull.grab[1];
      P.last = { dx, dy };
      const ten = Math.hypot(dx, dy);
      const amt = sat(ten, 1, 140);                       // 0..1 tension
      const up = Math.min(0, dy), down = Math.max(0, dy);
      const sx = Math.sign(dx);
      switch (P.kind) {
        case 'ear': case 'hair': {
          const f = P.kind === 'hair' ? 0.65 : 1;
          add('head', sat(dx, 0.075, 150) * f); add('headDx', sat(dx, 3.6, 140) * f); add('headDy', sat(dy, 5, 140) * f);
          add('torso', sat(dx, 0.032, 180) * f); add('lean', sat(dx, 0.05, 220) * f);
          add('rise', sat(up, 9, 160) * f); add('ey', sat(-up, 0.02, 160) * f - 0.008 * amt * f);
          gaze = { x: sat(dx, 0.85, 120), y: -0.35 + sat(dy, 0.4, 160) }; gazeW = 1;
          break;
        }
        case 'head':
          add('torso', sat(dx, 0.02, 200)); add('lean', sat(dx, 0.022, 260)); add('ey', sat(-dy, 0.01, 200));
          break;
        case 'tail':
          // tail pulled to one side: the hips follow it and the upper body leans the other way; she looks back at it
          add('lean', sat(-dx, 0.035, 200)); add('torso', sat(-dx, 0.02, 180));
          add('head', sat(dx, 0.055, 150)); add('headDx', sat(dx, 3.2, 150)); add('headDy', 1.5 * amt);
          add('rise', sat(up, 10, 160)); add('ey', -sat(down, 0.024, 150) + sat(-up, 0.015, 160));
          gaze = { x: sx * (0.6 + 0.35 * amt), y: 0.55 }; gazeW = 1;
          break;
        case 'hand':
          // led by the hand: she is drawn toward it, rising onto tiptoe when it is lifted
          add('lean', sat(dx, 0.065, 240)); add('torso', sat(dx, 0.03, 200));
          add('head', sat(dx, 0.04, 200)); add('headDx', sat(dx, 2.6, 200));
          add('rise', sat(up, 11, 170)); add('ey', sat(-up, 0.022, 170) - sat(down, 0.02, 170)); add('headDy', sat(down, 3, 160));
          gaze = { x: sat(dx, 0.8, 140), y: 0.35 + sat(dy, 0.4, 160) }; gazeW = 1;
          break;
        case 'leg': {
          // a foot pulled away: weight shifts to the other leg, arms go out for balance
          add('lean', sat(-dx, 0.04, 180)); add('torso', sat(-dx, 0.02, 160)); add('headDy', 2.5 * amt);
          add('arm-lower-left', 0.05 * amt); add('arm-lower-right', -0.05 * amt);
          add('hand-left', 0.07 * amt); add('hand-right', -0.07 * amt);
          add('ey', -sat(down, 0.015, 160)); add('rise', sat(up, 6, 160));
          gaze = { x: sat(dx, 0.5, 140), y: 0.9 }; gazeW = 1;
          break;
        }
        case 'skirt':
          // holds the hem down, crouches a little and leans away from the pull
          add('lean', sat(-dx, 0.032, 150)); add('ey', -0.026 * amt); add('headDy', 3.6 * amt);
          add('arm-lower-left', -0.055 * amt); add('arm-lower-right', 0.055 * amt);
          add('hand-left', -0.085 * amt); add('hand-right', 0.085 * amt);
          gaze = { x: sat(dx, 0.3, 140), y: 0.95 }; gazeW = 1;
          break;
        default: break;
      }
      // pulled hard: a small struggling tremble
      const strain = smooth(90, 260, ten);
      if (strain > 0 && P.kind !== 'head') {
        add('lean', Math.sin(this.time * 37) * 0.005 * strain);
        add('headDx', Math.sin(this.time * 29 + 1) * 0.6 * strain);
        add('ey', Math.sin(this.time * 23) * 0.004 * strain);
      }
    }

    // stroking the head: she leans into the hand and follows it
    const since = performance.now() - this.strokeAt;
    if (ok && since < 700) {
      const w = since < 350 ? 1 : 1 - smooth(350, 700, since);
      const x = this.strokeX;
      add('head', sat(x, 0.05, 110) * w); add('headDx', sat(x, 2.2, 120) * w);
      add('torso', sat(x, 0.014, 160) * w); add('lean', sat(x, 0.02, 200) * w);
      add('headDy', -1.4 * w); add('rise', -2 * w);
    }

    // attention: the body turns a little after the eyes (head, then shoulders, then the whole figure)
    if (ok && this.c.view.id === 'stand' && !pull) {
      const gx = clamp(env.gazeX || 0, -1, 1), gy = clamp(env.gazeY || 0, -1, 1);
      add('torso', gx * 0.01); add('lean', gx * 0.007); add('headDx', gx * 0.6); add('headDy', gy * 0.4);
    }
    if (ok && this.listening) { add('head', 0.03); add('headDy', -0.8); }

    // integrate (fixed sub-steps keep the stiff channels stable at low frame rates)
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (const [id, s] of Object.entries(T)) {
      const p = CH[id];
      const tgt = clamp(s.t, -p.lim, p.lim);
      for (let i = 0; i < steps; i++) { s.v += (p.k * (tgt - s.x) - p.c * s.v) * h; s.x += s.v * h; }
      if (s.x > p.lim * 1.3) { s.x = p.lim * 1.3; s.v = Math.min(0, s.v); } else if (s.x < -p.lim * 1.3) { s.x = -p.lim * 1.3; s.v = Math.max(0, s.v); }
      if (Math.abs(s.x) < 1e-5 && Math.abs(s.v) < 1e-4) { s.x = 0; s.v = 0; }
      if (BODY.has(id)) o[id] = s.x; else if (s.x) o.j[id] = s.x;
    }
    o.gaze = gaze && gazeW > 0.15 ? gaze : null;
  }
}
