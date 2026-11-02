import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

// Phones only (the same width as mobile.css): a long form in short steps – one group of fields at a time, a progress
// line with every step's name (tap one to go straight there), Back and Next at the foot, and the form's own Save bar
// on the last step. Nothing is lost between steps: the fields stay in the form, only out of sight. If saving finds a
// mistake, the step with the first marked field opens. Computers and tablets see the whole form, as before.
const PHONE_QUERY = '(max-width: 719px)';
// A step: each group of fields (.pf-group), and each box of the form that has no groups of its own
const findSteps = (box) => [...box.querySelectorAll('.pf-group, .form-section')].filter((el) => !(el.classList.contains('form-section') && el.querySelector('.pf-group')));
const nameOf = (el) => el.querySelector(':scope > .pf-group-title, :scope > h2, :scope > h3, :scope > legend')?.textContent.trim() || 'Details';

export function FormSteps({ enabled = true, children }) {
  const box = useRef(null);
  // (no window when a page is drawn outside a browser, e.g. in a test: then not a phone)
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(PHONE_QUERY).matches));
  const [names, setNames] = useState([]);
  const [at, setAt] = useState(0);
  const on = enabled && phone && names.length > 1;

  useEffect(() => {
    const media = window.matchMedia?.(PHONE_QUERY);
    if (!media) return undefined;
    const change = () => setPhone(media.matches);
    // (a resize as well: some browsers do not tell a width query that it changed when a window is resized)
    media.addEventListener('change', change);
    window.addEventListener('resize', change);
    return () => {
      media.removeEventListener('change', change);
      window.removeEventListener('resize', change);
    };
  }, []);

  // The steps: read again when the form changes (a type of care adds or removes a box); a mistake marked by the form
  // (aria-invalid) opens its step
  useEffect(() => {
    const el = box.current;
    if (!el || !enabled || !phone) return undefined;
    const read = () => {
      const steps = findSteps(el);
      setNames((was) => {
        const now = steps.map(nameOf);
        return now.join('|') === was.join('|') ? was : now;
      });
      const wrong = el.querySelector('[aria-invalid="true"]');
      if (wrong) {
        const i = steps.findIndex((s) => s.contains(wrong));
        if (i >= 0) setAt((cur) => (cur === i ? cur : i));
      }
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-invalid'] });
    return () => watch.disconnect();
  }, [enabled, phone]);

  // Show only the current step (an attribute, so React's own rendering of the fields is untouched)
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    findSteps(el).forEach((s, i) => s.toggleAttribute('data-step-off', on && i !== at));
  });

  const last = Math.max(0, names.length - 1);
  const go = (i) => {
    setAt(Math.min(Math.max(0, i), last));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div ref={box} className={on ? `fs-on${at === last ? ' fs-last' : ''}` : undefined}>
      {on && (
        <nav className="fs-progress" aria-label="Steps of the form">
          <p className="fs-count">
            Step {at + 1} of {names.length}
          </p>
          <ol>
            {names.map((n, i) => (
              <li key={`${n}-${i}`}>
                <button type="button" className={i === at ? 'is-current' : i < at ? 'is-done' : ''} aria-current={i === at ? 'step' : undefined} onClick={() => go(i)}>
                  <span className="fs-dot" aria-hidden="true" />
                  <span className="fs-name">{n}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {children}
      {on && at < last && (
        <div className="fs-nav">
          {at > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => go(at - 1)}>
              <ArrowLeft aria-hidden="true" /> Back
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => go(at + 1)}>
            Next: {names[at + 1]} <ArrowRight aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
