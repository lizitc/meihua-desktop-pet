// Text-to-speech. Providers: system voice (spoken by the character window), OpenAI-
// compatible /audio/speech, GPT-SoVITS (api v2), Azure Speech, or a custom HTTP template.
// Synthesized clips are served to the character window via meihua://app/user/tts/…
import { net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../settings.js';
import { userDir } from '../paths.js';
import { rpc, broadcast } from '../bus.js';
import { uid } from '../store.js';

const ttsDir = () => userDir('public', 'tts');

/** Remove markdown, code, links, emoji and stage directions before speaking. */
export function speakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#>|~]+/g, '')
    .replace(/（[^）]{0,12}）|\([^)]{0,12}\)/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function synthOpenAI(text, c) {
  const key = settings.getSecret('tts.openai') || settings.getSecret('ai.key.openai');
  const res = await net.fetch(`${c.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: c.model, voice: c.voice, input: text, response_format: 'mp3', ...(c.instructions && /tts/.test(c.model) ? { instructions: c.instructions } : {}), speed: settings.get('tts.rate') || 1 }),
  });
  if (!res.ok) throw new Error(`语音合成失败（${res.status}）：${(await res.text()).slice(0, 160)}`);
  return { buf: Buffer.from(await res.arrayBuffer()), ext: 'mp3' };
}

async function synthSovits(text, c) {
  const res = await net.fetch(`${c.baseUrl.replace(/\/+$/, '')}/tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, text_lang: c.textLang || 'zh', ref_audio_path: c.refAudioPath, prompt_text: c.promptText, prompt_lang: c.promptLang || 'zh', speed_factor: c.speedFactor || 1, media_type: 'wav', streaming_mode: false, text_split_method: 'cut5' }),
  });
  if (!res.ok) throw new Error(`GPT-SoVITS 合成失败（${res.status}）：${(await res.text()).slice(0, 160)}`);
  return { buf: Buffer.from(await res.arrayBuffer()), ext: 'wav' };
}

const xml = (s) => s.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));

async function synthAzure(text, c) {
  const key = settings.getSecret('tts.azure');
  if (!key) throw new Error('还没有填写 Azure 语音密钥');
  const rate = Math.round(((settings.get('tts.rate') || 1) - 1) * 100);
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN"><voice name="${xml(c.voice)}">${c.style ? `<mstts:express-as style="${xml(c.style)}">` : ''}<prosody rate="${rate}%">${xml(text)}</prosody>${c.style ? '</mstts:express-as>' : ''}</voice></speak>`;
  const res = await net.fetch(`https://${c.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'MeihuaDesktop' },
    body: ssml,
  });
  if (!res.ok) throw new Error(`Azure 语音合成失败（${res.status}）`);
  return { buf: Buffer.from(await res.arrayBuffer()), ext: 'mp3' };
}

async function synthCustom(text, c) {
  const fill = (s) => String(s || '').replaceAll('{text}', JSON.stringify(text).slice(1, -1));
  let headers = {};
  try { headers = JSON.parse(c.headers || '{}'); } catch { throw new Error('自定义 TTS 的 Headers 不是合法 JSON'); }
  const secret = settings.getSecret('tts.custom');
  for (const k of Object.keys(headers)) headers[k] = String(headers[k]).replaceAll('{key}', secret);
  const res = await net.fetch(fill(c.url).replace(/\{text\}/g, encodeURIComponent(text)), { method: c.method || 'POST', headers, body: c.method === 'GET' ? undefined : fill(c.body) });
  if (!res.ok) throw new Error(`自定义 TTS 失败（${res.status}）`);
  const type = res.headers.get('content-type') || '';
  return { buf: Buffer.from(await res.arrayBuffer()), ext: /wav/.test(type) ? 'wav' : 'mp3' };
}

export async function synthesize(text) {
  const t = settings.get('tts');
  const c = t[t.provider];
  if (t.provider === 'openai') return synthOpenAI(text, c);
  if (t.provider === 'sovits') return synthSovits(text, c);
  if (t.provider === 'azure') return synthAzure(text, c);
  if (t.provider === 'custom') return synthCustom(text, c);
  return null;
}

let cleanTimer = null;
function scheduleClean() {
  clearTimeout(cleanTimer);
  cleanTimer = setTimeout(() => {
    try {
      const dir = ttsDir();
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }); }
    } catch { /* ignore */ }
  }, 60 * 1000);
}

/** Speak one utterance now (interrupting=false queues after the current one). */
export async function speak(text, { interrupt = false } = {}) {
  const t = settings.get('tts');
  const clean = speakable(text);
  if (!clean) return;
  if (t.provider === 'system') { broadcast('tts:system', { text: clean, voice: t.system.voice, rate: t.rate, volume: t.volume, interrupt }); return; }
  const out = await synthesize(clean);
  if (!out) return;
  const name = `${uid('v')}.${out.ext}`;
  fs.writeFileSync(path.join(ttsDir(), name), out.buf);
  broadcast('tts:audio', { url: `meihua://app/user/tts/${name}`, volume: t.volume, interrupt });
  scheduleClean();
}

/**
 * Sentence-level streaming speaker for one reply: push text deltas, it synthesizes
 * complete sentences in order while the model keeps writing.
 */
export function createSpeaker() {
  let buf = '';
  let chain = Promise.resolve();
  let cancelled = false;
  let inCode = false;
  const enqueue = (s) => {
    const clean = speakable(s);
    if (!clean || clean.length < 2) return;
    chain = chain.then(() => (cancelled ? null : speak(clean))).catch((err) => console.warn('[tts]', err.message));
  };
  return {
    push(delta) {
      if (cancelled) return;
      buf += delta;
      for (;;) {
        if (inCode) { const e = buf.indexOf('```'); if (e < 0) return; buf = buf.slice(e + 3); inCode = false; continue; }
        const f = buf.indexOf('```');
        // first sentence boundary that leaves a reasonably long chunk (short ones merge)
        const re = /[。！？!?…~～\n]+/g;
        let m, cut = -1;
        while ((m = re.exec(buf))) { const end = m.index + m[0].length; if (end >= 8) { cut = end; break; } }
        if (f >= 0 && (cut < 0 || f < cut)) { enqueue(buf.slice(0, f)); buf = buf.slice(f + 3); inCode = true; continue; }
        if (cut < 0) return;
        enqueue(buf.slice(0, cut));
        buf = buf.slice(cut);
      }
    },
    flush() { if (!inCode) enqueue(buf); buf = ''; },
    cancel() { cancelled = true; broadcast('tts:stop'); },
  };
}

export function ttsActive() {
  const t = settings.get('tts');
  return !!t.enabled && !!t.autoSpeak;
}

export function registerTtsRpc() {
  rpc('tts.test', async (text) => { await speak(text || '主人好呀，我是莓华。今天也请多多关照～', { interrupt: true }); return true; });
  rpc('tts.stop', () => broadcast('tts:stop'));
}
