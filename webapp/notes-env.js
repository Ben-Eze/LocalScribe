// The micro notes app, as an environment an agent (human or model) drives one option at a time.
//
// Screens:   home                → list of notes
//            notes/<name>        → one note, cursor on a line
//            notes/<name>/write  → free text for add / edit / rename
// Every action is recorded in the log with what actually happened, so the agent can see its own effects.

// Each name must be one Qwen3 token right after "[" (see the token check on notes.html); "new" fails because "[new" is a single token.
// "say"/"speak"/"tell" also merge with "[", hence "reply".
export const NOTES_OPTION_NAMES = ['create', 'up', 'down', 'add', 'edit', 'del', 'bullet', 'rename', 'home', 'reply', 'done', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const STORAGE_KEY = 'localscribe-notes';
const LOG_SHOWN = 12;     // entries included in the observation (kept short: every token costs the model time)
const LOG_KEPT = 200;     // entries kept in storage
const MAX_STEPS = 8;      // actions per turn before only [done] is offered
const MAX_TOKENS = { add: 40, edit: 40, rename: 8, reply: 30 };

const quote = (s) => JSON.stringify(s);

const loadState = () => {
  try { return { files: [], open: null, log: [], ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; } catch { return { files: [], open: null, log: [] }; }
};
const saveState = (state) => {
  state.log = state.log.slice(-LOG_KEPT);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
};

// For the notes library page: every saved note, most recently changed first.
export function loadNotes() {
  return [...loadState().files].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
}

export function deleteNote(name) {
  const state = loadState();
  const index = state.files.findIndex((f) => f.name === name);
  if (index === -1) return;
  state.files.splice(index, 1);
  if (state.open === index) state.open = null;
  else if (state.open > index) state.open--;
  saveState(state);
}

// onReply(text) is called whenever the agent says something out loud; the page decides how to voice it.
export function createNotesEnv({ onReply = () => {} } = {}) {
  let state = loadState();
  let writing = null; // { kind: 'add' | 'edit' | 'rename' | 'reply' } while waiting for text
  let steps = 0;

  const save = () => saveState(state);
  const file = () => (state.open === null ? null : state.files[state.open]);
  const touch = (f) => { f.updated = Date.now(); };
  const record = (text) => { state.log.push({ kind: 'action', text }); };
  const lineLabel = (line) => (line.bullet ? '• ' : '') + line.text;

  function location() {
    return (file() ? `notes/${file().name}` : 'home') + (writing ? '/write' : '');
  }

  function logSection() {
    const lines = state.log.slice(-LOG_SHOWN).map((e) => (e.kind === 'user' ? `user: ${quote(e.text)}` : `  → ${e.text}`));
    return { heading: 'LOG', lines: lines.length ? lines : ['(nothing yet)'] };
  }

  function options() {
    if (steps >= MAX_STEPS) return [{ name: 'done', description: 'step limit reached; end this turn' }];
    const reply = { name: 'reply', description: 'say something out loud to the user' };
    const done = { name: 'done', description: 'finished; wait for the user to speak again' };
    const f = file();
    if (!f) {
      return [
        { name: 'create', description: 'create a new note and open it' },
        ...state.files.slice(0, 9).map((n, i) => ({ name: String(i + 1), description: `open ${quote(n.name)}` })),
        reply,
        done,
      ];
    }
    const hasLines = f.lines.length > 0;
    return [
      f.cursor > 0 && { name: 'up', description: 'move cursor up one line' },
      f.cursor < f.lines.length - 1 && { name: 'down', description: 'move cursor down one line' },
      { name: 'add', description: hasLines ? 'new line below the cursor, then write it' : 'write the first line' },
      hasLines && { name: 'edit', description: 'rewrite the current line' },
      hasLines && { name: 'del', description: 'delete the current line' },
      hasLines && { name: 'bullet', description: 'toggle a bullet point on the current line' },
      { name: 'rename', description: 'rename this note' },
      { name: 'home', description: 'back to the list of notes' },
      reply,
      done,
    ].filter(Boolean);
  }

  function observe() {
    const f = file();
    const sections = [logSection()];
    if (!f) {
      sections.push({ heading: 'LOCATION', lines: ['home'] });
      sections.push({
        heading: 'NOTES',
        lines: state.files.length
          ? state.files.slice(0, 9).map((n, i) => `${i + 1}. ${n.name} (${n.lines.length} lines)`)
          : ['(no notes yet)'],
      });
    } else {
      const where = f.lines.length ? ` · line ${f.cursor + 1} of ${f.lines.length}` : ' · empty';
      sections.push({ heading: 'LOCATION', lines: [location() + where] });
      sections.push(
        f.lines.length
          ? { heading: 'NOTE', lines: f.lines.map((l, i) => `${i + 1} ${lineLabel(l)}`), cursor: f.cursor }
          : { heading: 'NOTE', lines: ['(empty note)'] },
      );
    }

    if (writing) {
      let instruction, initial = '';
      if (writing.kind === 'reply') {
        instruction = 'what to say out loud to the user (keep it short)';
      } else if (writing.kind === 'add') {
        instruction = f.lines.length ? `text for a new line below line ${f.cursor + 1}` : 'text for the first line';
      } else if (writing.kind === 'edit') {
        instruction = `replacement text for line ${f.cursor + 1} (currently ${quote(f.lines[f.cursor].text)})`;
        initial = f.lines[f.cursor].text;
      } else {
        instruction = `new name for this note (currently ${quote(f.name)})`;
        initial = f.name;
      }
      return { sections, mode: 'write', write: { instruction, initial, maxTokens: MAX_TOKENS[writing.kind] } };
    }
    return { sections, mode: 'choose', options: options() };
  }

  // Called when the listener decides the user has finished a request.
  function beginTurn(utterance) {
    state.log.push({ kind: 'user', text: utterance });
    steps = 0;
    save();
  }

  function act(name) {
    if (writing || !options().some((o) => o.name === name)) return `[${name}] is not available here`;
    steps++;
    const f = file();
    let result;

    if (name === 'done') {
      result = '[done]';
      steps = 0;
    } else if (name === 'create') {
      let n = state.files.length + 1;
      while (state.files.some((x) => x.name === `Note ${n}`)) n++;
      state.files.unshift({ name: `Note ${n}`, lines: [], cursor: 0, updated: Date.now() });
      state.open = 0;
      result = `[create] created and opened ${quote(`Note ${n}`)}`;
    } else if (/^\d$/.test(name)) {
      state.open = Number(name) - 1;
      result = `[${name}] opened ${quote(file().name)}`;
    } else if (name === 'home') {
      result = `[home] closed ${quote(f.name)}`;
      state.open = null;
    } else if (name === 'up' || name === 'down') {
      f.cursor += name === 'up' ? -1 : 1;
      result = `[${name}] cursor on line ${f.cursor + 1}: ${quote(f.lines[f.cursor].text)}`;
    } else if (name === 'del') {
      const [removed] = f.lines.splice(f.cursor, 1);
      f.cursor = Math.max(0, Math.min(f.cursor, f.lines.length - 1));
      touch(f);
      result = `[del] deleted line: ${quote(removed.text)}`;
    } else if (name === 'bullet') {
      const line = f.lines[f.cursor];
      line.bullet = !line.bullet;
      touch(f);
      result = `[bullet] ${line.bullet ? 'added bullet to' : 'removed bullet from'} line ${f.cursor + 1}`;
    } else {
      writing = { kind: name }; // add / edit / rename: the result is recorded once the text arrives
      return `[${name}] writing…`;
    }

    record(result);
    save();
    return result;
  }

  function write(rawText) {
    if (!writing) return 'not writing';
    const text = rawText.split('\n')[0].trim(); // a model's text ends at the first newline
    const f = file();
    const kind = writing.kind;
    writing = null;
    let result;

    if (!text) {
      result = `[${kind}] cancelled (no text)`;
    } else if (kind === 'reply') {
      result = `[reply] said ${quote(text)}`;
      onReply(text);
    } else if (kind === 'add') {
      // New lines inherit the bullet of the line above, so lists keep going naturally.
      const bullet = f.lines[f.cursor]?.bullet ?? false;
      const at = f.lines.length ? f.cursor + 1 : 0;
      f.lines.splice(at, 0, { text, bullet });
      f.cursor = at;
      result = `[add] wrote line ${at + 1}: ${quote(text)}`;
    } else if (kind === 'edit') {
      const old = f.lines[f.cursor].text;
      f.lines[f.cursor].text = text;
      result = `[edit] line ${f.cursor + 1} ${quote(old)} → ${quote(text)}`;
    } else {
      const old = f.name;
      f.name = text;
      result = `[rename] ${quote(old)} → ${quote(text)}`;
    }
    if (kind !== 'reply' && text) touch(f);

    record(result);
    save();
    return result;
  }

  function reset() {
    state = { files: [], open: null, log: [] };
    writing = null;
    steps = 0;
    save();
  }

  // Plain state for a human-friendly view (page 4): the open note, or the list of notes.
  function snapshot() {
    const f = file();
    return {
      note: f && { name: f.name, lines: f.lines.map((l) => ({ ...l })), cursor: f.cursor },
      notes: state.files.map((n) => n.name),
      writing: writing?.kind ?? null,
    };
  }

  return { observe, act, write, beginTurn, reset, snapshot };
}
