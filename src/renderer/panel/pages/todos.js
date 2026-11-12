// 待办与提醒: todos (grouped by when they are due), reminders and AI routines.
import { html, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { useRpc, attempt, confirmBox, navigate, parseLocal, startOfDay, addDays, whenLabel, ago } from '../lib.js';
import { Sheet, Seg, PawCheck, Empty, Switch } from '../kit.js';
import { editTodo, newReminder, editRoutine } from './dialogs.js';

function group(todos) {
  const now = new Date(), t0 = startOfDay(now), t1 = addDays(t0, 1), t7 = addDays(t0, 7);
  const g = { overdue: [], today: [], week: [], later: [], none: [], done: [] };
  for (const t of todos) {
    if (t.done) { g.done.push(t); continue; }
    if (!t.due) { g.none.push(t); continue; }
    const d = parseLocal(t.due);
    const dayEnd = t.due.length > 10 ? d : addDays(d, 1);
    if (dayEnd <= now) g.overdue.push(t);
    else if (d < t1) g.today.push(t);
    else if (d < t7) g.week.push(t);
    else g.later.push(t);
  }
  return [['overdue', '已经过期', 'warn'], ['today', '今天', 'sun'], ['week', '这周', 'calendar'], ['later', '以后', 'flag'], ['none', '没有期限', 'note'], ['done', '已完成', 'check']]
    .map(([k, label, icon]) => ({ k, label, icon, items: g[k] })).filter((x) => x.items.length);
}

function TodoItem({ t }) {
  return html`<div class=${`todo-item ${t.done ? 'done' : ''}`} onClick=${() => editTodo(t)}>
    <${PawCheck} checked=${t.done} onChange=${(v) => attempt('todo.update', t.id, { done: v })} />
    <div class="todo-main">
      <div class="todo-title">${t.title}</div>
      ${t.notes ? html`<div class="todo-notes">${t.notes}</div>` : null}
      <div class="todo-meta">
        ${t.due ? html`<span class="due">${ICON.clock}${whenLabel(t.due)}</span>` : null}
        ${t.tags?.map((x) => html`<span class="tag">#${x}</span>`)}
        ${t.source === 'ai' ? html`<span class="tag soft">莓华记的</span>` : null}
        ${t.done && t.doneAt ? html`<span class="muted small">${ago(t.doneAt)}完成</span>` : null}
      </div>
    </div>
    ${t.priority ? html`<span class=${`prio p${t.priority}`} title="重要程度">${'!'.repeat(t.priority)}</span>` : null}
  </div>`;
}

function Todos() {
  const [filter, setFilter] = useState('open');
  const [text, setText] = useState('');
  const { data } = useRpc('todo.list', [filter], ['planner:changed']);
  const add = async () => {
    const title = text.trim();
    if (title && (await attempt('todo.add', { title }))) setText('');
  };
  const groups = group(data || []);
  return html`<div class="todos">
    <div class="todo-bar">
      <div class="quick-add big">
        ${ICON.plus}
        <input class="input bare" placeholder="添加待办，回车保存（也可以直接告诉莓华：「周五前把报告交了」）" value=${text} onInput=${(e) => setText(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') add(); }} />
        <button class="btn small" onClick=${() => editTodo(null)}>详细…</button>
      </div>
      <${Seg} small value=${filter} onChange=${setFilter} options=${[{ value: 'open', label: '进行中' }, { value: 'done', label: '已完成' }, { value: 'all', label: '全部' }]} />
    </div>
    ${data && !data.length ? html`<${Empty} icon="check" art="todo-done" title=${filter === 'done' ? '还没有完成的待办' : '没有待办'} text=${filter === 'done' ? '' : '清清爽爽的一天～'} />` : null}
    ${groups.map((g) => html`<section class=${`todo-group g-${g.k}`}>
      <h3 class="group-title">${ICON[g.icon]}${g.label}<em>${g.items.length}</em></h3>
      ${g.items.map((t) => html`<${TodoItem} key=${t.id} t=${t} />`)}
    </section>`)}
  </div>`;
}

const REPEAT = { daily: '每天', weekdays: '工作日', weekly: '每周', monthly: '每月', hourly: '每小时' };
function Reminders() {
  const { data } = useRpc('reminder.list', [{}], ['planner:changed']);
  return html`<div class="rem-page">
    <div class="todo-bar"><p class="muted">到点时莓华会在桌面上拿着便签提醒你，也可以对她说「半小时后提醒我关火」。</p><button class="btn primary" onClick=${() => newReminder()}>${ICON.bell}新提醒</button></div>
    ${data && !data.length ? html`<${Empty} icon="bell" art="reminder" title="没有待响的提醒" /> ` : null}
    <div class="rem-cards">${(data || []).map((r) => html`<div class="rem-card" key=${r.id}>
      <div class="rem-when">${ICON.clock}${whenLabel(r.at)}${r.repeat ? html`<span class="tag">${ICON.repeat}${REPEAT[r.repeat.freq] || r.repeat.freq}</span>` : null}</div>
      <div class="rem-big">${r.text}</div>
      <div class="rem-foot">${r.source === 'ai' ? html`<span class="tag soft">莓华设的</span>` : html`<span></span>`}<button class="btn small ghost danger-text" onClick=${async () => { if (await confirmBox({ title: '取消提醒', body: `不再提醒「${r.text}」？`, ok: '取消提醒', cancel: '保留', danger: true })) attempt('reminder.cancel', r.id); }}>${ICON.close}取消</button></div>
    </div>`)}</div>
  </div>`;
}

function Routines() {
  const { data } = useRpc('routine.list', [], ['planner:changed']);
  const days = (d) => (!d || !d.length || d.length === 7 ? '每天' : d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x)) ? '工作日' : '每周' + d.map((x) => '日一二三四五六'[x]).join('、'));
  return html`<div class="routines">
    <div class="todo-bar"><p class="muted">例行任务会在设定的时间让莓华主动去做一件事，比如每天早上查天气、每周五提醒写周报。</p><button class="btn primary" onClick=${() => editRoutine(null)}>${ICON.plus}新例行任务</button></div>
    ${data && !data.length ? html`<${Empty} icon="repeat" art="reminder" title="还没有例行任务" text="试试对莓华说：「每天早上八点帮我看看天气，下雨就提醒我带伞」"><button class="btn" onClick=${() => navigate('chat')}>去和她说</button><//>` : null}
    <div class="routine-list">${(data || []).map((r) => html`<div class=${`routine ${r.enabled ? '' : 'off'}`} key=${r.id}>
      <div class="routine-time"><b>${r.time}</b><span>${days(r.days)}</span></div>
      <div class="routine-main">
        <div class="routine-name">${r.name}</div>
        <div class="routine-prompt">${r.prompt}</div>
        ${r.lastRun ? html`<div class="muted small">上次执行：${whenLabel(r.lastRun)}</div>` : null}
      </div>
      <div class="routine-actions">
        <${Switch} checked=${r.enabled} onChange=${(v) => attempt('routine.update', r.id, { enabled: v })} />
        <button class="icon-btn small" title="编辑" onClick=${() => editRoutine(r)}>${ICON.edit}</button>
        <button class="icon-btn small" title="删除" onClick=${async () => { if (await confirmBox({ title: '删除例行任务', body: `确定删除「${r.name}」吗？`, ok: '删除', danger: true })) attempt('routine.delete', r.id); }}>${ICON.trash}</button>
      </div>
    </div>`)}</div>
  </div>`;
}

export function TodosPage({ sub }) {
  const tab = ['reminders', 'routines'].includes(sub) ? sub : 'todos';
  return html`<div class="todos-page">
    <header class="page-head">
      <div><h1>待办与提醒</h1><p class="sub">把事情交给莓华记着，你只管去做～</p></div>
      <${Seg} value=${tab} onChange=${(v) => navigate(v === 'todos' ? 'todos' : `todos/${v}`)} options=${[{ value: 'todos', label: '待办', icon: 'todo' }, { value: 'reminders', label: '提醒', icon: 'bell' }, { value: 'routines', label: '例行任务', icon: 'repeat' }]} />
    </header>
    <${Sheet} flush class="todos-sheet">
      ${tab === 'todos' ? html`<${Todos} />` : tab === 'reminders' ? html`<${Reminders} />` : html`<${Routines} />`}
    <//>
  </div>`;
}
