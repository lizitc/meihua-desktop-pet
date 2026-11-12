// Notebook runtime helpers: RPC with readable errors, live data hooks, a tiny store,
// settings, routing, toasts, dialogs, dates and sanitized markdown.
import { html, useState, useEffect, useRef, useCallback } from '../vendor/ui.js';
import { marked } from '../vendor/marked.js';
import DOMPurify from '../vendor/purify.js';

export const api = window.meihua;

/** Electron wraps thrown errors as "Error invoking remote method 'rpc': Error: …". */
export function cleanError(err) {
  const m = String(err?.message || err || '出错了');
  return m.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(Error|TypeError|RangeError):\s*/, '');
}

export async function invoke(name, ...args) {
  try { return await api.invoke(name, ...args); } catch (err) { throw new Error(cleanError(err)); }
}

/** Run an RPC and toast the error instead of throwing. Returns undefined on failure. */
export async function attempt(name, ...args) {
  try { return await invoke(name, ...args); } catch (err) { toast(err.message, 'error'); return undefined; }
}

// ------------------------------------------------------------ store
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; for (const fn of subs) fn(state); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    use() {
      const [, force] = useState(0);
      useEffect(() => this.subscribe(() => force((n) => n + 1)), []);
      return state;
    },
  };
}

export function useEvent(name, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => api.on(name, (p) => ref.current(p)), [name]);
}

/** Load an RPC result and reload it whenever one of `events` fires. */
export function useRpc(name, args = [], events = []) {
  const [state, setState] = useState({ data: undefined, loading: true, error: null });
  const key = JSON.stringify(args);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const data = await invoke(name, ...args);
      if (my === seq.current) setState({ data, loading: false, error: null });
    } catch (err) {
      if (my === seq.current) setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [name, key]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    let timer = 0;
    const offs = events.map((ev) => api.on(ev, () => { clearTimeout(timer); timer = setTimeout(reload, 60); }));
    return () => { clearTimeout(timer); offs.forEach((f) => f()); };
  }, [reload, events.join('|')]);
  return { ...state, reload };
}

// ------------------------------------------------------------ settings
export const settingsStore = createStore({ s: null });
api.on('settings:changed', (s) => settingsStore.set({ s }));
export const loadSettings = async () => { const s = await invoke('settings.get'); settingsStore.set({ s }); return s; };
export const useSettings = () => settingsStore.use().s;
export async function patchSettings(patch) {
  try { const s = await invoke('settings.patch', patch); settingsStore.set({ s }); return s; } catch (err) { toast(err.message, 'error'); return null; }
}
/** Build a nested patch from a dotted path. */
export function pathPatch(path, value) {
  const keys = path.split('.');
  const out = {};
  keys.reduce((o, k, i) => (o[k] = i === keys.length - 1 ? value : {}), out);
  return out;
}
export const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// ------------------------------------------------------------ routing  (#page or #page/sub)
const parseHash = () => { const [page, ...rest] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/'); return { page: page || 'today', sub: rest.join('/') }; };
export const routeStore = createStore(parseHash());
window.addEventListener('hashchange', () => routeStore.set(parseHash()));
api.on('panel:navigate', (p) => navigate(p));
export function navigate(path) { const h = '#' + path; if (location.hash !== h) location.hash = h; else routeStore.set(parseHash()); }
export const useRoute = () => routeStore.use();

// ------------------------------------------------------------ toasts
export const toastStore = createStore({ list: [] });
let toastSeq = 0;
export function toast(text, kind = 'info', ms = 3200) {
  const id = ++toastSeq;
  toastStore.set((s) => ({ list: [...s.list.slice(-3), { id, text, kind }] }));
  setTimeout(() => toastStore.set((s) => ({ list: s.list.filter((t) => t.id !== id) })), ms);
}

// ------------------------------------------------------------ dialogs
export const dialogStore = createStore({ stack: [] });
let dialogSeq = 0;
/** Open a dialog component; it receives { close(value) } and resolves the promise. */
export function openDialog(Component, props = {}) {
  return new Promise((resolve) => {
    const id = ++dialogSeq;
    const close = (value) => { dialogStore.set((s) => ({ stack: s.stack.filter((d) => d.id !== id) })); resolve(value); };
    dialogStore.set((s) => ({ stack: [...s.stack, { id, Component, props: { ...props, close } }] }));
  });
}

function ConfirmBox({ title, body, ok = '确定', cancel = '取消', danger, extra, close }) {
  return html`<div class="dialog-body narrow">
    <h3 class="dialog-title">${title}</h3>
    ${body ? html`<p class="dialog-text">${body}</p>` : null}
    <div class="dialog-actions">
      ${cancel ? html`<button class="btn" onClick=${() => close(false)}>${cancel}</button>` : null}
      ${extra ? html`<button class="btn" onClick=${() => close(extra.value)}>${extra.label}</button>` : null}
      <button class=${`btn ${danger ? 'danger' : 'primary'}`} onClick=${() => close(true)} autofocus>${ok}</button>
    </div>
  </div>`;
}
export const confirmBox = (opts) => openDialog(ConfirmBox, opts);

// ------------------------------------------------------------ dates (local time, "YYYY-MM-DD[THH:mm]")
export const pad = (n) => String(n).padStart(2, '0');
export const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtDateTime = (d) => `${fmtDate(d)}T${fmtTime(d)}`;
export const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export function parseLocal(s) {
  if (s instanceof Date) return new Date(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(s || ''));
  if (!m) return new Date(NaN);
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export function dayLabel(d, now = new Date()) {
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  const same = d.getFullYear() === now.getFullYear();
  return `${same ? '' : d.getFullYear() + '年'}${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
}
/** "今天 15:00" / "明天" / "11月12日 周四 09:30" */
export function whenLabel(s, now = new Date()) {
  if (!s) return '';
  const d = parseLocal(s);
  if (isNaN(d)) return String(s);
  return isDateOnly(s) ? dayLabel(d, now) : `${dayLabel(d, now)} ${fmtTime(d)}`;
}
export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 50) return '刚刚';
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  const d = new Date(ts);
  return s < 86400 * 6 ? `${dayLabel(d)} ${fmtTime(d)}` : `${d.getMonth() + 1}月${d.getDate()}日`;
}
export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return '夜深了';
  if (h < 9) return '早上好';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  if (h < 22) return '晚上好';
  return '夜深了';
}

// ------------------------------------------------------------ markdown
marked.setOptions({ gfm: true, breaks: true });
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('rel', 'noreferrer'); node.removeAttribute('target'); }
});
export function mdToHtml(text) {
  try { return DOMPurify.sanitize(marked.parse(String(text || ''))); } catch { return DOMPurify.sanitize(String(text || '')); }
}

export function Markdown({ text, class: cls = '' }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = mdToHtml(text); }, [text]);
  const onClick = (e) => {
    const a = e.target.closest?.('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) api.invoke('system.openExternal', href);
  };
  return html`<div class=${`md ${cls}`} ref=${ref} onClick=${onClick}></div>`;
}

// ------------------------------------------------------------ misc
/** Form field binder: set('title') handles input events and plain values, using
 *  functional updates so quick successive edits never overwrite each other. */
export const fieldSetter = (setF) => (k) => (e) => {
  const t = e?.currentTarget;
  const v = t && 'value' in t ? (t.type === 'checkbox' ? t.checked : t.value) : e;
  setF((p) => ({ ...p, [k]: v }));
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const portrait = 'meihua://app/assets/app/portrait.png';

/** Read an image File into { media_type, data(base64), name, url }, downscaling big ones. */
export async function readImage(file) {
  const MAX_BYTES = 3.5 * 1024 * 1024, MAX_SIDE = 1600;
  let blob = file;
  const type = file.type || 'image/png';
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error('只支持 PNG / JPEG / WebP / GIF 图片');
  if (file.size > MAX_BYTES || type === 'image/webp') {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const media_type = blob.type || type;
  return { media_type, data: btoa(bin), name: file.name || 'image', url: URL.createObjectURL(blob) };
}
