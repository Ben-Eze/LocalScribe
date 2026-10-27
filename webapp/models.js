// LLMs offered on page 1 and used by the agent on page 4.
export const WLLAMA = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm';

export const MODELS = [
  // Qwen3 "thinks" before answering by default; /no_think turns that off for quick replies.
  { id: 'qwen06b', label: 'Qwen3 0.6B · Q4_K_M · 397 MB · DEFAULT', repo: 'unsloth/Qwen3-0.6B-GGUF', file: 'Qwen3-0.6B-Q4_K_M.gguf', promptSuffix: ' /no_think' },
  { id: 'gemma1b', label: 'Gemma 3 1B · Q4_K_M · 806 MB', repo: 'ggml-org/gemma-3-1b-it-GGUF', file: 'gemma-3-1b-it-Q4_K_M.gguf' },
  { id: 'gemma270m', label: 'Gemma 3 270M · Q8_0 · 292 MB', repo: 'ggml-org/gemma-3-270m-it-GGUF', file: 'gemma-3-270m-it-Q8_0.gguf' },
];

export const AGENT_MODEL = MODELS[0]; // the agent's prompt format and option tokens are built for Qwen3

export const urlOf = (m) => `https://huggingface.co/${m.repo}/resolve/main/${m.file}`;
