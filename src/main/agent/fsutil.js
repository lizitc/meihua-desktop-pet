// File-system helpers for the workshop agent: path confinement, glob, grep, listing.
import fs from 'node:fs';
import path from 'node:path';

export const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.cache', 'out', 'target', '.idea', '.vs']);

/** Resolve p against root; returns { abs, inside } (inside = within root). */
export function resolveIn(root, p) {
  const abs = path.resolve(root, String(p || '.'));
  let real = abs;
  try { real = fs.realpathSync.native(abs); } catch { /* may not exist yet */ }
  const rel = path.relative(root, real);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  return { abs, inside };
}

export function globToRegExp(glob) {
  let re = '';
  let i = 0;
  const g = glob.replace(/\\/g, '/');
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 3 : 2; continue; }
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = g.indexOf('}', i); if (end > i) { re += `(?:${g.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`; i = end + 1; continue; } re += '\\{'; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    i++;
  }
  return new RegExp(`^${re}$`, 'i');
}

export function* walk(dir, { maxFiles = 20000 } = {}) {
  const stack = [dir];
  let n = 0;
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(p); }
      else if (e.isFile()) { yield p; if (++n >= maxFiles) return; }
    }
  }
}

export function glob(root, pattern, limit = 300) {
  const re = globToRegExp(pattern.includes('/') || pattern.startsWith('**') ? pattern : `**/${pattern}`);
  const out = [];
  for (const f of walk(root)) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (re.test(rel)) { out.push(rel); if (out.length >= limit) break; }
  }
  return out;
}

const isBinary = (buf) => { const n = Math.min(buf.length, 4000); for (let i = 0; i < n; i++) if (buf[i] === 0) return true; return false; };

export function grep(root, pattern, { include, ignoreCase = false, limit = 200 } = {}) {
  let re;
  try { re = new RegExp(pattern, ignoreCase ? 'i' : ''); } catch (err) { throw new Error(`正则无效：${err.message}`); }
  const inc = include ? globToRegExp(include.includes('/') ? include : `**/${include}`) : null;
  const out = [];
  for (const f of walk(root)) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (inc && !inc.test(rel)) continue;
    let buf;
    try { const st = fs.statSync(f); if (st.size > 2 * 1024 * 1024) continue; buf = fs.readFileSync(f); } catch { continue; }
    if (isBinary(buf)) continue;
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) { out.push(`${rel}:${i + 1}: ${lines[i].slice(0, 240)}`); if (out.length >= limit) return out; }
    }
  }
  return out;
}

export function listDir(dir, depth = 1, prefix = '', out = [], limit = 400) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { throw new Error(`无法读取目录：${err.message}`); }
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (out.length >= limit) { out.push(`${prefix}…`); break; }
    if (e.isDirectory()) {
      out.push(`${prefix}${e.name}/`);
      if (depth > 1 && !SKIP_DIRS.has(e.name)) listDir(path.join(dir, e.name), depth - 1, prefix + '  ', out, limit);
    } else {
      let size = '';
      try { const s = fs.statSync(path.join(dir, e.name)).size; size = s > 1024 * 1024 ? ` (${(s / 1048576).toFixed(1)}MB)` : s > 1024 ? ` (${Math.round(s / 1024)}KB)` : ` (${s}B)`; } catch { /* ignore */ }
      out.push(`${prefix}${e.name}${size}`);
    }
  }
  return out;
}

export function readText(file, { offset = 1, limit = 2000 } = {}) {
  const st = fs.statSync(file);
  if (st.isDirectory()) throw new Error('这是一个目录，请用 list_dir');
  if (st.size > 8 * 1024 * 1024) throw new Error('文件太大（>8MB）');
  const buf = fs.readFileSync(file);
  if (isBinary(buf)) return `（二进制文件，${st.size} 字节）`;
  const lines = buf.toString('utf8').split(/\r?\n/);
  const start = Math.max(1, offset);
  const slice = lines.slice(start - 1, start - 1 + limit);
  const body = slice.map((l, i) => `${String(start + i).padStart(5)}\t${l.length > 2000 ? l.slice(0, 2000) + '…' : l}`).join('\n');
  const more = start - 1 + limit < lines.length ? `\n…（共 ${lines.length} 行，可用 offset 继续读取）` : '';
  return body + more;
}
