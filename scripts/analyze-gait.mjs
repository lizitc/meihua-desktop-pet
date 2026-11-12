// Analyse ground contacts of in-place loops to derive root-motion speed.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve('../Meihua-Asset-Handoff-20261109/01_Production');
const [seq, baselineArg, bandArg] = process.argv.slice(2);
const baseline = Number(baselineArg);
const band = Number(bandArg || 8);

for (let i = 0; i < 64; i++) {
  const file = path.join(ROOT, seq, 'frames', `frame-${String(i).padStart(3, '0')}.png`);
  const { width, height, data } = PNG.sync.read(fs.readFileSync(file));
  const cols = [];
  for (let x = 0; x < width; x++) {
    let hit = false;
    for (let y = baseline - band; y <= Math.min(height - 1, baseline); y++) {
      if (data[(y * width + x) * 4 + 3] > 96) { hit = true; break; }
    }
    cols.push(hit);
  }
  const runs = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    const v = x < width && cols[x];
    if (v && start < 0) start = x;
    if (!v && start >= 0) { if (x - start >= 3) runs.push([start, x - 1]); start = -1; }
  }
  console.log(String(i).padStart(2), runs.map(([a, b]) => `${a}-${b}`).join('  '));
}
