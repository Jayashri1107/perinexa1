import { useState } from 'react';
import { ClipboardCheck, DoorOpen, FileText, LogIn, Tag, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { Barcode } from '../../components/print/Barcode.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { rupees } from '../billing/billingFormat.js';
import { ID_PROOF_OPTIONS, PAYER_NAME_LABELS, PAYER_OPTIONS } from '../patients/PatientForm.jsx';
import { REASONS } from './bedFormat.js';

// Admission like a hospital system (owner, 17 Oct 2026 – docs/ADMISSION_DESK_PLAN.md): the admission checklist (ID proof
// type and last 4 digits only, attendant, payer, consent), a doctor's admission request, clearance for leaving with the
// gate pass, and the printouts – admission form, wristband with a barcode of the IPD number, gate pass, OPD case paper.

const TYPE_WORDS = { planned: 'Planned', emergency: 'Emergency', day_care: 'Day care' };
const idWords = (c) => (c?.idProof ? `${ID_PROOF_OPTIONS.find(([k]) => k === c.idProof)?.[1] ?? c.idProof}${c.idLast4 ? ` ending ${c.idLast4}` : ''}` : '');
const payerWords = (c) => (c?.payer ? `${PAYER_OPTIONS.find(([k]) => k === c.payer)?.[1] ?? c.payer}${c.payerName ? ` – ${c.payerName}` : ''}` : '');

export const EMPTY_CHECKLIST = { idProof: '', idLast4: '', attendantName: '', attendantRelation: '', attendantPhone: '', payer: '', payerName: '', consentSigned: false };

/** Her record's details as a first answer (ID proof, payer, emergency contact as the attendant). */
export const checklistFromPatient = (p) => ({
  ...EMPTY_CHECKLIST,
  idProof: p?.idProof?.kind ?? '',
  idLast4: p?.idProof?.last4 ?? '',
  attendantName: p?.emergencyContact?.name ?? '',
  attendantRelation: p?.emergencyContact?.relation ?? '',
  attendantPhone: p?.emergencyContact?.phone ?? '',
  payer: p?.payer?.type ?? '',
  payerName: p?.payer?.name ?? '',
});

export function Modal({ id, title, onClose, children }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** The checklist's fields (the admit dialog and the checklist dialog). value/onChange: the checklist; fields: errors. */
export function ChecklistFields({ value, onChange, fields = {}, idPrefix = 'ck' }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const err = (k) => fields[`checklist.${k}`];
  return (
    <fieldset className="fieldset">
      <legend>Admission checklist</legend>
      <div className="form-grid">
        <Field label="ID proof seen" id={`${idPrefix}-id`} error={err('idProof')}>
          <select id={`${idPrefix}-id`} value={value.idProof} onChange={set('idProof')}>
            <option value="">Choose…</option>
            {ID_PROOF_OPTIONS.map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Its last 4 letters or digits" id={`${idPrefix}-last4`} error={err('idLast4')} hint="Never the whole number.">
          <input id={`${idPrefix}-last4`} maxLength={4} value={value.idLast4} onChange={set('idLast4')} autoComplete="off" />
        </Field>
        <Field label="Attendant's name" id={`${idPrefix}-att`} error={err('attendantName')}>
          <input id={`${idPrefix}-att`} maxLength={100} value={value.attendantName} onChange={set('attendantName')} />
        </Field>
        <Field label="Relation" id={`${idPrefix}-rel`} error={err('attendantRelation')}>
          <input id={`${idPrefix}-rel`} maxLength={40} value={value.attendantRelation} onChange={set('attendantRelation')} />
        </Field>
        <Field label="Attendant's phone" id={`${idPrefix}-ph`} error={err('attendantPhone')}>
          <input id={`${idPrefix}-ph`} inputMode="tel" maxLength={20} value={value.attendantPhone} onChange={set('attendantPhone')} />
        </Field>
        <Field label="Who pays" id={`${idPrefix}-payer`} error={err('payer')}>
          <select id={`${idPrefix}-payer`} value={value.payer} onChange={set('payer')}>
            <option value="">Choose…</option>
            {PAYER_OPTIONS.map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        {PAYER_NAME_LABELS[value.payer] && (
          <Field label={PAYER_NAME_LABELS[value.payer]} id={`${idPrefix}-payername`} error={err('payerName')}>
            <input id={`${idPrefix}-payername`} maxLength={100} value={value.payerName} onChange={set('payerName')} />
          </Field>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={value.consentSigned} onChange={set('consentSigned')} /> The general consent for admission is signed (on the printed admission form)
      </label>
      {err('consentSigned') && <p className="field-error">{err('consentSigned')}</p>}
    </fieldset>
  );
}

/** Complete or change the checklist of a stay (an emergency admitted first). */
export function ChecklistDialog({ stay, onClose, onSaved }) {
  const res = useFetch(`/admission-desk/stays/${stay.id}/papers`);
  const papers = res.data?.papers;
  const [value, setValue] = useState(null);
  const [police, setPolice] = useState(null);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const current = value ?? (papers ? { ...EMPTY_CHECKLIST, ...(papers.checklist ?? papers.checklistDraft ?? {}) } : null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { complete, byName, at, ...answers } = current;
      const out = await api(`/admission-desk/stays/${stay.id}/checklist`, { method: 'PUT', body: { checklist: answers, ...(papers.mlc ? { mlcPolice: police ?? papers.mlcPolice } : {}) } });
      setFields(out.missing);
      if (Object.keys(out.missing).length) setError('Saved. Still missing: see the highlighted fields.');
      else onSaved('The admission checklist is complete.');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal id="ck-dialog" title={`Admission checklist – ${stay.patient.fullName}`} onClose={onClose}>
      <Alert type="error">{res.error || error}</Alert>
      {!current ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <ChecklistFields value={current} onChange={setValue} fields={fields} idPrefix="ckd" />
          {papers.mlc && (
            <Field label="Police station informed (medico-legal case)" id="ckd-police">
              <input id="ckd-police" maxLength={120} value={police ?? papers.mlcPolice} onChange={(e) => setPolice(e.target.value)} />
            </Field>
          )}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy || !res.data?.canEditChecklist} onClick={save}>
              <ClipboardCheck aria-hidden="true" /> {busy ? 'Saving…' : 'Save the checklist'}
            </button>
            <button type="button" className="btn btn-link" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- A doctor's admission request ----------

export function RequestAdmissionDialog({ patient, onClose, onDone }) {
  const [form, setForm] = useState({ reasonCode: 'labour', reasonNote: '', admissionType: 'planned', ward: '', expectedOn: '', note: '' });
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/admission-desk/requests', { method: 'POST', body: { patientId: patient.id, ...form, expectedOn: form.expectedOn || null } });
      onDone('Admission requested. Reception sees it on the bed board and admits her from it.');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };
  return (
    <Modal id="adm-req" title={`Request admission – ${patient.fullName}`} onClose={onClose}>
      <Alert type="error">{error}</Alert>
      <div className="form-grid">
        <Field label="Reason (what reception sees)" id="ar-reason" error={fields.reasonCode}>
          <select id="ar-reason" value={form.reasonCode} onChange={set('reasonCode')}>
            {REASONS.map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label={form.reasonCode === 'other' ? 'Note' : 'Note (optional)'} id="ar-rnote" error={fields.reasonNote}>
          <input id="ar-rnote" maxLength={120} value={form.reasonNote} onChange={set('reasonNote')} />
        </Field>
        <Field label="Admission type" id="ar-type">
          <select id="ar-type" value={form.admissionType} onChange={set('admissionType')}>
            {Object.entries(TYPE_WORDS).map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ward wanted (optional)" id="ar-ward">
          <input id="ar-ward" maxLength={60} value={form.ward} onChange={set('ward')} />
        </Field>
        <Field label="Expected on" id="ar-day" error={fields.expectedOn} hint="Empty = today.">
          <input id="ar-day" type="date" value={form.expectedOn} onChange={set('expectedOn')} />
        </Field>
        <Field label="Note for the desk (no medical details)" id="ar-note" error={fields.note}>
          <input id="ar-note" maxLength={300} value={form.note} onChange={set('note')} />
        </Field>
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={send}>
          <LogIn aria-hidden="true" /> {busy ? 'Sending…' : 'Request admission'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Open requests on the bed board: reception admits from one. */
export function RequestsSection({ data, onAdmit }) {
  if (!data?.requests?.length) return null;
  return (
    <section className="card" aria-labelledby="adm-requests">
      <h2 id="adm-requests">Admission requests ({data.requests.length})</h2>
      <ul className="wl-list">
        {data.requests.map((r) => (
          <li key={r.id}>
            <div className="wl-row-head">
              <span className="wl-who">
                <strong>{r.patient.fullName}</strong>
                <span className="muted tabular">
                  {[r.patient.mrn, r.reason, TYPE_WORDS[r.admissionType], r.ward, r.expectedOn ? `expected ${formatDate(r.expectedOn)}` : 'today'].filter(Boolean).join(' · ')}
                </span>
              </span>
              {onAdmit && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAdmit(r)}>
                  <LogIn aria-hidden="true" /> Admit
                </button>
              )}
            </div>
            <span className="hint">
              Requested by {r.requested.byName}, {formatDateTime(r.requested.at)}
              {r.note ? ` · ${r.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Clearance for leaving and the gate pass ----------

function ClearDialog({ stay, onClose, onCleared }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const dues = stay.balancePaise > 0;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/admission-desk/stays/${stay.id}/clear`, { method: 'POST', body: { note: note.trim() } });
      onCleared(res.papers);
    } catch (err) {
      setError(err.fields?.note ?? err.message);
      setBusy(false);
    }
  };
  return (
    <Modal id="clear" title={`Clear ${stay.patient.fullName} for leaving`} onClose={onClose}>
      <p>{dues ? `${rupees(stay.balancePaise)} is still due on her bill.` : 'Her bill is settled.'}</p>
      <Alert type="error">{error}</Alert>
      <Field label={dues ? 'Why may she leave? (e.g. insurance claim pending)' : 'Note (optional)'} id="clear-note">
        <input id="clear-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Field>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={send}>
          <DoorOpen aria-hidden="true" /> {busy ? 'Saving…' : 'Clear and print the gate pass'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Discharged by the doctor, not cleared yet: the desk clears each for leaving and prints the gate pass. */
export function ToClearSection({ onCleared }) {
  const res = useFetch('/admission-desk/to-clear');
  const [clearing, setClearing] = useState(null);
  if (!res.data?.stays?.length) return null;
  return (
    <section className="card" aria-labelledby="to-clear">
      <h2 id="to-clear">Discharged – to clear for leaving ({res.data.stays.length})</h2>
      <ul className="wl-list">
        {res.data.stays.map((s) => (
          <li key={s.id}>
            <div className="wl-row-head">
              <span className="wl-who">
                <strong>{s.patient.fullName}</strong>
                <span className="muted tabular">{[s.patient.mrn, s.ipdNo, `${s.ward} · ${s.bed}`, `discharged ${formatDateTime(s.dischargedAt)}`].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="wl-counts">
                {s.balancePaise > 0 ? (
                  <StatusPill tone="watch" icon={TriangleAlert}>
                    {rupees(s.balancePaise)} due
                  </StatusPill>
                ) : (
                  <StatusPill tone="stable" icon={ClipboardCheck}>
                    Bill settled
                  </StatusPill>
                )}
                {res.data.canClear && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClearing(s)}>
                    <DoorOpen aria-hidden="true" /> Clear for leaving
                  </button>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {clearing && (
        <ClearDialog
          stay={clearing}
          onClose={() => setClearing(null)}
          onCleared={() => {
            const s = clearing;
            setClearing(null);
            res.reload();
            onCleared?.(s);
          }}
        />
      )}
    </section>
  );
}

// ---------- The printouts ----------

/** The admission form, the wristband or the gate pass of a stay ({ id }). what: 'form' | 'wristband' | 'gatepass'. */
export function StayPaper({ stay, what, onClose }) {
  const res = useFetch(`/admission-desk/stays/${stay.id}/papers`);
  const lh = useFetch(what === 'wristband' ? null : '/tenant/settings/letterhead');
  const record = () => api(`/admission-desk/stays/${stay.id}/printed`, { method: 'POST', body: { what } });
  const p = res.data?.papers;
  const titles = { form: 'Admission form', wristband: 'Wristband', gatepass: 'Gate pass' };
  const ready = p && (what === 'wristband' || lh.data || lh.error);
  return (
    <PrintPreview
      title={`${titles[what]} – print preview`}
      hint={what === 'wristband' ? 'Print on wristband stock or paper, cut along the line and fasten on her wrist.' : 'Check it, then print on A4 paper.'}
      onPrint={record}
      onClose={onClose}
    >
      <Alert type="error">{res.error}</Alert>
      {!ready && !res.error && <p className="muted">Preparing…</p>}
      {ready && what === 'form' && <AdmissionForm p={p} letterhead={lh.data?.letterhead} />}
      {ready && what === 'wristband' && <Wristband p={p} />}
      {ready && what === 'gatepass' && <GatePass p={p} letterhead={lh.data?.letterhead} />}
    </PrintPreview>
  );
}

function SignLine({ label }) {
  return (
    <div className="pdoc-sig-line">
      <span className="pdoc-sig-label">{label}</span>
      <span className="pdoc-sig-fill" />
    </div>
  );
}

export function AdmissionForm({ p, letterhead }) {
  const c = p.checklist;
  return (
    <PrintDocument className="adm-form">
      {letterhead && <Letterhead letterhead={letterhead} />}
      <h1 className="pdoc-title">Admission form</h1>
      {p.ipdNo && <Barcode value={p.ipdNo} height={8} className="adm-barcode" />}
      <PrintFacts
        items={[
          ['IPD number', p.ipdNo ?? ''],
          ['Patient', p.patient.fullName],
          ['Patient number', p.patient.mrn],
          ['Age', p.patient.age != null ? `${p.patient.age} years` : ''],
          ['Phone', p.patient.phone],
          ['Address', p.patient.address, true],
          ['Admitted', formatDateTime(p.admittedAt)],
          ['Admission type', TYPE_WORDS[p.admissionType] ?? ''],
          ['Ward and bed', [p.ward, p.bed].filter(Boolean).join(' · ')],
          ['Doctor', p.patient.doctorName],
          ['Reason', p.reason ?? ''],
          ['Medico-legal case', p.mlc ? `Yes${p.mlcPolice ? ` – police: ${p.mlcPolice}` : ''}` : 'No'],
          ['ID proof seen', idWords(c)],
          ['Who pays', payerWords(c)],
          ['Attendant', c?.attendantName ? [c.attendantName, c.attendantRelation, c.attendantPhone].filter(Boolean).join(' · ') : '', true],
          ['Admitted by', p.admittedByName],
        ]}
      />
      <h2 className="pdoc-sig-title">General consent for admission</h2>
      <p className="pdoc-small">
        I agree to be admitted to this hospital and to the routine care, nursing, tests and treatment that the doctors consider needed. Any operation, anaesthesia,
        blood transfusion or special procedure will be explained to me and needs my separate written consent. I have been told about the hospital's rules, charges
        and visiting hours, and that I may ask questions at any time. (DRAFT wording – for the hospital to check.)
      </p>
      <div className="pdoc-sigs">
        <div className="pdoc-sig">
          <h2 className="pdoc-sig-title">Patient (or attendant for her)</h2>
          <SignLine label="Signature or thumb impression" />
          <SignLine label="Name, relation and date" />
        </div>
        <div className="pdoc-sig">
          <h2 className="pdoc-sig-title">For the hospital</h2>
          <SignLine label="Signature" />
          <SignLine label="Name and date" />
        </div>
      </div>
    </PrintDocument>
  );
}

export function Wristband({ p }) {
  return (
    <PrintDocument className="adm-wristband">
      <div className="wristband">
        <div className="wristband-text">
          <strong>{p.patient.fullName}</strong>
          <span>
            {p.patient.age != null ? `${p.patient.age} yrs · ` : ''}
            {p.patient.mrn} · {p.ipdNo ?? ''}
          </span>
          <span>
            {p.patient.doctorName ? `${p.patient.doctorName} · ` : ''}Admitted {formatDate(p.admittedAt)}
          </span>
          <span>{p.medical ? `Blood group: ${p.patient.bloodGroup || 'not recorded'} · Allergies: ${p.patient.allergies || 'none recorded'}` : 'Blood group and allergies: see the record'}</span>
        </div>
        {p.ipdNo && <Barcode value={p.ipdNo} height={9} className="wristband-code" />}
      </div>
    </PrintDocument>
  );
}

export function GatePass({ p, letterhead }) {
  const g = p.clearance;
  return (
    <PrintDocument className="adm-gatepass">
      {letterhead && <Letterhead letterhead={letterhead} />}
      <h1 className="pdoc-title">Gate pass</h1>
      {g ? (
        <PrintFacts
          items={[
            ['Gate pass number', g.passNo],
            ['IPD number', p.ipdNo ?? ''],
            ['Patient', p.patient.fullName],
            ['Patient number', p.patient.mrn],
            ['Ward and bed', [p.ward, p.bed].filter(Boolean).join(' · ')],
            ['Discharged', p.dischargedAt ? formatDateTime(p.dischargedAt) : ''],
            ['Cleared by', `${g.byName}, ${formatDateTime(g.at)}`],
            ['Bill', g.balancePaise > 0 ? `${rupees(g.balancePaise)} due – ${g.note}` : 'Settled'],
          ]}
        />
      ) : (
        <p>Not cleared for leaving yet.</p>
      )}
      <div className="pdoc-sigs">
        <div className="pdoc-sig">
          <h2 className="pdoc-sig-title">Security desk</h2>
          <SignLine label="Checked by, time" />
        </div>
      </div>
    </PrintDocument>
  );
}

/** The OPD case paper of today's visit: the OPD number, her token or time, doctor and details, and space to write. */
export function OpdCasePaper({ patientId, onClose }) {
  const res = useFetch(`/arrivals/${patientId}/case-paper`);
  const lh = useFetch('/tenant/settings/letterhead');
  const p = res.data?.paper;
  const record = () => api(`/arrivals/${patientId}/case-paper/printed`, { method: 'POST', body: {} });
  return (
    <PrintPreview title="OPD case paper – print preview" hint="Print on A4 paper for the doctor to write on." onPrint={record} onClose={onClose}>
      <Alert type="error">{res.error}</Alert>
      {(!p || (!lh.data && !lh.error)) && !res.error && <p className="muted">Preparing…</p>}
      {p && (lh.data || lh.error) && (
        <PrintDocument className="opd-paper">
          {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} />}
          <h1 className="pdoc-title">OPD case paper</h1>
          <Barcode value={p.opdNo} height={8} className="adm-barcode" />
          <PrintFacts
            items={[
              ['OPD number', p.opdNo],
              ['Date', formatDate(p.date)],
              [p.token != null ? 'Token' : 'Time', p.token != null ? String(p.token) : (p.time ?? '')],
              ['Doctor', p.doctorName],
              ['Patient', p.patient.fullName],
              ['Patient number', p.patient.mrn],
              ['Age', p.patient.age != null ? `${p.patient.age} years` : ''],
              ['Phone', p.patient.phone],
              ['Address', p.patient.address, true],
            ]}
          />
          {['Complaints', 'Examination (BP, pulse, weight …)', 'Diagnosis', 'Advice and medicines', 'Next visit'].map((h) => (
            <div key={h} className="opd-space">
              <h2 className="pdoc-sig-title">{h}</h2>
              <div className="opd-lines" />
            </div>
          ))}
        </PrintDocument>
      )}
    </PrintPreview>
  );
}

/** The stay's paper buttons on the bed board (admission form, wristband, checklist). */
export function StayPaperButtons({ stay, onPaper, onChecklist }) {
  return (
    <>
      <button type="button" className="btn btn-link btn-sm" onClick={() => onPaper('form')}>
        <FileText aria-hidden="true" /> Form
      </button>
      <button type="button" className="btn btn-link btn-sm" onClick={() => onPaper('wristband')}>
        <Tag aria-hidden="true" /> Wristband
      </button>
      {stay.checklistIncomplete && onChecklist && (
        <button type="button" className="btn btn-link btn-sm" onClick={onChecklist}>
          <ClipboardCheck aria-hidden="true" /> Checklist
        </button>
      )}
    </>
  );
}
