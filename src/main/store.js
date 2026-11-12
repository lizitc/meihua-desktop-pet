// Small durable JSON store: atomic writes (tmp + rename), debounced saves,
// corrupted files are kept aside instead of being silently overwritten.
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.timer = null;
    this.data = this.#load();
  }

  #load() {
    try {
      if (fs.existsSync(this.file)) return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch {}
      console.error('[store] unreadable, reset:', this.file, err.message);
    }
    return structuredClone(this.defaults);
  }

  update(fn) {
    const r = fn(this.data);
    this.save();
    return r;
  }

  save(delay = 300) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), delay);
  }

  saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  flush() { if (this.timer) this.saveNow(); }
}

export const uid = (prefix = '') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
