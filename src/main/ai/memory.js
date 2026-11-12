// Long-term memory about the owner: short facts the AI saves (and the owner can edit),
// plus episode summaries written when a long conversation is compacted.
import { JsonStore, uid } from '../store.js';
import { dataFile } from '../paths.js';
import { rpc, broadcast } from '../bus.js';

const CATS = ['profile', 'preference', 'habit', 'relationship', 'work', 'event', 'episode', 'other'];
export const CAT_LABEL = { profile: '基本信息', preference: '喜好', habit: '习惯', relationship: '人际', work: '工作学习', event: '事件', episode: '对话回顾', other: '其他' };

// character bigrams for CJK, words for latin text
function grams(s) {
  const t = String(s || '').toLowerCase();
  const out = new Set();
  for (const w of t.match(/[a-z0-9_]+/g) || []) if (w.length > 1) out.add(w);
  const cjk = t.replace(/[^㐀-鿿]/g, '');
  for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2));
  if (cjk.length === 1) out.add(cjk);
  return out;
}

class Memory {
  constructor() {
    this.store = new JsonStore(dataFile('memory.json'), { items: [] });
  }

  get items() { return this.store.data.items; }

  #changed() { broadcast('memory:changed'); }

  save({ text, category = 'other', pinned = false }, source = 'ai') {
    const clean = String(text || '').trim().slice(0, 500);
    if (!clean) throw new Error('记忆内容为空');
    // de-duplicate near-identical facts
    const g = grams(clean);
    for (const m of this.items) {
      const h = grams(m.text);
      let inter = 0; for (const x of g) if (h.has(x)) inter++;
      const sim = inter / Math.max(1, Math.min(g.size, h.size));
      if (sim > 0.85 && m.category === category) { m.text = clean; m.updatedAt = Date.now(); this.store.save(); this.#changed(); return { ...m, merged: true }; }
    }
    const item = { id: uid('m_'), text: clean, category: CATS.includes(category) ? category : 'other', pinned: !!pinned, source, createdAt: Date.now(), updatedAt: Date.now(), uses: 0 };
    this.items.push(item);
    if (this.items.length > 2000) this.items.splice(0, this.items.length - 2000);
    this.store.save();
    this.#changed();
    return item;
  }

  update(id, patch) {
    const m = this.items.find((x) => x.id === id);
    if (!m) throw new Error('找不到这条记忆');
    if (patch.text != null) m.text = String(patch.text).slice(0, 500);
    if (patch.category && CATS.includes(patch.category)) m.category = patch.category;
    if (patch.pinned != null) m.pinned = !!patch.pinned;
    m.updatedAt = Date.now();
    this.store.save();
    this.#changed();
    return m;
  }

  forget(id) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('找不到这条记忆');
    const [m] = this.items.splice(i, 1);
    this.store.save();
    this.#changed();
    return { ok: true, text: m.text };
  }

  search(query, limit = 8) {
    const q = grams(query);
    if (!q.size) return this.items.slice(-limit).reverse();
    const scored = [];
    for (const m of this.items) {
      const g = grams(m.text);
      let s = 0; for (const x of q) if (g.has(x)) s++;
      if (s > 0) scored.push([s / Math.sqrt(g.size + 1) + (m.pinned ? 0.3 : 0), m]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const out = scored.slice(0, limit).map(([, m]) => m);
    for (const m of out) m.uses = (m.uses || 0) + 1;
    if (out.length) this.store.save(2000);
    return out;
  }

  /** Facts injected into the system prompt: pinned + profile/preferences, then recent. */
  core(max = 40) {
    const pri = (m) => (m.pinned ? 0 : ['profile', 'preference', 'relationship', 'habit'].includes(m.category) ? 1 : m.category === 'episode' ? 3 : 2);
    return [...this.items].sort((a, b) => pri(a) - pri(b) || b.updatedAt - a.updatedAt).slice(0, max);
  }

  registerRpc() {
    rpc('memory.list', () => [...this.items].sort((a, b) => b.updatedAt - a.updatedAt));
    rpc('memory.add', (m) => this.save(m, 'user'));
    rpc('memory.update', (id, patch) => this.update(id, patch));
    rpc('memory.forget', (id) => this.forget(id));
  }

  flush() { this.store.flush(); }
}

export const memory = new Memory();
export { CATS };
