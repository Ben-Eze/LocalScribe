// Runs Kokoro off the main thread so generating speech doesn't freeze the page.
import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';

let tts = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try {
      tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
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
  } else if (data.type === 'generate') {
    try {
      const audio = await tts.generate(data.text, { voice: data.voice });
      self.postMessage({ type: 'audio', id: data.id, samples: audio.audio, rate: audio.sampling_rate }, [audio.audio.buffer]);
    } catch (e) {
      self.postMessage({ type: 'error', id: data.id, message: String(e?.message ?? e) });
    }
  }
};
