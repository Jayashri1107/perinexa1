import { useEffect, useRef } from 'react';

// Phones only (the same width as mobile.css): a long page of cards shows each card as its title line, and a tap on
// the title (or Enter / Space) opens it. Computers and tablets see every card open, as before.
const PHONE_QUERY = '(max-width: 719px)';
// A card's title: its own h2, or the h2 in its first part (a head with buttons beside the title)
const titleOf = (card) => card.querySelector(':scope > h2, :scope > :first-child h2');

/** A box of cards that fold on a phone; mobile.css hides what is under a folded card's title (keeping its short summary). */
export function FoldCards({ className, openFirst = false, children }) {
  const box = useRef(null);
  const firstDone = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (!el || !window.matchMedia) return undefined;
    const phone = window.matchMedia(PHONE_QUERY);
    const mark = () => {
      for (const card of el.querySelectorAll('.card')) {
        const title = titleOf(card);
        if (!title || card.classList.contains('ai-card')) continue;
        if (phone.matches) {
          card.setAttribute('data-fold', '');
          // openFirst: the first card starts open, so the page opens on something to read
          if (openFirst && !firstDone.current) {
            firstDone.current = true;
            card.setAttribute('data-open', '');
          }
          title.setAttribute('role', 'button');
          title.tabIndex = 0;
          title.setAttribute('aria-expanded', String(card.hasAttribute('data-open')));
        } else {
          card.removeAttribute('data-fold');
          title.removeAttribute('role');
          title.removeAttribute('tabindex');
          title.removeAttribute('aria-expanded');
        }
      }
    };
    mark();
    // Cards appear as their data arrives: mark the new ones too
    const watch = new MutationObserver(mark);
    watch.observe(el, { childList: true, subtree: true });
    phone.addEventListener('change', mark);
    return () => {
      watch.disconnect();
      phone.removeEventListener('change', mark);
    };
  }, [openFirst]);

  const toggle = (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    const title = e.target.closest('h2[role="button"]');
    const card = title?.closest('.card[data-fold]');
    if (!card || !box.current?.contains(card)) return;
    // A link or button inside the title still does its own thing
    if (e.target.closest('a, button, input, select, textarea, summary') && title.contains(e.target.closest('a, button, input, select, textarea, summary'))) return;
    e.preventDefault();
    const open = !card.hasAttribute('data-open');
    card.toggleAttribute('data-open', open);
    title.setAttribute('aria-expanded', String(open));
  };

  return (
    // The titles inside are the buttons (role, tabindex and keys set above); this only catches their clicks and keys
    <div ref={box} className={className} onClick={toggle} onKeyDown={toggle}>
      {children}
    </div>
  );
}
