// The workshop ("工坊"): background agent tasks in the spirit of Claude Code — it plans,
// reads and edits files inside a workspace, runs PowerShell commands, fetches web pages,
// asks the owner when blocked and reports progress that the chat can query.
import { app, shell } from 'electron';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { JsonStore, uid } from '../store.js';
import { dataFile, userDir } from '../paths.js';
import { bus, rpc, broadcast } from '../bus.js';
import { settings } from '../settings.js';
import { streamChat, isAbort, isContextError, isTransient } from '../ai/providers.js';
import { aiConfig, isConfigured } from '../ai/config.js';
import { validate, registerTool } from '../ai/tools.js';
import { showCard } from '../notify.js';
import { fetchText } from '../ai/builtin-tools.js';
import { resolveIn, glob, grep, listDir, readText } from './fsutil.js';
import { speak, ttsActive } from '../voice/tts.js';

const MAX_PARALLEL = 2;
const MAX_RETRIES = 6;          // transient API errors (429 / overload / 5xx / dropped connection) per turn
const MAX_NUDGES = 2;           // text-only replies without `finish` before the text is taken as the result
const HISTORY_BUDGET = 360000;  // characters of conversation before old tool output is compacted
const NUDGE = '（系统提示）你还没有调用 finish，任务仍在进行。还有没做完的步骤就继续调用工具推进，不要只用文字描述打算；需要主人决定时用 ask_user；如果已经全部完成，请调用 finish 提交总结。';
const RESUME = '（系统提示）任务从中断处继续。先回顾计划和已经完成的步骤（必要时重新检查文件状态），然后接着完成剩下的部分，最后调用 finish。';

/** Abortable sleep. */
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
  signal?.addEventListener('abort', onAbort, { once: true });
});
const DANGEROUS = /\b(format(-volume)?\s|diskpart|bcdedit|shutdown|Restart-Computer|Stop-Computer|reg(\.exe)?\s+delete|Remove-Item\b[^|;]*-Recurse[^|;]*\s([A-Za-z]:\\?\s*$|[A-Za-z]:\\\*|~|\$env:|\$HOME)|rm\s+-rf\s+[/~]|rd\s+\/s\s+\/q\s+[A-Za-z]:\\?\s*$|cipher\s+\/w|vssadmin|Set-ExecutionPolicy|Invoke-Expression\s*\(?\s*\(?New-Object\s+Net\.WebClient|iwr\b[^|]*\|\s*iex)/i;

const S = (properties, required = []) => ({ type: 'object', properties, required });
const TOOLS = [
  { name: 'update_plan', description: '更新任务计划清单（会显示给主人看）。items 为完整清单，status 取 pending/in_progress/done。', input_schema: S({ items: { type: 'array', maxItems: 20, items: S({ text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, ['text', 'status']) } }, ['items']) },
  { name: 'list_dir', description: '列出目录内容（depth 1~3）。路径可相对于工作目录。', input_schema: S({ path: { type: 'string' }, depth: { type: 'integer', minimum: 1, maximum: 3 } }) },
  { name: 'read_file', description: '读取文本文件，返回带行号的内容。大文件用 offset/limit 分段读。', input_schema: S({ path: { type: 'string' }, offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 4000 } }, ['path']) },
  { name: 'write_file', description: '创建或覆盖文件（自动创建目录）。只能写入工作目录内。', input_schema: S({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']) },
  { name: 'edit_file', description: '精确替换文件中的一段文字。old_string 必须在文件中唯一出现（或设置 replace_all）。', input_schema: S({ path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, ['path', 'old_string', 'new_string']) },
  { name: 'glob', description: '按通配符查找文件，如 **/*.py、src/**/*.{js,ts}。', input_schema: S({ pattern: { type: 'string' }, path: { type: 'string' } }, ['pattern']) },
  { name: 'grep', description: '在文件内容中搜索正则表达式，返回 文件:行号: 内容。', input_schema: S({ pattern: { type: 'string' }, path: { type: 'string' }, include: { type: 'string', description: '文件名通配，如 *.js' }, ignore_case: { type: 'boolean' } }, ['pattern']) },
  { name: 'run_command', description: '在 PowerShell 中执行命令（工作目录默认为任务目录）。返回退出码和输出。长时间运行的服务不要用它启动。', input_schema: S({ command: { type: 'string' }, cwd: { type: 'string' }, timeout_seconds: { type: 'integer', minimum: 5, maximum: 1800 } }, ['command']) },
  { name: 'web_fetch', description: '读取网页正文文字。', input_schema: S({ url: { type: 'string' } }, ['url']) },
  { name: 'ask_user', description: '向主人提问并等待回答（只在确实需要主人决定时使用）。options 可提供 2~4 个选项。', input_schema: S({ question: { type: 'string' }, options: { type: 'array', maxItems: 4, items: { type: 'string' } } }, ['question']) },
  { name: 'finish', description: '任务完成（或无法继续）时调用，给出中文总结：做了什么、产出文件、怎么使用、注意事项。', input_schema: S({ summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, success: { type: 'boolean' } }, ['summary']) },
];

function systemPrompt(task) {
  const name = settings.get('user.callName') || '主人';
  return `你是「莓华工坊」——御园莓华在后台替${name}完成电脑工作时的工作模式。你像一位细心可靠的工程师兼助理，独立把任务做完。

环境：Windows（${process.arch}），命令通过 PowerShell 执行。当前日期 ${new Date().toLocaleDateString('zh-CN')}。
任务工作目录：${task.workspace}
文件只能写在工作目录内；读取工作目录外的文件或执行命令可能需要${name}批准。

工作方法：
1. 先用 update_plan 列出 3～8 步计划，执行过程中保持更新（同一时间只有一项 in_progress）。
2. 先了解再动手：list_dir / glob / grep / read_file。
3. 修改已有文件优先用 edit_file 精确替换；新文件用 write_file。代码要完整可运行，不留 TODO 占位。
4. 能验证就验证：运行脚本或测试、检查输出，发现问题就修。
5. 只有在确实需要${name}做决定时才用 ask_user；能合理假设的就自己决定，并在总结里说明。
6. 完成后必须调用 finish，用简洁的中文写总结（做了什么、产出文件路径、如何使用、注意事项）。
7. 不做破坏性操作（批量删除、格式化、改系统设置等）；不读取与任务无关的隐私文件；不下载运行来路不明的程序。

为莓华制作扩展时，扩展放在 ${userDir('extensions')}\\<扩展id>\\ 下，包含：
- manifest.json：{"id","name","description","version":"1.0.0","tools":[{"name","description","input_schema"}]}
- main.mjs：ES 模块，为每个工具导出同名 async 函数 (input, ctx) => 结果（字符串或可 JSON 序列化对象）；ctx.fetch 可用于网络请求，ctx.log 打日志。只能使用 Node 内置模块。
扩展需要${name}在「手账 → 技能与扩展」里审核启用后才会生效。`;
}

class AgentManager {
  constructor() {
    this.index = new JsonStore(dataFile('agent-tasks.json'), { tasks: [] });
    this.live = new Map();   // id -> { controller, inbox: [], allowAll }
    this.queue = [];
    for (const t of this.index.data.tasks) if (['running', 'waiting', 'queued'].includes(t.status)) t.status = 'interrupted';
    this.index.save();
  }

  #file(id) { return path.join(userDir('data', 'agent'), `${id}.json`); }
  #load(id) { try { return JSON.parse(fs.readFileSync(this.#file(id), 'utf8')); } catch { return null; } }
  #saveFull(task) {
    const tmp = this.#file(task.id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(task));
    fs.renameSync(tmp, this.#file(task.id));
  }

  summary(t) {
    // the history list shows the latest line of the conversation and searches the brief too
    const flat = (s) => String(s || '').replace(/[#*`>\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    let last = null;
    for (let i = (t.steps?.length || 0) - 1; i >= 0 && !last; i--) { const s = t.steps[i]; if (s && s.text && (s.kind === 'text' || s.kind === 'result' || s.kind === 'user')) last = s; }
    const preview = last ? `${last.kind === 'user' ? '我：' : ''}${flat(last.text)}`.slice(0, 90) : flat(t.instructions).slice(0, 90);
    return {
      id: t.id, title: t.title, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, workspace: t.workspace, plan: t.plan || [],
      result: t.result || '', steps: t.stepCount || 0, source: t.source, preview, brief: flat(t.instructions).slice(0, 200),
    };
  }

  #publish(task, full = true) {
    task.updatedAt = Date.now();
    const i = this.index.data.tasks.findIndex((x) => x.id === task.id);
    const sum = this.summary(task);
    if (i >= 0) this.index.data.tasks[i] = sum; else this.index.data.tasks.unshift(sum);
    if (this.index.data.tasks.length > 200) this.index.data.tasks.length = 200;
    this.index.save(500);
    if (full) this.#saveFull(task);
    broadcast('agent:task', sum);
    const running = this.index.data.tasks.filter((t) => t.status === 'running' || t.status === 'waiting');
    broadcast('agent:status', { running: running.length, title: running[0]?.title || '' });
    bus.emit('activity:busy', running.length > 0);
  }

  #step(task, step) {
    const s = { ts: Date.now(), ...step };
    task.steps.push(s);
    task.stepCount = task.steps.length;
    broadcast('agent:step', { id: task.id, step: s, index: task.steps.length - 1 });
    return s;
  }

  // ---------------------------------------------------------- public API
  start({ title, instructions, workspace, source = 'chat' }) {
    if (!isConfigured('agent')) throw new Error('工坊还没有可用的模型，请先在设置里连接 AI。');
    const id = uid('job_');
    const slug = String(title || 'task').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'task';
    const root = settings.get('agent.workspaceRoot') || path.join(app.getPath('documents'), 'MeihuaWorkshop');
    const ws = workspace && path.isAbsolute(workspace) ? workspace : path.join(root, `${new Date().toISOString().slice(0, 10)}-${slug}`);
    fs.mkdirSync(ws, { recursive: true });
    const task = {
      id, title: String(title || '工坊任务').slice(0, 80), instructions: String(instructions || ''), workspace: ws, source,
      status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), plan: [], steps: [], stepCount: 0, result: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: `任务：${title}\n\n${instructions}` }] }],
    };
    this.#publish(task);
    this.queue.push(id);
    this.#pump();
    return this.summary(task);
  }

  message(id, text) {
    const live = this.live.get(id);
    if (live) {
      // the running loop owns the task object; the step goes into it so the next save keeps it
      live.inbox.push(String(text));
      this.#step(live.task, { kind: 'user', text });
      this.#publish(live.task, false);
      return { ok: true, delivered: 'queued-to-running-task' };
    }
    const task = this.#load(id);
    if (!task) throw new Error('找不到这个工坊任务');
    this.#pushUser(task, `主人补充说明：${text}`);
    this.#step(task, { kind: 'user', text });
    return this.#requeue(task);
  }

  /** Continue an interrupted, paused or failed task from where it stopped. */
  resume(id) {
    if (this.live.has(id) || this.queue.includes(id)) return { ok: true, delivered: 'already-running' };
    const task = this.#load(id);
    if (!task) throw new Error('找不到这个工坊任务');
    this.#pushUser(task, RESUME);
    this.#step(task, { kind: 'note', text: '继续任务' });
    return this.#requeue(task);
  }

  #requeue(task) {
    task.status = 'queued';
    this.#publish(task);
    if (!this.queue.includes(task.id)) this.queue.push(task.id);
    this.#pump();
    return { ok: true, delivered: 'resumed' };
  }

  /** Appends text to the conversation as the owner's turn (merged into a trailing user turn). */
  #pushUser(task, text) {
    const last = task.messages[task.messages.length - 1];
    if (last?.role === 'user') {
      if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content }];
      last.content.push({ type: 'text', text });
    } else task.messages.push({ role: 'user', content: [{ type: 'text', text }] });
  }

  /**
   * Makes the stored conversation valid again after an interruption: every tool_use gets a tool_result in the
   * next user turn (tool results first), consecutive user turns are merged and empty assistant turns filled.
   */
  #repair(task) {
    const msgs = task.messages;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (typeof m.content === 'string') m.content = [{ type: 'text', text: m.content }];
      if (m.role === 'user' && msgs[i - 1]?.role === 'user') {
        const prev = msgs[i - 1];
        const merged = [...prev.content, ...m.content];
        prev.content = [...merged.filter((b) => b.type === 'tool_result'), ...merged.filter((b) => b.type !== 'tool_result')];
        msgs.splice(i, 1); i -= 2; continue;
      }
      if (m.role !== 'assistant') continue;
      if (!m.content.length) m.content = [{ type: 'text', text: '（继续）' }];
      const ids = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
      let next = msgs[i + 1];
      if (ids.length && next?.role !== 'user') { next = { role: 'user', content: [] }; msgs.splice(i + 1, 0, next); }
      if (!next) continue;
      if (typeof next.content === 'string') next.content = [{ type: 'text', text: next.content }];
      const want = new Set(ids);
      const have = new Set(next.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id));
      const results = next.content.filter((b) => b.type === 'tool_result' && want.has(b.tool_use_id));
      for (const id of ids) if (!have.has(id)) results.push({ type: 'tool_result', tool_use_id: id, is_error: true, content: '任务被中断，这一步没有执行完。需要的话请重新执行。' });
      next.content = [...results, ...next.content.filter((b) => b.type !== 'tool_result')];
      if (!next.content.length) next.content = [{ type: 'text', text: '（继续）' }];
    }
  }

  /**
   * Keeps long tasks inside the context window: once the history grows past the budget, large tool outputs and
   * file bodies outside the most recent turns are cut down (the model can re-read files when needed). `level`
   * 1-2 compacts harder after the provider reported the context as full.
   */
  #compact(task, level = 0) {
    const msgs = task.messages;
    const budget = HISTORY_BUDGET / (1 + level);
    if (JSON.stringify(msgs).length < budget) return false;
    const keep = [16, 8, 4][Math.min(level, 2)];
    const cut = level >= 2 ? 200 : 400;
    const note = (n) => `\n…（较早的内容已压缩，原长 ${n} 字符；需要时请重新读取）`;
    const shrink = (s) => (typeof s === 'string' && s.length > cut + 200 ? s.slice(0, cut) + note(s.length) : s);
    for (let i = 1; i < msgs.length - keep; i++) {
      const m = msgs[i];
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          if (typeof b.content === 'string') b.content = shrink(b.content);
          else if (Array.isArray(b.content)) b.content = b.content.map((c) => (c.type === 'text' ? { ...c, text: shrink(c.text) } : c)).filter((c) => c.type === 'text');
        } else if (b.type === 'tool_use' && b.input && typeof b.input === 'object') {
          for (const k of ['content', 'new_string', 'old_string']) if (typeof b.input[k] === 'string') b.input[k] = shrink(b.input[k]);
        } else if (b.type === 'text' && m.role === 'assistant' && level) b.text = shrink(b.text);
      }
    }
    return true;
  }

  cancel(id) {
    const live = this.live.get(id);
    if (live) { live.controller.abort(); return true; }
    const qi = this.queue.indexOf(id);
    if (qi >= 0) this.queue.splice(qi, 1);
    const task = this.#load(id);
    if (task && !['done', 'failed', 'cancelled'].includes(task.status)) { task.status = 'cancelled'; this.#publish(task); }
    return true;
  }

  get(id) { return this.#load(id); }
  list() {
    // records from older versions lack the preview line: fill it in once from the stored task
    let changed = false;
    this.index.data.tasks = this.index.data.tasks.map((t) => {
      if (t.preview != null) return t;
      changed = true;
      const full = this.#load(t.id);
      return full ? { ...this.summary(full), status: t.status } : { ...t, preview: '', brief: '' };
    });
    if (changed) this.index.save(500);
    return this.index.data.tasks;
  }

  remove(id) {
    this.cancel(id);
    this.index.data.tasks = this.index.data.tasks.filter((t) => t.id !== id);
    this.index.save();
    try { fs.rmSync(this.#file(id), { force: true }); } catch { /* ignore */ }
    broadcast('agent:removed', { id });
    return true;
  }

  statusText() {
    const active = this.index.data.tasks.filter((t) => ['running', 'waiting', 'queued'].includes(t.status));
    const recent = this.index.data.tasks.filter((t) => ['done', 'failed', 'paused', 'interrupted'].includes(t.status) && Date.now() - t.updatedAt < 6 * 3600000).slice(0, 3);
    if (!active.length && !recent.length) return '';
    const fmt = (t) => {
      const cur = t.plan?.find((p) => p.status === 'in_progress');
      const done = t.plan?.filter((p) => p.status === 'done').length || 0;
      return `- 「${t.title}」[id:${t.id}] ${{ running: '进行中', waiting: '等待主人确认', queued: '排队中', done: '已完成', failed: '失败', paused: '已暂停（可继续）', interrupted: '已中断（可继续）' }[t.status]}${t.plan?.length ? `，进度 ${done}/${t.plan.length}` : ''}${cur ? `，正在：${cur.text}` : ''}`;
    };
    return `工坊任务：\n${[...active, ...recent].map(fmt).join('\n')}`;
  }

  // ---------------------------------------------------------- execution
  #pump() {
    while (this.live.size < MAX_PARALLEL && this.queue.length) {
      const id = this.queue.shift();
      const task = this.#load(id);
      if (!task) continue;
      this.#run(task).catch((err) => console.error('[agent]', err));
    }
  }

  async #run(task) {
    const controller = new AbortController();
    const live = { controller, inbox: [], allowAll: settings.get('agent.permission') === 'auto', task };
    this.live.set(task.id, live);
    task.status = 'running';
    this.#publish(task);
    const cfg = aiConfig('agent');
    const maxSteps = settings.get('agent.maxSteps') || 200;
    let finished = null;
    let paused = false;
    let nudges = 0, retries = 0, squeeze = 0;
    try {
      for (let i = 0; i < maxSteps && !finished; i++) {
        if (live.inbox.length) this.#pushUser(task, live.inbox.splice(0).map((t) => `主人补充说明：${t}`).join('\n'));
        this.#repair(task);
        this.#compact(task, squeeze);
        let textStep = null;
        let r;
        try {
          r = await streamChat(cfg, { system: systemPrompt(task), messages: task.messages, tools: TOOLS, signal: controller.signal }, {
            onText: (d) => {
              if (!textStep) textStep = this.#step(task, { kind: 'text', text: '' });
              textStep.text += d;
              broadcast('agent:delta', { id: task.id, index: task.steps.indexOf(textStep), text: d });
            },
            onRestart: () => { if (textStep) textStep.text += '\n'; },
          });
        } catch (err) {
          if (isAbort(err) || controller.signal.aborted) throw err;
          if (isContextError(err) && squeeze < 2) {
            squeeze++;
            this.#step(task, { kind: 'note', text: '对话太长了，压缩较早的记录后继续…' });
            i--; continue;
          }
          if (isTransient(err) && retries < MAX_RETRIES) {
            retries++;
            const wait = Math.min(60000, 3000 * 2 ** (retries - 1)) + Math.random() * 1000;
            this.#step(task, { kind: 'note', text: `${err.message}　${Math.round(wait / 1000)} 秒后自动重试（${retries}/${MAX_RETRIES}）` });
            this.#publish(task, false);
            await sleep(wait, controller.signal);
            i--; continue;
          }
          throw err;
        }
        retries = 0;
        task.messages.push({ role: 'assistant', content: r.content.map(({ __invalid, ...b }) => (__invalid ? { ...b, input: {} } : b)) });
        if (r.stopReason === 'refusal') { finished = { summary: '模型拒绝继续这个任务。', success: false }; break; }
        const uses = r.content.filter((b) => b.type === 'tool_use');
        if (!uses.length) {
          if (live.inbox.length) continue;
          const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          if (r.stopReason === 'max_tokens') {
            // cut off mid-reply: let it carry on instead of taking half a sentence as the result
            this.#pushUser(task, '（系统提示）上一条回复因为长度上限被截断了，请直接接着继续。写大文件时分成几次 write_file / edit_file。');
            continue;
          }
          if (nudges < MAX_NUDGES) {
            nudges++;
            this.#pushUser(task, NUDGE);
            this.#publish(task);
            continue;
          }
          finished = { summary: text || '任务结束。', success: true };
          break;
        }
        nudges = 0;
        const results = [];
        for (const u of uses) {
          if (r.stopReason === 'max_tokens') { results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: '输出被截断（max_tokens），工具没有执行。请把内容拆成更小的几次写入。' }); continue; }
          if (u.name === 'finish') {
            finished = { summary: String(u.input?.summary || ''), files: u.input?.files || [], success: u.input?.success !== false };
            results.push({ type: 'tool_result', tool_use_id: u.id, content: 'ok' });
            continue;
          }
          const step = this.#step(task, { kind: 'tool', tool: u.name, input: this.#brief(u), status: 'running' });
          this.#publish(task, false);
          const res = await this.#exec(task, live, u, controller.signal);
          step.status = res.is_error ? 'error' : 'done';
          step.output = String(res.content).slice(0, 1600);
          broadcast('agent:step-update', { id: task.id, index: task.steps.indexOf(step), patch: { status: step.status, output: step.output } });
          results.push(res);
        }
        task.messages.push({ role: 'user', content: results });
        this.#publish(task);
      }
      if (!finished) {
        paused = true;
        finished = { summary: `已经连续工作了 ${maxSteps} 步，先停下来让你看看进度。点「继续」我就接着做。`, success: false };
      }
      task.status = paused ? 'paused' : finished.success ? 'done' : 'failed';
      task.result = finished.summary;
      task.files = finished.files || [];
      this.#step(task, { kind: paused ? 'note' : 'result', text: finished.summary, files: task.files });
    } catch (err) {
      if (this.stopping) { task.status = 'interrupted'; this.#step(task, { kind: 'note', text: '程序退出，任务中断。下次打开后点「继续」就能接着做。' }); }
      else if (isAbort(err) || controller.signal.aborted) { task.status = 'cancelled'; this.#step(task, { kind: 'result', text: '任务已取消。' }); }
      else { task.status = 'failed'; task.result = err.message; this.#step(task, { kind: 'error', text: `${err.message}\n（可以点「继续」从这里接着做）` }); }
    } finally {
      this.live.delete(task.id);
      this.#publish(task);
      this.#pump();
    }
    if (['done', 'failed', 'paused'].includes(task.status)) this.#announce(task);
  }

  #announce(task) {
    const ok = task.status === 'done';
    const name = settings.get('user.callName') || '主人';
    bus.emit('agent:finished', task);
    const resumable = task.status !== 'done';
    showCard({
      kind: 'agent', label: ok ? '工坊任务完成' : task.status === 'paused' ? '工坊任务暂停了' : '工坊任务没能完成', title: task.title, body: (task.result || '').slice(0, 220),
      actions: [
        ...(resumable ? [{ id: 'resume', label: '继续', style: 'primary' }] : []),
        { id: 'open', label: '查看详情', style: resumable ? '' : 'primary' },
        ...(task.files?.length ? [{ id: 'folder', label: '打开文件夹' }] : []),
        { id: 'ok', label: '好的' },
      ],
    }, { system: true }).then((a) => {
      if (a === 'resume') { try { this.resume(task.id); } catch (err) { console.error('[agent] resume', err); } }
      if (a === 'open') bus.emit('panel:open', `workshop/${task.id}`);
      if (a === 'folder') shell.openPath(task.workspace);
    });
    if (ttsActive()) speak(ok ? `${name}，工坊的「${task.title}」做好啦。` : `${name}，「${task.title}」停下来了，需要你看一下。`).catch(() => {});
  }

  #brief(u) {
    const i = u.input || {};
    switch (u.name) {
      case 'run_command': return i.command;
      case 'read_file': case 'write_file': case 'edit_file': case 'list_dir': return i.path || '.';
      case 'glob': return i.pattern;
      case 'grep': return `${i.pattern}${i.include ? ` (${i.include})` : ''}`;
      case 'web_fetch': return i.url;
      case 'update_plan': return `${(i.items || []).length} 项`;
      case 'ask_user': return i.question;
      default: return JSON.stringify(i).slice(0, 160);
    }
  }

  async #approve(task, live, title, code) {
    if (live.allowAll) return true;
    task.status = 'waiting';
    this.#publish(task, false);
    const a = await showCard({
      kind: 'approval', label: `工坊 · ${task.title}`, title, code,
      actions: [{ id: 'allow', label: '允许', style: 'primary' }, { id: 'all', label: '本任务都允许' }, { id: 'deny', label: '拒绝', style: 'danger' }],
      dismissible: false,
    }, { timeoutMs: 30 * 60 * 1000 });
    task.status = 'running';
    this.#publish(task, false);
    if (a === 'all') { live.allowAll = true; return true; }
    return a === 'allow';
  }

  async #exec(task, live, u, signal) {
    const tool = TOOLS.find((t) => t.name === u.name);
    const fail = (m) => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: m });
    if (!tool) return fail(`未知工具 ${u.name}`);
    if (u.__invalid) return fail(JSON.stringify({ INVALID_JSON: String(u.input?.__raw || '').slice(0, 300) }));
    const input = u.input || {};
    const errs = validate(tool.input_schema, input);
    if (errs.length) return fail(`参数不合法：${errs.join('；')}`);
    const ok = (c) => ({ type: 'tool_result', tool_use_id: u.id, content: typeof c === 'string' ? c : JSON.stringify(c) });
    const perm = settings.get('agent.permission') || 'ask';
    const root = task.workspace;
    try {
      switch (u.name) {
        case 'update_plan':
          task.plan = input.items.map((x) => ({ text: String(x.text).slice(0, 200), status: x.status }));
          this.#publish(task, false);
          return ok('计划已更新');
        case 'list_dir': {
          const { abs, inside } = resolveIn(root, input.path || '.');
          if (!inside && perm !== 'auto' && !(await this.#approve(task, live, '查看工作目录以外的文件夹？', abs))) return fail('主人没有允许');
          return ok(listDir(abs, input.depth || 1).join('\n') || '（空目录）');
        }
        case 'read_file': {
          const { abs, inside } = resolveIn(root, input.path);
          if (!inside && perm !== 'auto' && !(await this.#approve(task, live, '读取工作目录以外的文件？', abs))) return fail('主人没有允许');
          return ok(readText(abs, { offset: input.offset, limit: input.limit }));
        }
        case 'write_file': case 'edit_file': {
          const { abs, inside } = resolveIn(root, input.path);
          const extRoot = userDir('extensions');
          const inExt = resolveIn(extRoot, abs).inside;
          if (!inside && !inExt) return fail(`只能写入工作目录（${root}）或扩展目录内。`);
          if (perm === 'ask' && !(await this.#approve(task, live, u.name === 'write_file' ? '写入文件？' : '修改文件？', abs))) return fail('主人没有允许');
          if (u.name === 'write_file') {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, input.content);
            return ok(`已写入 ${abs}（${input.content.length} 字符）`);
          }
          const src = fs.readFileSync(abs, 'utf8');
          const count = src.split(input.old_string).length - 1;
          if (!count) return fail('old_string 在文件中没有找到，请先 read_file 确认原文（注意空格与换行）。');
          if (count > 1 && !input.replace_all) return fail(`old_string 出现了 ${count} 次，请提供更多上下文让它唯一，或设置 replace_all。`);
          const next = input.replace_all ? src.split(input.old_string).join(input.new_string) : src.replace(input.old_string, () => input.new_string);
          fs.writeFileSync(abs, next);
          return ok(`已修改 ${abs}（替换 ${input.replace_all ? count : 1} 处）`);
        }
        case 'glob': {
          const { abs } = resolveIn(root, input.path || '.');
          const r = glob(abs, input.pattern);
          return ok(r.length ? r.join('\n') : '没有匹配的文件');
        }
        case 'grep': {
          const { abs } = resolveIn(root, input.path || '.');
          const r = grep(abs, input.pattern, { include: input.include, ignoreCase: input.ignore_case });
          return ok(r.length ? r.join('\n') : '没有匹配');
        }
        case 'run_command': {
          const cwd = input.cwd ? resolveIn(root, input.cwd).abs : root;
          const dangerous = DANGEROUS.test(input.command);
          const needAsk = dangerous || perm !== 'auto';
          if (needAsk) {
            // risky commands always ask, even after "allow all for this task"
            const okd = await this.#approve(task, dangerous ? { allowAll: false } : live, dangerous ? '⚠ 这条命令可能有风险，确定要执行吗？' : '执行命令？', `${cwd}\n> ${input.command}`);
            if (!okd) return fail('主人没有允许执行这条命令');
          }
          const r = await runPowerShell(input.command, { cwd, timeout: (input.timeout_seconds || settings.get('agent.commandTimeout') || 180) * 1000, signal });
          return ok(`退出码：${r.code}${r.timedOut ? '（超时被终止）' : ''}\n${r.output || '（无输出）'}`);
        }
        case 'web_fetch': return ok(await fetchText(input.url, 30000));
        case 'ask_user': {
          task.status = 'waiting';
          this.#publish(task, false);
          const opts = (input.options || []).slice(0, 4);
          const a = await showCard({ kind: 'question', label: `工坊 · ${task.title}`, title: input.question, actions: [...opts.map((o, i) => ({ id: `opt${i}`, label: o, style: i === 0 ? 'primary' : '' })), { id: 'skip', label: '你决定吧' }], dismissible: false });
          task.status = 'running';
          this.#publish(task, false);
          const pending = live.inbox.splice(0);
          if (pending.length) return ok(`主人回答：${pending.join('\n')}`);
          if (a.startsWith('opt')) return ok(`主人选择了：${opts[Number(a.slice(3))]}`);
          return ok('主人让你自己判断，请按最合理的方式继续，并在总结里说明。');
        }
        default: return fail('未实现');
      }
    } catch (err) {
      return fail(err.message || String(err));
    }
  }

  registerRpc() {
    rpc('agent.list', () => this.list());
    // a running task is read from memory so the snapshot matches the event stream exactly
    rpc('agent.get', (id) => { const t = this.live.get(id)?.task || this.#load(id); if (!t) return null; const { messages, ...rest } = t; return rest; });
    rpc('agent.start', (spec) => this.start({ ...spec, source: 'panel' }));
    rpc('agent.message', (id, text) => this.message(id, text));
    rpc('agent.resume', (id) => this.resume(id));
    rpc('agent.cancel', (id) => this.cancel(id));
    rpc('agent.remove', (id) => this.remove(id));
    rpc('agent.openFolder', (id) => { const t = this.#load(id); if (t) shell.openPath(t.workspace); return true; });
  }

  registerChatTools() {
    registerTool({
      name: 'agent_start', group: 'agent',
      description: '在「工坊」里启动一个后台任务，由工坊模式的你自主完成多步骤的电脑工作（写代码、整理文件、调研写报告、制作扩展等）。instructions 要写清目标、范围、交付物和偏好。workspace 可指定已有文件夹的绝对路径（可选，默认新建）。',
      input_schema: S({ title: { type: 'string', maxLength: 80 }, instructions: { type: 'string' }, workspace: { type: 'string' } }, ['title', 'instructions']),
      label: (i) => `开启工坊任务「${i.title || ''}」`,
      confirm: (i) => (settings.get('agent.permission') === 'auto' ? null : { title: `开启工坊任务「${i.title}」？`, body: String(i.instructions || '').slice(0, 400), code: i.workspace || undefined }),
      handler: (i) => { const t = this.start({ ...i, source: 'chat' }); return { ok: true, id: t.id, workspace: t.workspace }; },
    });
    registerTool({
      name: 'agent_status', group: 'agent', description: '查看工坊任务的进度与结果。不传 id 则列出最近的任务。',
      input_schema: S({ id: { type: 'string' } }),
      label: () => '看看工坊进度',
      handler: (i) => {
        if (!i.id) return this.list().slice(0, 10).map((t) => ({ id: t.id, title: t.title, status: t.status, plan: t.plan, result: t.result?.slice(0, 300) }));
        const t = this.#load(i.id);
        if (!t) throw new Error('找不到这个任务');
        const recent = t.steps.slice(-8).map((s) => (s.kind === 'tool' ? `[${s.tool}] ${s.input || ''} → ${s.status}` : `${s.kind}: ${String(s.text || '').slice(0, 200)}`));
        return { id: t.id, title: t.title, status: t.status, workspace: t.workspace, plan: t.plan, recent, result: t.result, files: t.files };
      },
    });
    registerTool({
      name: 'agent_resume', group: 'agent', description: '让中断、暂停或失败的工坊任务从停下的地方继续。',
      input_schema: S({ id: { type: 'string' } }, ['id']),
      label: () => '让工坊继续',
      handler: (i) => this.resume(i.id),
    });
    registerTool({
      name: 'agent_message', group: 'agent', description: '给工坊任务补充说明或新要求；已结束的任务会带着新要求继续。',
      input_schema: S({ id: { type: 'string' }, message: { type: 'string' } }, ['id', 'message']),
      label: () => '给工坊捎句话',
      handler: (i) => this.message(i.id, i.message),
    });
    registerTool({
      name: 'agent_cancel', group: 'agent', description: '取消工坊任务。',
      input_schema: S({ id: { type: 'string' } }, ['id']),
      label: () => '取消工坊任务',
      handler: (i) => ({ ok: this.cancel(i.id) }),
    });
  }

  stopAll() {
    this.stopping = true;
    for (const l of this.live.values()) { l.task.status = 'interrupted'; this.#saveFull(l.task); l.controller.abort(); }
    for (const t of this.index.data.tasks) if (['running', 'waiting', 'queued'].includes(t.status)) t.status = 'interrupted';
    this.index.flush();
  }
}

/** Run a PowerShell command with UTF-8 output, timeout and abort support. */
export function runPowerShell(command, { cwd, timeout = 180000, signal } = {}) {
  return new Promise((resolve) => {
    const prelude = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8;$ProgressPreference="SilentlyContinue";';
    // stdin must not stay an open pipe: Windows PowerShell 5.1 waits on it and never exits
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', prelude + command], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let out = '';
    let timedOut = false;
    const add = (d) => { if (out.length < 200000) out += d.toString('utf8'); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const kill = () => { try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {}); } catch { child.kill(); } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    const onAbort = () => kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => { out += `\n[启动失败] ${err.message}`; });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const text = out.length > 24000 ? `${out.slice(0, 8000)}\n…（中间省略 ${out.length - 20000} 字符）…\n${out.slice(-12000)}` : out;
      resolve({ code, output: text.trim(), timedOut });
    });
  });
}

export const agents = new AgentManager();
