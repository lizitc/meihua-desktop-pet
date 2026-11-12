// Model providers behind one streaming interface.
//  - Anthropic (Claude): official @anthropic-ai/sdk
//  - Everything else: OpenAI-compatible chat/completions over SSE (OpenAI, DeepSeek, Qwen,
//    Kimi, GLM, SiliconFlow, OpenRouter, Gemini's OpenAI endpoint, Ollama, LM Studio, …)
// Conversation format everywhere is Anthropic-style content blocks; the OpenAI adapter
// converts on the way in and out.
import Anthropic from '@anthropic-ai/sdk';
import { net } from 'electron';

export const PRESETS = {
  anthropic: { label: 'Claude（Anthropic 官方）', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  'anthropic-proxy': { label: 'Claude（自定义网关 / 中转）', provider: 'anthropic', baseUrl: '', model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
  openai: { label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', models: [], keyUrl: 'https://platform.openai.com/api-keys' },
  deepseek: { label: 'DeepSeek 深度求索', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  qwen: { label: '通义千问（阿里云百炼）', provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'], keyUrl: 'https://bailian.console.aliyun.com/' },
  moonshot: { label: 'Kimi（月之暗面）', provider: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: '', models: [], keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  zhipu: { label: '智谱 GLM', provider: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '', models: [], keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  siliconflow: { label: '硅基流动 SiliconFlow', provider: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: '', models: [], keyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  openrouter: { label: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', models: [], keyUrl: 'https://openrouter.ai/keys' },
  gemini: { label: 'Google Gemini（OpenAI 兼容）', provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', models: [], keyUrl: 'https://aistudio.google.com/apikey' },
  ollama: { label: 'Ollama（本地）', provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: '', models: [], noKey: true },
  lmstudio: { label: 'LM Studio（本地）', provider: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', model: '', models: [], noKey: true },
  custom: { label: '自定义 OpenAI 兼容接口', provider: 'openai', baseUrl: '', model: '', models: [] },
};

export class AIError extends Error {
  constructor(message, { status, code, retryable = false } = {}) { super(message); this.status = status; this.code = code; this.retryable = retryable; }
}

const CONTEXT_RE = /prompt is too long|context.{0,24}(length|window|limit)|maximum context|too many (input )?tokens|context_length_exceeded|exceeds? the (model'?s? )?(maximum|max|context)|input (is )?too long|request too large/i;
const NETWORK_RE = /network|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket|terminated|fetch failed|premature close|Connection error|ERR_/i;
/** The conversation no longer fits the model's context window. */
export const isContextError = (err) => err?.code === 'context' || err?.status === 413 || CONTEXT_RE.test(String(err?.message || ''));
/** Worth retrying after a pause: rate limits, overload, 5xx, dropped connections. */
export const isTransient = (err) => !isContextError(err) && (!!err?.retryable || err?.status === 408 || err?.status === 409 || err?.status === 429 || err?.status >= 500
  || /overloaded|过载|稍后/i.test(String(err?.message || '')) || (!err?.status && NETWORK_RE.test(String(err?.message || ''))));
const errMeta = (status, message) => ({ status, code: CONTEXT_RE.test(String(message || '')) ? 'context' : undefined, retryable: status == null || status === 408 || status === 409 || status === 429 || status >= 500 });

const isOfficialAnthropic = (baseUrl) => !baseUrl || /^https:\/\/api\.anthropic\.com\/?$/i.test(baseUrl.trim());
const supportsEffort = (model) => /claude-(opus|sonnet|haiku|fable|mythos)-5|claude-opus-4-[6-9]|claude-sonnet-4-6/i.test(model || '');

function friendly(status, message) {
  const m = String(message || '');
  if (status === 401 || /invalid.*(api|x-api).?key|unauthori[sz]ed|authentication/i.test(m)) return 'API 密钥无效或已过期，请到「设置 → AI 连接」检查。';
  if (status === 403) return '没有权限访问这个模型（403）。请确认账号已开通该模型。';
  if (status === 404) return `找不到模型或接口地址（404）。请检查模型名与 Base URL。${m ? '\n' + m.slice(0, 160) : ''}`;
  if (status === 429) return '请求太频繁或额度已用完（429），稍后再试试。';
  if (status === 529 || /overloaded/i.test(m)) return '模型服务正忙（过载），稍等一下再试。';
  if (status >= 500) return `模型服务暂时出错（${status}），稍后重试。`;
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed|ERR_/i.test(m)) return `连不上模型服务：${m.slice(0, 160)}`;
  return m.slice(0, 400) || '未知错误';
}

// ------------------------------------------------------------ Anthropic
const anthropicClients = new Map();
function anthropicClient(cfg) {
  const key = `${cfg.baseUrl}|${cfg.apiKey}`;
  let c = anthropicClients.get(key);
  if (!c) {
    c = new Anthropic({ apiKey: cfg.apiKey || 'missing', baseURL: cfg.baseUrl && !isOfficialAnthropic(cfg.baseUrl) ? cfg.baseUrl.replace(/\/+$/, '') : undefined, maxRetries: 2, timeout: 10 * 60 * 1000 });
    anthropicClients.set(key, c);
  }
  return c;
}

/**
 * After a mid-output server-side fallback, blocks before the last `fallback` marker other
 * than text must not be echoed back; the marker itself is dropped.
 */
export function sanitizeEcho(content) {
  if (!Array.isArray(content)) return content;
  const last = content.map((b) => b?.type).lastIndexOf('fallback');
  const out = [];
  content.forEach((b, i) => {
    if (!b || b.type === 'fallback') return;
    if (i < last && b.type !== 'text') return;
    out.push(b);
  });
  return out;
}

const stripThinking = (messages) => messages.map((m) => (m.role === 'assistant' && Array.isArray(m.content)
  ? { ...m, content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') }
  : m));

async function streamAnthropic(cfg, req, h) {
  const client = anthropicClient(cfg);
  const official = isOfficialAnthropic(cfg.baseUrl);
  const tools = (req.tools || []).map((t) => (t.type ? t : { name: t.name, description: t.description, input_schema: t.input_schema, ...(official && req.stream !== false ? { eager_input_streaming: true } : {}) }));
  const base = {
    model: cfg.model,
    max_tokens: cfg.maxTokens || 4096,
    system: req.system,
    messages: req.messages,
    cache_control: { type: 'ephemeral' },
    ...(tools.length ? { tools } : {}),
    ...(supportsEffort(cfg.model) && cfg.effort ? { output_config: { effort: cfg.effort } } : {}),
  };
  const useFallbacks = official && cfg.serverFallbacks !== false;
  const run = async (params) => {
    const stream = useFallbacks
      ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: req.signal })
      : client.messages.stream(params, { signal: req.signal });
    stream.on('text', (d) => h.onText?.(d));
    stream.on('streamEvent', (ev) => {
      if (ev.type === 'content_block_start') {
        const b = ev.content_block;
        if (b.type === 'tool_use' || b.type === 'server_tool_use') h.onToolStart?.(b.name);
        else if (b.type === 'fallback') h.onFallback?.(b);
      }
    });
    return stream.finalMessage();
  };
  let msg;
  let params = base;
  for (let attempt = 0; ; attempt++) {
    try {
      msg = await run(params);
      break;
    } catch (err) {
      if (err instanceof Anthropic.APIError && err.status === 400 && /signature|thinking/i.test(err.message) && params === base) {
        params = { ...base, messages: stripThinking(base.messages) }; // retry once without thinking blocks
        continue;
      }
      if (err instanceof Anthropic.APIError && err.status === 400 && /max_tokens/i.test(err.message) && params.max_tokens > 8192) {
        params = { ...params, max_tokens: 8192 }; // older models have a smaller output limit
        continue;
      }
      // With eager input streaming a tool input that is not parseable JSON rejects
      // finalMessage(); re-issue the turn a couple of times. API errors propagate.
      if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIUserAbortError || err?.name === 'AbortError' || attempt >= 2) throw err;
      console.warn('[ai] unparseable tool input, re-issuing turn:', err.message);
      h.onRestart?.();
    }
  }
  const fallbackUsed = (msg.usage?.iterations || []).some((e) => e.type === 'fallback_message');
  return { content: sanitizeEcho(msg.content), stopReason: msg.stop_reason, stopDetails: msg.stop_details || null, usage: msg.usage, model: msg.model, fallbackUsed };
}

// ------------------------------------------------------------ OpenAI-compatible
function toOpenAI(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: typeof system === 'string' ? system : system.map((b) => b.text).join('\n\n') });
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      const msg = { role: 'assistant', content: text || (calls.length ? null : '') };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
      continue;
    }
    const results = blocks.filter((b) => b.type === 'tool_result');
    for (const r of results) {
      const content = typeof r.content === 'string' ? r.content : (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: (r.is_error ? '[错误] ' : '') + content });
    }
    const rest = blocks.filter((b) => b.type !== 'tool_result');
    if (!rest.length) continue;
    if (rest.every((b) => b.type === 'text')) out.push({ role: 'user', content: rest.map((b) => b.text).join('\n') });
    else {
      out.push({
        role: 'user',
        content: rest.map((b) => (b.type === 'image' && b.source?.type === 'base64'
          ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
          : { type: 'text', text: b.text ?? '' })),
      });
    }
  }
  return out;
}

async function* sseLines(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      yield line;
    }
  }
  if (buf.trim()) yield buf;
}

async function streamOpenAI(cfg, req, h) {
  const url = `${(cfg.baseUrl || '').replace(/\/+$/, '')}/chat/completions`;
  if (!/^https?:\/\//i.test(url)) throw new AIError('请先在设置里填写接口地址（Base URL）。');
  const tools = (req.tools || []).filter((t) => !t.type).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const isOpenAI = /api\.openai\.com/.test(url);
  const body = {
    model: cfg.model,
    messages: toOpenAI(req.system, req.messages),
    stream: true,
    ...(isOpenAI ? { max_completion_tokens: cfg.maxTokens || 4096 } : { max_tokens: cfg.maxTokens || 4096 }),
    ...(cfg.temperature != null && !/^(o\d|gpt-5)/i.test(cfg.model) ? { temperature: cfg.temperature } : {}),
    ...(tools.length ? { tools } : {}),
  };
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (/openrouter\.ai/.test(url)) { headers['HTTP-Referer'] = 'https://meihua.desktop'; headers['X-Title'] = 'Meihua Desktop'; }
  let res;
  try {
    res = await net.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new AIError(friendly(0, err.message), { retryable: true });
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error?.message || j.message || JSON.stringify(j).slice(0, 300); } catch { try { detail = await res.text(); } catch { /* ignore */ } }
    throw new AIError(friendly(res.status, detail), errMeta(res.status, detail));
  }
  let text = '';
  const calls = [];
  let finish = null;
  let usage = null;
  let model = cfg.model;
  for await (const line of sseLines(res.body)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    let j;
    try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw new AIError(friendly(j.error.code, j.error.message), { ...errMeta(Number(j.error.code) || undefined, j.error.message), retryable: /overload|rate|busy|timeout|unavailable/i.test(String(j.error.message || j.error.type || '')) });
    if (j.usage) usage = j.usage;
    if (j.model) model = j.model;
    const ch = j.choices?.[0];
    if (!ch) continue;
    const d = ch.delta || {};
    if (d.content) { text += d.content; h.onText?.(d.content); }
    for (const tc of d.tool_calls || []) {
      const idx = tc.index ?? calls.length;
      if (!calls[idx]) { calls[idx] = { id: tc.id || `call_${idx}_${Date.now().toString(36)}`, name: '', args: '' }; }
      if (tc.id) calls[idx].id = tc.id;
      if (tc.function?.name) { calls[idx].name += tc.function.name; h.onToolStart?.(calls[idx].name); }
      if (tc.function?.arguments) calls[idx].args += tc.function.arguments;
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  }
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const c of calls.filter(Boolean)) {
    let input = {};
    let invalid = false;
    try { input = c.args ? JSON.parse(c.args) : {}; } catch { invalid = true; input = { __raw: c.args }; }
    content.push({ type: 'tool_use', id: c.id, name: c.name, input, ...(invalid ? { __invalid: true } : {}) });
  }
  const stopReason = calls.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end_turn';
  return { content, stopReason, usage: usage ? { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens } : null, model, fallbackUsed: false };
}

// ------------------------------------------------------------ public API
/**
 * cfg: { provider, baseUrl, model, apiKey, maxTokens, effort, temperature, serverFallbacks }
 * req: { system, messages, tools, signal }
 * h:   { onText(delta), onToolStart(name), onFallback(block) }
 */
export async function streamChat(cfg, req, h = {}) {
  if (!cfg.model) throw new AIError('还没有选择模型，请到「设置 → AI 连接」填写模型名。');
  try {
    if (cfg.provider === 'anthropic') {
      if (!cfg.apiKey) throw new AIError('还没有填写 Claude 的 API 密钥。');
      return await streamAnthropic(cfg, req, h);
    }
    return await streamOpenAI(cfg, req, h);
  } catch (err) {
    if (err instanceof AIError || err.name === 'AbortError' || err instanceof Anthropic.APIUserAbortError) throw err;
    if (err instanceof Anthropic.APIError) throw new AIError(friendly(err.status, err.error?.error?.message || err.message), errMeta(err.status, err.error?.error?.message || err.message));
    throw new AIError(friendly(0, err.message), { code: CONTEXT_RE.test(String(err.message)) ? 'context' : undefined, retryable: NETWORK_RE.test(String(err.message)) });
  }
}

export const isAbort = (err) => err?.name === 'AbortError' || err instanceof Anthropic.APIUserAbortError;

/** List models offered by an endpoint (for the settings picker). */
export async function listModels(cfg) {
  if (cfg.provider === 'anthropic') {
    const client = anthropicClient(cfg);
    const page = await client.models.list({ limit: 100 });
    return page.data.map((m) => ({ id: m.id, label: m.display_name || m.id }));
  }
  const url = `${(cfg.baseUrl || '').replace(/\/+$/, '')}/models`;
  const res = await net.fetch(url, { headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {} });
  if (!res.ok) throw new AIError(friendly(res.status, await res.text().catch(() => '')));
  const j = await res.json();
  return (j.data || j.models || []).map((m) => ({ id: m.id || m.name, label: m.id || m.name })).filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id));
}

/** One short round-trip to verify settings. */
export async function testConnection(cfg) {
  const t0 = Date.now();
  let text = '';
  const r = await streamChat({ ...cfg, maxTokens: 64, effort: cfg.provider === 'anthropic' ? 'low' : cfg.effort }, {
    system: '你是连接测试助手。', messages: [{ role: 'user', content: [{ type: 'text', text: '请只回复：连接成功' }] }],
  }, { onText: (d) => { text += d; } });
  return { ok: true, ms: Date.now() - t0, model: r.model, text: text.trim().slice(0, 60), fallbackUsed: r.fallbackUsed };
}
