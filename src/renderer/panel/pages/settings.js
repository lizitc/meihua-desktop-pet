// 设置: about you, AI connection (chat + workshop), voice, character, care & reminders,
// workshop permissions, app and data. Every control writes through settings.patch;
// keys go to the encrypted secret store and are never shown again.
import { html, useEffect, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { invoke, attempt, useRpc, useSettings, patchSettings, pathPatch, getPath, navigate, toast, confirmBox } from '../lib.js';
import { Switch, Seg, LazyInput } from '../kit.js';
import { PERMS } from './workshop.js';
import { INSTALLERS, LocalInstall } from '../installers.js';

// ------------------------------------------------------------ bound controls
function Row({ label, hint, children, stack }) {
  return html`<div class=${`set-row ${stack ? 'stack' : ''}`}>
    <div class="set-label"><span>${label}</span>${hint ? html`<span class="hint">${hint}</span>` : null}</div>
    <div class="set-control">${children}</div>
  </div>`;
}
const set = (path, v) => patchSettings(pathPatch(path, v));
function Toggle({ path, label, hint }) {
  const s = useSettings();
  return html`<div class="set-row"><${Switch} label=${label} hint=${hint} checked=${!!getPath(s, path)} onChange=${(v) => set(path, v)} /></div>`;
}
function Text({ path, label, hint, placeholder, mono, type = 'text', stack }) {
  const s = useSettings();
  return html`<${Row} label=${label} hint=${hint} stack=${stack}><${LazyInput} class=${`input ${mono ? 'mono' : ''}`} type=${type} value=${getPath(s, path) ?? ''} placeholder=${placeholder} onCommit=${(v) => set(path, v)} /><//>`;
}
function Num({ path, label, hint, min, max, step = 1, unit }) {
  const s = useSettings();
  return html`<${Row} label=${label} hint=${hint}><div class="input-unit"><${LazyInput} type="number" min=${min} max=${max} step=${step} value=${getPath(s, path)} onCommit=${(v) => set(path, Math.max(min ?? -Infinity, Math.min(max ?? Infinity, Number(v) || 0)))} />${unit ? html`<span>${unit}</span>` : null}</div><//>`;
}
function Time({ path, label, hint }) {
  const s = useSettings();
  return html`<${Row} label=${label} hint=${hint}><input class="input" type="time" value=${getPath(s, path)} onChange=${(e) => set(path, e.currentTarget.value)} /><//>`;
}
function Pick({ path, label, hint, options }) {
  const s = useSettings();
  return html`<${Row} label=${label} hint=${hint}><select class="input" value=${getPath(s, path)} onChange=${(e) => set(path, e.currentTarget.value)}>${options.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select><//>`;
}
function Slider({ path, label, hint, min, max, step, fmt = (v) => v }) {
  const s = useSettings();
  const [v, setV] = useState(getPath(s, path));
  useEffect(() => setV(getPath(s, path)), [getPath(s, path)]);
  return html`<${Row} label=${label} hint=${hint}><div class="slider"><input type="range" min=${min} max=${max} step=${step} value=${v} onInput=${(e) => setV(Number(e.currentTarget.value))} onChange=${(e) => set(path, Number(e.currentTarget.value))} /><output>${fmt(v)}</output></div><//>`;
}
function SegRow({ path, label, hint, options }) {
  const s = useSettings();
  return html`<${Row} label=${label} hint=${hint}><${Seg} small value=${getPath(s, path)} onChange=${(v) => set(path, v)} options=${options} /><//>`;
}
/** Write-only secret. Shows whether one is stored; the value itself never comes back. */
export function SecretField({ name, label = 'API Key', hint, placeholder = '粘贴密钥', onSaved }) {
  const s = useSettings();
  const has = !!s.secrets?.[name];
  const [v, setV] = useState('');
  const [editing, setEditing] = useState(!has);
  useEffect(() => setEditing(!has), [has]);
  const save = async () => {
    if (!v.trim()) return;
    if (await attempt('settings.setSecret', name, v.trim())) { setV(''); setEditing(false); toast('密钥已加密保存', 'ok'); onSaved?.(); }
  };
  const clear = async () => { if (await confirmBox({ title: '清除密钥？', ok: '清除', danger: true })) attempt('settings.setSecret', name, ''); };
  return html`<${Row} label=${label} hint=${hint}>
    ${editing
      ? html`<div class="key-edit"><input class="input mono" type="password" autocomplete="off" spellcheck="false" placeholder=${placeholder} value=${v} onInput=${(e) => setV(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') save(); }} />
          <button class="btn small primary" disabled=${!v.trim()} onClick=${save}>保存</button>${has ? html`<button class="btn small ghost" onClick=${() => setEditing(false)}>取消</button>` : null}</div>`
      : html`<div class="key-saved">${ICON.key}<span>已加密保存</span><button class="btn small ghost" onClick=${() => setEditing(true)}>更换</button><button class="btn small ghost danger-text" onClick=${clear}>清除</button></div>`}
  <//>`;
}

// ------------------------------------------------------------ AI model connection
export function ModelConfig({ kind = 'chat', compact }) {
  const s = useSettings();
  const { data: presets } = useRpc('ai.presets');
  const src = kind === 'agent' ? s.ai.agent : s.ai;
  const presetId = src.preset || 'custom';
  const p = presets?.[presetId] || {};
  const [models, setModels] = useState(null);
  const [test, setTest] = useState(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const write = (patch) => patchSettings(kind === 'agent' ? { ai: { agent: patch } } : { ai: patch });
  const choose = (id) => { const np = presets[id]; setModels(null); setTest(null); write({ preset: id, provider: np.provider, baseUrl: np.baseUrl, model: np.model || '' }); };
  const fetchModels = async () => {
    setLoadingModels(true);
    try { const list = await invoke('ai.models', { kind, preset: presetId, provider: src.provider || p.provider, baseUrl: src.baseUrl }); setModels(list); if (!list.length) toast('接口没有返回模型列表，可以手动填写', 'info'); }
    catch (err) { toast(err.message, 'error', 5000); } finally { setLoadingModels(false); }
  };
  const runTest = async () => {
    setTest({ pending: true });
    try { setTest(await invoke('ai.test', { kind, preset: presetId, provider: src.provider || p.provider, baseUrl: src.baseUrl, model: src.model })); }
    catch (err) { setTest({ error: err.message }); }
  };
  const options = models || (p.models || []).map((id) => ({ id, label: id }));
  const keyName = `ai.key.${presetId}`;
  const listId = `models-${kind}`;
  return html`<div class="model-config">
    <div class="preset-grid">${Object.entries(presets || {}).map(([id, x]) => html`<button class=${`preset ${id === presetId ? 'on' : ''}`} onClick=${() => choose(id)}>
      <span class="preset-name">${x.label}</span>${x.noKey ? html`<span class="tag soft">本地</span>` : null}
    </button>`)}</div>
    ${!compact || presetId === 'custom' || presetId === 'anthropic-proxy' ? html`<${Row} label="接口地址" hint=${p.provider === 'anthropic' ? 'Anthropic Messages API' : 'OpenAI 兼容接口（通常以 /v1 结尾）'}>
      <${LazyInput} class="input mono" value=${src.baseUrl ?? ''} placeholder=${p.baseUrl || 'https://…/v1'} onCommit=${(v) => write({ baseUrl: v.trim() })} />
    <//>` : null}
    ${INSTALLERS[presetId] ? html`<${LocalInstall} id=${presetId} compact />` : null}
    ${p.noKey ? null : html`<${SecretField} name=${keyName} label="API Key" hint=${p.keyUrl ? html`<a href="#" onClick=${(e) => { e.preventDefault(); invoke('system.openExternal', p.keyUrl); }}>去哪里获取？</a>` : '密钥只保存在本机，并用系统加密。'} onSaved=${() => setTest(null)} />`}
    <${Row} label="模型" hint=${options.length ? '可以从列表选择，也可以手动输入' : '填写模型名称，或点「获取列表」'}>
      <div class="key-edit">
        <${LazyInput} class="input mono" list=${listId} value=${src.model} placeholder=${p.model || '模型名称'} onCommit=${(v) => write({ model: v.trim() })} />
        <datalist id=${listId}>${options.map((m) => html`<option value=${m.id}>${m.label !== m.id ? m.label : ''}</option>`)}</datalist>
        <button class="btn small" disabled=${loadingModels} onClick=${fetchModels}>${ICON.refresh}获取列表</button>
      </div>
    <//>
    <div class="test-row">
      <button class="btn" onClick=${runTest} disabled=${test?.pending}>${ICON.bolt}${test?.pending ? '测试中…' : '测试连接'}</button>
      ${test && !test.pending ? (test.error
        ? html`<span class="test-bad">${ICON.warn}${test.error}</span>`
        : html`<span class="test-ok">${ICON.check}连接成功 · ${(test.ms / 1000).toFixed(1)}s${test.text ? ` · 「${test.text}」` : ''}${test.fallbackUsed ? '（本次由备用模型回答）' : ''}</span>`) : null}
    </div>
  </div>`;
}

// ------------------------------------------------------------ sections
function About() {
  return html`
    <h3 class="set-h">${ICON.user}关于你</h3>
    <${Text} path="user.callName" label="莓华怎么称呼你" placeholder="主人" />
    <${Text} path="user.name" label="你的名字" hint="可选" />
    <${Text} path="user.birthday" label="生日" type="date" hint="她会记得给你庆祝" />
    <${Row} label="想让莓华知道的事" hint="职业、作息、喜好……会写进她的说明里" stack>
      <${AboutText} />
    <//>`;
}
function AboutText() {
  const s = useSettings();
  const [v, setV] = useState(s.user.about || '');
  return html`<textarea class="input textarea" rows="4" value=${v} onInput=${(e) => setV(e.currentTarget.value)} onBlur=${() => v !== s.user.about && set('user.about', v)} placeholder="比如：我是一名产品经理，平时 10 点上班；喜欢猫和咖啡；周末常去爬山。"></textarea>`;
}

function AI() {
  const s = useSettings();
  const anthropic = (s.ai.provider || '') === 'anthropic';
  return html`
    <h3 class="set-h">${ICON.bolt}AI 连接</h3>
    <p class="muted small">莓华的聊天、日程管理和主动行为都由这里的模型驱动。支持 Claude 官方接口、各家 OpenAI 兼容接口和本地模型。</p>
    <${ModelConfig} kind="chat" />
    <h4 class="set-sub">她的性格与主动程度</h4>
    <${PersonaEditor} />
    <${SegRow} path="ai.autonomy" label="自主程度" hint="AI 决定她在桌面上做什么的频率" options=${[{ value: 'off', label: '只听指令' }, { value: 'low', label: '安静' }, { value: 'normal', label: '适中' }, { value: 'high', label: '活泼' }]} />
    <${Toggle} path="ai.proactive" label="主动关心" hint="早安简报、晚间回顾、久坐和喝水提醒时由 AI 组织语言" />
    <${Toggle} path="ai.touchReplies" label="摸摸会回话" hint="摸头、拽耳朵时让 AI 即兴回应（会消耗少量额度）" />
    ${anthropic ? html`<${SegRow} path="ai.effort" label="思考深度" hint="越深越聪明，但更慢、更贵" options=${[{ value: 'low', label: '轻快' }, { value: 'medium', label: '适中' }, { value: 'high', label: '深入' }]} />
      <${Toggle} path="ai.serverFallbacks" label="服务器繁忙时自动切换备用模型" hint="仅 Anthropic 官方接口；默认开启，偶尔会由同系列的其他模型回答" />` : null}
    <${Num} path="ai.maxTokens" label="单次回复上限" min=${256} max=${32000} step=${256} unit="tokens" />
    <${Num} path="ai.historyLimit" label="对话整理阈值" hint="超过这么多轮会把旧对话整理成回忆" min=${10} max=${400} unit="轮" />`;
}

/** The character card used as her system prompt. Empty = the built-in one (shown as the starting text). */
function PersonaEditor() {
  const s = useSettings();
  const { data: def } = useRpc('ai.personaDefault');
  const custom = s.ai.persona || '';
  const [v, setV] = useState(custom);
  const [open, setOpen] = useState(false);
  useEffect(() => setV(custom || def || ''), [custom, def]);
  const dirty = (v.trim() || '') !== (custom.trim() || def?.trim() || '');
  const save = async () => {
    const text = v.trim() === (def || '').trim() ? '' : v.trim();
    if (await patchSettings({ ai: { persona: text } })) toast(text ? '角色设定已更新，她下一句话就会按新设定来' : '已使用内置的角色设定', 'ok');
  };
  const reset = async () => { if (await confirmBox({ title: '恢复内置的角色设定？', body: '你改过的内容会被替换掉。', ok: '恢复' })) { await patchSettings({ ai: { persona: '' } }); setV(def || ''); } };
  return html`<div class="set-row stack persona-row">
    <div class="set-label"><span>角色设定（系统提示词）</span>
      <span class="hint">她是谁、什么性格、怎么说话。<code>{name}</code> 会换成她对你的称呼；工具、表情和日程等规则会自动附在后面。${custom ? html` <b class="tag soft">已自定义</b>` : html` <span class="tag soft">内置</span>`}</span></div>
    <div class="set-control">
      ${open ? html`<textarea class="input textarea mono-soft persona-text" rows="16" value=${v} spellcheck="false" onInput=${(e) => setV(e.currentTarget.value)}></textarea>
        <div class="persona-actions">
          <button class="btn small primary" disabled=${!dirty} onClick=${save}>${ICON.check}保存</button>
          ${custom ? html`<button class="btn small ghost" onClick=${reset}>恢复内置</button>` : null}
          <span class="grow"></span>
          <span class="muted small">${v.length} 字</span>
          <button class="btn small ghost" onClick=${() => setOpen(false)}>收起</button>
        </div>`
        : html`<button class="btn small" onClick=${() => setOpen(true)}>${ICON.edit || ICON.sparkle}查看 / 编辑角色设定</button>`}
    </div>
  </div>`;
}

function Voice() {
  const s = useSettings();
  const t = s.tts;
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    const load = () => setVoices(speechSynthesis.getVoices().slice().sort((a, b) => (b.lang.startsWith('zh') - a.lang.startsWith('zh'))));
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  const testTts = async () => { if (await attempt('tts.test')) toast('听到莓华的声音了吗？', 'ok'); };
  return html`
    <h3 class="set-h">${ICON.speaker}声音</h3>
    <${Toggle} path="tts.enabled" label="让莓华开口说话" hint="说话时嘴巴会跟着动" />
    ${t.enabled ? html`
      <${Toggle} path="tts.autoSpeak" label="回复时自动朗读" />
      <${SegRow} path="tts.provider" label="声音来源" options=${[{ value: 'system', label: '系统语音' }, { value: 'openai', label: 'OpenAI 兼容' }, { value: 'sovits', label: 'GPT-SoVITS' }, { value: 'azure', label: 'Azure' }, { value: 'custom', label: '自定义' }]} />
      ${t.provider === 'system' ? html`<${Row} label="系统语音" hint="Windows 自带，免费，略机械">
          <select class="input" value=${t.system.voice} onChange=${(e) => set('tts.system.voice', e.currentTarget.value)}><option value="">默认中文语音</option>${voices.map((v) => html`<option value=${v.name}>${v.name}（${v.lang}）</option>`)}</select>
        <//>` : null}
      ${t.provider === 'openai' ? html`
        <${Text} path="tts.openai.baseUrl" label="接口地址" mono />
        <${Text} path="tts.openai.model" label="模型" mono placeholder="gpt-4o-mini-tts" />
        <${Text} path="tts.openai.voice" label="音色" mono placeholder="nova / shimmer / coral …" />
        <${Text} path="tts.openai.instructions" label="语气说明" hint="仅 gpt-4o-mini-tts 等支持" stack />
        <${SecretField} name="tts.openai" label="语音 API Key" hint="留空则使用 AI 连接里的 OpenAI 密钥" />` : null}
      ${t.provider === 'sovits' ? html`
        <p class="muted small">连接本地 GPT-SoVITS（api_v2.py），可以用训练好的莓华声线。</p>
        <${LocalInstall} id="sovits" compact />
        <${Text} path="tts.sovits.baseUrl" label="服务地址" mono />
        <${Text} path="tts.sovits.refAudioPath" label="参考音频路径" mono placeholder="D:\\voices\\meihua.wav" />
        <${Text} path="tts.sovits.promptText" label="参考音频文字" stack />
        <${Pick} path="tts.sovits.promptLang" label="参考音频语言" options=${[['zh', '中文'], ['ja', '日语'], ['en', '英语']]} />
        <${Pick} path="tts.sovits.textLang" label="合成语言" options=${[['zh', '中文'], ['ja', '日语'], ['en', '英语'], ['auto', '自动']]} />
        <${Num} path="tts.sovits.speedFactor" label="语速" min=${0.5} max=${2} step=${0.05} />` : null}
      ${t.provider === 'azure' ? html`
        <${Text} path="tts.azure.region" label="区域" mono placeholder="eastasia" />
        <${Text} path="tts.azure.voice" label="音色" mono placeholder="zh-CN-XiaoyiNeural" />
        <${Text} path="tts.azure.style" label="风格" mono placeholder="gentle / cheerful" />
        <${SecretField} name="tts.azure" label="Azure 语音密钥" />` : null}
      ${t.provider === 'custom' ? html`
        <p class="muted small">请求返回音频（mp3 / wav）。<code>{text}</code> 会替换为要朗读的文字，Headers 里的 <code>{key}</code> 会替换为下面保存的密钥。</p>
        <${Text} path="tts.custom.url" label="URL" mono />
        <${Pick} path="tts.custom.method" label="方法" options=${[['POST', 'POST'], ['GET', 'GET']]} />
        <${Text} path="tts.custom.headers" label="Headers（JSON）" mono stack />
        <${Text} path="tts.custom.body" label="Body 模板" mono stack />
        <${SecretField} name="tts.custom" label="密钥" />` : null}
      <${Slider} path="tts.volume" label="音量" min=${0} max=${1} step=${0.05} fmt=${(v) => Math.round(v * 100) + '%'} />
      <${Slider} path="tts.rate" label="语速" min=${0.6} max=${1.6} step=${0.05} fmt=${(v) => v.toFixed(2) + '×'} />
      <div class="test-row"><button class="btn" onClick=${testTts}>${ICON.speaker}试听</button><button class="btn ghost" onClick=${() => invoke('tts.stop')}>${ICON.stop}停止</button></div>` : null}
    <h4 class="set-sub">语音输入</h4>
    <${Toggle} path="stt.enabled" label="对着麦克风说话" hint="输入框旁会出现麦克风按钮；使用 Whisper 兼容的识别接口" />
    ${s.stt.enabled ? html`
      <${Text} path="stt.baseUrl" label="接口地址" mono />
      <${Text} path="stt.model" label="模型" mono placeholder="whisper-1" />
      <${Text} path="stt.language" label="语言" mono placeholder="zh" />
      <${SecretField} name="stt" label="识别 API Key" hint="留空则使用 OpenAI 的密钥" />` : null}`;
}

function Pet() {
  return html`
    <h3 class="set-h">${ICON.paw}桌宠</h3>
    <${Toggle} path="pet.visible" label="显示莓华" />
    <${Slider} path="pet.scale" label="大小" hint="也可以按住 Ctrl 在她身上滚动滚轮" min=${0.18} max=${0.8} step=${0.01} fmt=${(v) => Math.round(v * 100) + '%'} />
    <${Toggle} path="pet.alwaysOnTop" label="总在最前" />
    <${Toggle} path="pet.allowWander" label="允许自由走动" hint="她会自己在屏幕上散步、换姿势" />
    <${Toggle} path="pet.lockPosition" label="锁定位置" hint="不会被拖动，也不会自己走开" />
    <${Toggle} path="pet.gravity" label="重力" hint="放手后会落到屏幕底部。重力和弹性抛掷都关掉时，可以把她往下拖、让下半身藏到任务栏后面" />
    <${Toggle} path="pet.bounce" label="弹性抛掷" hint="拖着她快速甩出去，会在屏幕边缘弹来弹去（撞太多下会晕哦）" />
    <${Toggle} path="pet.idleActs" label="待机小动作" hint="伸懒腰、打哈欠、哼歌、整理头发……闲着时更生动" />
    <${Toggle} path="pet.gaze" label="视线跟随鼠标" />
    <${Toggle} path="pet.reactions" label="触摸反应" hint="摸头、碰耳朵和尾巴时的反应" />
    <${Num} path="pet.autoSleepMinutes" label="自动打盹" hint="你离开电脑多久后她会睡觉（0 = 不睡）" min=${0} max=${240} unit="分钟" />
    <${Toggle} path="pet.quiet" label="安静模式" hint="不主动说话、不打扰（提醒仍会显示）" />`;
}

function Care() {
  const s = useSettings();
  const p = s.planner;
  return html`
    <h3 class="set-h">${ICON.heart}照顾与提醒</h3>
    <${Toggle} path="planner.morningBrief.enabled" label="早安简报" hint="早上第一次见到你时，播报今天的安排" />
    ${p.morningBrief.enabled ? html`<${Time} path="planner.morningBrief.time" label="最早时间" />` : null}
    <${Toggle} path="planner.eveningReview.enabled" label="晚间回顾" hint="陪你复盘今天、安排明天" />
    ${p.eveningReview.enabled ? html`<${Time} path="planner.eveningReview.time" label="时间" />` : null}
    <${Toggle} path="planner.bedtime.enabled" label="就寝提醒" />
    ${p.bedtime.enabled ? html`<${Time} path="planner.bedtime.time" label="时间" />` : null}
    <${Toggle} path="planner.sedentary.enabled" label="久坐提醒" />
    ${p.sedentary.enabled ? html`<${Num} path="planner.sedentary.minutes" label="连续使用多久后提醒" min=${20} max=${240} unit="分钟" />` : null}
    <${Toggle} path="planner.water.enabled" label="喝水提醒" />
    ${p.water.enabled ? html`<${Num} path="planner.water.minutes" label="间隔" min=${20} max=${240} unit="分钟" />` : null}
    <h4 class="set-sub">安静时段</h4>
    <${Toggle} path="planner.quietHours.enabled" label="安静时段内不主动打扰" hint="日程和提醒照常" />
    ${p.quietHours.enabled ? html`<div class="form-row"><${Time} path="planner.quietHours.start" label="从" /><${Time} path="planner.quietHours.end" label="到" /></div>` : null}
    <h4 class="set-sub">通知</h4>
    <${Num} path="planner.defaultRemind" label="日程默认提前提醒" min=${0} max=${1440} unit="分钟" />
    <${Toggle} path="planner.systemNotifications" label="同时发送 Windows 通知" hint="莓华被隐藏时也能收到提醒" />`;
}

function Workshop() {
  const s = useSettings();
  return html`
    <h3 class="set-h">${ICON.workshop}工坊</h3>
    <${SegRow} path="agent.permission" label="权限" hint=${PERMS.find((x) => x.value === s.agent.permission)?.hint} options=${PERMS} />
    <${Text} path="agent.workspaceRoot" label="任务文件夹位置" mono placeholder="默认：文档\\MeihuaWorkshop" stack />
    <${Num} path="agent.maxSteps" label="单个任务最多步数" min=${10} max=${400} />
    <${Num} path="agent.commandTimeout" label="命令超时" min=${10} max=${3600} unit="秒" />
    <h4 class="set-sub">工坊使用的模型</h4>
    <${Toggle} path="ai.agent.sameAsChat" label="和聊天使用同一个模型" hint="工坊任务通常更复杂，可以单独配置更强的模型" />
    ${s.ai.agent.sameAsChat ? null : html`<${ModelConfig} kind="agent" />
      <${SegRow} path="ai.agent.effort" label="思考深度（Claude）" options=${[{ value: 'medium', label: '适中' }, { value: 'high', label: '深入' }, { value: 'xhigh', label: '极深' }]} />
      <${Num} path="ai.agent.maxTokens" label="单步输出上限" min=${1024} max=${64000} step=${1024} unit="tokens" />`}`;
}

const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'];
function HotkeyInput({ path, label, failed }) {
  const s = useSettings();
  const value = getPath(s, path) || '';
  const [rec, setRec] = useState(false);
  const taken = failed?.includes(path.split('.').pop());
  const onKey = (e) => {
    e.preventDefault();
    if (e.key === 'Escape') { setRec(false); e.currentTarget.blur(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { set(path, ''); setRec(false); e.currentTarget.blur(); return; }
    if (MODS.includes(e.key) || e.key === 'Control') return;
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
    if (!mods.length) { toast('快捷键至少要包含 Ctrl / Alt / Shift 中的一个', 'error'); return; }
    const key = e.code === 'Space' ? 'Space' : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F\d{1,2}$/.test(e.key) ? e.key : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    set(path, [...mods, key].join('+'));
    setRec(false);
    e.currentTarget.blur();
  };
  return html`<${Row} label=${label} hint=${taken ? html`<span class="danger-hint">${ICON.warn}已被其他程序占用，换一个组合吧</span>` : null}><input class=${`input mono hotkey ${rec ? 'rec' : ''} ${taken ? 'taken' : ''}`} readonly value=${rec ? '请按下组合键…' : value || '未设置'} onFocus=${() => setRec(true)} onBlur=${() => setRec(false)} onKeyDown=${onKey} title="点击后按下新的组合键；Backspace 清除" /><//>`;
}

const LINKS = [
  { label: '作者 B 站主页', url: 'https://space.bilibili.com/441278737', open: '去看看' },
  { label: '项目仓库（GitHub）', url: 'https://github.com/lizitc/meihua-desktop-pet', open: '打开仓库' },
];

function App() {
  const { data: info } = useRpc('app.info');
  const { data: failed } = useRpc('app.hotkeyStatus', [], ['hotkeys:status', 'settings:changed']);
  const rerun = async () => { if (await confirmBox({ title: '重新进行初次设置？', body: '已有的数据和设置都会保留。', ok: '开始' })) navigate('welcome'); };
  const clearChat = async () => { if (await confirmBox({ title: '清空聊天记录？', body: '手账里的聊天记录会被清空，莓华的记忆不受影响。', ok: '清空', danger: true })) attempt('chat.clearLog'); };
  return html`
    <h3 class="set-h">${ICON.brush}外观与应用</h3>
    <${SegRow} path="app.theme" label="主题" options=${[{ value: 'system', label: '跟随系统' }, { value: 'light', label: '奶油白' }, { value: 'dark', label: '夜莓' }]} />
    <${Toggle} path="app.launchAtLogin" label="开机时自动启动" hint=${info && !info.packaged ? '（开发模式下不生效）' : ''} />
    <h4 class="set-sub">全局快捷键</h4>
    <${HotkeyInput} path="app.hotkeys.toggle" label="显示 / 隐藏莓华" failed=${failed} />
    <${HotkeyInput} path="app.hotkeys.chat" label="和莓华说话" failed=${failed} />
    <${HotkeyInput} path="app.hotkeys.panel" label="打开手账" failed=${failed} />
    <h4 class="set-sub">数据</h4>
    <${Row} label="数据文件夹" hint=${info?.userData}><button class="btn small" onClick=${() => info && invoke('system.openPath', info.userData)}>${ICON.folder}打开</button><//>
    <${Row} label="聊天记录"><button class="btn small ghost danger-text" onClick=${clearChat}>${ICON.trash}清空</button><//>
    <${Row} label="初次设置向导"><button class="btn small" onClick=${rerun}>${ICON.refresh}重新开始</button><//>
    <h4 class="set-sub">作者与项目</h4>
    ${LINKS.map((l) => html`<div class="set-row link-row">
      <div class="set-label"><span>${l.label}</span><span class="hint link-url">${l.url}</span></div>
      <button class="btn small" title=${`在浏览器中打开 ${l.url}`} onClick=${() => invoke('system.openExternal', l.url)}>${ICON.external}${l.open}</button>
    </div>`)}
    <p class="muted small about-line">御园莓华 Desktop ${info?.version || ''} · Electron ${info?.electron || ''} · 密钥使用 Windows DPAPI 加密保存在本机</p>`;
}

const SECTIONS = [
  { id: 'about', label: '关于你', icon: 'user', C: About },
  { id: 'ai', label: 'AI 连接', icon: 'bolt', C: AI },
  { id: 'voice', label: '声音', icon: 'speaker', C: Voice },
  { id: 'pet', label: '桌宠', icon: 'paw', C: Pet },
  { id: 'care', label: '照顾与提醒', icon: 'heart', C: Care },
  { id: 'workshop', label: '工坊', icon: 'workshop', C: Workshop },
  { id: 'app', label: '外观与应用', icon: 'brush', C: App },
];

export function SettingsPage({ sub }) {
  const sec = SECTIONS.find((x) => x.id === sub) || SECTIONS[1];
  const C = sec.C;
  return html`<div class="settings">
    <header class="page-head"><div><h1>设置</h1><p class="sub">按你的习惯调教莓华～改动会立即生效。</p></div></header>
    <div class="set-body">
      <nav class="set-nav">${SECTIONS.map((x) => html`<button class=${x.id === sec.id ? 'on' : ''} onClick=${() => navigate(`settings/${x.id}`)}>${ICON[x.icon]}<span>${x.label}</span></button>`)}</nav>
      <div class="set-page sheet" key=${sec.id}><${C} /></div>
    </div>
  </div>`;
}
