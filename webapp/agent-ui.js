// One observation format, two renderings: plain text for a model, buttons for a human.
// Both are built from the same helpers so what the human sees mirrors the model's prompt line for line.
//
// Observation shape:
// {
//   sections: [{ heading, lines: [string], cursor?: number }],
//   mode: 'choose' | 'write',
//   options?: [{ name, description }],                      // mode 'choose': pick exactly one name
//   write?: { instruction, initial?, maxTokens },            // mode 'write': free text until ESCAPE or maxTokens
// }

export const ESCAPE = '⏎'; // shown to the model as its "end of text"; a model's text ends at the first newline

export const sectionLines = (section) =>
  section.cursor === undefined ? section.lines : section.lines.map((line, i) => (i === section.cursor ? '> ' : '  ') + line);

export const optionLine = (option) => `[${option.name}] ${option.description}`;

export const writeHeader = (write) => `${write.instruction} (end with ${ESCAPE}, max ${write.maxTokens} tokens)`;

// The text prompt a model continues. For 'choose' it ends with "[" so the next token is the option name.
export function toText(obs) {
  const out = [];
  for (const section of obs.sections) out.push(`## ${section.heading}`, ...sectionLines(section), '');
  if (obs.mode === 'choose') {
    out.push('## OPTIONS', ...obs.options.map(optionLine), '', '## ACTION', '[');
  } else {
    out.push('## WRITING', writeHeader(obs.write), '');
  }
  return out.join('\n');
}

// Renders the same observation as HTML controls. Handlers: onOption(name), onWrite(text).
export function renderHuman(obs, container, { onOption, onWrite, disabled = false }) {
  container.innerHTML = '';
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  for (const section of obs.sections) {
    container.append(el('div', 'agent-heading', section.heading));
    const block = el('div', 'agent-block');
    sectionLines(section).forEach((line, i) => {
      block.append(el('div', i === section.cursor ? 'agent-line cursor' : 'agent-line', line));
    });
    container.append(block);
  }

  if (obs.mode === 'choose') {
    container.append(el('div', 'agent-heading', 'OPTIONS'));
    const list = el('div', 'agent-options');
    for (const option of obs.options) {
      const button = el('button', 'agent-option');
      button.append(el('b', '', `[${option.name}]`), el('span', '', ` ${option.description}`));
      button.disabled = disabled;
      button.onclick = () => onOption(option.name);
      list.append(button);
    }
    container.append(list);
  } else {
    container.append(el('div', 'agent-heading', 'WRITING'), el('div', 'muted', writeHeader(obs.write)));
    const input = el('input');
    input.type = 'text';
    input.value = obs.write.initial ?? '';
    input.disabled = disabled;
    const submit = el('button', '', ESCAPE);
    submit.disabled = disabled;
    submit.onclick = () => onWrite(input.value);
    input.onkeydown = (e) => { if (e.key === 'Enter') onWrite(input.value); };
    const row = el('div', 'row');
    row.append(input, submit);
    container.append(row);
    if (!disabled) setTimeout(() => input.focus(), 0);
  }

  const details = el('details', 'agent-text');
  details.append(el('summary', 'muted', "Model's view (exact prompt text)"), el('pre', '', toText(obs)));
  // Re-renders replace this element, so keep the open/closed choice on the container.
  details.open = container.dataset.textOpen === '1';
  details.ontoggle = () => { container.dataset.textOpen = details.open ? '1' : '0'; };
  container.append(details);
}
