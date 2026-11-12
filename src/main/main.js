// Main process entry.
import './early.js';
import fs from 'node:fs';
import path from 'node:path';
import { app, globalShortcut, powerMonitor, session, shell, nativeTheme } from 'electron';
import { assetsDir } from './paths.js';
import { registerSchemes, handleProtocol } from './protocol.js';
import { installRpc, rpc, bus, broadcast } from './bus.js';
import { settings } from './settings.js';
import { petWindow } from './pet-window.js';
import { panelWindow } from './panel-window.js';
import { createTray } from './tray.js';
import { selftestDir, runSelftest } from './selftest.js';
import { startServices, stopServices } from './services.js';

const SELFTEST = selftestDir();

registerSchemes();
if (!SELFTEST && !app.requestSingleInstanceLock()) app.exit(0);
app.setAppUserModelId('com.meihua.desktop');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

function registerCoreRpc() {
  rpc('settings.get', () => settings.publicView());
  rpc('settings.patch', (patch) => { settings.patch(patch || {}); return settings.publicView(); });
  rpc('settings.setSecret', (name, value) => { settings.setSecret(String(name), value ? String(value) : ''); return true; });
  rpc('system.idle', () => powerMonitor.getSystemIdleTime());
  rpc('system.openExternal', (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return true; });
  rpc('system.openPath', (p) => shell.openPath(String(p)));
  rpc('system.showItem', (p) => { shell.showItemInFolder(String(p)); return true; });
  // is a locally installed AI service running? (fixed loopback endpoints only)
  rpc('local.probe', async (id) => {
    const URLS = { ollama: 'http://127.0.0.1:11434/api/tags', lmstudio: 'http://127.0.0.1:1234/v1/models', sovits: 'http://127.0.0.1:9880/' };
    const url = URLS[id];
    if (!url) return { up: false };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      let models = [];
      if (res.ok && id !== 'sovits') {
        const j = await res.json().catch(() => ({}));
        models = (j.models || j.data || []).map((m) => m.name || m.id).filter(Boolean);
      }
      return { up: true, models };
    } catch { return { up: false }; }
  });
  rpc('app.hotkeyStatus', () => hotkeyFailures);
  rpc('app.stickers', () => {
    try { return fs.readdirSync(path.join(assetsDir(), 'app', 'stickers')).filter((f) => /\.png$/i.test(f)).map((f) => f.slice(0, -4)); }
    catch { return []; }
  });
  rpc('app.info', () => ({ version: app.getVersion(), electron: process.versions.electron, userData: app.getPath('userData'), packaged: app.isPackaged }));
  rpc('pet.ready', () => bus.emit('pet:ready'));
  rpc('pet.fatal', (msg) => console.error('[pet renderer]', msg));
  rpc('pet.state', (st) => bus.emit('pet:state', st));
  bus.on('settings:changed', ({ changed }) => {
    broadcast('settings:changed', settings.publicView());
    if (changed.some((k) => k.startsWith('app.hotkeys'))) registerHotkeys();
    if (changed.includes('app.launchAtLogin')) applyLoginItem();
    if (changed.includes('app.theme')) { nativeTheme.themeSource = settings.get('app.theme'); panelWindow.updateTheme(); }
  });
}

function togglePet() { settings.set('pet.visible', !settings.get('pet.visible')); }
function openChat() {
  if (!settings.get('pet.visible')) settings.set('pet.visible', true);
  broadcast('pet:open-input');
}

let hotkeyFailures = [];
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = settings.get('app.hotkeys') || {};
  const failed = [];
  const reg = (name, acc, fn) => {
    if (!acc) return;
    try { if (!globalShortcut.register(acc, fn)) { failed.push(name); console.warn('[hotkey] in use:', acc); } }
    catch (err) { failed.push(name); console.warn('[hotkey]', acc, err.message); }
  };
  reg('toggle', hk.toggle, togglePet);
  reg('chat', hk.chat, openChat);
  reg('panel', hk.panel, () => panelWindow.toggle());
  hotkeyFailures = failed;
  broadcast('hotkeys:status', failed);
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!settings.get('app.launchAtLogin'), args: ['--autostart'] });
}

app.on('second-instance', () => panelWindow.open());

app.whenReady().then(async () => {
  handleProtocol();
  installRpc();
  registerCoreRpc();
  nativeTheme.themeSource = settings.get('app.theme') || 'system';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read'].includes(permission)));
  panelWindow.register();
  petWindow.create();
  await startServices();
  if (SELFTEST) {
    bus.once('pet:ready', () => runSelftest({ outDir: SELFTEST, petWindow, panelWindow }));
    return;
  }
  createTray({ openPanel: (p) => panelWindow.open(p), openChat, togglePet, quit: () => app.quit() });
  registerHotkeys();
  applyLoginItem();
  if (!settings.get('onboarded')) panelWindow.open('welcome');
});

app.on('before-quit', () => { panelWindow.quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopServices();
  settings.flush();
});
app.on('window-all-closed', () => { /* keep running in the tray */ });
