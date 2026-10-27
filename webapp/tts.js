// Text-to-speech with three interchangeable engines behind one speak():
//   robot  - eSpeak (meSpeak), ~5.6 MB, instant, deliberately robotic (Klatt variants are DECtalk-like)
//   system - the phone's built-in voice (speechSynthesis), no download
//   kokoro - Kokoro-82M neural voice, ~92 MB download, natural but slower
// Replies are queued so they never talk over each other.

const MESPEAK = 'https://cdn.jsdelivr.net/npm/mespeak@2.0.2';

export const ENGINES = {
  robot: 'Robot (eSpeak, ~6 MB)',
  system: 'Phone voice (built in)',
  kokoro: 'Natural (Kokoro, ~92 MB)',
};
export const ROBOT_VARIANTS = ['klatt', 'klatt2', 'klatt3', 'm1', 'm3', 'croak', 'f1'];
export const KOKORO_VOICES = { af_heart: 'Heart (US)', af_bella: 'Bella (US)', bf_emma: 'Emma (UK)', bm_george: 'George (UK)' };

const prefs = {
  get: (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

export function createSpeaker({ onSpeakingChange = () => {} } = {}) {
  let audioCtx = null;
  let robot = null;
  let kokoro = null;        // { worker, ready: Promise, pending: Map }
  let chain = Promise.resolve();
  let current = null;       // stops whatever is playing now

  const settings = {
    get engine() { return prefs.get('ttsEngine', 'robot'); },
    set engine(v) { prefs.set('ttsEngine', v); },
    get robotVariant() { return prefs.get('ttsRobotVariant', 'klatt'); },
    set robotVariant(v) { prefs.set('ttsRobotVariant', v); },
    get kokoroVoice() { return prefs.get('ttsKokoroVoice', 'af_heart'); },
    set kokoroVoice(v) { prefs.set('ttsKokoroVoice', v); },
    get kokoroDownloaded() { return prefs.get('ttsKokoroDownloaded', '0') === '1'; },
  };

  // iOS only allows audio after a tap: call this from a click handler before the first speak().
  function unlock() {
    // Without this, iOS treats web audio as "ambient" and the silent switch mutes it.
    if (navigator.audioSession && navigator.audioSession.type === 'auto') navigator.audioSession.type = 'playback';
    audioCtx ??= new AudioContext();
    if (audioCtx.state !== 'running') audioCtx.resume();
    try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch {}
  }

  async function loadRobot() {
    if (robot) return robot;
    const [{ default: meSpeak }, config, voice] = await Promise.all([
      import(`${MESPEAK}/+esm`),
      fetch(`${MESPEAK}/src/mespeak_config.json`).then((r) => r.json()),
      fetch(`${MESPEAK}/voices/en/en-us.json`).then((r) => r.json()),
    ]);
    meSpeak.loadConfig(config);
    meSpeak.loadVoice(voice);
    robot = meSpeak;
    return robot;
  }

  function loadKokoro(onProgress = () => {}) {
    if (kokoro) return kokoro.ready;
    const worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
    const pending = new Map();
    let nextId = 1;
    const ready = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') onProgress(data);
        else if (data.type === 'ready') { prefs.set('ttsKokoroDownloaded', '1'); resolve(); }
        else if (data.type === 'error' && !data.id) reject(new Error(data.message));
        else if (pending.has(data.id)) {
          const { resolve: done, reject: fail } = pending.get(data.id);
          pending.delete(data.id);
          data.type === 'error' ? fail(new Error(data.message)) : done(data);
        }
      };
    });
    kokoro = {
      ready,
      generate: (text, voice) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'generate', id, text, voice });
      }),
    };
    worker.postMessage({ type: 'load' });
    return ready;
  }

  function playBuffer(buffer) {
    return new Promise((resolve) => {
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.onended = resolve;
      current = () => { try { source.stop(); } catch {} resolve(); };
      source.start();
    });
  }

  async function speakNow(text, engine) {
    const startedAt = performance.now();
    if (engine === 'system') {
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.onend = u.onerror = resolve;
        current = () => { speechSynthesis.cancel(); resolve(); };
        speechSynthesis.speak(u);
      });
      return { engine, generateMs: 0 };
    }

    audioCtx ??= new AudioContext();
    let buffer;
    if (engine === 'kokoro') {
      await loadKokoro();
      const { samples, rate } = await kokoro.generate(text, settings.kokoroVoice);
      buffer = audioCtx.createBuffer(1, samples.length, rate);
      buffer.copyToChannel(samples, 0);
    } else {
      const meSpeak = await loadRobot();
      const wav = meSpeak.speak(text, { rawdata: 'arraybuffer', variant: settings.robotVariant, speed: 160 });
      buffer = await audioCtx.decodeAudioData(wav);
    }
    const generateMs = performance.now() - startedAt;
    await playBuffer(buffer);
    return { engine, generateMs, audioSeconds: buffer.duration };
  }

  // Resolves once this text has finished playing; returns timing info for the debug readouts.
  function speak(text, engine = settings.engine) {
    const run = chain.then(async () => {
      onSpeakingChange(true);
      try { return await speakNow(text, engine); } finally { current = null; onSpeakingChange(false); }
    });
    chain = run.catch(() => {});
    return run;
  }

  function stop() { current?.(); }

  return { settings, unlock, loadRobot, loadKokoro, speak, stop };
}
