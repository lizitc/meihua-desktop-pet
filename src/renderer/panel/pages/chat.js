// 聊天: the full conversation log (shared with the character's bubble), streamed live,
// with tool chips, proactive notes, image attachments, stop and "new topic".
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { invoke, attempt, useEvent, navigate, toast, confirmBox, Markdown, portrait, fmtTime, dayLabel, readImage } from '../lib.js';
import { AutoTextarea, Dots, Empty } from '../kit.js';

const SOURCE = { routine: '例行任务', brief: '今日简报', reminder: '提醒', review: '晚间回顾', bedtime: '就寝提醒' };
const SUGGEST = [
  '明天下午三点提醒我开周会',
  '帮我看看今天还有哪些待办',
  '你都会帮我做些什么呀？',
  '在工坊里帮我写个批量重命名照片的脚本',
];

function ToolChips({ tools, live }) {
  if (!tools?.length && !live) return null;
  return html`<div class="tool-chips">
    ${(tools || []).map((t) => html`<span class=${`tool-chip ${t.status}`} title=${t.error || t.name}>${t.status === 'done' ? ICON.check : t.status === 'error' ? ICON.warn : ICON.tool}${t.label}</span>`)}
    ${live ? html`<span class="tool-chip running">${ICON.tool}${live}</span>` : null}
  </div>`;
}

function Entry({ e, onRetry }) {
  if (e.role === 'divider') return html`<div class="chat-divider"><span>${e.text || '新话题'}</span></div>`;
  if (e.role === 'user') {
    return html`<div class="msg me">
      <div class="msg-col">
        ${e.source === 'pet' ? html`<span class="msg-src">${ICON.pawPrint}在桌面上说</span>` : null}
        <div class="bubble-me">${e.images?.length ? html`<span class="img-chip">${ICON.image}图片 ×${e.images.length}</span>` : null}<span class="plain">${e.text}</span></div>
        ${e.failed ? html`<div class="msg-fail">${ICON.warn}没有发出去<button class="link" onClick=${() => onRetry(e)}>重新发送</button></div>` : null}
      </div>
    </div>`;
  }
  if (e.source === 'reaction' || e.source === 'director') {
    return html`<div class="msg aside"><img class="mini-face" src=${portrait} alt="" /><span>${e.text}</span><time>${fmtTime(new Date(e.ts))}</time></div>`;
  }
  const cfgErr = e.error && /AI|密钥|key|模型|设置|401|403/i.test(e.error);
  return html`<div class="msg her">
    <img class="face" src=${portrait} alt="莓华" draggable="false" />
    <div class="msg-col">
      ${e.proactive ? html`<span class="msg-src">${ICON.sparkle}${SOURCE[e.source] || '主动'}</span>` : null}
      <div class=${`bubble-her ${e.streaming ? 'streaming' : ''}`}>
        ${e.text ? html`<${Markdown} text=${e.text} />` : e.streaming ? html`<${Dots} />` : e.error ? null : html`<span class="muted">（……）</span>`}
        <${ToolChips} tools=${e.tools} live=${e.streaming ? e.liveTool : null} />
      </div>
      ${e.error ? html`<div class="msg-error">${ICON.warn}<span>${e.error}</span>${cfgErr ? html`<button class="link" onClick=${() => navigate('settings/ai')}>去设置</button>` : null}</div>` : null}
    </div>
  </div>`;
}

function withTimes(entries) {
  const out = [];
  let last = 0;
  for (const e of entries) {
    if (e.ts && e.ts - last > 15 * 60000) {
      const d = new Date(e.ts);
      out.push({ id: `t_${e.id}`, role: 'time', text: `${dayLabel(d)} ${fmtTime(d)}` });
    }
    if (e.ts) last = e.ts;
    out.push(e);
  }
  return out;
}

export function ChatPage({ settings }) {
  const [entries, setEntries] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState([]);
  const [drag, setDrag] = useState(false);
  const scroller = useRef(null);
  const stick = useRef(true);
  const prepend = useRef(null);

  const refreshStatus = async () => { const s = await invoke('chat.status').catch(() => null); if (s) { setStatus(s); setBusy(s.busy); } };
  useEffect(() => {
    invoke('chat.log', { limit: 80 }).then((list) => { setEntries(list); setHasMore(list.length >= 80); }).catch((err) => { toast(err.message, 'error'); setEntries([]); });
    refreshStatus();
  }, []);

  const patch = (pred, fn) => setEntries((list) => (list ? list.map((e) => (pred(e) ? fn(e) : e)) : list));
  useEvent('chat:log', (e) => setEntries((list) => (list && !list.some((x) => x.id === e.id) ? [...list, e] : list)));
  useEvent('chat:log-update', ({ id, patch: p }) => patch((e) => e.id === id, (e) => ({ ...e, ...p, liveTool: p.streaming === false ? null : e.liveTool })));
  useEvent('chat:delta', ({ turnId, text: t }) => patch((e) => e.turnId === turnId && e.streaming, (e) => ({ ...e, text: (e.text || '') + t, liveTool: null })));
  useEvent('chat:tool', ({ turnId, label }) => patch((e) => e.turnId === turnId && e.streaming, (e) => ({ ...e, liveTool: label })));
  useEvent('chat:start', () => setBusy(true));
  useEvent('chat:done', () => { setBusy(false); refreshStatus(); });
  useEvent('chat:error', ({ message }) => { setBusy(false); toast(message, 'error', 5000); refreshStatus(); });
  useEvent('chat:cleared', () => setEntries([]));
  useEvent('chat:cleared-context', () => setEntries((list) => [...(list || []), { id: `div_${Date.now()}`, role: 'divider', ts: Date.now(), text: '新话题 · 之前的对话已收进记忆' }]));
  useEvent('ai:status', () => refreshStatus());

  // keep the view pinned to the bottom while new text streams in (unless the reader scrolled up)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prepend.current != null) { el.scrollTop = el.scrollHeight - prepend.current; prepend.current = null; return; }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = async () => {
    const el = scroller.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (el.scrollTop < 60 && hasMore && entries?.length) {
      setHasMore(false);
      const older = await invoke('chat.log', { before: entries[0].id, limit: 60 }).catch(() => []);
      if (older.length) { prepend.current = el.scrollHeight - el.scrollTop; setEntries((list) => [...older, ...list]); }
      setHasMore(older.length >= 60);
    }
  };

  const send = async (override) => {
    const msg = (override ?? text).trim();
    if ((!msg && !images.length) || (busy && !override)) return;
    stick.current = true;
    try {
      await invoke('chat.send', { text: msg, source: 'panel', images: override ? [] : images.map(({ media_type, data, name }) => ({ media_type, data, name })) });
      if (!override) { setText(''); images.forEach((i) => URL.revokeObjectURL(i.url)); setImages([]); }
    } catch (err) {
      toast(err.message, 'error', 5000);
      if (/连接 AI|设置/.test(err.message)) navigate('settings/ai');
    }
  };

  const addFiles = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    for (const f of list) {
      if (images.length >= 4) { toast('一次最多 4 张图片', 'error'); break; }
      try { const img = await readImage(f); setImages((arr) => (arr.length >= 4 ? arr : [...arr, img])); } catch (err) { toast(err.message, 'error'); }
    }
  };

  const newTopic = async () => {
    if (await confirmBox({ title: '开始新话题？', body: '莓华会把之前的对话整理成回忆收好，然后从头开始聊。聊天记录仍会保留在这里。', ok: '新话题' })) attempt('chat.newTopic');
  };
  const clearLog = async () => {
    if (await confirmBox({ title: '清空聊天记录？', body: '这里显示的记录会被清空（不影响莓华的记忆和当前对话）。', ok: '清空', danger: true })) attempt('chat.clearLog');
  };

  const configured = status?.configured;
  return html`<div class=${`chat ${drag ? 'dragging' : ''}`}
      onDragOver=${(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave=${(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop=${(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
    <header class="page-head">
      <div>
        <h1>聊天</h1>
        <p class="sub">${configured ? html`${ICON.bolt}${status.model}` : '还没有连接 AI'}</p>
      </div>
      <div class="head-actions">
        <button class="btn ghost" onClick=${newTopic} title="整理当前对话并开始新话题">${ICON.refresh}新话题</button>
        <button class="btn ghost" onClick=${clearLog}>${ICON.trash}清空记录</button>
      </div>
    </header>
    ${status && !configured ? html`<div class="banner">${ICON.key}<span>莓华还没有连上 AI，暂时只能做做动作。连接后她就能聊天、记日程、帮你干活啦。</span><button class="btn small primary" onClick=${() => navigate('settings/ai')}>去连接</button></div>` : null}
    <div class="chat-scroll" ref=${scroller} onScroll=${onScroll}>
      ${entries && !entries.length ? html`<div class="chat-empty">
        <img src=${portrait} alt="" />
        <h3>和莓华说点什么吧</h3>
        <p>她会记日程、设提醒、整理待办，也能在工坊里帮你写代码、处理文件。</p>
        <div class="chips">${SUGGEST.map((s) => html`<button class="chip" onClick=${() => setText(s)}>${s}</button>`)}</div>
      </div>` : null}
      ${hasMore ? html`<div class="load-more">${ICON.pawPrint}往上滑加载更早的记录</div>` : null}
      ${withTimes(entries || []).map((e) => (e.role === 'time' ? html`<div class="chat-time" key=${e.id}>${e.text}</div>` : html`<${Entry} key=${e.id} e=${e} onRetry=${(x) => send(x.text)} />`))}
    </div>
    <div class="composer">
      ${images.length ? html`<div class="attach-row">${images.map((img, i) => html`<div class="attach"><img src=${img.url} alt="" /><button class="icon-btn small" onClick=${() => { URL.revokeObjectURL(img.url); setImages(images.filter((_, j) => j !== i)); }}>${ICON.close}</button></div>`)}</div>` : null}
      <div class="composer-box">
        <label class="icon-btn" title="添加图片">${ICON.image}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange=${(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ''; }} /></label>
        <${AutoTextarea} value=${text} placeholder=${configured === false ? '先连接 AI 才能聊天哦' : '和莓华说…（Enter 发送，Shift+Enter 换行）'} maxRows=${8}
          onInput=${(e) => setText(e.currentTarget.value)}
          onPaste=${(e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); addFiles(files); } }}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }} />
        ${busy
          ? html`<button class="send stop" title="停止" onClick=${() => invoke('chat.stop')}>${ICON.stop}</button>`
          : html`<button class="send" title="发送" disabled=${!text.trim() && !images.length} onClick=${() => send()}>${ICON.send}</button>`}
      </div>
    </div>
    ${drag ? html`<div class="drop-hint">${ICON.image}松手把图片给莓华看</div>` : null}
  </div>`;
}
