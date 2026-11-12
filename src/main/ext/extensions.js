// Ways the assistant grows new abilities:
//  - Skills: markdown "how to do X" packs; enabled ones are listed in the system prompt and
//    read on demand with skill_read.
//  - Extensions: small code packages exposing new tools, executed in a separate utility
//    process. Anything the AI writes starts disabled; the owner reviews the code and
//    enables it. Changing the code after approval disables it again.
import { utilityProcess } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { userDir, dataFile } from '../paths.js';
import { JsonStore, uid } from '../store.js';
import { rpc, broadcast, bus } from '../bus.js';
import { registerTool, unregisterGroup } from '../ai/tools.js';
import { showCard } from '../notify.js';

// When packaged, the host script is unpacked next to app.asar (see build.asarUnpack in package.json).
const HOST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'host.mjs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const S = (properties, required = []) => ({ type: 'object', properties, required });
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

// ------------------------------------------------------------ skills
function parseSkill(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { id: path.basename(file, '.md'), name: meta.name || path.basename(file, '.md'), description: meta.description || '', enabled: meta.enabled === 'true', author: meta.author || 'user', body: m ? m[2] : raw, file };
}

function writeSkill({ id, name, description, body, enabled, author }) {
  const file = path.join(userDir('skills'), `${id}.md`);
  const esc = (s) => String(s || '').replace(/\r?\n/g, ' ').trim();
  fs.writeFileSync(file, `---\nname: ${esc(name)}\ndescription: ${esc(description)}\nenabled: ${enabled ? 'true' : 'false'}\nauthor: ${author || 'user'}\n---\n${body || ''}`);
  return parseSkill(file);
}

class Extensions {
  constructor() {
    this.state = new JsonStore(dataFile('extensions.json'), { approved: {} }); // id -> { hash, enabled }
    this.host = null;
    this.pending = new Map();
    this.onSkillsChanged = () => {};
  }

  // ---------------------------------------------------------- skills
  skills() {
    const dir = userDir('skills');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => { try { return parseSkill(path.join(dir, f)); } catch { return null; } }).filter(Boolean);
  }

  enabledSkills() { return this.skills().filter((s) => s.enabled).map((s) => ({ name: s.name, description: s.description })); }

  saveSkill(input, author = 'user') {
    const existing = this.skills().find((s) => s.id === input.id || s.name === input.name);
    const id = existing?.id || input.id || `skill-${uid()}`;
    const enabled = author === 'user' ? (input.enabled ?? existing?.enabled ?? true) : false;
    const s = writeSkill({ id, name: input.name, description: input.description, body: input.body ?? input.content, enabled, author });
    broadcast('ext:changed');
    this.onSkillsChanged();
    return s;
  }

  // ---------------------------------------------------------- extensions on disk
  #dir(id) { return path.join(userDir('extensions'), id); }

  #hash(dir) {
    const h = crypto.createHash('sha256');
    for (const f of ['manifest.json', 'main.mjs']) { try { h.update(fs.readFileSync(path.join(dir, f))); } catch { /* missing */ } }
    return h.digest('hex').slice(0, 16);
  }

  list() {
    const root = userDir('extensions');
    const out = [];
    for (const id of fs.readdirSync(root)) {
      const dir = path.join(root, id);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        const hash = this.#hash(dir);
        const ap = this.state.data.approved[id];
        const approved = ap?.hash === hash;
        out.push({ id, dir, name: manifest.name || id, description: manifest.description || '', version: manifest.version || '', tools: manifest.tools || [], author: manifest.author || '', enabled: !!(approved && ap.enabled), approved, changed: !!ap && !approved });
      } catch (err) {
        out.push({ id, dir, name: id, description: `清单无法读取：${err.message}`, tools: [], enabled: false, approved: false, broken: true });
      }
    }
    return out;
  }

  source(id) {
    const dir = this.#dir(id);
    const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
    return { manifest: read('manifest.json'), code: read('main.mjs') };
  }

  create({ id, name, description, tools, code }, author = 'ai') {
    if (!ID_RE.test(id)) throw new Error('id 只能用小写字母、数字和连字符，2~40 个字符，并以字母开头');
    if (!Array.isArray(tools) || !tools.length) throw new Error('至少需要一个工具');
    for (const t of tools) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/.test(t.name || '')) throw new Error(`工具名不合法：${t.name}`);
      if (!new RegExp(`export\\s+(async\\s+)?function\\s+${t.name}\\b|export\\s+const\\s+${t.name}\\b`).test(code)) throw new Error(`代码里没有导出函数 ${t.name}`);
    }
    const dir = this.#dir(id);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { id, name, description, version: '1.0.0', author, tools: tools.map((t) => ({ name: t.name, description: t.description || '', input_schema: t.input_schema || { type: 'object', properties: {} } })) };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(dir, 'main.mjs'), code);
    broadcast('ext:changed');
    this.reload();
    return { id, dir, needsReview: true };
  }

  async setEnabled(id, enabled) {
    const dir = this.#dir(id);
    if (!fs.existsSync(dir)) throw new Error('扩展不存在');
    this.state.data.approved[id] = { hash: this.#hash(dir), enabled: !!enabled, at: Date.now() };
    this.state.save();
    await this.reload();
    broadcast('ext:changed');
    return true;
  }

  remove(id) {
    const dir = this.#dir(id);
    if (!dir.startsWith(userDir('extensions'))) throw new Error('路径异常');
    fs.rmSync(dir, { recursive: true, force: true });
    delete this.state.data.approved[id];
    this.state.save();
    this.reload();
    broadcast('ext:changed');
    return true;
  }

  // ---------------------------------------------------------- host process
  #ensureHost() {
    if (this.host) return this.host;
    const host = utilityProcess.fork(HOST, [], { serviceName: 'Meihua Extensions', stdio: 'pipe' });
    host.stdout?.on('data', (d) => console.log('[ext]', d.toString().trim()));
    host.stderr?.on('data', (d) => console.warn('[ext]', d.toString().trim()));
    host.on('message', (m) => { const p = this.pending.get(m.callId); if (p) { this.pending.delete(m.callId); p(m); } });
    host.on('exit', () => {
      this.host = null;
      for (const p of this.pending.values()) p({ ok: false, error: '扩展进程已退出' });
      this.pending.clear();
    });
    this.host = host;
    return host;
  }

  #call(msg) {
    const host = this.#ensureHost();
    const callId = uid('x');
    return new Promise((resolve) => { this.pending.set(callId, resolve); host.postMessage({ ...msg, callId }); });
  }

  async reload() {
    for (const e of this.list()) unregisterGroup(`ext:${e.id}`);
    const enabled = this.list().filter((e) => e.enabled);
    if (!enabled.length) { if (this.host) { this.host.kill(); this.host = null; } return; }
    for (const e of enabled) {
      const r = await this.#call({ type: 'load', id: e.id, dir: e.dir, version: this.#hash(e.dir) });
      if (!r.ok) { console.warn('[ext] load failed', e.id, r.error); continue; }
      for (const t of e.tools) {
        const name = `x_${e.id.replace(/-/g, '_')}_${t.name}`.slice(0, 64);
        registerTool({
          name, group: `ext:${e.id}`, description: `【扩展·${e.name}】${t.description}`, input_schema: t.input_schema || { type: 'object', properties: {} },
          label: () => `使用扩展「${e.name}」`,
          handler: async (input) => {
            const res = await this.#call({ type: 'call', id: e.id, tool: t.name, input });
            if (!res.ok) throw new Error(res.error);
            return res.result;
          },
        });
      }
    }
  }

  // ---------------------------------------------------------- AI-facing tools & RPC
  registerChatTools() {
    registerTool({
      name: 'skill_list', group: 'ext', description: '列出所有技能（含未启用的）。', input_schema: S({}),
      label: () => '翻看技能本',
      handler: () => this.skills().map((s) => ({ id: s.id, name: s.name, description: s.description, enabled: s.enabled })),
    });
    registerTool({
      name: 'skill_read', group: 'ext', description: '读取一个技能的完整说明，然后按说明去做。', input_schema: S({ name: { type: 'string' } }, ['name']),
      label: (i) => `翻开技能「${i.name || ''}」`,
      handler: (i) => { const s = this.skills().find((x) => x.name === i.name || x.id === i.name); if (!s) throw new Error('没有这个技能'); return `# ${s.name}\n${s.description}\n\n${s.body}`; },
    });
    registerTool({
      name: 'skill_write', group: 'ext',
      description: '新建或改写一个技能（Markdown 写成的工作方法、流程或领域知识）。写好后需要主人在手账里审核启用。',
      input_schema: S({ name: { type: 'string', maxLength: 40 }, description: { type: 'string', maxLength: 200 }, content: { type: 'string', maxLength: 20000 } }, ['name', 'description', 'content']),
      label: (i) => `写下技能「${i.name || ''}」`,
      handler: (i) => {
        const s = this.saveSkill({ name: i.name, description: i.description, body: i.content }, 'ai');
        showCard({ kind: 'info', label: '新技能待审核', title: s.name, body: `${s.description}\n在「手账 → 技能与扩展」里查看并启用。`, actions: [{ id: 'open', label: '去看看', style: 'primary' }, { id: 'later', label: '稍后' }] })
          .then((a) => { if (a === 'open') bus.emit('panel:open', 'skills'); });
        return { ok: true, id: s.id, needsReview: true };
      },
    });
    registerTool({
      name: 'extension_list', group: 'ext', description: '列出已安装的扩展及其状态。', input_schema: S({}),
      label: () => '查看扩展',
      handler: () => this.list().map((e) => ({ id: e.id, name: e.name, description: e.description, enabled: e.enabled, tools: e.tools.map((t) => t.name) })),
    });
    registerTool({
      name: 'extension_create', group: 'ext',
      description: '编写一个扩展，让自己获得新的工具能力。code 是 ES 模块（main.mjs），为每个工具 export async function <工具名>(input, ctx)，返回字符串或可 JSON 序列化的对象；ctx.fetch 发网络请求，ctx.storage.get/set 持久化少量数据，ctx.log 打日志；只能用 Node 内置模块。创建后需要主人审核代码并启用。复杂的扩展可以改用 agent_start 让工坊来开发和测试。',
      input_schema: S({
        id: { type: 'string', description: '小写字母/数字/连字符，如 weather-cn' }, name: { type: 'string' }, description: { type: 'string' },
        tools: { type: 'array', maxItems: 12, items: S({ name: { type: 'string' }, description: { type: 'string' }, input_schema: { type: 'object' } }, ['name', 'description']) },
        code: { type: 'string', maxLength: 60000 },
      }, ['id', 'name', 'description', 'tools', 'code']),
      label: (i) => `制作扩展「${i.name || ''}」`,
      handler: (i) => {
        const r = this.create(i, 'ai');
        showCard({ kind: 'info', label: '新扩展待审核', title: i.name, body: `${i.description}\n请在「手账 → 技能与扩展」里检查代码后启用。`, actions: [{ id: 'open', label: '去审核', style: 'primary' }, { id: 'later', label: '稍后' }] })
          .then((a) => { if (a === 'open') bus.emit('panel:open', 'skills'); });
        return r;
      },
    });
  }

  registerRpc() {
    rpc('skills.list', () => this.skills().map(({ file, ...s }) => s));
    rpc('skills.save', (s) => { const r = this.saveSkill(s, 'user'); const { file, ...rest } = r; return rest; });
    rpc('skills.toggle', (id, enabled) => { const s = this.skills().find((x) => x.id === id); if (!s) throw new Error('没有这个技能'); writeSkill({ ...s, enabled }); broadcast('ext:changed'); this.onSkillsChanged(); return true; });
    rpc('skills.delete', (id) => { const s = this.skills().find((x) => x.id === id); if (s) fs.rmSync(s.file, { force: true }); broadcast('ext:changed'); this.onSkillsChanged(); return true; });
    rpc('ext.list', () => this.list());
    rpc('ext.source', (id) => this.source(id));
    rpc('ext.enable', (id, on) => this.setEnabled(id, on));
    rpc('ext.remove', (id) => this.remove(id));
    rpc('ext.openFolder', () => userDir('extensions'));
  }

  stop() { if (this.host) { this.host.kill(); this.host = null; } this.state.flush(); }
}

export const extensions = new Extensions();
