// Behaviour layer: gaze, expressions, lip-sync, touch reactions, idle autonomy, sleep/wake,
// and the executor for commands issued by the AI (emotion tags, actions, multi-step plans).
import { mat } from './gl.js';
import { Idle, IDLE_ACTS } from './idle.js';
import { Reactor } from './reactor.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const LINES = {
  pat: ['唔……好舒服～', '再、再摸一下下也可以哦。', '嘿嘿，{name}的手好暖和。', '尾巴自己摇起来了……', '呼噜呼噜……啊，我不是猫啦！'],
  drag: ['哇、要带我去哪里？', '慢、慢一点嘛！', '飞起来啦——', '诶？要搬家吗？'],
  land: ['着陆成功！', '呼……安全落地。', '唔，有点晕乎乎的。'],
  put: ['这里视野不错呢。', '就待在这里吧。', '嗯，新位置！'],
  pull: {
    ear: ['耳朵不可以拉啦！', '呜……轻一点嘛。', '耳、耳朵很敏感的！'],
    tail: ['呀！尾巴不能突然抓！', '尾巴是很重要的！', '唔……{name}坏心眼。'],
    skirt: ['裙、裙子不行！', '{name}！！', '再这样我要生气了哦。'],
    hair: ['头发会乱掉的～', '要帮我梳头吗？'],
    hand: ['要牵手吗？', '嘿嘿，握手！'],
    leg: ['痒、好痒！', '脚不要抓啦。'],
  },
  wake: ['唔……{name}回来啦？', '啊，我没有偷懒哦，只是闭目养神……', '呼啊——睡得好香。'],
  sleepy: ['有点困了……', '呼啊——（打哈欠）', '眼皮好重……'],
  locked: ['现在位置是固定的哦，要在菜单里解锁才能搬我。'],
  idle: ['{name}在忙什么呢？', '要记得喝水呀。', '有需要随时叫我。', '今天也一起加油吧。', '（小声哼歌）', '坐久了要起来活动一下哦。'],
  poke: ['嗯？', '在呢在呢！', '怎么啦？', '嘿！'],
  fling: ['呀啊——！', '飞、飞起来了！！', '{name}！不要扔我啦——', '哇啊啊啊——'],
  bonk: ['呜哇！', '好痛！', '咚！', '撞、撞到了……'],
  dizzy: ['头、头好晕……', '眼前有星星在转……', '呜……世界在转圈圈。', '下次要轻一点扔哦……'],
  bounceFun: ['再来一次！……才怪啦。', '弹弹弹～有点好玩？', '呼，平安着陆！'],
  full: ['已经吃得饱饱的啦，吃不下了～', '肚子圆滚滚的，待会再吃吧。'],
  hungry: ['肚子饿扁了……', '{name}，有吃的吗……'],
};

const REACT = {
  head: { expr: '102', ears: 0.45, wag: 0.85, hold: 2.6 },
  'ear-left': { expr: '501', ears: -0.5, wag: 0.5, hold: 2.2 },
  'ear-right': { expr: '501', ears: -0.5, wag: 0.5, hold: 2.2 },
  hair: { expr: '302', ears: 0.2, wag: 0.5, hold: 2 },
  tail: { expr: '701', ears: -0.6, wag: 1, hold: 2.4, hop: 0.45 },
  skirt: { expr: '902', ears: -0.3, wag: 0.1, hold: 2.6 },
  'hand-left': { expr: '105', wag: 0.7, hold: 2 },
  'hand-right': { expr: '105', wag: 0.7, hold: 2 },
  'leg-left': { expr: '402', hold: 2 },
  'leg-right': { expr: '402', hold: 2 },
  'foot-left': { expr: '403a', ears: -0.3, hold: 1.8, hop: 0.3 },
  'foot-right': { expr: '403a', ears: -0.3, hold: 1.8, hop: 0.3 },
  face: { expr: '501', ears: -0.4, wag: 0.7, hold: 2.4 },
  chest: { expr: '701', ears: -0.85, wag: 0.25, hold: 2.8 },
  'thigh-left': { expr: '701', ears: -0.6, wag: 0.4, hold: 2.4 },
  'thigh-right': { expr: '701', ears: -0.6, wag: 0.4, hold: 2.4 },
  'calf-left': { expr: '403a', ears: -0.3, wag: 0.6, hold: 2, hop: 0.2 },
  'calf-right': { expr: '403a', ears: -0.3, wag: 0.6, hold: 2, hop: 0.2 },
  body: { expr: '403', ears: -0.3, hold: 1.8 },
};

// Stroking a part (moving back and forth over it, hovering or with the button held). Three levels as it goes on:
// lines, expression and mood per level; `fx` floats over her, `life` counts as affection, `lean` = she leans into the
// hand (otherwise the part's flinch from the reactor plays). Her character: loves head pats and holding hands; shy and
// flustered at the cheeks, chest and thighs (protests, then pouts), ticklish at the waist, calves and feet.
const RUB = {
  face: { lean: true, life: true, fx: 'heart', ears: -0.2, wag: 0.9, expr: ['501', '102a', '701a'],
    lines: [['唔……{name}的手软软的。', '脸、脸要烫起来了……'], ['（把脸颊轻轻蹭过去）……嘿嘿。', '再、再摸一下下也没关系……'], ['呜……一直摸脸的话，会害羞到说不出话的啦。']] },
  chest: { fx: 'sweat', ears: -0.9, wag: 0.3, expr: ['701', '701a', '902'], angry: true,
    lines: [['呀！？那、那里不行！', '{name}！手、手放错地方了啦！'], ['不、不可以一直摸那里……（抱住胸口）', '呜……{name}是笨蛋……'], ['哼！再这样我真的要生气了哦！（鼓起脸）']] },
  body: { fx: 'sparkle', ears: 0.1, wag: 0.8, expr: ['103', '105a', '302'], jiggle: true,
    lines: [['哈哈、好痒！'], ['不、不要挠了啦，哈哈哈……'], ['呼……呼……笑得没力气了……']] },
  thigh: { fx: 'sweat', ears: -0.7, wag: 0.4, expr: ['501', '701', '902'],
    lines: [['大、大腿……好痒……', '诶、诶？摸那里吗……'], ['{name}好坏……（拉住裙摆）'], ['再摸下去……人家要躲起来了啦！']] },
  calf: { fx: 'sparkle', ears: -0.2, wag: 0.7, expr: ['105a', '103', '701'], hop: 0.15,
    lines: [['嘻嘻，小腿痒痒的～'], ['不要沿着小腿摸啦，好痒～'], ['哈哈……腿要站不稳了……']] },
  foot: { fx: 'sparkle', ears: -0.3, wag: 0.8, expr: ['103', '701', '302'], hop: 0.3,
    lines: [['呀哈哈，脚心不行！'], ['痒、痒死了——{name}快住手！'], ['哈……哈……投降，我投降啦……']] },
  hand: { lean: true, life: true, fx: 'heart', ears: 0.2, wag: 1, expr: ['102a', '501', '102a'],
    lines: [['嘿嘿，被{name}牵住了。'], ['手指被一根一根摸过去了……好害羞。'], ['……不想放开了呢。']] },
  tail: { fx: 'heart', ears: -0.6, wag: 1, expr: ['701', '701a', '501'],
    lines: [['尾、尾巴好敏感……'], ['呜……尾巴根不可以……'], ['尾巴都摇成这样了，{name}满意了吧……（小声）']] },
  ear: { lean: true, life: true, fx: 'heart', ears: 0.55, wag: 0.8, expr: ['501', '302', '102a'],
    lines: [['耳朵……被摸得好舒服……'], ['唔……耳朵尖尖好痒。'], ['要、要融化掉了……']] },
  hair: { lean: true, life: true, ears: 0.3, wag: 0.7, expr: ['302', '102', '102a'],
    lines: [['被梳头发了……好舒服。'], ['{name}的手法好温柔。'], ['再梳一会儿嘛～']] },
  skirt: { fx: 'sweat', ears: -0.8, wag: 0.2, expr: ['701', '902', '902'], angry: true,
    lines: [['裙、裙子！'], ['{name}笨蛋！不许碰裙子！'], ['哼！（转过头去）']] },
};
const rubKind = (id) => (id.startsWith('ear') ? 'ear' : id === 'head' ? 'hair' : id.startsWith('hand') ? 'hand' : id.startsWith('thigh') ? 'thigh'
  : id.startsWith('calf') || id.startsWith('leg') ? 'calf' : id.startsWith('foot') ? 'foot' : RUB[id] ? id : 'body');

const pullKind = (id) => (id.startsWith('ear') ? 'ear' : id === 'tail' ? 'tail' : id === 'skirt' ? 'skirt' : id === 'hair' ? 'hair' : id.startsWith('hand') ? 'hand' : 'leg');

export class Behavior {
  constructor({ character, ui, voice, api, manifest, getSettings, getCursor, fx }) {
    this.c = character; this.ui = ui; this.voice = voice; this.api = api; this.m = manifest;
    this.getSettings = getSettings; this.getCursor = getCursor;
    this.fx = fx;
    this.idle = new Idle({ character, behavior: this, fx });
    this.reactor = new Reactor({ character });
    this.pendingTouch = null;     // speech / AI note of a single click, held back in case it becomes a double-click
    this.life = { mood: 70, hunger: 70, intimacy: 0, level: 1 };
    this.cursorMovedAt = 0; this.lastCursor = null;
    character.onFling = (speed) => this.#onFling(speed);
    character.onImpact = (side, speed) => this.#onImpact(side, speed);
    this.mood = { wag: 0.25, ears: 0 };
    this.moodTarget = { wag: 0.25, ears: 0 };
    this.c.env.mood = this.mood;
    this.expr = { id: '101', until: 0 };
    this.nextIdle = rand(8, 16);
    this.lastSay = 0;
    this.pats = { n: 0, last: 0 };
    this.systemIdle = 0;
    this.sleepingByIdle = false;
    this.lookOverride = null;
    this.planToken = null;
    this.aiBusy = false;
    this.headTilt = { v: 0, until: 0 };
    this.lastState = '';
    this.idleTimer = setInterval(() => this.#pollIdle(), 5000);
  }

  get rig() { return this.c.rig; }
  get standRig() { return this.c.a.rig('stand'); }
  get name() { return this.getSettings().user?.callName || '主人'; }
  line(s) { return s.replaceAll('{name}', this.name); }

  // ------------------------------------------------------------ speech & expression
  say(text, { hold, force = false } = {}) {
    const now = performance.now();
    if (!force && now - this.lastSay < 1800) return;
    if (!force && this.getSettings().pet.quiet) return;
    this.lastSay = now;
    this.ui.say(this.line(text), { source: 'local', hold });
  }

  /** emotion: a name from the manifest's emotion table or a raw expression id. */
  emote(emotion, hold = 3.2) {
    if (!emotion) return;
    const ex = this.m.expressions;
    const id = ex.emotions[emotion] || (ex.catalogue[emotion] ? emotion : null);
    if (!id) return;
    this.expr = { id, until: performance.now() + hold * 1000 };
    this.standRig?.setExpression(id);
    const e = String(emotion);
    if (/happy|joy|cheer|excited|love|touched|proud|10[235]|401/.test(e)) this.moodTarget = { wag: 0.85, ears: 0.15 };
    else if (/shy|fluster|embarr|50|70/.test(e)) this.moodTarget = { wag: 0.55, ears: -0.45 };
    else if (/sad|worried|sleepy|90[12]|301a/.test(e)) this.moodTarget = { wag: 0.08, ears: 0.8 };
    else if (/surpris|puzzled|curious|40[23]|104/.test(e)) this.moodTarget = { wag: 0.4, ears: -0.7 };
    else this.moodTarget = { wag: 0.3, ears: 0 };
    this.moodUntil = performance.now() + hold * 1000;
  }

  #baseExpression() {
    const h = new Date().getHours();
    const { mood = 70, hunger = 70 } = this.life;
    if (this.c.pose === 'sleep') return '602';
    if (this.aiBusy) return '301';
    if (hunger < 15 || mood < 20) return '301a';
    if (mood < 35) return Math.random() < 0.5 ? '902' : '601';
    if (h >= 23 || h < 6) return Math.random() < 0.5 ? '901' : '101';
    if (mood > 85 && Math.random() < 0.35) return '102';
    return '101';
  }

  /** Resting tail wag / ear set for the current mood. */
  #restMood() {
    const { mood = 70, hunger = 70 } = this.life;
    if (this.aiBusy) return { wag: 0.15, ears: -0.15 };
    const m = Math.min(mood, hunger + 25) / 100;
    return { wag: 0.08 + m * 0.42, ears: m < 0.3 ? 0.55 : m < 0.5 ? 0.2 : 0 };
  }

  /** Nurture state from main: { mood, hunger, intimacy, level, ... }. */
  setLife(s) {
    if (!s) return;
    const before = this.life;
    this.life = { ...this.life, ...s };
    if (!this.moodUntil) this.moodTarget = this.#restMood();
    if (before.level && s.level > before.level && s.levelUpAt && Date.now() - s.levelUpAt < 10000) this.levelUp(s.level);
  }

  levelUp(level) {
    const c = this.c;
    this.idle.cancel();
    this.emote('103', 3.5);
    if (!c.airborne) { c.hop(0.6); setTimeout(() => c.hop(0.45), 650); }
    const a = c.lastAnchor;
    if (a) {
      this.fx?.emit('star', a.x, a.y + 10, { n: 10 });
      this.fx?.emit('sparkle', a.x, a.y + 40, { n: 8, spread: 60 });
      this.fx?.emit('text', a.x, a.y - 4, { text: `Lv.${level}！`, size: 18, life: 2.2, color: '#f0508a' });
    }
    this.say(`升级啦！现在是 Lv.${level} 了～ 谢谢{name}一直陪着我！`, { force: true, hold: 5 });
  }

  /** Plays the eating act for a food that main has already applied. */
  async feed(food) {
    const c = this.c;
    this.cancelPlan();
    if (c.pose === 'sleep') await this.wake();
    if (c.pose !== 'stand') await c.run((t) => c.goPose('stand', c.facing, t));
    if (c.isBusy()) c.stop();
    let img = null;
    if (food.icon) { img = new Image(); img.src = food.icon; }
    this.expr.until = performance.now() + 4000;
    if (!this.idle.start('eat', { food: { ...food, img } })) {
      this.emote('102', 2.5);
      const a = c.lastAnchor;
      if (a) this.fx?.emit('heart', a.x, a.y + 20, { n: 3 });
    }
    if (food.line) setTimeout(() => this.say(food.line, { force: true }), 2700);
  }

  // ------------------------------------------------------------ thrown / bouncing
  #onFling(speed) {
    this.idle.cancel();
    this.emote(speed > 2200 ? '701' : '403', 30);
    this.moodTarget = { wag: 0.9, ears: -0.9 };
    this.moodUntil = performance.now() + 60000;
    if (Math.random() < 0.7) this.say(pick(LINES.fling), { force: true });
    this.api.send('pet.event', { type: 'fling', speed: Math.round(speed), silent: true });
    this.api.send('life.event', { type: 'fling' });
  }

  #onImpact(side, speed) {
    const a = this.c.lastAnchor;
    if (a && speed > 900) {
      const k = this.c.s / 0.36;
      const x = side === 'left' ? a.x - 70 * k : side === 'right' ? a.x + 70 * k : a.x;
      const y = side === 'top' ? a.y : side === 'floor' ? a.y + 330 * k : a.y + 120 * k;
      this.fx?.emit('star', x, y, { n: Math.min(7, 2 + Math.floor(speed / 700)) });
      this.fx?.emit('puff', x, y, { n: 3 });
    }
    if (side !== 'floor' && speed > 1200) {
      this.emote('701', 2);
      if (Math.random() < 0.5) this.say(pick(LINES.bonk), { force: true });
    }
    this.standRig?.poke('head', Math.min(1.6, speed / 1500), side === 'left' ? -1 : side === 'right' ? 1 : 0);
  }

  // ------------------------------------------------------------ input reactions
  onTouch(part, info) {
    if (this.c.mode === 'walk') { this.cancelPlan(); this.c.stop(); }
    else if (this.c.isBusy()) return;
    if (this.c.pose === 'sleep') { this.wake(); return; }
    this.idle.cancel();
    const rig = this.rig;
    if (!part) { this.emote('surprised', 1.4); this.c.squash(0.05); this.reactor.touch('body', 0, 0.6); return; }
    const r = REACT[part.id] || REACT.body;
    rig?.poke(part.id, 1, part.side);
    // the whole body answers the touch (flinch, turn, duck, look) — not only the touched part
    this.reactor.touch(part.id, part.side, 1);
    if (this.c.pose === 'stand') this.emote(r.expr, r.hold);
    this.moodTarget = { wag: r.wag ?? this.moodTarget.wag, ears: r.ears ?? this.moodTarget.ears };
    this.moodUntil = performance.now() + (r.hold || 2) * 1000;
    // jelly: a poke on the body wobbles her; a side poke wobbles sideways
    if (r.hop) this.c.hop(r.hop);
    else if (part.id === 'body' || part.id === 'skirt') this.c.jiggle(0.07, part.side || (Math.random() < 0.5 ? -1 : 1));
    else this.c.squash(0.05);
    if (part.id === 'head' || part.id.startsWith('hand')) { const a = this.c.lastAnchor; if (a && Math.random() < 0.6) this.fx?.emit('heart', a.x, a.y + 30, { n: 1 }); }
    // speech and the AI note wait out the double-click window: a double-click opens the chat instead
    const s = this.getSettings();
    clearTimeout(this.pendingTouch);
    this.pendingTouch = setTimeout(() => {
      this.pendingTouch = null;
      if (this.ui.inputOpen) return;
      if (Math.random() < 0.55) this.say(part.phrase || pick(LINES.poke));
      if (s.ai?.touchReplies) this.api.send('pet.event', { type: 'touch', part: part.id, label: part.label });
    }, 340);
  }

  /** Pointer over the head while stroking (window px). */
  onStroke(x, y) {
    if (this.c.pose === 'sleep') return;
    const [nx, ny] = this.c.toNative(x, y);
    this.reactor.stroke(nx, ny);
  }

  /** A key typed into the quick chat: she listens, nodding now and then. */
  onTyping() {
    const now = performance.now();
    if (now - (this.lastNod || 0) < 650) return;
    this.lastNod = now;
    if (Math.random() < 0.55) this.reactor.nod(0.8 + Math.random() * 0.5);
    if (Math.random() < 0.25) this.rig?.kick(Math.random() < 0.5 ? 'ear-left' : 'ear-right', Math.random() < 0.5 ? 1 : -1, 0.3);
  }

  onPat({ hover, part }) {
    const now = performance.now();
    if (this.c.pose === 'sleep') { if (!hover) this.wake(); return; }
    this.pats.n = now - this.pats.last < 1600 ? this.pats.n + 1 : 1;
    this.pats.last = now;
    this.idle.cancel();
    const a = this.c.lastAnchor;
    if (a && this.pats.n % 2 === 0) this.fx?.emit('heart', a.x + (Math.random() - 0.5) * 40, a.y + 10, { n: 1 });
    if (this.pats.n === 1 || this.pats.n % 3 === 0) this.api.send('life.event', { type: 'pat' });
    const rig = this.rig;
    rig?.poke(part === 'head' ? 'head' : part, 0.5, 0);
    this.reactor.pat();
    this.moodTarget = { wag: 1, ears: 0.6 };
    this.moodUntil = now + 3000;
    if (this.c.pose === 'stand') this.emote(this.pats.n > 2 ? '302' : '102', 3);
    if (this.pats.n === 3) {
      this.say(pick(LINES.pat), { force: true });
      if (this.getSettings().ai?.touchReplies) this.api.send('pet.event', { type: 'pat' });
    }
  }

  /**
   * Strokes over a part other than the head (Input counts the back-and-forth). info.part: the part hit; info.hover:
   * without the button; info.x/y: the pointer (window px). Escalates over one stroking session (gaps < 2.5 s).
   */
  onRub(part, info = {}) {
    if (!part) return;
    const c = this.c, now = performance.now();
    if (c.pose === 'sleep') { if (!info.hover) this.wake(); else if (Math.random() < 0.15) this.say('唔……{name}……（翻了个身）'); return; }
    if (c.isBusy()) return;
    const kind = rubKind(part.id), R = RUB[kind];
    const r = this.rub && this.rub.kind === kind && now - this.rub.last < 2500 ? this.rub : { kind, n: 0, said: -1, first: now };
    r.n++; r.last = now; this.rub = r;
    const level = r.n < 3 ? 0 : r.n < 7 ? 1 : 2;
    this.idle.cancel();
    clearTimeout(this.pendingTouch); this.pendingTouch = null;
    // body: lean into a welcome hand (it follows the pointer), otherwise the part's flinch, a little weaker each time
    const rig = this.rig;
    if (R.lean && info.x != null) this.onStroke(info.x, info.y);
    if (r.n === 1 || r.n % 3 === 0) {
      rig?.poke(part.id, 0.6, part.side);
      if (!R.lean || r.n === 1) this.reactor.touch(part.id, part.side, level === 2 && !R.lean ? 1.1 : 0.7);
      if (R.jiggle) this.c.jiggle(0.05, part.side || 1);
      if (R.hop && r.n % 6 === 0) this.c.hop(R.hop);
    }
    if (c.pose === 'stand') this.emote(R.expr[level], 2.6);
    this.moodTarget = { wag: R.wag, ears: R.ears };
    this.moodUntil = now + 2600;
    // effects over the touched spot
    const a = c.lastAnchor;
    if (R.fx && a && r.n % 2 === 1) {
      const x = info.x ?? a.x, y = info.y ?? a.y + 20;
      if (R.fx === 'sweat') this.fx?.emit('sweat', a.x + 18 * c.s / 0.36, a.y + 34 * c.s / 0.36, { n: 1 });
      else this.fx?.emit(R.fx, x + (Math.random() - 0.5) * 20, y - 10, { n: 1 });
    }
    if (R.angry && level === 2 && r.n % 3 === 0 && a) this.fx?.emit('anger', a.x + 24 * c.s / 0.36, a.y + 18 * c.s / 0.36, { n: 1 });
    if (R.life && (r.n === 1 || r.n % 4 === 0)) this.api.send('life.event', { type: 'pat' });
    // words: once per level (the AI answers the longer strokes when touch replies are on)
    const ai = this.getSettings().ai?.touchReplies;
    if (r.said < level && !this.ui.inputOpen) {
      r.said = level;
      if (ai && level === 1) this.api.send('pet.event', { type: 'stroke', part: part.id, label: part.label, count: r.n });
      else this.say(pick(R.lines[level]), { force: level > 0 || now - this.lastSay > 1200 });
    }
  }

  onPullStart(part) {
    this.idle.cancel();
    clearTimeout(this.pendingTouch); this.pendingTouch = null;
    this.reactor.pullStart(part.id);
    this.emote(part.id === 'tail' || part.id === 'skirt' ? 'flustered' : part.id.startsWith('hand') ? 'curious' : 'surprised', 2.5);
    this.moodTarget = { wag: part.id.startsWith('hand') ? 0.7 : 0.2, ears: -0.7 };
    this.moodUntil = performance.now() + 2500;
  }

  onPullRelease(part, dist) {
    const kind = pullKind(part.id);
    this.reactor.pullRelease(part.id, dist);
    if (dist > 30) this.say(pick(LINES.pull[kind]), { force: true });
    this.emote(kind === 'hand' ? 'happy' : kind === 'skirt' ? 'pout' : 'shy', 2.4);
    if (this.getSettings().ai?.touchReplies && dist > 30) this.api.send('pet.event', { type: 'pull', part: part.id });
  }

  onDoubleClick() {
    clearTimeout(this.pendingTouch); this.pendingTouch = null;
    this.openChat({ greet: true });
  }

  /**
   * Opens the quick chat. From the hotkey (`toggle`) a second press puts it away again. While she is being
   * carried or is flying the box waits until she has landed; a sleeping pet wakes up for it.
   */
  openChat({ toggle = false, greet = false } = {}) {
    if (toggle && this.ui.inputFocused) { this.ui.closeInput(true); return; }
    if (this.c.airborne) { this.chatAfterLanding = true; this.ui.toast('等我落地就来听你说～', 1600); return; }
    this.idle.cancel();
    if (this.c.pose === 'sleep') this.wake();
    else if (greet || !this.ui.inputOpen) {
      this.emote('curious', 3);
      // perks up toward the owner: a little hop, head tilt, ears up
      this.reactor.pose({ head: 0.04, headDy: -1.5, rise: -3, ey: 0.01 }, [0.1, 0.8, 0.6], { gaze: { x: 0, y: -0.4 } });
      this.moodTarget = { wag: 0.8, ears: -0.6 }; this.moodUntil = performance.now() + 2500;
      if (greet && this.c.mode === 'idle') this.c.hop(0.3);
    }
    if (this.c.mode === 'walk') { this.cancelPlan(); this.c.stop(); }
    this.ui.openInput();
  }

  onDragStart() {
    this.cancelPlan();
    this.idle.cancel();
    this.emote(Math.random() < 0.5 ? 'surprised' : 'flustered', 30);
    this.moodTarget = { wag: 0.6, ears: -0.8 };
    this.moodUntil = performance.now() + 60000;
    if (Math.random() < 0.5) this.say(pick(LINES.drag));
  }

  onDragEnd() {
    this.moodUntil = performance.now() + 1500;
    this.expr.until = performance.now() + 1500;
    if (this.c.mode === 'fly') {
      this.c.landed = ({ flight } = {}) => {
        this.c.landed = null;
        const hits = flight?.hits || 0;
        const a = this.c.lastAnchor;
        if (hits >= 2) {
          // dizzy after bouncing around: stars over the head, a wobble, a complaint
          this.emote('402', 3.5);
          this.fx?.dizzy(2.8);
          if (a) this.fx?.emit('sweat', a.x + 30, a.y + 40, {});
          this.moodTarget = { wag: 0.1, ears: 0.7 }; this.moodUntil = performance.now() + 3500;
          this.say(pick(LINES.dizzy), { force: true });
          this.api.send('life.event', { type: 'dizzy', hits });
        } else {
          this.emote(Math.random() < 0.5 ? '105' : '402', 2.5);
          if (Math.random() < 0.6) this.say(pick(hits ? LINES.bounceFun : LINES.land));
        }
        this.#reportState(true);
      };
    } else if (this.c.mode === 'fall') {
      this.c.landed = () => { this.c.landed = null; this.emote(Math.random() < 0.5 ? 'puzzled' : 'happy', 2.5); if (Math.random() < 0.6) this.say(pick(LINES.land)); this.#reportState(true); };
    } else {
      this.emote('happy', 2.2);
      if (Math.random() < 0.35) this.say(pick(LINES.put));
      this.#reportState(true);
    }
    this.nextIdle = rand(10, 20);
  }

  onLockedDrag() { this.ui.toast(LINES.locked[0], 2600); this.c.squash(0.05); }

  // ------------------------------------------------------------ sleep / wake
  async sleep() {
    if (this.c.pose === 'sleep') return;
    await this.c.run(async (token) => { await this.c.goPose('sleep', this.c.facing, token); });
  }

  async wake() {
    if (this.c.pose !== 'sleep') return;
    this.sleepingByIdle = false;
    const ok = await this.c.run(async (token) => { await this.c.goPose('sit', this.c.facing, token); await this.c.wait(token, 0.6); await this.c.goPose('stand', this.c.facing, token); });
    if (ok) { this.emote('sleepy', 2.5); this.say(pick(LINES.wake), { force: true }); }
  }

  async #pollIdle() {
    try { this.systemIdle = await this.api.invoke('system.idle'); } catch { return; }
    const s = this.getSettings().pet;
    const limit = (s.autoSleepMinutes || 0) * 60;
    if (limit > 0 && this.systemIdle >= limit && this.c.pose !== 'sleep' && !this.c.isBusy() && !this.planToken && !this.ui.inputOpen) {
      this.sleepingByIdle = true;
      if (this.c.pose === 'stand' && Math.random() < 0.7) this.say(pick(LINES.sleepy));
      await this.c.run(async (token) => {
        if (this.c.pose === 'stand') { await this.c.goPose('sit', this.c.facing, token); await this.c.wait(token, rand(4, 8)); }
        await this.c.goPose('sleep', this.c.facing, token);
      });
    } else if (this.sleepingByIdle && this.c.pose === 'sleep' && this.systemIdle < 3) {
      this.wake();
    }
  }

  // ------------------------------------------------------------ AI-driven commands
  /** Execute one command from the AI. Returns when the action finishes (or is interrupted). */
  async exec(cmd) {
    if (!cmd) return;
    const c = this.c;
    switch (cmd.type) {
      case 'emotion': this.emote(cmd.name, cmd.hold || 4); return;
      case 'say':
        if (!cmd.text) return;
        this.ui.say(cmd.text, { source: 'ai' });
        this.api.send('pet.said', cmd.text);
        await new Promise((r) => setTimeout(r, Math.min(6000, 1200 + cmd.text.length * 120)));
        return;
      case 'wait': await new Promise((r) => setTimeout(r, clamp(cmd.seconds || 1, 0.1, 30) * 1000)); return;
      case 'action': return this.action(cmd.name, cmd.args || {});
      default: return undefined;
    }
  }

  async action(name, args = {}) {
    const c = this.c;
    this.idle.cancel();
    const s = this.getSettings().pet;
    const cursor = this.getCursor();
    const disp = c.displayAt(c.root.x);
    const wa = disp?.workArea;
    const canMove = !s.lockPosition;
    switch (String(name).replace(/-/g, '_')) {
      case 'stand': return c.run((t) => c.goPose('stand', c.facing, t));
      case 'sit': return c.run((t) => c.goPose('sit', args.facing ?? c.facing, t));
      case 'lie': case 'crawl': case 'lie_down': return c.run((t) => c.goPose('sit', args.facing ?? c.facing, t)); // no lying pose any more (older plans)
      case 'sleep': return this.sleep();
      case 'wake': case 'wake_up': return this.wake();
      case 'walk_left': case 'walk_right': {
        if (!canMove) return undefined;
        const dir = name.endsWith('left') ? -1 : 1;
        const dist = clamp(Number(args.distance) || rand(160, 380), 40, 2000);
        return c.run((t) => c.walkTo(c.root.x + dir * dist, t));
      }
      case 'walk_to': case 'go_to': {
        if (!canMove || !wa) return undefined;
        const fx = clamp(Number(args.x ?? 0.5), 0, 1);
        return c.run((t) => c.walkTo(wa.x + wa.width * fx, t));
      }
      case 'come': case 'come_here': {
        if (!canMove || !cursor) return undefined;
        return c.run((t) => c.walkTo(cursor.x + (cursor.x > c.root.x ? -90 : 90) * c.s * 2, t));
      }
      case 'go_edge': {
        if (!canMove || !wa) return undefined;
        return c.run((t) => c.walkTo(args.side === 'left' ? wa.x : wa.x + wa.width, t));
      }
      case 'crawl_to': { // older plans: walk instead
        if (!canMove || !wa) return undefined;
        return c.run((t) => c.walkTo(wa.x + wa.width * clamp(Number(args.x ?? 0.5), 0, 1), t));
      }
      case 'hop': case 'jump': c.hop(args.power || 1); return undefined;
      case 'nod': return this.#gesture('nod');
      case 'shake_head': return this.#gesture('shake');
      case 'tilt_head': this.headTilt = { v: args.side === 'left' ? -0.07 : 0.07, until: performance.now() + 2200 }; return undefined;
      case 'wag': this.moodTarget = { wag: 1, ears: 0.1 }; this.moodUntil = performance.now() + 3500; return undefined;
      case 'perk_ears': this.moodTarget = { ...this.moodTarget, ears: -0.9 }; this.moodUntil = performance.now() + 2500; return undefined;
      case 'droop_ears': this.moodTarget = { ...this.moodTarget, ears: 0.9 }; this.moodUntil = performance.now() + 3500; return undefined;
      case 'wave': return this.#gesture('wave');
      case 'bow': return this.#gesture('bow');
      case 'spin': return this.#spin();
      case 'look': case 'look_at': this.lookOverride = { dir: args.dir || args.at || 'cursor', until: performance.now() + 2500 }; return undefined;
      default: {
        // acted idle moments (stretch, yawn, hum, sneeze, ...) are available to the AI as actions too
        const id = String(name).replace(/[-_](\w)/g, (_, ch) => ch.toUpperCase());
        if (IDLE_ACTS.includes(id) && id !== 'eat') {
          if (c.pose !== 'stand') await c.run((t) => c.goPose('stand', c.facing, t));
          this.idle.start(id);
          await new Promise((r) => setTimeout(r, 1500));
        }
        return undefined;
      }
    }
  }

  async #gesture(kind) {
    const rig = this.standRig;
    if (!rig || this.c.pose !== 'stand') return;
    const J = rig.joints, F = rig.fields;
    const beat = (ms) => new Promise((r) => setTimeout(r, ms));
    if (kind === 'nod') { F.headDy.v += 70; await beat(260); F.headDy.v += 55; return; }
    if (kind === 'bow') { F.headDy.v += 110; this.c.squash(0.06); return; }
    if (kind === 'shake') { for (const s of [1, -1, 1, -1]) { if (J.head) J.head.v += 1.6 * s; await beat(140); } return; }
    if (kind === 'wave') { for (let i = 0; i < 4; i++) { rig.poke('hand-right', 1.2, 0); await beat(240); } }
  }

  async #spin() {
    const c = this.c;
    if (c.pose !== 'stand' || c.isBusy()) return;
    await c.run(async (token) => {
      c.hop(0.5);
      let t = 0;
      await new Promise((resolve, reject) => {
        const step = () => {
          if (token.cancelled) { c.body.flip = 1; reject(new Error('cancelled')); return; }
          t += 1 / 60;
          const p = Math.min(1, t / 0.55);
          c.body.flip = Math.cos(p * Math.PI * 2);
          if (Math.abs(c.body.flip) < 0.04) c.body.flip = 0.04 * Math.sign(c.body.flip || 1);
          if (p >= 1) { c.body.flip = 1; resolve(); } else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }).catch(() => {});
    });
    this.emote('cheerful', 2);
  }

  /** Multi-step plan from the AI director: [{type:'action'|'emotion'|'say'|'wait', ...}] */
  async runPlan(steps) {
    this.cancelPlan();
    const token = { cancelled: false };
    this.planToken = token;
    for (const step of (steps || []).slice(0, 12)) {
      if (token.cancelled) break;
      await this.exec(step);
    }
    if (this.planToken === token) this.planToken = null;
  }

  cancelPlan() { if (this.planToken) this.planToken.cancelled = true; this.planToken = null; }

  // ------------------------------------------------------------ autonomy
  async #idleAct() {
    const s = this.getSettings().pet;
    const c = this.c;
    const wa = c.displayAt(c.root.x)?.workArea;
    const r = Math.random();
    if (c.pose === 'sleep') return;
    if (c.pose !== 'stand') {
      // usually get back up after resting a while
      if (r < 0.55) await c.run((t) => c.goPose('stand', c.facing, t));
      return;
    }
    // mostly little acted moments; walks and sitting down less often (rarer still when she is in a low mood)
    const low = (this.life.mood ?? 70) < 35 || (this.life.hunger ?? 70) < 20;
    if (r < 0.56 && s.idleActs !== false) { if (this.idle.start()) return; }
    if (r < 0.64) { this.lookOverride = { dir: pick(['left', 'right', 'up', 'cursor']), until: performance.now() + rand(1500, 3000) }; return; }
    if (r < 0.7) { await this.action(pick(['nod', 'wag', 'perk_ears', 'tilt_head'])); return; }
    if (c.sunk) {
      // tucked in below the taskbar: no walking off or sitting down, just little moments in place
      if (r < 0.85 && s.idleActs !== false) this.idle.start();
      return;
    }
    if (r < (low ? 0.76 : 0.86) && s.allowWander && !s.lockPosition && wa) {
      const target = wa.x + wa.width * rand(0.12, 0.88);
      await c.run((t) => c.walkTo(target, t, { rate: rand(0.85, 1.05) * (low ? 0.9 : 1) }));
      return;
    }
    if (r < 0.94) { await c.run((t) => c.goPose('sit', Math.random() < 0.5 ? 1 : -1, t)); return; }
    if (!s.quiet) this.say(pick((this.life.hunger ?? 70) < 25 ? LINES.hungry : LINES.idle));
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const now = performance.now();
    const c = this.c;
    const s = this.getSettings().pet;
    // cursor activity (for acts that greet the owner)
    const cur = this.getCursor();
    if (cur && (!this.lastCursor || Math.abs(cur.x - this.lastCursor.x) + Math.abs(cur.y - this.lastCursor.y) > 6)) { this.cursorMovedAt = now; this.lastCursor = { ...cur }; }
    // whole-body reactions (touch, pull, stroke, attention) are layered over the acted idle moments; together
    // they drive the rig offsets and body lean/rise/stretch and may override mouth and gaze
    if (this.chatAfterLanding && !c.airborne) { this.chatAfterLanding = false; this.openChat(); }
    this.reactor.setListening(this.ui.inputOpen);
    this.reactor.update(dt, { gazeX: c.env.gazeX, gazeY: c.env.gazeY });
    this.idle.update(dt, this.reactor.out);
    // mood easing (ears / tail)
    if (this.moodUntil && now > this.moodUntil) { this.moodTarget = this.#restMood(); this.moodUntil = 0; }
    const k = 1 - Math.exp(-dt * 3);
    this.mood.wag += (this.moodTarget.wag - this.mood.wag) * k;
    this.mood.ears += (this.moodTarget.ears - this.mood.ears) * k;
    // expression return
    if (this.expr.until && now > this.expr.until) {
      this.expr = { id: this.#baseExpression(), until: 0 };
      this.standRig?.setExpression(this.expr.id);
    }
    // gaze
    this.#gaze();
    c.env.headTilt = now < this.headTilt.until ? this.headTilt.v : 0;
    // lip-sync: real audio level, or a soft flap while the bubble types out
    let level = this.voice.update(dt);
    if (!this.voice.busy && this.ui.speaking) level = 0.18 + 0.32 * Math.abs(Math.sin(now / 1000 * 13)) * (0.6 + 0.4 * Math.sin(now / 1000 * 3.1));
    if (this.idle.mouth != null && !this.voice.busy) level = Math.max(level * 0.5, this.idle.mouth);
    this.standRig?.setMouth(c.pose === 'stand' ? level : 0);
    // autonomy
    const autonomous = !c.isBusy() && !this.planToken && !this.ui.inputOpen && !this.aiBusy && c.mode === 'idle' && !this.idle.playing && !this.reactor.busy;
    if (autonomous) {
      // when the AI director is steering, local idle behaviour only fills the gaps
      this.nextIdle -= dt * (s.quiet ? 0.35 : 1) * (this.aiDirected ? 0.55 : 1);
      if (this.nextIdle <= 0) {
        this.nextIdle = rand(8, 20) * (s.quiet ? 1.5 : 1);
        this.#idleAct();
      }
    }
    this.#reportState();
  }

  #gaze() {
    const c = this.c;
    const s = this.getSettings().pet;
    const now = performance.now();
    let gx = 0, gy = 0;
    const ig = this.reactor.gaze || this.idle.gaze;
    if (ig) { gx = ig.x; gy = ig.y; }
    else if (this.ui.inputOpen) { gx = 0; gy = -0.55; }     // looks up at the chat box over her head
    else if (this.lookOverride && now < this.lookOverride.until && this.lookOverride.dir !== 'cursor') {
      const d = this.lookOverride.dir;
      gx = d === 'left' ? -0.9 : d === 'right' ? 0.9 : 0; gy = d === 'up' ? -0.8 : d === 'down' ? 0.7 : 0;
    } else if (s.gaze || (this.lookOverride && now < this.lookOverride.until)) {
      const cur = this.getCursor();
      const rig = c.view.kind === 'rig' && c.view.id !== 'sleep' ? c.rig : null;
      if (cur && rig) {
        // from between her eyes (sitting too), in screen px
        const o = c.windowOrigin();
        const el = rig.eyes?.['eye-left'], er = rig.eyes?.['eye-right'];
        const face = el && er ? { x: (el.iris.cx + er.iris.cx) / 2, y: (el.iris.cy + er.iris.cy) / 2 } : this.m.world.faceAnchor;
        const p = mat.apply(c.viewMatrix(c.view), face.x, face.y);
        const dx = cur.x - (o.x + p[0]), dy = cur.y - (o.y + p[1]);
        const dist = Math.hypot(dx, dy);
        const idleLong = this.systemIdle > 25;
        // a soft curve: small moves near her face still show, far away it saturates; it fades out (no snap) far away
        const far = 1 - clamp((dist - 1500) / 500, 0, 1);
        if (!idleLong && far > 0) {
          const reach = 150 + 240 * c.s / 0.36; // grows with her size on screen
          gx = Math.tanh(dx / reach) * far; gy = Math.tanh(dy / (reach * 0.8)) * far;
          // the cursor right on her face: look at it, not cross-eyed past it
          const near = clamp(dist / 36, 0.25, 1);
          gx *= near; gy *= near; // (character.update mirrors gx for a mirrored rig)
        }
      }
    }
    if (c.mode === 'drag') { gx = clamp(-c.vel.x / 900, -1, 1); gy = 0.4; }
    if (c.mode === 'fly') { gx = clamp(c.vel.x / 1400, -1, 1); gy = clamp(c.vel.y / 1400, -1, 1); }
    c.env.gazeX = gx; c.env.gazeY = gy;
  }

  #reportState(force = false) {
    const c = this.c;
    const state = `${c.pose}|${c.mode}|${Math.round(c.root.x / 50)}`;
    if (!force && state === this.lastState) return;
    this.lastState = state;
    this.api.send('pet.state', { pose: c.pose, mode: c.mode, facing: c.facing, root: { x: Math.round(c.root.x), y: Math.round(c.root.y) }, expression: this.expr.id });
  }

  setAiBusy(on) {
    this.aiBusy = !!on;
    if (on && this.c.pose === 'stand' && !this.expr.until) { this.standRig?.setExpression('301'); this.expr = { id: '301', until: performance.now() + 30000 }; }
    if (!on && this.expr.id === '301') this.expr.until = performance.now() + 300;
  }
}
