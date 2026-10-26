import { useState } from 'react';
import { PenLine, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDate } from '../components/ui.jsx';
import { EditPatientDialog } from './appointments/RegisterAndBook.jsx';

// Reception's "Details missing" (26 Oct 2026): patients registered in a rush – name, age and phone only – stay listed on
// Today until their registration details are filled in (server/src/patients/missingDetails.js). Each row says what
// is missing and opens her details in a dialog ("Fill details"); saving takes her off the list. Identity details only.

export const MISSING_WORDS = { age: 'age', phone: 'phone', address: 'address', emergencyContact: 'emergency contact', doctor: 'doctor' };
const SHOWN = 5;

/** "Address, emergency contact and doctor missing". */
export function missingText(missing = []) {
  const words = missing.map((m) => MISSING_WORDS[m] ?? m);
  if (!words.length) return '';
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} missing`;
}

/**
 * rows: today.incomplete from GET /api/today; onSaved(patient) after a dialog saved. inDialog: the list alone, every
 * row (reception's To do opens it in a dialog that has the heading).
 */
export function DetailsMissing({ rows, onSaved, inDialog = false }) {
  const [editing, setEditing] = useState(null);
  const [all, setAll] = useState(inDialog);
  if (!rows?.length) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <section className={inDialog ? 'dm-in-dialog' : 'dm-panel'} role="region" aria-labelledby={inDialog ? undefined : 'dm-title'} aria-label={inDialog ? 'Details missing' : undefined}>
      {!inDialog && (
        <h2 id="dm-title" className="dm-title">
          <TriangleAlert aria-hidden="true" /> Details missing <span className="tabular">({rows.length})</span>
        </h2>
      )}
      <p className="hint">Registered without all their details. Fill them in when the patient is at the desk or on the phone.</p>
      <ul className="dm-list">
        {shown.map((r) => (
          <li key={r.patient.id} className="dm-row">
            <span className="dm-who">
              <Link to={`/patients/${r.patient.id}`}>{r.patient.fullName}</Link>
              <span className="muted tabular">
                {r.patient.mrn}
                {r.patient.phone ? ` · ${r.patient.phone}` : ''} · registered {formatDate(r.registeredOn)}
              </span>
            </span>
            <span className="dm-missing">{missingText(r.missing)}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(r.patient)} aria-label={`Fill the details of ${r.patient.fullName}`}>
              <PenLine aria-hidden="true" /> Fill details
            </button>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN && (
        <button type="button" className="btn btn-link btn-sm" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
      {editing && (
        <EditPatientDialog
          patientId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null);
            onSaved(p ?? editing);
          }}
        />
      )}
    </section>
  );
}
