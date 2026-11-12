// Notification-area icon and menu. The icon switches to a "busy" face while the AI or
// the workshop is working.
import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'node:path';
import { assetsDir } from './paths.js';
import { bus } from './bus.js';
import { settings } from './settings.js';

let tray = null;
let busy = false;

function icon(name) {
  const dir = path.join(assetsDir(), 'app');
  const img = nativeImage.createFromPath(path.join(dir, `${name}.png`));
  const hi = nativeImage.createFromPath(path.join(dir, `${name}@2x.png`));
  if (!hi.isEmpty()) img.addRepresentation({ scaleFactor: 2, buffer: hi.toPNG() });
  return img;
}

export function createTray({ openPanel, openChat, togglePet, quit }) {
  tray = new Tray(icon('tray'));
  tray.setToolTip('御园莓华');
  const build = () => {
    const s = settings.get();
    const flag = (label, p) => ({
      label, type: 'checkbox', checked: !!settings.get(p),
      click: (item) => { settings.set(p, item.checked); },
    });
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: s.pet.visible ? '让莓华先躲起来' : '叫莓华出来', click: togglePet },
      { label: '和她说话…', accelerator: s.app.hotkeys.chat, click: openChat },
      { label: '打开手账', accelerator: s.app.hotkeys.panel, click: () => openPanel('today') },
      { type: 'separator' },
      flag('安静模式', 'pet.quiet'),
      flag('允许自主移动', 'pet.allowWander'),
      flag('固定位置（禁止拖动）', 'pet.lockPosition'),
      flag('总在最前', 'pet.alwaysOnTop'),
      { type: 'separator' },
      { label: '设置…', click: () => openPanel('settings') },
      flag('开机自启', 'app.launchAtLogin'),
      { type: 'separator' },
      { label: `退出（v${app.getVersion()}）`, click: quit },
    ]));
  };
  build();
  tray.on('click', () => openPanel());
  tray.on('double-click', togglePet);
  bus.on('settings:changed', ({ changed }) => { if (changed.some((k) => k.startsWith('pet.') || k.startsWith('app.'))) build(); });
  bus.on('activity:busy', (on) => {
    if (!tray || on === busy) return;
    busy = on;
    tray.setImage(icon(on ? 'tray-busy' : 'tray'));
    tray.setToolTip(on ? '御园莓华 · 正在忙' : '御园莓华');
  });
  return tray;
}

export function trayBalloon(title, content) {
  if (tray && process.platform === 'win32') tray.displayBalloon({ title, content, iconType: 'none', noSound: true });
}
