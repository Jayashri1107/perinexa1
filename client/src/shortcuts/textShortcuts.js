// Typing shortcuts (doctor ideas #3, 16 Oct 2026): ".fu2" followed by a space (or Enter) in a text box becomes the
// person's own text, e.g. "Follow up after 2 weeks with CBC report". PURE: the text box's value and caret in, the new
// value and caret out (null: nothing to replace). The shortcut must start a word: "e.g.fu2" is left alone.

/**
 * value: the text box's text after the space or line break was typed; caret: where the caret is (just after it);
 * shortcuts: Map of key (lower case, no dot) → text.
 */
export function expandShortcut(value, caret, shortcuts) {
  if (!shortcuts?.size || caret < 3) return null;
  const typed = value[caret - 1];
  if (typed !== ' ' && typed !== '\n') return null;
  const before = value.slice(0, caret - 1);
  const m = before.match(/(^|[\s(])\.([a-z0-9]{1,20})$/i);
  if (!m) return null;
  const text = shortcuts.get(m[2].toLowerCase());
  if (!text) return null;
  const start = before.length - m[2].length - 1; // the dot
  const next = `${value.slice(0, start)}${text}${typed}${value.slice(caret)}`;
  return { value: next, caret: start + text.length + 1 };
}
