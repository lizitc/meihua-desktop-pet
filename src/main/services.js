// Service wiring: AI companion, planner + scheduler, workshop agent, skills/extensions,
// voice. Called once after the windows exist.
import { bus, broadcast, rpc } from './bus.js';
import { settings } from './settings.js';
import { registerNotifyRpc } from './notify.js';
import { planner } from './planner/planner.js';
import { scheduler } from './planner/scheduler.js';
import { memory } from './ai/memory.js';
import { companion } from './ai/companion.js';
import { registerBuiltinTools } from './ai/builtin-tools.js';
import { isConfigured, aiConfig } from './ai/config.js';
import { listTools } from './ai/tools.js';
import { agents } from './agent/agent.js';
import { extensions } from './ext/extensions.js';
import { registerTtsRpc } from './voice/tts.js';
import { registerSttRpc } from './voice/stt.js';
import { panelWindow } from './panel-window.js';
import { life } from './life/life.js';
import { registerTool } from './ai/tools.js';

const aiStatus = () => ({ configured: isConfigured(), autonomy: settings.get('ai.autonomy'), model: aiConfig('chat').model, preset: aiConfig('chat').preset });

export async function startServices() {
  registerNotifyRpc();
  planner.registerRpc();
  memory.registerRpc();
  companion.registerRpc();
  agents.registerRpc();
  extensions.registerRpc();
  registerTtsRpc();
  registerSttRpc();

  registerBuiltinTools();
  agents.registerChatTools();
  extensions.registerChatTools();

  companion.skillsProvider = () => extensions.enabledSkills();
  companion.agentSummary = () => agents.statusText();

  // 养成: stats in every chat context, in-character answers to feeding / check-in / level up
  life.registerRpc();
  life.aiWillReact = () => companion.canReact(true);
  companion.lifeSummary = () => life.contextText();
  life.start();
  bus.on('life:fed', (r) => companion.react({ type: 'feed', food: r.food.name, favorite: r.food.favorite, hunger: life.state().hunger, hungerBefore: r.hungerBefore }));
  bus.on('life:checkin', (r) => companion.react({ type: 'checkin', streak: r.streak, gift: r.gift }));
  bus.on('life:levelup', (e) => setTimeout(() => companion.react({ type: 'levelup', ...e }), 3500));
  registerTool({
    name: 'pet_status', group: 'pet', description: '查看你自己的养成状态：等级、经验、心情、饱食度、亲密度、莓果、签到、背包里的食物。',
    input_schema: { type: 'object', properties: {} },
    label: () => '看看自己的状态',
    handler: () => ({ ...life.state(), foods: life.foods().filter((f) => f.unlocked).map((f) => ({ name: f.name, stock: f.stock, price: f.price })) }),
  });
  extensions.onSkillsChanged = () => companion.refreshSystem('技能列表有更新（启用的技能会在下次整理对话后进入你的说明里；现在可用 skill_list / skill_read 查看）。');
  await extensions.reload().catch((err) => console.warn('[ext] reload failed', err.message));

  rpc('ai.status', aiStatus);
  rpc('tools.list', () => listTools().map((t) => ({ name: t.name, description: t.description, group: t.group })));
  bus.on('settings:changed', ({ changed }) => {
    if (changed.some((k) => k.startsWith('ai.') || k.startsWith('secret.ai'))) broadcast('ai:status', aiStatus());
    if (changed.includes('user.callName')) companion.refreshSystem(`主人希望你称呼他/她为「${settings.get('user.callName')}」。`);
  });
  bus.on('panel:open', (page) => panelWindow.open(page));
  scheduler.start();
}

export function stopServices() {
  scheduler.stop();
  agents.stopAll();
  life.stop();
  extensions.stop();
  companion.flush();
  memory.flush();
  planner.flush();
}
