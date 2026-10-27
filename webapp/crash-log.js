// Diagnostics that survive a crash. iOS kills the tab without warning when it runs out of memory, so
// everything is written to storage as it happens: llama.cpp's own log lines, named stages, JS errors and a
// once-a-second heartbeat. After a crash, the next page load can show how far things got and when it died.

const LOG_KEY = 'localscribe-crashlog';
const STAGE_KEY = 'localscribe-stage';
const ALIVE_KEY = 'localscribe-alive';
const MAX_LINES = 300;

const page = location.pathname.split('/').pop() || 'index.html';
const clock = (ms = Date.now()) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// What the previous page load left behind, captured before this load overwrites it.
const previous = { stage: read(STAGE_KEY, null), alive: read(ALIVE_KEY, null) };
let lines = read(LOG_KEY, []);

export function log(message) {
  lines.push(`${clock()} ${page} ${message}`);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  write(LOG_KEY, lines);
}

// A named step (e.g. "loading model"). Marked 'idle' once a risky step has finished.
export function stage(name) {
  log(`== ${name}`);
  write(STAGE_KEY, { page, name, at: Date.now() });
}

// Pass as wllama's logger so llama.cpp's messages (memory sizes, errors) are kept too.
export const wllamaLogger = Object.fromEntries(['debug', 'log', 'warn', 'error'].map((level) => [level, (...args) => {
  console[level === 'debug' ? 'log' : level](...args);
  log(`llama ${level}: ${args.map(String).join(' ').replace(/\s+/g, ' ').slice(0, 300)}`);
}]));

// True when the last load of this app died in the middle of something (no 'idle' stage after it).
export function previousRunCrashed() {
  return !!previous.stage && previous.stage.name !== 'idle';
}

export function previousRunSummary() {
  if (!previous.stage) return 'No earlier run recorded.';
  const { page: p, name, at } = previous.stage;
  const alive = previous.alive?.at;
  const lastSeen = alive ? `, page last alive at ${clock(alive)} (${((alive - at) / 1000).toFixed(1)}s after that step started)` : '';
  return previousRunCrashed()
    ? `Last run on ${p} stopped during "${name}" (started ${clock(at)})${lastSeen}.`
    : `Last run on ${p} ended normally.`;
}

export async function deviceInfo() {
  const info = [
    `user agent: ${navigator.userAgent}`,
    `cores: ${navigator.hardwareConcurrency ?? '?'} · device memory: ${navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'not reported'}`,
    `screen: ${screen.width}×${screen.height} @${devicePixelRatio}x · standalone (Home Screen app): ${matchMedia('(display-mode: standalone)').matches || navigator.standalone === true}`,
    `WebGPU: ${'gpu' in navigator ? 'present' : 'absent'} · cross-origin isolated (multi-thread): ${self.crossOriginIsolated}`,
  ];
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted?.();
    info.push(`storage: ${(usage / 1e6).toFixed(0)} MB used of ${(quota / 1e6).toFixed(0)} MB allowed · persistent: ${persisted ?? 'unknown'}`);
  } catch { info.push('storage: estimate unavailable'); }
  return info;
}

export const fullLog = () => lines.join('\n');
export function clearLog() { lines = []; write(LOG_KEY, lines); }

// A collapsible diagnostics panel: what happened last time, device info, the log, and Copy / Clear.
export async function mountDiagnostics(container) {
  const crashed = previousRunCrashed();
  const info = await deviceInfo();
  container.innerHTML = '';
  const details = document.createElement('details');
  details.open = crashed;
  const summary = document.createElement('summary');
  summary.className = 'muted';
  summary.textContent = crashed ? '⚠ Diagnostics: the last run crashed (tap Copy and send this)' : 'Diagnostics';
  const last = Object.assign(document.createElement('div'), { textContent: previousRunSummary() });
  last.style.fontWeight = crashed ? '600' : '';
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;font-size:11px;max-height:300px;overflow-y:auto;background:var(--panel);padding:8px;border-radius:6px';
  const render = () => { pre.textContent = [...info, '', ...lines.slice(-120)].join('\n'); };
  render();
  const copy = Object.assign(document.createElement('button'), { className: 'secondary', textContent: 'Copy' });
  copy.onclick = async () => {
    const text = [previousRunSummary(), ...info, '', fullLog()].join('\n');
    try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
  };
  const clear = Object.assign(document.createElement('button'), { className: 'danger', textContent: 'Clear log' });
  clear.onclick = () => { clearLog(); render(); };
  const refresh = Object.assign(document.createElement('button'), { className: 'secondary', textContent: 'Refresh' });
  refresh.onclick = render;
  const row = document.createElement('div');
  row.className = 'row';
  row.append(copy, refresh, clear);
  details.append(summary, last, row, pre);
  container.append(details);
}

// ---- Always on, from the moment a page imports this ----
window.addEventListener('error', (e) => log(`JS error: ${e.message} at ${e.filename?.split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => log(`unhandled promise rejection: ${e.reason?.message ?? e.reason}`));
document.addEventListener('visibilitychange', () => log(`page ${document.visibilityState}`));
// A normal close/navigation fires pagehide; an out-of-memory kill doesn't, so only real crashes stay flagged.
window.addEventListener('pagehide', () => { log('page closed or navigated away'); write(STAGE_KEY, { page, name: 'idle', at: Date.now() }); });
log(`page opened (${previousRunCrashed() ? 'PREVIOUS RUN CRASHED' : 'previous run ok'})`);
stage('idle');
setInterval(() => write(ALIVE_KEY, { page, at: Date.now() }), 1000);
