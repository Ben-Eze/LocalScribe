// The permanent record of everything said on page 4, kept separately from (and before) anything the agent does.
// Each session holds speech segments as Whisper produced them, plus what the agent did with each request,
// so a later review can recover anything the live agent missed.

const KEY = 'localscribe-transcripts';

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; } };
// Returns false if the write failed (e.g. storage full) so the page can warn instead of silently losing speech.
const save = (sessions) => { try { localStorage.setItem(KEY, JSON.stringify(sessions)); return true; } catch { return false; } };

function append(sessionId, entry) {
  const sessions = load();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return false;
  session.entries.push(entry);
  return save(sessions);
}

export function startSession() {
  const sessions = load();
  const session = { id: Date.now(), startedAt: Date.now(), entries: [] };
  sessions.push(session);
  return save(sessions) ? session.id : null;
}

// echo: true marks speech that looks like the agent's own reply picked up by the mic (kept, not discarded).
export const addSpeech = (sessionId, { text, startAt, endAt, echo = false }) =>
  append(sessionId, { kind: 'speech', text, startAt, endAt, ...(echo ? { echo: true } : {}) });

export const addAgentTurn = (sessionId, { at, request, actions }) => append(sessionId, { kind: 'agent', at, request, actions });

export const loadSessions = () => load().sort((a, b) => b.startedAt - a.startedAt);

export const deleteSession = (sessionId) => save(load().filter((s) => s.id !== sessionId));

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Plain-text version of a session, for copying or for handing to a model to review.
export function sessionText(session) {
  const lines = [`Session ${new Date(session.startedAt).toLocaleString()}`];
  for (const e of session.entries) {
    if (e.kind === 'speech') lines.push(`[${clock(e.startAt)}] ${e.echo ? '(agent echo?) ' : ''}${e.text}`);
    else lines.push(`[${clock(e.at)}]   agent handled "${e.request}": ${e.actions.join(' → ')}`);
  }
  return lines.join('\n');
}
