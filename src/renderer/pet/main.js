// Character window entry: boot the renderer, wire main-process events, run the frame loop.
import { Renderer } from './gl.js';
import { Assets, loadManifest } from './assets.js';
import { Character } from './character.js';
import { Input } from './input.js';
import { Behavior } from './behavior.js';
import { Voice } from './voice.js';
import { mountUI } from './ui.js';
import { Fx } from './fx.js';

const api = window.meihua;

async function boot() {
  let settings = await api.invoke('settings.get');
  const getSettings = () => settings;
  const manifest = await loadManifest();
  const canvas = document.getElementById('stage');
  const renderer = new Renderer(canvas);
  renderer.resize(innerWidth, innerHeight, devicePixelRatio);
  const assets = new Assets(renderer, manifest);
  let geom = await api.invoke('pet.geometry');
  assets.setResolution(geom.scale, devicePixelRatio);

  const character = new Character(renderer, assets, manifest);
  character.setGeometry(geom);
  character.setDisplays(geom.displays);
  character.root = { ...geom.root };
  const applyFlags = (s) => {
    character.flags.gravity = s.pet.gravity;
    // gravity and bouncing both off: she may be tucked in below the taskbar line
    character.flags.sink = s.pet.gravity === false && s.pet.bounce === false;
  };
  applyFlags(settings);
  await assets.loadRig('stand');
  character.setView(character.rigView('stand'));

  const voice = new Voice(api);
  let cursor = null;
  api.on('pet:cursor', ({ x, y }) => { cursor = { x, y }; });

  let behavior = null;
  const fx = new Fx(document.body);
  const ui = mountUI(document.getElementById('ui'), {
    api, getSettings,
    onAction: (id, args) => onAction(id, args),
  });
  behavior = new Behavior({ character, ui, voice, api, manifest, getSettings, getCursor: () => cursor, fx });
  const input = new Input({ character, renderer, behavior, ui, api, getSettings });

  // Root moves (walking, falling) are mirrored to the window position by main.
  character.onRoot = (root) => api.send('pet.root', { x: root.x, y: root.y, loose: character.mode === 'fall' || character.mode === 'fly' || character.sunk, transient: character.mode === 'fly' });

  const toggle = async (path, onText, offText) => {
    const cur = path.split('.').reduce((o, k) => o?.[k], settings);
    const [a, b] = path.split('.');
    await api.invoke('settings.patch', { [a]: { [b]: !cur } });
    ui.toast(!cur ? onText : offText);
  };

  async function onAction(id, args = {}) {
    switch (id) {
      case 'send':
        try { await api.invoke('chat.send', { text: args.text, source: 'pet' }); }
        catch (err) { ui.say(String(err.message || err).replace(/^Error invoking remote method 'rpc': (Error: )?/, ''), { hold: 6 }); behavior.emote('worried', 3); }
        return undefined;
      case 'chat': behavior.openChat(); return undefined;
      case 'typing': behavior.onTyping(); return undefined;
      case 'notebook': return api.invoke('panel.open', args.page || 'today');
      case 'calendar': return api.invoke('panel.open', 'calendar');
      case 'settings': return api.invoke('panel.open', 'settings');
      case 'quiet': return toggle('pet.quiet', '安静模式：我会少说话、不乱跑', '安静模式已关闭');
      case 'wander': return toggle('pet.allowWander', '我会自己到处走走～', '我会乖乖待在原地');
      case 'lock': return toggle('pet.lockPosition', '位置已固定', '可以拖动我啦（按住右键）');
      case 'hide': return api.invoke('settings.patch', { pet: { visible: false } });
      case 'mic-start': return voice.startRecording();
      case 'mic-stop': return voice.stopRecording();
      case 'feed': {
        // main applies the food (stock or coins) and answers with what she ate; the act plays here
        const r = await api.invoke('life.feed', { food: args.food, buy: !!args.buy });
        if (!r?.ok) { ui.say(r?.message || '现在吃不了哦。', { hold: 4 }); if (r?.reason === 'full') behavior.emote('902', 2.5); return r; }
        ui.closeTray?.();
        behavior.feed(r.food);
        return r;
      }
      case 'checkin': {
        const r = await api.invoke('life.checkin');
        if (!r?.ok) { ui.say(r?.message || '今天已经签过到啦～', { hold: 4 }); behavior.emote('105', 2); return r; }
        behavior.emote('103', 3); character.hop(0.5);
        const a = character.lastAnchor;
        if (a) { fx.emit('sparkle', a.x, a.y + 40, { n: 8, spread: 50 }); fx.emit('text', a.x, a.y + 46, { text: `签到 +${r.coins} 莓果`, size: 14, life: 2 }); }
        ui.say(r.line || `签到成功！连续 ${r.streak} 天啦～`, { hold: 5 });
        return r;
      }
      case 'tray': return ui.openTray?.();
      default:
        if (id.startsWith('act:')) return behavior.action(id.slice(4));
        return undefined;
    }
  }

  // ---------------------------------------------------------- main-process events
  api.on('settings:changed', (s) => {
    settings = s;
    applyFlags(s);
  });
  api.on('pet:geometry', (g) => {
    geom = g;
    character.setGeometry(g);
    character.setDisplays(g.displays);
    character.root = { ...g.root };
    assets.setResolution(g.scale, devicePixelRatio);
  });
  api.on('pet:displays', (d) => character.setDisplays(d));
  api.on('chat:start', ({ turnId }) => { ui.beginTurn(turnId); behavior.setAiBusy(true); });
  api.on('chat:delta', ({ turnId, text }) => ui.delta(turnId, text));
  api.on('chat:tool', ({ turnId, label }) => ui.tool(turnId, label));
  api.on('chat:done', ({ turnId, text }) => { ui.endTurn(turnId, text); behavior.setAiBusy(false); });
  api.on('chat:error', ({ turnId, message }) => {
    ui.endTurn(turnId, null); behavior.setAiBusy(false);
    ui.say(message, { hold: 8 }); behavior.emote('worried', 4);
  });
  api.on('pet:emotion', ({ name, hold }) => behavior.emote(name, hold));
  api.on('pet:action', ({ name, args }) => behavior.action(name, args));
  api.on('pet:plan', ({ steps }) => behavior.runPlan(steps));
  api.on('pet:say', ({ text, emotion }) => { if (emotion) behavior.emote(emotion); ui.say(text, { source: 'ai' }); });
  api.on('pet:open-input', (opts) => behavior.openChat({ toggle: opts?.toggle !== false }));
  api.on('notify:card', (card) => {
    ui.addCard(card);
    if (card.kind === 'reminder') { behavior.emote('excited', 3); character.hop(0.6); }
    else if (card.kind === 'approval') behavior.emote('serious', 4);
    else if (card.kind === 'question') behavior.emote('curious', 4);
  });
  api.on('notify:dismiss', ({ id }) => ui.removeCard(id));
  api.on('agent:status', (st) => ui.setAgent(st));
  api.on('life:state', (st) => { behavior.setLife(st); ui.setLife?.(st); });
  api.on('life:feed', ({ food }) => behavior.feed(food));   // fed from the notebook
  api.invoke('life.get').then((st) => { behavior.setLife(st); ui.setLife?.(st); }).catch(() => {});
  api.on('ai:status', (st) => { behavior.aiDirected = !!(st?.configured && st.autonomy !== 'off'); });
  api.invoke('ai.status').then((st) => { behavior.aiDirected = !!(st?.configured && st.autonomy !== 'off'); }).catch(() => {});
  api.invoke('card.list').then((cards) => { for (const c of cards || []) ui.addCard(c); }).catch(() => {});

  // ---------------------------------------------------------- frame loop
  let last = performance.now();
  let frames = 0;
  const frame = (now) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    renderer.resize(innerWidth, innerHeight, devicePixelRatio);
    if (Math.abs(devicePixelRatio - assets.dpr) > 1e-3) assets.setResolution(geom.scale, devicePixelRatio);
    behavior.update(dt);
    character.update(dt);
    character.render();
    input.hitTest();
    ui.setHover(input.overChar && !input.dragging && !input.press && character.mode === 'idle');
    const anchor = character.anchor();
    ui.frame(dt, anchor, character.foot(), character.clipY);
    fx.frame(dt, anchor);
    if (++frames === 3) api.send('pet.ready', true);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Warm up the rest of the character in the background (most used first).
  const warm = async () => {
    const jobs = [
      () => assets.ensure('walk-right'), () => assets.ensure('walk-left'),
      ...['turn-right', 'turn-left'].filter((id) => assets.seqDef(id)).map((id) => () => assets.ensure(id)),
      () => assets.loadRig('sit'), () => assets.loadRig('sleep'),
      ...Object.keys(manifest.transitions || {}).map((id) => () => assets.ensure(id)),
    ];
    for (const job of jobs) {
      try { await job(); } catch (err) { console.warn('[warm]', err.message); }
      await new Promise((r) => setTimeout(r, 120));
    }
  };
  setTimeout(warm, 600);

  window.__meihua = { character, behavior, ui, assets, renderer, voice, input, fx };
}

boot().catch((err) => {
  console.error(err);
  api.send('pet.fatal', String(err?.stack || err));
});
