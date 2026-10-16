import { useState } from 'react';
import { Gift } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Field, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { NEWBORN_SEX_LABELS } from './patientFormat.js';

// The baby keepsake card (doctor ideas #10, 16 Oct 2026): a simple printable card for the family – the baby's name,
// the day and time of birth, the weight, the hospital, and a short note the doctor types now (printed only, never
// saved). The sex is printed only when ticked (it is the baby's, recorded after birth). Each print is in the audit
// log. DRAFT (clinical wording – patient wording the owner approves): the card's own words, marked on the print.

const timeText = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

export function KeepsakeButton({ patient }) {
  const [open, setOpen] = useState(false);
  if (patient.careType !== 'newborn' || !patient.newborn?.birthAt) return null;
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        <Gift aria-hidden="true" /> Keepsake card
      </button>
      {open && <KeepsakePrint patient={patient} onClose={() => setOpen(false)} />}
    </>
  );
}

function KeepsakePrint({ patient: p, onClose }) {
  const { activeMembership } = useAuth();
  const lh = useFetch('/tenant/settings/letterhead');
  const letterhead = lh.data?.letterhead ?? { name: activeMembership.tenantName };
  const [note, setNote] = useState('');
  const [withSex, setWithSex] = useState(false);
  const kg = p.newborn?.birthWeightGrams ? (p.newborn.birthWeightGrams / 1000).toFixed(2) : null;
  const controls = (
    <div className="keep-controls">
      <Field label="A short note from the doctor (printed only, not saved)" id="keep-note">
        <input id="keep-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="e.g. Welcome, little one. With best wishes from all of us." />
      </Field>
      {p.newborn?.sex && (
        <label className="check">
          <input type="checkbox" checked={withSex} onChange={(e) => setWithSex(e.target.checked)} /> Print {NEWBORN_SEX_LABELS[p.newborn.sex]?.toLowerCase() ?? 'the sex'}
        </label>
      )}
    </div>
  );
  return (
    <PrintPreview
      title="Keepsake card – print preview"
      hint="For the family. The note is printed only – it is not saved."
      controls={controls}
      onPrint={() => api(`/patients/${p.id}/keepsake-printed`, { method: 'POST' }).catch(() => {})}
      onClose={onClose}
    >
      <PrintDocument draft="DRAFT – card wording to be approved by the hospital's doctor">
        <div className="keepsake">
          <Letterhead letterhead={letterhead} />
          <p className="keep-lead">Welcome to the world</p>
          <h1 className="keep-name">{p.fullName}</h1>
          <dl className="keep-facts">
            <div>
              <dt>Born on</dt>
              <dd>{formatDate(p.newborn.birthAt)}</dd>
            </div>
            <div>
              <dt>At</dt>
              <dd>{timeText(p.newborn.birthAt)}</dd>
            </div>
            {kg && (
              <div>
                <dt>Weight</dt>
                <dd>{kg} kg</dd>
              </div>
            )}
            {withSex && p.newborn?.sex && (
              <div>
                <dt>Baby</dt>
                <dd>{NEWBORN_SEX_LABELS[p.newborn.sex]}</dd>
              </div>
            )}
          </dl>
          {note.trim() && <p className="keep-note">{note.trim()}</p>}
          <p className="keep-foot">With best wishes from everyone at {letterhead.name}</p>
        </div>
      </PrintDocument>
    </PrintPreview>
  );
}
