// Keyboard-only visit entry (doctor ideas #6, 16 Oct 2026): in the visit's forms Enter moves to the next box (as Tab
// does) instead of saving half-way, and Ctrl+Enter (⌘+Enter) saves. In a text area Enter stays a new line. On the
// last box of the medicines, Enter adds a new medicine line (onLastEnter). Buttons, tick boxes and choices work as
// usual. Use: <form onKeyDown={keyboardEntry({ onLastEnter })}>.

const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';

export function keyboardEntry({ onLastEnter = null } = {}) {
  return (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.altKey) return;
    const form = e.currentTarget;
    const el = e.target;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      form.requestSubmit?.();
      return;
    }
    // Enter on a text box (not a text area, a button, a tick box or a list of suggestions being chosen) moves on
    if (!(el instanceof HTMLInputElement) || ['checkbox', 'radio', 'submit', 'button', 'file'].includes(el.type)) return;
    e.preventDefault();
    const boxes = [...form.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null && x.tagName !== 'BUTTON');
    const i = boxes.indexOf(el);
    const inRows = el.closest('[data-rx-rows]');
    const lastInRows = inRows && [...inRows.querySelectorAll(FOCUSABLE)].filter((x) => x.tagName !== 'BUTTON' && x.offsetParent !== null).at(-1) === el;
    if (lastInRows && onLastEnter) {
      onLastEnter();
      return;
    }
    boxes[i + 1]?.focus();
  };
}

/** After a new medicine line is added from the keyboard: the cursor goes to its medicine name. */
export function focusLastMedicine() {
  requestAnimationFrame(() => {
    const names = document.querySelectorAll('[data-rx-rows] input[list="rx-medicines"]');
    names[names.length - 1]?.focus();
  });
}
