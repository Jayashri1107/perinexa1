import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

// Undo instead of "Are you sure?" (doctor ideas #5, 16 Oct 2026): for changes to what is on screen and not saved yet
// – a medicine line removed, the medicines replaced – the change happens at once and a small bar offers Undo for a
// few seconds. Saved records that must not change (signed visits, approvals, access) still ask first.
// const undo = useUndo(); undo.offer('Medicine removed.', () => put it back); … render {undo.element}.

const SHOW_MS = 7000;

export function useUndo() {
  const [offer, setOffer] = useState(null); // { text, undo, id }
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (offer) timer.current = setTimeout(() => setOffer(null), SHOW_MS);
    return () => clearTimeout(timer.current);
  }, [offer]);
  const element = offer ? (
    <div className="undo-bar" role="status">
      <span>{offer.text}</span>
      <button
        type="button"
        className="btn btn-link btn-sm"
        onClick={() => {
          offer.undo();
          setOffer(null);
        }}
      >
        <RotateCcw aria-hidden="true" /> Undo
      </button>
    </div>
  ) : null;
  return { offer: (text, undo) => setOffer({ text, undo, id: Date.now() }), element };
}
