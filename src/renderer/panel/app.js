// 莓华手账 — the notebook window. Sidebar "cover" with the portrait sticker and index tabs,
// a dotted-paper page area, a clip of pending sticky notes, dialogs and toasts.
import { html, render, useEffect, useState } from '../vendor/ui.js';
import { ICON } from './icons.js';
import { api, invoke, useRoute, navigate, useSettings, loadSettings, patchSettings, portrait, createStore } from './lib.js';
import { DialogHost, Toasts, Switch } from './kit.js';
import { TodayPage } from './pages/today.js';
import { ChatPage } from './pages/chat.js';
import { CalendarPage } from './pages/calendar.js';
import { TodosPage } from './pages/todos.js';
import { WorkshopPage } from './pages/workshop.js';
import { SkillsPage } from './pages/skills.js';
import { MemoryPage } from './pages/memory.js';
import { SettingsPage } from './pages/settings.js';
import { WelcomePage } from './pages/welcome.js';
import { NestPage } from './pages/nest.js';

const NAV = [
  { id: 'today', label: '今天', icon: 'sun', Page: TodayPage },
  { id: 'nest', label: '小窝', icon: 'nest', Page: NestPage },
  { id: 'chat', label: '聊天', icon: 'chat', Page: ChatPage },
  { id: 'calendar', label: '日程', icon: 'calendar', Page: CalendarPage },
  { id: 'todos', label: '待办与提醒', icon: 'todo', Page: TodosPage },
  { id: 'workshop', label: '工坊', icon: 'workshop', Page: WorkshopPage },
  { id: 'skills', label: '技能与扩展', icon: 'sparkle', Page: SkillsPage },
  { id: 'memory', label: '记忆', icon: 'heart', Page: MemoryPage },
  { id: 'settings', label: '设置', icon: 'gear', Page: SettingsPage },
];

// ------------------------------------------------------------ shared live status
export const statusStore = createStore({ ai: null, agents: { running: 0, title: '' }, cards: [], pending: { skills: 0, ext: 0 }, life: null });
async function refreshStatus() {
  invoke('life.get').then((life) => statusStore.set({ life })).catch(() => {});
  const [ai, tasks, cards] = await Promise.all([invoke('ai.status'), invoke('agent.list'), invoke('card.list')]).catch(() => [null, [], []]);
  const running = (tasks || []).filter((t) => ['running', 'waiting', 'queued'].includes(t.status));
  statusStore.set({ ai, agents: { running: running.length, title: running[0]?.title || '' }, cards: cards || [] });
  refreshPending();
}
async function refreshPending() {
  try {
    const [skills, exts] = await Promise.all([invoke('skills.list'), invoke('ext.list')]);
    statusStore.set({ pending: { skills: skills.filter((s) => !s.enabled && s.author === 'ai').length, ext: exts.filter((e) => !e.enabled && !e.broken).length } });
  } catch { /* ignore */ }
}
api.on('ai:status', (ai) => statusStore.set({ ai }));
api.on('agent:status', (agents) => statusStore.set({ agents }));
api.on('notify:card', (card) => statusStore.set((s) => ({ cards: [...s.cards.filter((c) => c.id !== card.id), card] })));
api.on('notify:dismiss', ({ id }) => statusStore.set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })));
api.on('ext:changed', refreshPending);
api.on('life:state', (life) => statusStore.set({ life }));

// ------------------------------------------------------------ theme
function useTheme(settings) {
  const pref = settings?.app?.theme || 'system';
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref; };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}

// ------------------------------------------------------------ sidebar
function Sidebar({ page, settings }) {
  const st = statusStore.use();
  const ai = st.ai;
  const badge = { workshop: st.agents.running || 0, skills: (st.pending.skills + st.pending.ext) || 0 };
  return html`<aside class="side">
    <div class="side-drag"></div>
    <div class="cover">
      <button class="sticker" title="和莓华聊天" onClick=${() => navigate('chat')}>
        <img src=${portrait} alt="御园莓华" draggable="false" />
      </button>
      <div class="cover-name">御园莓华${st.life ? html`<button class="cover-lv" title=${`心情 ${st.life.mood} · 饱食度 ${st.life.hunger} — 去小窝`} onClick=${() => navigate('nest')}>Lv.${st.life.level}${st.life.checkedToday ? null : html`<i class="cover-dot" title="今天还没签到"></i>`}</button>` : null}</div>
      <button class=${`cover-status ${ai?.configured ? 'ok' : 'off'}`} onClick=${() => navigate('settings/ai')} title="AI 连接设置">
        <i class="led"></i>
        <span>${ai ? (ai.configured ? (ai.model || '已连接') : '还没有连接 AI') : '…'}</span>
      </button>
    </div>
    <nav class="tabs">
      ${NAV.map((n, i) => html`<button key=${n.id} class=${`tab ${page === n.id ? 'on' : ''}`} onClick=${() => navigate(n.id)} title=${`${n.label}（Ctrl+${i + 1}）`}>
        ${ICON[n.icon]}<span>${n.label}</span>
        ${badge[n.id] ? html`<em class=${`tab-badge ${n.id === 'workshop' ? 'live' : ''}`}>${badge[n.id]}</em>` : null}
      </button>`)}
    </nav>
    <div class="side-foot">
      ${settings ? html`
        <${Switch} label="显示莓华" checked=${settings.pet.visible} onChange=${(v) => patchSettings({ pet: { visible: v } })} />
        <${Switch} label="安静模式" checked=${settings.pet.quiet} onChange=${(v) => patchSettings({ pet: { quiet: v } })} />` : null}
    </div>
  </aside>`;
}

// ------------------------------------------------------------ sticky-note clip (pending cards)
function CardClip({ page }) {
  const { cards } = statusStore.use();
  const [pref, setOpen] = useState(null);
  const list = cards.filter((c) => c.actions?.length);
  if (!list.length || page === 'welcome') return null;
  // decisions (approvals / questions) unfold by themselves; plain notices wait folded
  const open = pref ?? list.some((c) => c.kind === 'approval' || c.kind === 'question');
  const act = (id, action) => invoke('card.action', { id, action }).catch(() => {});
  return html`<div class=${`clip ${open ? 'open' : ''}`}>
    <button class="clip-head" onClick=${() => setOpen(!open)}>${ICON.bell}<span>${list.length} 张便签等你处理</span>${ICON[open ? 'down' : 'left']}</button>
    ${open ? html`<div class="clip-list">${list.slice(-4).reverse().map((c) => html`<div key=${c.id} class=${`note kind-${c.kind || 'info'}`}>
      ${c.label ? html`<div class="note-label">${c.label}</div>` : null}
      <div class="note-title">${c.title}</div>
      ${c.body ? html`<div class="note-body">${c.body}</div>` : null}
      ${c.code ? html`<pre class="note-code">${c.code}</pre>` : null}
      <div class="note-actions">${c.actions.map((a) => html`<button class=${`btn small ${a.style === 'primary' ? 'primary' : a.style === 'danger' ? 'danger' : ''}`} onClick=${() => act(c.id, a.id)}>${a.label}</button>`)}</div>
    </div>`)}</div>` : null}
  </div>`;
}

// ------------------------------------------------------------ app
function App() {
  const route = useRoute();
  const settings = useSettings();
  useTheme(settings);
  useEffect(() => { refreshStatus(); }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); navigate(NAV[Number(e.key) - 1].id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!settings) return html`<div class="boot">${ICON.pawPrint}</div>`;

  if (route.page === 'welcome') {
    return html`<div class="shell welcome-shell"><div class="titlebar"></div><${WelcomePage} settings=${settings} /><${DialogHost} /><${Toasts} /></div>`;
  }
  const nav = NAV.find((n) => n.id === route.page) || NAV[0];
  const Page = nav.Page;
  return html`<div class="shell">
    <${Sidebar} page=${nav.id} settings=${settings} />
    <main class="main">
      <div class="titlebar"><span class="crumb">莓华手账</span><span class="crumb-sep">·</span><span class="crumb-page">${nav.label}</span></div>
      <div class=${`page page-${nav.id}`} key=${nav.id}><${Page} sub=${route.sub} settings=${settings} /></div>
    </main>
    <${CardClip} page=${nav.id} />
    <${DialogHost} />
    <${Toasts} />
  </div>`;
}

loadSettings().then(() => render(html`<${App} />`, document.getElementById('app')));
window.addEventListener('error', (e) => console.error('[panel]', e.message));
