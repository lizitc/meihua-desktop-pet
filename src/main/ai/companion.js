// The companion: one ongoing conversation with tools, streamed to the character bubble
// and the notebook. History is append-only within a segment (frozen system prompt for
// prompt caching); per-turn state goes into a <context> block on the new user message.
// Long conversations are compacted into a summary that opens the next segment.
import { JsonStore, uid } from '../store.js';
import { dataFile } from '../paths.js';
import { bus, rpc, broadcast } from '../bus.js';
import { settings } from '../settings.js';
import { streamChat, isAbort, PRESETS, listModels, testConnection } from './providers.js';
import { aiConfig, isConfigured, keyName } from './config.js';
import { toolSpecs, runTool, toolLabel } from './tools.js';
import { buildSystemPrompt, directorPrompt, reactionPrompt, personaRev, DEFAULT_PERSONA, COMPACT_PROMPT, EMOTIONS, TAG_ACTIONS } from './persona.js';
import { TagParser, StageParser, stripTags, splitStage, stageCues } from './tags.js';
import { memory } from './memory.js';
import { planner } from '../planner/planner.js';
import { nowContext, inWindow } from '../planner/time.js';
import { approve } from '../notify.js';
import { createSpeaker, ttsActive, speak } from '../voice/tts.js';

const MAX_STEPS = 16;
const POSE_LABEL = { stand: '站着', sit: '坐着', sleep: '在睡觉' };

class Companion {
  constructor() {
    this.state = new JsonStore(dataFile('conversation.json'), { segment: null });
    this.log = new JsonStore(dataFile('chatlog.json'), { entries: [] });
    this.queue = Promise.resolve();
    this.current = null;            // { turnId, controller }
    this.pendingNotes = [];         // things said/done outside turns, reported in the next context
    this.petState = { pose: 'stand', mode: 'idle' };
    this.lastReaction = 0;
    this.lastUserAt = 0;
    this.skillsProvider = () => [];
    bus.on('pet:state', (st) => { this.petState = st; });
  }

  // ------------------------------------------------------------ segment / history
  get segment() {
    let seg = this.state.data.segment;
    if (!seg) {
      seg = { id: uid('seg_'), startedAt: Date.now(), system: buildSystemPrompt({ skills: this.skillsProvider() }), personaRev: personaRev(), messages: [], carry: '', memoryMark: Date.now() };
      this.state.data.segment = seg;
      this.state.save();
    } else if (seg.personaRev !== personaRev()) {
      // the character card changed (an app update or 设置 → 角色设定): she is the new self from the next reply on
      seg.system = buildSystemPrompt({ skills: this.skillsProvider() });
      seg.personaRev = personaRev();
      this.state.save();
    }
    return seg;
  }

  #newSegment(carry = '') {
    this.state.data.segment = { id: uid('seg_'), startedAt: Date.now(), system: buildSystemPrompt({ skills: this.skillsProvider() }), personaRev: personaRev(), messages: [], carry, memoryMark: Date.now() };
    this.state.save();
  }

  #needsCompaction(seg) {
    const limit = Math.max(10, settings.get('ai.historyLimit') || 60);
    if (seg.messages.length > limit * 2) return true;
    let chars = 0;
    for (const m of seg.messages) for (const b of Array.isArray(m.content) ? m.content : []) chars += (b.text?.length || 0) + (typeof b.content === 'string' ? b.content.length : 0) + (b.input ? JSON.stringify(b.input).length : 0);
    return chars > 160000;
  }

  async #compact(seg, cfg, signal) {
    let summary = '';
    try {
      await streamChat({ ...cfg, maxTokens: 1500 }, {
        system: seg.system,
        messages: [...seg.messages, { role: 'user', content: [{ type: 'text', text: COMPACT_PROMPT }] }],
        tools: toolSpecs(),
        signal,
      }, { onText: (d) => { summary += d; } });
    } catch (err) {
      if (isAbort(err)) throw err;
      console.warn('[companion] compaction failed, starting fresh:', err.message);
    }
    summary = stripTags(summary).text.trim();
    if (summary) { try { memory.save({ text: `对话回顾（${new Date().toLocaleDateString('zh-CN')}）：${summary.slice(0, 480)}`, category: 'episode' }, 'ai'); } catch { /* ignore */ } }
    this.#newSegment(summary);
  }

  // ------------------------------------------------------------ context
  #context() {
    const s = settings.get();
    const now = new Date();
    const quiet = s.planner.quietHours.enabled && inWindow(s.planner.quietHours.start, s.planner.quietHours.end, now);
    const lines = [`当前时间：${nowContext(now)}${quiet ? '（安静时段）' : ''}`];
    const ps = this.petState;
    lines.push(`你现在${POSE_LABEL[ps.pose] || '在桌面上'}${ps.mode && ps.mode !== 'idle' ? `（${ps.mode}）` : ''}${s.pet.quiet ? '，处于安静模式' : ''}${s.pet.visible ? '' : '，目前被隐藏了'}。`);
    const seg = this.segment;
    // the agenda is repeated only when it changed since the previous turn of this segment
    const agenda = planner.agendaText(now);
    if (agenda !== seg.lastAgenda || !seg.messages.length) { lines.push(agenda); seg.lastAgenda = agenda; }
    else lines.push('（日程、待办与提醒与上一条消息时相同）');
    const agentText = this.agentSummary?.();
    if (agentText) lines.push(agentText);
    const lifeText = this.lifeSummary?.();
    if (lifeText) lines.push(lifeText);
    const fresh = memory.items.filter((m) => m.createdAt > (seg.memoryMark || 0) && m.category !== 'episode');
    if (fresh.length) lines.push(`本次对话中新记住的事：\n${fresh.slice(-10).map((m) => `- ${m.text}`).join('\n')}`);
    if (this.pendingNotes.length) {
      lines.push(`自上次对话以来：\n${this.pendingNotes.slice(-8).map((n) => `- ${n}`).join('\n')}`);
      this.pendingNotes = [];
    }
    return lines.join('\n');
  }

  note(text) { this.pendingNotes.push(text); if (this.pendingNotes.length > 20) this.pendingNotes.shift(); }

  // ------------------------------------------------------------ chat log (what the notebook shows)
  #log(entry) {
    const e = { id: uid('c_'), ts: Date.now(), ...entry };
    const list = this.log.data.entries;
    list.push(e);
    if (list.length > 3000) list.splice(0, list.length - 3000);
    this.log.save(800);
    broadcast('chat:log', e);
    return e;
  }

  #updateLog(id, patch) {
    const e = this.log.data.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch);
    this.log.save(800);
    broadcast('chat:log-update', { id, patch });
  }

  // ------------------------------------------------------------ turns
  send({ text, source = 'panel', images = [] }) {
    const clean = String(text || '').trim();
    if (!clean && !images.length) throw new Error('消息是空的');
    if (!isConfigured()) throw new Error('还没有连接 AI 呢～请先在「手账 → 设置 → AI 连接」里填写接口和密钥。');
    this.lastUserAt = Date.now();
    bus.emit('chat:user', { source });
    const turnId = uid('t_');
    const userEntry = this.#log({ role: 'user', text: clean, source, images: images.map((i) => ({ media_type: i.media_type, name: i.name })) });
    const blocks = [];
    for (const img of images.slice(0, 4)) blocks.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
    this.queue = this.queue.then(() => this.#turn({ turnId, source, userText: clean, blocks, userEntry }));
    return { turnId };
  }

  /** A turn initiated by the app (routine, reminder follow-up, morning brief). */
  proactive(instruction, { source = 'routine', silentIfQuiet = true } = {}) {
    if (!isConfigured()) return null;
    const s = settings.get('planner.quietHours');
    if (silentIfQuiet && s.enabled && inWindow(s.start, s.end)) return null;
    const turnId = uid('t_');
    const text = `<event>（这是应用触发的事件，不是${settings.get('user.callName') || '主人'}说的话）${instruction}</event>`;
    this.queue = this.queue.then(() => this.#turn({ turnId, source, userText: text, blocks: [], proactive: true }));
    return { turnId };
  }

  async #turn({ turnId, source, userText, blocks, proactive = false, userEntry }) {
    const controller = new AbortController();
    this.current = { turnId, controller };
    const cfg = aiConfig('chat');
    bus.emit('activity:busy', true);
    broadcast('chat:start', { turnId, source, proactive });
    let seg = this.segment;
    const speaker = ttsActive() ? createSpeaker() : null;
    let fullText = '';
    const toolLog = [];
    const assistantEntry = this.#log({ role: 'assistant', text: '', source, proactive, streaming: true, turnId, tools: [] });
    let lengthBefore = seg.messages.length;
    try {
      if (this.#needsCompaction(seg)) {
        broadcast('chat:tool', { turnId, label: '整理之前的对话…' });
        await this.#compact(seg, cfg, controller.signal);
        seg = this.segment;
        lengthBefore = 0;
      }
      const carry = seg.carry && !seg.messages.length ? `<summary>之前对话的摘要：\n${seg.carry}\n</summary>\n` : '';
      const content = [...blocks, { type: 'text', text: `<context>\n${this.#context()}\n</context>\n${carry}\n${userText}` }];
      seg.messages.push({ role: 'user', content });
      const tools = toolSpecs();
      let sep = false;
      // bracketed body cues stay in the text, are not spoken, and play on the character
      const stage = new StageParser((t) => speaker?.push(t), (cue) => this.#playStage(cue));
      for (let step = 0; step < MAX_STEPS; step++) {
        const parser = new TagParser((t) => {
          if (sep && fullText) { fullText += '\n\n'; broadcast('chat:delta', { turnId, text: '\n\n' }); stage.push('\n'); }
          sep = false;
          fullText += t;
          broadcast('chat:delta', { turnId, text: t });
          stage.push(t);
        }, (kind, name) => {
          if (kind === 'e' && EMOTIONS.includes(name)) broadcast('pet:emotion', { name, hold: 6 });
          else if (kind === 'a' && TAG_ACTIONS.includes(name)) broadcast('pet:action', { name, args: {} });
        });
        const r = await streamChat(cfg, { system: seg.system, messages: seg.messages, tools, signal: controller.signal }, {
          onText: (d) => parser.push(d),
          onToolStart: (name) => broadcast('chat:tool', { turnId, label: toolLabel({ name, input: {} }) }),
          onRestart: () => { /* text already shown stays; the retry continues after it */ },
        });
        parser.flush();
        seg.messages.push({ role: 'assistant', content: r.content.map(({ __invalid, ...b }) => (__invalid ? { ...b, input: {} } : b)) });
        if (r.fallbackUsed) bus.emit('ai:fallback', r.model);
        if (r.stopReason === 'refusal') {
          const t = '（这个请求我没办法处理呢……换个说法试试？）';
          fullText += (fullText ? '\n\n' : '') + t;
          broadcast('chat:delta', { turnId, text: t });
          break;
        }
        const uses = r.content.filter((b) => b.type === 'tool_use');
        if (!uses.length) break;
        sep = true;
        const results = [];
        if (r.stopReason === 'max_tokens') {
          for (const u of uses) results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: '输出被截断（max_tokens），工具没有执行。请把内容拆小，分几步完成。' });
        } else {
          for (const u of uses) {
            const label = toolLabel(u);
            const rec = { name: u.name, label, status: 'running' };
            toolLog.push(rec);
            broadcast('chat:tool', { turnId, label });
            this.#updateLog(assistantEntry.id, { tools: toolLog.map((x) => ({ ...x })) });
            const res = await runTool(u, {
              source, turnId, signal: controller.signal,
              approve: (req) => approve({ ...req, source }),
            });
            rec.status = res.is_error ? 'error' : 'done';
            if (res.is_error) rec.error = String(res.content).slice(0, 200);
            results.push(res);
          }
          this.#updateLog(assistantEntry.id, { tools: toolLog.map((x) => ({ ...x })) });
        }
        seg.messages.push({ role: 'user', content: results });
        if (controller.signal.aborted) break;
      }
      stage.flush();
      speaker?.flush();
      this.state.save();
      this.#updateLog(assistantEntry.id, { text: fullText, streaming: false, tools: toolLog });
      broadcast('chat:done', { turnId, text: fullText });
      if (!fullText && !toolLog.length) this.#updateLog(assistantEntry.id, { text: '（……）' });
    } catch (err) {
      speaker?.cancel();
      // keep the conversation valid: drop the unfinished turn from the model history
      seg.messages.length = Math.min(seg.messages.length, lengthBefore);
      this.state.save();
      if (isAbort(err)) {
        this.#updateLog(assistantEntry.id, { text: fullText ? fullText + '\n\n（已停止）' : '（已停止）', streaming: false, tools: toolLog });
        broadcast('chat:done', { turnId, text: fullText });
      } else {
        const message = err?.message || String(err);
        console.warn('[companion] turn failed:', message);
        this.#updateLog(assistantEntry.id, { text: fullText, error: message, streaming: false, tools: toolLog });
        if (userEntry) this.#updateLog(userEntry.id, { failed: true });
        broadcast('chat:error', { turnId, message: proactive ? `（主动消息没有发出去：${message}）` : message });
      }
    } finally {
      if (this.current?.turnId === turnId) this.current = null;
      bus.emit('activity:busy', false);
    }
  }

  stop() { this.current?.controller.abort(); }

  // ------------------------------------------------------------ director & reactions (stateless)
  async #quick(system, user, { maxTokens = 300 } = {}) {
    const cfg = { ...aiConfig('chat'), maxTokens, effort: 'low' };
    let text = '';
    await streamChat(cfg, { system, messages: [{ role: 'user', content: [{ type: 'text', text: user }] }] }, { onText: (d) => { text += d; } });
    return text.trim();
  }

  /** Ask the model for a short behaviour plan. Returns { steps, next } or null. */
  async direct(env) {
    if (!isConfigured() || this.current) return null;
    const text = await this.#quick(directorPrompt(), `环境状态：\n${env}\n\n请给出行为计划 JSON。`, { maxTokens: 400 });
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return null;
    let plan;
    try { plan = JSON.parse(m[0]); } catch { return null; }
    const steps = (Array.isArray(plan.steps) ? plan.steps : []).slice(0, 5).filter((s) => s && ['action', 'emotion', 'say', 'wait'].includes(s.type));
    for (const s of steps) if (s.type === 'say') { s.text = stripTags(String(s.text || '')).text.slice(0, 60); }
    return { steps, next: Math.max(3, Math.min(30, Number(plan.next_check_minutes) || 8)) };
  }

  /** Whether an in-character reaction would be generated right now (feeding and check-in count as important). */
  canReact(important = false) {
    if (!isConfigured() || this.current || !settings.get('ai.touchReplies')) return false;
    return important || Date.now() - this.lastReaction >= 25000;
  }

  /** In-character one-liner for a touch / pat / being fed / check-in / level up (rate limited). */
  async react(event) {
    if (event?.silent) return;
    const important = ['feed', 'checkin', 'levelup'].includes(event.type);
    if (!this.canReact(important)) return;
    const now = Date.now();
    this.lastReaction = now;
    const what = {
      touch: `摸了摸你的${event.label || '身体'}`, pat: '温柔地摸了摸你的头',
      stroke: `轻轻地来回抚摸你的${event.label || '身体'}${event.count >= 6 ? '，已经摸了好一会儿了' : ''}`,
      pull: `拽了一下你的${event.part?.startsWith('ear') ? '耳朵' : event.part === 'tail' ? '尾巴' : event.part === 'skirt' ? '裙子' : '手'}`,
      feed: `喂你吃了${event.food || '点心'}${event.favorite ? '（你最喜欢的草莓系！）' : ''}，你正在吃，吃完饱食度 ${event.hunger ?? '?'}/100${event.hungerBefore != null && event.hungerBefore < 35 ? '（刚才你很饿）' : ''}`,
      checkin: `今天来和你签到了，已经连续 ${event.streak || 1} 天${event.gift ? `，还得到了礼物「${event.gift}」` : ''}`,
      levelup: `一直陪着你，你刚刚升到了 Lv.${event.level}${event.unlocked?.length ? `，解锁了新食物：${event.unlocked.join('、')}` : ''}`,
    }[event.type] || '戳了戳你';
    try {
      const raw = await this.#quick(reactionPrompt(), `（${nowContext()}；${this.lifeSummary?.() || ''}）${settings.get('user.callName') || '主人'}${what}。`, { maxTokens: 80 });
      const { text, tags } = stripTags(raw);
      const emo = tags.find(([k]) => k === 'e')?.[1];
      const line = text.replace(/^["“]|["”]$/g, '').trim().slice(0, 48);
      if (!line) return;
      // being fed: answer once she has finished chewing
      if (event.type === 'feed') await new Promise((r) => setTimeout(r, Math.max(0, 2700 - (Date.now() - now))));
      const { speech, stages } = splitStage(line);
      broadcast('pet:say', { text: line, emotion: EMOTIONS.includes(emo) ? emo : undefined });
      for (const c of stages) this.#playStage(c, { emotion: !emo });
      this.note(`主人${what}，你回应：「${line}」`);
      this.#log({ role: 'assistant', text: line, source: 'reaction', proactive: true });
      if (ttsActive() && speech) speak(speech).catch(() => {});
    } catch (err) {
      console.warn('[companion] reaction failed:', err.message);
    }
  }

  /** Lines spoken by the director are logged and remembered for the next turn. */
  said(text) {
    this.note(`你主动说过：「${text}」`);
    this.#log({ role: 'assistant', text, source: 'director', proactive: true });
    const { speech, stages } = splitStage(text);
    for (const c of stages) this.#playStage(c);
    if (ttsActive() && speech) speak(speech).catch(() => {});
  }

  /** A bracketed body cue from her reply, e.g. （耳朵轻轻抖了一下）: play the matching expression / action. */
  #playStage(text, { emotion = true } = {}) {
    const cue = stageCues(text);
    if (emotion && cue.emotion) broadcast('pet:emotion', { name: cue.emotion, hold: 5 });
    if (cue.action) broadcast('pet:action', { name: cue.action, args: {} });
  }

  // ------------------------------------------------------------ RPC
  registerRpc() {
    rpc('chat.send', (msg) => this.send(msg || {}));
    rpc('chat.stop', () => this.stop());
    rpc('chat.log', ({ before, limit = 80 } = {}) => {
      const list = this.log.data.entries;
      const end = before ? list.findIndex((e) => e.id === before) : list.length;
      return list.slice(Math.max(0, (end < 0 ? list.length : end) - limit), end < 0 ? list.length : end);
    });
    rpc('chat.clearLog', () => { this.log.data.entries = []; this.log.save(); broadcast('chat:cleared'); return true; });
    rpc('chat.newTopic', () => { this.#newSegment(''); broadcast('chat:cleared-context'); return true; });
    rpc('chat.status', () => ({ busy: !!this.current, configured: isConfigured(), model: aiConfig('chat').model, preset: aiConfig('chat').preset }));
    rpc('ai.presets', () => PRESETS);
    rpc('ai.personaDefault', () => DEFAULT_PERSONA);
    rpc('ai.setKey', (preset, key) => { settings.setSecret(keyName(preset), key ? String(key).trim() : ''); return true; });
    rpc('ai.hasKey', (preset) => settings.hasSecret(keyName(preset)));
    rpc('ai.models', async (override = {}) => {
      const base = aiConfig(override.kind || 'chat');
      const cfg = { ...base, ...override, apiKey: override.apiKey || settings.getSecret(keyName(override.preset || base.preset)) };
      return listModels(cfg);
    });
    rpc('ai.test', async (override = {}) => {
      const base = aiConfig(override.kind || 'chat');
      const cfg = { ...base, ...override, apiKey: override.apiKey || settings.getSecret(keyName(override.preset || base.preset)) };
      return testConnection(cfg);
    });
    rpc('pet.event', (ev) => { if (ev && typeof ev === 'object') this.react(ev); });
  }

  /**
   * Persona-level inputs changed (name, skills). An empty segment is rebuilt right away;
   * otherwise the change is told in the next context and applied at the next segment,
   * so the cached prefix of an ongoing conversation stays intact.
   */
  refreshSystem(note) {
    const seg = this.state.data.segment;
    if (!seg) return;
    if (!seg.messages.length) { seg.system = buildSystemPrompt({ skills: this.skillsProvider() }); this.state.save(); }
    else if (note) this.note(note);
  }

  flush() { this.state.flush(); this.log.flush(); }
}

export const companion = new Companion();
