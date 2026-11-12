// 日程: a month spread (Monday first) with colored chips, and the selected day's page:
// events, todos due and reminders. Double-click a day to add an event there.
import { html, useMemo, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { useRpc, attempt, fmtDate, fmtTime, parseLocal, addDays, startOfDay, sameDay, dayLabel, WEEK, whenLabel } from '../lib.js';
import { PawCheck, Empty } from '../kit.js';
import { editEvent, editTodo } from './dialogs.js';

const HEAD = ['一', '二', '三', '四', '五', '六', '日'];

function byDay(occ) {
  const map = new Map();
  const put = (key, e) => { if (!map.has(key)) map.set(key, []); map.get(key).push(e); };
  for (const e of occ || []) {
    const s = parseLocal(e.occurrence);
    if (e.allDay && e.occEnd && e.occEnd > e.occurrence) {
      for (let d = s, i = 0; fmtDate(d) <= e.occEnd && i < 62; d = addDays(d, 1), i++) put(fmtDate(d), e);
    } else put(fmtDate(s), e);
  }
  for (const list of map.values()) list.sort((a, b) => (b.allDay - a.allDay) || (parseLocal(a.occurrence) - parseLocal(b.occurrence)));
  return map;
}

export function CalendarPage() {
  const today = startOfDay(new Date());
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [sel, setSel] = useState(today);
  const gridStart = addDays(cursor, -((cursor.getDay() + 6) % 7));
  const gridEnd = addDays(gridStart, 42);
  const { data: occ } = useRpc('calendar.range', [fmtDate(gridStart), fmtDate(gridEnd)], ['planner:changed']);
  const { data: todos } = useRpc('todo.list', ['open'], ['planner:changed']);
  const { data: reminders } = useRpc('reminder.list', [{}], ['planner:changed']);
  const days = useMemo(() => byDay(occ), [occ]);

  const move = (n) => { const c = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1); setCursor(c); };
  const goToday = () => { setCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setSel(today); };
  const selKey = fmtDate(sel);
  const selEvents = days.get(selKey) || [];
  const selTodos = (todos || []).filter((t) => t.due && t.due.slice(0, 10) === selKey);
  const selRem = (reminders || []).filter((r) => r.at.slice(0, 10) === selKey);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const key = fmtDate(d);
    const list = days.get(key) || [];
    const dueCount = (todos || []).filter((t) => t.due && t.due.slice(0, 10) === key).length;
    const cls = ['cell', d.getMonth() !== cursor.getMonth() ? 'out' : '', sameDay(d, today) ? 'today' : '', sameDay(d, sel) ? 'sel' : '', d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''].join(' ');
    cells.push(html`<div class=${cls} key=${key} onClick=${() => setSel(d)} onDblClick=${() => editEvent(null, key)}>
      <div class="cell-head"><span class="cell-num">${d.getDate()}</span>${dueCount ? html`<span class="cell-due" title=${`${dueCount} 件待办到期`}>${ICON.todo}${dueCount}</span>` : null}</div>
      <div class="cell-chips">
        ${list.slice(0, 3).map((e) => html`<button class=${`chip-ev c-${e.color} ${e.allDay ? 'allday' : ''}`} onClick=${(ev) => { ev.stopPropagation(); setSel(d); editEvent(e); }} title=${e.title}>
          ${e.allDay ? null : html`<b>${fmtTime(parseLocal(e.occurrence))}</b>`}${e.title}
        </button>`)}
        ${list.length > 3 ? html`<span class="cell-more">还有 ${list.length - 3} 项</span>` : null}
      </div>
    </div>`);
  }

  return html`<div class="cal">
    <header class="page-head">
      <div class="month-nav">
        <button class="icon-btn" onClick=${() => move(-1)} title="上个月">${ICON.left}</button>
        <h1>${cursor.getFullYear()}年<b>${cursor.getMonth() + 1}</b>月</h1>
        <button class="icon-btn" onClick=${() => move(1)} title="下个月">${ICON.right}</button>
        <button class="btn small" onClick=${goToday}>今天</button>
      </div>
      <div class="head-actions">
        <span class="hint">双击某一天可以直接新建</span>
        <button class="btn primary" onClick=${() => editEvent(null, selKey)}>${ICON.plus}新建日程</button>
      </div>
    </header>
    <div class="cal-body">
      <div class="month sheet flush">
        <div class="month-head">${HEAD.map((h, i) => html`<span class=${i >= 5 ? 'weekend' : ''}>${h}</span>`)}</div>
        <div class="month-grid">${cells}</div>
      </div>
      <aside class="day-page sheet">
        <div class="day-head">
          <div class="day-big">${sel.getDate()}</div>
          <div><div class="day-label">${dayLabel(sel)}</div><div class="muted small">${sel.getFullYear()}年${sel.getMonth() + 1}月 · 星期${WEEK[sel.getDay()]}</div></div>
          <button class="icon-btn" title="在这天新建日程" onClick=${() => editEvent(null, selKey)}>${ICON.plus}</button>
        </div>
        <div class="day-scroll">
          ${!selEvents.length && !selTodos.length && !selRem.length ? html`<${Empty} icon="calendar" art="day-free" title="这一天是空白页" text="双击日历格子或点右上角的 + 添加安排。" />` : null}
          ${selEvents.map((e) => html`<button class=${`day-ev c-${e.color}`} onClick=${() => editEvent(e)}>
            <span class="day-ev-time">${e.allDay ? '全天' : html`${fmtTime(parseLocal(e.occurrence))}<small>${fmtTime(parseLocal(e.occEnd))}</small>`}</span>
            <span class="day-ev-body">
              <span class="day-ev-title">${e.title}${e.recurring ? ICON.repeat : null}</span>
              ${e.location ? html`<span class="day-ev-meta">${ICON.location}${e.location}</span>` : null}
              ${e.notes ? html`<span class="day-ev-notes">${e.notes}</span>` : null}
              ${e.remind?.length ? html`<span class="day-ev-meta">${ICON.bell}${e.allDay ? '当天 9:00' : e.remind[0] ? `提前 ${e.remind[0] >= 60 ? e.remind[0] / 60 + ' 小时' : e.remind[0] + ' 分钟'}` : '开始时'}提醒</span>` : null}
            </span>
          </button>`)}
          ${selTodos.length ? html`<div class="day-sub">${ICON.todo}当天到期</div>${selTodos.map((t) => html`<div class="todo-row" onClick=${() => editTodo(t)}>
            <${PawCheck} checked=${t.done} onChange=${(v) => attempt('todo.update', t.id, { done: v })} /><span class="todo-title">${t.title}</span>
            ${t.due.length > 10 ? html`<span class="due">${fmtTime(parseLocal(t.due))}</span>` : null}
          </div>`)}` : null}
          ${selRem.length ? html`<div class="day-sub">${ICON.bell}提醒</div>${selRem.map((r) => html`<div class="rem-row">${ICON.bell}<span class="rem-text">${r.text}</span><span class="rem-at">${whenLabel(r.at)}</span></div>`)}` : null}
        </div>
      </aside>
    </div>
  </div>`;
}
