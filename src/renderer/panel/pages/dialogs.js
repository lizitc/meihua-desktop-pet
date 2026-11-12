// Editors shared by several pages: calendar event, todo, reminder and routine.
import { html, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { invoke, toast, confirmBox, openDialog, fieldSetter, fmtDate, fmtTime, parseLocal, isDateOnly, addDays, fmtDateTime } from '../lib.js';
import { Field, Switch, Seg, ColorPick, WeekdayPick } from '../kit.js';

const REMIND = [
  { v: -1, l: '不提醒' }, { v: 0, l: '开始时' }, { v: 5, l: '提前 5 分钟' }, { v: 10, l: '提前 10 分钟' },
  { v: 15, l: '提前 15 分钟' }, { v: 30, l: '提前 30 分钟' }, { v: 60, l: '提前 1 小时' }, { v: 120, l: '提前 2 小时' }, { v: 1440, l: '提前 1 天' },
];
const FREQ = [{ v: '', l: '不重复' }, { v: 'daily', l: '每天' }, { v: 'weekly', l: '每周' }, { v: 'monthly', l: '每月' }, { v: 'yearly', l: '每年' }];

async function run(fn, okText) {
  try { const r = await fn(); if (okText) toast(okText, 'ok'); return r ?? true; } catch (err) { toast(err.message, 'error'); return null; }
}

function DialogHead({ icon, title, close }) {
  return html`<div class="dialog-head">
    <h3 class="dialog-title">${ICON[icon]}<span>${title}</span></h3>
    <button class="icon-btn" onClick=${() => close(undefined)} title="关闭">${ICON.close}</button>
  </div>`;
}

// ------------------------------------------------------------ calendar event
function EventEditor({ ev, date, close }) {
  const s0 = ev ? parseLocal(ev.start) : null;
  const e0 = ev?.end ? parseLocal(ev.end) : null;
  const def = date ? parseLocal(date) : new Date();
  const nextHour = new Date(); nextHour.setMinutes(0, 0, 0); nextHour.setHours(nextHour.getHours() + 1);
  const [f, setF] = useState({
    title: ev?.title || '',
    allDay: ev ? ev.allDay : false,
    date: ev ? fmtDate(s0) : fmtDate(def),
    startTime: ev && !ev.allDay ? fmtTime(s0) : fmtTime(nextHour),
    endTime: ev && !ev.allDay && e0 ? fmtTime(e0) : fmtTime(new Date(nextHour.getTime() + 3600000)),
    endDate: ev?.allDay && ev.end ? ev.end : '',
    location: ev?.location || '', notes: ev?.notes || '', color: ev?.color || 'berry',
    remind: ev ? (ev.remind?.length ? ev.remind[0] : -1) : 10,
    freq: ev?.recurrence?.freq || '', interval: ev?.recurrence?.interval || 1,
    byWeekday: ev?.recurrence?.byWeekday || [], until: ev?.recurrence?.until || '',
  });
  const set = fieldSetter(setF);

  const save = async () => {
    if (!f.title.trim()) { toast('写个标题吧', 'error'); return; }
    let start, end;
    if (f.allDay) { start = f.date; end = f.endDate && f.endDate > f.date ? f.endDate : null; }
    else {
      start = `${f.date}T${f.startTime}`;
      let e = parseLocal(`${f.date}T${f.endTime}`);
      if (e <= parseLocal(start)) e = addDays(e, 1);
      end = fmtDateTime(e);
    }
    const payload = {
      title: f.title.trim(), allDay: f.allDay, start, end, location: f.location, notes: f.notes, color: f.color,
      remind: Number(f.remind) < 0 ? [] : [Number(f.remind)],
      recurrence: f.freq ? { freq: f.freq, interval: Number(f.interval) || 1, byWeekday: f.freq === 'weekly' && f.byWeekday.length ? f.byWeekday : null, until: f.until || null } : null,
    };
    const r = await run(() => (ev ? invoke('calendar.update', ev.id, payload) : invoke('calendar.add', payload)), ev ? '日程已更新' : '记到日历上啦');
    if (r) close(true);
  };

  const remove = async () => {
    let opts;
    if (ev.recurring || ev.recurrence) {
      const a = await confirmBox({ title: '删除重复日程', body: `「${ev.title}」是重复日程。`, ok: '删除整个系列', danger: true, extra: { label: '只删这一次', value: 'one' } });
      if (!a) return;
      if (a === 'one') opts = { occurrence: String(ev.occurrence || ev.start).slice(0, 10) };
    } else if (!(await confirmBox({ title: '删除日程', body: `确定删除「${ev.title}」吗？`, ok: '删除', danger: true }))) return;
    const r = await run(() => invoke('calendar.delete', ev.id, opts), '已删除');
    if (r) close(true);
  };

  return html`<div class="dialog-body">
    <${DialogHead} icon="calendar" title=${ev ? '编辑日程' : '新建日程'} close=${close} />
    <div class="form">
      <${Field} wide><input class="input big" placeholder="要做什么？" value=${f.title} onInput=${set('title')} autofocus /><//>
      <div class="form-row">
        <${Field} label="日期"><input class="input" type="date" value=${f.date} onInput=${set('date')} /><//>
        ${f.allDay
          ? html`<${Field} label="结束日期（可选）"><input class="input" type="date" value=${f.endDate} min=${f.date} onInput=${set('endDate')} /><//>`
          : html`<${Field} label="开始"><input class="input" type="time" value=${f.startTime} onInput=${set('startTime')} /><//>
                 <${Field} label="结束"><input class="input" type="time" value=${f.endTime} onInput=${set('endTime')} /><//>`}
      </div>
      <${Switch} label="全天" checked=${f.allDay} onChange=${set('allDay')} />
      <div class="form-row">
        <${Field} label="地点"><input class="input" placeholder="可选" value=${f.location} onInput=${set('location')} /><//>
        <${Field} label="提醒">${f.allDay
          ? html`<select class="input" value=${Number(f.remind) < 0 ? -1 : 0} onChange=${set('remind')}><option value="-1">不提醒</option><option value="0">当天 9:00</option></select>`
          : html`<select class="input" value=${f.remind} onChange=${set('remind')}>${REMIND.map((r) => html`<option value=${r.v}>${r.l}</option>`)}</select>`}<//>
      </div>
      <div class="form-row">
        <${Field} label="重复"><select class="input" value=${f.freq} onChange=${set('freq')}>${FREQ.map((r) => html`<option value=${r.v}>${r.l}</option>`)}</select><//>
        ${f.freq ? html`<${Field} label="间隔"><div class="input-unit"><input class="input" type="number" min="1" max="99" value=${f.interval} onInput=${set('interval')} /><span>${{ daily: '天', weekly: '周', monthly: '月', yearly: '年' }[f.freq]}</span></div><//>
          <${Field} label="截止（可选）"><input class="input" type="date" value=${f.until} min=${f.date} onInput=${set('until')} /><//>` : null}
      </div>
      ${f.freq === 'weekly' ? html`<${Field} label="在每周的"><${WeekdayPick} value=${f.byWeekday} onChange=${set('byWeekday')} /><//>` : null}
      <${Field} label="颜色"><${ColorPick} value=${f.color} onChange=${set('color')} /><//>
      <${Field} label="备注" wide><textarea class="input textarea" rows="3" value=${f.notes} onInput=${set('notes')} placeholder="可选"></textarea><//>
      ${ev?.recurrence ? html`<p class="hint">${ICON.repeat} 修改会应用到整个重复系列。</p>` : null}
    </div>
    <div class="dialog-actions">
      ${ev ? html`<button class="btn ghost danger-text" onClick=${remove}>${ICON.trash}删除</button>` : null}
      <span class="grow"></span>
      <button class="btn" onClick=${() => close(undefined)}>取消</button>
      <button class="btn primary" onClick=${save}>${ICON.check}保存</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------ todo
function TodoEditor({ todo, close }) {
  const due = todo?.due ? parseLocal(todo.due) : null;
  const [f, setF] = useState({
    title: todo?.title || '', notes: todo?.notes || '', priority: todo?.priority || 0, tags: (todo?.tags || []).join('，'),
    dueDate: due ? fmtDate(due) : '', dueTime: due && !isDateOnly(todo.due) ? fmtTime(due) : '',
  });
  const set = fieldSetter(setF);
  const save = async () => {
    if (!f.title.trim()) { toast('待办标题不能为空', 'error'); return; }
    const payload = {
      title: f.title.trim(), notes: f.notes, priority: Number(f.priority),
      due: f.dueDate ? (f.dueTime ? `${f.dueDate}T${f.dueTime}` : f.dueDate) : null,
      tags: f.tags.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
    };
    const r = await run(() => (todo ? invoke('todo.update', todo.id, payload) : invoke('todo.add', payload)), todo ? '已更新' : '加到待办啦');
    if (r) close(true);
  };
  const remove = async () => {
    if (!(await confirmBox({ title: '删除待办', body: `确定删除「${todo.title}」吗？`, ok: '删除', danger: true }))) return;
    if (await run(() => invoke('todo.delete', todo.id), '已删除')) close(true);
  };
  return html`<div class="dialog-body">
    <${DialogHead} icon="todo" title=${todo ? '编辑待办' : '新待办'} close=${close} />
    <div class="form">
      <${Field} wide><input class="input big" placeholder="要完成什么？" value=${f.title} onInput=${set('title')} autofocus /><//>
      <div class="form-row">
        <${Field} label="截止日期"><input class="input" type="date" value=${f.dueDate} onInput=${set('dueDate')} /><//>
        <${Field} label="时间（可选）"><input class="input" type="time" value=${f.dueTime} disabled=${!f.dueDate} onInput=${set('dueTime')} /><//>
      </div>
      <${Field} label="重要程度"><${Seg} small value=${Number(f.priority)} onChange=${set('priority')} options=${[{ value: 0, label: '普通' }, { value: 1, label: '!' }, { value: 2, label: '!!' }, { value: 3, label: '!!!' }]} /><//>
      <${Field} label="标签" hint="用逗号分隔"><input class="input" value=${f.tags} onInput=${set('tags')} placeholder="工作，生活" /><//>
      <${Field} label="备注" wide><textarea class="input textarea" rows="3" value=${f.notes} onInput=${set('notes')}></textarea><//>
    </div>
    <div class="dialog-actions">
      ${todo ? html`<button class="btn ghost danger-text" onClick=${remove}>${ICON.trash}删除</button>` : null}
      <span class="grow"></span>
      <button class="btn" onClick=${() => close(undefined)}>取消</button>
      <button class="btn primary" onClick=${save}>${ICON.check}保存</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------ reminder
function ReminderEditor({ close }) {
  const soon = new Date(Date.now() + 30 * 60000); soon.setSeconds(0, 0); soon.setMinutes(Math.ceil(soon.getMinutes() / 5) * 5);
  const [f, setF] = useState({ text: '', date: fmtDate(soon), time: fmtTime(soon), repeat: '' });
  const set = fieldSetter(setF);
  const quick = (mins) => { const d = new Date(Date.now() + mins * 60000); setF((p) => ({ ...p, date: fmtDate(d), time: fmtTime(d) })); };
  const save = async () => {
    if (!f.text.trim()) { toast('提醒什么呢？', 'error'); return; }
    const r = await run(() => invoke('reminder.add', { text: f.text.trim(), at: `${f.date}T${f.time}`, repeat: f.repeat || null }), '到时间我会提醒你的');
    if (r) close(true);
  };
  return html`<div class="dialog-body narrow">
    <${DialogHead} icon="bell" title="新提醒" close=${close} />
    <div class="form">
      <${Field} wide><input class="input big" placeholder="到时候提醒你什么？" value=${f.text} onInput=${set('text')} autofocus onKeyDown=${(e) => { if (e.key === 'Enter') save(); }} /><//>
      <div class="chips">${[[10, '10 分钟后'], [30, '半小时后'], [60, '1 小时后'], [180, '3 小时后']].map(([m, l]) => html`<button class="chip" onClick=${() => quick(m)}>${l}</button>`)}</div>
      <div class="form-row">
        <${Field} label="日期"><input class="input" type="date" value=${f.date} onInput=${set('date')} /><//>
        <${Field} label="时间"><input class="input" type="time" value=${f.time} onInput=${set('time')} /><//>
      </div>
      <${Field} label="重复"><select class="input" value=${f.repeat} onChange=${set('repeat')}>
        ${[['', '不重复'], ['daily', '每天'], ['weekdays', '工作日'], ['weekly', '每周'], ['monthly', '每月'], ['hourly', '每小时']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}
      </select><//>
    </div>
    <div class="dialog-actions">
      <button class="btn" onClick=${() => close(undefined)}>取消</button>
      <button class="btn primary" onClick=${save}>${ICON.bell}设定提醒</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------ routine
function RoutineEditor({ routine, close }) {
  const [f, setF] = useState({ name: routine?.name || '', time: routine?.time || '08:00', days: routine?.days || [], prompt: routine?.prompt || '', enabled: routine ? routine.enabled : true });
  const set = fieldSetter(setF);
  const save = async () => {
    if (!f.prompt.trim()) { toast('写一下要莓华做什么', 'error'); return; }
    const payload = { name: f.name.trim() || '例行任务', time: f.time, days: f.days.length && f.days.length < 7 ? f.days : null, prompt: f.prompt.trim(), enabled: f.enabled };
    const r = await run(() => (routine ? invoke('routine.update', routine.id, payload) : invoke('routine.add', payload)), '例行任务已保存');
    if (r) close(true);
  };
  return html`<div class="dialog-body">
    <${DialogHead} icon="repeat" title=${routine ? '编辑例行任务' : '新例行任务'} close=${close} />
    <div class="form">
      <div class="form-row">
        <${Field} label="名称"><input class="input" value=${f.name} onInput=${set('name')} placeholder="比如：早间天气" autofocus /><//>
        <${Field} label="时间"><input class="input" type="time" value=${f.time} onInput=${set('time')} /><//>
      </div>
      <${Field} label="哪几天" hint="都不选 = 每天"><${WeekdayPick} value=${f.days} onChange=${set('days')} /><//>
      <${Field} label="到点时莓华要做的事" wide hint="用自然语言写就行，莓华会照做（可以用到她所有的工具）。">
        <textarea class="input textarea" rows="4" value=${f.prompt} onInput=${set('prompt')} placeholder="例如：查一下今天上海的天气，如果会下雨就提醒我带伞，再说说今天有哪些安排。"></textarea>
      <//>
      <${Switch} label="启用" checked=${f.enabled} onChange=${set('enabled')} />
    </div>
    <div class="dialog-actions">
      <button class="btn" onClick=${() => close(undefined)}>取消</button>
      <button class="btn primary" onClick=${save}>${ICON.check}保存</button>
    </div>
  </div>`;
}

export const editEvent = (ev, date) => openDialog(EventEditor, { ev, date });
export const editTodo = (todo) => openDialog(TodoEditor, { todo });
export const newReminder = () => openDialog(ReminderEditor, {});
export const editRoutine = (routine) => openDialog(RoutineEditor, { routine });
