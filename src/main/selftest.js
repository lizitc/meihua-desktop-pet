// Development self-test: drives the character through a script and saves window captures.
//   electron . --selftest=<out dir> [--selftest-panel]
import { app } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Resolves once the window's page has finished loading (or after 3 minutes). */
const panelLoaded = (win) => new Promise((resolve) => {
  if (!win.webContents.isLoadingMainFrame() && win.webContents.getURL()) return resolve();
  const t = setTimeout(resolve, 180000);
  win.webContents.once('did-finish-load', () => { clearTimeout(t); resolve(); });
});

/** Mock OpenAI-compatible endpoint: first a tool call, then a tagged reply. */
function mockServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch { /* ignore */ }
      requests.push(j);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const hasResult = (j.messages || []).some((m) => m.role === 'tool');
      const sys = String(j.messages?.[0]?.content || '');
      if (sys.includes('莓华工坊')) {
        // workshop agent: plan + write a file, then run a command (needs approval), then finish
        const results = (j.messages || []).filter((m) => m.role === 'tool').length;
        const call = (i, id, name, args) => send({ choices: [{ delta: { tool_calls: [{ index: i, id, function: { name, arguments: JSON.stringify(args) } }] } }] });
        const plan = (k) => ({ items: ['写一个问候文件', '读出来验证内容', '总结'].map((text, i) => ({ text, status: i < k ? 'done' : i === k ? 'in_progress' : 'pending' })) });
        if (results === 0) {
          send({ choices: [{ delta: { content: '好的，我先列个计划，然后**写文件**。' } }] });
          call(0, 'a1', 'update_plan', plan(0));
          call(1, 'a2', 'write_file', { path: 'hello.txt', content: '你好，莓华！\n' });
        } else if (results === 2) {
          call(0, 'a3', 'update_plan', plan(1));
          call(1, 'a4', 'run_command', { command: 'Get-Content hello.txt -Encoding utf8' });
        } else {
          call(0, 'a5', 'finish', { summary: '已创建 `hello.txt` 并读取验证，内容正确。', files: ['hello.txt'], success: true });
        }
        send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        res.end('data: [DONE]\n\n');
        return;
      }
      if (!hasResult && (j.tools || []).length) {
        const tomorrow = new Date(Date.now() + 86400000);
        const d = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T15:00`;
        send({ choices: [{ delta: { content: '[e:cur' } }] });
        send({ choices: [{ delta: { content: 'ious]我来记一下～' } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'calendar_add', arguments: '{"title":"产品评审会",' } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: `"start":"${d}","remind":[15]}` } }] }, finish_reason: 'tool_calls' }] });
      } else {
        for (const part of ['[e:happy]记好啦！明天下午三点的', '产品评审会，我会提前十五分钟提醒主人的。', '[a:hop]要不要顺便把资料也列进待办？']) send({ choices: [{ delta: { content: part } }] });
        send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      }
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests })));
}

async function aiScenario({ js, shot, note, sleep: wait }) {
  const { settings } = await import('./settings.js');
  const { planner } = await import('./planner/planner.js');
  const mock = await mockServer();
  settings.patch({ ai: { preset: 'custom', provider: 'openai', baseUrl: `http://127.0.0.1:${mock.port}/v1`, model: 'mock-model', autonomy: 'off', touchReplies: false } });
  note(`mock at ${mock.port}`);
  const r = await js(`window.meihua.invoke('chat.send', { text: '明天下午三点有个产品评审会，帮我记一下', source: 'pet' })`);
  note('send → ' + JSON.stringify(r));
  await wait(900);
  await shot('ai-01-midturn');
  await wait(3500);
  await shot('ai-02-reply');
  const evs = planner.events.data.events.map((e) => ({ title: e.title, start: e.start, remind: e.remind }));
  note('events ' + JSON.stringify(evs));
  note(`requests ${mock.requests.length}; tools offered ${mock.requests[0]?.tools?.length}; 2nd has tool msg: ${(mock.requests[1]?.messages || []).some((m) => m.role === 'tool')}`);
  note('system prompt head: ' + JSON.stringify(String(mock.requests[0]?.messages?.[0]?.content || '').slice(0, 120)));
  note('user msg: ' + JSON.stringify(String(mock.requests[0]?.messages?.[1]?.content || '').slice(0, 400)));
  const log = await js(`window.meihua.invoke('chat.log', {})`);
  note('chat log ' + JSON.stringify(log.map((e) => ({ role: e.role, text: e.text, tools: e.tools?.map((t) => t.status) }))));
  mock.server.close();
}

/** Seed sample data, then capture every notebook page in light and dark themes. */
async function panelScenario({ panelWindow, note, errors }) {
  const { planner } = await import('./planner/planner.js');
  const { memory } = await import('./ai/memory.js');
  const { companion } = await import('./ai/companion.js');
  const { settings } = await import('./settings.js');
  const p2 = (n) => String(n).padStart(2, '0');
  const day = (off) => { const x = new Date(); x.setDate(x.getDate() + off); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`; };
  const hm = (offMin) => { const x = new Date(Date.now() + offMin * 60000); return `${p2(x.getHours())}:${p2(x.getMinutes())}`; };
  if (!planner.events.data.events.length) {
    planner.addEvent({ title: '晨跑', start: `${day(-2)}T07:30`, durationMinutes: 40, color: 'mint', recurrence: { freq: 'daily' } });
    planner.addEvent({ title: '产品评审会', start: `${day(0)}T${hm(90)}`, durationMinutes: 60, location: '3 楼会议室', remind: [15], color: 'berry' });
    planner.addEvent({ title: '午饭和设计组', start: `${day(0)}T${hm(-60)}`, durationMinutes: 45, color: 'honey' });
    planner.addEvent({ title: '和小林吃饭', start: `${day(1)}T18:30`, location: '春日食堂', color: 'honey' });
    planner.addEvent({ title: '妈妈生日', start: day(3), allDay: true, color: 'lav' });
    planner.addEvent({ title: '周会', start: `${day(-1)}T10:00`, color: 'sky', recurrence: { freq: 'weekly' } });
    planner.addTodo({ title: '整理本周周报', due: day(0), priority: 2, tags: ['工作'] });
    planner.addTodo({ title: '回复设计稿意见', due: `${day(1)}T12:00`, priority: 1 });
    planner.addTodo({ title: '买猫粮和猫砂', priority: 0, tags: ['生活'] });
    planner.addTodo({ title: '提交报销单', due: day(-1), priority: 3 });
    planner.addReminder({ text: '起来喝杯水', at: `${day(0)}T${hm(40)}` });
    planner.addReminder({ text: '给妈妈订蛋糕', at: `${day(2)}T19:00` });
    planner.addRoutine({ name: '早间天气', time: '08:00', prompt: '查一下今天的天气，如果会下雨就提醒我带伞，再说说今天的安排。' });
    memory.save({ text: '主人喜欢喝无糖燕麦拿铁', category: 'preference' }, 'ai');
    memory.save({ text: '主人每周三晚上去健身房', category: 'habit' }, 'ai');
    memory.save({ text: '主人是产品经理，正在做一款记账 App', category: 'work' }, 'user');
    memory.save({ text: '主人对芒果过敏', category: 'profile', pinned: true }, 'user');
    const t0 = Date.now() - 3600000;
    companion.log.data.entries.push(
      { id: 'c_s1', ts: t0, role: 'user', text: '明天下午三点有个产品评审会，帮我记一下', source: 'pet' },
      { id: 'c_s2', ts: t0 + 4000, role: 'assistant', text: '记好啦！明天 **15:00** 的产品评审会，我会提前 15 分钟提醒你～\n\n要不要顺便把要准备的东西也列进待办？', source: 'pet', tools: [{ name: 'calendar_add', label: '记到日历', status: 'done' }] },
      { id: 'c_s3', ts: t0 + 60000, role: 'user', text: '好呀，要准备：\n1. 需求文档\n2. 原型链接', source: 'panel' },
      { id: 'c_s4', ts: t0 + 64000, role: 'assistant', text: '都加进待办了：\n- 需求文档\n- 原型链接\n\n评审前我再提醒你检查一遍 `v2.3` 的改动记录。', source: 'panel', tools: [{ name: 'todo_add', label: '添加待办', status: 'done' }, { name: 'todo_add', label: '添加待办', status: 'done' }] },
      { id: 'c_s5', ts: t0 + 1800000, role: 'assistant', text: '主人摸我头的时候，耳朵会痒痒的啦……', source: 'reaction', proactive: true },
    );
    companion.log.save();
  }
  const tOpen = Date.now();
  panelWindow.open('today');
  for (let i = 0; i < 40 && !panelWindow.win; i++) await sleep(100);
  const win = panelWindow.win;
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push('[panel] ' + e.message); });
  await panelLoaded(win);
  note(`panel loaded in ${Date.now() - tOpen} ms`);
  await sleep(1200);
  const go = async (hash, wait = 1100) => { await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify('#' + hash)}; 1`); await sleep(wait); };
  const pages = ['today', 'nest', 'chat', 'calendar', 'todos', 'todos/reminders', 'todos/routines', 'workshop', 'skills', 'memory', 'settings/ai', 'settings/voice', 'settings/pet', 'welcome'];
  const out = [];
  for (const p of pages) { await go(p); out.push([`p-${p.replace('/', '-')}`, win]); await shotWin(win, `p-${p.replace('/', '-')}`, note); }
  // welcome → 连接 AI: the DeepSeek guide; settings with a local preset: the one-click install entry
  await win.webContents.executeJavaScript(`document.querySelectorAll('.wz-dot')[1]?.click(); 1`); await sleep(800);
  note('deepseek guide steps ' + (await win.webContents.executeJavaScript(`document.querySelectorAll('.ds-steps li').length`)));
  await shotWin(win, 'p-welcome-connect', note);
  await win.webContents.executeJavaScript(`document.querySelector('.wz-main')?.scrollTo(0, 99999); 1`); await sleep(300);
  await shotWin(win, 'p-welcome-connect-2', note);
  const aiPrev = { preset: settings.get('ai.preset'), provider: settings.get('ai.provider'), baseUrl: settings.get('ai.baseUrl'), model: settings.get('ai.model') };
  settings.patch({ ai: { preset: 'ollama', provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: '' } });
  await go('settings/ai', 1500);
  note('install entry (ai) ' + (await win.webContents.executeJavaScript(`document.querySelector('.local-install.compact')?.textContent || null`)));
  await shotWin(win, 'p-settings-ai-ollama', note);
  settings.patch({ ai: aiPrev });
  await go('workshop', 1500);
  note('install shelf ' + (await win.webContents.executeJavaScript(`[...document.querySelectorAll('.install-grid .local-install .li-head b')].map((b) => b.textContent).join(', ')`)));
  await go('today', 300);
  await win.webContents.executeJavaScript(`document.querySelector('.hero-actions .btn:nth-child(2)')?.click(); 1`);
  await sleep(700);
  await shotWin(win, 'p-dialog-event', note);
  await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1`);
  settings.patch({ app: { theme: 'dark' } });
  for (const p of ['today', 'chat', 'calendar', 'memory']) { await go(p); await shotWin(win, `d-${p}`, note); }
  settings.patch({ app: { theme: 'light' } });
  if (process.argv.includes('--selftest-func')) await functionalScenario({ win, go, note });
}

/** 养成 + liveliness: status HUD, ring stats, food tray + eating, check-in, every idle act, a fling with
 *  wall bounces and the dizzy landing, then the notebook's 小窝 page (light / dark) and feeding from it. */
async function lifeScenario({ js, shot, note, panelWindow, errors }) {
  const st = () => js(`window.meihua.invoke('life.get')`);
  const brief = (s) => `Lv${s.level} xp ${s.xp}/${s.xpNext} coins ${s.coins} mood ${s.mood} hunger ${s.hunger} intimacy ${s.intimacy} checked ${s.checkedToday} streak ${s.streak} stats ${JSON.stringify(s.stats)} inv ${JSON.stringify(s.inventory)}`;
  await js(`__meihua.behavior.nextIdle = 1e9; 1`);
  note('life start ' + brief(await st()));
  await shot('l-00-stand');
  // hovering her shows the status pill (hit testing is pinned "over" for the test)
  await js(`(() => { const i = __meihua.input; i.__hit = i.hitTest; i.hitTest = () => {}; i.overChar = true; return 1; })()`);
  await sleep(1400);
  await shot('l-01-hud');
  note('hud ' + (await js(`!!document.querySelector('.hud')`)));
  await js(`(() => { const i = __meihua.input; i.hitTest = i.__hit; i.overChar = false; return 1; })()`);
  await sleep(1700);
  await js(`__meihua.ui.openRing(210, 330); 1`); await sleep(700);
  await shot('l-02-ring');
  note('ring stats ' + (await js(`document.querySelector('.ring-stats')?.textContent || null`)));
  // feed: the ring petal opens the tray, a tray button feeds
  await js(`document.querySelector('.petal[aria-label="喂食"]')?.click(); 1`); await sleep(900);
  await shot('l-03-tray');
  note('tray foods ' + (await js(`[...document.querySelectorAll('.tray .food')].map((b) => b.textContent.trim()).join(' | ')`)));
  await js(`document.querySelector('.tray button.food')?.click(); 1`);
  for (const [t, name] of [[500, 'l-04-eat-a'], [900, 'l-04-eat-b'], [900, 'l-04-eat-c']]) { await sleep(t); await shot(name); }
  note('eat act ' + (await js(`__meihua.behavior.idle.act?.id || 'none'`)));
  await sleep(2500);
  note('after feed ' + brief(await st()));
  // check-in from the ring
  await js(`__meihua.ui.openRing(210, 330); 1`); await sleep(600);
  await js(`document.querySelector('.petal[aria-label="签到"]')?.click(); 1`); await sleep(700);
  await shot('l-05-checkin');
  await sleep(2600);
  note('after checkin ' + brief(await st()));
  // each idle act, captured near its middle
  const acts = await js(`import('./idle.js').then((m) => m.IDLE_ACTS)`);
  note('idle acts ' + acts.join(','));
  for (const id of acts.filter((a) => a !== 'eat')) {
    await js(`(() => { const b = __meihua.behavior; b.ui.hideBubble?.(); b.idle.cancel(); return 1; })()`);
    await sleep(350);
    const ok = await js(`__meihua.behavior.idle.start(${JSON.stringify(id)})`);
    const dur = await js(`__meihua.behavior.idle.act?.def.dur || 0`);
    await sleep(Math.max(300, dur * 1000 * 0.45));
    await shot(`l-act-${id}`);
    note(`act ${id} started=${ok} dur=${dur} playing=${await js('__meihua.behavior.idle.act?.id || null')}`);
    await sleep(Math.max(200, dur * 1000 * 0.55 + 200));
  }
  // fling: a fast drag to the right from mid-screen, released; she should bounce off the right wall
  await js(`__meihua.behavior.idle.cancel(); __meihua.ui.hideBubble?.(); 1`);
  await sleep(600);
  const start = await js(`(() => { const c = __meihua.character, d = c.displayAt(c.root.x), wa = d.workArea;
    const x0 = wa.x + wa.width * 0.45, y0 = wa.y + wa.height * 0.72;
    c.root = { x: x0, y: y0 }; c.onRoot(c.root);
    c.beginDrag(300); __meihua.behavior.onDragStart();
    const t0 = performance.now();
    for (let i = 0; i <= 6; i++) c.dragTo({ x: x0 + i * 48, y: y0 - i * 30 }, t0 - (6 - i) * 16);
    c.endDrag(null, { bounce: true }); __meihua.behavior.onDragEnd();
    return { mode: c.mode, vel: { ...c.vel }, wa, s: c.s }; })()`);
  note('fling ' + JSON.stringify(start));
  const track = [];
  for (let i = 0; i < 45; i++) {
    await sleep(90);
    const p = await js(`(() => { const c = __meihua.character, b = c.body; return [c.mode, Math.round(c.root.x), Math.round(c.root.y), c.fly?.hits ?? -1, +b.rot.toFixed(3), +b.sx.toFixed(3), +b.sy.toFixed(3)]; })()`);
    track.push(p);
    if (i === 3 || i === 7 || i === 12) await shot(`l-10-fly-${i}`);
    if (p[0] !== 'fly' && i > 2) break;
  }
  note('fly track ' + JSON.stringify(track));
  await sleep(500);
  await shot('l-11-landed');
  await sleep(1200);
  await shot('l-12-dizzy');
  note('after fling ' + brief(await st()));
  // the notebook's 小窝, and feeding from it plays the act on the character
  panelWindow.open('nest');
  for (let i = 0; i < 40 && !panelWindow.win; i++) await sleep(100);
  const win = panelWindow.win;
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push('[panel] ' + e.message); });
  await sleep(2600);
  const go = async (hash, wait = 1200) => { await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify('#' + hash)}; 1`); await sleep(wait); };
  await go('nest', 1600);
  await shotWin(win, 'l-20-nest');
  // touching her by part (native standing-art points inside the 600-wide drawing box), then a walk across the room
  const pjs = (code) => win.webContents.executeJavaScript(code, true);
  const walkerState = `(() => { const w = window.__nestWalker; if (!w) return null; const g = document.querySelector('.room-girl').getBoundingClientRect();
    return { seqs: Object.keys(w.seqs || {}), parts: (w.parts || []).length, err: w.loadError || null, walking: w.walking, x: Math.round(w.x), range: w.range.map(Math.round),
      headSolid: w.solidAt(g.left + (238 - 254 + 300) / 600 * g.width, g.top + 92 / 1000 * g.height), cv: [w.cv.width, w.cv.height], pic: !!w.pic?.img }; })()`;
  for (let i = 0; i < 30 && !(await pjs(`(window.__nestWalker?.seqs ? 1 : 0)`)); i++) await sleep(250);
  note('nest walker ' + JSON.stringify(await pjs(walkerState)));
  for (const [name, nx, ny] of [['head', 238, 92], ['face', 238, 186], ['chest', 238, 330], ['hand', 382, 575], ['foot', 222, 937]]) {
    await pjs(`(() => { const g = document.querySelector('.room-girl'); if (!g) return 0; const r = g.getBoundingClientRect();
      g.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + (${nx} - 254 + 300) / 600 * r.width, clientY: r.top + ${ny} / 1000 * r.height })); return 1; })()`);
    await sleep(380);
    note(`nest touch ${name} → ${await pjs(`[document.querySelector('.room-bubble')?.textContent || '', document.querySelector('.room-girl')?.className || ''].join(' | ')`)}`);
    if (name === 'head' || name === 'chest') await shotWin(win, `l-21-nest-${name}`);
    await sleep(500);
  }
  const girlX = () => pjs(`document.querySelector('.room-girl')?.style.left || ''`);
  const x0 = await girlX();
  await pjs(`(() => { const room = document.querySelector('.room'); const r = room.getBoundingClientRect(); room.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.right - 110, clientY: r.bottom - 30 })); return 1; })()`);
  await sleep(650);
  const mid = await girlX(), walking = await pjs(`document.querySelector('.room')?.classList.contains('is-walking')`);
  await shotWin(win, 'l-21-nest-walk');
  await sleep(4000);
  note(`nest walk ${x0} → ${mid} (walking=${walking}) → ${await girlX()}`);
  await shotWin(win, 'l-21-nest-walked');
  await win.webContents.executeJavaScript(`(document.querySelector('.page'))?.scrollTo(0, 99999); 1`);
  await sleep(500);
  await shotWin(win, 'l-22-nest-bottom');
  await win.webContents.executeJavaScript(`(document.querySelector('.page'))?.scrollTo(0, 0); [...document.querySelectorAll('.shop-item .btn.primary')].find((b) => !b.disabled)?.click(); 1`);
  await sleep(900);
  await shotWin(win, 'l-23-nest-fed');
  await shot('l-24-pet-eat-from-panel');
  const { settings } = await import('./settings.js');
  settings.patch({ app: { theme: 'dark' } });
  await go('nest', 1400);
  await shotWin(win, 'l-25-nest-dark');
  settings.patch({ app: { theme: 'light' } });
  await go('today', 1400);
  await shotWin(win, 'l-26-today');
  note('final ' + brief(await st()));
}

/**
 * Realism + chat + workshop: whole-body reactions to touches, live pulls (held and released), head strokes, the
 * new idle acts, the quick chat's opening logic, being tucked in below the taskbar (gravity and bouncing off), and
 * the workshop's chat bar and history list (seeded history, a task handed over from the chat bar against a mock
 * model, and a follow-up that continues it).
 */
async function motionScenario({ js, shot, note, panelWindow, petWindow, errors }) {
  const { settings } = await import('./settings.js');
  await js(`__meihua.behavior.nextIdle = 1e9; 1`);
  const quiet = `(() => { const b = __meihua.behavior; b.ui.hideBubble?.(); b.idle.cancel(); b.reactor.reset(); b.lastSay = performance.now() + 4000; return 1; })()`;
  const partExpr = (id) => `(() => { const c = __meihua.character, rig = c.rig; const p = (c.m.parts.stand || []).find((q) => q.id === ${JSON.stringify(id)}); if (!p) return null;
    return { ...p, native: [p.cx, p.cy], side: p.cx < (rig.headPivot?.[0] ?? 254) ? -1 : 1 }; })()`;
  const r4 = (v) => +(+v || 0).toFixed(4);

  const only = process.argv.find((a) => a.startsWith('--selftest-only='))?.split('=')[1] || 'ABCDEFGH';
  // ---- A. touches: the whole body answers, not just the touched part
  if (only.includes('A')) for (const id of ['head', 'ear-left', 'ear-right', 'hair', 'tail', 'hand-left', 'hand-right', 'leg-left', 'foot-right', 'skirt', 'body']) {
    await js(quiet); await sleep(800);
    const r = await js(`(async () => {
      const b = __meihua.behavior, part = ${partExpr(id)};
      if (!part) return null;
      b.onTouch(part, {});
      const peak = { lean: 0, rise: 0, ey: 0, torso: 0, head: 0, headDy: 0 };
      const t0 = performance.now();
      while (performance.now() - t0 < 380) {
        await new Promise((res) => requestAnimationFrame(res));
        const o = b.reactor.out;
        for (const k of ['lean', 'rise', 'ey']) if (Math.abs(o[k]) > Math.abs(peak[k])) peak[k] = o[k];
        for (const k of ['torso', 'head', 'headDy']) if (Math.abs(o.j[k] || 0) > Math.abs(peak[k])) peak[k] = o.j[k] || 0;
      }
      return { side: part.side, gaze: b.reactor.out.gaze, peak: Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, +v.toFixed(4)])) };
    })()`);
    note(`touch ${id} ${JSON.stringify(r)}`);
    if (['ear-left', 'tail', 'skirt', 'hand-right', 'body'].includes(id)) await shot(`m-touch-${id}`);
  }

  // ---- B. live pulls: lean / counter-balance while held, swing back past rest when let go
  if (only.includes('B')) for (const [id, dx, dy] of [['hand-right', 240, -130], ['tail', 220, 40], ['ear-left', -200, 70], ['skirt', 170, 30], ['foot-left', -190, -40], ['hair', 150, 20]]) {
    await js(quiet); await sleep(900);
    const held = await js(`(async () => {
      const c = __meihua.character, b = __meihua.behavior, rig = c.rig, part = ${partExpr(id)};
      if (!part) return null;
      b.onPullStart(part);
      const grab = part.native;
      for (let i = 1; i <= 24; i++) { rig.pullPart(part.id, grab, [grab[0] + ${dx} * i / 24, grab[1] + ${dy} * i / 24]); await new Promise((res) => requestAnimationFrame(res)); }
      await new Promise((res) => setTimeout(res, 500));
      const o = b.reactor.out;
      return { lean: +o.lean.toFixed(4), rise: +o.rise.toFixed(2), ey: +o.ey.toFixed(4), torso: +(o.j.torso || 0).toFixed(4), head: +(o.j.head || 0).toFixed(4), gaze: o.gaze, bodyLean: +c.body.lean.toFixed(4) };
    })()`);
    note(`pull ${id} held ${JSON.stringify(held)}`);
    await shot(`m-pull-${id}`);
    const trace = await js(`(async () => {
      const c = __meihua.character, b = __meihua.behavior, part = ${partExpr(id)};
      c.rig.releasePull(); b.onPullRelease(part, 260);
      const out = [];
      for (let i = 0; i < 14; i++) { await new Promise((res) => setTimeout(res, 70)); out.push(+b.reactor.out.lean.toFixed(4)); }
      return out;
    })()`);
    note(`pull ${id} release lean ${JSON.stringify(trace)}`);
  }

  // ---- C. stroking the head: she leans into the hand and follows it
  if (only.includes('C')) {
  await js(quiet); await sleep(700);
  const stroke = await js(`(async () => {
    const c = __meihua.character, b = __meihua.behavior, rig = c.rig, M = c.viewMatrix(c.view), hp = rig.headPivot, out = [];
    for (let i = 0; i < 30; i++) {
      const nx = hp[0] + Math.sin(i / 3) * 110, ny = hp[1] - 120;
      b.onStroke(M[0] * nx + M[2] * ny + M[4], M[1] * nx + M[3] * ny + M[5]);
      if (i % 6 === 5) b.onPat({ hover: true, part: 'head' });
      await new Promise((res) => setTimeout(res, 45));
      if (i % 5 === 4) out.push([+(b.reactor.out.j.head || 0).toFixed(4), +b.reactor.out.lean.toFixed(4)]);
    }
    return out;
  })()`);
  note('stroke [head, lean] ' + JSON.stringify(stroke));
  await shot('m-stroke');
  }

  // ---- D. the new idle acts (whole-body channels sampled over the first half)
  if (only.includes('D')) for (const id of ['shakeOff', 'dance', 'sniff', 'tailChase', 'curtsy', 'footTap', 'rubEyes', 'peek', 'sideStretch', 'giggle', 'deepBreath']) {
    await js(quiet); await sleep(450);
    const ok = await js(`__meihua.behavior.idle.start(${JSON.stringify(id)})`);
    const dur = await js(`__meihua.behavior.idle.act?.def.dur || 0`);
    const shotAt = dur * 480;
    const probe = js(`(async () => { const M = __meihua, c = M.character, b = c.body, idle = M.behavior.idle, mx = { lean: 0, rise: 0, ey: 0 }, t0 = performance.now();
      let lastT = 0, end = null;
      while (performance.now() - t0 < ${dur} * 1000 + 600) {
        await new Promise((r) => requestAnimationFrame(r));
        if (performance.now() - t0 < ${shotAt}) for (const k of Object.keys(mx)) mx[k] = Math.max(mx[k], Math.abs(b[k] || 0));
        if (idle.act) lastT = idle.act.t;
        else if (!end) { end = { at: +lastT.toFixed(2), mode: c.mode, pose: c.pose, view: c.view.kind + ':' + c.view.id }; }
      }
      return { mx: Object.fromEntries(Object.entries(mx).map(([k, v]) => [k, +v.toFixed(4)])), end }; })()`);
    await sleep(shotAt);
    await shot(`m-act-${id}`);
    const r = await probe;
    note(`act ${id} started=${ok} dur=${dur} maxBody=${JSON.stringify(r.mx)} ended=${JSON.stringify(r.end)}`);
    await sleep(300);
  }

  // ---- E. quick chat opening
  if (only.includes('E')) {
  await js(quiet); await sleep(500);
  await js(`__meihua.behavior.openChat(); 1`); await sleep(900);
  note('chat open ' + JSON.stringify(await js(`({ open: __meihua.ui.inputOpen, textareaFocused: document.activeElement?.tagName === 'TEXTAREA', windowFocused: document.hasFocus(), listening: __meihua.behavior.reactor.listening })`)));
  await js(`(() => { const t = document.querySelector('.pill textarea'); t.value = '帮我看看明天的安排'; t.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  await sleep(300);
  await shot('m-chat-open');
  await js(`document.querySelector('.pill textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`);
  await sleep(400);
  note('after Esc open=' + (await js(`__meihua.ui.inputOpen`)));
  await js(`__meihua.behavior.openChat(); 1`); await sleep(600);
  note('draft kept after reopen: ' + JSON.stringify(await js(`document.querySelector('.pill textarea')?.value ?? null`)));
  const focusedNow = await js(`document.hasFocus()`);
  await js(`__meihua.behavior.openChat({ toggle: true }); 1`); await sleep(300);
  note(`hotkey toggle (window focused=${focusedNow}) → open=${await js('__meihua.ui.inputOpen')}`);
  await js(`__meihua.ui.closeInput(); __meihua.ui.store.set({ inputText: '' }); 1`);
  await sleep(500);
  const dbl = await js(`(async () => { const b = __meihua.behavior, part = ${partExpr('body')}; b.lastSay = 0; b.ui.hideBubble();
    b.onTouch({ ...part, phrase: '嗯？' }, {}); await new Promise((r) => setTimeout(r, 120)); b.onDoubleClick();
    await new Promise((r) => setTimeout(r, 700)); return { open: b.ui.inputOpen, bubble: !!b.ui.store.get().bubble }; })()`);
  note('double-click (first click speech dropped) ' + JSON.stringify(dbl));
  await js(`__meihua.ui.closeInput(); 1`);
  await sleep(500);
  const carried = await js(`(async () => { const c = __meihua.character, b = __meihua.behavior;
    c.beginDrag(300); b.openChat(); const during = b.ui.inputOpen;
    c.endDrag(null, { bounce: false }); await new Promise((r) => setTimeout(r, 900));
    return { during, afterLanding: b.ui.inputOpen, mode: c.mode }; })()`);
  note('opened while carried ' + JSON.stringify(carried));
  await js(`__meihua.ui.closeInput(); 1`);
  }

  // ---- F. tucked in below the taskbar
  if (only.includes('F')) {
  const geo = () => js(`(() => { const c = __meihua.character; return { root: { x: Math.round(c.root.x), y: Math.round(c.root.y) }, floor: c.floorY(), sunk: c.sunk, clip: c.clipY == null ? null : Math.round(c.clipY), sink: c.flags.sink }; })()`);
  const floor = await js(`__meihua.character.floorY()`);
  const rx = await js(`__meihua.character.root.x`);
  note(`clamp (defaults) ${JSON.stringify(petWindow.clampRoot({ x: rx, y: floor + 300 }, { loose: true }))} floor=${floor}`);
  settings.patch({ pet: { gravity: false, bounce: false } });
  await sleep(700);
  note(`clamp (gravity+bounce off) ${JSON.stringify(petWindow.clampRoot({ x: rx, y: floor + 300 }, { loose: true }))} depth=${petWindow.sinkDepth()} flag=${await js('__meihua.character.flags.sink')}`);
  await js(`(async () => { const c = __meihua.character, b = __meihua.behavior; b.idle.cancel();
    c.beginDrag(300);
    for (let i = 0; i <= 12; i++) { const r = await window.meihua.invoke('pet.root', { x: c.root.x, y: c.floorY() + i * 30, loose: true, transient: true }); c.dragTo(r, performance.now()); await new Promise((res) => setTimeout(res, 35)); }
    await new Promise((res) => setTimeout(res, 300));
    c.endDrag(null, { bounce: false }); b.onDragEnd(); return 1; })()`);
  await sleep(1200);
  note('tucked ' + JSON.stringify(await geo()) + ' window ' + JSON.stringify(petWindow.win.getBounds()) + ' main root ' + JSON.stringify(petWindow.root));
  await js(quiet); await sleep(600);
  await shot('m-sink');
  // pixels below the taskbar line are not drawn (so clicks there reach the taskbar); above it she is solid
  const probe = await js(`new Promise((resolve) => { const i = __meihua.input, orig = i.hitTest;
    i.hitTest = function () { i.hitTest = orig; const c = __meihua.character, r = __meihua.renderer, clip = c.clipY, f = c.foot(); let above = 0, below = 0;
      for (let x = f.x - 60; x <= f.x + 60; x += 3) { above = Math.max(above, r.readAlpha(x, clip - 14)); below = Math.max(below, r.readAlpha(x, clip + 4)); }
      orig.call(i); resolve({ clip: Math.round(clip), above: +above.toFixed(2), below: +below.toFixed(2) }); }; })`);
  note('alpha around the taskbar line ' + JSON.stringify(probe));
  await js(`__meihua.behavior.idle.start('dance')`); await sleep(1600);
  await shot('m-sink-dance');
  await js(`(() => { const b = __meihua.behavior, part = ${partExpr('head')}; b.onTouch(part, {}); return 1; })()`); await sleep(250);
  await shot('m-sink-touch');
  settings.patch({ pet: { gravity: true } });
  await sleep(1600);
  note('gravity back on → ' + JSON.stringify(await geo()) + ' main root ' + JSON.stringify(petWindow.root));
  await shot('m-sink-climbed');
  settings.patch({ pet: { bounce: true } });
  }

  // ---- H. sit / sleep: keyframe transitions (shots mid-way), gaze in both rigs, strokes on each body part
  if (only.includes('H')) {
    settings.patch({ pet: { gaze: true } });
    await js(quiet); await sleep(500);
    const gazeProbe = async (tag, shots) => {
      const out = {};
      for (const [name, dx, dy] of [['left', -520, -40], ['right', 520, -40], ['up', 0, -420], ['down', 0, 320], ['near', 18, 8], ['far', 2600, 0]]) {
        out[name] = await js(`(async () => { const b = __meihua.behavior, c = __meihua.character, o = c.windowOrigin(), a = c.lastAnchor || { x: 200, y: 200 };
          b.getCursor = () => ({ x: o.x + a.x + ${dx}, y: o.y + a.y + ${dy} });
          // a moving cursor means someone is at the computer (she stops following after 25 s of system idle)
          for (let i = 0; i < 9; i++) { b.systemIdle = 0; await new Promise((r) => setTimeout(r, 100)); }
          const g = c.rig?.gaze; return g ? [+g.x.toFixed(2), +g.y.toFixed(2), +g.hx.toFixed(2), +g.hy.toFixed(2)] : null; })()`);
        if (shots.includes(name)) await shot(`m-gaze-${tag}-${name}`);
      }
      await js(`(() => { __meihua.behavior.getCursor = window.__savedCursor; return 1; })()`);
      note(`gaze ${tag} [eyeX, eyeY, headX, headY] ${JSON.stringify(out)}`);
    };
    await js(`(() => { window.__savedCursor = __meihua.behavior.getCursor; return 1; })()`);
    await gazeProbe('stand', ['left', 'up']);
    const rubAll = async (pose, ids, shots) => {
      for (const id of ids) {
        await js(quiet); await js(`(() => { const b = __meihua.behavior; b.rub = null; b.lastSay = 0; b.ui.hideBubble?.(); return 1; })()`); await sleep(500);
        const r = await js(`(async () => {
          const c = __meihua.character, b = __meihua.behavior, list = c.m.parts[${JSON.stringify(pose)}] || [], p = list.find((q) => q.id === ${JSON.stringify(id)});
          if (!p) return null;
          const part = { ...p, native: [p.cx, p.cy], side: p.cx < (c.rig?.headPivot?.[0] ?? 254) ? -1 : 1 };
          const M = c.viewMatrix(c.view), sx = M[0] * p.cx + M[2] * p.cy + M[4], sy = M[1] * p.cx + M[3] * p.cy + M[5];
          const said = [], say = b.say;
          b.say = function (t, o) { said.push(t); return say.call(this, t, o); };
          for (let i = 0; i < 9; i++) {
            b.onRub(part, { hover: i % 2 === 0, x: sx + (i % 2 ? 12 : -12), y: sy });
            await new Promise((res) => setTimeout(res, 240));
          }
          delete b.say;
          return { n: b.rub?.n, expr: c.rig?.expr, said, hit: c.partAt(sx, sy)?.id ?? null };
        })()`);
        note(`rub ${pose} ${id} ${JSON.stringify(r)}`);
        if (shots.includes(id)) await shot(`m-rub-${pose}-${id}`);
      }
    };
    await rubAll('stand', ['face', 'chest', 'thigh-left', 'calf-right', 'foot-left', 'hand-right', 'tail'], ['face', 'chest', 'thigh-left']);
    // stand -> sit -> sleep -> sit -> stand, with shots inside each dissolve
    for (const [target, at] of [['sit', [0.3, 0.62]], ['sleep', [0.45, 1.0]], ['stand', [0.5, 1.4, 2.0]]]) {
      await js(quiet);
      const t0 = Date.now();
      const done = js(`(async () => { const c = __meihua.character, t = performance.now(); const ok = await c.run((tk) => c.goPose(${JSON.stringify(target)}, c.facing, tk));
        return { ok, ms: Math.round(performance.now() - t), pose: c.pose, mode: c.mode, view: c.view.kind + ':' + c.view.id, fade: !!c.fade }; })()`);
      for (const s of at) { await sleep(Math.max(0, s * 1000 - (Date.now() - t0))); await shot(`m-pose-${target}-${Math.round(s * 100)}`); }
      note(`goPose ${target} ${JSON.stringify(await done)}`);
      await sleep(500); await shot(`m-pose-${target}-end`);
      if (target === 'sit') { await gazeProbe('sit', ['left', 'down']); await rubAll('sit', ['face', 'head', 'thigh-right', 'foot-left'], ['thigh-right']); }
    }
    // a transition cut short (picked up mid-way) must leave no dissolve behind
    const cut = await js(`(async () => { const c = __meihua.character; c.run((tk) => c.goPose('sit', c.facing, tk)); await new Promise((r) => setTimeout(r, 380)); c.stop(); await new Promise((r) => setTimeout(r, 400));
      return { pose: c.pose, mode: c.mode, view: c.view.kind + ':' + c.view.id, fade: c.fade ? { manual: !!c.fade.manual } : null, warp: !!c.view.warp }; })()`);
    note('transition cut short ' + JSON.stringify(cut));
    await shot('m-pose-cut');
    await js(`(async () => { const c = __meihua.character; await c.run((tk) => c.goPose('stand', c.facing, tk)); return 1; })()`);
  }

  // ---- G. workshop: chat bar + history
  if (!only.includes('G')) return;
  const { agents } = await import('./agent/agent.js');
  const { userDir } = await import('./paths.js');
  const now = Date.now(), HR = 3600000, DAY = 24 * HR;
  const mk = (kind, extra) => ({ kind, ts: now - 2 * HR, ...extra });
  const seed = [
    { title: '照片按拍摄日期整理', status: 'done', at: now - 2 * HR, instructions: '把 D:\\照片\\未整理 里的照片按 EXIF 拍摄日期移动到「年\\月」文件夹，没有日期的放到「未知日期」。先做一个预览清单给我确认。',
      plan: [['查看照片文件夹', 'done'], ['写整理脚本', 'done'], ['预览并确认', 'done'], ['执行整理', 'done']],
      steps: [mk('text', { text: '好的！我先看看文件夹里都有些什么。' }), mk('tool', { tool: 'list_dir', input: 'D:\\照片\\未整理', status: 'done', output: '1284 个文件（.jpg 1201，.heic 83）' }),
        mk('tool', { tool: 'write_file', input: 'organize.py', status: 'done', output: '已写入 2.1 KB' }), mk('user', { text: '没有日期的照片也按修改时间分一下吧' }),
        mk('text', { text: '明白，没有 EXIF 的照片改用文件修改时间来归档。' }), mk('tool', { tool: 'run_command', input: 'python organize.py --apply', status: 'done', output: 'moved 1284 files' }),
        mk('result', { text: '整理好了 **1,284** 张照片：\n- 按「年\\月」放进了对应文件夹\n- 没有拍摄日期的 37 张按修改时间归档\n\n脚本是 `organize.py`，以后可以重复使用。', files: ['organize.py'] })],
      result: '整理好了 1,284 张照片' },
    { title: '下载文件夹分类', status: 'interrupted', at: now - 5 * HR, instructions: '把「下载」文件夹按文件类型分到子文件夹里，重复文件列出来给我确认。',
      plan: [['扫描下载文件夹', 'done'], ['按类型分类', 'in_progress'], ['列出重复文件', 'pending']], steps: [mk('text', { text: '开始扫描「下载」文件夹……' }), mk('tool', { tool: 'glob', input: '**/*', status: 'done', output: '532 个文件' })] },
    { title: '番茄钟小工具', status: 'done', at: now - DAY - 3 * HR, instructions: '用一个 HTML 文件做一个番茄钟：25 分钟专注、5 分钟休息，有提示音。', plan: [['写页面', 'done'], ['加提示音', 'done']],
      steps: [mk('result', { text: '番茄钟做好了，双击 `pomodoro.html` 就能用～', files: ['pomodoro.html'] })], result: '番茄钟做好了' },
    { title: '竞品记账 App 调研报告', status: 'failed', at: now - 3 * DAY, instructions: '调研三款主流记账 App 的功能和定价，整理成 Markdown 报告。', plan: [['收集资料', 'done'], ['写报告', 'pending']],
      steps: [mk('error', { text: '网页读取失败次数太多，先停下来了。' })] },
    { title: '批量压缩图片脚本', status: 'cancelled', at: now - 6 * DAY, instructions: '写个脚本把文件夹里的 PNG 批量压缩成 WebP。', plan: [], steps: [mk('note', { text: '主人取消了任务' })] },
    { title: '给莓华做天气扩展', status: 'done', at: now - 20 * DAY, instructions: '做一个查询天气的扩展工具。', plan: [['写 manifest', 'done'], ['写 main.mjs', 'done']],
      steps: [mk('result', { text: '天气扩展做好了，需要在「技能与扩展」里审核启用。' })], result: '天气扩展做好了' },
  ];
  for (const [i, s] of seed.entries()) {
    const id = `job_seed${i}`;
    const task = {
      id, title: s.title, instructions: s.instructions, workspace: path.join(selftestDir(), 'workshop', id), source: i % 2 ? 'chat' : 'panel', status: s.status,
      createdAt: s.at - 20 * 60000, updatedAt: s.at, plan: s.plan.map(([text, status]) => ({ text, status })), steps: s.steps.map((x) => ({ ...x, ts: s.at - 10 * 60000 })),
      stepCount: s.steps.length, result: s.result || '', messages: [{ role: 'user', content: [{ type: 'text', text: `任务：${s.title}\n\n${s.instructions}` }] }],
    };
    fs.mkdirSync(task.workspace, { recursive: true });
    fs.writeFileSync(path.join(userDir('data', 'agent'), `${id}.json`), JSON.stringify(task));
    agents.index.data.tasks = agents.index.data.tasks.filter((t) => t.id !== id);
    agents.index.data.tasks.push(agents.summary(task));
  }
  agents.index.data.tasks.sort((a, b) => b.updatedAt - a.updatedAt);
  agents.index.save();
  // mock model for the workshop: write a file, then finish; a follow-up ("补充说明") finishes with an update
  const reqs = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body || '{}');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const call = (cid, name, args) => send({ choices: [{ delta: { tool_calls: [{ index: 0, id: cid, function: { name, arguments: JSON.stringify(args) } }] } }] });
      const end = (r) => { send({ choices: [{ delta: {}, finish_reason: r }] }); res.end('data: [DONE]\n\n'); };
      const msgs = j.messages || [];
      const isAgent = JSON.stringify(msgs.slice(0, 2)).includes('任务：');
      if (!isAgent) { send({ choices: [{ delta: { content: '好的～' } }] }); return end('stop'); }
      reqs.push(j);
      const last = msgs[msgs.length - 1] || {};
      const lastText = JSON.stringify(last.content || '');
      if (last.role === 'user' && lastText.includes('补充说明')) { call(`f${reqs.length}`, 'finish', { summary: '按你的补充改好啦：`hello.txt` 里加上了今天的日期。', files: ['hello.txt'], success: true }); return end('tool_calls'); }
      if (last.role === 'tool') { call(`f${reqs.length}`, 'finish', { summary: '做好啦！在工作目录里写了 `hello.txt`，里面是给主人的问候。', files: ['hello.txt'], success: true }); return end('tool_calls'); }
      call(`w${reqs.length}`, 'write_file', { path: 'hello.txt', content: '你好呀，主人！今天也辛苦啦。' }); return end('tool_calls');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  note('workshop: seeded history, mock model up');
  settings.patch({ ai: { preset: 'custom', provider: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'mock-model', autonomy: 'off', touchReplies: false }, agent: { permission: 'auto', workspaceRoot: path.join(selftestDir(), 'workshop') } });
  note('workshop: settings patched');
  const tOpen = Date.now();
  panelWindow.open('workshop');
  for (let i = 0; i < 40 && !panelWindow.win; i++) await sleep(100);
  const win = panelWindow.win;
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push('[panel] ' + e.message); });
  await panelLoaded(win);
  note(`workshop: panel loaded in ${Date.now() - tOpen} ms`);
  await sleep(800);
  const pjs = (code) => win.webContents.executeJavaScript(code, true);
  const go = async (hash, wait = 1200) => { await pjs(`location.hash = ${JSON.stringify('#' + hash)}; 1`); await sleep(wait); };
  const typeInto = (sel, text) => pjs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 0; const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); return 1; })()`);
  const enter = (sel) => pjs(`document.querySelector(${JSON.stringify(sel)})?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); 1`);
  await go('workshop/new', 1500);
  await shotWin(win, 'ws-01-new');
  note('history ' + JSON.stringify(await pjs(`({ days: [...document.querySelectorAll('.hist-day')].map((d) => d.textContent), items: document.querySelectorAll('.history .shelf-item').length,
    previews: [...document.querySelectorAll('.hist-preview')].slice(0, 2).map((e) => e.textContent), composerFocused: document.activeElement?.closest?.('.ws-composer') != null })`)));
  await typeInto('.ws-composer textarea', '帮我写一个小脚本，在工作目录里生成 hello.txt，内容是对主人的问候。');
  await pjs(`document.querySelector('.ws-composer-foot .link-btn')?.click(); 1`);
  await sleep(500);
  await shotWin(win, 'ws-02-compose-options');
  note('title preview ' + JSON.stringify(await pjs(`document.querySelector('.ws-title-preview')?.textContent || null`)));
  await typeInto('.hist-search input', '照片'); await sleep(400);
  note('search 照片 → ' + (await pjs(`[...document.querySelectorAll('.history .shelf-title')].map((e) => e.textContent).join(' | ')`)));
  await shotWin(win, 'ws-03-search');
  await typeInto('.hist-search input', ''); await sleep(300);
  await pjs(`[...document.querySelectorAll('.hist-filters .chip')].find((b) => b.textContent.includes('已完成'))?.click(); 1`); await sleep(300);
  note('filter 已完成 → ' + (await pjs(`[...document.querySelectorAll('.history .shelf-title')].map((e) => e.textContent).join(' | ')`)));
  await pjs(`document.querySelector('.hist-filters .chip')?.click(); 1`); await sleep(300);
  // Enter in the chat bar hands the job over: the first message becomes the task
  await enter('.ws-composer textarea');
  let created = null;
  for (let i = 0; i < 60 && !created; i++) { await sleep(300); const h = await pjs('location.hash'); if (/workshop\/job_/.test(h) && !h.includes('seed')) created = h.split('/').pop(); }
  note('created ' + created);
  const waitTask = async (pred, ms) => { const t0 = Date.now(); for (;;) { const t = agents.live.get(created)?.task || agents.get(created); if ((t && pred(t)) || Date.now() - t0 > ms) return t; await sleep(250); } };
  const t1 = created ? await waitTask((t) => t.status === 'done', 25000) : null;
  note(`task "${t1?.title}" status=${t1?.status} steps=${JSON.stringify(t1?.steps?.map((s) => s.kind + (s.tool ? ':' + s.tool : '')))} file=${t1 ? fs.existsSync(path.join(t1.workspace, 'hello.txt')) : false}`);
  await sleep(900);
  await shotWin(win, 'ws-04-task-done');
  await typeInto('.ws-composer textarea', '补充：文件里再加上今天的日期。');
  await enter('.ws-composer textarea');
  const t2 = created ? await waitTask((t) => t.status === 'done' && t.steps.some((s) => s.kind === 'user'), 25000) : null;
  note(`follow-up status=${t2?.status} steps=${JSON.stringify(t2?.steps?.map((s) => s.kind + (s.tool ? ':' + s.tool : '')))} model requests=${reqs.length}`);
  await sleep(900);
  await shotWin(win, 'ws-05-followup');
  note('history top ' + JSON.stringify(await pjs(`[...document.querySelectorAll('.history .shelf-item')].slice(0, 3).map((e) => e.querySelector('.shelf-title').textContent + ' | ' + (e.querySelector('.hist-preview')?.textContent || ''))`)));
  await go('workshop/job_seed0', 1300);
  await shotWin(win, 'ws-06-seeded-task');
  settings.patch({ app: { theme: 'dark' } });
  await go('workshop/new', 1300);
  await shotWin(win, 'ws-07-dark');
  await go('workshop/job_seed0', 1200);
  await shotWin(win, 'ws-08-dark-task');
  settings.patch({ app: { theme: 'light' } });
  server.close();
}

/** Drive real flows from the notebook against the mock model. */
async function functionalScenario({ win, go, note }) {
  const { settings } = await import('./settings.js');
  const { planner } = await import('./planner/planner.js');
  const { extensions } = await import('./ext/extensions.js');
  const { runTool } = await import('./ai/tools.js');
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const mock = await mockServer();
  settings.patch({ ai: { preset: 'custom', provider: 'openai', baseUrl: `http://127.0.0.1:${mock.port}/v1`, model: 'mock-model', autonomy: 'off', touchReplies: false }, agent: { permission: 'auto-edit', workspaceRoot: path.join(selftestDir(), 'workshop') } });

  // quick-add a todo through the UI
  await go('todos', 900);
  await js(`(() => { const el = document.querySelector('.quick-add input'); el.value = '界面里加的待办'; el.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), 50); return 1; })()`);
  await sleep(800);
  note('todo via UI: ' + planner.listTodos('all').some((t) => t.title === '界面里加的待办'));

  // chat from the notebook (streams a tool call, then a reply)
  await go('chat', 900);
  await js(`(() => { const el = document.querySelector('.composer textarea'); el.value = '后天上午十点和客户开会'; el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  await sleep(200);
  await js(`document.querySelector('.composer .send').click(); 1`);
  await sleep(700);
  await shotWin(win, 'f-chat-mid', note);
  await sleep(3000);
  await shotWin(win, 'f-chat-done', note);

  // workshop task with an approval card answered from the notebook's clip
  await go('workshop/new', 900);
  await js(`(() => { sessionStorage.removeItem('ws-draft'); if (!document.querySelector('.ws-opts')) document.querySelector('.ws-composer-foot .link-btn')?.click(); return 1; })()`);
  await sleep(300);
  await js(`(() => { const set = (sel, v) => { const el = document.querySelector(sel); if (!el) return; Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('.ws-opts .ws-opt input', '问候文件测试'); set('.ws-composer textarea', '在工作目录写一个 hello.txt，然后读出来确认。'); return 1; })()`);
  await sleep(250);
  await js(`document.querySelector('.ws-composer textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); 1`);
  let approved = false;
  for (let i = 0; i < 160; i++) {
    await sleep(250);
    const hasNote = await js(`!!document.querySelector('.clip .note.kind-approval')`);
    if (hasNote && !approved) {
      await shotWin(win, 'f-ws-approval', note);
      await js(`document.querySelector('.clip .note.kind-approval .btn.primary').click(); 1`);
      approved = true;
      note('workshop approval answered');
    }
    const status = await js(`document.querySelector('.task-title-row .pill')?.textContent || ''`);
    if (approved && /完成|没完成/.test(status)) { note('workshop status: ' + status); break; }
  }
  await sleep(600);
  await shotWin(win, 'f-ws-done', note);
  note('workshop approved via clip: ' + approved + ', final status ' + (await js(`document.querySelector('.task-title-row .pill')?.textContent || ''`)));

  // an AI-authored skill + extension: review, enable, execute in the extension host
  extensions.saveSkill({ name: '周报整理', description: '主人让我写周报时使用', body: '1. 用 todo_list 找出本周完成的待办\n2. 按项目分组总结\n3. 列出下周计划' }, 'ai');
  extensions.create({
    id: 'dice', name: '掷骰子', description: '掷一个或多个六面骰子', tools: [{ name: 'roll', description: '掷骰子', input_schema: { type: 'object', properties: { n: { type: 'integer' } } } }],
    code: 'export async function roll(input, ctx) {\n  const n = Math.max(1, Math.min(10, input.n || 1));\n  const dice = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));\n  await ctx.storage.set("last", dice);\n  return { dice, total: dice.reduce((a, b) => a + b, 0) };\n}\n',
  }, 'ai');
  await go('skills', 1000);
  await shotWin(win, 'f-skills-pending', note);
  await js(`document.querySelector('.ext-card .btn.primary').click(); 1`);
  await sleep(900);
  await shotWin(win, 'f-ext-review', note);
  await js(`document.querySelector('.dialog .dialog-actions .btn.primary').click(); 1`);
  const { listTools } = await import('./ai/tools.js');
  const t0 = Date.now();
  while (!listTools().some((t) => t.name === 'x_dice_roll') && Date.now() - t0 < 10000) await sleep(100);
  note(`extension registered after ${Date.now() - t0}ms`);
  const r = await runTool({ id: 't_dice', name: 'x_dice_roll', input: { n: 3 } }, { approve: async () => true });
  note('extension call: ' + JSON.stringify(r));
  await shotWin(win, 'f-skills-enabled', note);
  note(`mock requests: ${mock.requests.length}`);
  mock.server.close();
}

/**
 * Workshop robustness against a scripted model: a text-only reply (nudged), a 500 (retried), a reply cut off by
 * max tokens (continued), then finish; and a task cancelled mid-command that resumes with a repaired history.
 */
async function agentScenario({ note }) {
  const { settings } = await import('./settings.js');
  const { agents } = await import('./agent/agent.js');
  const reqs = { A: [], B: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body || '{}');
      const first = String(j.messages?.[1]?.content || '');
      const key = first.includes('任务A') ? 'A' : 'B';
      const n = reqs[key].push(j);
      const sse = () => res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const call = (id, name, args) => send({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] });
      const end = (reason) => { send({ choices: [{ delta: {}, finish_reason: reason }] }); res.end('data: [DONE]\n\n'); };
      if (key === 'A') {
        if (n === 1) { sse(); send({ choices: [{ delta: { content: '我先想一想要怎么做。' } }] }); return end('stop'); }
        if (n === 2) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"upstream overloaded"}}'); }
        if (n === 3) { sse(); call('a1', 'write_file', { path: 'a.txt', content: 'A' }); return end('tool_calls'); }
        if (n === 4) { sse(); send({ choices: [{ delta: { content: '写好了，接下来我要' } }] }); return end('length'); }
        sse(); call('a2', 'finish', { summary: '任务A完成', files: ['a.txt'], success: true }); return end('tool_calls');
      }
      if (n === 1) { sse(); call('b1', 'run_command', { command: 'Start-Sleep -Seconds 20' }); return end('tool_calls'); }
      sse(); call('b2', 'finish', { summary: '任务B完成', success: true }); return end('tool_calls');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  settings.patch({ ai: { preset: 'custom', provider: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock-model', autonomy: 'off' }, agent: { permission: 'auto', workspaceRoot: path.join(selftestDir(), 'workshop') } });
  const wait = async (id, pred, ms) => { const t0 = Date.now(); for (;;) { const t = agents.live.get(id)?.task || agents.get(id); if (pred(t)) return t; if (Date.now() - t0 > ms) return t; await sleep(200); } };

  const a = agents.start({ title: '任务A', instructions: '任务A：写 a.txt' });
  const ta = await wait(a.id, (t) => ['done', 'failed', 'paused'].includes(t?.status), 40000);
  note(`A status=${ta.status} result=${JSON.stringify(ta.result)} requests=${reqs.A.length}`);
  note('A steps: ' + JSON.stringify(ta.steps.map((s) => `${s.kind}${s.tool ? ':' + s.tool : ''}${s.kind === 'note' ? ':' + s.text.slice(0, 30) : ''}`)));
  const lastUser = (r) => { const m = [...(r?.messages || [])].reverse().find((x) => x.role === 'user'); return String(m?.content || '').slice(0, 40); };
  note(`A req2 nudged: ${lastUser(reqs.A[1]).includes('finish')}; req5 continued: ${lastUser(reqs.A[4]).includes('截断')}`);

  const b = agents.start({ title: '任务B', instructions: '任务B：运行一个长命令' });
  await wait(b.id, (t) => t?.steps?.some((s) => s.tool === 'run_command'), 15000);
  await sleep(800);
  agents.cancel(b.id);
  const tb0 = await wait(b.id, (t) => t?.status === 'cancelled', 10000);
  note(`B after cancel: ${tb0.status}`);
  agents.resume(b.id);
  const tb = await wait(b.id, (t) => ['done', 'failed'].includes(t?.status), 20000);
  const toolMsg = (reqs.B[1]?.messages || []).find((m) => m.role === 'tool');
  note(`B status=${tb.status} result=${JSON.stringify(tb.result)} requests=${reqs.B.length}; repaired tool msg: ${JSON.stringify(String(toolMsg?.content || '').slice(0, 40))}`);
  server.close();
}

let shotWin = async () => {};

/**
 * Runs in the pet renderer: freeze the given joint/field values, render one rig off-screen at quality q and return a
 * PNG data URL of the native-space crop composited over `bg` (premultiplied). `only` / `drop` filter pieces for debugging.
 */
function rigShot(p) {
  const { assets, renderer: r } = window.__meihua;
  const rig = assets.rig(p.rig || 'stand');
  if (!rig) return null;
  const saved = { j: {}, f: {}, pieces: rig.pieces, expr: [rig.expr, rig.prevExpr, rig.exprFade], blink: rig.blink.closed, mouth: rig.mouthShape };
  for (const id of Object.keys(rig.joints)) { saved.j[id] = rig.joints[id].a; rig.joints[id].a = p.joints?.[id] ?? (p.keep ? rig.joints[id].a : 0); }
  for (const id of Object.keys(rig.fields)) { saved.f[id] = rig.fields[id].a; rig.fields[id].a = p.fields?.[id] ?? (p.keep ? rig.fields[id].a : 0); }
  if (p.expr && rig.expressions[p.expr]) { rig.expr = p.expr; rig.prevExpr = null; rig.exprFade = 1; }
  rig.blink.closed = 0; rig.mouthShape = null;
  if (p.time != null) rig.time = p.time;
  if (p.only) rig.pieces = rig.pieces.filter((q) => q.kind === p.only);
  if (p.drop) rig.pieces = rig.pieces.filter((q) => !p.drop.includes(q.layer));
  if (p.dropHidden) rig.pieces = rig.pieces.filter((q) => q.kind !== 'hidden' || !p.dropHidden.includes(q.layer));
  if (p.keepLayers) rig.pieces = rig.pieces.filter((q) => p.keepLayers.includes(q.layer));
  const q = p.q || 2;
  const size = rig.targetSize(q);
  const tgt = r.target(size.w, size.h);
  rig.render(r, tgt, q);
  rig.pieces = saved.pieces;
  for (const id of Object.keys(saved.j)) rig.joints[id].a = saved.j[id];
  for (const id of Object.keys(saved.f)) rig.fields[id].a = saved.f[id];
  [rig.expr, rig.prevExpr, rig.exprFade] = saved.expr; rig.blink.closed = saved.blink; rig.mouthShape = saved.mouth;
  const gl = r.gl, w = tgt.w, h = tgt.h;
  const px = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fbo);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(tgt.fbo); gl.deleteTexture(tgt.tex);
  const mg = rig.margin;
  const [cx, cy, cw, ch] = p.crop || [-mg, -mg, rig.W + 2 * mg, rig.H + 2 * mg];
  const x0 = Math.round((cx + mg) * q), y0 = Math.round((cy + mg) * q), W = Math.round(cw * q), H = Math.round(ch * q);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const bg = p.bg || [128, 104, 92];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x0 + x, sy = y0 + y, o = (y * W + x) * 4;
    let c0 = bg[0], c1 = bg[1], c2 = bg[2];
    if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
      const i = ((h - 1 - sy) * w + sx) * 4, a = px[i + 3] / 255;
      c0 = px[i] + bg[0] * (1 - a); c1 = px[i + 1] + bg[1] * (1 - a); c2 = px[i + 2] + bg[2] * (1 - a);
    }
    img.data[o] = c0; img.data[o + 1] = c1; img.data[o + 2] = c2; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

export function selftestDir() {
  const arg = process.argv.find((a) => a.startsWith('--selftest='));
  return arg ? path.resolve(arg.slice('--selftest='.length)) : null;
}

export async function runSelftest({ outDir, petWindow, panelWindow }) {
  fs.mkdirSync(outDir, { recursive: true });
  const log = [];
  const note = (m) => { log.push(`${new Date().toISOString().slice(11, 23)} ${m}`); console.log('[selftest]', m); };
  const pet = () => petWindow.win;
  const js = (code) => pet().webContents.executeJavaScript(code, true);
  const shot = async (name, win = pet()) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
    note(`captured ${name} ${img.getSize().width}x${img.getSize().height}`);
  };
  const errors = [];
  pet().webContents.on('console-message', (e) => { const { level, message } = e; if (level === 'error' || level === 3) errors.push(message); });
  // --selftest-dpr=2: notebook screenshots at twice the resolution (through the DevTools protocol, so the window
  // itself does not have to fit a 2x surface on the screen)
  const dpr = +(process.argv.find((a) => a.startsWith('--selftest-dpr='))?.split('=')[1] || 0);
  const hiShot = async (name, win) => {
    const wc = win.webContents, [w, h] = win.getContentSize();
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
    await sleep(350);
    const { data } = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
    note(`captured ${name} ${w * dpr}x${h * dpr}`);
  };
  shotWin = (win, name) => (dpr > 1 && win !== pet() ? hiShot(name, win) : shot(name, win));
  try {
    await sleep(2500);
    // an unattended test machine counts as idle: keep the auto-sleep (sit, then sleep) out of every scenario
    await js(`(() => { const b = __meihua.behavior, gs = b.getSettings;
      b.getSettings = () => { const s = gs(); return { ...s, pet: { ...s.pet, autoSleepMinutes: 0 } }; }; return 1; })()`);
    if (process.argv.includes('--selftest-panel')) {
      await panelScenario({ panelWindow, note, errors });
      note('renderer errors: ' + JSON.stringify(errors.slice(0, 30)));
      fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'));
      app.exit(0);
      return;
    }
    if (process.argv.includes('--selftest-life')) {
      await lifeScenario({ js, shot, note, panelWindow, errors });
      note('renderer errors: ' + JSON.stringify(errors.slice(0, 30)));
      fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'));
      app.exit(0);
      return;
    }
    if (process.argv.includes('--selftest-motion')) {
      await motionScenario({ js, shot, note, panelWindow, petWindow, errors });
      note('renderer errors: ' + JSON.stringify(errors.slice(0, 30)));
      fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'));
      app.exit(0);
      return;
    }
    if (process.argv.includes('--selftest-agent')) {
      await agentScenario({ note });
      fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'));
      app.exit(0);
      return;
    }
    if (process.argv.includes('--selftest-ai')) {
      await aiScenario({ js, shot, note, sleep });
      note('renderer errors: ' + JSON.stringify(errors.slice(0, 20)));
      fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'));
      app.exit(0);
      return;
    }
    const rigArg = process.argv.find((a) => a.startsWith('--selftest-rig='));
    if (rigArg) {
      // posed rig renders for checking part interactions (poses from a JSON file)
      const poses = JSON.parse(fs.readFileSync(rigArg.slice('--selftest-rig='.length), 'utf8'));
      await js(`__meihua.behavior.nextIdle = 1e9; 1`);
      for (const p of poses) {
        if (p.rig && p.rig !== 'stand') await js(`__meihua.assets.loadRig(${JSON.stringify(p.rig)}).then(() => 1)`);
        const url = await js(`(${rigShot.toString()})(${JSON.stringify(p)})`);
        if (!url) { note(`rig ${p.name}: no rig`); continue; }
        fs.writeFileSync(path.join(outDir, `${p.name}.png`), Buffer.from(url.split(',')[1], 'base64'));
        note(`rig ${p.name}`);
      }
      note('renderer errors: ' + JSON.stringify(errors.slice(0, 20)));
      fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'));
      app.exit(0);
      return;
    }
    if (process.argv.includes('--selftest-walk')) {
      // per-tick sampler: with frame-locked root motion the pet may only move when the walk drawing changes,
      // and each move must equal that frame's planted-foot slide (rootMotion * scale)
      const sampler = `(() => { const c = __meihua.character, log = window.__walkLog = []; let last = null;
        const tick = () => { if (window.__walkLog !== log) return;
          if (c.mode === 'walk' && c.view.kind === 'seq' && c.view.id.startsWith('walk-')) { const s = [c.view.frame, c.root.x];
            if (!last || s[0] !== last[0] || s[1] !== last[1]) log.push(s); last = s; }
          requestAnimationFrame(tick); };
        requestAnimationFrame(tick); return 1; })()`;
      const lockCheck = `(() => { const c = __meihua.character, log = window.__walkLog || [];
        const def = __meihua.assets.seqDef(c.facing > 0 ? 'walk-right' : 'walk-left'), k = def.scale * c.s * c.walkStride, n = def.frames;
        let drift = 0, moves = 0, worst = 0;
        for (let i = 1; i < log.length; i++) { const [f0, x0] = log[i - 1], [f1, x1] = log[i], d = Math.abs(x1 - x0);
          if (f0 === f1) { if (d > 0.01) drift++; continue; }
          let want = 0; for (let f = f0; f !== f1; f = (f + 1) % n) want += def.rootMotion[f] * k;
          moves++; worst = Math.max(worst, Math.abs(d - want)); }
        window.__walkLog = null;
        return { samples: log.length, moves, driftWithinFrame: drift, worstStepErrorPx: +worst.toFixed(3), stride: +c.walkStride.toFixed(3) }; })()`;
      await shot('w-stand');
      // the turn drawings held one by one at the standing position (placement check against w-stand); idle
      // autonomy is held off meanwhile, so a random action cannot replace the view mid-capture
      await js(`__meihua.behavior.nextIdle = 1e9; 1`);
      for (const id of ['turn-right', 'turn-left']) {
        const n = await js(`(async () => { const d = __meihua.assets.seqDef(${JSON.stringify(id)}); if (!d) return 0; await __meihua.assets.ensure(${JSON.stringify(id)}); return d.frames; })()`);
        note(`${id}: ${n} frames`);
        for (let i = 0; i < n; i++) {
          await js(`__meihua.character.setView({ kind: 'seq', id: ${JSON.stringify(id)}, frame: ${i}, mirror: false }); 1`);
          await sleep(250);
          await shot(`t-${id.slice(5, 6)}${i}`);
        }
      }
      if (await js(`!!__meihua.assets.seqDef('turn-right')`)) { await js(`__meihua.character.stop(); __meihua.character.setView(__meihua.character.rigView('stand')); 1`); await sleep(300); }
      for (const [dir, tagName] of [['walk_right', 'r'], ['walk_left', 'l']]) {
        await js(sampler);
        note(`walk ${tagName} start x=${await js('Math.round(__meihua.character.root.x)')} distance 420`);
        await js(`__meihua.behavior.action(${JSON.stringify(dir)}, { distance: 420 }); 1`);
        for (let i = 0; i < 8; i++) {
          await sleep(i ? 160 : 260);
          const st = await js(`({ mode: __meihua.character.mode, pose: __meihua.character.pose, view: __meihua.character.view, fade: !!__meihua.character.fade, x: Math.round(__meihua.character.root.x), ready: __meihua.assets.isReady('walk-left'), sx: window.screenX })`);
          note(`walk ${tagName}${i} ${JSON.stringify(st)}`);
          await shot(`w-${tagName}${i}`);
        }
        for (let k = 0; k < 40 && (await js('__meihua.character.mode')) === 'walk'; k++) await sleep(100);
        note(`walk ${tagName} end x=${await js('Math.round(__meihua.character.root.x)')} mode=${await js('__meihua.character.mode')}`);
        note(`walk ${tagName} frame lock ${JSON.stringify(await js(lockCheck))}`);
        await sleep(600);
      }
      fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'));
      app.exit(0);
      return;
    }
    await shot('01-stand');
    await js(`__meihua.behavior.emote('happy', 5)`); await sleep(400);
    await shot('02-happy');
    await js(`__meihua.character.env.gazeX = 1; __meihua.behavior.getCursor = () => null; __meihua.behavior.emote('surprised', 5)`); await sleep(500);
    await shot('03-surprised');
    await js(`__meihua.ui.say('主人，下午三点有一个产品评审会，我已经帮你把资料整理到手账里了。要不要现在先看一眼？', { hold: 30 })`);
    await sleep(2600);
    await shot('04-bubble');
    await js(`__meihua.ui.hideBubble(); __meihua.ui.addCard({ id: 't1', kind: 'reminder', title: '喝一杯水吧', body: '已经连续工作 60 分钟啦，起来走走、喝点水～', meta: '15:00', actions: [{ id: 'done', label: '好的', style: 'primary' }, { id: 'snooze', label: '10 分钟后' }] })`);
    await sleep(700);
    await shot('05-card');
    await js(`__meihua.ui.removeCard('t1'); __meihua.ui.openRing(210, 330)`); await sleep(700);
    await shot('06-ring');
    await js(`__meihua.ui.store.set({ ring: { x: 210, y: 330, page: 'actions' } })`); await sleep(600);
    await shot('07-ring-actions');
    await js(`__meihua.ui.closeTransient(); __meihua.ui.openInput()`); await sleep(500);
    await shot('08-input');
    // actions are started without awaiting them (`; 1`), so each shot is taken a fixed time after the start
    const poseNote = async (name) => note(`${name} ${JSON.stringify(await js(`({ pose: __meihua.character.pose, mode: __meihua.character.mode, view: __meihua.character.view.id })`))}`);
    await js(`__meihua.ui.closeInput(); __meihua.behavior.action('sit'); 1`); await sleep(2600);
    await shot('09-sit'); await poseNote('09-sit');
    await js(`__meihua.behavior.action('sleep'); 1`); await sleep(2600);
    await shot('11-sleep'); await poseNote('11-sleep');
    await js(`__meihua.behavior.action('stand'); 1`); await sleep(2600);
    await shot('12-stand-again'); await poseNote('12-stand-again');
    await js(`__meihua.behavior.action('walk_left', { distance: 400 }); 1`); await sleep(900);
    await shot('13-walk'); await poseNote('13-walk');
    await sleep(3000);
    const st = await js(`({ pose: __meihua.character.pose, mode: __meihua.character.mode, root: __meihua.character.root, view: __meihua.character.view })`);
    note('state ' + JSON.stringify(st));
  } catch (err) {
    note('ERROR ' + (err.stack || err));
  }
  note('renderer errors: ' + JSON.stringify(errors.slice(0, 20)));
  fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n'));
  app.exit(0);
}
