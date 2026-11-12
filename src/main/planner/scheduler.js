// Time-driven work: reminders, event alerts, routines, daily briefs, wellbeing nudges
// (sedentary / water / bedtime) and the AI behaviour director.
import { powerMonitor } from 'electron';
import { JsonStore } from '../store.js';
import { dataFile } from '../paths.js';
import { bus, rpc, broadcast } from '../bus.js';
import { settings } from '../settings.js';
import { planner } from './planner.js';
import { parseLocal, fmtDate, fmtTime, hm, minutesNow, inWindow, human, startOfDay, addDays, nowContext } from './time.js';
import { showCard } from '../notify.js';
import { companion } from '../ai/companion.js';
import { isConfigured } from '../ai/config.js';
import { speak, ttsActive } from '../voice/tts.js';

const TICK = 15000;

class Scheduler {
  constructor() {
    this.state = new JsonStore(dataFile('scheduler.json'), { fired: {}, daily: {}, active: 0, water: 0 });
    this.showing = new Set();
    this.nextDirector = Date.now() + 90 * 1000;
    this.lastTick = Date.now();
  }

  start() {
    this.timer = setInterval(() => this.tick().catch((err) => console.error('[scheduler]', err)), TICK);
    setTimeout(() => this.tick().catch(() => {}), 4000);
    bus.on('planner:changed', () => setTimeout(() => this.tick().catch(() => {}), 300));
    powerMonitor.on('resume', () => { this.state.data.active = 0; });
    rpc('pet.said', (text) => { if (typeof text === 'string' && text) companion.said(text.slice(0, 120)); });
    rpc('scheduler.brief', () => this.#morningBrief(true));
  }

  stop() { clearInterval(this.timer); this.state.flush(); }

  #quiet(now = new Date()) {
    const q = settings.get('planner.quietHours');
    return q.enabled && inWindow(q.start, q.end, now);
  }

  #say(text) {
    if (ttsActive()) speak(text).catch(() => {});
  }

  async tick() {
    const now = new Date();
    const elapsed = Math.min(5 * 60000, Date.now() - this.lastTick);
    this.lastTick = Date.now();
    const idle = powerMonitor.getSystemIdleTime();
    this.#reminders(now);
    this.#eventAlerts(now);
    this.#routines(now, idle);
    this.#daily(now, idle);
    this.#wellbeing(now, idle, elapsed);
    await this.#director(now, idle);
    this.#prune();
  }

  // ---------------------------------------------------------- reminders
  #reminders(now) {
    const name = settings.get('user.callName') || '主人';
    for (const r of planner.listReminders()) {
      const at = parseLocal(r.at);
      if (!at || at > now || this.showing.has(r.id)) continue;
      this.showing.add(r.id);
      const late = now - at > 10 * 60000;
      showCard({
        id: `rem:${r.id}`, kind: 'reminder', title: r.text, meta: late ? `${human(r.at)}（错过了）` : fmtTime(at),
        actions: [{ id: 'done', label: '好的', style: 'primary' }, { id: 'snooze10', label: '10 分钟后' }, { id: 'snooze30', label: '30 分钟后' }],
      }, { system: true }).then((action) => {
        this.showing.delete(r.id);
        if (action === 'snooze10') planner.snoozeReminder(r.id, 10);
        else if (action === 'snooze30') planner.snoozeReminder(r.id, 30);
        else if (action !== 'replaced') planner.completeReminder(r.id);
      });
      this.#say(`${name}，${r.text}`);
      companion.note(`提醒了主人：「${r.text}」`);
    }
  }

  #eventAlerts(now) {
    const fired = this.state.data.fired;
    const occ = planner.occurrences(addDays(startOfDay(now), -1), addDays(now, 2));
    for (const o of occ) {
      const start = parseLocal(o.occurrence);
      // all-day items get one nudge at 09:00 that day; timed ones per remind offset
      const offsets = o.allDay ? (o.remind?.length ? [0] : []) : (o.remind || []);
      for (const mins of offsets) {
        let fireAt;
        if (o.allDay) { fireAt = new Date(start); fireAt.setHours(9, 0, 0, 0); }
        else fireAt = new Date(start.getTime() - mins * 60000);
        const key = `${o.id}@${o.occurrence}#${mins}`;
        if (fired[key] || fireAt > now || now - fireAt > 15 * 60000) continue;
        fired[key] = Date.now();
        this.state.save();
        const left = Math.round((start - now) / 60000);
        const meta = o.allDay ? '今天' : left > 0 ? `${left} 分钟后开始` : '现在开始';
        showCard({ id: `ev:${key}`, kind: 'reminder', label: '日程', title: o.title, meta, body: [o.allDay ? '全天' : `${fmtTime(start)}${o.occEnd ? ' - ' + fmtTime(parseLocal(o.occEnd)) : ''}`, o.location, o.notes].filter(Boolean).join(' · '), actions: [{ id: 'ok', label: '知道了', style: 'primary' }] }, { system: true });
        const name = settings.get('user.callName') || '主人';
        this.#say(o.allDay ? `${name}，今天有${o.title}哦。` : left > 1 ? `${name}，${left}分钟后有${o.title}。` : `${name}，${o.title}要开始啦。`);
        companion.note(`提醒了主人日程「${o.title}」（${meta}）`);
      }
    }
  }

  // ---------------------------------------------------------- routines & daily
  #routines(now, idle) {
    const today = fmtDate(now);
    const n = minutesNow(now);
    for (const r of planner.routines.data.routines) {
      if (!r.enabled || r.lastRun === today) continue;
      if (r.days && !r.days.includes(now.getDay())) continue;
      const t = hm(r.time);
      if (n < t || n > t + 180) continue;               // within 3 h after the time (e.g. PC was asleep)
      if (n > t + 2 && idle > 600) continue;             // late and nobody here: wait until they're back
      planner.updateRoutine(r.id, { lastRun: today });
      if (isConfigured()) companion.proactive(`例行任务「${r.name}」时间到了。请执行：${r.prompt}`, { source: 'routine', silentIfQuiet: false });
      else showCard({ kind: 'info', label: '例行任务', title: r.name, body: r.prompt, actions: [{ id: 'ok', label: '知道了', style: 'primary' }] });
    }
  }

  #dueDaily(key, time, now, idle, windowMin = 180) {
    const d = this.state.data.daily;
    const today = fmtDate(now);
    if (d[key] === today) return false;
    const n = minutesNow(now), t = hm(time);
    if (n < t || n > t + windowMin) return false;
    if (idle > 300) return false;                         // wait until the owner is at the computer
    d[key] = today;
    this.state.save();
    return true;
  }

  #daily(now, idle) {
    const p = settings.get('planner');
    if (p.morningBrief.enabled && this.#dueDaily('morning', p.morningBrief.time, now, idle)) this.#morningBrief(false);
    if (p.eveningReview.enabled && this.#dueDaily('evening', p.eveningReview.time, now, idle)) {
      if (isConfigured()) companion.proactive('现在是晚上回顾时间。请看看今天完成了哪些待办、还有什么没做完，温柔地陪主人复盘一下今天，并问问明天有没有需要提前安排的事。简短一些。', { source: 'review', silentIfQuiet: false });
    }
    if (p.bedtime.enabled && this.#dueDaily('bedtime', p.bedtime.time, now, idle, 120)) {
      const name = settings.get('user.callName') || '主人';
      if (isConfigured()) companion.proactive(`到了主人设定的就寝时间（${p.bedtime.time}）。用一两句话温柔地提醒主人该休息了，可以配合 [e:sleepy] 和 [a:sit]。`, { source: 'bedtime', silentIfQuiet: false });
      else { showCard({ kind: 'reminder', label: '休息', title: '该准备睡觉啦', body: `${name}，已经 ${p.bedtime.time} 了，早点休息吧～`, actions: [{ id: 'ok', label: '好～', style: 'primary' }] }); this.#say(`${name}，该准备睡觉啦。`); }
    }
  }

  #morningBrief(force) {
    const t = planner.today();
    if (isConfigured()) {
      companion.proactive(`现在是新一天的开始（${nowContext()}）。请给主人做一份简短可爱的今日简报：问候、今天的日程（按时间）、最要紧的 1～3 个待办，以及一句贴心的话。如果今天没有安排，就轻松地打个招呼并问问今天的计划。`, { source: 'brief', silentIfQuiet: !force });
      return true;
    }
    const lines = [];
    if (t.events.length) lines.push(...t.events.slice(0, 6).map((o) => `· ${o.allDay ? '全天' : fmtTime(parseLocal(o.occurrence))} ${o.title}`));
    else lines.push('· 今天没有日程');
    const todos = t.todos.slice(0, 3);
    if (todos.length) lines.push('', '要紧的待办：', ...todos.map((x) => `· ${x.title}`));
    showCard({ kind: 'info', label: '今日简报', title: `早上好，${settings.get('user.callName') || '主人'}！`, body: lines.join('\n'), actions: [{ id: 'ok', label: '开始今天', style: 'primary' }] });
    return true;
  }

  // ---------------------------------------------------------- wellbeing
  #wellbeing(now, idle, elapsed) {
    const p = settings.get('planner');
    const st = this.state.data;
    if (idle >= 300) { st.active = 0; return; }           // a 5-minute break resets the sitting timer
    if (idle < 120) { st.active += elapsed / 60000; st.water += elapsed / 60000; }
    if (this.#quiet(now)) return;
    const name = settings.get('user.callName') || '主人';
    if (p.sedentary.enabled && st.active >= p.sedentary.minutes) {
      st.active = 0;
      this.state.save();
      showCard({ id: 'care:sedentary', kind: 'reminder', label: '关心', title: '起来活动一下吧', body: `已经连续用电脑 ${p.sedentary.minutes} 分钟啦，站起来伸个懒腰、看看远处～`, actions: [{ id: 'ok', label: '好的', style: 'primary' }, { id: 'later', label: '等会儿' }] })
        .then((a) => { if (a === 'later') st.active = Math.max(0, p.sedentary.minutes - 15); });
      broadcast('pet:action', { name: 'hop', args: {} });
      this.#say(`${name}，坐太久啦，起来活动一下吧。`);
    }
    if (p.water.enabled && st.water >= p.water.minutes) {
      st.water = 0;
      this.state.save();
      showCard({ id: 'care:water', kind: 'reminder', label: '关心', title: '喝点水吧', body: '补充一点水分，脑袋会更清醒哦。', actions: [{ id: 'ok', label: '喝了', style: 'primary' }] });
      this.#say(`${name}，记得喝水哦。`);
    }
  }

  // ---------------------------------------------------------- director
  async #director(now, idle) {
    const autonomy = settings.get('ai.autonomy') || 'normal';
    if (autonomy === 'off' || !isConfigured() || !settings.get('pet.visible')) return;
    if (Date.now() < this.nextDirector) return;
    const range = { low: [15, 25], normal: [6, 12], high: [3, 6] }[autonomy] || [6, 12];
    const schedule = (min) => { this.nextDirector = Date.now() + min * 60000; };
    if (this.#quiet(now) || idle > 900 || companion.current) { schedule(range[0]); return; }
    const pet = companion.petState || {};
    const upcoming = planner.occurrences(now, new Date(now.getTime() + 2 * 3600000)).filter((o) => !o.allDay).slice(0, 3);
    const sinceChat = companion.lastUserAt ? Math.round((Date.now() - companion.lastUserAt) / 60000) : null;
    const env = [
      `时间：${nowContext(now)}`,
      `主人：${idle < 30 ? '正在使用电脑' : `已有 ${Math.round(idle / 60)} 分钟没有操作`}；${sinceChat == null ? '今天还没和你聊过' : `${sinceChat} 分钟前和你说过话`}`,
      `你：${{ stand: '站着', sit: '坐着', sleep: '在睡觉' }[pet.pose] || '站着'}${settings.get('pet.quiet') ? '（安静模式：不要说话）' : ''}${settings.get('pet.allowWander') ? '' : '（主人不希望你走动：不要使用移动类动作）'}${settings.get('pet.lockPosition') ? '（位置已固定：不要移动）' : ''}`,
      upcoming.length ? `两小时内的日程：${upcoming.map((o) => `${fmtTime(parseLocal(o.occurrence))} ${o.title}`).join('；')}` : '两小时内没有日程',
      `未完成待办 ${planner.listTodos('open').length} 项`,
      companion.pendingNotes.length ? `最近发生：${companion.pendingNotes.slice(-4).join('；')}` : '',
    ].filter(Boolean).join('\n');
    schedule(range[0]);
    try {
      const plan = await companion.direct(env);
      if (!plan) return;
      let steps = plan.steps;
      if (settings.get('pet.quiet')) steps = steps.filter((s) => s.type !== 'say');
      if (!settings.get('pet.allowWander') || settings.get('pet.lockPosition')) steps = steps.filter((s) => !(s.type === 'action' && /walk|come|go_edge/.test(s.name)));
      if (steps.length) broadcast('pet:plan', { steps });
      schedule(Math.max(range[0], Math.min(range[1] * 2, plan.next)));
    } catch (err) {
      console.warn('[director]', err.message);
      schedule(range[1]);
    }
  }

  #prune() {
    const fired = this.state.data.fired;
    const cutoff = Date.now() - 3 * 86400000;
    let n = 0;
    for (const [k, v] of Object.entries(fired)) if (v < cutoff) { delete fired[k]; n++; }
    if (n) this.state.save();
  }
}

export const scheduler = new Scheduler();
