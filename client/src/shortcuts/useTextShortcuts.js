import { useEffect, useRef } from 'react';
import { api } from '../api.js';
import { expandShortcut } from './textShortcuts.js';

// Turns the signed-in person's typing shortcuts on in every text box of the app (doctor ideas #3). Text boxes are
// React's own: the new text is set through the browser's value setter and announced with an "input" event, so React
// sees it as typed. Never in a password box. The list is read once, and again after "My settings → Typing shortcuts"
// changes it (the SHORTCUTS_CHANGED window event).

export const SHORTCUTS_CHANGED = 'perinexa:shortcuts-changed';
const TEXT_TYPES = new Set(['text', 'search', '']);

export function useTextShortcuts(enabled) {
  const map = useRef(new Map());
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const load = () =>
      api('/me/shortcuts')
        .then((r) => {
          if (alive) map.current = new Map(r.shortcuts.map((s) => [s.key, s.text]));
        })
        .catch(() => {});
    load();
    const onInput = (e) => {
      const el = e.target;
      if (!(e.inputType === 'insertText' && e.data === ' ') && e.inputType !== 'insertLineBreak') return;
      const isArea = el instanceof HTMLTextAreaElement;
      if (!isArea && !(el instanceof HTMLInputElement && TEXT_TYPES.has(el.type))) return;
      const out = expandShortcut(el.value, el.selectionStart ?? el.value.length, map.current);
      if (!out || out.value.length > (el.maxLength > 0 ? el.maxLength : Infinity)) return;
      const setter = Object.getOwnPropertyDescriptor(isArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
      setter.call(el, out.value);
      el.setSelectionRange(out.caret, out.caret);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    document.addEventListener('input', onInput, true);
    window.addEventListener(SHORTCUTS_CHANGED, load);
    return () => {
      alive = false;
      document.removeEventListener('input', onInput, true);
      window.removeEventListener(SHORTCUTS_CHANGED, load);
    };
  }, [enabled]);
}
