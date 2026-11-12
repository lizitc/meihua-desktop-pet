// 技能与扩展: what Meihua has learned. Skills are markdown playbooks; extensions are code
// that adds tools. Anything she writes herself waits here for the owner's review.
import { html, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { invoke, attempt, useRpc, toast, confirmBox, openDialog, fieldSetter, Markdown } from '../lib.js';
import { Sheet, Switch, Field, Empty, Seg } from '../kit.js';

// ------------------------------------------------------------ skills
function SkillEditor({ skill, close }) {
  const [f, setF] = useState({ name: skill?.name || '', description: skill?.description || '', body: skill?.body || '', enabled: skill ? skill.enabled : true });
  const [tab, setTab] = useState(skill?.author === 'ai' && !skill.enabled ? 'preview' : 'edit');
  const set = fieldSetter(setF);
  const save = async (enabled = f.enabled) => {
    if (!f.name.trim() || !f.body.trim()) { toast('技能需要名称和内容', 'error'); return; }
    const r = await attempt('skills.save', { id: skill?.id, name: f.name.trim(), description: f.description.trim(), body: f.body, enabled });
    if (r) { toast(enabled ? '技能已启用' : '已保存', 'ok'); close(true); }
  };
  const review = skill?.author === 'ai' && !skill.enabled;
  return html`<div class="dialog-body wide">
    <div class="dialog-head"><h3 class="dialog-title">${ICON.sparkle}<span>${skill ? (review ? '审核莓华写的技能' : '编辑技能') : '新技能'}</span></h3><button class="icon-btn" onClick=${() => close()}>${ICON.close}</button></div>
    ${review ? html`<div class="banner warm">${ICON.shield}<span>这是莓华自己写下的技能。看一看内容，觉得没问题就启用，她以后会按这份说明做事。</span></div>` : null}
    <div class="form">
      <div class="form-row">
        <${Field} label="名称"><input class="input" value=${f.name} onInput=${set('name')} placeholder="比如：周报整理" /><//>
        <${Field} label="一句话说明（什么时候用）"><input class="input" value=${f.description} onInput=${set('description')} placeholder="主人让我写周报时使用" /><//>
      </div>
      <${Seg} small value=${tab} onChange=${setTab} options=${[{ value: 'edit', label: '编辑' }, { value: 'preview', label: '预览' }]} />
      ${tab === 'edit'
        ? html`<textarea class="input textarea mono tall" value=${f.body} onInput=${set('body')} placeholder=${'用 Markdown 写下做这件事的步骤、注意事项、格式要求……\n\n例如：\n1. 先用 todo_list 找出本周完成的待办\n2. 按项目分组，每组 2～3 句话\n3. 最后列出下周计划'}></textarea>`
        : html`<div class="preview-box"><${Markdown} text=${f.body || '*（空）*'} /></div>`}
    </div>
    <div class="dialog-actions">
      ${review ? html`<button class="btn" onClick=${() => save(false)}>先不启用</button><span class="grow"></span><button class="btn primary" onClick=${() => save(true)}>${ICON.check}审核通过并启用</button>`
        : html`<${Switch} label="启用" checked=${f.enabled} onChange=${set('enabled')} /><span class="grow"></span><button class="btn" onClick=${() => close()}>取消</button><button class="btn primary" onClick=${() => save()}>${ICON.check}保存</button>`}
    </div>
  </div>`;
}

function Skills() {
  const { data } = useRpc('skills.list', [], ['ext:changed']);
  const toggle = (s, v) => (v && s.author === 'ai' && !s.enabled ? openDialog(SkillEditor, { skill: s }) : attempt('skills.toggle', s.id, v));
  const remove = async (s) => { if (await confirmBox({ title: '删除技能', body: `确定删除「${s.name}」吗？`, ok: '删除', danger: true })) attempt('skills.delete', s.id); };
  return html`<${Sheet} title="技能本" icon="sparkle" tape="lav" actions=${html`<button class="btn small primary" onClick=${() => openDialog(SkillEditor, {})}>${ICON.plus}新技能</button>`}>
    <p class="muted small">技能是写给莓华的「做事方法」。启用后她会在合适的时候翻开来照着做。你也可以对她说「把刚才的流程记成一个技能」。</p>
    ${data && !data.length ? html`<${Empty} icon="sparkle" art="skills" title="技能本还是空的" />` : null}
    <div class="skill-grid">${(data || []).map((s) => html`<div class=${`skill-card ${s.enabled ? '' : 'off'}`} key=${s.id}>
      <div class="skill-top">
        <span class="skill-name">${s.name}</span>
        ${s.author === 'ai' ? html`<span class=${`tag ${s.enabled ? 'soft' : 'warn'}`}>${s.enabled ? '莓华写的' : '待审核'}</span>` : null}
      </div>
      <p class="skill-desc">${s.description || html`<span class="muted">（没有说明）</span>`}</p>
      <div class="skill-foot">
        <${Switch} checked=${s.enabled} onChange=${(v) => toggle(s, v)} />
        <span class="grow"></span>
        <button class="icon-btn small" title="查看 / 编辑" onClick=${() => openDialog(SkillEditor, { skill: s })}>${ICON.edit}</button>
        <button class="icon-btn small" title="删除" onClick=${() => remove(s)}>${ICON.trash}</button>
      </div>
    </div>`)}</div>
  <//>`;
}

// ------------------------------------------------------------ extensions
function ExtReview({ ext, close }) {
  const { data: src } = useRpc('ext.source', [ext.id]);
  const [busy, setBusy] = useState(false);
  const set = async (on) => {
    setBusy(true);
    const r = await attempt('ext.enable', ext.id, on);
    setBusy(false);
    if (r) { toast(on ? `「${ext.name}」已启用` : '已停用', 'ok'); close(true); }
  };
  return html`<div class="dialog-body wide">
    <div class="dialog-head"><h3 class="dialog-title">${ICON.code}<span>审核扩展「${ext.name}」</span></h3><button class="icon-btn" onClick=${() => close()}>${ICON.close}</button></div>
    <div class="banner warm">${ICON.shield}<span>扩展的代码会在独立的进程里运行，可以联网、读写文件。请确认你看得懂它在做什么，或者只启用你信任的扩展。之后代码一旦被修改，会自动停用并需要重新审核。</span></div>
    <p>${ext.description}</p>
    <div class="chips">${ext.tools.map((t) => html`<span class="tag" title=${t.description}>${ICON.tool}${t.name}</span>`)}</div>
    <div class="code-pair">
      <div><div class="code-label">manifest.json</div><pre class="code">${src?.manifest || '…'}</pre></div>
      <div><div class="code-label">main.mjs</div><pre class="code tall">${src?.code || '…'}</pre></div>
    </div>
    <div class="dialog-actions">
      ${ext.enabled ? html`<button class="btn" disabled=${busy} onClick=${() => set(false)}>停用</button>` : null}
      <span class="grow"></span>
      <button class="btn" onClick=${() => close()}>关闭</button>
      ${!ext.enabled ? html`<button class="btn primary" disabled=${busy} onClick=${() => set(true)}>${ICON.check}审核通过并启用</button>` : null}
    </div>
  </div>`;
}

function Extensions() {
  const { data } = useRpc('ext.list', [], ['ext:changed']);
  const openFolder = async () => { const p = await attempt('ext.openFolder'); if (p) invoke('system.openPath', p); };
  const remove = async (e) => { if (await confirmBox({ title: '删除扩展', body: `删除「${e.name}」及其全部文件？`, ok: '删除', danger: true })) attempt('ext.remove', e.id); };
  const state = (e) => (e.broken ? ['损坏', 'warn'] : e.enabled ? ['已启用', 'ok'] : e.changed ? ['代码已变更，需重新审核', 'warn'] : e.approved ? ['已停用', ''] : ['待审核', 'warn']);
  return html`<${Sheet} title="扩展" icon="code" tape="sky" actions=${html`<button class="btn small ghost" onClick=${openFolder}>${ICON.folder}打开扩展文件夹</button>`}>
    <p class="muted small">扩展能给莓华加上新的工具（比如查天气、查快递、控制智能家居）。可以对她说「给自己做一个查天气的扩展」，她写好后会在这里等你审核。</p>
    ${data && !data.length ? html`<${Empty} icon="code" art="skills" title="还没有扩展" />` : null}
    <div class="ext-list">${(data || []).map((e) => {
      const [label, kind] = state(e);
      return html`<div class=${`ext-card ${e.enabled ? '' : 'off'}`} key=${e.id}>
        <div class="ext-main">
          <div class="ext-top"><span class="ext-name">${e.name}</span><code class="muted small">${e.id}${e.version ? ' · v' + e.version : ''}</code><span class=${`tag ${kind}`}>${label}</span></div>
          <p class="ext-desc">${e.description}</p>
          <div class="chips">${e.tools.map((t) => html`<span class="tag" title=${t.description}>${ICON.tool}${t.name}</span>`)}</div>
        </div>
        <div class="ext-actions">
          ${e.broken ? null : e.enabled
            ? html`<button class="btn small" onClick=${() => attempt('ext.enable', e.id, false)}>停用</button><button class="btn small ghost" onClick=${() => openDialog(ExtReview, { ext: e })}>查看代码</button>`
            : html`<button class="btn small primary" onClick=${() => openDialog(ExtReview, { ext: e })}>${ICON.shield}审核</button>`}
          <button class="icon-btn small" title="删除" onClick=${() => remove(e)}>${ICON.trash}</button>
        </div>
      </div>`;
    })}</div>
  <//>`;
}

const GROUP = { builtin: '基础能力', pet: '桌宠', planner: '日程与待办', memory: '记忆', agent: '工坊', ext: '技能与扩展', system: '系统' };
function ToolIndex() {
  const { data } = useRpc('tools.list', [], ['ext:changed']);
  const groups = {};
  for (const t of data || []) (groups[t.group?.startsWith('ext:') ? '已启用的扩展' : GROUP[t.group] || t.group || '其他'] ||= []).push(t);
  return html`<details class="tool-index sheet">
    <summary>${ICON.tool}莓华现在能用的工具（${data?.length || 0}）</summary>
    ${Object.entries(groups).map(([g, list]) => html`<div class="tool-group"><div class="tool-group-name">${g}</div>
      <div class="tool-rows">${list.map((t) => html`<div class="tool-row"><code>${t.name}</code><span>${t.description.slice(0, 90)}${t.description.length > 90 ? '…' : ''}</span></div>`)}</div></div>`)}
  </details>`;
}

export function SkillsPage() {
  return html`<div class="skills-page">
    <header class="page-head"><div><h1>技能与扩展</h1><p class="sub">莓华学会的本事都在这里。她自己写的新东西，要你点头才会生效。</p></div></header>
    <${Skills} />
    <${Extensions} />
    <${ToolIndex} />
  </div>`;
}
