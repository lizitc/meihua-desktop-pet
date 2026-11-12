// Overlay UI of the character window (Preact + htm): speech column (sticky-note cards,
// stitched paper bubble, pill input) that follows the head, the berry-flower ring menu,
// thinking paws, workshop badge and toasts. Everything clickable carries the `hit` class
// so the input layer keeps the window interactive only while hovering real UI.
import { html, render, useState, useEffect, useRef, useLayoutEffect } from '../vendor/ui.js';
import { ICON } from './icons.js';

// ------------------------------------------------------------ tiny store
function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; for (const fn of subs) fn(state); },
    use() {
      const [, force] = useState(0);
      useEffect(() => { const fn = () => force((n) => n + 1); subs.add(fn); return () => subs.delete(fn); }, []);
      return state;
    },
  };
}

/** Light markdown → readable plain text for the bubble (full text lives in the notebook). */
export function plainify(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, '〔代码〕')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const RING_MAIN = [
  { id: 'chat', icon: 'chat', label: '说说话' },
  { id: 'feed', icon: 'food', label: '喂食' },
  { id: 'checkin', icon: 'stamp', label: '签到' },
  { id: 'notebook', icon: 'notebook', label: '打开手账' },
  { id: 'calendar', icon: 'calendar', label: '日程' },
  { id: 'actions', icon: 'paw', label: '动作…' },
  { id: 'quiet', icon: 'moon', label: '安静模式', toggle: 'pet.quiet' },
  { id: 'wander', icon: 'steps', label: '自主移动', toggle: 'pet.allowWander' },
  { id: 'lock', icon: 'pin', label: '固定位置', toggle: 'pet.lockPosition' },
  { id: 'settings', icon: 'gear', label: '设置' },
  { id: 'hide', icon: 'eyeOff', label: '先藏起来' },
];
const RING_ACTIONS = [
  { id: 'back', icon: 'back', label: '返回' },
  { id: 'act:stand', icon: 'stand', label: '站起来' },
  { id: 'act:sit', icon: 'sit', label: '坐下' },
  { id: 'act:wave', icon: 'wave', label: '挥挥手' },
  { id: 'act:sleep', icon: 'sleep', label: '睡一会' },
  { id: 'act:come', icon: 'come', label: '过来' },
  { id: 'act:hop', icon: 'hop', label: '跳一下' },
  { id: 'act:spin', icon: 'spin', label: '转个圈' },
];

const KIND = {
  reminder: { label: '提醒', icon: 'bell' },
  approval: { label: '需要确认', icon: 'shield' },
  question: { label: '想问问你', icon: 'ask' },
  info: { label: '便签', icon: 'note' },
  agent: { label: '工坊', icon: 'tool' },
};

export function mountUI(root, { api, getSettings, onAction }) {
  const store = createStore({
    bubble: null,            // { id, text, streaming, source, long }
    input: false, inputText: '', recording: false, transcribing: false,
    ring: null,              // { x, y, page }
    cards: [],
    thinking: false,
    agent: null,             // { running, title, step }
    toast: null,
    tools: null,             // current tool activity label
    life: null,              // nurture state from main
    tray: null,              // { foods } while the food tray is open
    hud: false,              // status pill shown while hovering her
  });
  const live = { anchor: { x: 210, y: 220 }, colEl: null, textEl: null, shown: 0, target: '', hideAt: 0, hover: false, badgeEl: null, thinkEl: null, scrollEl: null, hudEl: null, trayEl: null, overSince: 0, leftAt: 0 };

  // ---------------------------------------------------------- components
  function Bubble({ b }) {
    const textRef = useRef(null);
    const scrollRef = useRef(null);
    useLayoutEffect(() => { live.textEl = textRef.current; live.scrollEl = scrollRef.current; if (textRef.current) textRef.current.textContent = live.target.slice(0, live.shown); });
    return html`<div class="bubble hit ${b.streaming ? 'streaming' : ''} ${b.source === 'local' ? 'local' : ''}"
        onMouseEnter=${() => { live.hover = true; }} onMouseLeave=${() => { live.hover = false; }}>
      <span class="tape" aria-hidden="true"></span>
      <div class="bubble-scroll" ref=${scrollRef}><p class="bubble-text" ref=${textRef}></p></div>
      ${b.tool ? html`<div class="bubble-tool">${ICON.tool}<span>${b.tool}</span></div>` : null}
      ${b.long && !b.streaming ? html`<button class="bubble-more" onClick=${() => onAction('notebook', { page: 'chat' })}>在手账里看完整内容 ›</button>` : null}
      <button class="bubble-close" title="收起" onClick=${() => hideBubble()}>${ICON.close}</button>
      <svg class="bubble-tail" viewBox="0 0 28 16" aria-hidden="true"><path d="M2 0 C 9 1, 12 6, 14 15 C 16 6, 19 1, 26 0 Z" /></svg>
    </div>`;
  }

  function Card({ c }) {
    const k = KIND[c.kind] || KIND.info;
    return html`<div class="card hit kind-${c.kind}" key=${c.id}>
      <div class="card-band"><span class="card-ico">${ICON[k.icon]}</span><span>${c.label || k.label}</span>${c.meta ? html`<em>${c.meta}</em>` : null}
        ${c.dismissible !== false ? html`<button class="card-x" title="关闭" onClick=${() => act(c, 'dismiss')}>${ICON.close}</button>` : null}</div>
      ${c.title ? html`<div class="card-title">${c.title}</div>` : null}
      ${c.body ? html`<div class="card-body">${c.body}</div>` : null}
      ${c.code ? html`<pre class="card-code">${c.code}</pre>` : null}
      ${c.actions?.length ? html`<div class="card-actions">${c.actions.map((a) => html`<button class="chip ${a.style || ''}" onClick=${() => act(c, a.id)}>${a.label}</button>`)}</div>` : null}
    </div>`;
  }

  function act(card, action) {
    store.set((s) => ({ cards: s.cards.filter((x) => x.id !== card.id) }));
    if (card.onAction) card.onAction(action);
    else api.send('card.action', { id: card.id, action, source: card.source });
  }

  function QuickInput({ s }) {
    const ref = useRef(null);
    const grow = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(96, el.scrollHeight) + 'px'; };
    useEffect(() => {
      // The window may get keyboard focus a moment after the box appears (it is opened from a click, the ring or
      // a global hotkey), so focus is retried for a short while and again whenever the window becomes active.
      const focus = () => {
        const t = ref.current;
        if (!t || document.activeElement === t) return;
        t.focus({ preventScroll: true });
        const n = t.value.length; t.setSelectionRange(n, n);
      };
      grow(ref.current);
      const timers = [0, 40, 140, 360, 800].map((ms) => setTimeout(focus, ms));
      // clicking elsewhere on the desktop puts an empty box away; a draft keeps it open (and is kept anyway)
      let blurTimer = 0;
      const onBlur = () => { clearTimeout(blurTimer); blurTimer = setTimeout(() => { if (!document.hasFocus() && !(ref.current?.value || '').trim()) store.set({ input: false }); }, 260); };
      window.addEventListener('focus', focus);
      window.addEventListener('blur', onBlur);
      live.focusInput = focus;
      return () => { timers.forEach(clearTimeout); clearTimeout(blurTimer); window.removeEventListener('focus', focus); window.removeEventListener('blur', onBlur); live.focusInput = null; };
    }, []);
    const send = () => {
      const text = (ref.current?.value || '').trim();
      if (!text) return;
      ref.current.value = '';
      store.set({ input: false, inputText: '' });
      onAction('send', { text });
    };
    const onKey = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
      else if (e.key === 'Escape') { e.preventDefault(); ui.closeInput(true); }
    };
    const autoGrow = (e) => { const el = e.target; grow(el); store.get().inputText = el.value; onAction('typing'); };
    const mic = async (down) => {
      if (down) { try { await onAction('mic-start'); store.set({ recording: true }); } catch (err) { toast(err.message || '麦克风不可用'); } return; }
      if (!store.get().recording) return;
      store.set({ recording: false, transcribing: true });
      try { const text = await onAction('mic-stop'); if (text && ref.current) { ref.current.value = (ref.current.value + ' ' + text).trim(); ref.current.focus(); } }
      catch (err) { toast(err.message || '没有听清楚'); }
      store.set({ transcribing: false });
    };
    const sttOn = getSettings().stt?.enabled;
    return html`<div class="pill hit">
      <textarea ref=${ref} rows="1" placeholder="和莓华说点什么…（Enter 发送 · Esc 收起）" onKeyDown=${onKey} onInput=${autoGrow} defaultValue=${s.inputText}></textarea>
      ${sttOn ? html`<button class="pill-btn mic ${s.recording ? 'on' : ''} ${s.transcribing ? 'busy' : ''}" title="按住说话"
          onPointerDown=${() => mic(true)} onPointerUp=${() => mic(false)} onPointerLeave=${() => mic(false)}>${ICON.mic}</button>` : null}
      <button class="pill-btn send" title="发送 (Enter)" onClick=${send}>${ICON.send}</button>
    </div>`;
  }

  function Ring({ r }) {
    const items = r.page === 'actions' ? RING_ACTIONS : RING_MAIN;
    const [hover, setHover] = useState(null);
    const settings = getSettings();
    const R = items.length > 8 ? 92 : 84;
    const W = innerWidth, H = innerHeight;
    const cx = Math.min(W - R - 30, Math.max(R + 30, r.x)), cy = Math.min(H - R - 34, Math.max(R + 30, r.y));
    const pick = (it) => {
      if (it.id === 'actions') { store.set({ ring: { ...r, page: 'actions' } }); return; }
      if (it.id === 'back') { store.set({ ring: { ...r, page: 'main' } }); return; }
      store.set({ ring: null });
      if (it.id === 'feed') { openTray(); return; }
      onAction(it.id, {});
    };
    const life = store.get().life;
    const on = (it) => it.toggle && !!it.toggle.split('.').reduce((o, k) => o?.[k], settings);
    return html`<div class="ring-scrim hit" onPointerDown=${(e) => { if (e.target === e.currentTarget) store.set({ ring: null }); }}
        onContextMenu=${(e) => { e.preventDefault(); store.set({ ring: null }); }}>
      <div class="ring ${r.page === 'actions' ? 'sub' : ''}" style=${`left:${cx}px;top:${cy}px`} key=${r.page}>
        <svg class="ring-vine" viewBox="-110 -110 220 220" aria-hidden="true"><circle r=${R} /></svg>
        ${items.map((it, i) => {
          const a = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
          const x = Math.cos(a) * R, y = Math.sin(a) * R;
          return html`<button class="petal ${on(it) ? 'on' : ''}" style=${`--x:${x.toFixed(1)}px;--y:${y.toFixed(1)}px;--i:${i}`}
              onPointerEnter=${() => setHover(it)} onPointerLeave=${() => setHover(null)} onClick=${() => pick(it)} aria-label=${it.label}>
            ${ICON[it.icon]}${it.toggle ? html`<i class="dot"></i>` : null}</button>`;
        })}
        <button class="ring-core" onClick=${() => store.set({ ring: null })} aria-label="关闭">${ICON.berry}</button>
        <div class="ring-label">${hover ? hover.label + (hover.id === 'checkin' && life?.checkedToday ? '（今天已签）' : '') + (hover.toggle ? (on(hover) ? '：开' : '：关') : '') : (r.page === 'actions' ? '想让我做什么？' : '莓华在这里')}</div>
        ${life && r.page !== 'actions' ? html`<div class="ring-stats"><b>Lv.${life.level}</b><span>${ICON.heart}${life.mood}</span><span>${ICON.food}${life.hunger}</span><span class="coin">${life.coins}</span></div>` : null}
      </div>
    </div>`;
  }

  /** Status pill over her head while the pointer rests on her. */
  function Hud({ life }) {
    const bar = (v, cls) => html`<i class=${`bar ${cls}`}><i style=${`width:${Math.max(4, Math.min(100, v))}%`}></i></i>`;
    return html`<div class="hud" ref=${(el) => { live.hudEl = el; }}>
      <span class="hud-lv">Lv.${life.level}</span>
      <span class="hud-row" title=${`心情 ${life.mood}（${life.moodLabel}）`}>${ICON.heart}${bar(life.mood, 'mood')}</span>
      <span class="hud-row" title=${`饱食度 ${life.hunger}（${life.hungerLabel}）`}>${ICON.food}${bar(life.hunger, 'hunger')}</span>
      <span class="hud-xp" title=${`经验 ${life.xp}/${life.xpNext}`}>${bar((life.xp / life.xpNext) * 100, 'xp')}</span>
    </div>`;
  }

  /** Food tray: what's in stock first, then what can be bought; one click feeds. */
  function Tray({ t }) {
    const life = store.get().life || {};
    const foods = (t.foods || []).filter((f) => f.unlocked);
    const locked = (t.foods || []).filter((f) => !f.unlocked).slice(0, 2);
    const feed = (f) => onAction('feed', { food: f.id, buy: !f.stock });
    return html`<div class="tray-scrim hit" onPointerDown=${(e) => { if (e.target === e.currentTarget) closeTray(); }} onContextMenu=${(e) => { e.preventDefault(); closeTray(); }}>
      <div class="tray" ref=${(el) => { live.trayEl = el; }}>
        <div class="tray-head"><span>${ICON.food}喂点什么好呢？</span><em class="coin">${life.coins ?? 0}</em>
          <button class="tray-x" title="关闭" onClick=${closeTray}>${ICON.close}</button></div>
        <div class="tray-bars"><span>饱食度 ${life.hunger ?? '–'}</span><i class="bar hunger"><i style=${`width:${life.hunger ?? 0}%`}></i></i></div>
        <div class="tray-grid">
          ${foods.map((f) => html`<button class=${`food ${f.stock ? 'have' : ''} ${!f.stock && f.price > (life.coins ?? 0) ? 'poor' : ''}`} title=${`${f.name}：饱食 +${f.hunger}，心情 +${f.mood}${f.favorite ? '（最爱）' : ''}`} onClick=${() => feed(f)}>
              <img src=${f.icon} alt="" draggable="false" />${f.favorite ? html`<i class="fav">${ICON.heart}</i>` : null}
              <span class="food-name">${f.name}</span>
              <span class="food-tag">${f.stock ? `×${f.stock}` : html`<span class="coin">${f.price}</span>`}</span>
            </button>`)}
          ${locked.map((f) => html`<div class="food locked" title=${`Lv.${f.level} 解锁`}><img src=${f.icon} alt="" draggable="false" /><span class="food-name">Lv.${f.level}</span></div>`)}
        </div>
        <button class="tray-more" onClick=${() => { closeTray(); onAction('notebook', { page: 'nest' }); }}>去小窝看看 ›</button>
      </div>
    </div>`;
  }

  async function openTray() {
    try {
      const foods = await api.invoke('life.foods');
      foods.sort((a, b) => (b.stock > 0) - (a.stock > 0) || a.level - b.level);
      store.set({ tray: { foods }, ring: null });
    } catch (err) { toast(err.message || '打不开食物篮'); }
  }
  function closeTray() { store.set({ tray: null }); }

  function App() {
    const s = store.use();
    const colRef = useRef(null);
    const badgeRef = useRef(null);
    const thinkRef = useRef(null);
    useLayoutEffect(() => { live.colEl = colRef.current; live.badgeEl = badgeRef.current; live.thinkEl = thinkRef.current; });
    return html`
      <div class="column" ref=${colRef}>
        ${s.cards.map((c) => html`<${Card} c=${c} key=${c.id} />`)}
        ${s.bubble ? html`<${Bubble} b=${s.bubble} key=${s.bubble.id} />` : null}
        ${s.input ? html`<${QuickInput} s=${s} />` : null}
      </div>
      <div class="thinking ${s.thinking && !(s.bubble?.streaming && live.target) ? 'on' : ''}" ref=${thinkRef} aria-hidden="true">
        <span>${ICON.pawPrint}</span><span>${ICON.pawPrint}</span><span>${ICON.pawPrint}</span>
      </div>
      ${s.agent?.running ? html`<button class="badge hit" ref=${badgeRef} title=${s.agent.title || '工坊任务进行中'} onClick=${() => onAction('notebook', { page: 'workshop' })}>
          <span class="spin">${ICON.tool}</span><span>${s.agent.running > 1 ? `工坊 ×${s.agent.running}` : '工坊进行中'}</span></button>` : null}
      ${s.toast ? html`<div class="toast" key=${s.toast.id}>${s.toast.text}</div>` : null}
      ${s.life && s.hud && !s.ring && !s.tray ? html`<${Hud} life=${s.life} />` : null}
      ${s.tray ? html`<${Tray} t=${s.tray} />` : null}
      ${s.ring ? html`<${Ring} r=${s.ring} />` : null}`;
  }

  render(html`<${App} />`, root);

  // ---------------------------------------------------------- imperative API
  let bubbleSeq = 0;
  function showBubble(text, { source = 'local', streaming = false, hold } = {}) {
    const id = ++bubbleSeq;
    live.target = text; live.shown = source === 'local' ? 0 : 0; live.hideAt = 0; live.hold = hold;
    store.set({ bubble: { id, source, streaming, long: text.length > 200 } });
    return id;
  }
  function hideBubble() { store.set({ bubble: null }); live.target = ''; live.shown = 0; }
  let toastTimer = 0;
  function toast(text, ms = 2200) {
    clearTimeout(toastTimer);
    store.set({ toast: { id: Date.now(), text } });
    toastTimer = setTimeout(() => store.set({ toast: null }), ms);
  }

  const turns = new Map();
  const ui = {
    store,
    get modal() { return !!store.get().ring || !!store.get().tray; },
    setLife(life) {
      store.set({ life });
      const t = store.get().tray;
      if (t) api.invoke('life.foods').then((foods) => { if (store.get().tray) { foods.sort((a, b) => (b.stock > 0) - (a.stock > 0) || a.level - b.level); store.set({ tray: { foods } }); } }).catch(() => {});
    },
    openTray,
    closeTray,
    /** Hover over the character: the status pill appears after a short rest and lingers a moment after. */
    setHover(over) {
      const now = performance.now();
      if (over) { if (!live.overSince) live.overSince = now; live.leftAt = 0; }
      else if (live.overSince) { live.overSince = 0; live.leftAt = now; }
      const want = (live.overSince && now - live.overSince > 900) || (live.leftAt && now - live.leftAt < 1400 && store.get().hud);
      if (!!want !== store.get().hud) store.set({ hud: !!want });
    },
    get speaking() { return !!store.get().bubble && live.shown < live.target.length; },
    get inputOpen() { return store.get().input; },
    say(text, opts = {}) { if (!text) return; showBubble(plainify(text), { source: opts.source || 'local', hold: opts.hold }); },
    beginTurn(turnId) { turns.set(turnId, ''); store.set({ thinking: true }); },
    delta(turnId, text) {
      const prev = turns.get(turnId) ?? '';
      const next = prev + text;
      turns.set(turnId, next);
      const clean = plainify(next);
      const b = store.get().bubble;
      if (!b || b.turnId !== turnId) {
        const id = ++bubbleSeq; live.target = clean; live.shown = 0; live.hideAt = 0;
        store.set({ bubble: { id, turnId, source: 'ai', streaming: true, long: clean.length > 200 } });
      } else { live.target = clean; if (clean.length > 200 && !b.long) store.set({ bubble: { ...b, long: true } }); }
    },
    tool(turnId, label) {
      const b = store.get().bubble;
      store.set({ thinking: true });
      if (b && b.turnId === turnId) store.set({ bubble: { ...b, tool: label } });
      else if (label) { const id = ++bubbleSeq; live.target = ''; live.shown = 0; store.set({ bubble: { id, turnId, source: 'ai', streaming: true, tool: label } }); }
    },
    endTurn(turnId, text) {
      turns.delete(turnId);
      store.set({ thinking: false });
      const b = store.get().bubble;
      if (text != null) {
        const clean = plainify(text);
        if (!clean) { if (b?.turnId === turnId) hideBubble(); return; }
        if (!b || b.turnId !== turnId) { const id = ++bubbleSeq; live.target = clean; live.shown = 0; store.set({ bubble: { id, turnId, source: 'ai', streaming: false, long: clean.length > 200 } }); }
        else { live.target = clean; store.set({ bubble: { ...b, streaming: false, tool: null, long: clean.length > 200 } }); }
      } else if (b?.turnId === turnId) store.set({ bubble: { ...b, streaming: false, tool: null } });
    },
    hideBubble,
    toast,
    setThinking(on) { store.set({ thinking: !!on }); },
    setAgent(agent) { store.set({ agent }); },
    addCard(card) { store.set((s) => ({ cards: [...s.cards.filter((c) => c.id !== card.id), card].slice(-3) })); },
    removeCard(id) { store.set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })); },
    /** Opens the quick chat (or just focuses it when it is already open); the draft is kept between openings. */
    openInput() {
      const was = store.get().input;
      store.set({ input: true, ring: null, tray: null });
      api.invoke('pet.focus').catch(() => {});
      if (was) live.focusInput?.();
    },
    /** blur: also hand keyboard focus back to the previous window. */
    closeInput(blur = false) { store.set({ input: false }); if (blur) api.invoke('pet.blur').catch(() => {}); },
    get inputFocused() { return store.get().input && document.hasFocus(); },
    openRing(x, y) { store.set({ ring: { x, y, page: 'main', t: performance.now() } }); },
    closeTransient() { if (store.get().ring) store.set({ ring: null }); if (store.get().tray) store.set({ tray: null }); },
    /** Per-frame: follow the head anchor, run the typewriter, auto-hide. */
    frame(dt, anchor, foot, clipY = null) {
      live.anchor = anchor;
      const W = innerWidth;
      // while she is tucked in below the taskbar, nothing may hang below its edge
      const bottomLimit = clipY != null ? Math.min(innerHeight, clipY) : innerHeight;
      const col = live.colEl;
      if (col) {
        const w = col.offsetWidth || 280;
        const left = Math.round(Math.min(W - 8 - w, Math.max(8, anchor.x - w / 2)));
        const bottom = Math.round(innerHeight - anchor.y + 12);
        col.style.left = left + 'px';
        col.style.bottom = bottom + 'px';
        col.style.maxHeight = Math.max(120, anchor.y - 14) + 'px';
        col.style.setProperty('--tail-x', Math.round(Math.min(w - 26, Math.max(26, anchor.x - left))) + 'px');
      }
      if (live.thinkEl) { live.thinkEl.style.left = Math.round(anchor.x + 18) + 'px'; live.thinkEl.style.top = Math.round(anchor.y - 34) + 'px'; }
      if (live.badgeEl) { live.badgeEl.style.left = Math.round(Math.min(W - 120, anchor.x + 54)) + 'px'; live.badgeEl.style.top = Math.round(anchor.y + 90) + 'px'; }
      if (live.hudEl?.isConnected) {
        const w = live.hudEl.offsetWidth || 150;
        // under her feet: the space above her head belongs to the bubble and the cards
        const h = live.hudEl.offsetHeight || 24;
        const cx = foot ? foot.x : anchor.x;
        const top = foot ? Math.min(bottomLimit - h - 4, foot.y + 8) : anchor.y - 40;
        live.hudEl.style.left = Math.round(Math.min(W - w - 6, Math.max(6, cx - w / 2))) + 'px';
        live.hudEl.style.top = Math.round(Math.max(4, top)) + 'px';
      }
      if (live.trayEl?.isConnected) {
        const w = live.trayEl.offsetWidth || 260, h = live.trayEl.offsetHeight || 200;
        live.trayEl.style.left = Math.round(Math.min(W - w - 6, Math.max(6, anchor.x - w / 2))) + 'px';
        // from about her chest down, so her face stays visible while choosing
        const chest = foot ? anchor.y + (foot.y - anchor.y) * 0.36 : anchor.y + 150;
        live.trayEl.style.top = Math.round(Math.min(bottomLimit - h - 6, Math.max(6, chest))) + 'px';
      }
      const b = store.get().bubble;
      if (!b) return;
      if (live.shown < live.target.length) {
        const behind = live.target.length - live.shown;
        const speed = Math.max(b.source === 'local' ? 26 : 34, behind * 2.2);
        live.shown = Math.min(live.target.length, live.shown + speed * dt);
        if (live.textEl) {
          live.textEl.textContent = live.target.slice(0, Math.floor(live.shown));
          if (live.scrollEl) live.scrollEl.scrollTop = live.scrollEl.scrollHeight;
        }
        live.hideAt = 0;
      } else if (!b.streaming && !live.hover) {
        const now = performance.now();
        if (!live.hideAt) live.hideAt = now + (live.hold ?? Math.min(22, Math.max(4.5, 2.2 + live.target.length * 0.11))) * 1000;
        else if (now >= live.hideAt) hideBubble();
      } else if (live.hover) live.hideAt = 0;
    },
  };
  return ui;
}
