// Renders walk-cycle pose guides for image generation (see guides.html).
//   electron scripts/walk-guides/main.mjs [--out=<dir>] [--stand=<approved standing png>]
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) || d;
const outDir = path.resolve(arg('out', path.join(here, '..', '..', 'art', 'walk-kit')));
const stand = arg('stand', path.join(here, '..', '..', '..', 'Meihua-Asset-Handoff-20261109', '05_Approved_Standing', 'renders', 'ich01A_101.png'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(here, 'guides.html'));
  const standUrl = fs.existsSync(stand) ? 'data:image/png;base64,' + fs.readFileSync(stand).toString('base64') : '';
  const files = await win.webContents.executeJavaScript(`window.render(${JSON.stringify(standUrl)})`);
  for (const [name, url] of Object.entries(files)) {
    const file = path.join(outDir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  }
  console.log(`wrote ${Object.keys(files).length} files to ${outDir}`);
  app.quit();
});
