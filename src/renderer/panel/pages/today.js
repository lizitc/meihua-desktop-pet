// 今天: greeting card, today's timeline with a "now" line, todos with quick add,
// reminders, the coming week and workshop progress.
import { html, useEffect, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { invoke, attempt, useRpc, navigate, toast, greeting, parseLocal, fmtTime, dayLabel, whenLabel, WEEK, portrait, ago } from '../lib.js';
import { Sheet, PawCheck, Empty } from '../kit.js';
import { editEvent, editTodo, newReminder } from './dialogs.js';
import { NestMini } from './nest.js';

const TIPS = [
  '右键点一下我，会打开花环菜单哦。按住右键可以把我拖到别处～',
  '双击我可以直接和我说话。',
  '摸摸我的头、碰碰耳朵和尾巴，我都会有反应的！',
  '把要做的事告诉我，我会帮你记到日历和待办里。',
  '复杂的电脑工作可以交给「工坊」，进度随时问我就好。',
  '想让我学会新本事？在「技能与扩展」里可以看到我写的新技能。',
  '设置里可以给我配上声音，让我开口说话。',
  '每天来「小窝」签个到吧，连续 7 天我会收到草莓蛋糕！',
  '肚子饿了我会没精神的……右键菜单里可以喂我吃点心。',
  '拖着我用力甩出去，我会在屏幕边上弹来弹去哦（别甩太狠，会晕的）。',
];

function useNow(ms = 30000) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Hero({ t, settings, now }) {
  const name = settings.user.callName || '主人';
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const evs = t?.events?.length || 0, todos = t?.todos?.length || 0, done = t?.doneToday?.length || 0;
  const brief = async () => {
    const st = await invoke('ai.status').catch(() => null);
    if (!st?.configured) { toast('先连接 AI，莓华才能播报哦', 'error'); navigate('settings/ai'); return; }
    if (await attempt('scheduler.brief')) toast('莓华正在整理今天的简报～', 'ok');
  };
  return html`<section class="hero sheet">
    <div class="hero-art"><img src=${portrait} alt="" draggable="false" /></div>
    <div class="hero-text">
      <div class="hero-date">${now.getMonth() + 1}月${now.getDate()}日 · 星期${WEEK[now.getDay()]}</div>
      <h1 class="hero-greet">${greeting(now)}，${name}</h1>
      <p class="hero-sum">
        ${evs ? html`今天有 <b>${evs}</b> 个日程` : '今天没有日程'}，${todos ? html`<b>${todos}</b> 件待办等着` : '待办都清空啦'}${done ? html`，已经完成了 <b>${done}</b> 件` : ''}。
      </p>
      <p class="hero-tip">${ICON.pawPrint}<span>${tip}</span></p>
      <div class="hero-actions">
        <button class="btn primary" onClick=${brief}>${ICON.speaker}让莓华播报今天</button>
        <button class="btn" onClick=${() => editEvent(null)}>${ICON.calendar}新日程</button>
        <button class="btn" onClick=${() => editTodo(null)}>${ICON.todo}新待办</button>
        <button class="btn" onClick=${() => newReminder()}>${ICON.bell}提醒我</button>
      </div>
    </div>
  </section>`;
}

function Timeline({ events, now }) {
  if (!events) return null;
  if (!events.length) return html`<${Empty} icon="sun" art="day-free" title="今天没有安排" text="留点时间给自己吧～" />`;
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);
  let nowShown = false;
  const rows = [];
  for (const e of timed) {
    const s = parseLocal(e.occurrence), en = parseLocal(e.occEnd);
    if (!nowShown && s > now) { rows.push(html`<div class="now-line"><span>${fmtTime(now)} 现在</span></div>`); nowShown = true; }
    const state = en <= now ? 'past' : s <= now ? 'live' : '';
    rows.push(html`<button class=${`tl-item c-${e.color} ${state}`} onClick=${() => editEvent(e)}>
      <span class="tl-time">${fmtTime(s)}<small>${fmtTime(en)}</small></span>
      <span class="tl-dot"></span>
      <span class="tl-body"><span class="tl-title">${e.title}${e.recurring ? ICON.repeat : null}</span>
        ${e.location || state === 'live' ? html`<span class="tl-meta">${state === 'live' ? html`<em class="live-tag">进行中</em>` : null}${e.location ? html`${ICON.location}${e.location}` : null}</span>` : null}
      </span>
    </button>`);
  }
  if (!nowShown && timed.length) rows.push(html`<div class="now-line"><span>${fmtTime(now)} 现在</span></div>`);
  return html`<div class="timeline">
    ${allDay.map((e) => html`<button class=${`allday-chip c-${e.color}`} onClick=${() => editEvent(e)}>全天 · ${e.title}</button>`)}
    ${rows}
  </div>`;
}

function TodoList({ todos, limit = 7 }) {
  const [text, setText] = useState('');
  const add = async () => {
    const title = text.trim();
    if (!title) return;
    if (await attempt('todo.add', { title })) setText('');
  };
  const now = new Date();
  return html`<div class="todo-mini">
    <div class="quick-add">
      ${ICON.plus}
      <input class="input bare" placeholder="写下一件要做的事，回车添加" value=${text} onInput=${(e) => setText(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') add(); }} />
    </div>
    ${todos && !todos.length ? html`<${Empty} icon="check" art="todo-done" title="待办清空啦" text="今天也辛苦了～" />` : null}
    ${(todos || []).slice(0, limit).map((t) => {
      const overdue = t.due && parseLocal(t.due) < now;
      return html`<div class="todo-row" key=${t.id} onClick=${() => editTodo(t)}>
        <${PawCheck} checked=${t.done} onChange=${(v) => attempt('todo.update', t.id, { done: v })} />
        <span class="todo-title">${t.title}</span>
        ${t.priority ? html`<span class=${`prio p${t.priority}`}>${'!'.repeat(t.priority)}</span>` : null}
        ${t.due ? html`<span class=${`due ${overdue ? 'overdue' : ''}`}>${whenLabel(t.due)}</span>` : null}
      </div>`;
    })}
    ${todos && todos.length > limit ? html`<button class="more-link" onClick=${() => navigate('todos')}>还有 ${todos.length - limit} 件 →</button>` : null}
  </div>`;
}

function Upcoming({ list }) {
  if (!list) return null;
  if (!list.length) return html`<${Empty} icon="calendar" title="接下来一周很清闲" />`;
  const groups = [];
  for (const e of list) {
    const d = parseLocal(e.occurrence);
    const label = dayLabel(d);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push(g = { label, items: [] });
    g.items.push(e);
  }
  return html`<div class="upcoming">${groups.map((g) => html`<div class="up-day">
    <div class="up-label">${g.label}</div>
    ${g.items.map((e) => html`<button class=${`up-item c-${e.color}`} onClick=${() => editEvent(e)}><i></i><span class="up-time">${e.allDay ? '全天' : fmtTime(parseLocal(e.occurrence))}</span><span>${e.title}</span></button>`)}
  </div>`)}</div>`;
}

function Reminders({ list }) {
  if (!list) return null;
  if (!list.length) return html`<p class="muted small pad">两天内没有提醒。</p>`;
  return html`<div class="rem-list">${list.map((r) => html`<div class="rem-row" key=${r.id}>
    ${ICON.bell}<span class="rem-text">${r.text}</span><span class="rem-at">${whenLabel(r.at)}${r.repeat ? ' · 重复' : ''}</span>
    <button class="icon-btn small" title="取消提醒" onClick=${() => attempt('reminder.cancel', r.id)}>${ICON.close}</button>
  </div>`)}</div>`;
}

const STATUS = { running: '进行中', waiting: '等你确认', queued: '排队中', done: '完成', failed: '失败', cancelled: '已取消', interrupted: '已中断', paused: '已暂停' };
function WorkshopMini({ tasks }) {
  const list = (tasks || []).filter((t) => ['running', 'waiting', 'queued'].includes(t.status) || Date.now() - t.updatedAt < 86400000).slice(0, 4);
  if (!list.length) return html`<p class="muted small pad">没有进行中的工坊任务。可以在聊天里说「帮我……」让莓华开工。</p>`;
  return html`<div class="ws-mini">${list.map((t) => {
    const done = t.plan.filter((p) => p.status === 'done').length;
    return html`<button class="ws-row" onClick=${() => navigate(`workshop/${t.id}`)}>
      <span class=${`pill s-${t.status}`}>${STATUS[t.status] || t.status}</span>
      <span class="ws-title">${t.title}</span>
      ${t.plan.length ? html`<span class="ws-prog"><i style=${`width:${Math.round((done / t.plan.length) * 100)}%`}></i></span>` : html`<span class="muted small">${ago(t.updatedAt)}</span>`}
    </button>`;
  })}</div>`;
}

export function TodayPage({ settings }) {
  const now = useNow();
  const { data: t } = useRpc('planner.today', [], ['planner:changed']);
  const { data: tasks } = useRpc('agent.list', [], ['agent:task', 'agent:removed']);
  return html`<div class="today-grid">
    <${Hero} t=${t} settings=${settings} now=${now} />
    <${Sheet} title="今日时间线" icon="clock" tape="berry" class="area-timeline" actions=${html`<button class="btn small ghost" onClick=${() => navigate('calendar')}>日历 →</button>`}>
      <${Timeline} events=${t?.events} now=${now} />
    <//>
    <${Sheet} title="待办" icon="todo" tape="mint" class="area-todos" actions=${html`<button class="btn small ghost" onClick=${() => navigate('todos')}>全部 →</button>`}>
      <${TodoList} todos=${t?.todos} />
    <//>
    <${Sheet} title="接下来一周" icon="calendar" tape="lav" class="area-upcoming">
      <${Upcoming} list=${t?.upcoming} />
    <//>
    <div class="stack area-side">
      <${Sheet} title="莓华的小窝" icon="nest" tape="berry">
        <${NestMini} />
      <//>
      <${Sheet} title="提醒" icon="bell" tape="honey" actions=${html`<button class="icon-btn small" title="新提醒" onClick=${() => newReminder()}>${ICON.plus}</button>`}>
        <${Reminders} list=${t?.reminders} />
      <//>
      <${Sheet} title="工坊" icon="workshop" tape="sky" actions=${html`<button class="btn small ghost" onClick=${() => navigate('workshop')}>打开 →</button>`}>
        <${WorkshopMini} tasks=${tasks} />
      <//>
    </div>
  </div>`;
}
