// Extension host (Electron utilityProcess). Loads enabled extensions' main.mjs and runs
// their tool functions on request. Crashes here never take down the app.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const loaded = new Map(); // id -> { mod, dir }

function storage(dir) {
  const file = path.join(dir, 'data.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  return {
    get: (k) => read()[k],
    set: (k, v) => { const d = read(); d[k] = v; fs.writeFileSync(file, JSON.stringify(d, null, 1)); return true; },
    all: read,
  };
}

async function load(id, dir, version) {
  const url = pathToFileURL(path.join(dir, 'main.mjs')).href + `?v=${encodeURIComponent(version || Date.now())}`;
  const mod = await import(url);
  loaded.set(id, { mod, dir });
}

process.parentPort.on('message', async (e) => {
  const msg = e.data;
  const reply = (payload) => process.parentPort.postMessage({ callId: msg.callId, ...payload });
  try {
    if (msg.type === 'load') { await load(msg.id, msg.dir, msg.version); reply({ ok: true }); return; }
    if (msg.type === 'unload') { loaded.delete(msg.id); reply({ ok: true }); return; }
    if (msg.type === 'call') {
      const ext = loaded.get(msg.id);
      if (!ext) throw new Error(`扩展 ${msg.id} 未加载`);
      const fn = ext.mod[msg.tool];
      if (typeof fn !== 'function') throw new Error(`扩展没有导出函数 ${msg.tool}`);
      const logs = [];
      const ctx = { fetch: globalThis.fetch, log: (...a) => logs.push(a.map(String).join(' ')), storage: storage(ext.dir), dir: ext.dir };
      const result = await Promise.race([
        fn(msg.input || {}, ctx),
        new Promise((_, rej) => setTimeout(() => rej(new Error('扩展执行超时（60 秒）')), 60000)),
      ]);
      reply({ ok: true, result: result === undefined ? null : result, logs });
    }
  } catch (err) {
    reply({ ok: false, error: String(err?.stack || err?.message || err).slice(0, 2000) });
  }
});
