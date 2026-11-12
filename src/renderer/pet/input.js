// Pointer handling for the character window.
//  - per-pixel hit testing toggles click-through (transparent pixels never steal clicks)
//  - left button: touch / pull a body part, stroke the head; double-click opens the quick chat
//  - right button: a short click opens the ring menu; hold (>=220 ms) or move (>=5 px) drags
const PULLABLE = new Set(['ear-left', 'ear-right', 'tail', 'hair', 'skirt', 'hand-left', 'hand-right', 'foot-left', 'foot-right', 'leg-left', 'leg-right', 'calf-left', 'calf-right']);
// held-button strokes: parts that are rubbed rather than pulled
const RUBBED = new Set(['face', 'chest', 'body', 'thigh-left', 'thigh-right']);
/** Direction code of a pointer move (±1 horizontal, ±2 vertical), 0 when shorter than `min`. The current axis is kept
 *  until the other one clearly dominates, so a slanted stroke does not flicker between the two. */
const dirOf = (dx, dy, prev, min) => {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) <= min) return 0;
  const horiz = Math.abs(prev) === 1 ? ax * 1.5 >= ay : Math.abs(prev) === 2 ? ax >= ay * 1.5 : ax >= ay;
  return horiz ? Math.sign(dx) : 2 * Math.sign(dy);
};
/** Back-and-forth counter: feed pointer positions; `s.n` grows by 1 per reversal and 0.5 per change of axis (so circles
 *  count too). Returns undefined while the pointer has not moved far enough, else the amount added. A pause of more
 *  than 1.1 s between turns starts over. */
const turnOf = (s, x, y, now) => {
  const dir = dirOf(x - s.lastX, y - s.lastY, s.dir, 5);
  if (!dir) return undefined;
  s.lastX = x; s.lastY = y;
  if (now - s.turnAt > 1100) s.n = 0;
  if (dir === s.dir) return 0;
  const add = !s.dir ? 0 : dir === -s.dir ? 1 : 0.5;
  s.dir = dir; s.turnAt = now; s.n += add;
  return add;
};
const counter = (x, y) => ({ dir: 0, lastX: x, lastY: y, n: 0, turnAt: performance.now() });
const HOLD_MS = 220;
const MOVE_PX = 5;

export class Input {
  constructor({ character, renderer, behavior, ui, api, getSettings }) {
    this.c = character; this.r = renderer; this.b = behavior; this.ui = ui; this.api = api;
    this.getSettings = getSettings;
    this.pointer = { x: -1, y: -1, t: 0 };
    this.interactive = false;
    this.offFrames = 0;
    this.overChar = false;
    this.press = null;
    this.dragging = false;
    this.lastClick = null;
    this.hover = { part: null, ...counter(0, 0) };
    this.#bind();
  }

  #bind() {
    const move = (e) => { this.pointer = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    window.addEventListener('mousemove', move, { passive: true });
    window.addEventListener('pointermove', (e) => { move(e); this.#onMove(e); }, { passive: true });
    window.addEventListener('pointerdown', (e) => this.#onDown(e));
    window.addEventListener('pointerup', (e) => this.#onUp(e));
    window.addEventListener('pointercancel', () => this.#cancel());
    window.addEventListener('blur', () => { if (this.press?.button === 0) this.#cancel(); });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseleave', () => { this.pointer.x = -1; this.pointer.y = -1; });
    window.addEventListener('wheel', (e) => {
      if (!e.ctrlKey || !this.overChar) return;
      e.preventDefault();
      const s = this.getSettings().pet.scale;
      const next = Math.round(Math.min(0.8, Math.max(0.18, s * (e.deltaY < 0 ? 1.06 : 1 / 1.06))) * 1000) / 1000;
      this.api.invoke('settings.patch', { pet: { scale: next } });
    }, { passive: false });
    // While main drags the window, it reports the clamped root every few ms.
    this.api.on('pet:drag', ({ root, t }) => { if (this.dragging) this.c.dragTo(root, t); });
    // Global cursor (also outside the window) — eyes follow it, local coords keep hover fresh.
    this.api.on('pet:cursor', ({ x, y, local }) => {
      this.global = { x, y };
      if (performance.now() - this.pointer.t > 120) this.pointer = { x: local.x, y: local.y, t: this.pointer.t };
    });
  }

  // ------------------------------------------------------------ hit testing (call right after render)
  hitTest() {
    const p = this.pointer;
    const inside = p.x >= 0 && p.y >= 0 && p.x < innerWidth && p.y < innerHeight;
    let ui = false, char = false;
    if (inside) {
      const el = document.elementFromPoint(p.x, p.y);
      ui = !!el?.closest?.('.hit');
      if (!ui) char = this.r.readAlpha(p.x, p.y) > 0.1;
    }
    this.overChar = char;
    const want = ui || char || !!this.press || this.dragging || this.ui.modal;
    if (want) { this.offFrames = 0; this.#setInteractive(true); }
    else if (++this.offFrames >= 3) this.#setInteractive(false);
    document.body.classList.toggle('over-char', char && !this.dragging);
    this.#hoverStroke(char);
  }

  #setInteractive(on) {
    if (on === this.interactive) return;
    this.interactive = on;
    this.api.send('pet.setInteractive', on);
  }

  // Hover strokes (no button): moving back and forth over one part. Over the head and ears they are pats; elsewhere
  // every third turn of direction is one stroke (Behavior.onRub). A pause of more than a second starts over.
  #hoverStroke(char) {
    const h = this.hover, { x, y } = this.pointer;
    if (!char || this.press || this.dragging) { h.part = null; return; }
    const part = this.c.partAt(x, y);
    const id = part?.id || null;
    if (id !== h.part) { Object.assign(h, counter(x, y), { part: id }); return; }
    if (!id || turnOf(h, x, y, performance.now()) === undefined) return;
    if (id === 'head' || id === 'ear-left' || id === 'ear-right') {
      if (h.dir) this.b.onStroke?.(x, y);                 // she leans into the stroking hand
      if (h.n >= 3) { h.n = 0; this.b.onPat({ hover: true, part: id }); }
    } else if (h.n >= 3) {                                // from the third turn on, every further turn is a stroke
      h.n -= 1;
      this.b.onRub?.(part, { hover: true, x, y });
    }
  }

  // ------------------------------------------------------------ buttons
  #onDown(e) {
    if (e.target.closest?.('.hit')) return;              // overlay UI handles its own events
    if (!this.overChar && !this.press) { this.ui.closeTransient?.(); return; }
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    try { document.documentElement.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const part = e.button === 0 ? this.c.partAt(e.clientX, e.clientY) : null;
    this.press = {
      button: e.button, x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY, far: false, t: performance.now(), part, moved: false, pulling: false,
      pat: { dir: 0, lastX: e.clientX, n: 0 }, rub: counter(e.clientX, e.clientY), grab: part ? part.native : null,
    };
    if (e.button === 2) {
      this.press.timer = setTimeout(() => { if (this.press?.button === 2 && !this.dragging) this.#startDrag(); }, HOLD_MS);
    }
    this.ui.closeTransient?.();
  }

  #onMove(e) {
    const p = this.press;
    if (!p) return;
    const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (p.button === 2) {
      // screen distance: once dragging, the window follows the pointer and client coordinates stand still
      if (Math.hypot(e.screenX - p.sx, e.screenY - p.sy) >= MOVE_PX) p.far = true;
      if (!this.dragging && dist >= MOVE_PX) this.#startDrag();
      return;
    }
    if (dist > 6) p.moved = true;
    if (!p.part || !p.moved) return;
    const rig = this.c.rig;
    if ((p.part.id === 'head') && rig) {
      // stroke: count direction reversals while holding the button
      const dx = e.clientX - p.pat.lastX;
      if (Math.abs(dx) > 4) {
        const dir = Math.sign(dx);
        if (p.pat.dir && dir !== p.pat.dir) { p.pat.n++; this.b.onPat({ hover: false, part: 'head', count: p.pat.n }); }
        p.pat.dir = dir; p.pat.lastX = e.clientX;
      }
      this.b.onStroke?.(e.clientX, e.clientY);
      rig.pullPart('head', p.grab, this.c.toNative(e.clientX, e.clientY));
      return;
    }
    if (RUBBED.has(p.part.id)) {
      // held-button rubbing: every turn from the second on is one stroke
      if (turnOf(p.rub, e.clientX, e.clientY, performance.now()) !== undefined && p.rub.n >= 2) {
        p.rub.n -= 1; p.rubbing = true;
        this.b.onRub?.(p.part, { hover: false, x: e.clientX, y: e.clientY });
      }
      return;
    }
    if (PULLABLE.has(p.part.id) && rig) {
      if (!p.pulling) { p.pulling = true; this.b.onPullStart(p.part); }
      rig.pullPart(p.part.id, p.grab, this.c.toNative(e.clientX, e.clientY));
    }
  }

  #onUp(e) {
    const p = this.press;
    if (!p) return;
    this.press = null;
    clearTimeout(p.timer);
    try { document.documentElement.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (p.button === 2) {
      // a short click opens the ring; so does a slow one that only turned into a drag by being held (never moved)
      const still = !p.far && Math.hypot(e.screenX - p.sx, e.screenY - p.sy) < MOVE_PX;
      const click = !this.dragging || (still && performance.now() - p.t < 700);
      if (this.dragging) this.#endDrag();
      if (click) this.ui.openRing(e.clientX, e.clientY);
      return;
    }
    const rig = this.c.rig;
    if (p.pulling || (p.part?.id === 'head' && p.moved)) {
      rig?.releasePull();
      if (p.pulling) this.b.onPullRelease(p.part, Math.hypot(e.clientX - p.x, e.clientY - p.y));
      return;
    }
    if (p.moved) return;
    const now = performance.now();
    if (this.lastClick && now - this.lastClick.t < 330 && Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) < 14) {
      this.lastClick = null;
      this.b.onDoubleClick();
      return;
    }
    this.lastClick = { t: now, x: e.clientX, y: e.clientY };
    this.b.onTouch(p.part, { x: e.clientX, y: e.clientY, held: now - p.t });
  }

  #cancel() {
    const p = this.press;
    this.press = null;
    if (p) clearTimeout(p.timer);
    this.c.rig?.releasePull();
    if (this.dragging) this.#endDrag();
  }

  // ------------------------------------------------------------ window drag (right button)
  async #startDrag() {
    const p = this.press;
    if (!p || this.dragging) return;
    if (this.getSettings().pet.lockPosition) { this.b.onLockedDrag(); this.press = null; return; }
    this.dragging = true;
    this.dragPending = true;
    const o = this.c.windowOrigin();
    const offsetX = o.x + p.x - this.c.root.x;
    const offsetY = o.y + p.y - this.c.root.y;
    const ok = await this.api.invoke('pet.dragStart', { offsetX, offsetY });
    this.dragPending = false;
    if (!ok) { this.dragging = false; return; }
    if (!this.dragging) return; // released during the round-trip; main already got dragEnd
    this.c.beginDrag(p.y);
    this.b.onDragStart();
  }

  async #endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    const begun = !this.dragPending;
    const root = await this.api.invoke('pet.dragEnd');
    if (!begun) return;
    this.c.endDrag(root, { bounce: this.getSettings().pet.bounce !== false });
    this.b.onDragEnd();
  }
}
