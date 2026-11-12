// First-run welcome: meet Meihua, tell her your name, connect a model, pick a voice,
// learn the gestures. Finishing sets `onboarded`.
import { html, useState } from '../../vendor/ui.js';
import { ICON } from '../icons.js';
import { invoke, patchSettings, navigate, toast, useSettings } from '../lib.js';
import { Switch } from '../kit.js';
import { ModelConfig } from './settings.js';
import { LocalInstall } from '../installers.js';

const STEPS = ['初次见面', '连接 AI', '声音', '相处方式'];

function Meet({ s }) {
  const [callName, setCallName] = useState(s.user.callName || '主人');
  const [name, setName] = useState(s.user.name || '');
  const save = () => patchSettings({ user: { callName: callName.trim() || '主人', name: name.trim() } });
  return html`<div class="wz-step" onFocusOut=${save}>
    <h2>初次见面，我是<b>御园莓华</b>！</h2>
    <p class="wz-lead">从今天起我会住在你的桌面上，帮你记日程、提醒你休息、陪你聊天，也能在「工坊」里替你完成电脑上的工作。请多多关照～</p>
    <div class="wz-fields">
      <label class="field"><span class="field-label">我该怎么称呼你？</span><input class="input big" value=${callName} onInput=${(e) => setCallName(e.currentTarget.value)} placeholder="主人" /></label>
      <label class="field"><span class="field-label">你的名字（可选）</span><input class="input" value=${name} onInput=${(e) => setName(e.currentTarget.value)} placeholder="写在手账扉页上" /></label>
    </div>
  </div>`;
}

const DS = { site: 'https://platform.deepseek.com', keys: 'https://platform.deepseek.com/api_keys', topup: 'https://platform.deepseek.com/top_up', docs: 'https://api-docs.deepseek.com/zh-cn/' };

/** Step-by-step DeepSeek setup: the steps tick themselves off as the settings fill in. */
function DeepSeekGuide({ s }) {
  const [open, setOpen] = useState(true);
  const picked = s.ai.preset === 'deepseek';
  const hasKey = !!s.secrets?.['ai.key.deepseek'];
  const ext = (url) => (e) => { e.preventDefault(); invoke('system.openExternal', url); };
  const pick = async () => {
    const presets = await invoke('ai.presets');
    const p = presets.deepseek;
    await patchSettings({ ai: { preset: 'deepseek', provider: p.provider, baseUrl: p.baseUrl, model: s.ai.preset === 'deepseek' && s.ai.model ? s.ai.model : p.model } });
    toast('已选好 DeepSeek，接口地址也填好了', 'ok');
  };
  const model = (id) => patchSettings({ ai: { model: id } });
  const steps = [
    { done: false, title: '注册 DeepSeek 开放平台', body: html`打开 <a href="#" onClick=${ext(DS.site)}>platform.deepseek.com</a>，用手机号或邮箱注册并登录。这是给开发者用的「开放平台」，和聊天网页版是两个入口，账号可以通用。` },
    { done: false, title: '充一点余额', body: html`在左侧「<a href="#" onClick=${ext(DS.topup)}>充值</a>」里先充少量金额就够了。按实际用量计费，和莓华日常聊天花费很少；余额用完时会提示「余额不足（402）」。` },
    { done: hasKey, title: '创建 API Key', body: html`进入「<a href="#" onClick=${ext(DS.keys)}>API keys</a>」→「创建 API key」，随便起个名字（比如「莓华」），点创建后<b>马上复制</b>——这串以 <code>sk-</code> 开头的密钥只会显示这一次。` },
    { done: picked, title: '在下面选「DeepSeek 深度求索」', body: html`点这里一键选好：<button class="btn small" onClick=${pick}>${ICON.bolt}使用 DeepSeek</button> 接口地址 <code>https://api.deepseek.com/v1</code> 会自动填好。` },
    { done: picked && hasKey, title: '粘贴 API Key 并保存', body: html`把刚才复制的密钥粘贴到下面的「API Key」里，点「保存」。密钥用 Windows 加密存在本机。` },
    { done: picked && !!s.ai.model, title: '选模型', body: html`<button class=${`chip ${s.ai.model === 'deepseek-chat' ? 'on' : ''}`} onClick=${() => model('deepseek-chat')}>deepseek-chat</button> 日常聊天，回复快，推荐。
      <button class=${`chip ${s.ai.model === 'deepseek-reasoner' ? 'on' : ''}`} onClick=${() => model('deepseek-reasoner')}>deepseek-reasoner</button> 先深度思考再回答，更慢一些，适合复杂的工坊任务。` },
    { done: false, title: '点「测试连接」', body: html`看到绿色的「连接成功」就完成啦。常见问题：<b>401</b> 密钥不对或没复制完整；<b>402</b> 余额不足；<b>429</b> 请求太频繁，稍等再试；一直超时请检查网络或代理。详见 <a href="#" onClick=${ext(DS.docs)}>官方文档</a>。` },
  ];
  return html`<div class=${`ds-guide ${open ? 'open' : ''}`}>
    <button class="ds-head" onClick=${() => setOpen(!open)}>
      <span class="ds-logo">DS</span>
      <span class="ds-title"><b>第一次用？手把手接入 DeepSeek</b><span class="muted small">国内直连、价格便宜，大约 3 分钟</span></span>
      ${ICON[open ? 'down' : 'right']}
    </button>
    ${open ? html`<ol class="ds-steps">${steps.map((x, i) => html`<li class=${x.done ? 'done' : ''} key=${i}>
      <span class="ds-num">${x.done ? ICON.check : i + 1}</span>
      <div><b>${x.title}</b><p>${x.body}</p></div>
    </li>`)}</ol>` : null}
  </div>`;
}

function Connect({ s }) {
  return html`<div class="wz-step">
    <h2>帮我连上 AI 吧</h2>
    <p class="wz-lead">连上之后，我就能理解你说的话、自己决定做什么、帮你管理日程。选一个你有密钥的服务，填好后点「测试连接」。也可以先跳过，之后在设置里再连。</p>
    <${DeepSeekGuide} s=${s} />
    <div class="wz-card"><${ModelConfig} kind="chat" compact /></div>
    <p class="hint">${ICON.shield} 密钥只保存在这台电脑上，使用 Windows 的加密存储，不会发送给除你选择的服务以外的任何地方。想完全离线？选「Ollama（本地）」或「LM Studio（本地）」，还没装的话莓华可以在工坊里帮你一键安装（需要先连上任意一个在线 AI 来驱动工坊）。</p>
  </div>`;
}

function Voice({ s }) {
  const choose = (provider) => patchSettings({ tts: { enabled: provider !== 'off', ...(provider !== 'off' ? { provider } : {}) } });
  const cur = s.tts.enabled ? s.tts.provider : 'off';
  const OPTIONS = [
    { id: 'off', title: '先不出声', text: '只用气泡说话，安安静静的。' },
    { id: 'system', title: '系统语音', text: 'Windows 自带，免费，开箱即用。' },
    { id: 'openai', title: 'OpenAI 语音', text: '更自然的声音，用你的 OpenAI 兼容密钥。' },
    { id: 'sovits', title: 'GPT-SoVITS', text: '本地部署的声线模型，可以是我专属的声音。' },
  ];
  return html`<div class="wz-step">
    <h2>想听到我的声音吗？</h2>
    <p class="wz-lead">开启后，我说话时嘴巴会跟着动。详细的音色、语速可以之后在「设置 → 声音」里调。</p>
    <div class="wz-options">${OPTIONS.map((o) => html`<button class=${`wz-option ${cur === o.id ? 'on' : ''}`} onClick=${() => choose(o.id)}>
      <span class="wz-option-title">${o.title}</span><span class="wz-option-text">${o.text}</span>
    </button>`)}</div>
    ${cur === 'sovits' ? html`<${LocalInstall} id="sovits" compact />` : null}
    ${cur !== 'off' ? html`<button class="btn" onClick=${() => invoke('tts.test').catch((e) => toast(String(e.message || e), 'error'))}>${ICON.speaker}试听一下</button>` : null}
  </div>`;
}

function Habits({ s }) {
  const GESTURES = [
    ['右键单击我', '打开花环菜单：聊天、喂食、签到、动作……'],
    ['按住右键拖动', '把我搬到别的地方（多个屏幕也可以）'],
    ['拖着我用力一甩', '我会在屏幕边上弹来弹去，撞太多下会晕哦'],
    ['双击我', '直接和我说话'],
    ['摸摸头、碰碰耳朵尾巴', '我会有反应哦'],
    ['每天签到、喂我吃点心', '我会升级、解锁新食物，心情也会变好（手账「小窝」）'],
    [`${s.app.hotkeys.chat}`, '随时叫我出来说话'],
    [`${s.app.hotkeys.panel}`, '打开这本手账'],
  ];
  return html`<div class="wz-step">
    <h2>和我相处的小秘诀</h2>
    <div class="gesture-list">${GESTURES.map(([k, v]) => html`<div class="gesture"><kbd>${k}</kbd><span>${v}</span></div>`)}</div>
    <div class="wz-switches">
      <${Switch} label="允许我在屏幕上自由走动" checked=${s.pet.allowWander} onChange=${(v) => patchSettings({ pet: { allowWander: v } })} />
      <${Switch} label="早上给你播报今天的安排" checked=${s.planner.morningBrief.enabled} onChange=${(v) => patchSettings({ planner: { morningBrief: { enabled: v } } })} />
      <${Switch} label="久坐时提醒你起来走走" checked=${s.planner.sedentary.enabled} onChange=${(v) => patchSettings({ planner: { sedentary: { enabled: v } } })} />
      <${Switch} label="开机时自动启动" checked=${s.app.launchAtLogin} onChange=${(v) => patchSettings({ app: { launchAtLogin: v } })} />
    </div>
  </div>`;
}

export function WelcomePage() {
  const s = useSettings();
  const [step, setStep] = useState(0);
  const finish = async () => {
    await patchSettings({ onboarded: true, pet: { visible: true } });
    const st = await invoke('ai.status').catch(() => null);
    if (st?.configured) {
      invoke('chat.send', { text: `（${s.user.callName || '主人'}刚刚完成了初次设置，请热情又简短地打个招呼，介绍一下你能帮忙做的两三件事。）`, source: 'pet' }).catch(() => {});
    }
    navigate('today');
  };
  const Body = [Meet, Connect, Voice, Habits][step];
  return html`<div class="welcome">
    <div class="wz-art">
      <img src="meihua://app/assets/character/stand-preview.png" alt="御园莓华" draggable="false" />
      <div class="wz-steps">${STEPS.map((x, i) => html`<button class=${`wz-dot ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick=${() => setStep(i)}><i>${i < step ? ICON.check : i + 1}</i><span>${x}</span></button>`)}</div>
    </div>
    <div class="wz-main">
      <${Body} s=${s} />
      <div class="wz-nav">
        ${step > 0 ? html`<button class="btn ghost" onClick=${() => setStep(step - 1)}>${ICON.left}上一步</button>` : html`<span></span>`}
        <span class="grow"></span>
        ${step === 1 ? html`<button class="btn ghost" onClick=${() => setStep(2)}>稍后再连</button>` : null}
        ${step < STEPS.length - 1
          ? html`<button class="btn primary big" onClick=${() => setStep(step + 1)}>下一步${ICON.right}</button>`
          : html`<button class="btn primary big" onClick=${finish}>${ICON.pawPrint}开始一起生活吧</button>`}
      </div>
    </div>
  </div>`;
}
