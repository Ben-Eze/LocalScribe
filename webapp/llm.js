// The model side of an agent: turns an observation into a choice (one option token) or written text.
import { Wllama } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/index.js';
import { AGENT_MODEL, WLLAMA, urlOf } from './models.js?v=__V__';
import { toText } from './agent-ui.js?v=__V__';

// Qwen3 chat format with thinking switched off (an empty think block).
const chatPrompt = (system, user, assistantStart = '') =>
  `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n${assistantStart}`;

// What precedes an option token in a real prompt; the token check on page 3 tokenizes names after this.
export const CHOICE_CONTEXT = '</think>\n\n[';

export function createAgentModel() {
  const wllama = new Wllama({ default: `${WLLAMA}/wasm/wllama.wasm` });

  const isDownloaded = async () => (await wllama.cacheManager.open(urlOf(AGENT_MODEL)).catch(() => null)) !== null;

  let useGpu = false;
  try { useGpu = localStorage.getItem('gpu') === '1'; } catch {} // the "Use GPU" choice from page 1

  function load(onProgress = () => {}) {
    return wllama.loadModelFromHF({ repo: AGENT_MODEL.repo, file: AGENT_MODEL.file }, {
      n_ctx: 2048,
      // Two slots sharing one KV cache: the listener and the notes agent alternate, and each keeps its own
      // cached prompt prefix instead of evicting the other's (reading the prompt is the slow part).
      n_parallel: 2,
      kv_unified: true,
      n_gpu_layers: useGpu ? 99 : 0,
      progressCallback: ({ loaded, total }) => onProgress(total ? loaded / total : 0),
    });
  }

  // Picks the most probable option. A grammar restricts the next token to the option names, and
  // post-sampling probabilities give the distribution over just those options.
  async function choose(system, obs) {
    const text = toText(obs);
    const user = text.slice(0, text.lastIndexOf('[')).trimEnd(); // the prompt's trailing "[" moves into the reply
    const names = obs.options.map((o) => o.name);
    const startedAt = performance.now();
    const res = await wllama.createCompletion({
      prompt: chatPrompt(system, user, '['),
      max_tokens: 1,
      grammar: `root ::= ${names.map((n) => JSON.stringify(n)).join(' | ')}`,
      // Plain softmax (no truncation) so the probabilities are the model's own, restricted to the options.
      temperature: 1, top_k: 0, top_p: 1, min_p: 0,
      n_probs: names.length,
      logprobs: names.length,
      post_sampling_probs: true,
      cache_prompt: true,
    });
    const top = res.choices[0].logprobs?.content?.[0]?.top_probs ?? [];
    const probs = Object.fromEntries(names.map((n) => [n, 0]));
    for (const t of top) if (t.token in probs) probs[t.token] = t.prob;
    const name = names.reduce((best, n) => (probs[n] > probs[best] ? n : best), names[0]);
    return { name, probs, ms: performance.now() - startedAt, promptTokens: res.timings?.prompt_n, cachedTokens: res.timings?.cache_n };
  }

  // Free text for write mode; ends at the first newline (the escape) or the token limit.
  // The reply opens with a quote mark so the model writes just the text (not a copy of the log's
  // "[add] wrote ..." lines), and the closing quote ends it.
  async function write(system, obs) {
    const startedAt = performance.now();
    const res = await wllama.createCompletion({
      prompt: chatPrompt(system, toText(obs).trimEnd(), '"'),
      max_tokens: obs.write.maxTokens,
      stop: ['"', '\n', '<|im_end|>'],
      temperature: 0.2,
      cache_prompt: true,
    });
    return { text: res.choices[0].text.trim(), ms: performance.now() - startedAt, promptTokens: res.timings?.prompt_n, cachedTokens: res.timings?.cache_n };
  }

  return { isDownloaded, load, choose, write, get usingGpu() { return useGpu && wllama.isSupportWebGPU(); } };
}
