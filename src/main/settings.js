// Settings with defaults + deep merge, change notifications, and encrypted secrets
// (API keys are stored with Electron safeStorage / Windows DPAPI, never in settings.json).
import { safeStorage } from 'electron';
import { JsonStore } from './store.js';
import { dataFile } from './paths.js';
import { bus } from './bus.js';

export const DEFAULTS = {
  version: 2,
  onboarded: false,
  user: { callName: '主人', name: '', birthday: '', about: '' },
  pet: {
    visible: true, scale: 0.36, alwaysOnTop: true, allowWander: true, lockPosition: false, gravity: true,
    gaze: true, autoSleepMinutes: 15, reactions: true, position: null, quiet: false,
    bounce: true, idleActs: true,
  },
  ai: {
    provider: 'openai', preset: 'openai', baseUrl: 'https://api.openai.com/v1', model: '',
    temperature: 0.8, maxTokens: 2048, effort: 'low', historyLimit: 60,
    autonomy: 'normal', proactive: true, touchReplies: true, serverFallbacks: true,
    persona: '', // custom character card (system prompt); '' = the built-in one from persona.js
    agent: { sameAsChat: true, provider: 'openai', preset: 'openai', baseUrl: '', model: '', effort: 'high', maxTokens: 8192 },
  },
  tts: {
    enabled: false, autoSpeak: true, provider: 'system', volume: 0.9, rate: 1.0,
    system: { voice: '' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'nova', instructions: '用温柔、可爱、略带害羞的少女语气说话。' },
    sovits: { baseUrl: 'http://127.0.0.1:9880', refAudioPath: '', promptText: '', promptLang: 'zh', textLang: 'zh', speedFactor: 1.0 },
    azure: { region: 'eastasia', voice: 'zh-CN-XiaoyiNeural', style: 'gentle' },
    custom: { url: '', method: 'POST', headers: '{"Content-Type":"application/json"}', body: '{"text":"{text}"}' },
  },
  stt: { enabled: false, baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', language: 'zh' },
  planner: {
    morningBrief: { enabled: true, time: '08:30' },
    eveningReview: { enabled: false, time: '21:30' },
    sedentary: { enabled: true, minutes: 60 },
    water: { enabled: false, minutes: 90 },
    bedtime: { enabled: true, time: '23:30' },
    quietHours: { enabled: true, start: '00:30', end: '07:30' },
    defaultRemind: 10,
    systemNotifications: true,
  },
  agent: { workspaceRoot: '', permission: 'ask', maxSteps: 200, commandTimeout: 300 },
  app: { launchAtLogin: false, theme: 'system', hotkeys: { toggle: 'Ctrl+Alt+M', chat: 'Ctrl+Alt+J', panel: 'Ctrl+Alt+H' } },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = isObj(v) && isObj(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}
function diffKeys(a, b, prefix = '', out = []) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isObj(a?.[k]) && isObj(b?.[k])) diffKeys(a[k], b[k], p, out);
    else if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out.push(p);
  }
  return out;
}

class Settings {
  constructor() {
    this.store = new JsonStore(dataFile('settings.json'), {});
    this.data = deepMerge(DEFAULTS, this.store.data);
    this.secretStore = new JsonStore(dataFile('secrets.json'), {});
    this.#migrate();
  }

  #migrate() {
    const d = this.data;
    if ((d.version || 1) < 2) {
      // v1 saved its defaults wholesale; the old step budget stopped long workshop tasks halfway
      if (d.agent?.maxSteps === 80) d.agent.maxSteps = 200;
      if (d.agent?.commandTimeout === 180) d.agent.commandTimeout = 300;
      d.version = 2;
      if (Object.keys(this.store.data).length) { this.store.data = d; this.store.save(); }
    }
  }

  get(path) {
    if (!path) return this.data;
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data);
  }

  patch(patch) {
    const before = this.data;
    this.data = deepMerge(this.data, patch);
    const changed = diffKeys(before, this.data);
    if (!changed.length) return this.data;
    this.store.data = this.data;
    this.store.save();
    bus.emit('settings:changed', { changed, settings: this.data });
    return this.data;
  }

  set(path, value) {
    const keys = path.split('.');
    const patch = {};
    keys.reduce((o, k, i) => (o[k] = i === keys.length - 1 ? value : {}), patch);
    return this.patch(patch);
  }

  // ---- secrets
  setSecret(name, value) {
    if (!value) { delete this.secretStore.data[name]; this.secretStore.save(); return; }
    const enc = safeStorage.isEncryptionAvailable() ? 'dpapi:' + safeStorage.encryptString(value).toString('base64') : 'plain:' + Buffer.from(value).toString('base64');
    this.secretStore.data[name] = enc;
    this.secretStore.save();
    bus.emit('settings:changed', { changed: [`secret.${name}`], settings: this.data });
  }

  getSecret(name) {
    const v = this.secretStore.data[name];
    if (!v) return '';
    try {
      if (v.startsWith('dpapi:')) return safeStorage.decryptString(Buffer.from(v.slice(6), 'base64'));
      if (v.startsWith('plain:')) return Buffer.from(v.slice(6), 'base64').toString();
    } catch (err) { console.error('[settings] secret decrypt failed', name, err.message); }
    return '';
  }

  hasSecret(name) { return !!this.secretStore.data[name]; }

  /** Public view for renderers: secrets reduced to booleans. */
  publicView() {
    return { ...this.data, secrets: Object.fromEntries(Object.keys(this.secretStore.data).map((k) => [k, true])) };
  }

  flush() { this.store.flush(); this.secretStore.flush(); }
}

export const settings = new Settings();
