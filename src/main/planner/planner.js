// Calendar (with recurrence), todos, reminders and routines. Data lives in JSON stores;
// every mutation emits `planner:changed` so windows and the scheduler stay in sync.
import { JsonStore, uid } from '../store.js';
import { dataFile } from '../paths.js';
import { bus, rpc, broadcast } from '../bus.js';
import { parseLocal, fmtDate, fmtDateTime, normalize, isDateOnly, addDays, startOfDay, human } from './time.js';

const COLORS = ['berry', 'mint', 'lav', 'honey', 'sky', 'ink'];

class Planner {
  constructor() {
    this.events = new JsonStore(dataFile('calendar.json'), { events: [] });
    this.todos = new JsonStore(dataFile('todos.json'), { todos: [] });
    this.reminders = new JsonStore(dataFile('reminders.json'), { reminders: [] });
    this.routines = new JsonStore(dataFile('routines.json'), { routines: [] });
  }

  #changed(kind) {
    bus.emit('planner:changed', kind);
    broadcast('planner:changed', kind);
  }

  // ------------------------------------------------------------ calendar
  addEvent(input, source = 'user') {
    const start = normalize(input.start, { dateOnly: !!input.allDay });
    if (!start) throw new Error('开始时间格式不正确，应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm');
    let end = input.end ? normalize(input.end, { dateOnly: isDateOnly(start) }) : null;
    if (!end && !isDateOnly(start)) end = fmtDateTime(new Date(parseLocal(start).getTime() + (input.durationMinutes || 60) * 60000));
    if (end && parseLocal(end) < parseLocal(start)) throw new Error('结束时间早于开始时间');
    const ev = {
      id: uid('ev_'), title: String(input.title || '未命名日程').slice(0, 200), start, end,
      allDay: isDateOnly(start), location: input.location || '', notes: input.notes || '',
      color: COLORS.includes(input.color) ? input.color : 'berry',
      remind: Array.isArray(input.remind) ? input.remind.map(Number).filter((n) => n >= 0) : input.remindMinutes != null ? [Number(input.remindMinutes)] : [10],
      recurrence: this.#recurrence(input.recurrence), exdates: [], source, createdAt: Date.now(),
    };
    this.events.data.events.push(ev);
    this.events.save();
    this.#changed('calendar');
    return ev;
  }

  #recurrence(r) {
    if (!r || !r.freq) return null;
    const freq = ['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq) ? r.freq : null;
    if (!freq) return null;
    return {
      freq, interval: Math.max(1, Math.min(365, Number(r.interval) || 1)),
      byWeekday: Array.isArray(r.byWeekday) ? r.byWeekday.map(Number).filter((n) => n >= 0 && n <= 6) : null,
      until: r.until ? normalize(r.until, { dateOnly: true }) : null,
      count: r.count ? Math.max(1, Math.min(1000, Number(r.count))) : null,
    };
  }

  updateEvent(id, patch) {
    const ev = this.events.data.events.find((e) => e.id === id);
    if (!ev) throw new Error('找不到这个日程');
    if (patch.title != null) ev.title = String(patch.title).slice(0, 200);
    if (patch.start != null) { const s = normalize(patch.start, { dateOnly: !!patch.allDay }); if (!s) throw new Error('开始时间格式不正确'); ev.start = s; ev.allDay = isDateOnly(s); }
    if (patch.end !== undefined) ev.end = patch.end ? normalize(patch.end, { dateOnly: ev.allDay }) : null;
    for (const k of ['location', 'notes']) if (patch[k] != null) ev[k] = String(patch[k]);
    if (patch.color && COLORS.includes(patch.color)) ev.color = patch.color;
    if (patch.remind !== undefined) ev.remind = Array.isArray(patch.remind) ? patch.remind.map(Number) : patch.remind == null ? [] : [Number(patch.remind)];
    if (patch.remindMinutes !== undefined) ev.remind = patch.remindMinutes == null ? [] : [Number(patch.remindMinutes)];
    if (patch.recurrence !== undefined) ev.recurrence = this.#recurrence(patch.recurrence);
    this.events.save();
    this.#changed('calendar');
    return ev;
  }

  deleteEvent(id, { occurrence } = {}) {
    const list = this.events.data.events;
    const ev = list.find((e) => e.id === id);
    if (!ev) throw new Error('找不到这个日程');
    if (occurrence && ev.recurrence) { ev.exdates.push(normalize(occurrence, { dateOnly: true })); }
    else list.splice(list.indexOf(ev), 1);
    this.events.save();
    this.#changed('calendar');
    return { ok: true, title: ev.title };
  }

  /** Expand events (incl. recurrences) overlapping [from, to). */
  occurrences(from, to) {
    const a = from instanceof Date ? from : parseLocal(from);
    const b = to instanceof Date ? to : parseLocal(to);
    const out = [];
    for (const ev of this.events.data.events) {
      const s0 = parseLocal(ev.start);
      const e0 = ev.end ? parseLocal(ev.end) : ev.allDay ? addDays(s0, 1) : new Date(s0.getTime() + 3600000);
      const dur = Math.max(0, (ev.allDay && ev.end ? addDays(parseLocal(ev.end), 1) : e0) - s0);
      const push = (s) => {
        const e = new Date(s.getTime() + dur);
        if (e > a && s < b && !ev.exdates?.includes(fmtDate(s))) {
          out.push({ ...ev, occurrence: ev.allDay ? fmtDate(s) : fmtDateTime(s), occEnd: ev.allDay ? fmtDate(addDays(e, -1)) : fmtDateTime(e), recurring: !!ev.recurrence });
        }
      };
      const r = ev.recurrence;
      if (!r) { push(s0); continue; }
      const until = r.until ? addDays(parseLocal(r.until), 1) : null;
      let n = 0;
      const limit = (s) => (until && s >= until) || (r.count && n >= r.count) || s >= b;
      if (r.freq === 'weekly' && r.byWeekday?.length) {
        const weekStart = addDays(startOfDay(s0), -s0.getDay());
        for (let w = 0; w < 2000; w++) {
          const base = addDays(weekStart, w * 7 * r.interval);
          if (base >= b) break;
          let stop = false;
          for (const wd of [...r.byWeekday].sort()) {
            const s = addDays(base, wd); s.setHours(s0.getHours(), s0.getMinutes(), 0, 0);
            if (s < s0) continue;
            if (limit(s)) { stop = true; break; }
            n++; push(s);
          }
          if (stop) break;
        }
        continue;
      }
      for (let i = 0; i < 5000; i++) {
        const s = new Date(s0);
        if (r.freq === 'daily') s.setDate(s0.getDate() + i * r.interval);
        else if (r.freq === 'weekly') s.setDate(s0.getDate() + i * 7 * r.interval);
        else if (r.freq === 'monthly') { s.setDate(1); s.setMonth(s0.getMonth() + i * r.interval); const dim = new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate(); if (s0.getDate() > dim) continue; s.setDate(s0.getDate()); }
        else { s.setFullYear(s0.getFullYear() + i * r.interval); if (s.getMonth() !== s0.getMonth()) continue; }
        if (limit(s)) break;
        n++;
        if (new Date(s.getTime() + dur) <= a) continue;
        push(s);
      }
    }
    return out.sort((x, y) => parseLocal(x.occurrence) - parseLocal(y.occurrence));
  }

  // ------------------------------------------------------------ todos
  addTodo(input, source = 'user') {
    const t = {
      id: uid('td_'), title: String(input.title || '').slice(0, 300), notes: input.notes || '',
      due: input.due ? normalize(input.due) : null, priority: Math.max(0, Math.min(3, Number(input.priority) || 0)),
      tags: Array.isArray(input.tags) ? input.tags.slice(0, 8).map(String) : [], done: false, doneAt: null,
      createdAt: Date.now(), source, order: Date.now(),
    };
    if (!t.title) throw new Error('待办标题不能为空');
    this.todos.data.todos.push(t);
    this.todos.save();
    this.#changed('todos');
    return t;
  }

  updateTodo(id, patch) {
    const t = this.todos.data.todos.find((x) => x.id === id);
    if (!t) throw new Error('找不到这个待办');
    if (patch.title != null) t.title = String(patch.title).slice(0, 300);
    if (patch.notes != null) t.notes = String(patch.notes);
    if (patch.due !== undefined) t.due = patch.due ? normalize(patch.due) : null;
    if (patch.priority != null) t.priority = Math.max(0, Math.min(3, Number(patch.priority) || 0));
    if (patch.tags) t.tags = patch.tags.slice(0, 8).map(String);
    if (patch.order != null) t.order = Number(patch.order);
    if (patch.done != null && !!patch.done !== t.done) {
      t.done = !!patch.done; t.doneAt = t.done ? Date.now() : null;
      if (t.done) bus.emit('todo:done', t);
    }
    this.todos.save();
    this.#changed('todos');
    return t;
  }

  deleteTodo(id) {
    const list = this.todos.data.todos;
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('找不到这个待办');
    const [t] = list.splice(i, 1);
    this.todos.save();
    this.#changed('todos');
    return { ok: true, title: t.title };
  }

  listTodos(status = 'open') {
    const list = this.todos.data.todos.filter((t) => status === 'all' || (status === 'done' ? t.done : !t.done));
    return list.sort((a, b) => (a.done - b.done) || (b.priority - a.priority) || ((a.due ? parseLocal(a.due) : Infinity) - (b.due ? parseLocal(b.due) : Infinity)) || (a.order - b.order));
  }

  // ------------------------------------------------------------ reminders
  addReminder(input, source = 'user') {
    const at = normalize(input.at);
    if (!at || isDateOnly(at)) throw new Error('提醒时间需要精确到分钟，例如 2026-11-09T15:30');
    const r = {
      id: uid('rm_'), text: String(input.text || '').slice(0, 300), at,
      repeat: input.repeat && ['daily', 'weekly', 'monthly', 'weekdays', 'hourly'].includes(input.repeat.freq || input.repeat) ? { freq: input.repeat.freq || input.repeat, interval: Math.max(1, Number(input.repeat.interval) || 1) } : null,
      done: false, createdAt: Date.now(), source,
    };
    if (!r.text) throw new Error('提醒内容不能为空');
    this.reminders.data.reminders.push(r);
    this.reminders.save();
    this.#changed('reminders');
    return r;
  }

  cancelReminder(id) {
    const list = this.reminders.data.reminders;
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('找不到这个提醒');
    const [r] = list.splice(i, 1);
    this.reminders.save();
    this.#changed('reminders');
    return { ok: true, text: r.text };
  }

  snoozeReminder(id, minutes) {
    const r = this.reminders.data.reminders.find((x) => x.id === id);
    if (!r) return null;
    r.at = fmtDateTime(new Date(Date.now() + minutes * 60000));
    r.done = false;
    this.reminders.save();
    this.#changed('reminders');
    return r;
  }

  /** Mark fired; repeating reminders move to their next time. */
  completeReminder(id) {
    const r = this.reminders.data.reminders.find((x) => x.id === id);
    if (!r) return;
    if (r.repeat) {
      let d = parseLocal(r.at);
      const now = new Date();
      do {
        if (r.repeat.freq === 'hourly') d = new Date(d.getTime() + 3600000 * r.repeat.interval);
        else if (r.repeat.freq === 'daily') d = addDays(d, r.repeat.interval);
        else if (r.repeat.freq === 'weekly') d = addDays(d, 7 * r.repeat.interval);
        else if (r.repeat.freq === 'weekdays') { do d = addDays(d, 1); while (d.getDay() === 0 || d.getDay() === 6); }
        else { d = new Date(d); d.setMonth(d.getMonth() + r.repeat.interval); }
      } while (d <= now);
      r.at = fmtDateTime(d);
    } else r.done = true;
    this.reminders.save();
    this.#changed('reminders');
  }

  listReminders({ includeDone = false } = {}) {
    return this.reminders.data.reminders.filter((r) => includeDone || !r.done).sort((a, b) => parseLocal(a.at) - parseLocal(b.at));
  }

  // ------------------------------------------------------------ routines (AI automations)
  addRoutine(input) {
    const days = Array.isArray(input.days) ? input.days.map(Number).filter((n) => n >= 0 && n <= 6) : null;
    if (!/^\d{1,2}:\d{2}$/.test(input.time || '')) throw new Error('时间格式应为 HH:mm');
    const r = { id: uid('rt_'), name: String(input.name || '例行任务').slice(0, 60), prompt: String(input.prompt || '').slice(0, 2000), time: input.time, days: days?.length ? days : null, enabled: input.enabled !== false, lastRun: null, createdAt: Date.now() };
    if (!r.prompt) throw new Error('例行任务需要说明要做什么');
    this.routines.data.routines.push(r);
    this.routines.save();
    this.#changed('routines');
    return r;
  }

  updateRoutine(id, patch) {
    const r = this.routines.data.routines.find((x) => x.id === id);
    if (!r) throw new Error('找不到这个例行任务');
    for (const k of ['name', 'prompt', 'time', 'enabled', 'days', 'lastRun']) if (patch[k] !== undefined) r[k] = patch[k];
    this.routines.save();
    this.#changed('routines');
    return r;
  }

  deleteRoutine(id) {
    const list = this.routines.data.routines;
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('找不到这个例行任务');
    list.splice(i, 1);
    this.routines.save();
    this.#changed('routines');
    return { ok: true };
  }

  // ------------------------------------------------------------ summaries
  /** Compact agenda text used in the AI's per-turn context. */
  agendaText(now = new Date()) {
    const today = startOfDay(now);
    const occ = this.occurrences(today, addDays(today, 2)).filter((o) => (o.allDay ? true : parseLocal(o.occEnd) > now));
    const ev = occ.slice(0, 8).map((o) => `- ${human(o.occurrence, now)}${o.allDay ? '（全天）' : ''} ${o.title}${o.location ? ' @' + o.location : ''} [id:${o.id}]`);
    const todos = this.listTodos('open').slice(0, 8).map((t) => `- ${t.title}${t.due ? '（截止 ' + human(t.due, now) + '）' : ''}${t.priority >= 2 ? ' ★' : ''} [id:${t.id}]`);
    const rem = this.listReminders().slice(0, 5).map((r) => `- ${human(r.at, now)} ${r.text} [id:${r.id}]`);
    return [
      ev.length ? `近两天日程：\n${ev.join('\n')}` : '近两天没有日程。',
      todos.length ? `未完成待办（${this.listTodos('open').length}）：\n${todos.join('\n')}` : '没有未完成的待办。',
      rem.length ? `即将到来的提醒：\n${rem.join('\n')}` : '',
    ].filter(Boolean).join('\n');
  }

  today(now = new Date()) {
    const d0 = startOfDay(now);
    return {
      date: fmtDate(now),
      events: this.occurrences(d0, addDays(d0, 1)),
      upcoming: this.occurrences(addDays(d0, 1), addDays(d0, 8)).slice(0, 12),
      todos: this.listTodos('open'),
      doneToday: this.todos.data.todos.filter((t) => t.done && t.doneAt >= d0.getTime()),
      reminders: this.listReminders().filter((r) => parseLocal(r.at) < addDays(d0, 2)),
    };
  }

  registerRpc() {
    rpc('planner.today', () => this.today());
    rpc('calendar.range', (from, to) => this.occurrences(from, to));
    rpc('calendar.add', (ev) => this.addEvent(ev, 'user'));
    rpc('calendar.update', (id, patch) => this.updateEvent(id, patch));
    rpc('calendar.delete', (id, opts) => this.deleteEvent(id, opts));
    rpc('todo.list', (status) => this.listTodos(status));
    rpc('todo.add', (t) => this.addTodo(t, 'user'));
    rpc('todo.update', (id, patch) => this.updateTodo(id, patch));
    rpc('todo.delete', (id) => this.deleteTodo(id));
    rpc('reminder.list', (opts) => this.listReminders(opts));
    rpc('reminder.add', (r) => this.addReminder(r, 'user'));
    rpc('reminder.cancel', (id) => this.cancelReminder(id));
    rpc('routine.list', () => this.routines.data.routines);
    rpc('routine.add', (r) => this.addRoutine(r));
    rpc('routine.update', (id, patch) => this.updateRoutine(id, patch));
    rpc('routine.delete', (id) => this.deleteRoutine(id));
  }

  flush() { this.events.flush(); this.todos.flush(); this.reminders.flush(); this.routines.flush(); }
}

export const planner = new Planner();
