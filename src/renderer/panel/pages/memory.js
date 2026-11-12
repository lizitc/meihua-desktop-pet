// 记忆: the facts Meihua keeps about the owner, as editable sticky notes.
import { html, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { attempt, useRpc, confirmBox, openDialog, toast, ago } from '../lib.js';
import { Empty, Field } from '../kit.js';

const CATS = { profile: '基本信息', preference: '喜好', habit: '习惯', relationship: '人际', work: '工作学习', event: '事件', episode: '对话回顾', other: '其他' };

function MemoryEditor({ item, close }) {
  const [text, setText] = useState(item?.text || '');
  const [category, setCategory] = useState(item?.category || 'preference');
  const save = async () => {
    if (!text.trim()) { toast('写点什么吧', 'error'); return; }
    const r = item ? await attempt('memory.update', item.id, { text: text.trim(), category }) : await attempt('memory.add', { text: text.trim(), category });
    if (r) close(true);
  };
  return html`<div class="dialog-body narrow">
    <div class="dialog-head"><h3 class="dialog-title">${ICON.heart}<span>${item ? '修改记忆' : '告诉莓华一件事'}</span></h3><button class="icon-btn" onClick=${() => close()}>${ICON.close}</button></div>
    <div class="form">
      <${Field} wide><textarea class="input textarea" rows="4" value=${text} onInput=${(e) => setText(e.currentTarget.value)} placeholder="比如：我对芒果过敏 / 每周三晚上要去健身" autofocus></textarea><//>
      <${Field} label="分类"><select class="input" value=${category} onChange=${(e) => setCategory(e.currentTarget.value)}>${Object.entries(CATS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select><//>
    </div>
    <div class="dialog-actions"><span class="grow"></span><button class="btn" onClick=${() => close()}>取消</button><button class="btn primary" onClick=${save}>${ICON.check}记住</button></div>
  </div>`;
}

export function MemoryPage() {
  const { data } = useRpc('memory.list', [], ['memory:changed']);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const counts = {};
  for (const m of data || []) counts[m.category] = (counts[m.category] || 0) + 1;
  const list = (data || [])
    .filter((m) => (cat === 'all' ? m.category !== 'episode' : m.category === cat))
    .filter((m) => !q.trim() || m.text.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  const forget = async (m) => { if (await confirmBox({ title: '让莓华忘掉这件事？', body: m.text, ok: '忘掉', danger: true })) attempt('memory.forget', m.id); };

  return html`<div class="memory-page">
    <header class="page-head">
      <div><h1>记忆</h1><p class="sub">莓华记住的关于你的事。聊天时她会自然地用上；不对的地方可以直接改。</p></div>
      <div class="head-actions">
        <div class="search">${ICON.search}<input class="input bare" placeholder="搜索记忆" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
        <button class="btn primary" onClick=${() => openDialog(MemoryEditor, {})}>${ICON.plus}告诉她</button>
      </div>
    </header>
    <div class="cat-row">
      <button class=${`chip ${cat === 'all' ? 'on' : ''}`} onClick=${() => setCat('all')}>全部<em>${(data || []).filter((m) => m.category !== 'episode').length}</em></button>
      ${Object.entries(CATS).filter(([k]) => counts[k]).map(([k, v]) => html`<button class=${`chip ${cat === k ? 'on' : ''}`} onClick=${() => setCat(k)}>${v}<em>${counts[k]}</em></button>`)}
    </div>
    ${data && !list.length ? html`<${Empty} icon="heart" art=${q ? 'search' : 'memory'} title=${q ? '没有找到' : '还没有记忆'} text=${q ? '' : '多和莓华聊聊，她会慢慢记住你的喜好和习惯。'} />` : null}
    <div class="mem-grid">${list.map((m, i) => html`<div class=${`mem-note ${m.pinned ? 'pinned' : ''} cat-${m.category} tilt-${i % 4}`} key=${m.id}>
      ${m.pinned ? html`<span class="mem-pin">${ICON.pin}</span>` : null}
      <div class="mem-cat">${CATS[m.category] || m.category}</div>
      <p class="mem-text" onClick=${() => openDialog(MemoryEditor, { item: m })}>${m.text}</p>
      <div class="mem-foot">
        <span class="muted small">${m.source === 'ai' ? '莓华记的' : '你写的'} · ${ago(m.updatedAt)}</span>
        <span class="grow"></span>
        <button class="icon-btn small" title=${m.pinned ? '取消置顶' : '置顶（她会更常想起）'} onClick=${() => attempt('memory.update', m.id, { pinned: !m.pinned })}>${ICON.pin}</button>
        <button class="icon-btn small" title="修改" onClick=${() => openDialog(MemoryEditor, { item: m })}>${ICON.edit}</button>
        <button class="icon-btn small" title="忘掉" onClick=${() => forget(m)}>${ICON.trash}</button>
      </div>
    </div>`)}</div>
  </div>`;
}
