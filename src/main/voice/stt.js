// Speech-to-text through an OpenAI-compatible /audio/transcriptions endpoint
// (OpenAI Whisper / gpt-4o-transcribe, SiliconFlow SenseVoice, local faster-whisper servers…).
import { net } from 'electron';
import { settings } from '../settings.js';
import { rpc } from '../bus.js';

export async function transcribe(bytes, mime = 'audio/webm') {
  const s = settings.get('stt');
  if (!s.enabled) throw new Error('语音输入未开启（设置 → 语音）');
  const key = settings.getSecret('stt') || settings.getSecret('ai.key.openai');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), 'speech.webm');
  form.append('model', s.model || 'whisper-1');
  if (s.language) form.append('language', s.language);
  const res = await net.fetch(`${(s.baseUrl || '').replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST', headers: key ? { Authorization: `Bearer ${key}` } : {}, body: form,
  });
  if (!res.ok) throw new Error(`语音识别失败（${res.status}）：${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return String(j.text || '').trim();
}

export function registerSttRpc() {
  rpc('stt.transcribe', (bytes, mime) => transcribe(Buffer.from(bytes), mime));
}
