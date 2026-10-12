import { Fragment } from 'react';
import { Phone, UserRound } from 'lucide-react';
import { Alert, Avatar, StatusPill, useDialogFocus } from '../../components/ui.jsx';
import { matchFacts, matchedOnText, matchesTitle, moreMatchesText } from './duplicateFormat.js';

/**
 * "She may already be registered": shown when the server found records of this hospital with the same phone number
 * or the same name, before anything is saved. Two choices: open the existing record, or register a new patient
 * anyway (recorded in the audit log). Nothing is ever joined by itself, and the list shows only what this person may
 * already see of those records – never a medical detail.
 * - careType: the type of care being registered ('newborn' speaks of "this baby")
 * - matches, total: the records shown, and how many match in all
 * - onOpen(match): open that record instead of registering; openNote: what else opening it does (a quick booking
 *   being registered joins that record)
 * - onRegisterAnyway(): register her as a new patient
 * - onBack(): back to the form, to check what was typed
 * - busy: the choice being carried out – 'register' (she is being saved as a new patient), the id of the record
 *   being opened, or null; error: why it failed
 */
export function PossibleMatchesDialog({ careType, matches, total, onOpen, openNote = null, onRegisterAnyway, onBack, busy = null, error = null }) {
  const ref = useDialogFocus(busy ? undefined : onBack);
  const baby = careType === 'newborn';
  const more = moreMatchesText(total, matches.length);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onBack()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide" role="alertdialog" aria-modal="true" aria-labelledby="matches-title" aria-describedby="matches-text">
        <h2 id="matches-title">{matchesTitle(careType)}</h2>
        <p id="matches-text">
          {matches.length === 1 ? 'A record' : 'Records'} with the same phone number or name {matches.length === 1 ? 'is' : 'are'} already in this hospital. Nothing was saved yet.{' '}
          {baby ? 'If this is the same baby, open the record.' : 'If this is her, open her record.'} If it is someone else, register a new patient.
        </p>
        <Alert type="error">{error}</Alert>
        <ul className="plain-list match-list">
          {matches.map((m) => (
            <li key={m.id} className="match-row">
              <span className="name-cell">
                <Avatar name={m.fullName} seed={m.id} />
                <span className="name-cell-text">
                  <strong>{m.fullName}</strong>
                  {/* Each fact kept on one line where it fits ("Phone ending" never apart from its digits) */}
                  <span className="muted tabular">
                    {matchFacts(m).map((fact, i) => (
                      <Fragment key={i}>
                        {i > 0 && ' · '}
                        <span className="match-fact">{fact}</span>
                      </Fragment>
                    ))}
                  </span>
                  {/* Why this record is shown (an icon and words) */}
                  <span className="match-why">
                    <StatusPill tone="neutral" icon={m.matchedOn?.includes('phone') ? Phone : UserRound}>
                      {matchedOnText(m)}
                    </StatusPill>
                  </span>
                </span>
              </span>
              {/* With one record to choose, opening it is the dialog's main action */}
              <button type="button" className={`btn ${matches.length === 1 ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => onOpen(m)} disabled={Boolean(busy)}>
                {busy === m.id ? 'Opening…' : 'Open this record'}
              </button>
            </li>
          ))}
        </ul>
        {more && <p className="hint">{more}</p>}
        {openNote && <p className="hint">{openNote}</p>}
        <p className="hint">Registering anyway is recorded in the audit log. A doctor or an RMO can later mark one record as a duplicate of the other.</p>
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={onRegisterAnyway} disabled={Boolean(busy)}>
            {busy === 'register' ? 'Saving…' : 'Register as a new patient anyway'}
          </button>
          <button type="button" className="btn btn-link" onClick={onBack} disabled={Boolean(busy)}>
            Back to the form
          </button>
        </div>
      </div>
    </div>
  );
}
