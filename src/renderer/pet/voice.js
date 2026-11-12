// Voice output (queued TTS clips or the system voice) with a mouth level for lip-sync,
// plus push-to-talk microphone capture handed to the main process for transcription.
export class Voice {
  constructor(api) {
    this.api = api;
    this.queue = [];
    this.playing = null;
    this.ctx = null;
    this.analyser = null;
    this.buf = null;
    this.level = 0;
    this.sysPulse = 0;
    this.volume = 0.9;
    api.on('tts:audio', (item) => this.enqueue({ kind: 'audio', ...item }));
    api.on('tts:system', (item) => this.enqueue({ kind: 'system', ...item }));
    api.on('tts:stop', () => this.stop());
  }

  #ensureCtx() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.gain = this.ctx.createGain();
    this.analyser.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.buf = new Float32Array(this.analyser.fftSize);
  }

  enqueue(item) {
    if (item.interrupt) this.stop();
    this.queue.push(item);
    if (!this.playing) this.#next();
  }

  get busy() { return !!this.playing || this.queue.length > 0; }

  async #next() {
    const item = this.queue.shift();
    if (!item) { this.playing = null; return; }
    this.playing = item;
    try {
      if (item.kind === 'audio') await this.#playAudio(item);
      else await this.#playSystem(item);
    } catch (err) {
      console.warn('[voice]', err);
    }
    if (this.playing === item) { this.playing = null; this.#next(); }
  }

  async #playAudio(item) {
    this.#ensureCtx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`音频获取失败 ${res.status}`);
    const data = await res.arrayBuffer();
    const audio = await this.ctx.decodeAudioData(data);
    if (this.playing !== item) return;
    const src = this.ctx.createBufferSource();
    src.buffer = audio;
    src.connect(this.analyser);
    this.gain.gain.value = item.volume ?? this.volume;
    item.stop = () => { try { src.stop(); } catch { /* already stopped */ } };
    await new Promise((resolve) => { src.onended = resolve; src.start(); });
  }

  #playSystem(item) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(item.text);
      u.lang = 'zh-CN';
      u.rate = item.rate ?? 1;
      u.volume = item.volume ?? this.volume;
      u.pitch = 1.15;
      const voices = speechSynthesis.getVoices();
      const v = (item.voice && voices.find((x) => x.name === item.voice)) || voices.find((x) => /Xiaoxiao|Xiaoyi|Huihui|Yaoyao|zh-CN/i.test(x.name + x.lang));
      if (v) u.voice = v;
      u.onboundary = () => { this.sysPulse = 1; };
      u.onstart = () => { this.sysPulse = 1; };
      u.onend = resolve;
      u.onerror = resolve;
      item.stop = () => speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  stop() {
    this.queue.length = 0;
    const p = this.playing;
    this.playing = null;
    p?.stop?.();
    if (speechSynthesis.speaking) speechSynthesis.cancel();
  }

  /** Smoothed mouth opening 0..1, call once per frame. */
  update(dt) {
    let target = 0;
    if (this.playing?.kind === 'audio' && this.analyser) {
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      const rms = Math.sqrt(sum / this.buf.length);
      target = Math.min(1, Math.max(0, (rms - 0.012) * 7));
    } else if (this.playing?.kind === 'system') {
      this.sysPulse = Math.max(0, this.sysPulse - dt * 3.2);
      const t = performance.now() / 1000;
      target = 0.25 + 0.45 * Math.abs(Math.sin(t * 11)) * (0.5 + 0.5 * this.sysPulse);
    }
    const k = target > this.level ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 14);
    this.level += (target - this.level) * k;
    return this.level;
  }

  // ------------------------------------------------------------ microphone
  async startRecording() {
    if (this.rec) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true } });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    this.rec = { rec, stream, chunks, started: performance.now() };
    rec.start(250);
  }

  async stopRecording() {
    const r = this.rec;
    if (!r) return '';
    this.rec = null;
    await new Promise((resolve) => { r.rec.onstop = resolve; r.rec.stop(); });
    for (const t of r.stream.getTracks()) t.stop();
    if (performance.now() - r.started < 400) return '';
    const blob = new Blob(r.chunks, { type: 'audio/webm' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return this.api.invoke('stt.transcribe', bytes, 'audio/webm');
  }

  get recording() { return !!this.rec; }
}
