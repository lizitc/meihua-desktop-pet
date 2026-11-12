// 小窝: Meihua's room. A cosy scene with her standing on the rug (click to pat her), her level,
// mood / fullness / intimacy, the daily check-in calendar, the food shop + pantry, a growth log
// and how to earn berries. Feeding here plays the eating act on the desktop character too.
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { invoke, attempt, useRpc, toast, ago, navigate, WEEK, pad } from '../lib.js';
import { Sheet, Seg } from '../kit.js';

const ROOM = 'meihua://app/assets/app/room.jpg';
const STANDING = 'meihua://app/assets/app/standing.png';
const STANDING_HAPPY = 'meihua://app/assets/app/standing-happy.png';
const INTIMACY = [[0, '初识'], [50, '熟悉'], [150, '亲近'], [400, '信赖'], [900, '形影不离']];
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const PAT_LINES = ['嘿嘿……被摸头了～', '再、再摸一下也可以哦。', '尾巴自己摇起来了……', '最喜欢{name}的手了。', '呜……好舒服。'];
const COZY_LINES = ['欢迎来我的小窝玩～', '今天也要一起加油哦！', '窗外的花开得好好看。', '{name}，要不要摸摸我的头？', '我把房间收拾得干干净净的！'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function moodLine(s, name) {
  const fill = (t) => t.replaceAll('{name}', name);
  if (s.hunger < 15) return '肚子饿扁了……可以给我一点吃的吗？';
  if (s.hunger < 35) return '肚子在咕咕叫了……';
  if (s.mood < 25) return fill('有点寂寞……{name}陪我说说话好不好？');
  if (!s.checkedToday) return '今天还没有签到哦～';
  if (s.mood >= 85) return '今天超开心的！';
  return fill(pick(COZY_LINES));
}

function Bar({ value, max = 100, kind, label, tail }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return html`<div class=${`nbar ${kind}`}>
    <div class="nbar-top"><span class="nbar-label">${label}</span><span class="nbar-tail">${tail}</span></div>
    <div class="nbar-track"><i style=${`width:${pct}%`}></i></div>
  </div>`;
}

// ------------------------------------------------------------ room scene
// She stands on the floor of her room and walks about in it (the desktop pet's walk and turn drawings, scaled
// down): now and then on her own, or to wherever you click on the floor. Clicking her reacts per body part.
const CHAR = 'meihua://app/assets/character/';
const HEIGHT = 314;                        // px for the 1000 native units of the standing art
const K = HEIGHT / 1000;
const BOX = { w: 600, ox: 300, oy: 969 };  // the drawing box around her, native units (origin = between her feet)
const STAND = { w: 508, h: 1000, ox: 254, oy: 969 };
const PART_ORDER = ['ear-left', 'ear-right', 'hand-left', 'hand-right', 'foot-left', 'foot-right', 'face', 'head', 'tail', 'chest',
  'thigh-left', 'thigh-right', 'calf-left', 'calf-right', 'skirt', 'body', 'hair'];
// per part: what she does (happy face / hearts / flinch / giggle), whether it counts as affection, and what she says
// once poked again and again (the first poke uses the part's own line from the manifest)
const NEST_REACT = {
  head: { happy: true, hearts: 3, pat: true, more: PAT_LINES },
  ear: { happy: true, hearts: 1, pat: true, more: ['耳朵……被摸得好舒服……', '唔……耳朵尖尖好痒。'] },
  hair: { happy: true, pat: true, more: ['{name}的手法好温柔。', '再梳一会儿嘛～'] },
  hand: { happy: true, hearts: 2, pat: true, more: ['嘿嘿，被{name}牵住了。', '……不想放开了呢。'] },
  face: { happy: true, hearts: 1, more: ['脸、脸要烫起来了……', '呜……一直戳脸的话，会害羞到说不出话的啦。'] },
  chest: { flinch: true, more: ['{name}！手、手放错地方了啦！', '哼！再这样我真的要生气了哦！（鼓起脸）'] },
  skirt: { flinch: true, more: ['{name}笨蛋！不许碰裙子！', '哼！（转过头去）'] },
  thigh: { flinch: true, more: ['{name}好坏……（拉住裙摆）', '再这样……人家要躲起来了啦！'] },
  tail: { happy: true, more: ['尾、尾巴好敏感……', '尾巴都摇成这样了，{name}满意了吧……（小声）'] },
  calf: { giggle: true, more: ['嘻嘻，小腿痒痒的～', '哈哈……腿要站不稳了……'] },
  foot: { giggle: true, more: ['呀哈哈，脚心不行！', '痒、痒死了——{name}快住手！'] },
  body: { giggle: true, more: ['哈哈、好痒！', '不、不要挠了啦，哈哈哈……'] },
};
const reactKind = (id) => (id.startsWith('ear') ? 'ear' : id.startsWith('hand') ? 'hand' : id.startsWith('thigh') ? 'thigh'
  : id.startsWith('calf') || id.startsWith('leg') ? 'calf' : id.startsWith('foot') ? 'foot' : NEST_REACT[id] ? id : 'body');

const bitmaps = new Map();
/** A picture decoded once at the size it is drawn (cached across visits to the page). */
function bitmap(url, w, h) {
  const key = `${url}@${w}x${h}`;
  if (!bitmaps.has(key)) {
    bitmaps.set(key, fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.blob(); })
      .then((b) => createImageBitmap(b, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }))
      .catch((err) => { bitmaps.delete(key); throw err; }));
  }
  return bitmaps.get(key);
}
let manifestP = null;
const loadManifest = () => (manifestP ||= fetch(CHAR + 'manifest.json').then((r) => r.json()).catch((err) => { manifestP = null; throw err; }));

/** Draws her into a canvas and walks her about; plain object (not React state) so the walk does not re-render. */
class RoomWalker {
  constructor({ canvas, girl, onMove }) {
    this.cv = canvas; this.girl = girl; this.onMove = onMove;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(BOX.w * K * this.dpr); canvas.height = Math.round(1000 * K * this.dpr);
    this.ctx = canvas.getContext('2d');
    this.x = 0; this.range = [0, 0];
    this.pic = null;            // { img, ox, oy } in native units
    this.happy = false;
    this.walking = false; this.alive = true;
    this.token = 0;
  }
  async load() {
    const s = K * this.dpr;
    const size = (w, h, sc = 1) => [Math.max(1, Math.round(w * sc * s)), Math.max(1, Math.round(h * sc * s))];
    const [sw, sh] = size(STAND.w, STAND.h);
    [this.stand, this.standHappy] = await Promise.all([bitmap(STANDING, sw, sh), bitmap(STANDING_HAPPY, sw, sh)]);
    this.show();
    const m = await loadManifest();
    this.parts = m.parts?.stand || [];
    const seqs = {};
    for (const id of ['turn-right', 'walk-right', 'turn-left', 'walk-left']) {
      const d = m.sequences?.[id];
      if (!d) return;
      const [w, h] = size(d.width, d.height, d.scale);
      const frames = await Promise.all(Array.from({ length: d.frames }, (_, i) => bitmap(CHAR + d.path.replace('{i}', String(i).padStart(3, '0')), w, h)));
      if (!this.alive) return;
      seqs[id] = { d, frames };
    }
    this.seqs = seqs;
  }
  get canWalk() { return !!this.seqs && !this.walking; }
  /** Standing (or smiling) picture. */
  show() { this.pic = { img: this.happy ? this.standHappy : this.stand, ox: STAND.ox, oy: STAND.oy }; this.draw(); }
  frame(seq, i) { const { d, frames } = this.seqs[seq]; this.pic = { img: frames[i], ox: d.originX * d.scale, oy: d.baseline * d.scale }; this.draw(); }
  draw() {
    const { ctx, cv } = this;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const p = this.pic;
    if (!p?.img) return;
    const s = K * this.dpr;
    ctx.drawImage(p.img, Math.round((BOX.ox - p.ox) * s), Math.round((BOX.oy - p.oy) * s));
  }
  place(x) {
    this.x = Math.max(this.range[0], Math.min(this.range[1], x));
    this.girl.style.left = `${Math.round(this.x - BOX.ox * K)}px`;
    this.onMove?.(this.x);
  }
  setRange(lo, hi) { this.range = [lo, Math.max(lo, hi)]; this.place(this.x || (lo + hi) / 2); }
  /** Native standing-art point under a client point (null outside the drawing). */
  native(clientX, clientY) {
    const r = this.cv.getBoundingClientRect();
    const bx = ((clientX - r.left) / r.width) * BOX.w, by = ((clientY - r.top) / r.height) * 1000;
    return [bx - BOX.ox + STAND.ox, by];
  }
  solidAt(clientX, clientY) {
    const r = this.cv.getBoundingClientRect();
    const px = Math.floor(((clientX - r.left) / r.width) * this.cv.width), py = Math.floor(((clientY - r.top) / r.height) * this.cv.height);
    try { return this.ctx.getImageData(px, py, 1, 1).data[3] > 24; } catch { return true; }
  }
  partAt(clientX, clientY) {
    if (this.walking || !this.parts) return null;
    const [x, y] = this.native(clientX, clientY);
    const hit = (p) => ((x - p.cx) / p.rx) ** 2 + ((y - p.cy) / p.ry) ** 2 <= 1;
    for (const id of PART_ORDER) { const p = this.parts.find((q) => q.id === id && hit(q)); if (p) return p; }
    return null;
  }
  stop() { this.token++; if (this.walking) { this.walking = false; this.show(); } }
  /** Walk to x (px in the room): turn, step with the planted foot fixed (frame-locked root motion), turn back. */
  async walkTo(tx) {
    if (!this.canWalk) return false;
    tx = Math.max(this.range[0], Math.min(this.range[1], tx));
    const want = Math.abs(tx - this.x);
    if (want < 24) return false;
    const dir = tx > this.x ? 1 : -1, side = dir > 0 ? 'right' : 'left';
    const walk = this.seqs[`walk-${side}`], turn = this.seqs[`turn-${side}`];
    const { d } = walk, n = d.frames, mo = d.rootMotion, px = d.scale * K, frameDur = d.duration / n;
    // frames to play: from a passing frame until the next passing frame where the distance is covered
    const stops = d.passingFrames?.length ? d.passingFrames : [0, n / 2];
    let f = stops[0], dist = 0, plan = [];
    for (let guard = 0; guard < n * 40; guard++) {
      plan.push(f); dist += mo[f] * px; f = (f + 1) % n;
      if (stops.includes(f) && dist >= want * 0.92) break;
    }
    const stretch = Math.max(0.8, Math.min(1.2, want / dist));
    const my = ++this.token;
    this.walking = true;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const live = () => this.alive && this.token === my;
    try {
      const holds = turn.d.holds || new Array(turn.d.frames).fill(turn.d.duration / turn.d.frames);
      for (let i = 0; i < turn.d.frames; i++) { if (!live()) return false; this.frame(`turn-${side}`, i); await sleep(holds[i] * 1000); }
      for (const [j, fr] of plan.entries()) {
        if (!live()) return false;
        this.frame(`walk-${side}`, fr);
        if (j) this.place(this.x + dir * mo[plan[j - 1]] * px * stretch);
        await sleep(frameDur * 1000 / 0.9);
      }
      if (!live()) return false;
      this.place(this.x + dir * mo[plan[plan.length - 1]] * px * stretch);
      for (let i = turn.d.frames - 1; i >= 0; i--) { if (!live()) return false; this.frame(`turn-${side}`, i); await sleep(holds[i] * 1000); }
      return true;
    } finally {
      if (this.token === my) { this.walking = false; if (this.alive) this.show(); }
    }
  }
  dispose() { this.alive = false; this.token++; }
}

function Room({ s, name, munch }) {
  const [line, setLine] = useState(() => moodLine(s, name));
  const [hearts, setHearts] = useState([]);
  const [anim, setAnim] = useState({ cls: '', n: 0 });
  const [happyUntil, setHappyUntil] = useState(0);
  const [walking, setWalking] = useState(false);
  const seq = useRef(0);
  const roomRef = useRef(null), girlRef = useRef(null), cvRef = useRef(null), bubbleRef = useRef(null);
  const walker = useRef(null);
  const pokes = useRef({ kind: null, n: 0, at: 0 });
  const fill = (t) => t.replaceAll('{name}', name);
  const smile = (ms) => { const until = Date.now() + ms; setHappyUntil(until); setTimeout(() => setHappyUntil((u) => (u === until ? 0 : u)), ms + 30); };
  const play = (cls) => setAnim((a) => ({ cls, n: a.n + 1 }));
  useEffect(() => { if (!munch) setLine(moodLine(s, name)); }, [s.hunger < 35, s.mood < 25, s.checkedToday]);
  useEffect(() => { if (munch) { walker.current?.stop(); setLine(munch.line); smile(2800); } }, [munch?.at]);
  useEffect(() => { const w = walker.current; if (w) { w.happy = !!happyUntil; if (!w.walking) w.show(); } }, [happyUntil]);

  // the walker: floor range from the room's width (right of the name card), wandering when left alone
  useEffect(() => {
    const room = roomRef.current;
    const w = new RoomWalker({ canvas: cvRef.current, girl: girlRef.current, onMove: (x) => {
      const b = bubbleRef.current; if (!b) return;
      // beside her head, to the right if it fits, never over the name card
      const W = room.clientWidth, bw = b.offsetWidth || 180, card = 290;
      const want = x + 46, left = Math.max(card, Math.min(want, W - bw - 8));
      b.style.left = `${Math.round(left)}px`;
      b.classList.toggle('to-left', left < want - 20);
    } });
    walker.current = w;
    window.__nestWalker = w; // for the self-test
    const fit = () => { const W = room.clientWidth; w.setRange(Math.min(W - 120, 330), W - 80); };
    w.x = room.clientWidth * 0.62; fit();
    const ro = new ResizeObserver(fit); ro.observe(room);
    w.load().catch((err) => { w.loadError = err.message; console.warn('[nest] walker', err.message); });
    let timer = null;
    const wander = () => {
      timer = setTimeout(async () => {
        if (!document.hidden && w.canWalk && Date.now() - pokes.current.at > 6000) {
          const [lo, hi] = w.range;
          let tx = lo + Math.random() * (hi - lo);
          if (Math.abs(tx - w.x) < 80) tx = w.x + (tx < w.x ? -1 : 1) * 120;
          setWalking(true); await w.walkTo(tx); setWalking(false);
        }
        if (w.alive) wander();
      }, 5000 + Math.random() * 7000);
    };
    wander();
    return () => { clearTimeout(timer); ro.disconnect(); w.dispose(); };
  }, []);

  const burst = (x, y, n) => {
    const add = Array.from({ length: n }, (_, i) => ({ id: ++seq.current, x: x + (i - (n - 1) / 2) * 16, y: y - 8, d: i * 90 }));
    setHearts((h) => [...h.slice(-9), ...add]);
    setTimeout(() => setHearts((h) => h.filter((p) => !add.includes(p))), 1400);
  };
  const walkHere = (clientX) => {
    const w = walker.current;
    if (!w?.canWalk) return;
    pokes.current.at = Date.now();
    setWalking(true);
    w.walkTo(clientX - roomRef.current.getBoundingClientRect().left).then(() => setWalking(false));
  };
  const touch = (e) => {
    const w = walker.current;
    e.stopPropagation();
    if (!w) return;
    if (w.walking) { w.stop(); setWalking(false); setLine(fill('诶？{name}叫我吗？')); smile(1400); return; }
    if (!w.solidAt(e.clientX, e.clientY)) { walkHere(e.clientX); return; }
    const part = w.partAt(e.clientX, e.clientY) || { id: 'body', phrase: '' };
    const kind = reactKind(part.id), R = NEST_REACT[kind];
    const now = Date.now(), pk = pokes.current;
    pk.n = pk.kind === kind && now - pk.at < 4000 ? pk.n + 1 : 1; pk.kind = kind; pk.at = now;
    const r = girlRef.current.getBoundingClientRect();
    if (R.hearts) burst(e.clientX - r.left, e.clientY - r.top, R.hearts);
    if (R.happy) smile(1600);
    play(R.flinch ? 'flinch' : R.giggle ? 'giggle' : `squish${pk.n % 2}`);
    setLine(fill(pk.n === 1 && part.phrase ? part.phrase : R.more[Math.min(R.more.length - 1, Math.floor((pk.n - 1) / 2))] || pick(R.more)));
    if (R.pat && (pk.n === 1 || pk.n % 3 === 0)) invoke('life.event', { type: 'pat' }).catch(() => {});
  };
  const floorClick = (e) => { if (!e.target.closest('.room-card, .room-bubble, .room-girl')) walkHere(e.clientX); };
  // a new line is a new bubble element: put it next to her
  useLayoutEffect(() => { const w = walker.current; if (w) w.onMove(w.x); }, [line]);
  const xpPct = Math.round((s.xp / s.xpNext) * 100);
  return html`<section class=${`room sheet flush ${walking ? 'is-walking' : ''}`} ref=${roomRef} onClick=${floorClick}>
    <div class="room-bg" style=${`background-image:url("${ROOM}")`}></div>
    <div class="room-card">
      <div class="room-name">御园莓华 <em class="lv-chip">Lv.${s.level}</em></div>
      <div class="room-sub">${ICON.heart}<span>${s.intimacyTitle}</span><span class="dot-sep">·</span><span>陪伴第 ${s.days} 天</span></div>
      <div class="room-xp" title=${`经验 ${s.xp} / ${s.xpNext}`}><i style=${`width:${xpPct}%`}></i></div>
      <div class="room-xp-text">经验 ${s.xp} / ${s.xpNext}<span>距离 Lv.${s.level + 1} 还差 ${s.xpNext - s.xp}</span></div>
      <div class="room-coins"><span class="coin big">${s.coins}</span><span class="muted">莓果</span></div>
      <div class="room-tip">点她的头、手、脸……会有不同反应；点地板，她会走过去。</div>
    </div>
    <div class="room-bubble" ref=${bubbleRef} key=${line}>${line}</div>
    <button class=${`room-girl ${anim.cls ? `${anim.cls} n${anim.n % 2}` : ''}`} key=${'g'} ref=${girlRef} onClick=${touch} title="摸摸她"
      style=${`width:${BOX.w * K}px;height:${HEIGHT}px`}>
      <canvas class="girl-cv" ref=${cvRef}></canvas>
      ${hearts.map((h) => html`<i class="room-heart" key=${h.id} style=${`left:${h.x}px;top:${h.y}px;animation-delay:${h.d}ms`}>${ICON.heart}</i>`)}
      ${munch ? html`<img class="room-munch" key=${'m' + munch.at} src=${munch.icon} alt="" draggable="false" />` : null}
      <div class="room-shadow"></div>
    </button>
  </section>`;
}

// ------------------------------------------------------------ status
function Status({ s }) {
  const tier = INTIMACY.findIndex(([min]) => s.intimacy < min);
  const next = tier === -1 ? null : INTIMACY[tier];
  const prevMin = tier === -1 ? INTIMACY[INTIMACY.length - 1][0] : INTIMACY[tier - 1][0];
  return html`<${Sheet} title="状态" icon="heart" tape="berry" class="area-status">
    <div class="nbars">
      <${Bar} kind="mood" label=${html`${ICON.heart}心情`} value=${s.mood} tail=${`${s.mood} · ${s.moodLabel}`} />
      <${Bar} kind="hunger" label=${html`${ICON.food}饱食度`} value=${s.hunger} tail=${`${s.hunger} · ${s.hungerLabel}`} />
      <${Bar} kind="intimacy" label=${html`${ICON.pawPrint}亲密度`} value=${next ? s.intimacy - prevMin : 1} max=${next ? next[0] - prevMin : 1}
        tail=${next ? `${s.intimacy} · ${s.intimacyTitle} → ${next[1]}` : `${s.intimacy} · ${s.intimacyTitle}`} />
    </div>
    <p class="nest-hint">${ICON.pawPrint}<span>饱食度每小时会下降一点点；饿着肚子或者很久没人理她，心情就会慢慢变差。喂她、摸摸头、陪她聊天都能让她开心起来。</span></p>
  <//>`;
}

// ------------------------------------------------------------ check-in
function CheckIn({ s, days }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [busy, setBusy] = useState(false);
  const set = new Set(days || []);
  const today = dayKey(new Date());
  const first = month.getDay();
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= count; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  const streakNext = s.checkedToday ? s.streak : s.streak + 1;
  const coinsNext = 20 + 5 * Math.min(Math.max(streakNext, 1) - 1, 6);
  const giftIn = 7 - (s.streak % 7);
  const doIt = async () => {
    setBusy(true);
    const r = await attempt('life.checkin');
    setBusy(false);
    if (!r) return;
    if (!r.ok) { toast(r.message, 'info'); return; }
    toast(`签到成功！莓果 +${r.coins}，经验 +${r.xp}${r.gift ? `，收到礼物：${r.gift}` : ''}`, 'ok', 4200);
  };
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  return html`<${Sheet} title="每日签到" icon="stamp" tape="honey" class="area-checkin">
    <div class="ck-head">
      <div class="ck-streak"><b>${s.streak}</b><span>天连续</span></div>
      <div class="ck-meta">
        <span>最长 ${s.bestStreak} 天 · 累计 ${s.totalCheckins} 天</span>
        <span>${s.checkedToday ? `明天签到：莓果 +${20 + 5 * Math.min(s.streak, 6)}` : `今日奖励：莓果 +${coinsNext}，经验 +${20 + 2 * Math.min(streakNext, 10)}`}</span>
        <span class="ck-gift">${ICON.sparkle}${giftIn === 7 && s.checkedToday && s.streak ? '今天收到了草莓蛋糕！' : `再连续签到 ${giftIn} 天，会收到草莓蛋糕`}</span>
      </div>
      <button class=${`btn ${s.checkedToday ? '' : 'primary'} big ck-btn`} disabled=${s.checkedToday || busy} onClick=${doIt}>
        ${s.checkedToday ? html`${ICON.check}今天已签到` : html`${ICON.stamp}签到`}
      </button>
    </div>
    <div class="ck-cal">
      <div class="ck-month"><button class="icon-btn small" onClick=${() => shift(-1)} title="上个月">${ICON.left}</button>
        <span>${month.getFullYear()} 年 ${month.getMonth() + 1} 月</span>
        <button class="icon-btn small" onClick=${() => shift(1)} title="下个月">${ICON.right}</button></div>
      <div class="ck-grid">
        ${WEEK.map((w) => html`<span class="ck-wd">${w}</span>`)}
        ${cells.map((d, i) => {
          if (!d) return html`<span key=${'e' + i}></span>`;
          const k = dayKey(d), on = set.has(k);
          return html`<span key=${k} class=${`ck-day ${on ? 'on' : ''} ${k === today ? 'today' : ''} ${k > today ? 'future' : ''}`} title=${on ? `${k} 已签到` : k}>
            <em>${d.getDate()}</em>${on ? ICON.pawPrint : null}
          </span>`;
        })}
      </div>
    </div>
  <//>`;
}

// ------------------------------------------------------------ shop + pantry
function Shop({ s, foods, onFed }) {
  const [tab, setTab] = useState('all');
  const list = (foods || []).filter((f) => tab === 'all' || (tab === 'have' ? f.stock > 0 : f.unlocked));
  const feed = async (f) => {
    const r = await attempt('life.feed', { food: f.id, buy: !f.stock, from: 'panel' });
    if (!r) return;
    if (!r.ok) { toast(r.message, r.reason === 'full' ? 'info' : 'error'); return; }
    onFed(r.food);
    toast(`${r.food.name}：${r.food.gain}${r.leveled ? '，升级啦！' : ''}`, 'ok');
  };
  const buy = async (f) => { if (await attempt('life.buy', { food: f.id, n: 1 })) toast(`买了一份${f.name}，放进背包啦`, 'ok'); };
  const have = (foods || []).filter((f) => f.stock > 0).length;
  return html`<${Sheet} title="小厨房" icon="food" tape="mint" class="area-shop"
    actions=${html`<${Seg} small value=${tab} onChange=${setTab} options=${[{ value: 'all', label: '全部' }, { value: 'have', label: '背包', badge: have || null }, { value: 'shop', label: '可购买' }]} />`}>
    <div class="shop-grid">
      ${list.map((f) => {
        const poor = !f.stock && f.price > s.coins;
        const full = s.hunger >= 96;
        if (!f.unlocked) return html`<div class="shop-item locked" key=${f.id}>
          <img src=${f.icon} alt="" draggable="false" /><div class="shop-name">${f.name}</div>
          <div class="shop-lock">${ICON.lock || ICON.key}Lv.${f.level} 解锁</div></div>`;
        return html`<div class=${`shop-item ${f.stock ? 'have' : ''}`} key=${f.id}>
          ${f.favorite ? html`<span class="shop-fav" title="最喜欢">${ICON.heart}</span>` : null}
          ${f.stock ? html`<span class="shop-stock">×${f.stock}</span>` : null}
          <img src=${f.icon} alt="" draggable="false" />
          <div class="shop-name">${f.name}</div>
          <div class="shop-fx"><span class="fx-h">饱食 +${f.hunger}</span><span class="fx-m">心情 +${f.mood}</span></div>
          <div class="shop-actions">
            <button class="btn small primary" disabled=${full || poor} title=${full ? '她已经吃饱啦' : poor ? '莓果不够' : f.stock ? '从背包里拿一份喂她' : `花 ${f.price} 莓果买来喂她`} onClick=${() => feed(f)}>
              ${f.stock ? '喂她' : html`买来喂 <span class="coin">${f.price}</span>`}
            </button>
            <button class="btn small" disabled=${f.price > s.coins} title=${`买一份放进背包（${f.price} 莓果）`} onClick=${() => buy(f)}>${ICON.plus}<span class="coin">${f.price}</span></button>
          </div>
        </div>`;
      })}
      ${!list.length ? html`<p class="muted small pad">背包空空的，去「可购买」里挑点好吃的吧。</p>` : null}
    </div>
  <//>`;
}

// ------------------------------------------------------------ log + stats
function Growth({ s, log }) {
  const st = s.stats || {};
  const tiles = [
    ['pawPrint', '摸摸头', st.pats], ['food', '投喂', st.feeds], ['chat', '聊天', st.chats],
    ['todo', '完成待办', st.todos], ['workshop', '工坊任务', st.tasks], ['sparkle', '被甩飞', st.flings],
  ];
  return html`<${Sheet} title="成长记录" icon="sparkle" tape="lav" class="area-log">
    <div class="stat-tiles">${tiles.map(([icon, label, n]) => html`<div class="stat-tile">${ICON[icon]}<b>${n || 0}</b><span>${label}</span></div>`)}</div>
    <div class="life-log">
      ${(log || []).slice(0, 14).map((e) => html`<div class="log-row" key=${e.ts + e.text}><i></i><span class="log-text">${e.text}</span><span class="log-at">${ago(e.ts)}</span></div>`)}
      ${log && !log.length ? html`<p class="muted small pad">还没有记录。签到、喂食、完成待办都会写在这里。</p>` : null}
    </div>
  <//>`;
}

function Earn() {
  const rows = [
    ['stamp', '每日签到', '莓果 20～50，连续 7 天送草莓蛋糕'],
    ['chat', '和她聊天', '每天最多 20 莓果，还会涨亲密度'],
    ['todo', '完成待办', '每件 +4 莓果、+6 经验'],
    ['workshop', '工坊完成任务', '每个 +10 莓果、+15 经验'],
    ['pawPrint', '摸摸头', '心情 +2、亲密度 +1'],
    ['star', '升级', '奖励 20 × 等级 的莓果，解锁新食物'],
  ];
  return html`<${Sheet} title="怎么攒莓果" icon="star" tape="sky" class="area-earn">
    <div class="earn-list">${rows.map(([icon, t, d]) => html`<div class="earn-row">${ICON[icon]}<b>${t}</b><span>${d}</span></div>`)}</div>
    <div class="earn-actions">
      <button class="btn small" onClick=${() => navigate('chat')}>${ICON.chat}去聊天</button>
      <button class="btn small" onClick=${() => navigate('todos')}>${ICON.todo}看看待办</button>
    </div>
  <//>`;
}

export function NestPage({ settings }) {
  const { data: s } = useRpc('life.get', [], ['life:state']);
  const { data: foods } = useRpc('life.foods', [], ['life:state']);
  const { data: log } = useRpc('life.log', [], ['life:state']);
  const { data: days } = useRpc('life.days', [], ['life:state']);
  const [munch, setMunch] = useState(null);
  if (!s) return html`<div class="boot">${ICON.pawPrint}</div>`;
  const name = settings.user.callName || '主人';
  const onFed = (food) => setMunch({ icon: food.icon, line: food.line || '啊呜——好好吃！', at: Date.now() });
  return html`<div class="nest-grid">
    <${Room} s=${s} name=${name} munch=${munch} />
    <${CheckIn} s=${s} days=${days} />
    <${Status} s=${s} />
    <${Shop} s=${s} foods=${foods} onFed=${onFed} />
    <${Growth} s=${s} log=${log} />
    <${Earn} />
  </div>`;
}

/** Small card for the 今天 page. */
export function NestMini() {
  const { data: s } = useRpc('life.get', [], ['life:state']);
  if (!s) return null;
  const checkin = async () => {
    const r = await attempt('life.checkin');
    if (r?.ok) toast(`签到成功！莓果 +${r.coins}`, 'ok'); else if (r) toast(r.message);
  };
  return html`<div class="nest-mini">
    <div class="nm-top"><em class="lv-chip">Lv.${s.level}</em><span>${s.intimacyTitle}</span><span class="coin">${s.coins}</span></div>
    <div class="nm-bars">
      <div title=${`心情 ${s.mood}（${s.moodLabel}）`}>${ICON.heart}<i class="nm-track mood"><i style=${`width:${s.mood}%`}></i></i></div>
      <div title=${`饱食度 ${s.hunger}（${s.hungerLabel}）`}>${ICON.food}<i class="nm-track hunger"><i style=${`width:${s.hunger}%`}></i></i></div>
    </div>
    <div class="nm-actions">
      <button class=${`btn small ${s.checkedToday ? '' : 'primary'}`} disabled=${s.checkedToday} onClick=${checkin}>${s.checkedToday ? html`${ICON.check}已签到` : html`${ICON.stamp}签到`}</button>
      <button class="btn small ghost" onClick=${() => navigate('nest')}>去小窝 →</button>
    </div>
  </div>`;
}
