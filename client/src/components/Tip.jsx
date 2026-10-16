import { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

// Short tips and "What's new" (doctor ideas #11, 16 Oct 2026): one short tip the first time someone opens a new or
// changed screen, with "Got it" – then never again for them on this computer (only the tip's name is kept in this
// browser; nothing about a patient). Help → What's new lists them all.

export const WHATS_NEW = [
  { id: 'cmdk-2026-10', where: 'Every screen', text: 'Press Ctrl+K to go anywhere: a page, a patient (name, phone or number), or "book Friday".' },
  { id: 'visit-2026-10', where: 'A visit', text: '“Same as last visit” copies the medicines and advice. Enter moves to the next box, Ctrl+Enter saves. Unsaved typing is kept for you if you are called away.' },
  { id: 'shortcuts-2026-10', where: 'Any text box', text: 'Typing shortcuts: make your own in My settings → Typing shortcuts, then type .fu2 and a space.' },
  { id: 'timeline-2026-10', where: 'A pregnant patient', text: 'The pregnancy timeline on her Overview shows visits and scans – done, due or missed – from the LMP to the EDD.' },
  { id: 'wheel-2026-10', where: 'Clinic library', text: 'The pregnancy wheel: weeks and days on any date, from the LMP or an EDD.' },
  { id: 'myday-2026-10', where: 'Today', text: '“Your day so far”: the patients you saw, and what is still open – visits to sign, lab reports to review.' },
  { id: 'keepsake-2026-10', where: "A baby's record", text: 'Keepsake card: a printable card for the family, with your short note.' },
];

const key = (userId) => `perinexa:tips-seen:${userId}`;
function seenTips(userId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key(userId)) ?? '[]'));
  } catch {
    return new Set();
  }
}

/**
 * One tip (from WHATS_NEW), shown once to this person on this computer. ids: several tips for one screen – the first
 * not seen yet is shown, the next after "Got it" (one tip at a time).
 */
export function Tip({ id, ids = [id] }) {
  const { user } = useAuth();
  const [seen, setSeen] = useState(() => (user ? seenTips(user.id) : null));
  const next = seen ? ids.find((x) => !seen.has(x)) : null;
  const tip = WHATS_NEW.find((t) => t.id === next);
  if (!tip) return null;
  const done = () => {
    const id = tip.id;
    setSeen(new Set([...seen, id]));
    try {
      const s = seenTips(user.id);
      s.add(id);
      localStorage.setItem(key(user.id), JSON.stringify([...s]));
    } catch {
      /* storage blocked: the tip shows again next time – fine */
    }
  };
  return (
    <div className="tip" role="note">
      <Lightbulb aria-hidden="true" />
      <p>
        <strong>New:</strong> {tip.text} <Link to="/help#whats-new">What's new</Link>
      </p>
      <button type="button" className="btn btn-link btn-sm" onClick={done}>
        Got it
      </button>
    </div>
  );
}
