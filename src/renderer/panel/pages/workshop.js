// 工坊: background agent tasks, laid out like a chat app. Left: the history of every task conversation (searchable,
// filtered by state, grouped by day). Right: a chat composer that hands a job to 莓华 directly — the first message
// becomes the task — or, with a task open, its live log (thoughts, tool calls with output, result, plan) with the
// same composer for follow-up instructions or to continue a finished task.
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { invoke, attempt, useRpc, useEvent, navigate, toast, confirmBox, patchSettings, Markdown, ago, fmtTime, portrait, startOfDay } from '../lib.js';
import { Seg, Empty, AutoTextarea, Dots } from '../kit.js';
import { InstallShelf } from '../installers.js';

export const STATUS = { running: '进行中', waiting: '等你确认', queued: '排队中', done: '完成', failed: '没完成', cancelled: '已取消', interrupted: '已中断', paused: '已暂停' };
const ACTIVE = ['running', 'waiting', 'queued'];
const RESUMABLE = ['failed', 'interrupted', 'paused', 'cancelled'];
const TOOL = {
  update_plan: ['更新计划', 'todo'], list_dir: ['查看目录', 'folder'], read_file: ['读取文件', 'note'], write_file: ['写入文件', 'edit'],
  edit_file: ['修改文件', 'edit'], glob: ['查找文件', 'search'], grep: ['搜索内容', 'search'], run_command: ['执行命令', 'code'],
  web_fetch: ['读取网页', 'external'], ask_user: ['询问主人', 'ask'],
};
export const PERMS = [
  { value: 'ask', label: '每步都问我', hint: '写文件、执行命令前都会先问你。' },
  { value: 'auto-edit', label: '自动改文件', hint: '工作目录里的文件直接改，执行命令前问你。' },
  { value: 'auto', label: '放手去做', hint: '除了有风险的命令，都不再询问。' },
];
const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'stopped', label: '未完成' },
];
const SUGGEST = [
  { label: '批量重命名照片', text: '帮我写一个脚本：把一个文件夹里的照片按拍摄日期重命名成「年-月-日_序号」，先给我看预览清单，确认后再执行。' },
  { label: '整理下载文件夹', text: '把「下载」文件夹里的文件按类型（文档、图片、压缩包、安装包、视频……）分到子文件夹里，重复的文件列出来给我确认，不要直接删除。' },
  { label: '做个番茄钟', text: '用一个 HTML 文件做一个好看的番茄钟小工具：25 分钟专注、5 分钟休息，有提示音和进度环，双击就能离线打开。' },
  { label: '调研写报告', text: '帮我调研「」这个主题，整理成一份 Markdown 报告：要点总结、优缺点对比、参考链接。' },
];

/** A short task name from the first line of a chat message. */
export function deriveTitle(text) {
  let t = String(text || '').trim().split(/\r?\n/).find((l) => l.trim()) || '';
  t = t.replace(/^(请你?|麻烦你?|帮我|帮忙|能不能|可以|你能|莓华[，,、]?)+/, '').replace(/^[，,、\s]+/, '');
  const cut = t.search(/[。！？!?；;]/);
  if (cut > 4) t = t.slice(0, cut);
  t = t.replace(/[。！？!?.,，；;：:]+$/, '').trim();
  if (t.length > 26) t = t.slice(0, 25) + '…';
  return t || '工坊任务';
}

const matches = (t, q) => !q || [t.title, t.brief, t.preview, t.result].some((s) => String(s || '').toLowerCase().includes(q));
const inFilter = (t, f) => f === 'all' || (f === 'active' ? ACTIVE.includes(t.status) : f === 'done' ? t.status === 'done' : !ACTIVE.includes(t.status) && t.status !== 'done');

function groupByDay(list) {
  const today = startOfDay(new Date()).getTime();
  const day = 86400000;
  const groups = [['今天', []], ['昨天', []], ['最近 7 天', []], ['本月更早', []], ['更早', []]];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  for (const t of list) {
    const at = t.updatedAt || t.createdAt || 0;
    const g = at >= today ? 0 : at >= today - day ? 1 : at >= today - 7 * day ? 2 : at >= monthStart ? 3 : 4;
    groups[g][1].push(t);
  }
  return groups.filter(([, items]) => items.length);
}

// ------------------------------------------------------------ history list
function History({ tasks, sel }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const query = q.trim().toLowerCase();
  const list = useMemo(() => (tasks || []).filter((t) => inFilter(t, filter) && matches(t, query)), [tasks, filter, query]);
  const counts = useMemo(() => {
    const all = tasks || [];
    return { active: all.filter((t) => ACTIVE.includes(t.status)).length };
  }, [tasks]);
  const remove = async (e, t) => {
    e.stopPropagation();
    if (await confirmBox({ title: '删除这条记录？', body: `删除「${t.title}」的对话记录？工作目录里的文件不会被删除。`, ok: '删除', danger: true })) {
      if (await attempt('agent.remove', t.id) && sel === t.id) navigate('workshop/new');
    }
  };
  return html`<aside class="shelf history">
    <button class=${`shelf-new ${sel === 'new' ? 'on' : ''}`} onClick=${() => navigate('workshop/new')}>${ICON.plus}<span>新对话 · 交代任务</span></button>
    <div class="hist-search">
      ${ICON.search}
      <input class="input" placeholder="搜索历史记录…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Escape') setQ(''); }} />
      ${q ? html`<button class="icon-btn small" title="清除" onClick=${() => setQ('')}>${ICON.close}</button>` : null}
    </div>
    <div class="hist-filters">${FILTERS.map((f) => html`<button class=${`chip ${filter === f.value ? 'on' : ''}`} onClick=${() => setFilter(f.value)}>${f.label}${f.value === 'active' && counts.active ? html`<em>${counts.active}</em>` : null}</button>`)}</div>
    <div class="shelf-list">
      ${tasks && !tasks.length ? html`<${Empty} icon="workshop" art="workshop" title="还没有历史记录" text="在右边的聊天栏里说说要做什么，莓华就会开工。" />` : null}
      ${tasks?.length && !list.length ? html`<div class="hist-none">${ICON.search}<span>没有找到${query ? `和「${q.trim()}」有关的` : '这类'}记录</span></div>` : null}
      ${groupByDay(list).map(([label, items]) => html`<div class="hist-group" key=${label}>
        <div class="hist-day">${label}<em>${items.length}</em></div>
        ${items.map((t) => {
          const done = t.plan.filter((p) => p.status === 'done').length;
          return html`<div key=${t.id} role="button" tabindex="0" class=${`shelf-item ${sel === t.id ? 'on' : ''}`}
              onClick=${() => navigate(`workshop/${t.id}`)} onKeyDown=${(e) => { if (e.key === 'Enter') navigate(`workshop/${t.id}`); }}>
            <span class="shelf-title">${t.title}</span>
            ${t.preview ? html`<span class="hist-preview">${t.preview}</span>` : null}
            <span class="shelf-meta"><span class=${`pill s-${t.status}`}>${t.status === 'running' ? html`<i class="spin-dot"></i>` : null}${STATUS[t.status] || t.status}</span>
              ${t.plan.length ? html`<span class="muted small">${done}/${t.plan.length}</span>` : null}
              <span class="muted small grow-right">${ago(t.updatedAt)}</span>
              <button class="icon-btn small hist-del" title="删除记录" onClick=${(e) => remove(e, t)}>${ICON.trash}</button></span>
          </div>`;
        })}
      </div>`)}
    </div>
  </aside>`;
}

// ------------------------------------------------------------ composer (shared by new chats and open tasks)
function Composer({ value, onChange, onSend, placeholder, icon = 'send', title = '发送', disabled, busy, autoFocus, foot }) {
  const box = useRef(null);
  useEffect(() => { if (autoFocus) setTimeout(() => box.current?.querySelector('textarea')?.focus(), 60); }, [autoFocus]);
  const send = () => { if (!disabled && !busy && value.trim()) onSend(value); };
  return html`<div class="composer slim ws-composer" ref=${box}>
    <div class="composer-box">
      <${AutoTextarea} value=${value} maxRows=${8} placeholder=${placeholder} onInput=${(e) => onChange(e.currentTarget.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); } }} />
      <button class="send" disabled=${disabled || busy || !value.trim()} onClick=${send} title=${title}>${busy ? html`<i class="spin-dot"></i>` : ICON[icon]}</button>
    </div>
    ${foot ? html`<div class="ws-composer-foot">${foot}</div>` : null}
  </div>`;
}

// ------------------------------------------------------------ new conversation: the first message becomes the task
function NewTask({ settings }) {
  const [text, setText] = useState(() => sessionStorage.getItem('ws-draft') || '');
  const [opts, setOpts] = useState({ open: false, title: '', workspace: '' });
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(null);
  useEffect(() => { invoke('ai.status').then((s) => setConfigured(!!s?.configured)).catch(() => setConfigured(null)); }, []);
  useEffect(() => { try { sessionStorage.setItem('ws-draft', text); } catch { /* ignore */ } }, [text]);
  const perm = settings.agent.permission || 'ask';
  const start = async (msg) => {
    const instructions = msg.trim();
    if (!instructions) return;
    setBusy(true);
    try {
      const t = await invoke('agent.start', { title: opts.title.trim() || deriveTitle(instructions), instructions, workspace: opts.workspace.trim() || undefined });
      setText(''); try { sessionStorage.removeItem('ws-draft'); } catch { /* ignore */ }
      navigate(`workshop/${t.id}`);
    } catch (err) {
      toast(err.message, 'error', 5000);
      if (/连接 AI|设置/.test(err.message)) navigate('settings/ai');
    } finally { setBusy(false); }
  };
  const title = text.trim() ? (opts.title.trim() || deriveTitle(text)) : '';
  return html`<div class="task ws-start">
    <div class="task-scroll ws-start-scroll">
      <div class="chat-empty ws-hello">
        <img src=${portrait} alt="" />
        <h3>想让莓华做点什么？</h3>
        <p>在下面直接说就好——第一句话就是任务。莓华会先列计划，再一步步在后台完成，进度会实时显示在这里。
          写脚本和小工具、批量整理文件、查资料写报告、给莓华自己做新扩展……都可以交给她。</p>
        <div class="chips">${SUGGEST.map((s) => html`<button class="chip" onClick=${() => setText(s.text)}>${ICON.sparkle}${s.label}</button>`)}</div>
      </div>
      ${configured === false ? html`<div class="banner">${ICON.key}<span>工坊需要先连接 AI 才能开工。</span><button class="btn small primary" onClick=${() => navigate('settings/ai')}>去连接</button></div>` : null}
      <${InstallShelf} />
      ${opts.open ? html`<div class="ws-opts">
        <label class="ws-opt"><span>任务名称</span><input class="input" placeholder=${title || '不填会从第一句话自动生成'} value=${opts.title} onInput=${(e) => setOpts({ ...opts, title: e.currentTarget.value })} /></label>
        <label class="ws-opt"><span>工作目录</span><input class="input mono" placeholder=${`不填会在 ${settings.agent.workspaceRoot || '文档\\MeihuaWorkshop'} 下新建`} value=${opts.workspace} onInput=${(e) => setOpts({ ...opts, workspace: e.currentTarget.value })} /></label>
        <div class="ws-opt"><span>权限</span><${Seg} small value=${perm} onChange=${(v) => patchSettings({ agent: { permission: v } })} options=${PERMS} /></div>
        <p class="hint">${PERMS.find((p) => p.value === perm)?.hint} 文件只能写在工作目录里。</p>
      </div>` : null}
    </div>
    <${Composer} value=${text} onChange=${setText} onSend=${start} busy=${busy} autoFocus icon="play" title="开工 (Enter)"
      placeholder="说说要做什么，越具体越好…（Enter 开工，Shift+Enter 换行）"
      foot=${html`<button class=${`link-btn ${opts.open ? 'on' : ''}`} onClick=${() => setOpts({ ...opts, open: !opts.open })}>${ICON.gear || ICON.edit}任务设置${opts.open ? '（收起）' : ''}</button>
        ${title ? html`<span class="muted small ws-title-preview">将创建：<b>${title}</b></span>` : html`<span class="muted small">权限：${PERMS.find((p) => p.value === perm)?.label}</span>`}`} />
  </div>`;
}

// ------------------------------------------------------------ one task conversation
function Step({ s, workspace }) {
  const [open, setOpen] = useState(false);
  if (s.kind === 'text') return html`<div class="step thought"><img class="mini-face" src=${portrait} alt="" /><div class="step-text">${s.text ? html`<${Markdown} text=${s.text} />` : html`<${Dots} />`}</div></div>`;
  if (s.kind === 'user') return html`<div class="step owner"><div class="bubble-me"><span class="plain">${s.text}</span></div></div>`;
  if (s.kind === 'result') {
    const files = s.files || [];
    return html`<div class="step result"><div class="result-head">${ICON.sparkle}总结</div><${Markdown} text=${s.text} />
      ${files.length ? html`<div class="result-files">${files.map((f) => {
        const abs = /^[a-zA-Z]:[\\/]|^\\\\/.test(f) ? f : `${workspace}\\${f.replace(/\//g, '\\')}`;
        return html`<button class="file-chip" title=${abs} onClick=${() => invoke('system.showItem', abs)}>${ICON.note}${f.split(/[\\/]/).pop()}</button>`;
      })}</div>` : null}
    </div>`;
  }
  if (s.kind === 'error') return html`<div class="step error">${ICON.warn}<span class="plain">${s.text}</span></div>`;
  if (s.kind === 'note') return html`<div class="step note"><span class="note-line">${ICON.clock || ICON.bell}<span>${s.text}</span></span></div>`;
  const [label, icon] = TOOL[s.tool] || [s.tool, 'tool'];
  return html`<div class=${`step tool ${s.status}`}>
    <button class="tool-line" onClick=${() => s.output && setOpen(!open)}>
      <span class="tool-ico">${s.status === 'running' ? html`<i class="spin-dot"></i>` : s.status === 'error' ? ICON.warn : ICON[icon]}</span>
      <span class="tool-name">${label}</span>
      <code class="tool-arg">${s.input}</code>
      <span class="muted small">${fmtTime(new Date(s.ts))}</span>
      ${s.output ? ICON[open ? 'down' : 'right'] : null}
    </button>
    ${open && s.output ? html`<pre class="tool-out">${s.output}</pre>` : null}
  </div>`;
}

function TaskView({ id }) {
  const [task, setTask] = useState(null);
  const [missing, setMissing] = useState(false);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef(null);
  const stick = useRef(true);

  useEffect(() => {
    setTask(null); setMissing(false); setMsg(''); stick.current = true;
    invoke('agent.get', id).then((t) => (t ? setTask(t) : setMissing(true))).catch(() => setMissing(true));
  }, [id]);
  const mine = (p) => p?.id === id;
  useEvent('agent:task', (sum) => { if (mine(sum)) setTask((t) => (t ? { ...t, ...sum, steps: t.steps } : t)); });
  useEvent('agent:step', (p) => { if (mine(p)) setTask((t) => { if (!t) return t; const steps = [...t.steps]; steps[p.index] = p.step; return { ...t, steps }; }); });
  useEvent('agent:delta', (p) => { if (mine(p)) setTask((t) => { if (!t) return t; const steps = [...t.steps]; const s = steps[p.index] || { kind: 'text', text: '', ts: Date.now() }; steps[p.index] = { ...s, text: (s.text || '') + p.text }; return { ...t, steps }; }); });
  useEvent('agent:step-update', (p) => { if (mine(p)) setTask((t) => { if (!t || !t.steps[p.index]) return t; const steps = [...t.steps]; steps[p.index] = { ...steps[p.index], ...p.patch }; return { ...t, steps }; }); });
  useEvent('agent:removed', (p) => { if (mine(p)) navigate('workshop/new'); });

  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [task]);

  if (missing) return html`<${Empty} icon="workshop" title="找不到这个任务" text="它可能已经被删除了。" />`;
  if (!task) return html`<div class="center pad"><${Dots} /></div>`;
  const active = ACTIVE.includes(task.status);
  const done = task.plan.filter((p) => p.status === 'done').length;
  const send = async (text) => {
    const t = text.trim();
    if (!t) return;
    stick.current = true;
    setSending(true);
    if (await attempt('agent.message', id, t)) setMsg('');
    setSending(false);
  };
  const remove = async () => {
    if (await confirmBox({ title: '删除任务记录', body: `删除「${task.title}」的记录？工作目录里的文件不会被删除。`, ok: '删除', danger: true })) attempt('agent.remove', id);
  };
  return html`<div class="task">
    <header class="task-head">
      <div class="task-title-row">
        <h2>${task.title}</h2>
        <span class=${`pill big s-${task.status}`}>${task.status === 'running' ? html`<i class="spin-dot"></i>` : null}${STATUS[task.status] || task.status}</span>
      </div>
      <div class="task-meta">
        <button class="path-chip" title="打开工作目录" onClick=${() => invoke('agent.openFolder', id)}>${ICON.folder}<span>${task.workspace}</span></button>
        <span class="muted small nowrap">${ago(task.createdAt)}开始 · ${task.steps.filter(Boolean).length} 步</span>
        <span class="grow"></span>
        ${active ? html`<button class="btn small" onClick=${() => attempt('agent.cancel', id)}>${ICON.stop}停止</button>` : null}
        ${RESUMABLE.includes(task.status) ? html`<button class="btn small primary" onClick=${() => { stick.current = true; attempt('agent.resume', id); }}>${ICON.play}继续</button>` : null}
        <button class="icon-btn small" title="删除记录" onClick=${remove}>${ICON.trash}</button>
      </div>
      ${task.status === 'waiting' ? html`<div class="banner warm">${ICON.bell}<span>莓华在等你确认 —— 看看右下角的便签夹或桌面上的便签。</span></div>` : null}
      ${['interrupted', 'paused'].includes(task.status) ? html`<div class="banner">${ICON.play}<span>${task.status === 'paused' ? '任务做了很多步，先停下来让你看看。' : '任务在中途被打断了（比如程序退出）。'}点「继续」会从停下的地方接着做。</span></div>` : null}
    </header>
    <div class="task-body">
      <div class="task-scroll" ref=${scroller} onScroll=${(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}>
        <div class="chat-time">${new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${task.source === 'chat' ? ' · 在聊天里交代的' : task.source === 'panel' ? ' · 在工坊交代的' : ''}</div>
        <div class="step owner"><div class="bubble-me brief-bubble"><span class="plain">${task.instructions}</span></div></div>
        ${task.steps.map((s, i) => html`<${Step} key=${i} s=${s} workspace=${task.workspace} />`)}
        ${task.status === 'running' && (!task.steps.length || task.steps[task.steps.length - 1]?.kind !== 'text') ? html`<div class="step thinking"><${Dots} /><span class="muted small">思考下一步…</span></div>` : null}
        ${task.status === 'queued' ? html`<div class="step thinking"><${Dots} /><span class="muted small">排队中，马上开始…</span></div>` : null}
      </div>
      <aside class="plan">
        <div class="plan-head">${ICON.todo}计划${task.plan.length ? html`<em>${done}/${task.plan.length}</em>` : null}</div>
        ${task.plan.length ? html`<div class="plan-bar"><i style=${`width:${Math.round((done / task.plan.length) * 100)}%`}></i></div>` : null}
        ${task.plan.length ? html`<ol class="plan-list">${task.plan.map((p) => html`<li class=${p.status}><span class="plan-mark">${p.status === 'done' ? ICON.check : p.status === 'in_progress' ? html`<i class="spin-dot"></i>` : null}</span><span>${p.text}</span></li>`)}</ol>`
          : html`<p class="muted small">莓华还没有列出计划。</p>`}
      </aside>
    </div>
    <${Composer} value=${msg} onChange=${setMsg} onSend=${send} busy=${sending} icon=${active ? 'send' : 'play'} title=${active ? '发送' : '继续任务'}
      placeholder=${active ? '补充说明，或回答莓华的问题…（Enter 发送）' : '还想改点什么？写下来让莓华接着做…（Enter 继续）'}
      foot=${html`<span class="muted small">${active ? '消息会在她做下一步之前送到。' : '发出后任务会带着之前的进度继续。'}</span>`} />
  </div>`;
}

export function WorkshopPage({ sub, settings }) {
  const { data: tasks } = useRpc('agent.list', [], ['agent:task', 'agent:removed']);
  // no task picked: show the one in progress if there is one, otherwise a fresh conversation
  const sel = sub || (tasks || []).find((t) => ACTIVE.includes(t.status))?.id || 'new';
  const perm = PERMS.find((p) => p.value === settings.agent.permission) || PERMS[0];
  const running = (tasks || []).filter((t) => ACTIVE.includes(t.status)).length;
  return html`<div class="workshop-page">
    <header class="page-head">
      <div><h1>工坊</h1><p class="sub">${running ? `${running} 个任务正在进行` : '在聊天栏里交代任务，莓华在后台替你完成电脑上的工作'}</p></div>
      <button class="perm-note" title="修改工坊权限" onClick=${() => navigate('settings/workshop')}>${ICON.shield}权限：${perm.label}</button>
    </header>
    <div class="workshop">
      <${History} tasks=${tasks} sel=${sel} />
      <div class="ws-main sheet flush">${sel === 'new' ? html`<${NewTask} settings=${settings} />` : html`<${TaskView} id=${sel} />`}</div>
    </div>
  </div>`;
}
