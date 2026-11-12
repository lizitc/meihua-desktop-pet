// Little particle effects drawn over the character on a 2D canvas: hearts, music notes,
// sparkles, sleepy "z", sweat drops, dizzy stars circling the head, food crumbs and
// floating "+exp" labels. Purely decorative: the canvas never takes pointer events.

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const PINK = ['#ff7aa8', '#ff9cbf', '#f25d8e', '#ffb3cf'];
const GOLD = ['#ffd36e', '#ffe7a3', '#ffc04d'];

function heart(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
  ctx.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
  ctx.closePath();
}

function star(ctx, s, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? s * inner : s;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

function sparkle(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, -s); ctx.quadraticCurveTo(0, 0, s, 0); ctx.quadraticCurveTo(0, 0, 0, s);
  ctx.quadraticCurveTo(0, 0, -s, 0); ctx.quadraticCurveTo(0, 0, 0, -s); ctx.closePath();
}

function drop(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.7, -s * 0.1, s * 0.7, s * 0.8, 0, s * 0.8);
  ctx.bezierCurveTo(-s * 0.7, s * 0.8, -s * 0.7, -s * 0.1, 0, -s);
  ctx.closePath();
}

export class Fx {
  constructor(parent) {
    this.cv = document.createElement('canvas');
    this.cv.className = 'fx';
    parent.insertBefore(this.cv, parent.querySelector('#ui'));   // over the character, under the speech UI
    this.ctx = this.cv.getContext('2d');
    this.ps = [];
    this.orbits = [];   // dizzy stars: { until, t }
    this.dpr = 1;
  }

  #resize() {
    const dpr = devicePixelRatio || 1, w = innerWidth, h = innerHeight;
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) {
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
      this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    }
    this.dpr = dpr;
  }

  get busy() { return this.ps.length > 0 || this.orbits.length > 0 || !!this.held; }

  /**
   * kind: heart | note | sparkle | zzz | sweat | star | crumb | text | anger | puff
   * x, y: window CSS px. opts: { n, spread, color, text, vx, vy, size, life }
   */
  emit(kind, x, y, opts = {}) {
    const n = opts.n ?? 1;
    for (let i = 0; i < n; i++) {
      const sp = opts.spread ?? 14;
      const p = {
        kind, x: x + rand(-sp, sp), y: y + rand(-sp * 0.5, sp * 0.5), t: 0,
        life: opts.life ?? rand(1.1, 1.7), size: (opts.size ?? 9) * rand(0.8, 1.2), rot: rand(-0.4, 0.4), vr: rand(-1.5, 1.5),
        vx: opts.vx ?? rand(-18, 18), vy: opts.vy ?? rand(-58, -34), g: 0, color: opts.color, text: opts.text, phase: rand(0, TAU), delay: (opts.stagger ?? 0) * i,
      };
      switch (kind) {
        case 'heart': p.color ||= PINK[i % PINK.length]; break;
        case 'note': p.color ||= ['#e2588b', '#9a7be0', '#5aa7e0'][i % 3]; p.text ||= ['♪', '♫', '♬'][Math.floor(rand(0, 3))]; p.size = (opts.size ?? 15) * rand(0.85, 1.15); break;
        case 'sparkle': p.color ||= GOLD[i % GOLD.length]; p.vy = opts.vy ?? rand(-30, -8); p.vx = opts.vx ?? rand(-40, 40); p.life = opts.life ?? rand(0.6, 1.0); break;
        case 'star': p.color ||= GOLD[i % GOLD.length]; p.vx = opts.vx ?? rand(-140, 140); p.vy = opts.vy ?? rand(-160, -60); p.g = 380; p.life = opts.life ?? rand(0.6, 0.9); break;
        case 'zzz': p.color ||= '#8f7fd6'; p.text = 'z'; p.vx = opts.vx ?? 14; p.vy = opts.vy ?? -22; p.life = opts.life ?? 2.4; p.size = opts.size ?? 12; break;
        case 'sweat': p.color ||= '#7cc4f2'; p.vx = opts.vx ?? 10; p.vy = opts.vy ?? 20; p.g = 160; p.life = opts.life ?? 0.9; p.size = opts.size ?? 6; break;
        case 'crumb': p.color ||= ['#f2c27a', '#e9a35b', '#fff1d6', '#f28aa8'][i % 4]; p.vx = opts.vx ?? rand(-70, 70); p.vy = opts.vy ?? rand(-90, -20); p.g = 520; p.life = opts.life ?? rand(0.5, 0.8); p.size = (opts.size ?? 3) * rand(0.7, 1.3); break;
        case 'text': p.color ||= '#e2588b'; p.vx = 0; p.vy = opts.vy ?? -26; p.life = opts.life ?? 1.6; p.size = opts.size ?? 13; break;
        case 'anger': p.color ||= '#f2546b'; p.vx = 0; p.vy = 0; p.life = opts.life ?? 1.2; p.size = opts.size ?? 9; break;
        case 'puff': p.color ||= 'rgba(255,255,255,0.85)'; p.vx = opts.vx ?? rand(-50, 50); p.vy = opts.vy ?? rand(-20, 10); p.life = opts.life ?? 0.5; p.size = (opts.size ?? 7) * rand(0.8, 1.3); break;
        default: break;
      }
      this.ps.push(p);
    }
    if (this.ps.length > 220) this.ps.splice(0, this.ps.length - 220);
  }

  /** Stars circling over the head for `seconds`. */
  dizzy(seconds = 2.4) { this.orbits.push({ t: 0, until: seconds }); }

  /** A food picture held at `at()` (window px, re-read each frame) that gets smaller bite by bite. */
  hold(img, at, seconds = 2.4, size = 34, bites = 4) {
    this.held = { img, at, t: 0, dur: seconds, size, bites };
  }

  frame(dt, anchor) {
    this.#resize();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!this.busy) return;
    const alive = [];
    for (const p of this.ps) {
      if (p.delay > 0) { p.delay -= dt; alive.push(p); continue; }
      p.t += dt;
      if (p.t >= p.life) continue;
      alive.push(p);
      p.vy += p.g * dt;
      p.x += (p.vx + (p.kind === 'heart' || p.kind === 'note' || p.kind === 'zzz' ? Math.sin(p.t * 4 + p.phase) * 14 : 0)) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const u = p.t / p.life;
      const fadeIn = Math.min(1, p.t / 0.12);
      const alpha = fadeIn * (u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35);
      const pop = p.kind === 'text' ? 1 : 0.6 + 0.4 * Math.min(1, p.t / 0.18) + (p.kind === 'heart' ? 0.08 * Math.sin(p.t * 12) : 0);
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.kind === 'text' || p.kind === 'zzz' ? 0 : p.rot);
      ctx.scale(pop, pop);
      this.#draw(ctx, p, u);
      ctx.restore();
    }
    this.ps = alive;
    const h = this.held;
    if (h) {
      h.t += dt;
      const pos = h.at();
      if (h.t >= h.dur || !pos || !h.img.complete) { if (h.t >= h.dur || !pos) this.held = null; }
      else {
        const u = h.t / h.dur;
        const bite = Math.min(h.bites - 1, Math.floor(u * h.bites));
        const since = u * h.bites - Math.floor(u * h.bites);
        const k = (1 - bite * (0.75 / h.bites)) * (1 - 0.12 * Math.max(0, 1 - since * 6));
        const appear = Math.min(1, h.t / 0.25);
        const s = h.size * k * (0.6 + 0.4 * appear);
        ctx.save();
        ctx.globalAlpha = Math.min(appear, (h.dur - h.t) / 0.25, 1);
        ctx.translate(pos.x, pos.y + 6 * (1 - appear));
        ctx.drawImage(h.img, -s / 2, -s / 2, s, s);
        ctx.restore();
      }
    }
    if (this.orbits.length && anchor) {
      const keep = [];
      for (const o of this.orbits) {
        o.t += dt;
        if (o.t >= o.until) continue;
        keep.push(o);
        const fade = Math.min(1, o.t / 0.2, (o.until - o.t) / 0.4);
        for (let i = 0; i < 3; i++) {
          const a = o.t * 5 + (i * TAU) / 3;
          const x = anchor.x + Math.cos(a) * 34, y = anchor.y + 22 + Math.sin(a) * 9;
          ctx.save();
          ctx.globalAlpha = fade * (Math.sin(a) > 0 ? 1 : 0.55);
          ctx.translate(x, y); ctx.rotate(o.t * 4);
          ctx.fillStyle = GOLD[i]; ctx.strokeStyle = '#c98a1c'; ctx.lineWidth = 1;
          star(ctx, 6.5); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
      }
      this.orbits = keep;
    }
  }

  #draw(ctx, p, u) {
    const s = p.size;
    ctx.fillStyle = p.color;
    switch (p.kind) {
      case 'heart':
        heart(ctx, s); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-s * 0.32, -s * 0.42, s * 0.18, s * 0.11, -0.6, 0, TAU); ctx.fill();
        break;
      case 'star':
        star(ctx, s * 0.8); ctx.fill(); break;
      case 'sparkle':
        sparkle(ctx, s * (1 - u * 0.4)); ctx.fill(); break;
      case 'sweat':
        drop(ctx, s); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.ellipse(-s * 0.2, s * 0.15, s * 0.14, s * 0.22, 0, 0, TAU); ctx.fill();
        break;
      case 'crumb':
        ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill(); break;
      case 'puff':
        ctx.beginPath(); ctx.arc(0, 0, s * (1 + u), 0, TAU); ctx.fill(); break;
      case 'anger': {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        const k = s * (0.9 + 0.15 * Math.sin(p.t * 18));
        for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          ctx.beginPath(); ctx.moveTo(sx * k * 0.25, sy * k); ctx.quadraticCurveTo(sx * k * 0.25, sy * k * 0.25, sx * k, sy * k * 0.25); ctx.stroke();
        }
        break;
      }
      case 'note': case 'zzz': case 'text': {
        const size = p.kind === 'zzz' ? s * (0.8 + u * 0.7) : s;
        ctx.font = `${p.kind === 'text' ? 700 : 600} ${size}px "Segoe UI Symbol", "Microsoft YaHei UI", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineJoin = 'round';
        ctx.strokeText(p.text, 0, 0); ctx.fillText(p.text, 0, 0);
        break;
      }
      default: break;
    }
  }
}
