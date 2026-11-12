// 养成: Meihua's life stats — level and experience, berry coins (莓果), mood (心情), fullness (饱食度),
// intimacy (亲密度), daily check-in with streaks, and a little food shop. Everything the owner does with
// her (pats, chats, finished todos and workshop tasks, feeding, checking in) feeds into it; time passing
// makes her hungry, and hunger and loneliness pull her mood down. The state is shown on the character,
// in the notebook's 小窝 page and given to the AI so her replies match how she feels.
import { JsonStore } from '../store.js';
import { dataFile } from '../paths.js';
import { bus, rpc, broadcast } from '../bus.js';
import { settings } from '../settings.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r1 = (v) => Math.round(v * 10) / 10;

export const FOODS = [
  { id: 'strawberry', name: '草莓', price: 5, hunger: 8, mood: 6, xp: 3, level: 1, favorite: true, line: '酸酸甜甜的，最喜欢草莓了！' },
  { id: 'cookie', name: '巧克力曲奇', price: 8, hunger: 12, mood: 4, xp: 3, level: 1, line: '咔嚓咔嚓……好香！' },
  { id: 'milk', name: '鲜牛奶', price: 6, hunger: 10, mood: 3, xp: 2, level: 1, line: '咕嘟咕嘟，元气补充完毕～' },
  { id: 'onigiri', name: '饭团', price: 12, hunger: 26, mood: 3, xp: 4, level: 2, line: '饭团是元气的来源！' },
  { id: 'pudding', name: '焦糖布丁', price: 15, hunger: 14, mood: 10, xp: 5, level: 3, line: 'Q 弹 Q 弹的，好幸福～' },
  { id: 'taiyaki', name: '鲷鱼烧', price: 14, hunger: 18, mood: 7, xp: 5, level: 4, line: '从尾巴开始吃……还是从头开始呢？' },
  { id: 'macaron', name: '马卡龙', price: 20, hunger: 10, mood: 14, xp: 6, level: 5, line: '颜色好可爱，舍不得吃了……啊呜。' },
  { id: 'berry-milk', name: '草莓牛奶', price: 16, hunger: 14, mood: 12, xp: 6, level: 6, favorite: true, line: '草莓牛奶！是草莓牛奶！' },
  { id: 'omurice', name: '蛋包饭', price: 28, hunger: 45, mood: 10, xp: 9, level: 8, line: '上面画了爱心……是{name}画的吗？' },
  { id: 'ramen', name: '拉面', price: 30, hunger: 50, mood: 8, xp: 9, level: 10, line: '呼——好烫，但是好好吃！' },
  { id: 'shortcake', name: '草莓蛋糕', price: 36, hunger: 24, mood: 20, xp: 12, level: 12, favorite: true, line: '草莓蛋糕……是梦里才有的幸福！' },
  { id: 'parfait', name: '草莓芭菲', price: 45, hunger: 26, mood: 26, xp: 15, level: 15, favorite: true, line: '一层一层的草莓和奶油……今天是最棒的一天！' },
];
const FOOD = Object.fromEntries(FOODS.map((f) => [f.id, f]));
const ICON = (id) => `meihua://app/assets/app/foods/${id}.png`;

// daily caps keep the numbers meaningful (petting for an hour should not max out a level)
const CAPS = { xp: { pat: 30, chat: 60, todo: 60 }, coins: { chat: 20, todo: 40 }, intimacy: { pat: 20, chat: 20 } };
const INTIMACY = [[0, '初识'], [50, '熟悉'], [150, '亲近'], [400, '信赖'], [900, '形影不离']];

const xpNext = (level) => 60 + 40 * level;
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const moodLabel = (m) => (m >= 85 ? '超开心' : m >= 65 ? '开心' : m >= 45 ? '平静' : m >= 25 ? '有点低落' : '很失落');
const hungerLabel = (h) => (h >= 85 ? '饱饱的' : h >= 60 ? '刚刚好' : h >= 35 ? '有点饿' : h >= 15 ? '很饿' : '饿扁了');
const intimacyTitle = (v) => INTIMACY.reduce((t, [min, name]) => (v >= min ? name : t), INTIMACY[0][1]);

class Life {
  constructor() {
    this.store = new JsonStore(dataFile('pet-life.json'), {
      level: 1, xp: 0, coins: 60, mood: 72, hunger: 80, intimacy: 0,
      lastTick: Date.now(), lastInteract: Date.now(), bornAt: Date.now(),
      checkin: { last: '', streak: 0, best: 0, total: 0, days: [] },
      inventory: { strawberry: 2, cookie: 1 },
      stats: { pats: 0, feeds: 0, chats: 0, todos: 0, tasks: 0, flings: 0 },
      daily: { date: '', xp: {}, coins: {}, intimacy: {} },
      log: [], levelUpAt: 0, lastFed: null,
    });
    this.d = this.store.data;
    this.timer = null;
  }

  // ------------------------------------------------------------ time passing
  /** Hunger falls ~4/h; mood drifts toward what fullness and company allow. Offline time counts gently. */
  #tick(now = Date.now(), offline = false) {
    const d = this.d;
    const hours = Math.max(0, (now - (d.lastTick || now)) / HOUR);
    d.lastTick = now;
    if (hours <= 0) return;
    const rate = 4;
    if (offline) {
      // full rate for the first 8 h away, half after that, and never below 10 while she waits
      const h1 = Math.min(hours, 8), h2 = Math.max(0, hours - 8);
      d.hunger = Math.max(Math.min(d.hunger, 10), d.hunger - rate * h1 - rate * 0.5 * h2);
    } else d.hunger = Math.max(0, d.hunger - rate * hours);
    const lonely = now - (d.lastInteract || now) > 6 * HOUR ? 15 : 0;
    const target = clamp(38 + d.hunger * 0.37 - lonely - (d.hunger < 15 ? 15 : 0), 10, 80);
    const step = Math.min(Math.abs(target - d.mood), 3 * hours);
    d.mood += Math.sign(target - d.mood) * step;
    d.hunger = r1(d.hunger); d.mood = r1(clamp(d.mood, 0, 100));
  }

  start() {
    this.#tick(Date.now(), true);
    this.store.save();
    this.timer = setInterval(() => { this.#tick(); this.store.save(2000); this.#publish(); }, 60 * 1000);
    bus.on('todo:done', (t) => this.#gain('todo', { xp: 6, coins: 4, mood: 2, note: `完成待办「${String(t.title || '').slice(0, 30)}」` }));
    bus.on('agent:finished', (task) => { if (task.status === 'done') this.#gain('task', { xp: 15, coins: 10, mood: 4, intimacy: 2, note: `工坊完成「${String(task.title || '').slice(0, 30)}」` }); });
    bus.on('chat:user', () => this.#gain('chat', { xp: 3, coins: 1, mood: 1, intimacy: 1 }));
    this.#publish();
  }

  stop() { clearInterval(this.timer); this.store.flush(); }

  // ------------------------------------------------------------ gains
  #daily() {
    const today = dayKey();
    if (this.d.daily.date !== today) this.d.daily = { date: today, xp: {}, coins: {}, intimacy: {} };
    return this.d.daily;
  }

  /** Adds a capped amount of `kind` from `source` for today; returns what was actually granted. */
  #capped(kind, source, amount) {
    const cap = CAPS[kind]?.[source];
    if (cap == null || amount <= 0) return amount;
    const day = this.#daily();
    const used = day[kind][source] || 0;
    const got = Math.max(0, Math.min(amount, cap - used));
    day[kind][source] = used + got;
    return got;
  }

  #gain(source, { xp = 0, coins = 0, mood = 0, intimacy = 0, hunger = 0, note } = {}) {
    this.#tick();
    const d = this.d;
    d.lastInteract = Date.now();
    const statKey = { pat: 'pats', chat: 'chats', todo: 'todos', task: 'tasks', fling: 'flings' }[source];
    if (statKey) d.stats[statKey] = (d.stats[statKey] || 0) + 1;
    xp = this.#capped('xp', source, xp);
    coins = this.#capped('coins', source, coins);
    intimacy = this.#capped('intimacy', source, intimacy);
    d.coins += coins;
    d.intimacy += intimacy;
    d.mood = r1(clamp(d.mood + mood, 0, 100));
    d.hunger = r1(clamp(d.hunger + hunger, 0, 100));
    if (note) this.#log(note + (xp || coins ? `（${[xp && `经验 +${xp}`, coins && `莓果 +${coins}`].filter(Boolean).join('，')}）` : ''));
    const leveled = this.#addXp(xp);
    this.store.save(1500);
    this.#publish();
    return { xp, coins, leveled };
  }

  #addXp(xp) {
    const d = this.d;
    d.xp += xp;
    let leveled = false;
    while (d.xp >= xpNext(d.level)) {
      d.xp -= xpNext(d.level);
      d.level += 1;
      const bonus = 20 * d.level;
      d.coins += bonus;
      d.mood = clamp(d.mood + 12, 0, 100);
      d.levelUpAt = Date.now();
      leveled = true;
      const unlocked = FOODS.filter((f) => f.level === d.level).map((f) => f.name);
      this.#log(`升到了 Lv.${d.level}！奖励 ${bonus} 莓果${unlocked.length ? `，解锁了${unlocked.join('、')}` : ''}`);
      bus.emit('life:levelup', { level: d.level, unlocked });
    }
    return leveled;
  }

  #log(text) {
    this.d.log.unshift({ ts: Date.now(), text });
    if (this.d.log.length > 60) this.d.log.length = 60;
  }

  // ------------------------------------------------------------ actions
  /** Pet events from the character window. */
  event(ev) {
    switch (ev?.type) {
      case 'pat': return this.#gain('pat', { xp: 1, mood: 2, intimacy: 1 });
      case 'fling': return this.#gain('fling', { mood: -1 });
      case 'dizzy': return this.#gain('dizzy', { mood: -3 });
      default: return null;
    }
  }

  feed(id, { buy = false } = {}) {
    this.#tick();
    const d = this.d;
    const f = FOOD[id];
    if (!f) return { ok: false, message: '没有这种食物呢。' };
    if (f.level > d.level) return { ok: false, reason: 'locked', message: `${f.name}要到 Lv.${f.level} 才能解锁哦。` };
    if (d.hunger >= 96) return { ok: false, reason: 'full', message: '已经吃得饱饱的啦，吃不下了～' };
    const have = d.inventory[id] || 0;
    if (have > 0) d.inventory[id] = have - 1;
    else if (buy) {
      if (d.coins < f.price) return { ok: false, reason: 'coins', message: `莓果不够啦（需要 ${f.price}，现在有 ${d.coins}）。签到、聊天、完成待办都能攒莓果～` };
      d.coins -= f.price;
    } else return { ok: false, reason: 'stock', message: `${f.name}已经吃完了，在小窝的商店里可以买。` };
    const before = d.hunger;
    const fill = Math.min(f.hunger, 100 - d.hunger);
    // a favourite or a hungry tummy makes it taste better
    const joy = f.mood * (f.favorite ? 1.3 : 1) * (before < 35 ? 1.25 : 1);
    d.hunger = r1(clamp(d.hunger + f.hunger, 0, 100));
    d.mood = r1(clamp(d.mood + joy, 0, 100));
    d.intimacy += f.favorite ? 3 : 2;
    d.stats.feeds = (d.stats.feeds || 0) + 1;
    d.lastInteract = Date.now();
    d.lastFed = { id, ts: Date.now() };
    this.#log(`吃了${f.name}（饱食 +${Math.round(fill)}，心情 +${Math.round(joy)}）`);
    const leveled = this.#addXp(f.xp);
    this.store.save(800);
    this.#publish();
    const name = settings.get('user.callName') || '主人';
    // when the AI is going to answer in character, the canned line is left out
    const local = !this.aiWillReact?.();
    return {
      ok: true, leveled, hungerBefore: before,
      food: { id, name: f.name, icon: ICON(id), favorite: !!f.favorite, gain: `饱食 +${Math.round(fill)}`, line: local ? f.line.replaceAll('{name}', name) : '' },
    };
  }

  buy(id, n = 1) {
    const f = FOOD[id];
    const d = this.d;
    n = clamp(Math.floor(n) || 1, 1, 20);
    if (!f) throw new Error('没有这种食物');
    if (f.level > d.level) throw new Error(`Lv.${f.level} 解锁`);
    if (d.coins < f.price * n) throw new Error(`莓果不够（需要 ${f.price * n}）`);
    d.coins -= f.price * n;
    d.inventory[id] = (d.inventory[id] || 0) + n;
    this.#log(`买了 ${n} 份${f.name}（-${f.price * n} 莓果）`);
    this.store.save(800);
    this.#publish();
    return this.state();
  }

  checkin() {
    this.#tick();
    const d = this.d, c = d.checkin;
    const today = dayKey();
    if (c.last === today) return { ok: false, message: '今天已经签过到啦，明天也要来哦～', streak: c.streak };
    const yesterday = dayKey(Date.now() - DAY);
    c.streak = c.last === yesterday ? c.streak + 1 : 1;
    c.best = Math.max(c.best || 0, c.streak);
    c.total = (c.total || 0) + 1;
    c.last = today;
    c.days.push(today);
    if (c.days.length > 400) c.days.splice(0, c.days.length - 400);
    const coins = 20 + 5 * Math.min(c.streak - 1, 6);
    const xp = 20 + 2 * Math.min(c.streak, 10);
    d.coins += coins;
    d.mood = r1(clamp(d.mood + 8, 0, 100));
    d.intimacy += 3;
    d.lastInteract = Date.now();
    let gift = null;
    if (c.streak % 7 === 0) { gift = FOOD.shortcake; d.inventory.shortcake = (d.inventory.shortcake || 0) + 1; }
    this.#log(`签到成功，连续 ${c.streak} 天（莓果 +${coins}，经验 +${xp}${gift ? `，礼物：${gift.name}` : ''}）`);
    const leveled = this.#addXp(xp);
    this.store.save(500);
    this.#publish();
    const name = settings.get('user.callName') || '主人';
    const line = gift
      ? `连续签到 ${c.streak} 天！送${name}……啊不对，是我收到了草莓蛋糕！`
      : c.streak >= 3 ? `连续 ${c.streak} 天了，${name}真守约～` : `签到成功！今天也请多指教，${name}。`;
    return { ok: true, coins, xp, streak: c.streak, gift: gift?.name || null, leveled, line };
  }

  // ------------------------------------------------------------ views
  state() {
    const d = this.d;
    return {
      level: d.level, xp: d.xp, xpNext: xpNext(d.level), coins: d.coins,
      mood: Math.round(d.mood), hunger: Math.round(d.hunger), intimacy: d.intimacy,
      moodLabel: moodLabel(d.mood), hungerLabel: hungerLabel(d.hunger), intimacyTitle: intimacyTitle(d.intimacy),
      checkedToday: d.checkin.last === dayKey(), streak: d.checkin.last === dayKey() || d.checkin.last === dayKey(Date.now() - DAY) ? d.checkin.streak : 0,
      bestStreak: d.checkin.best || 0, totalCheckins: d.checkin.total || 0,
      inventory: { ...d.inventory }, stats: { ...d.stats }, levelUpAt: d.levelUpAt, lastFed: d.lastFed,
      days: Math.max(1, Math.ceil((Date.now() - d.bornAt) / DAY)),
    };
  }

  foods() {
    const d = this.d;
    return FOODS.map((f) => ({ ...f, icon: ICON(f.id), unlocked: f.level <= d.level, stock: d.inventory[f.id] || 0 }));
  }

  /** One line for the AI's <context>. */
  contextText() {
    const s = this.state();
    return `你的养成状态：Lv.${s.level}，心情 ${s.mood}/100（${s.moodLabel}），饱食度 ${s.hunger}/100（${s.hungerLabel}），亲密度 ${s.intimacy}（${s.intimacyTitle}），莓果 ${s.coins}；今天${s.checkedToday ? '已签到' : '还没签到'}${s.streak ? `，连续签到 ${s.streak} 天` : ''}。`;
  }

  #publish() {
    const s = this.state();
    if (this.lastSent && this.lastSent === JSON.stringify(s)) return;
    this.lastSent = JSON.stringify(s);
    broadcast('life:state', s);
  }

  registerRpc() {
    rpc('life.get', () => this.state());
    rpc('life.foods', () => this.foods());
    rpc('life.log', () => this.d.log.slice(0, 40));
    rpc('life.days', () => [...this.d.checkin.days]);
    rpc('life.event', (ev) => this.event(ev));
    rpc('life.buy', ({ food, n }) => this.buy(food, n));
    rpc('life.checkin', () => { const r = this.checkin(); if (r.ok) bus.emit('life:checkin', r); return r; });
    rpc('life.feed', ({ food, buy, from }) => {
      const r = this.feed(food, { buy });
      if (r.ok) {
        bus.emit('life:fed', { ...r, from });
        if (from === 'panel') broadcast('life:feed', { food: r.food });
      }
      return r;
    });
  }
}

export const life = new Life();
