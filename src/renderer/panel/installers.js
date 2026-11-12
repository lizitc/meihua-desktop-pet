// Local AI projects that 莓华 can install herself in the 工坊: one click hands the workshop agent a step-by-step
// recipe (it still asks before downloads and risky commands, per the workshop permission), another switches the app
// over once the service answers on its local port (`local.probe`).
import { html, useEffect, useState } from '../vendor/ui.js';
import { ICON } from './icons.js';
import { invoke, navigate, toast, patchSettings } from './lib.js';

const COMMON = `
通用要求：
- 这是 Windows 电脑。每一步执行前简单说明在做什么；下载任何大文件（安装包、模型、整合包）前，先告诉我文件名、大约大小和来源网址，等我确认再下载。
- 只使用官方渠道（winget 官方源、项目官网或官方 GitHub 仓库给出的链接），不要用来路不明的镜像。
- 不要修改系统设置、不要卸载或删除已有的软件和文件。
- 需要长时间运行的服务（后台服务器）用 \`start "" ...\` 在新窗口里启动，不要在当前命令里一直等它结束。
- 刚装好的命令行工具可能还不在 PATH 里，找不到时用完整路径。
- 最后用简短的中文总结：装在哪里、怎么启动、莓华这边该怎么设置。`;

export const INSTALLERS = {
  ollama: {
    name: 'Ollama',
    kind: 'chat',
    blurb: '最省事的本地大模型运行环境。装好后下载一个模型，莓华就能离线聊天，不需要 API Key。',
    size: '安装包约 1 GB，模型 1–5 GB',
    site: 'https://ollama.com/download/windows',
    title: '安装 Ollama 本地模型',
    recipe: `请帮我在这台电脑上安装并配置 Ollama（本地大模型运行环境），让莓华可以用本地模型聊天。
1. 先检查是否已经安装：运行 \`ollama --version\`（也看看 %LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe 是否存在）。已安装就跳到第 3 步。
2. 安装：优先用 \`winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements\`。没有 winget 或失败时，用 web_fetch 打开 https://ollama.com/download/windows 确认官方下载地址，下载 OllamaSetup.exe 到工作目录再运行，并提醒我在安装界面里点完。
3. 确认服务在运行：\`curl.exe -s http://127.0.0.1:11434/api/tags\`。没有响应就用 \`start "" ollama serve\` 启动（或提醒我从开始菜单打开 Ollama）。
4. 选模型：用 \`nvidia-smi\`（没有 N 卡就看 \`systeminfo\` 的内存）判断配置。显存 ≥ 8 GB 推荐 qwen2.5:7b；4–8 GB 推荐 qwen2.5:3b；更低或只有 CPU 推荐 qwen2.5:1.5b。把推荐的模型和大小告诉我，等我确认后运行 \`ollama pull <模型名>\`。
5. 测试：\`ollama run <模型名> "用一句话介绍你自己"\`。
6. 总结时告诉我：在莓华的「设置 → AI 连接」里选「Ollama（本地）」，模型填 <模型名>（或直接在那里点「已装好，使用它」）。
${COMMON}`,
  },
  lmstudio: {
    name: 'LM Studio',
    kind: 'chat',
    blurb: '带图形界面的本地模型工具，可以自己浏览、下载各种模型，开启本地服务后给莓华使用。',
    size: '安装包约 500 MB，模型 1–5 GB',
    site: 'https://lmstudio.ai',
    title: '安装 LM Studio 本地模型',
    recipe: `请帮我在这台电脑上安装并配置 LM Studio（本地大模型工具），并开启它的本地 API 服务给莓华使用。
1. 先检查是否已经安装：看 %LOCALAPPDATA%\\Programs\\LM Studio\\LM Studio.exe（或 \`lms version\`）。已安装就跳到第 3 步。
2. 安装：优先用 \`winget install --id ElementLabs.LMStudio -e --accept-source-agreements --accept-package-agreements\`。不行的话用 web_fetch 打开 https://lmstudio.ai 找到官方 Windows 安装包，下载后运行，并提醒我在安装界面里点完。
3. 第一次需要启动一次 LM Studio（\`start "" "%LOCALAPPDATA%\\Programs\\LM Studio\\LM Studio.exe"\`），它会安装命令行工具 lms（在 %USERPROFILE%\\.lmstudio\\bin\\lms.exe）。如果需要我在界面里点什么，告诉我。
4. 选模型：用 \`nvidia-smi\` / \`systeminfo\` 判断配置。显存 ≥ 8 GB 推荐 qwen2.5-7b-instruct；4–8 GB 推荐 qwen2.5-3b-instruct；更低推荐 qwen2.5-1.5b-instruct。告诉我模型和大小，等我确认后用 \`lms get <模型>\` 下载。
5. 启动服务并加载模型：\`lms server start\`（默认端口 1234），然后 \`lms load <模型>\`。用 \`curl.exe -s http://127.0.0.1:1234/v1/models\` 确认能看到模型。
6. 总结时告诉我：在莓华的「设置 → AI 连接」里选「LM Studio（本地）」，模型填刚才加载的模型名（或直接点「已装好，使用它」）。以后要先打开 LM Studio 或运行 \`lms server start\`。
${COMMON}`,
  },
  sovits: {
    name: 'GPT-SoVITS',
    kind: 'voice',
    blurb: '开源的语音合成 / 声线克隆。用一段 3–10 秒的参考音频，就能让莓华用专属的声音说话。',
    size: '整合包约 5–10 GB（建议 N 卡）',
    site: 'https://github.com/RVC-Boss/GPT-SoVITS',
    title: '部署 GPT-SoVITS 语音',
    recipe: `请帮我在这台电脑上部署 GPT-SoVITS（开源语音合成），并启动它的 API 服务，给莓华当声音。
1. 先看显卡：\`nvidia-smi\`。有 NVIDIA 显卡就用 CUDA 版整合包；没有就用 CPU 版（会比较慢，提前告诉我）。
2. 用 web_fetch 打开官方仓库 https://github.com/RVC-Boss/GPT-SoVITS 的 README 和 Releases 页面，找到 Windows 整合包的官方下载地址（Release 附件，或 README 里给出的 Hugging Face / ModelScope 官方链接）。告诉我文件名、大小和来源，等我确认后再下载到工作目录。
3. 解压：.zip 用 \`tar -xf\`；.7z 需要 7-Zip，先检查 \`7z\`（或 C:\\Program Files\\7-Zip\\7z.exe），没有就 \`winget install --id 7zip.7zip -e\`。
4. 在整合包目录里写一个「启动API.bat」，内容是用整合包自带的 Python 运行 API：\`runtime\\python.exe api_v2.py -a 127.0.0.1 -p 9880\`（以 README 里写的为准），然后 \`start "" 启动API.bat\` 启动。等它加载完，用 \`curl.exe -s http://127.0.0.1:9880/\` 确认端口有响应。
5. 参考音频：需要一段 3–10 秒、吐字清楚的参考音频和它对应的文字。先问我有没有准备好；没有的话，可以先用整合包里自带的示例音频测试。测试命令：\`curl.exe -s -o test.wav "http://127.0.0.1:9880/tts?text=你好呀&text_lang=zh&ref_audio_path=<参考音频完整路径>&prompt_lang=zh&prompt_text=<参考音频的文字>"\`，确认生成了 test.wav。
6. 总结时告诉我：整合包路径、「启动API.bat」的位置，以及在莓华的「设置 → 声音」里选 GPT-SoVITS，服务地址 http://127.0.0.1:9880，填写参考音频路径和文字（或直接点「已装好，使用它」）。
${COMMON}`,
  },
};

/** Hand the recipe to the workshop and open the new task. */
export async function startInstall(id) {
  const it = INSTALLERS[id];
  if (!it) return;
  try {
    const st = await invoke('ai.status').catch(() => null);
    if (st && !st.configured) {
      toast(`工坊需要先连上一个 AI 才能开工（比如 DeepSeek），连好之后再来安装 ${it.name}。`, 'info', 6000);
      navigate('settings/ai');
      return;
    }
    const t = await invoke('agent.start', { title: it.title, instructions: it.recipe });
    toast(`已经交给工坊啦：${it.title}`, 'ok');
    navigate(`workshop/${t.id}`);
  } catch (err) {
    toast(err.message, 'error', 5000);
  }
}

/** Switch the app over to the installed service. */
export async function useInstalled(id, probe) {
  if (id === 'sovits') {
    await patchSettings({ tts: { enabled: true, provider: 'sovits', sovits: { baseUrl: 'http://127.0.0.1:9880' } } });
    toast('已切换到 GPT-SoVITS，记得在「设置 → 声音」里填好参考音频。', 'ok', 5000);
    navigate('settings/voice');
    return;
  }
  const presets = await invoke('ai.presets');
  const p = presets[id];
  const model = probe?.models?.[0] || '';
  await patchSettings({ ai: { preset: id, provider: p.provider, baseUrl: p.baseUrl, model } });
  toast(model ? `已切换到 ${INSTALLERS[id].name}，模型：${model}` : `已切换到 ${INSTALLERS[id].name}，请在「AI 连接」里填写模型名。`, 'ok', 5000);
}

export function useProbe(id) {
  const [probe, setProbe] = useState(null);
  const check = () => { setProbe((p) => ({ ...(p || {}), checking: true })); invoke('local.probe', id).then(setProbe).catch(() => setProbe({ up: false })); };
  useEffect(check, [id]);
  return [probe, check];
}

/** One installable project: status, 一键安装 in the workshop, and (when running) switch to it. */
export function LocalInstall({ id, compact }) {
  const it = INSTALLERS[id];
  const [probe, check] = useProbe(id);
  if (!it) return null;
  const up = probe?.up;
  const status = !probe || probe.checking ? html`<span class="tag">检测中…</span>`
    : up ? html`<span class="tag ok">${ICON.check}正在运行${probe.models?.length ? ` · ${probe.models.length} 个模型` : ''}</span>`
      : html`<span class="tag">未检测到</span>`;
  const actions = html`<div class="li-actions">
    <button class="btn small primary" onClick=${() => startInstall(id)}>${ICON.workshop}在工坊一键安装</button>
    ${up ? html`<button class="btn small" onClick=${() => useInstalled(id, probe)}>${ICON.play}已装好，使用它</button>` : null}
    <button class="icon-btn small" title="重新检测" onClick=${check}>${ICON.refresh}</button>
    <button class="icon-btn small" title="官网" onClick=${() => invoke('system.openExternal', it.site)}>${ICON.external}</button>
  </div>`;
  if (compact) {
    return html`<div class="local-install compact">
      <span class="li-text">${up ? `${it.name} 已在本机运行。` : `还没装 ${it.name}？可以让莓华在工坊里帮你装（下载前会先问你）。`}</span>
      ${status}${actions}
    </div>`;
  }
  return html`<div class="local-install">
    <div class="li-head"><b>${it.name}</b><span class="tag soft">${it.kind === 'voice' ? '声音' : '本地模型'}</span>${status}</div>
    <p class="li-blurb">${it.blurb}</p>
    <p class="muted small">${it.size}</p>
    ${actions}
  </div>`;
}

/** The workshop shelf: every installable project. */
export function InstallShelf() {
  return html`<section class="install-shelf">
    <div class="install-shelf-head">${ICON.bolt}<b>本地 AI 一键安装</b><span class="muted small">莓华会在工坊里按步骤帮你安装，下载和运行命令前都会先问你</span></div>
    <div class="install-grid">${Object.keys(INSTALLERS).map((id) => html`<${LocalInstall} key=${id} id=${id} />`)}</div>
  </section>`;
}
