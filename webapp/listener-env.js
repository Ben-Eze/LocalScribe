// The listener: watches the timestamped transcript and decides whether the user has finished a request.
// It only ever chooses [wait] or [act]; on [act] the words since the last action go to the notes agent.

export const LISTENER_OPTION_NAMES = ['wait', 'act'];

export function createListenerEnv() {
  const startedAt = Date.now();
  const words = [];        // { word, t } with t in ms since start
  let pendingFrom = 0;     // index of the first word not yet handed to the notes agent

  const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

  function addWord(word) {
    words.push({ word, t: Date.now() - startedAt });
  }

  function observe() {
    const pending = words.slice(pendingFrom);
    const now = Date.now() - startedAt;
    const sections = [
      {
        heading: 'TRANSCRIPT (since the last action)',
        lines: pending.length ? pending.map((w) => `[${seconds(w.t)}] ${w.word}`) : ['(nothing new)'],
      },
      {
        heading: 'SILENCE',
        lines: [words.length ? `${seconds(now - words[words.length - 1].t)} since the last word` : 'no words yet'],
      },
    ];
    const options = [
      { name: 'wait', description: 'the user is still speaking, or has not asked for anything' },
      ...(pending.length ? [{ name: 'act', description: 'the user has finished a request; act on it now' }] : []),
    ];
    return { sections, mode: 'choose', options };
  }

  // Hands the pending words over as one utterance and starts a new pending stretch.
  function takeUtterance() {
    const utterance = words.slice(pendingFrom).map((w) => w.word).join(' ');
    pendingFrom = words.length;
    return utterance;
  }

  return { addWord, observe, takeUtterance, words: () => words };
}
