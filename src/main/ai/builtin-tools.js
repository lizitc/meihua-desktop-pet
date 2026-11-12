// Built-in tools available to the companion.
import { clipboard, shell, net, screen } from 'electron';
import fs from 'node:fs';
import { registerTool } from './tools.js';
import { planner } from '../planner/planner.js';
import { memory, CATS } from './memory.js';
import { settings } from '../settings.js';
import { broadcast } from '../bus.js';
import { human, nowContext } from '../planner/time.js';
import { showCard } from '../notify.js';
import { MOMENT_ACTIONS } from './persona.js';

const S = (properties, required = []) => ({ type: 'object', properties, required });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const DT = 'YYYY-MM-DDTHH:mm（本地时间）；全天事项用 YYYY-MM-DD';

const RECURRENCE = {
  type: 'object', description: '重复规则（可选）',
  properties: {
    freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] },
    interval: { type: 'integer', minimum: 1, description: '每隔几个周期，默认 1' },
    byWeekday: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'weekly 时指定星期几，0=周日' },
    until: str('结束日期 YYYY-MM-DD'),
    count: { type: 'integer', minimum: 1, description: '总共重复次数' },
  },
  required: ['freq'],
};

const PET_ACTIONS = ['walk_to', 'walk_left', 'walk_right', 'come', 'go_edge', 'sit', 'sleep', 'wake', 'stand', 'hop', 'nod', 'shake_head', 'tilt_head', 'wag', 'perk_ears', 'droop_ears', 'wave', 'bow', 'spin', 'look', ...MOMENT_ACTIONS];

// Settings the assistant may change on request (everything else stays user-only).
const SAFE_SETTINGS = {
  'pet.quiet': 'boolean', 'pet.allowWander': 'boolean', 'pet.lockPosition': 'boolean', 'pet.gaze': 'boolean', 'pet.gravity': 'boolean', 'pet.bounce': 'boolean', 'pet.idleActs': 'boolean',
  'pet.scale': 'number', 'pet.autoSleepMinutes': 'number', 'pet.alwaysOnTop': 'boolean', 'pet.visible': 'boolean',
  'tts.enabled': 'boolean', 'tts.autoSpeak': 'boolean', 'tts.volume': 'number', 'tts.rate': 'number',
  'planner.sedentary.enabled': 'boolean', 'planner.sedentary.minutes': 'number', 'planner.water.enabled': 'boolean', 'planner.water.minutes': 'number',
  'planner.bedtime.enabled': 'boolean', 'planner.bedtime.time': 'string', 'planner.morningBrief.enabled': 'boolean', 'planner.morningBrief.time': 'string',
  'planner.eveningReview.enabled': 'boolean', 'planner.eveningReview.time': 'string', 'planner.quietHours.enabled': 'boolean', 'planner.quietHours.start': 'string', 'planner.quietHours.end': 'string',
  'user.callName': 'string', 'ai.proactive': 'boolean', 'ai.autonomy': 'string', 'ai.touchReplies': 'boolean',
};

function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h\d|li|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

export async function fetchText(url, maxChars = 20000) {
  if (!/^https?:\/\//i.test(url)) throw new Error('只支持 http/https 网址');
  const res = await net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 MeihuaDesktop', Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(20000) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!/text|json|xml|javascript/.test(type)) return `（${type || '二进制'} 内容，未读取）`;
  const raw = await res.text();
  const text = /html/.test(type) ? htmlToText(raw) : raw;
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(raw)?.[1]?.trim();
  return `${title ? `标题：${title}\n` : ''}${text.slice(0, maxChars)}${text.length > maxChars ? '\n…（内容过长已截断）' : ''}`;
}

export function registerBuiltinTools() {
  // ---------------------------------------------------------- body
  registerTool({
    name: 'pet_action', group: 'pet',
    description: '控制你自己在桌面上的身体：移动位置、改变姿势或做小动作，可同时设置表情。walk_to 的 x 是当前屏幕横向位置 0（最左）~1（最右）。',
    input_schema: S({
      action: { type: 'string', enum: PET_ACTIONS },
      x: num('walk_to 的目标位置 0~1', { minimum: 0, maximum: 1 }),
      distance: num('walk_left/walk_right 的距离（像素）', { minimum: 20, maximum: 3000 }),
      side: { type: 'string', enum: ['left', 'right'], description: 'go_edge 的方向' },
      dir: { type: 'string', enum: ['left', 'right', 'up', 'down', 'cursor'], description: 'look 的方向' },
      emotion: str('同时切换的表情（可选）'),
    }, ['action']),
    label: (i) => ({ walk_to: '走过去', come: '走到你身边', sit: '坐下', sleep: '睡觉', stand: '站起来' }[i.action] || '动一动'),
    handler: async (i) => {
      if (!settings.get('pet.visible') && i.action !== 'wake') return '你现在被隐藏了，动作不会被看到。';
      broadcast('pet:action', { name: i.action, args: { x: i.x, distance: i.distance, side: i.side, dir: i.dir } });
      if (i.emotion) broadcast('pet:emotion', { name: i.emotion, hold: 5 });
      return { ok: true };
    },
  });

  // ---------------------------------------------------------- calendar
  registerTool({
    name: 'calendar_list', group: 'planner', description: '查询一段时间内的日程（会展开重复日程）。',
    input_schema: S({ from: str(`起始 ${DT}`), to: str(`结束（不含） ${DT}`) }, ['from', 'to']),
    label: () => '翻看日历',
    handler: (i) => {
      const list = planner.occurrences(i.from, i.to).slice(0, 100);
      return list.length ? list.map((o) => ({ id: o.id, title: o.title, start: o.occurrence, end: o.occEnd, allDay: o.allDay, location: o.location || undefined, notes: o.notes || undefined, recurring: o.recurring || undefined, remind: o.remind })) : '这段时间没有日程。';
    },
  });
  registerTool({
    name: 'calendar_add', group: 'planner', description: '新建日程。会在开始前按 remind（分钟数组，默认 [10]）提醒主人。',
    input_schema: S({
      title: str('标题', { maxLength: 200 }), start: str(`开始 ${DT}`), end: str(`结束 ${DT}（可选，默认 1 小时）`),
      location: str('地点（可选）'), notes: str('备注（可选）'), remind: { type: 'array', items: { type: 'number', minimum: 0 }, description: '提前多少分钟提醒，如 [30, 5]；不提醒用 []' },
      color: { type: 'string', enum: ['berry', 'mint', 'lav', 'honey', 'sky', 'ink'] }, recurrence: RECURRENCE,
    }, ['title', 'start']),
    label: (i) => `记下日程「${i.title || ''}」`,
    handler: (i) => { const ev = planner.addEvent(i, 'ai'); return { ok: true, id: ev.id, title: ev.title, when: human(ev.start), recurrence: ev.recurrence }; },
  });
  registerTool({
    name: 'calendar_update', group: 'planner', description: '修改日程（只传需要改的字段）。recurrence 传 null 取消重复。',
    input_schema: S({ id: str('日程 id'), title: str('标题'), start: str(`开始 ${DT}`), end: str(`结束 ${DT}`), location: str('地点'), notes: str('备注'), remind: { type: 'array', items: { type: 'number' } }, recurrence: { type: ['object', 'null'] } }, ['id']),
    label: () => '调整日程',
    handler: (i) => { const { id, ...patch } = i; const ev = planner.updateEvent(id, patch); return { ok: true, title: ev.title, when: human(ev.start) }; },
  });
  registerTool({
    name: 'calendar_delete', group: 'planner', description: '删除日程。对重复日程传 occurrence（YYYY-MM-DD）只删除那一次。',
    input_schema: S({ id: str('日程 id'), occurrence: str('只删除某一次（可选）') }, ['id']),
    label: () => '删除日程',
    confirm: (i) => {
      const ev = planner.events.data.events.find((e) => e.id === i.id);
      return ev ? { title: `删除日程「${ev.title}」${i.occurrence ? `（仅 ${i.occurrence} 这次）` : ''}？`, body: human(ev.start) } : null;
    },
    handler: (i) => planner.deleteEvent(i.id, { occurrence: i.occurrence }),
  });

  // ---------------------------------------------------------- todos
  registerTool({
    name: 'todo_list', group: 'planner', description: '查看待办事项。',
    input_schema: S({ status: { type: 'string', enum: ['open', 'done', 'all'] } }),
    label: () => '查看待办',
    handler: (i) => planner.listTodos(i.status || 'open').slice(0, 80).map((t) => ({ id: t.id, title: t.title, due: t.due || undefined, priority: t.priority || undefined, done: t.done || undefined, notes: t.notes || undefined, tags: t.tags?.length ? t.tags : undefined })),
  });
  registerTool({
    name: 'todo_add', group: 'planner', description: '新增待办。priority：0 普通 / 1 较重要 / 2 重要 / 3 紧急。',
    input_schema: S({ title: str('内容', { maxLength: 300 }), due: str(`截止 ${DT}（可选）`), priority: { type: 'integer', minimum: 0, maximum: 3 }, notes: str('备注'), tags: { type: 'array', items: { type: 'string' } } }, ['title']),
    label: (i) => `记下待办「${i.title || ''}」`,
    handler: (i) => { const t = planner.addTodo(i, 'ai'); return { ok: true, id: t.id, title: t.title, due: t.due ? human(t.due) : undefined }; },
  });
  registerTool({
    name: 'todo_update', group: 'planner', description: '修改待办或标记完成（done: true）。',
    input_schema: S({ id: str('待办 id'), title: str('内容'), done: { type: 'boolean' }, due: { type: ['string', 'null'] }, priority: { type: 'integer', minimum: 0, maximum: 3 }, notes: str('备注') }, ['id']),
    label: (i) => (i.done ? '勾掉一项待办' : '更新待办'),
    handler: (i) => { const { id, ...patch } = i; const t = planner.updateTodo(id, patch); return { ok: true, title: t.title, done: t.done }; },
  });
  registerTool({
    name: 'todo_delete', group: 'planner', description: '删除待办。',
    input_schema: S({ id: str('待办 id') }, ['id']),
    label: () => '删除待办',
    handler: (i) => planner.deleteTodo(i.id),
  });

  // ---------------------------------------------------------- reminders
  registerTool({
    name: 'reminder_add', group: 'planner', description: '在指定时间提醒主人（会弹出便签卡片并说出来）。repeat 可选 daily / weekdays / weekly / monthly / hourly。',
    input_schema: S({ text: str('提醒内容', { maxLength: 300 }), at: str('时间 YYYY-MM-DDTHH:mm'), repeat: { type: 'string', enum: ['daily', 'weekdays', 'weekly', 'monthly', 'hourly'] } }, ['text', 'at']),
    label: (i) => `设置提醒「${i.text || ''}」`,
    handler: (i) => { const r = planner.addReminder(i, 'ai'); return { ok: true, id: r.id, when: human(r.at), repeat: r.repeat?.freq }; },
  });
  registerTool({
    name: 'reminder_list', group: 'planner', description: '查看尚未触发的提醒。',
    input_schema: S({}),
    label: () => '查看提醒',
    handler: () => planner.listReminders().map((r) => ({ id: r.id, text: r.text, at: r.at, repeat: r.repeat?.freq })),
  });
  registerTool({
    name: 'reminder_cancel', group: 'planner', description: '取消提醒。',
    input_schema: S({ id: str('提醒 id') }, ['id']),
    label: () => '取消提醒',
    handler: (i) => planner.cancelReminder(i.id),
  });

  // ---------------------------------------------------------- routines
  registerTool({
    name: 'routine_add', group: 'planner',
    description: '创建例行任务：到了指定时间，你会收到 prompt 并自动执行（例如每个工作日 9:00 汇总待办、每周日晚上回顾一周）。days 为星期几数组（0=周日），省略表示每天。',
    input_schema: S({ name: str('名称'), time: str('HH:mm'), days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } }, prompt: str('到时你要做的事（写给你自己的指令）', { maxLength: 2000 }) }, ['name', 'time', 'prompt']),
    label: (i) => `创建例行任务「${i.name || ''}」`,
    confirm: (i) => ({ title: `创建例行任务「${i.name}」？`, body: `${i.days?.length ? '每周' + i.days.map((d) => '日一二三四五六'[d]).join('、') : '每天'} ${i.time}\n${i.prompt}` }),
    handler: (i) => { const r = planner.addRoutine(i); return { ok: true, id: r.id }; },
  });
  registerTool({
    name: 'routine_list', group: 'planner', description: '查看例行任务。', input_schema: S({}),
    label: () => '查看例行任务',
    handler: () => planner.routines.data.routines,
  });
  registerTool({
    name: 'routine_delete', group: 'planner', description: '删除例行任务。', input_schema: S({ id: str('id') }, ['id']),
    label: () => '删除例行任务',
    confirm: (i) => { const r = planner.routines.data.routines.find((x) => x.id === i.id); return r ? { title: `删除例行任务「${r.name}」？` } : null; },
    handler: (i) => planner.deleteRoutine(i.id),
  });

  // ---------------------------------------------------------- memory
  registerTool({
    name: 'memory_save', group: 'memory', description: '把关于主人的稳定信息记到长期记忆里（相似内容会自动合并）。',
    input_schema: S({ text: str('一条简洁的事实，如「主人对芒果过敏」', { maxLength: 500 }), category: { type: 'string', enum: CATS.filter((c) => c !== 'episode') } }, ['text']),
    label: () => '记在心里',
    handler: (i) => { const m = memory.save(i, 'ai'); return { ok: true, id: m.id, merged: !!m.merged }; },
  });
  registerTool({
    name: 'memory_search', group: 'memory', description: '在长期记忆中搜索相关内容（包括以前的对话回顾）。',
    input_schema: S({ query: str('关键词或问题') }, ['query']),
    label: () => '回忆一下',
    handler: (i) => { const r = memory.search(i.query, 10); return r.length ? r.map((m) => ({ id: m.id, text: m.text, category: m.category, date: new Date(m.createdAt).toLocaleDateString('zh-CN') })) : '没有找到相关记忆。'; },
  });
  registerTool({
    name: 'memory_forget', group: 'memory', description: '删除一条记忆（主人要求忘记时）。',
    input_schema: S({ id: str('记忆 id') }, ['id']),
    label: () => '忘掉一件事',
    handler: (i) => memory.forget(i.id),
  });

  // ---------------------------------------------------------- settings
  registerTool({
    name: 'settings_update', group: 'system',
    description: `按主人要求调整应用设置。可改的项：${Object.keys(SAFE_SETTINGS).join(', ')}。pet.scale 范围 0.18~0.8；时间格式 HH:mm；ai.autonomy 为 off/low/normal/high。`,
    input_schema: S({ path: { type: 'string', enum: Object.keys(SAFE_SETTINGS) }, value: { type: ['string', 'number', 'boolean'] } }, ['path', 'value']),
    label: () => '调整设置',
    handler: (i) => {
      const type = SAFE_SETTINGS[i.path];
      let v = i.value;
      if (type === 'boolean') v = v === true || v === 'true';
      if (type === 'number') { v = Number(v); if (!Number.isFinite(v)) throw new Error('需要数字'); }
      if (i.path === 'pet.scale') v = Math.min(0.8, Math.max(0.18, v));
      if (type === 'string' && /time|start|end/.test(i.path) && !/^\d{1,2}:\d{2}$/.test(String(v))) throw new Error('时间格式应为 HH:mm');
      if (i.path === 'ai.autonomy' && !['off', 'low', 'normal', 'high'].includes(v)) throw new Error('autonomy 只能是 off/low/normal/high');
      settings.set(i.path, v);
      return { ok: true, path: i.path, value: v };
    },
  });

  // ---------------------------------------------------------- system & web
  registerTool({
    name: 'system_info', group: 'system', description: '查询当前时间、屏幕信息等系统状态。', input_schema: S({}),
    label: () => '看看系统状态',
    handler: () => ({ now: nowContext(), displays: screen.getAllDisplays().map((d) => ({ size: `${d.size.width}x${d.size.height}`, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id })), platform: process.platform }),
  });
  registerTool({
    name: 'open_url', group: 'system', description: '用默认浏览器打开网址。', input_schema: S({ url: str('http(s) 网址') }, ['url']),
    label: () => '打开网页',
    confirm: (i) => ({ title: '用浏览器打开这个网址？', code: i.url }),
    handler: async (i) => { if (!/^https?:\/\//i.test(i.url)) throw new Error('只支持 http/https'); await shell.openExternal(i.url); return { ok: true }; },
  });
  registerTool({
    name: 'open_path', group: 'system', description: '用系统默认程序打开文件或文件夹。', input_schema: S({ path: str('本地绝对路径') }, ['path']),
    label: () => '打开文件',
    confirm: (i) => ({ title: '打开这个文件/文件夹？', code: i.path }),
    handler: async (i) => { if (!fs.existsSync(i.path)) throw new Error('路径不存在'); const err = await shell.openPath(i.path); if (err) throw new Error(err); return { ok: true }; },
  });
  registerTool({
    name: 'clipboard_read', group: 'system', description: '读取剪贴板里的文字（需要主人确认）。', input_schema: S({}),
    label: () => '看看剪贴板',
    confirm: () => ({ title: '让莓华读取剪贴板内容？' }),
    handler: () => clipboard.readText().slice(0, 20000) || '（剪贴板里没有文字）',
  });
  registerTool({
    name: 'clipboard_write', group: 'system', description: '把文字复制到剪贴板，方便主人粘贴。', input_schema: S({ text: str('要复制的文字') }, ['text']),
    label: () => '复制到剪贴板',
    handler: (i) => { clipboard.writeText(i.text); return { ok: true }; },
  });
  registerTool({
    name: 'web_fetch', group: 'system', description: '读取一个网页的正文文字（用于查资料、阅读主人给的链接）。', input_schema: S({ url: str('http(s) 网址') }, ['url']),
    label: () => '读网页',
    handler: (i) => fetchText(i.url),
  });
  registerTool({
    name: 'show_note', group: 'system', description: '在你头顶弹出一张便签卡片（用于需要主人留意的信息，例如步骤清单、要点）。',
    input_schema: S({ title: str('标题'), body: str('正文（纯文本）', { maxLength: 1200 }) }, ['title']),
    label: () => '写张便签',
    handler: (i) => { showCard({ kind: 'info', title: i.title, body: i.body, actions: [{ id: 'ok', label: '知道了', style: 'primary' }] }); return { ok: true }; },
  });
}
