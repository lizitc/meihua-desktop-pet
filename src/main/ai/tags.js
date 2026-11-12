// Streaming parser that removes hidden [e:emotion] / [a:action] tags from model text.
// Tags may be split across chunks; plain '[' that is not a tag passes through untouched.
const TAG = /^\[\s*([eEaA])\s*[:：]\s*([a-zA-Z_]{1,24})\s*\]/;
const PARTIAL = /^\[\s*(?:[eEaA]\s*(?:[:：]\s*[a-zA-Z_]*\s*)?)?$/;

export class TagParser {
  constructor(onText, onTag) {
    this.onText = onText;
    this.onTag = onTag;
    this.buf = '';
    this.inFence = false;
    this.atStart = true;
  }

  #emit(s) {
    if (!s) return;
    // track fenced code so tags inside code are left alone
    const fences = s.match(/```/g);
    if (fences && fences.length % 2) this.inFence = !this.inFence;
    if (this.atStart) { s = s.replace(/^\s+/, ''); if (!s) return; this.atStart = false; }
    this.onText(s);
  }

  push(chunk) { this.buf += chunk; this.#drain(false); }
  flush() { this.#drain(true); }

  #drain(final) {
    for (;;) {
      if (this.inFence) {
        const end = this.buf.indexOf('```');
        if (end < 0) { if (final || this.buf.length > 3) { const keep = final ? 0 : 2; this.#emit(this.buf.slice(0, this.buf.length - keep)); this.buf = this.buf.slice(this.buf.length - keep); } return; }
        this.#emit(this.buf.slice(0, end + 3)); this.buf = this.buf.slice(end + 3);
        continue;
      }
      const i = this.buf.search(/\[|```/);
      if (i < 0) {
        // hold back trailing backticks: they may be the start of a fence split across chunks
        const keep = final ? 0 : (/`{1,2}$/.exec(this.buf)?.[0].length || 0);
        this.#emit(this.buf.slice(0, this.buf.length - keep));
        this.buf = this.buf.slice(this.buf.length - keep);
        return;
      }
      if (i > 0) { this.#emit(this.buf.slice(0, i)); this.buf = this.buf.slice(i); }
      if (this.buf.startsWith('```')) { this.#emit('```'); this.buf = this.buf.slice(3); continue; }
      const m = TAG.exec(this.buf);
      if (m) {
        this.onTag(m[1].toLowerCase(), m[2].toLowerCase());
        this.buf = this.buf.slice(m[0].length);
        if (this.atStart) this.buf = this.buf.replace(/^\s+/, '');
        continue;
      }
      if (!final && this.buf.length < 32 && PARTIAL.test(this.buf)) return; // wait for more input
      this.#emit(this.buf[0]); this.buf = this.buf.slice(1);
    }
  }
}

// ------------------------------------------------------------ stage directions
// The character card asks for one short bracketed body cue per reply, e.g. （耳朵轻轻抖了一下）.
// It stays in the shown text, is never spoken, and becomes a real expression / action on the character.
const STAGE_MAX = 30;
const CJK = /[㐀-鿿]/;

/**
 * Streaming splitter for already tag-free text. onSpeech receives the text without stage directions,
 * onStage(content) each completed direction. Half-width parentheses count only around Chinese text,
 * so code and English asides are spoken normally.
 */
export class StageParser {
  constructor(onSpeech, onStage) { this.onSpeech = onSpeech; this.onStage = onStage; this.buf = ''; this.open = null; }

  push(t) {
    for (const ch of t) {
      if (this.open) {
        this.buf += ch;
        const close = this.open === '（' ? '）' : ')';
        if (ch === close) {
          const inner = this.buf.slice(1, -1);
          if (this.open === '(' && !CJK.test(inner)) this.onSpeech(this.buf); else this.onStage(inner.trim());
          this.buf = ''; this.open = null;
        } else if (ch === '\n' || this.buf.length > STAGE_MAX + 2) { this.onSpeech(this.buf); this.buf = ''; this.open = null; }
      } else if (ch === '（' || ch === '(') { this.open = ch; this.buf = ch; }
      else this.onSpeech(ch);
    }
  }

  flush() { if (this.buf) this.onSpeech(this.buf); this.buf = ''; this.open = null; }
}

/** Split a finished string: { speech, stages[] }. */
export function splitStage(s) {
  let speech = '';
  const stages = [];
  const p = new StageParser((t) => { speech += t; }, (c) => stages.push(c));
  p.push(String(s || ''));
  p.flush();
  return { speech: speech.replace(/[ \t]{2,}/g, ' ').trim(), stages };
}

// keyword → cue. The first matching action and the first matching emotion win.
const STAGE_ACTIONS = [
  [/耳朵?.{0,6}(垂|耷|贴|塌|压)/, 'droop_ears'], [/耳朵?.{0,6}(竖|立|抖|动|颤|翘|扑)/, 'perk_ears'],
  [/尾巴.{0,6}(摇|晃|甩|摆)/, 'wag'], [/歪.{0,2}头/, 'tilt_head'], [/点.{0,2}头/, 'nod'], [/摇.{0,2}头/, 'shake_head'],
  [/(提裙|行礼|屈膝)/, 'curtsy'], [/鞠躬/, 'bow'], [/(挥手|招手|挥挥手)/, 'wave'], [/(蹦|跳起|跳了)/, 'hop'], [/转(了个|个)?圈/, 'spin'],
  [/伸.{0,2}懒腰/, 'stretch'], [/(哈欠|呵欠)/, 'yawn'], [/揉.{0,2}眼/, 'rub_eyes'], [/(嗅|闻了闻|吸了吸鼻子)/, 'sniff'],
  [/(偷笑|窃笑|噗嗤|嘻嘻)/, 'giggle'], [/深呼吸/, 'deep_breath'], [/(哼着|哼起|哼歌)/, 'hum'], [/(探头|张望)/, 'peek'], [/跺.{0,2}脚/, 'foot_tap'],
];
const STAGE_EMOTIONS = [
  [/(滚烫|发烫|红透|语无伦次|慌|手足无措|捂住?脸)/, 'flustered'], [/(脸红|红了|泛红|害羞|羞|低下头|红晕)/, 'shy'],
  [/(泪|哭腔|水光|眼眶)/, 'touched'], [/(鼓起|鼓腮|嘟嘴|撅嘴)/, 'pout'], [/(叹气|失落|垂头)/, 'sad'],
  [/(瞪大|愣住|吓)/, 'surprised'], [/(眯起眼|笑眯眯|弯起眼|笑了|微笑|笑)/, 'happy'], [/(困|打盹|迷迷糊糊)/, 'sleepy'], [/(认真|严肃|冷静)/, 'serious'],
];

/** Expression / action cues read from one stage direction. */
export function stageCues(text) {
  const t = String(text || '');
  return {
    action: STAGE_ACTIONS.find(([re]) => re.test(t))?.[1] || null,
    emotion: STAGE_EMOTIONS.find(([re]) => re.test(t))?.[1] || null,
  };
}

/** Strip tags from a finished string; returns { text, tags: [[kind, name]] }. */
export function stripTags(s) {
  const tags = [];
  let text = '';
  const p = new TagParser((t) => { text += t; }, (k, n) => tags.push([k, n]));
  p.push(String(s || ''));
  p.flush();
  return { text, tags };
}
