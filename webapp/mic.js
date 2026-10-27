// Always-on speech input: microphone → voice activity detection → Whisper (in a worker) → text.
// Each transcribed segment reports when speech started and ended (Date.now() ms), so callers can timestamp words.

const TARGET_RATE = 16000;        // Whisper expects 16 kHz mono
const SILENCE_TO_END_MS = 800;    // a pause this long ends a segment
const MIN_SPEECH_MS = 300;        // ignore clicks and bumps
const MAX_SEGMENT_MS = 20000;     // force a cut during long monologues
const PREROLL_MS = 300;           // keep a little audio from before speech was detected

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function resampleTo16k(chunks, fromRate) {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(length);
  let offset = 0;
  for (const c of chunks) { input.set(c, offset); offset += c.length; }

  const ratio = fromRate / TARGET_RATE;
  const output = new Float32Array(Math.floor(length / ratio));
  for (let i = 0; i < output.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, length - 1);
    output[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return output;
}

// Whisper invents text like "[BLANK_AUDIO]" or "(wind blowing)" for non-speech; drop those.
const cleanTranscript = (text) => text.replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

// onText({ text, startAt, endAt, seconds, transcribeMs }), onStatus(string), onProgress(fraction, loadedBytes, totalBytes), onReady()
export function createSpeechInput({ onText = () => {}, onStatus = () => {}, onProgress = () => {}, onReady = () => {} } = {}) {
  const worker = new Worker(new URL('./voice-worker.js?v=__V__', import.meta.url), { type: 'module' });
  let ready = false;
  let muted = false;
  let suppressed = false;   // true while the phone is talking, so it doesn't transcribe itself
  let stream = null;
  let audioCtx = null;
  let analyser = null;

  // ---- Whisper ----
  const queue = [];         // { audio, startAt, endAt }
  let busy = null;          // the segment currently being transcribed
  const fileProgress = new Map();

  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      fileProgress.set(data.file, data);
      const loaded = [...fileProgress.values()].reduce((s, p) => s + (p.loaded ?? 0), 0);
      const total = [...fileProgress.values()].reduce((s, p) => s + (p.total ?? 0), 0);
      onProgress(total ? loaded / total : 0, loaded, total);
    } else if (data.type === 'ready') {
      ready = true;
      onReady();
      processQueue();
    } else if (data.type === 'result') {
      const { startAt, endAt } = busy;
      busy = null;
      const text = cleanTranscript(data.text);
      if (text) onText({ text, startAt, endAt, seconds: data.seconds, transcribeMs: data.ms });
      processQueue();
    } else if (data.type === 'error') {
      busy = null;
      onStatus(`Whisper error: ${data.message}`);
      processQueue();
    }
  };
  worker.postMessage({ type: 'load' });

  function processQueue() {
    if (!ready || busy || queue.length === 0) return;
    busy = queue.shift();
    onStatus('Transcribing…');
    const audio = busy.audio;
    busy.audio = null;
    worker.postMessage({ type: 'transcribe', audio }, [audio.buffer]);
  }

  // ---- Voice activity detection: energy above an adaptive noise floor ----
  let noiseFloor = 0.005;
  let segment = null;       // chunks of the speech currently being captured
  let segmentStartAt = 0;
  let preroll = [];
  let speechMs = 0;
  let silenceMs = 0;

  function onAudioChunk(samples, rate) {
    if (muted || suppressed) return;
    const chunkMs = (samples.length / rate) * 1000;
    const level = rms(samples);
    const isSpeech = level > Math.max(0.01, noiseFloor * 3);
    // Track background noise only when nobody is talking, so the threshold adapts to the room.
    if (!isSpeech) noiseFloor = noiseFloor * 0.95 + level * 0.05;

    if (!segment) {
      preroll.push(samples);
      while (preroll.length * chunkMs > PREROLL_MS) preroll.shift();
      if (isSpeech) {
        segment = [...preroll];
        segmentStartAt = Date.now() - preroll.length * chunkMs;
        preroll = [];
        speechMs = chunkMs;
        silenceMs = 0;
      }
      return;
    }

    segment.push(samples);
    if (isSpeech) { speechMs += chunkMs; silenceMs = 0; } else { silenceMs += chunkMs; }

    if (silenceMs >= SILENCE_TO_END_MS || segment.length * chunkMs >= MAX_SEGMENT_MS) {
      if (speechMs >= MIN_SPEECH_MS) {
        queue.push({ audio: resampleTo16k(segment, rate), startAt: segmentStartAt, endAt: Date.now() - silenceMs });
        processQueue();
      }
      segment = null;
    }
  }

  const dropSegment = () => { segment = null; preroll = []; };

  // Must be called from a tap (iOS requirement). Resolves false if the microphone is unavailable.
  async function start() {
    // Recording and playback in the same session (otherwise iOS may route replies to the earpiece or mute them).
    if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      onStatus(`Microphone unavailable: ${e?.message ?? e}`);
      return false;
    }

    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    // ScriptProcessorNode is deprecated but is the simplest capture path that works in every Safari version.
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => onAudioChunk(new Float32Array(e.inputBuffer.getChannelData(0)), audioCtx.sampleRate);
    source.connect(processor);
    processor.connect(audioCtx.destination); // outputs silence; needed for the node to run

    // iOS suspends audio when the app is backgrounded; pick it back up on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && audioCtx.state !== 'running') audioCtx.resume();
    });
    return true;
  }

  function setMuted(value) {
    muted = value;
    stream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    dropSegment();
  }

  function setSuppressed(value) {
    suppressed = value;
    if (value) dropSegment();
  }

  // Loudness 0..1 on a rough log scale so quiet speech still visibly moves a meter.
  function level() {
    if (!analyser || muted) return 0;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return Math.min(1, Math.max(0, (20 * Math.log10(rms(samples) + 1e-6) + 55) / 40));
  }

  return {
    start,
    setMuted,
    setSuppressed,
    level,
    get muted() { return muted; },
    get ready() { return ready; },
    // True while the user is mid-utterance or audio is still waiting to be transcribed.
    get hearing() { return segment !== null || busy !== null || queue.length > 0; },
  };
}

// Animated sound-wave bars driven by input.level(); bars stay flat while muted.
export function animateWave(bars, input) {
  const BAR_SHAPE = [0.5, 0.8, 1, 0.8, 0.5]; // middle bars taller
  let smoothed = 0;
  (function frame() {
    smoothed = smoothed * 0.6 + input.level() * 0.4;
    bars.forEach((bar, i) => {
      const jitter = 0.85 + Math.random() * 0.3;
      bar.style.height = `${4 + smoothed * 36 * BAR_SHAPE[i % BAR_SHAPE.length] * jitter}px`;
    });
    requestAnimationFrame(frame);
  })();
}
