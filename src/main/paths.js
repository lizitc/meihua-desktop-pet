import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC_DIR = path.join(APP_ROOT, 'src');
export const RENDERER_DIR = path.join(SRC_DIR, 'renderer');
export const PRELOAD_DIR = path.join(SRC_DIR, 'preload');

/** Character assets are large; when packaged they live unpacked in resources/assets. */
export function assetsDir() {
  if (app.isPackaged) {
    const res = path.join(process.resourcesPath, 'assets');
    if (fs.existsSync(res)) return res;
  }
  return path.join(APP_ROOT, 'assets');
}

export function userDir(...parts) {
  const dir = path.join(app.getPath('userData'), ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const dataFile = (name) => path.join(userDir('data'), name);

/** Resolve `child` inside `root`; returns null when it would escape. */
export function safeJoin(root, child) {
  const resolved = path.resolve(root, '.' + path.sep + child);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}
