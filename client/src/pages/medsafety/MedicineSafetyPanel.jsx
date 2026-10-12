import { Ban, Scale, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Field, StatusPill } from '../../components/ui.jsx';
import { MED_SAFETY_STATUS, needsReason } from './medSafety.js';

const ICONS = { avoid: Ban, caution: TriangleAlert, allergy: ShieldAlert, dose: Scale };

/** The level as a status pill: colour + icon + word ("Avoid", "Caution", "Allergy", "Check dose"). */
export function MedSafetyPill({ level }) {
  const s = MED_SAFETY_STATUS[level] ?? MED_SAFETY_STATUS.caution;
  return (
    <StatusPill tone={s.tone} icon={ICONS[level] ?? TriangleAlert}>
      {s.word}
    </StatusPill>
  );
}

/**
 * What the list could not check for this patient, because it has no entries of that kind (notChecked: "no entries for
 * breastfeeding and no dose limits"). Said in plain words, so that no warning is never read as "checked".
 */
function NotChecked({ what }) {
  if (!what) return null;
  return (
    <p className="hint ms-missing">
      <ShieldQuestion aria-hidden="true" />
      <span>
        Not checked: this hospital’s medicine safety list has {what} yet. A doctor can add them on the Medicine safety page.{' '}
        <Link to="/medicine-safety" target="_blank" rel="noreferrer">
          See the list (opens in a new tab)
        </Link>
      </span>
    </p>
  );
}

/**
 * "Medicine safety" on the prescription: the warnings for what is being written (nothing while there are
 * none). The doctor decides: an Avoid or Allergy warning only asks for a one-line reason to go ahead (reasons,
 * onReason, reasonError – the prescription form keeps them); a Caution or a dose warning asks for nothing.
 * listInfo: { status, approvedByName } of the list. checked: the list has entries for this patient (pregnant,
 * breastfeeding or a baby) and something is being written; context: who she is, in a few words ("24 weeks
 * pregnant", "breastfeeding", "baby, 12 days old"). notChecked: what the list has no entries for, in words ('' when
 * nothing is missing). patientId: for the link to record breastfeeding (a new tab); onRecordLink: the link was
 * followed; onRecheck: read her record again ("Check again").
 */
export function MedicineSafetyPanel({
  warnings,
  listInfo,
  checked = false,
  context = '',
  notChecked = '',
  patientId = null,
  onRecordLink = null,
  onRecheck = null,
  reasons = null,
  onReason = null,
  reasonError = () => null,
}) {
  if (!warnings.length) {
    if (!listInfo) return null;
    return (
      <>
        {checked && (
          <p className="hint ms-ok">
            <ShieldCheck aria-hidden="true" /> No warnings from the medicine safety list{context ? ` (${context})` : ''}.
          </p>
        )}
        <NotChecked what={notChecked} />
      </>
    );
  }
  return (
    <section className={`ms-panel ${warnings.some(needsReason) ? 'ms-panel-high' : ''}`.trim()} aria-labelledby="ms-title" aria-live="polite">
      <h3 id="ms-title">Medicine safety{context ? ` · ${context}` : ''}</h3>
      <ul className="rf-list">
        {warnings.map((w) => (
          <li key={w.key}>
            <MedSafetyPill level={w.level} />
            <span className="rf-text">
              <strong>{w.title}</strong>
              <span className="muted"> – {w.medicines.join(', ')}</span>
              {w.message && <span className="rf-message">{w.message}</span>}
              {w.unsureWeeks && <span className="rf-message">The weeks of pregnancy are not known, so check whether this applies now.</span>}
              {w.unsureBreastfeeding && (
                <span className="rf-message">
                  Whether she is breastfeeding is not recorded.{' '}
                  {patientId && (
                    <>
                      {/* However the link is opened in a new tab (a click, the middle button, the right-click menu) */}
                      <Link
                        to={`/patients/${patientId}/edit`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={onRecordLink ?? undefined}
                        onAuxClick={onRecordLink ?? undefined}
                        onContextMenu={onRecordLink ?? undefined}
                      >
                        Record it in her details (opens in a new tab)
                      </Link>
                      {onRecheck ? ' – what is typed here stays, and this warning follows her record when you come back. ' : ''}
                    </>
                  )}
                  {onRecheck && (
                    <button type="button" className="btn btn-link plan-inline-link" onClick={onRecheck}>
                      Check again
                    </button>
                  )}
                </span>
              )}
              {w.unsureAge && <span className="rf-message">The baby’s date of birth is not recorded, so check whether this applies at this age.</span>}
              {/* Avoid and Allergy: going ahead needs a one-line reason, recorded with the prescription */}
              {onReason && needsReason(w) && (
                <Field label="Reason for going ahead (required to save)" id={`ms-why-${w.key}`} error={reasonError(w.key)} keepHint hint="Recorded with the prescription, with your name. Not printed.">
                  <input id={`ms-why-${w.key}`} value={reasons?.[w.key] ?? ''} maxLength={300} onChange={(e) => onReason(w.key, e.target.value)} />
                </Field>
              )}
            </span>
          </li>
        ))}
      </ul>
      <NotChecked what={notChecked} />
      <p className="hint rf-note">
        A reminder only – the doctor decides.{' '}
        {listInfo?.status === 'approved' ? `List approved by ${listInfo.approvedByName}.` : 'The medicine safety list is a draft that no doctor has approved yet.'}{' '}
        <Link to="/medicine-safety" target="_blank" rel="noreferrer">
          See the list
        </Link>
      </p>
    </section>
  );
}
