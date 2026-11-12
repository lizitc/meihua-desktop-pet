// Idle animations for the standing pose: short acted moments layered on the rig (joint and field offsets),
// the whole-body channels (lean, rise, stretch), expression, mouth, gaze and particle effects.
// They only run while she stands idle and stop the moment anything else takes over.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** 0 before a, up to 1 at b, 1 until c, down to 0 at d. */
const env = (t, a, b, c, d) => (t < c ? smooth(a, b, t) : 1 - smooth(c, d, t));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

/**
 * Each act: dur (s), frame(t, o, ctx) writes this frame's pose into `o`, events [[time, fn(ctx)]] fire once,
 * when(ctx) gates it, weight(ctx) biases the choice.
 *   o.j: joint/field offsets   o.lean (rad)   o.rise (native px, negative = up)   o.ex/o.ey (stretch)
 *   o.mouth (0..1 or null)     o.gaze ({x, y} or null)
 */
const ACTS = {
  stretch: {
    dur: 3.4,
    frame(t, o) {
      const e = env(t, 0.15, 0.85, 2.3, 3.1);
      o.rise = -7 * e; o.ey = 0.03 * e; o.ex = -0.012 * e;
      o.j.headDy = -5 * e; o.j['hand-left'] = 0.1 * e; o.j['hand-right'] = -0.1 * e;
      o.j['arm-lower-left'] = 0.05 * e; o.j['arm-lower-right'] = -0.05 * e;
      o.j['ear-left'] = 0.12 * e; o.j['ear-right'] = -0.12 * e;
      o.gaze = { x: 0, y: -0.8 * e };
    },
    events: [
      [0.2, (c) => c.emote('302', 2.4)],
      [0.4, (c) => c.chance(0.4) && c.say(pick(['嗯——（伸懒腰）', '呼啊，活动一下～', '伸——展——']))],
      [2.6, (c) => { c.squash(0.04); c.fx('sparkle', 0, -10, { n: 4, spread: 40 }); c.emote('102', 1.6); }],
    ],
    weight: (c) => 1 + (c.hour >= 9 && c.hour <= 11 ? 1 : 0) + (c.idleLong ? 0.8 : 0),
  },
  yawn: {
    dur: 3.2,
    frame(t, o) {
      const e = env(t, 0.35, 0.9, 1.9, 2.6);
      o.j.headDy = -4 * e; o.mouth = 0.95 * env(t, 0.5, 0.9, 1.8, 2.2);
      o.j['ear-left'] = -0.07 * e; o.j['ear-right'] = 0.07 * e;
      o.ey = 0.015 * e;
    },
    events: [
      [0, (c) => c.emote('901', 0.7)],
      [0.6, (c) => c.emote('602', 1.8)],
      [1.2, (c) => c.fx('text', 26, 20, { text: '哈～', color: '#b48ad8', size: 12 })],
      [2.3, (c) => { c.emote('901', 1.4); c.fx('sweat', -16, 46, { color: '#9fd3f7', size: 4, vy: 10 }); }],
    ],
    when: (c) => c.hour >= 21 || c.hour < 9 || c.mood < 45 || c.idleLong,
    weight: (c) => (c.hour >= 22 || c.hour < 7 ? 2.5 : 1),
  },
  lookAround: {
    dur: 3.6,
    frame(t, o) {
      const gx = -0.9 * env(t, 0.2, 0.6, 1.3, 1.6) + 0.9 * env(t, 1.6, 2.0, 2.7, 3.1);
      o.gaze = { x: gx, y: -0.1 };
      o.j.head = gx * 0.05; o.j.headDx = gx * 3;
      o.j['ear-left'] = 0.1 * env(t, 0.1, 0.4, 3.0, 3.4); o.j['ear-right'] = -0.1 * env(t, 0.1, 0.4, 3.0, 3.4);
      o.lean = gx * 0.008;
    },
    events: [[0, (c) => c.emote('104', 3.2)], [3.1, (c) => c.chance(0.3) && c.emote('402', 1.2)]],
    weight: () => 1.4,
  },
  hum: {
    dur: 5.6,
    frame(t, o) {
      const e = env(t, 0.2, 0.7, 4.8, 5.5);
      const s = Math.sin(t * TAU * 0.75);
      o.lean = 0.032 * s * e; o.j.head = -0.04 * s * e; o.j.headDx = -1.6 * s * e;
      o.j.skirt = 2.2 * s * e; o.j.hairL = 1.5 * s * e; o.j.hairR = 1.5 * s * e;
      o.rise = -1.5 * Math.abs(Math.sin(t * TAU * 0.75)) * e;
      o.mouth = (0.12 + 0.14 * Math.abs(Math.sin(t * 7))) * e;
    },
    events: [
      [0, (c) => { c.emote('102', 5.2); c.wag(1, 5.4); }],
      [0.3, (c) => c.chance(0.35) && c.say(pick(['（小声哼歌）', '♪ 啦啦啦～', '今天的心情是草莓味的～']))],
      ...[0.5, 1.1, 1.7, 2.3, 2.9, 3.5, 4.1, 4.7].map((tt) => [tt, (c) => c.fx('note', rand(-30, 30), rand(-4, 8), { vx: rand(-20, 20) })]),
    ],
    when: (c) => c.mood >= 45,
    weight: (c) => 0.8 + c.mood / 60,
  },
  tiptoe: {
    dur: 2.4,
    frame(t, o) {
      const b = (k) => Math.max(0, Math.sin(Math.PI * clamp((t - k) / 0.5, 0, 1)));
      const h = b(0.1) + b(0.75) + 0.6 * b(1.4);
      o.rise = -6 * h; o.ey = 0.02 * h; o.ex = -0.008 * h;
      o.j['ear-left'] = 0.1 * h; o.j['ear-right'] = -0.1 * h;
    },
    events: [[0.6, (c) => c.squash(0.025)], [1.25, (c) => c.squash(0.025)], [1.9, (c) => { c.squash(0.02); c.chance(0.5) && c.fx('heart', 0, 0, { n: 1 }); }], [0, (c) => c.emote('105', 2.3)]],
    when: (c) => c.mood >= 50,
    weight: (c) => c.mood / 70,
  },
  skirtSmooth: {
    dur: 3.0,
    frame(t, o) {
      const e = env(t, 0.2, 0.6, 2.2, 2.8);
      o.j.headDy = 4 * e; o.gaze = { x: 0, y: 0.85 * e };
      o.j.skirt = Math.sin(t * 7) * 2.6 * e;
      o.j['hand-left'] = 0.09 * Math.sin(t * 7) * e; o.j['hand-right'] = -0.09 * Math.sin(t * 7 + 0.6) * e;
      o.j['ear-left'] = -0.05 * e; o.j['ear-right'] = 0.05 * e;
    },
    events: [[0.2, (c) => c.emote('501', 2.6)], [2.5, (c) => c.chance(0.4) && c.fx('sparkle', 0, 140, { n: 3, spread: 40 })]],
    weight: () => 0.9,
  },
  earFlick: {
    dur: 1.5,
    frame(t, o) { const e = env(t, 0, 0.1, 0.55, 0.8); o.j.head = Math.sin(t * 22) * 0.03 * e; o.j.headDx = Math.sin(t * 22) * 1.2 * e; },
    events: [
      [0.05, (c) => { c.kickEars(0.7); c.fx('puff', -40, 30, { n: 2 }); c.fx('puff', 40, 30, { n: 2 }); }],
      [0.4, (c) => c.kickEars(0.5)],
      [0.1, (c) => c.emote('602', 0.6)],
    ],
    weight: () => 1,
  },
  tailGlance: {
    dur: 3.2,
    frame(t, o) {
      const e = env(t, 0.2, 0.6, 2.4, 3.0);
      o.gaze = { x: 0.75 * e, y: 0.65 * e }; o.j.head = 0.05 * e; o.j.headDx = 2.6 * e; o.j.headDy = 2 * e;
      o.lean = 0.012 * e;
    },
    events: [[0.3, (c) => { c.emote('402', 1.5); c.wag(1, 3); }], [1.8, (c) => { c.emote('102', 1.4); c.chance(0.4) && c.say(pick(['尾巴自己在摇……', '诶嘿，尾巴好开心。'])); }]],
    weight: () => 0.9,
  },
  sneeze: {
    dur: 2.6,
    frame(t, o) {
      const pre = env(t, 0, 0.6, 0.72, 0.76);
      const post = env(t, 0.74, 0.8, 1.1, 1.6);
      o.j.headDy = -4 * pre + 6 * post; o.j.head = -0.03 * pre + 0.02 * post;
      o.ey = 0.02 * pre - 0.03 * post; o.mouth = 0.5 * pre;
    },
    events: [
      [0, (c) => c.emote('403', 0.8)],
      [0.76, (c) => { c.squash(0.06); c.kickEars(0.9); c.fx('puff', 0, 40, { n: 7, spread: 10 }); c.fx('text', 34, 10, { text: '啾！', size: 15 }); }],
      [1.3, (c) => { c.emote('701a', 1.2); c.chance(0.5) && c.say(pick(['失、失礼了……', '是有人在想我吗？'])); }],
    ],
    weight: () => 0.35,
  },
  daydream: {
    dur: 5.0,
    frame(t, o) {
      const e = env(t, 0.3, 1.0, 4.0, 4.8);
      o.gaze = { x: -0.5 * e, y: -0.8 * e }; o.j.head = -0.03 * e; o.j.headDy = -2.5 * e;
      o.lean = -0.012 * e + 0.004 * Math.sin(t * 1.3) * e;
    },
    events: [
      [0.3, (c) => c.emote('301', 4.4)],
      [1.6, (c) => c.fx('sparkle', -40, -20, { n: 2, spread: 10, color: '#ffe7a3' })],
      [2.8, (c) => c.fx('sparkle', -54, -36, { n: 2, spread: 10, color: '#ffd1e3' })],
      [4.5, (c) => c.chance(0.35) && c.say(pick(['……啊，刚才在想草莓蛋糕。', '（发呆中）', '嗯？没、没在走神哦。']))],
    ],
    weight: (c) => 0.8 + (c.idleLong ? 1 : 0),
  },
  hungry: {
    dur: 3.2,
    frame(t, o) {
      const e = env(t, 0.2, 0.6, 2.5, 3.1);
      o.j.headDy = 3.5 * e; o.gaze = { x: 0, y: 0.9 * e };
      o.j['hand-left'] = -0.06 * e; o.j['hand-right'] = 0.06 * e;
      o.j['ear-left'] = -0.08 * e; o.j['ear-right'] = 0.08 * e;
      o.ey = -0.01 * e;
    },
    events: [
      [0.2, (c) => c.emote('301a', 2.8)],
      [0.7, (c) => c.fx('text', 0, 170, { text: '咕～', size: 13, color: '#d88a3a' })],
      [1.4, (c) => c.say(pick(['肚子……咕咕叫了。', '有点饿了……', '好想吃草莓呀。']))],
      [2.6, (c) => c.chance(0.4) && c.hint('（右键菜单里可以喂我吃东西哦）')],
    ],
    when: (c) => c.hunger < 35,
    weight: (c) => (c.hunger < 15 ? 4 : 2),
  },
  waveAt: {
    dur: 2.2,
    frame(t, o) { o.gaze = null; o.j.head = 0.03 * env(t, 0.1, 0.4, 1.8, 2.2); },
    events: [[0, (c) => { c.emote('105', 2.2); c.poke('hand-right', 1.2); }], [0.3, (c) => c.poke('hand-right', 1.2)], [0.6, (c) => c.poke('hand-right', 1)], [0.9, (c) => c.fx('heart', 30, 0, { n: 1 })]],
    when: (c) => c.cursorNear,
    weight: (c) => 1.2 + c.mood / 100,
  },
  happyHop: {
    dur: 2.0,
    frame() {},
    events: [[0, (c) => { c.emote('103', 2); c.hop(0.42); }], [0.62, (c) => { c.hop(0.36); c.fx('heart', 0, 0, { n: 3, stagger: 0.12 }); }]],
    when: (c) => c.mood >= 75,
    weight: (c) => (c.mood - 60) / 25,
  },
  dozeOff: {
    dur: 4.6,
    frame(t, o) {
      const drop = smooth(0.2, 3.2, t) * (t < 3.4 ? 1 : 0);
      const jerk = env(t, 3.4, 3.5, 3.6, 4.2);
      o.j.headDy = 5.5 * drop - 2 * jerk; o.j.head = 0.025 * drop;
      o.j['ear-left'] = -0.08 * drop; o.j['ear-right'] = 0.08 * drop;
      o.lean = 0.01 * drop;
    },
    events: [
      [0.1, (c) => c.emote('901', 1.6)], [1.6, (c) => c.emote('602', 1.9)],
      [2.0, (c) => c.fx('zzz', 30, -10, {})], [2.8, (c) => c.fx('zzz', 36, -16, {})],
      [3.42, (c) => { c.emote('403', 1); c.kickEars(0.8); c.fx('sweat', 30, 20, {}); }],
      [3.9, (c) => c.chance(0.5) && c.say(pick(['我、我没睡着！', '呜……差点睡着了。']))],
    ],
    when: (c) => c.hour >= 23 || c.hour < 6 || c.idleLong,
    weight: () => 1.5,
  },
  fixHair: {
    dur: 2.6,
    frame(t, o) {
      const e = env(t, 0.1, 0.4, 1.9, 2.5);
      o.j.hairFront = Math.sin(t * 6) * 2 * e; o.j.head = 0.04 * e; o.j.headDx = 1.5 * e;
      o.j.hairR = 1.2 * Math.sin(t * 5) * e;
    },
    events: [[0.1, (c) => { c.emote('102', 2.3); c.poke('hand-right', 0.8); }], [0.9, (c) => c.poke('hand-right', 0.6)]],
    weight: () => 0.8,
  },
  // fed from the menu: ctx.food = { name, img (HTMLImageElement), favorite, hunger }
  eat: {
    manual: true,
    dur: 3.6,
    frame(t, o) {
      const chew = env(t, 0.55, 0.7, 2.3, 2.5);
      o.mouth = t < 0.5 ? 0.6 * smooth(0.1, 0.4, t) : chew * (0.12 + 0.5 * Math.abs(Math.sin(t * 9)));
      o.j.headDy = 1.6 * Math.sin(t * 9) * chew + 1.5 * env(t, 0, 0.3, 2.4, 2.8);
      o.gaze = { x: 0, y: 0.5 * env(t, 0, 0.2, 0.6, 0.9) };
      o.j['ear-left'] = 0.1 * env(t, 0, 0.2, 3.0, 3.5); o.j['ear-right'] = -0.1 * env(t, 0, 0.2, 3.0, 3.5);
      o.ey = 0.01 * Math.sin(t * 9) * chew;
    },
    events: [
      [0, (c) => { c.emote('401', 0.8); c.feedImage(); }],
      [0.6, (c) => c.emote(c.food?.favorite ? '102a' : '102', 2.4)],
      ...[0.7, 1.0, 1.3, 1.6, 1.9, 2.2].map((tt) => [tt, (c) => c.mouthFx('crumb', { n: 3 })]),
      [2.6, (c) => { c.wag(1, 3); c.fx('heart', 0, 0, { n: c.food?.favorite ? 5 : 3, stagger: 0.1, spread: 26 }); }],
      [2.7, (c) => c.food?.gain && c.fx('text', 0, -16, { text: c.food.gain, size: 13, color: '#e2588b' })],
    ],
  },
  heartPop: {
    dur: 2.4,
    frame(t, o) { const e = env(t, 0.1, 0.4, 1.8, 2.3); o.j.head = 0.035 * e; o.ey = 0.012 * e; o.rise = -2 * e; },
    events: [[0, (c) => { c.emote('102a', 2.4); c.wag(1, 2.4); }], [0.4, (c) => c.fx('heart', 0, -6, { n: 4, stagger: 0.15, spread: 22 })], [0.8, (c) => c.chance(0.4) && c.say(pick(['最喜欢{name}了～', '嘿嘿，今天也很开心。']))]],
    when: (c) => c.mood >= 70 && c.intimacy >= 30,
    weight: (c) => c.mood / 80,
  },
  // ---- whole-body moments: the figure itself moves (lean, torso, crouch, bounce), not just one part
  shakeOff: {
    // a puppy-style shake from head to skirt
    dur: 2.1,
    snappy: true,
    frame(t, o) {
      const gather = env(t, 0.05, 0.25, 0.3, 0.42);
      const e = env(t, 0.3, 0.42, 1.25, 1.65);
      const w = Math.sin((t - 0.3) * 27) * e;
      o.ey = -0.016 * gather + 0.008 * e; o.ex = 0.01 * Math.abs(w);
      o.lean = 0.045 * w; o.j.torso = -0.03 * w; o.j.head = -0.07 * w; o.j.headDx = -3.2 * w;
      o.j.hairL = 16 * w; o.j.hairR = 16 * w; o.j.skirt = 5.5 * w;
      o.j['ear-left'] = 0.22 * Math.abs(w); o.j['ear-right'] = -0.22 * Math.abs(w); o.j.tail = 0.3 * w;
    },
    events: [
      [0, (c) => c.emote('602', 0.9)],
      [0.45, (c) => { c.fx('puff', -50, 60, { n: 3 }); c.fx('puff', 50, 60, { n: 3 }); }],
      [0.9, (c) => c.fx('sparkle', 0, 40, { n: 5, spread: 60, color: '#bfe6ff' })],
      [1.5, (c) => { c.emote('105', 1.6); c.squash(0.04); }],
      [1.7, (c) => c.chance(0.4) && c.say(pick(['呼——清爽多了！', '抖一抖，精神百倍～', '嘿嘿，毛都蓬起来了。']))],
    ],
    weight: () => 0.8,
  },
  dance: {
    dur: 6.4,
    snappy: true,
    frame(t, o) {
      const e = env(t, 0.2, 0.7, 5.6, 6.3);
      const ph = t * TAU * 0.9;
      const sway = Math.sin(ph), bounce = Math.abs(Math.sin(ph));
      o.lean = 0.042 * sway * e; o.j.torso = -0.016 * sway * e; o.j.head = 0.05 * sway * e; o.j.headDx = 2.4 * sway * e;
      o.rise = -9 * bounce * e; o.ey = (0.012 * bounce - 0.01 * (1 - bounce)) * e;
      o.j['arm-lower-left'] = 0.05 * sway * e; o.j['arm-lower-right'] = 0.05 * sway * e;
      o.j['hand-left'] = 0.08 * Math.sin(ph * 2) * e; o.j['hand-right'] = -0.08 * Math.sin(ph * 2) * e;
      o.j.skirt = 4.5 * sway * e; o.j.hairL = 7 * sway * e; o.j.hairR = 7 * sway * e;
      o.mouth = (0.1 + 0.14 * Math.abs(Math.sin(t * 6.5))) * e;
      o.gaze = { x: 0.45 * sway * e, y: -0.2 * e };
    },
    events: [
      [0, (c) => { c.emote('103', 6); c.wag(1, 6.2); }],
      [0.4, (c) => c.chance(0.4) && c.say(pick(['♪ 跳一下下～', '啦啦～一起动起来！', '（心情好就想跳舞）']))],
      ...[0.6, 1.3, 2.0, 2.7, 3.4, 4.1, 4.8, 5.5].map((tt) => [tt, (c) => c.fx('note', rand(-46, 46), rand(-10, 10), { vx: rand(-26, 26) })]),
      [6.0, (c) => { c.emote('105', 1.5); c.fx('sparkle', 0, 20, { n: 5, spread: 50 }); }],
    ],
    when: (c) => c.mood >= 55,
    weight: (c) => c.mood / 70,
  },
  sniff: {
    dur: 3.4,
    frame(t, o) {
      const e = env(t, 0.2, 0.6, 2.6, 3.2);
      const sn = Math.max(0, Math.sin(t * TAU * 3.2)) * (env(t, 0.6, 0.8, 1.5, 1.8) + env(t, 1.95, 2.1, 2.4, 2.6));
      o.j.headDy = -3 * e + 1.3 * sn; o.j.head = -0.03 * e; o.j.headDx = -1.6 * e;
      o.lean = -0.014 * e; o.j.torso = -0.008 * e; o.rise = -2.5 * e; o.ey = 0.008 * e + 0.004 * sn;
      o.j['ear-left'] = -0.06 * e; o.j['ear-right'] = 0.06 * e;
      o.gaze = { x: -0.55 * e, y: -0.6 * e };
    },
    events: [
      [0.1, (c) => c.emote('104', 3)],
      [0.7, (c) => c.fx('text', -40, 30, { text: '嗅嗅', size: 12, color: '#c27a9a' })],
      [2.0, (c) => c.fx('text', -48, 22, { text: '嗅…', size: 11, color: '#c27a9a' })],
      [2.6, (c) => { c.emote(c.hunger < 50 ? '401' : '402', 1.6); c.chance(0.45) && c.say(pick(c.hunger < 50 ? ['……有草莓蛋糕的味道？', '好香……是谁在吃好吃的？'] : ['嗯？好像闻到了春天的味道。', '是错觉吗……'])); }],
    ],
    weight: (c) => 0.7 + (c.hunger < 50 ? 0.6 : 0),
  },
  tailChase: {
    dur: 3.8,
    snappy: true,
    frame(t, o) {
      const look = env(t, 0.1, 0.35, 1.2, 1.5) - env(t, 1.6, 1.85, 2.8, 3.2);   // +1 right, -1 left
      const a = Math.abs(look);
      o.lean = 0.035 * look; o.j.torso = 0.026 * look; o.j.head = 0.07 * look; o.j.headDx = 3.5 * look; o.j.headDy = 2 * a;
      o.j.tail = -0.25 * look; o.ey = -0.008 * a;
      o.gaze = { x: 0.95 * look, y: 0.6 * a };
    },
    events: [
      [0, (c) => c.emote('104', 1.5)], [0.35, (c) => c.hop(0.24)], [0.4, (c) => c.wag(1, 3.6)],
      [1.65, (c) => { c.hop(0.28); c.emote('401', 1.4); }],
      [1.9, (c) => c.fx('text', -50, 120, { text: '尾巴！', size: 12, color: '#e2588b' })],
      [3.2, (c) => { c.emote(c.chance(0.5) ? '402' : '105', 1.4); c.chance(0.45) && c.say(pick(['抓不到……', '尾巴自己会跑！', '诶嘿，转得晕乎乎的。'])); }],
    ],
    when: (c) => c.mood >= 40,
    weight: () => 0.7,
  },
  curtsy: {
    dur: 3.0,
    frame(t, o) {
      const e = env(t, 0.25, 0.75, 1.6, 2.4);
      o.ey = -0.03 * e; o.ex = 0.008 * e; o.j.headDy = 4 * e; o.j.head = 0.03 * e; o.lean = 0.008 * e;
      o.j['arm-lower-left'] = 0.04 * e; o.j['arm-lower-right'] = -0.04 * e; o.j['hand-left'] = 0.1 * e; o.j['hand-right'] = -0.1 * e;
      o.j.skirt = 3 * Math.sin(t * 3) * e;
      o.gaze = { x: 0, y: 0.4 * e };
    },
    events: [
      [0, (c) => c.emote('105', 3)],
      [0.6, (c) => c.chance(0.5) && c.say(pick(['今天也请多关照～', '见过{name}～', '（提起裙摆行礼）']))],
      [2.1, (c) => { c.fx('sparkle', 0, 160, { n: 4, spread: 50 }); c.emote('102', 1.4); }],
    ],
    weight: (c) => 0.5 + (c.cursorNear ? 0.8 : 0),
  },
  footTap: {
    dur: 3.4,
    frame(t, o) {
      const e = env(t, 0.2, 0.4, 2.8, 3.3);
      const tap = Math.max(0, Math.sin(t * TAU * 2.2));
      o.j['foot-right'] = -0.13 * tap * e; o.rise = -1.2 * tap * e; o.lean = -0.012 * e; o.j.torso = 0.007 * e;
      o.j.head = 0.03 * Math.sin(t * TAU * 1.1) * e;
      o.gaze = { x: -0.6 * e, y: 0.1 };
    },
    events: [
      [0, (c) => c.emote('601', 3)],
      [1.0, (c) => c.fx('text', 34, 300, { text: '嗒、嗒', size: 11, color: '#a58fb8' })],
      [2.6, (c) => c.chance(0.45) && c.say(pick(['{name}～还在忙吗？', '……（数地板上的格子）', '无聊的话，可以陪我说说话哦。']))],
    ],
    when: (c) => c.idleLong || c.mood < 70,
    weight: (c) => 0.5 + (c.idleLong ? 0.8 : 0),
  },
  rubEyes: {
    dur: 3.0,
    frame(t, o) {
      const e = env(t, 0.2, 0.6, 2.0, 2.7);
      const rub = Math.sin(t * 13) * env(t, 0.6, 0.8, 1.8, 2.0);
      o.j['arm-lower-right'] = -0.08 * e; o.j['hand-right'] = -0.12 * e + 0.04 * rub;
      o.j.head = 0.04 * e + 0.012 * rub; o.j.headDy = 2.5 * e; o.j.headDx = 1 * e;
      o.lean = 0.01 * e; o.ey = -0.008 * e;
    },
    events: [
      [0, (c) => c.emote('901', 0.8)], [0.8, (c) => c.emote('602', 1.2)], [2.0, (c) => c.emote('901', 1)],
      [2.4, (c) => c.chance(0.45) && c.say(pick(['唔……眼睛有点干。', '揉揉……', '{name}也要让眼睛休息一下哦。']))],
    ],
    when: (c) => c.hour >= 22 || c.hour < 8 || c.idleLong,
    weight: () => 1,
  },
  peek: {
    dur: 3.4,
    frame(t, o, c) {
      if (!c.side) c.side = Math.random() < 0.5 ? -1 : 1;
      const s = c.side, e = env(t, 0.3, 0.8, 2.4, 3.1);
      o.lean = 0.055 * s * e; o.j.torso = 0.03 * s * e; o.j.head = 0.05 * s * e; o.j.headDx = 4 * s * e; o.rise = -3 * e;
      o.j['ear-left'] = -0.05 * e; o.j['ear-right'] = 0.05 * e;
      o.gaze = { x: s * 0.95 * e, y: -0.1 };
    },
    events: [
      [0.3, (c) => c.emote('104', 2.4)],
      [1.6, (c) => c.chance(0.4) && c.say(pick(['那边有什么呢？', '嗯……？', '（探头）']))],
      [2.6, (c) => c.emote(c.chance(0.5) ? '402' : '101', 1)],
    ],
    weight: () => 0.8,
  },
  sideStretch: {
    dur: 4.4,
    frame(t, o) {
      const L = env(t, 0.2, 0.9, 1.5, 2.0), R = env(t, 2.1, 2.8, 3.4, 4.1);
      const w = L - R, up = L + R;
      o.lean = 0.05 * w; o.j.torso = 0.035 * w; o.j.head = 0.04 * w; o.ey = 0.02 * up; o.rise = -3 * up;
      o.j['hand-left'] = 0.1 * up; o.j['hand-right'] = -0.1 * up; o.j['arm-lower-left'] = 0.05 * up; o.j['arm-lower-right'] = -0.05 * up;
      o.j.hairL = 4 * w; o.j.hairR = 4 * w; o.j.skirt = 2 * w;
      o.gaze = { x: 0.3 * w, y: -0.5 * up };
    },
    events: [
      [0.1, (c) => c.emote('302', 4)],
      [0.5, (c) => c.chance(0.4) && c.say(pick(['左边——', '拉伸一下～', '坐久了要动一动哦。']))],
      [2.3, (c) => c.fx('text', 50, 30, { text: '右边～', size: 12, color: '#b48ad8' })],
      [4.0, (c) => { c.emote('102', 1.4); c.squash(0.03); }],
    ],
    weight: (c) => 0.7 + (c.hour >= 14 && c.hour <= 17 ? 0.5 : 0),
  },
  giggle: {
    dur: 2.6,
    snappy: true,
    frame(t, o) {
      const e = env(t, 0.1, 0.3, 1.9, 2.5);
      const sh = Math.sin(t * 30) * e;
      o.rise = -1.4 * Math.abs(sh); o.ey = 0.006 * Math.abs(sh); o.lean = 0.008 * sh;
      o.j.head = 0.035 * e + 0.012 * sh; o.j.headDy = 1.5 * e;
      o.j['arm-lower-right'] = -0.05 * e; o.j['hand-right'] = -0.08 * e;
      o.mouth = 0.25 * Math.abs(Math.sin(t * 15)) * e;
    },
    events: [
      [0, (c) => c.emote('102a', 2.4)],
      [0.2, (c) => c.fx('text', 40, 16, { text: '嘻嘻', size: 12, color: '#e2588b' })],
      [1.6, (c) => c.chance(0.4) && c.say(pick(['（想到了开心的事）', '嘻嘻，没什么～', '才、才没有在偷笑！']))],
    ],
    when: (c) => c.mood >= 55,
    weight: () => 0.7,
  },
  deepBreath: {
    dur: 4.6,
    frame(t, o) {
      const inh = env(t, 0.2, 1.8, 2.2, 3.8);
      o.ey = 0.018 * inh; o.ex = 0.006 * inh; o.rise = -2.5 * inh; o.j.headDy = -2 * inh;
      o.j['ear-left'] = 0.06 * inh; o.j['ear-right'] = -0.06 * inh;
      o.gaze = { x: 0, y: -0.4 * inh };
    },
    events: [
      [0.1, (c) => c.emote('302', 3.8)],
      [2.6, (c) => c.fx('text', 30, 30, { text: '呼——', size: 12, color: '#7fb8de' })],
      [4.0, (c) => { c.emote('102', 1.5); c.chance(0.3) && c.say(pick(['深呼吸，心情都变好了。', '{name}也一起深呼吸吧～'])); }],
    ],
    weight: (c) => 0.6 + (c.idleLong ? 0.5 : 0),
  },
};

export class Idle {
  constructor({ character, behavior, fx }) {
    this.c = character; this.b = behavior; this.fx = fx;
    this.act = null;          // { id, def, t, fired }
    this.t = 0;
    this.out = { j: {}, lean: 0, rise: 0, ex: 0, ey: 0, mouth: null, gaze: null };
    this.ease = { lean: 0, rise: 0, ex: 0, ey: 0 };   // eased idle body channels (the reaction layer adds on top)
    this.weight = { side: 1, x: 0, next: rand(4, 8) }; // which leg carries her weight
    this.lastId = '';
  }

  get playing() { return !!this.act; }
  get mouth() { return this.act ? this.out.mouth : null; }
  get gaze() { return this.act ? this.out.gaze : null; }

  /** Context for gates, weights and event callbacks. */
  #ctx() {
    const b = this.b, c = this.c, life = b.life || {};
    const anchor = c.anchor ? c.lastAnchor || c.anchor() : { x: 0, y: 0 };
    const cur = b.getCursor?.();
    let cursorNear = false;
    if (cur && b.cursorMovedAt && performance.now() - b.cursorMovedAt < 4000) {
      const o = c.windowOrigin();
      cursorNear = Math.hypot(cur.x - (o.x + anchor.x), cur.y - (o.y + anchor.y + 120)) < 520;
    }
    const ctx = {
      feedImage: () => { const img = ctx.food?.img; if (img) this.fx?.hold(img, () => c.facePoint(58), 2.3, 42 * (c.s / 0.36)); },
      hour: new Date().getHours(), mood: life.mood ?? 70, hunger: life.hunger ?? 70, intimacy: life.intimacy ?? 0,
      idleLong: b.systemIdle > 90, cursorNear,
      chance: (p) => Math.random() < p,
      emote: (id, hold) => b.emote(id, hold),
      say: (text) => { if (!b.getSettings().pet.quiet) b.say(text); },
      hint: (text) => { if (!b.getSettings().pet.quiet) b.say(text, { force: true, hold: 4 }); },
      squash: (a) => c.squash(a),
      hop: (p) => c.hop(p),
      wag: (w, s) => { b.moodTarget = { ...b.moodTarget, wag: w }; b.moodUntil = performance.now() + s * 1000; },
      kickEars: (a) => { const r = c.a.rig('stand'); r?.kick('ear-left', 1, a); r?.kick('ear-right', -1, a); },
      poke: (id, a) => c.a.rig('stand')?.poke(id, a, 0),
      fx: (kind, dx, dy, opts) => { const a = c.lastAnchor || anchor, k = c.s / 0.36; this.fx?.emit(kind, a.x + dx * k, a.y + dy * k, opts); },
      mouthFx: (kind, opts) => { const p = c.facePoint?.(46); if (p) this.fx?.emit(kind, p.x, p.y, opts); },
    };
    return ctx;
  }

  /** Picks and starts an act suited to the moment; false when none fits. `extra` is merged into its context. */
  start(id, extra = {}) {
    if (!this.#canRun()) return false;
    const ctx = Object.assign(this.#ctx(), extra);
    let def = id ? ACTS[id] : null;
    if (!def) {
      const pool = Object.entries(ACTS).filter(([k, a]) => !a.manual && k !== this.lastId && (!a.when || a.when(ctx)));
      const total = pool.reduce((s, [, a]) => s + Math.max(0, a.weight ? a.weight(ctx) : 1), 0);
      if (!total) return false;
      let r = Math.random() * total;
      for (const [k, a] of pool) { r -= Math.max(0, a.weight ? a.weight(ctx) : 1); if (r <= 0) { id = k; def = a; break; } }
      if (!def) [id, def] = pool[pool.length - 1];
    }
    this.lastId = id;
    this.act = { id, def, t: 0, fired: new Set(), ctx };
    return true;
  }

  cancel() { this.act = null; }

  #canRun() { const c = this.c; return c.pose === 'stand' && c.mode === 'idle' && c.view.kind === 'rig' && c.view.id === 'stand'; }

  /** extra: the reaction layer (Reactor.out) — its offsets and body channels are added on top of the act. */
  update(dt, extra = null) {
    const o = this.out;
    o.j = {}; o.lean = 0; o.rise = 0; o.ex = 0; o.ey = 0; o.mouth = null; o.gaze = null;
    this.t += dt;
    const c = this.c;
    const standing = this.#canRun();
    if (this.act && !standing) this.act = null;
    let snappy = false;
    if (this.act) {
      const a = this.act;
      a.t += dt;
      snappy = !!a.def.snappy;
      a.def.frame(a.t, o, a.ctx);
      for (const [i, [time, fn]] of (a.def.events || []).entries()) {
        if (!a.fired.has(i) && a.t >= time) { a.fired.add(i); try { fn(a.ctx); } catch (err) { console.warn('[idle]', err); } }
      }
      if (a.t >= a.def.dur) this.act = null;
    }
    if (standing) {
      // weight shift: every few seconds she settles onto the other leg — hips one way, shoulders and head the
      // other — with a slow sway on top, so she never stands perfectly still
      const w = this.weight;
      w.next -= dt;
      if (w.next <= 0) { w.side = -w.side; w.next = rand(5, 11); }
      w.x += (w.side - w.x) * (1 - Math.exp(-dt * 1.4));
      o.lean += 0.007 * w.x + 0.003 * Math.sin(this.t * 0.42) + 0.002 * Math.sin(this.t * 0.17 + 1.3);
      o.j.torso = (o.j.torso || 0) - 0.007 * w.x;
      o.j.headDx = (o.j.headDx || 0) - 0.5 * w.x;
      o.j.head = (o.j.head || 0) - 0.006 * w.x;
    }
    // rig offsets: the act's on the standing rig, plus the reaction layer on whichever rig is showing
    const ex = extra?.j || {};
    const viewRig = c.view.kind === 'rig' ? c.view.id : null;
    const stand = c.a.rig('stand');
    if (stand) {
      if (viewRig === 'stand') { const j = { ...o.j }; for (const [id, v] of Object.entries(ex)) j[id] = (j[id] || 0) + v; stand.offsets = j; }
      else stand.offsets = o.j;
    }
    for (const id of ['sit', 'sleep']) { const r = c.a.rig(id); if (r) r.offsets = viewRig === id ? ex : {}; }
    // body channels: the act's are eased (fast for snappy acts like a shake), the reaction layer is already a
    // spring and is added as is
    const body = c.body;
    const E = this.ease;
    if (c.airborne) { E.lean = 0; E.rise = 0; E.ex = 0; E.ey = 0; }
    const k = 1 - Math.exp(-dt * (snappy ? 38 : 10));
    E.lean += ((standing ? o.lean : 0) - E.lean) * k;
    E.rise += ((standing ? o.rise : 0) - E.rise) * k;
    E.ex += ((standing ? o.ex : 0) - E.ex) * k;
    E.ey += ((standing ? o.ey : 0) - E.ey) * k;
    if (c.airborne) { body.lean = 0; body.rise = 0; body.ex = 0; body.ey = 0; return; }
    body.lean = E.lean + (extra?.lean || 0);
    body.rise = E.rise + (extra?.rise || 0);
    body.ex = E.ex + (extra?.ex || 0);
    body.ey = E.ey + (extra?.ey || 0);
  }
}

export const IDLE_ACTS = Object.keys(ACTS);
