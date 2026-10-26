// Runs Whisper off the main thread so the UI and sound-wave animation stay smooth while transcribing.
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

const MODEL = 'onnx-community/whisper-tiny.en';
let transcriber = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try {
      transcriber = await pipeline('automatic-speech-recognition', MODEL, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
        },
      });
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: String(e?.message ?? e) });
    }
  } else if (data.type === 'transcribe') {
    const startedAt = performance.now();
    try {
      const { text } = await transcriber(data.audio);
      self.postMessage({ type: 'result', text, ms: performance.now() - startedAt, seconds: data.audio.length / 16000 });
    } catch (e) {
      self.postMessage({ type: 'error', message: String(e?.message ?? e) });
    }
  }
};
