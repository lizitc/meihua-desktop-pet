// One-off analysis: alpha bounds of representative frames so we can unify display scale.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(process.argv[2] || '../Meihua-Asset-Handoff-20261109/01_Production');

function bounds(file, threshold = 24) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  // head-row width: widest run in the top 18% of figure height (ears+hair)
  return { file: path.relative(ROOT, file), width, height, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, bottom: maxY };
}

const list = [
  'standing/base.png',
  'walk-right/frames/frame-000.png',
  'walk-right/frames/frame-016.png',
  'walk-right/frames/frame-032.png',
  'walk-right/frames/frame-048.png',
  'crawl/frames/frame-000.png',
  'crawl/key-00.png',
  'poses/sit.png',
  'poses/sleep.png',
  'lower-keyframes/lower-0.png',
  'lower-keyframes/lower-3.png',
  'transitions-v5/stand-crawl/frame-000.png',
  'transitions-v5/stand-crawl/frame-072.png',
  'transitions-v5/stand-sit/frame-000.png',
  'transitions-v5/stand-sit/frame-072.png',
  'transitions-v5/stand-sleep/frame-000.png',
  'transitions-v5/stand-sleep/frame-072.png',
  'transitions-v5/crawl-sit/frame-000.png',
  'transitions-v5/crawl-sit/frame-072.png',
  'transitions-v5/crawl-sleep/frame-000.png',
  'transitions-v5/crawl-sleep/frame-072.png',
  'transitions-v5/sit-sleep/frame-000.png',
  'transitions-v5/sit-sleep/frame-072.png',
  'transitions-v5/stand-sit-left/frame-000.png',
  'transitions-v5/stand-sit-left/frame-072.png',
  'transitions-v5/crawl-rest-1/frame-000.png',
  'transitions-v5/crawl-rest-1/frame-016.png',
];
for (const f of list) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { console.log('MISSING', f); continue; }
  const b = bounds(p);
  console.log(`${b.file.padEnd(48)} ${b.width}x${b.height}  bbox x=${b.x} y=${b.y} w=${b.w} h=${b.h} bottom=${b.bottom}`);
}
