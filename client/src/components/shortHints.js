import { useEffect } from 'react';

// Phones only (the user's request, 2 Nov 2026: too much instruction text): a long instruction line shows as one line
// with an arrow, and a tap shows the rest. The wording is not changed and nothing is removed – screen readers read it
// all. Safety stays in full view: text about warnings, consent, drafts, allergies and the like, every clinical page,
// messages the page announces (role), and lines with a link or a control in them.
const MIN_LENGTH = 60;
const KEEP_WORDS = /draft|allerg|consent|agreement|pcpndt|sex|red.?flag|risk|warning|caution|danger|emergency|urgent|must|never|not approved|do not|don['’]t|before calling|doctor approv|medicine|dose|pregnan|delet|cannot be undone|legal|password|at least/i;
const KEEP_PAGES = /^\/(care-plans|medicine-safety|clinical-rules|consent-forms|information-forms|library|test-packages|prescription-sets)(\/|$)|^\/patients\/[^/]+\/(visits|care-plan|fertility-plan|consents|information|stays|lab|referrals)(\/|$)|^\/patients\/new\/[^/]+\/clinical/;

/** May this instruction line be shortened? (the text and the page's address) */
export const canShorten = (text, pathname) => text.length >= MIN_LENGTH && !KEEP_WORDS.test(text) && !KEEP_PAGES.test(pathname);

const eligible = (el) => !el.hasAttribute('role') && !el.closest('.alert, .modal, [role="alert"], [role="status"]') && !el.querySelector('a, button, input, select, textarea, label') && canShorten(el.textContent.trim(), window.location.pathname);

const setOpen = (el, open) => {
  el.toggleAttribute('data-open', open);
  el.setAttribute('aria-expanded', String(open));
};

export function useShortHints(on) {
  useEffect(() => {
    const main = document.getElementById('main');
    if (!on || !main) return undefined;
    let frame = 0;
    const mark = () => {
      frame = 0;
      for (const el of main.querySelectorAll('.hint:not([data-short])')) {
        if (!eligible(el)) continue;
        el.setAttribute('data-short', '');
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        setOpen(el, false);
      }
    };
    const soon = () => {
      if (!frame) frame = setTimeout(mark, 60);
    };
    const toggle = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest?.('[data-short]');
      if (!el) return;
      e.preventDefault();
      setOpen(el, !el.hasAttribute('data-open'));
    };
    mark();
    const watch = new MutationObserver(soon);
    watch.observe(main, { childList: true, subtree: true });
    main.addEventListener('click', toggle);
    main.addEventListener('keydown', toggle);
    return () => {
      watch.disconnect();
      clearTimeout(frame);
      main.removeEventListener('click', toggle);
      main.removeEventListener('keydown', toggle);
      for (const el of main.querySelectorAll('[data-short]')) {
        for (const a of ['data-short', 'data-open', 'role', 'tabindex', 'aria-expanded']) el.removeAttribute(a);
      }
    };
  }, [on]);
}
