// The notebook ("手账") window: chat history, today, calendar, todos, workshop, skills,
// memory and settings. Frameless with native caption buttons; closing hides it to the tray.
import { BrowserWindow, nativeTheme, screen } from 'electron';
import path from 'node:path';
import { PRELOAD_DIR, assetsDir } from './paths.js';
import { appUrl } from './protocol.js';
import { rpc, sendTo } from './bus.js';
import { settings } from './settings.js';

class PanelWindow {
  win = null;
  quitting = false;

  #create(page) {
    const saved = settings.get('app.panelBounds');
    const wa = screen.getPrimaryDisplay().workArea;
    const W = Math.min(1180, wa.width - 80), H = Math.min(780, wa.height - 60);
    let bounds = { width: W, height: H, x: Math.round(wa.x + (wa.width - W) / 2), y: Math.round(wa.y + (wa.height - H) / 2) };
    if (saved && Number.isFinite(saved.x)) {
      const d = screen.getDisplayMatching(saved);
      const b = d.workArea;
      if (saved.x < b.x + b.width - 80 && saved.x + saved.width > b.x + 80 && saved.y >= b.y - 10 && saved.y < b.y + b.height - 60) bounds = saved;
    }
    const dark = this.#isDark();
    this.win = new BrowserWindow({
      ...bounds, minWidth: 880, minHeight: 600, show: false, title: '莓华手账',
      backgroundColor: dark ? '#231a20' : '#fbf5ef',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#e9d9e0' : '#6b4a5c', height: 42 },
      icon: path.join(assetsDir(), 'app', 'icon.png'),
      webPreferences: { preload: path.join(PRELOAD_DIR, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    });
    this.win.loadURL(appUrl(`renderer/panel/index.html#${page || 'today'}`));
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('close', (e) => {
      if (!this.quitting) { e.preventDefault(); this.win.hide(); }
    });
    const persist = () => { if (this.win && !this.win.isMaximized() && !this.win.isMinimized()) settings.set('app.panelBounds', this.win.getBounds()); };
    this.win.on('resized', persist);
    this.win.on('moved', persist);
    this.win.on('closed', () => { this.win = null; });
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  #isDark() {
    const t = settings.get('app.theme');
    return t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors);
  }

  open(page) {
    if (!this.win) { this.#create(page); return; }
    if (page) sendTo(this.win, 'panel:navigate', page);
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  toggle() {
    if (this.win && this.win.isVisible() && this.win.isFocused()) this.win.hide();
    else this.open();
  }

  updateTheme() {
    if (!this.win) return;
    const dark = this.#isDark();
    this.win.setBackgroundColor(dark ? '#231a20' : '#fbf5ef');
    this.win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#e9d9e0' : '#6b4a5c', height: 42 });
  }

  register() {
    rpc('panel.open', (page) => { this.open(typeof page === 'string' ? page : undefined); return true; });
    rpc('panel.theme', () => this.updateTheme());
  }
}

export const panelWindow = new PanelWindow();
