// Resolve the effective model configuration (chat / agent) including the API key.
import { settings } from '../settings.js';
import { PRESETS } from './providers.js';

export const keyName = (preset) => `ai.key.${preset || 'custom'}`;

export function aiConfig(kind = 'chat') {
  const ai = settings.get('ai');
  const src = kind === 'agent' && !ai.agent?.sameAsChat ? ai.agent : ai;
  const preset = src.preset || 'custom';
  const p = PRESETS[preset] || PRESETS.custom;
  const provider = src.provider || p.provider;
  // Claude streams long outputs fine; 8k cut whole-file writes in half and made workshop turns fail
  const agentMax = ai.agent?.maxTokens || 8192;
  return {
    kind,
    preset,
    provider,
    baseUrl: src.baseUrl ?? p.baseUrl,
    model: src.model || p.model || '',
    apiKey: settings.getSecret(keyName(preset)),
    noKey: !!p.noKey,
    temperature: ai.temperature,
    maxTokens: kind === 'agent' ? (provider === 'anthropic' ? Math.max(agentMax, 32000) : agentMax) : (ai.maxTokens || 2048),
    effort: kind === 'agent' ? (ai.agent?.effort || 'high') : (ai.effort || 'low'),
    serverFallbacks: ai.serverFallbacks !== false,
  };
}

export function isConfigured(kind = 'chat') {
  const c = aiConfig(kind);
  return !!c.model && (!!c.apiKey || c.noKey || (c.provider === 'openai' && /127\.0\.0\.1|localhost/.test(c.baseUrl || '')));
}
