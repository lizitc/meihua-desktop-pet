// Renders the NSIS installer artwork (character-themed) into build/:
//   installerSidebar.bmp / uninstallerSidebar.bmp (164x314)  and  installerHeader.bmp (150x57)
// Run with Electron:  node_modules\electron\dist\electron.exe scripts/installer-art.mjs
// Each image is laid out in HTML at 1x, rendered at 4x in an offscreen window and box-downsampled,
// then written as a 24-bit BMP (the only format NSIS / MUI2 accepts).
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build');
const SCALE = 4;
const BG = '#fff5f7';                       // = MUI_BGCOLOR in build/installer.nsh
const url = (p) => pathToFileURL(path.join(ROOT, p)).href;
const HANDOFF = path.resolve(ROOT, '..', 'Meihua-Asset-Handoff-20261109', '01_Production', 'standing');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});      // each job closes its window; don't quit between jobs

const FONT = `"HarmonyOS Sans SC", "MiSans", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`;

/** Lace frame from the generated background, as a 9-slice (corners undistorted). */
const frame = (fill) => `<div class="frame ${fill ? 'fill' : ''}"></div>`;

function sidebarHtml({ figure, overlay, title, sub, mood }) {
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 164px; height: 314px; overflow: hidden; background: ${BG}; }
  body { position: relative; font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
  .frame { position: absolute; inset: 0; border-style: solid; border-width: 53px 14px 40px 14px; box-sizing: border-box;
    border-image: url("${url('art/installer/sidebar-bg-try-1.png')}") 330 90 250 90 / 53px 14px 40px 14px stretch round; }
  .frame.fill { border-image: url("${url('art/installer/sidebar-bg-try-1.png')}") 330 90 250 90 fill / 53px 14px 40px 14px stretch round; }
  .glow { position: absolute; left: 50%; top: 150px; width: 210px; height: 210px; margin: -105px 0 0 -105px; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(255,255,255,.85), rgba(255,255,255,0)); }
  .fig { position: absolute; left: -15px; top: 27px; width: 194px; height: 382px;
    -webkit-mask-image: linear-gradient(180deg, #000 0, #000 205px, transparent 262px); }
  .fig img { position: absolute; inset: 0; width: 100%; height: 100%; filter: drop-shadow(0 2px 3px rgba(150, 60, 90, .22)); }
  .fig img + img { filter: none; }
  .title { position: absolute; left: 0; right: 0; top: 246px; text-align: center; }
  .name { font-size: 21px; font-weight: 800; letter-spacing: 3px; color: #c43c63; padding-left: 3px;
    text-shadow: 0 0 2px #fff, 0 0 3px #fff, 0 0 5px #fff, 0 1px 0 #fff; }
  .sub { margin-top: 1px; font-size: 9.5px; letter-spacing: 1.2px; color: #8d5a72; text-shadow: 0 0 2px #fff, 0 0 3px #fff; }
  .mood { position: absolute; right: 15px; top: 95px; font-size: 9px; color: #c43c63; background: rgba(255,255,255,.92); border-radius: 8px 8px 2px 8px;
    padding: 2px 6px; box-shadow: 0 1px 2px rgba(150,60,90,.25); letter-spacing: .5px; }
  .paws { position: absolute; left: 22px; top: 214px; font-size: 0; }
  </style><body>
  ${frame(true)}
  <div class="glow"></div>
  <div class="fig"><img src="${figure}">${overlay ? `<img src="${overlay}">` : ''}</div>
  ${frame(false)}
  ${mood ? `<div class="mood">${mood}</div>` : ''}
  <div class="title"><div class="name">${title}</div><div class="sub">${sub}</div></div>
  </body>`;
}

function headerHtml() {
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 150px; height: 57px; overflow: hidden; background: ${BG}; }
  body { position: relative; font-family: ${FONT}; }
  .band { position: absolute; inset: 0; background:
      radial-gradient(circle at 118px 30px, #ffd9e3 0, #ffd9e3 25px, rgba(255,217,227,0) 44px),
      linear-gradient(90deg, rgba(255,226,234,0) 0, #ffe6ed 62%, #ffdbe5 100%); }
  .dots { position: absolute; inset: 0; background: radial-gradient(circle, rgba(228,87,123,.16) 0 1px, transparent 1.3px) 0 0 / 8px 8px;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 70%); }
  .face { position: absolute; right: 9px; top: 5px; width: 47px; height: 47px; border-radius: 50%; overflow: hidden;
    border: 2px solid #fff; box-shadow: 0 1px 3px rgba(150,60,90,.3), 0 0 0 1px rgba(228,87,123,.35); background: #fff; }
  .face img { position: absolute; left: -9px; top: -4px; width: 64px; height: 66px; }
  .berry { position: absolute; width: 15px; height: 15px; }
  .b1 { right: 4px; bottom: 2px; transform: rotate(18deg); }
  .b2 { right: 54px; top: 3px; width: 11px; height: 11px; transform: rotate(-20deg); opacity: .9; }
  .paw { position: absolute; width: 10px; height: 10px; color: rgba(228,87,123,.45); }
  .p1 { right: 66px; bottom: 9px; transform: rotate(-18deg); } .p2 { right: 82px; bottom: 20px; width: 8px; height: 8px; transform: rotate(-10deg); opacity: .7; }
  .p3 { right: 97px; bottom: 11px; width: 7px; height: 7px; opacity: .45; }
  </style><body><div class="band"></div><div class="dots"></div>
  ${['p1', 'p2', 'p3'].map((p) => `<svg class="paw ${p}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 11.6c2.9 0 5.1 2.4 5.1 4.8 0 2-1.7 2.9-3.1 2.9-.9 0-1.3-.4-2-.4s-1.1.4-2 .4c-1.4 0-3.1-.9-3.1-2.9 0-2.4 2.2-4.8 5.1-4.8z"/><ellipse cx="6.2" cy="10.2" rx="1.8" ry="2.2"/><ellipse cx="9.7" cy="5.9" rx="1.8" ry="2.3"/><ellipse cx="14.3" cy="5.9" rx="1.8" ry="2.3"/><ellipse cx="17.8" cy="10.2" rx="1.8" ry="2.2"/></svg>`).join('')}
  <div class="face"><img src="${url('assets/app/portrait.png')}"></div>
  <img class="berry b1" src="${url('assets/app/foods/strawberry.png')}"><img class="berry b2" src="${url('assets/app/foods/strawberry.png')}">
  </body>`;
}

let seq = 0;
async function render(html, w, h) {
  const file = path.join(os.tmpdir(), `meihua-installer-art-${process.pid}-${++seq}.html`);
  fs.writeFileSync(file, html, 'utf8');
  const win = new BrowserWindow({ show: false, width: w * SCALE, height: h * SCALE, useContentSize: true, frame: false,
    webPreferences: { offscreen: true, zoomFactor: SCALE, backgroundThrottling: false } });
  win.webContents.setFrameRate(10);
  await win.loadFile(file);
  win.webContents.setZoomFactor(SCALE);
  await win.webContents.executeJavaScript(`Promise.all([...document.images].map((i) => i.decode().catch(() => {}))).then(() => document.fonts.ready).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`);
  await new Promise((r) => setTimeout(r, 400));
  // Windows clamps windows to the screen height, so tall images are captured in scrolled tiles.
  const [, ch] = win.getContentSize();
  const vh = Math.min(h, Math.floor(ch / SCALE));
  const size = { width: w * SCALE, height: h * SCALE };
  const bgra = Buffer.alloc(size.width * size.height * 4);
  for (let o = 0; ; o = Math.min(o + vh, h - vh)) {
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${o}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    await new Promise((r) => setTimeout(r, 150));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size.width, height: vh * SCALE });
    const got = img.getSize(), px = img.toBitmap();
    if (got.width !== size.width || got.height !== vh * SCALE) throw new Error(`capture ${got.width}x${got.height}, expected ${size.width}x${vh * SCALE}`);
    px.copy(bgra, o * SCALE * size.width * 4, 0, got.width * got.height * 4);
    if (o + vh >= h) break;
  }
  win.destroy();
  fs.rmSync(file, { force: true });
  // box filter SCALE x SCALE -> 1 px
  const rgb = Buffer.alloc(w * h * 3);
  const kx = size.width / w, ky = size.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = Math.floor(y * ky); yy < Math.floor((y + 1) * ky); yy++) for (let xx = Math.floor(x * kx); xx < Math.floor((x + 1) * kx); xx++) {
      const i = (yy * size.width + xx) * 4; b += bgra[i]; g += bgra[i + 1]; r += bgra[i + 2]; n++;
    }
    const o = (y * w + x) * 3; rgb[o] = Math.round(r / n); rgb[o + 1] = Math.round(g / n); rgb[o + 2] = Math.round(b / n);
  }
  return { w, h, rgb };
}

function writeBmp(file, { w, h, rgb }) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * h);
  buf.write('BM', 0); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * h, 34); buf.writeInt32LE(2835, 38); buf.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const dst = 54 + (h - 1 - y) * row;           // bottom-up
    for (let x = 0; x < w; x++) { const s = (y * w + x) * 3, d = dst + x * 3; buf[d] = rgb[s + 2]; buf[d + 1] = rgb[s + 1]; buf[d + 2] = rgb[s]; }
  }
  fs.writeFileSync(file, buf);
}

function writePng(file, { w, h, rgb }) {
  // preview copy for review (uses the same pixels); nativeImage needs BGRA
  const bgra = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { bgra[i * 4] = rgb[i * 3 + 2]; bgra[i * 4 + 1] = rgb[i * 3 + 1]; bgra[i * 4 + 2] = rgb[i * 3]; bgra[i * 4 + 3] = 255; }
  return import('electron').then(({ nativeImage }) => fs.writeFileSync(file, nativeImage.createFromBitmap(bgra, { width: w, height: h }).toPNG()));
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const preview = process.argv.find((a) => a.startsWith('--preview='))?.slice(10);
    const sadBase = path.join(HANDOFF, 'base.png'), sadFace = path.join(HANDOFF, 'expressions', 'ich01A_301a.png');
    const jobs = [
      ['installerSidebar', sidebarHtml({ figure: url('assets/app/standing.png'), title: '御园莓华', sub: 'AI 桌面伙伴 · 全职助手', mood: '初次见面～' }), 164, 314],
      ['uninstallerSidebar', sidebarHtml(fs.existsSync(sadFace)
        ? { figure: pathToFileURL(sadBase).href, overlay: pathToFileURL(sadFace).href, title: '御园莓华', sub: '还会再见面的吧……', mood: '要走了吗？' }
        : { figure: url('assets/app/standing.png'), title: '御园莓华', sub: '还会再见面的吧……', mood: '要走了吗？' }), 164, 314],
      ['installerHeader', headerHtml(), 150, 57],
    ];
    for (const [name, html, w, h] of jobs) {
      const img = await render(html, w, h);
      writeBmp(path.join(OUT, `${name}.bmp`), img);
      if (preview) { fs.mkdirSync(preview, { recursive: true }); await writePng(path.join(preview, `${name}.png`), img); }
      console.log(`wrote build/${name}.bmp (${w}x${h})`);
    }
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
