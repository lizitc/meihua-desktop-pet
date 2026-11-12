// The desktop character window: a fixed-size transparent window positioned by the
// character's ground "root" point. Size always derives from the configured scale
// (never from the previous frame's bounds), coordinates are DIP across the whole
// virtual desktop (negative values and mixed-DPI monitors are fine).
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { PRELOAD_DIR } from './paths.js';
import { appUrl } from './protocol.js';
import { bus, rpc, sendTo } from './bus.js';
import { settings } from './settings.js';

const STAGE = { worldW: 760, worldH: 1010, bubble: 210, bottom: 10, minW: 420 };

export function petGeometry(scale) {
  const s = Math.min(0.8, Math.max(0.18, Number(scale) || 0.36));
  const W = Math.max(STAGE.minW, Math.round(STAGE.worldW * s) + 40);
  const H = Math.round(STAGE.worldH * s) + STAGE.bubble + STAGE.bottom;
  return { scale: s, W, H, footX: W / 2, footY: H - STAGE.bottom, bubble: STAGE.bubble };
}

const displaysInfo = () => screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id }));

class PetWindow {
  win = null;
  geom = petGeometry(settings.get('pet.scale'));
  root = null;
  interactive = false;
  drag = null;
  lastSent = '';
  persistTimer = null;

  create() {
    this.root = this.#initialRoot();
    const pos = this.#windowPos(this.root);
    this.win = new BrowserWindow({
      x: pos.x, y: pos.y, width: this.geom.W, height: this.geom.H,
      transparent: true, frame: false, thickFrame: false, resizable: false, maximizable: false, minimizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: settings.get('pet.alwaysOnTop'),
      focusable: true, show: false, backgroundColor: '#00000000', title: '御园莓华',
      webPreferences: {
        preload: path.join(PRELOAD_DIR, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
        backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required',
      },
    });
    if (settings.get('pet.alwaysOnTop')) this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.loadURL(appUrl('renderer/pet/index.html'));
    this.win.once('ready-to-show', () => { if (settings.get('pet.visible')) this.win.showInactive(); });
    this.win.on('closed', () => { this.win = null; });
    // Keep geometry authoritative: if Windows rescales us while crossing monitors, restore.
    this.win.on('resized', () => this.#enforceBounds());
    this.win.on('moved', () => this.#enforceBounds());

    this.cursorTimer = setInterval(() => this.#pollCursor(), 33);
    this.topTimer = setInterval(() => {
      if (this.win && this.win.isVisible() && settings.get('pet.alwaysOnTop') && !this.drag) this.win.moveTop();
    }, 4000);
    const onDisplays = () => { this.setRoot(this.root, { persist: false }); sendTo(this.win, 'pet:displays', displaysInfo()); };
    screen.on('display-added', onDisplays);
    screen.on('display-removed', onDisplays);
    screen.on('display-metrics-changed', onDisplays);
    this.#registerRpc();
    bus.on('settings:changed', ({ changed }) => this.#onSettings(changed));
    return this.win;
  }

  /** With gravity and bouncing both off she may be pulled down behind the taskbar (her lower body hidden). */
  sinkAllowed() { return settings.get('pet.gravity') === false && settings.get('pet.bounce') === false; }
  sinkDepth() { return Math.round(560 * this.geom.scale); }

  #initialRoot() {
    const saved = settings.get('pet.position');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const d = screen.getDisplayNearestPoint({ x: Math.round(saved.x), y: Math.round(saved.y - 5) });
      const b = d.bounds;
      const maxY = this.sinkAllowed() ? d.workArea.y + d.workArea.height + this.sinkDepth() : b.y + b.height + 2;
      if (saved.x >= b.x && saved.x <= b.x + b.width && saved.y >= b.y && saved.y <= maxY) return { x: saved.x, y: saved.y };
    }
    const wa = screen.getPrimaryDisplay().workArea;
    return { x: wa.x + wa.width - Math.round(this.geom.W * 0.45), y: wa.y + wa.height };
  }

  #windowPos(root) {
    return { x: Math.round(root.x - this.geom.W / 2), y: Math.round(root.y - this.geom.footY) };
  }

  #enforceBounds() {
    if (!this.win || this.drag) return;
    const b = this.win.getBounds();
    const want = this.#windowPos(this.root);
    if (b.width !== this.geom.W || b.height !== this.geom.H || b.x !== want.x || b.y !== want.y) {
      this.win.setBounds({ ...want, width: this.geom.W, height: this.geom.H });
    }
  }

  /**
   * loose: dragging, falling, flying or resting off the floor — anywhere on the display, but never into the
   * taskbar; with sinking allowed the feet may go below the taskbar line by up to sinkDepth (the renderer clips
   * her at that line, so she looks tucked in behind the taskbar).
   */
  clampRoot(root, { loose = false } = {}) {
    const d = screen.getDisplayNearestPoint({ x: Math.round(root.x), y: Math.round(root.y - 2) });
    const area = loose ? d.bounds : d.workArea;
    const half = 60 * this.geom.scale;
    const minY = area.y + (loose ? 40 : 300 * this.geom.scale);
    const floor = d.workArea.y + d.workArea.height;
    const maxY = loose && this.sinkAllowed() ? floor + this.sinkDepth() : floor;
    return {
      x: Math.min(area.x + area.width - half, Math.max(area.x + half, root.x)),
      y: Math.min(maxY, Math.max(minY, root.y)),
    };
  }

  setRoot(root, { persist = true, loose = false } = {}) {
    if (!this.win) return;
    this.root = this.clampRoot(root, { loose });
    const pos = this.#windowPos(this.root);
    const key = `${pos.x},${pos.y}`;
    if (key !== this.lastSent) {
      this.lastSent = key;
      this.win.setBounds({ ...pos, width: this.geom.W, height: this.geom.H });
    }
    if (persist) {
      clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => settings.set('pet.position', { x: Math.round(this.root.x), y: Math.round(this.root.y) }), 1500);
    }
  }

  #pollCursor() {
    if (!this.win || this.win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    if (this.drag) {
      const now = performance.now();
      const next = { x: p.x - this.drag.offsetX, y: p.y - this.drag.offsetY };
      this.setRoot(next, { persist: false, loose: true });
      sendTo(this.win, 'pet:drag', { root: this.root, t: now });
      return;
    }
    const pos = this.#windowPos(this.root);
    sendTo(this.win, 'pet:cursor', { x: p.x, y: p.y, local: { x: p.x - pos.x, y: p.y - pos.y } });
  }

  startDrag(offsetX, offsetY) {
    if (settings.get('pet.lockPosition')) return false;
    this.drag = { offsetX, offsetY };
    clearInterval(this.cursorTimer);
    this.cursorTimer = setInterval(() => this.#pollCursor(), 8);
    return true;
  }

  endDrag() {
    if (!this.drag) return this.root;
    this.drag = null;
    clearInterval(this.cursorTimer);
    this.cursorTimer = setInterval(() => this.#pollCursor(), 33);
    this.setRoot(this.root, { persist: true, loose: true });
    return this.root;
  }

  setVisible(v) {
    if (!this.win) return;
    if (v) { this.win.showInactive(); if (settings.get('pet.alwaysOnTop')) this.win.moveTop(); } else this.win.hide();
  }

  #onSettings(changed) {
    if (!this.win) return;
    if (changed.includes('pet.scale')) {
      this.geom = petGeometry(settings.get('pet.scale'));
      this.lastSent = '';
      this.setRoot(this.root, { persist: false });
      this.win.setBounds({ ...this.#windowPos(this.root), width: this.geom.W, height: this.geom.H });
      sendTo(this.win, 'pet:geometry', this.geometry());
    }
    if (changed.includes('pet.visible')) this.setVisible(settings.get('pet.visible'));
    if (changed.includes('pet.alwaysOnTop')) this.win.setAlwaysOnTop(!!settings.get('pet.alwaysOnTop'), 'screen-saver');
  }

  geometry() {
    return { ...this.geom, root: this.root, window: this.#windowPos(this.root), displays: displaysInfo() };
  }

  #registerRpc() {
    rpc('pet.geometry', () => this.geometry());
    rpc('pet.root', (root) => {
      if (root && Number.isFinite(root.x) && Number.isFinite(root.y)) this.setRoot(root, { persist: !root.transient, loose: !!root.loose });
      return this.root;
    });
    rpc('pet.setInteractive', (on) => {
      if (!this.win || this.interactive === !!on) return;
      this.interactive = !!on;
      this.win.setIgnoreMouseEvents(!on, { forward: true });
    });
    rpc('pet.dragStart', ({ offsetX, offsetY }) => this.startDrag(offsetX, offsetY));
    rpc('pet.dragEnd', () => this.endDrag());
    rpc('pet.focus', () => {
      if (!this.win) return false;
      this.win.setFocusable(true);
      if (!this.win.isVisible()) this.win.showInactive();
      if (settings.get('pet.alwaysOnTop')) this.win.moveTop();
      this.win.focus();
      this.win.webContents.focus();
      return this.win.isFocused();
    });
    rpc('pet.blur', () => { if (this.win) this.win.blur(); });
  }

  destroy() {
    clearInterval(this.cursorTimer);
    clearInterval(this.topTimer);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}

export const petWindow = new PetWindow();
