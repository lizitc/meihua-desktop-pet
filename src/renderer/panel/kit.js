// Notebook UI kit: sheets with washi tape, stitched toggles, segmented tabs, fields,
// paw checkboxes, empty states, dialog host and toast stack.
import { html, useEffect, useRef, useState } from '../vendor/ui.js';
import { ICON } from './icons.js';
import { dialogStore, toastStore, invoke } from './lib.js';

export function Sheet({ title, tape = 'berry', icon, actions, class: cls = '', children, flush }) {
  return html`<section class=${`sheet ${flush ? 'flush' : ''} ${cls}`}>
    ${title ? html`<header class="sheet-head">
      <h2 class=${`sheet-title tape-${tape}`}>${icon ? ICON[icon] : null}<span>${title}</span></h2>
      ${actions ? html`<div class="sheet-actions">${actions}</div>` : null}
    </header>` : null}
    ${children}
  </section>`;
}

export function Switch({ checked, onChange, label, hint, disabled }) {
  return html`<label class=${`switch-row ${disabled ? 'disabled' : ''}`}>
    <span class="switch-text">${label ? html`<span class="switch-label">${label}</span>` : null}${hint ? html`<span class="hint">${hint}</span>` : null}</span>
    <button type="button" role="switch" aria-checked=${!!checked} class=${`switch ${checked ? 'on' : ''}`} disabled=${disabled} onClick=${() => onChange?.(!checked)}>
      <span class="knob">${ICON.pawPrint}</span>
    </button>
  </label>`;
}

export function Seg({ value, options, onChange, small }) {
  return html`<div class=${`seg ${small ? 'small' : ''}`} role="tablist">
    ${options.map((o) => html`<button type="button" role="tab" aria-selected=${o.value === value} class=${o.value === value ? 'on' : ''} onClick=${() => onChange(o.value)}>
      ${o.icon ? ICON[o.icon] : null}<span>${o.label}</span>${o.badge ? html`<em class="badge">${o.badge}</em>` : null}
    </button>`)}
  </div>`;
}

export function Field({ label, hint, children, wide, inline }) {
  return html`<label class=${`field ${wide ? 'wide' : ''} ${inline ? 'inline' : ''}`}>
    ${label ? html`<span class="field-label">${label}</span>` : null}
    ${children}
    ${hint ? html`<span class="hint">${hint}</span>` : null}
  </label>`;
}

export function PawCheck({ checked, onChange, title }) {
  return html`<button type="button" class=${`pawcheck ${checked ? 'on' : ''}`} title=${title || (checked ? '标记为未完成' : '完成')} onClick=${(e) => { e.stopPropagation(); onChange(!checked); }}>
    ${checked ? ICON.check : null}
  </button>`;
}

// Optional chibi stickers: assets/app/stickers/<art>.png. Missing files fall back to the icon.
let stickers = null;
const stickersReady = invoke('app.stickers').then((list) => { stickers = new Set(list); }, () => { stickers = new Set(); });
export function Empty({ icon = 'pawPrint', art, title, text, children }) {
  const [, bump] = useState(0);
  useEffect(() => { if (!stickers) stickersReady.then(() => bump(1)); }, []);
  const has = art && stickers?.has(art);
  return html`<div class="empty">
    ${has ? html`<img class="empty-art" src=${`meihua://app/assets/app/stickers/${art}.png`} alt="" draggable="false" />` : html`<div class="empty-ico">${ICON[icon]}</div>`}
    ${title ? html`<div class="empty-title">${title}</div>` : null}
    ${text ? html`<div class="empty-text">${text}</div>` : null}
    ${children}
  </div>`;
}

export const Dots = () => html`<span class="paw-dots"><i></i><i></i><i></i></span>`;

export const COLORS = [
  { id: 'berry', label: '莓红' }, { id: 'mint', label: '薄荷' }, { id: 'lav', label: '薰衣草' },
  { id: 'honey', label: '蜂蜜' }, { id: 'sky', label: '天空' }, { id: 'ink', label: '墨色' },
];

export function ColorPick({ value, onChange }) {
  return html`<div class="colorpick">${COLORS.map((c) => html`<button type="button" class=${`swatch c-${c.id} ${value === c.id ? 'on' : ''}`} title=${c.label} onClick=${() => onChange(c.id)}></button>`)}</div>`;
}

export function WeekdayPick({ value = [], onChange }) {
  const days = [1, 2, 3, 4, 5, 6, 0];
  const toggle = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return html`<div class="weekpick">${days.map((d) => html`<button type="button" class=${value.includes(d) ? 'on' : ''} onClick=${() => toggle(d)}>${'日一二三四五六'[d]}</button>`)}</div>`;
}

/** A text input that commits on blur / Enter (for settings). */
export function LazyInput({ value, onCommit, type = 'text', ...rest }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  const commit = () => { const out = type === 'number' ? Number(v) : v; if (out !== value) onCommit(out); };
  return html`<input class="input" type=${type} value=${v} onInput=${(e) => setV(e.currentTarget.value)} onBlur=${commit} onKeyDown=${(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} ...${rest} />`;
}

export function AutoTextarea({ value, onInput, minRows = 1, maxRows = 10, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
    const pad = el.offsetHeight - el.clientHeight + parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
    el.style.height = Math.min(maxRows * lh + pad, Math.max(minRows * lh + pad, el.scrollHeight + (el.offsetHeight - el.clientHeight))) + 'px';
  }, [value]);
  return html`<textarea ref=${ref} class="input textarea" rows=${minRows} value=${value} onInput=${onInput} ...${rest}></textarea>`;
}

// ------------------------------------------------------------ hosts
export function DialogHost() {
  const { stack } = dialogStore.use();
  useEffect(() => {
    if (!stack.length) return undefined;
    const top = stack[stack.length - 1];
    const onKey = (e) => { if (e.key === 'Escape' && !top.props.sticky) top.props.close(undefined); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stack]);
  return stack.map(({ id, Component, props }) => html`<div class="dialog-overlay" key=${id} onMouseDown=${(e) => { if (e.target === e.currentTarget && !props.sticky) props.close(undefined); }}>
    <div class="dialog"><${Component} ...${props} /></div>
  </div>`);
}

export function Toasts() {
  const { list } = toastStore.use();
  return html`<div class="toasts">${list.map((t) => html`<div key=${t.id} class=${`toast ${t.kind}`}>${t.kind === 'error' ? ICON.warn : t.kind === 'ok' ? ICON.check : ICON.pawPrint}<span>${t.text}</span></div>`)}</div>`;
}
