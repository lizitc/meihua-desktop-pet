// Tool registry shared by the companion chat and the director. Every model-supplied
// input is validated against the tool's JSON schema before the handler runs.

const registry = new Map();

/**
 * def: { name, description, input_schema, handler(input, ctx), label?(input) -> string,
 *        confirm?(input, ctx) -> null | { title, body, code? }, group?, hidden? }
 */
export function registerTool(def) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(def.name)) throw new Error(`bad tool name ${def.name}`);
  registry.set(def.name, def);
}

export function unregisterTool(name) { registry.delete(name); }
export function unregisterGroup(group) { for (const [k, v] of registry) if (v.group === group) registry.delete(k); }
export const getTool = (name) => registry.get(name);
export const listTools = () => [...registry.values()];

/** Tool specs for a model request. */
export function toolSpecs(filter = () => true) {
  return listTools().filter((t) => !t.hidden && filter(t)).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

// ------------------------------------------------------------ minimal JSON-schema validation
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function check(schema, v, path, errs) {
  if (!schema || errs.length > 6) return;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : null;
  if (types) {
    const t = typeOf(v);
    const ok = types.some((x) => x === t || (x === 'number' && t === 'integer'));
    if (!ok) { errs.push(`${path || '输入'} 应为 ${types.join('|')}，实际为 ${t}`); return; }
  }
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${path} 必须是 ${schema.enum.join(' / ')} 之一`);
  if (typeof v === 'string') {
    if (schema.maxLength && v.length > schema.maxLength) errs.push(`${path} 过长（>${schema.maxLength}）`);
    if (schema.minLength && v.length < schema.minLength) errs.push(`${path} 过短`);
  }
  if (typeof v === 'number') {
    if (schema.minimum != null && v < schema.minimum) errs.push(`${path} 不能小于 ${schema.minimum}`);
    if (schema.maximum != null && v > schema.maximum) errs.push(`${path} 不能大于 ${schema.maximum}`);
  }
  if (Array.isArray(v)) {
    if (schema.maxItems && v.length > schema.maxItems) errs.push(`${path} 项数过多`);
    if (schema.items) v.forEach((x, i) => check(schema.items, x, `${path}[${i}]`, errs));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const r of schema.required || []) if (v[r] === undefined) errs.push(`缺少字段 ${path ? path + '.' : ''}${r}`);
    for (const [k, sub] of Object.entries(schema.properties || {})) if (v[k] !== undefined) check(sub, v[k], path ? `${path}.${k}` : k, errs);
  }
}

export function validate(schema, input) {
  const errs = [];
  check(schema, input, '', errs);
  return errs;
}

/**
 * Run one tool_use block. Returns a tool_result content block. ctx carries
 * { approve(request) -> Promise<boolean>, source, signal, turnId, emit }.
 */
export async function runTool(block, ctx) {
  const tool = registry.get(block.name);
  const fail = (msg) => ({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: msg });
  if (!tool) return fail(`没有名为 ${block.name} 的工具。`);
  if (block.__invalid) return fail(JSON.stringify({ INVALID_JSON: String(block.input?.__raw ?? '').slice(0, 400) }));
  const input = block.input ?? {};
  const errs = validate(tool.input_schema, input);
  if (errs.length) return fail(`参数不合法：${errs.join('；')}`);
  try {
    const need = tool.confirm?.(input, ctx);
    if (need) {
      const ok = await ctx.approve({ ...need, tool: tool.name, input });
      if (!ok) return fail('主人拒绝了这个操作。');
    }
    const out = await tool.handler(input, ctx);
    const text = typeof out === 'string' ? out : JSON.stringify(out ?? { ok: true });
    return { type: 'tool_result', tool_use_id: block.id, content: text.length > 60000 ? text.slice(0, 60000) + '\n…（已截断）' : text };
  } catch (err) {
    return fail(`执行失败：${err?.message || err}`);
  }
}

export function toolLabel(block) {
  const t = registry.get(block.name);
  try { return t?.label?.(block.input || {}) || t?.title || block.name; } catch { return block.name; }
}
