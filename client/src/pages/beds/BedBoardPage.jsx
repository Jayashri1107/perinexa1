import { useState } from 'react';
import { ArrowRightLeft, BedDouble, Check, CircleSlash, LogIn, Receipt, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDateTime, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { REASONS, freeBeds, nowLocal } from './bedFormat.js';

// The bed board (owner, 13 Oct 2026 – docs/RECEPTION_ADMISSION_PLAN.md): each ward's beds, free or occupied, with who
// is in each bed, her doctor, since when and – as the server allows – the reason. Reception, doctors and RMOs admit a
// patient to a free bed; reception, nurses, her doctor and RMOs move her to another bed. A stay ends as before, when a
// doctor confirms the discharge card. Patients admitted from their record without a bed from the list are listed
// below the wards.

function Modal({ id, title, onClose, children }) {
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

export function BedBoardPage() {
  const { activeMembership } = useAuth();
  const board = useFetch('/beds');
  const [admitTo, setAdmitTo] = useState(null); // a free bed { id, ward, name }
  const [moving, setMoving] = useState(null); // { stay, from }
  const [slip, setSlip] = useState(null); // { patient, ward, bed, admittedAt }
  const [notice, setNotice] = useState(null);
  const data = board.data;
  const canBill = hasRole(activeMembership, 'receptionist');
  const free = freeBeds(data?.wards);

  const admitted = (info) => {
    setAdmitTo(null);
    setNotice(`${info.patient.fullName} is admitted to ${info.ward} · ${info.bed}.`);
    setSlip(info);
    board.reload();
  };
  const moved = (info) => {
    setMoving(null);
    setNotice(`${info.patient.fullName} is now in ${info.ward} · ${info.bed}.`);
    board.reload();
  };

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Beds' }]} title="Beds" subtitle="Who is in which bed, and which beds are free." />
      <div className="pf-content beds-page">
        <Alert type="error">{board.error}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        {!data && !board.error && (
          <div className="card plan-loading" aria-busy="true">
            <span className="sr-only">Loading the beds…</span>
            <span className="plan-skeleton" />
            <span className="plan-skeleton" />
          </div>
        )}
        {data && (
          <>
            <div className="beds-counts" role="list" aria-label="Beds today">
              <div className="beds-count" role="listitem">
                <span className="beds-count-n tabular">{data.counts.total}</span>
                <span>beds in use</span>
              </div>
              <div className="beds-count is-free" role="listitem">
                <span className="beds-count-n tabular">{data.counts.free}</span>
                <span>free</span>
              </div>
              <div className="beds-count is-occupied" role="listitem">
                <span className="beds-count-n tabular">{data.counts.occupied}</span>
                <span>occupied</span>
              </div>
            </div>

            {data.wards.length === 0 && (
              <div className="card beds-empty">
                <BedDouble aria-hidden="true" />
                <div>
                  <h2>No beds set up yet</h2>
                  <p className="muted">The hospital admin adds the wards and their beds in Hospital admin → Beds. Patients can still be admitted from their record.</p>
                </div>
              </div>
            )}

            {data.wards.map((w) => (
              <section key={w.ward} className="card beds-ward" aria-labelledby={`ward-${w.ward}`}>
                <header className="beds-ward-head">
                  <h2 id={`ward-${w.ward}`}>{w.ward}</h2>
                  <span className="muted tabular">
                    {w.beds.filter((b) => !b.stay && b.active).length} of {w.beds.filter((b) => b.active).length} free
                  </span>
                </header>
                <ul className="beds-grid">
                  {w.beds.map((b) => (
                    <li key={b.id} className={`bed ${b.stay ? 'is-occupied' : b.active ? 'is-free' : 'is-off'}`}>
                      <div className="bed-head">
                        <strong className="bed-name">{b.name}</strong>
                        {b.stay ? (
                          <StatusPill tone="admitted" icon={User}>
                            Occupied
                          </StatusPill>
                        ) : b.active ? (
                          <StatusPill tone="stable" icon={Check}>
                            Free
                          </StatusPill>
                        ) : (
                          <StatusPill tone="inactive" icon={CircleSlash}>
                            Not in use
                          </StatusPill>
                        )}
                      </div>
                      {b.stay ? (
                        <Occupant stay={b.stay} canBill={canBill} onMove={free.length ? () => setMoving({ stay: b.stay, from: `${w.ward} · ${b.name}` }) : null} />
                      ) : (
                        b.active &&
                        data.canAdmit && (
                          <button type="button" className="btn btn-secondary btn-sm bed-action" onClick={() => setAdmitTo({ id: b.id, ward: w.ward, name: b.name })}>
                            <LogIn aria-hidden="true" /> Admit here
                          </button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {data.elsewhere.length > 0 && (
              <section className="card beds-ward" aria-labelledby="beds-elsewhere">
                <header className="beds-ward-head">
                  <h2 id="beds-elsewhere">Admitted without a bed from the list</h2>
                  <span className="muted">Choose a bed for them with "Move to a bed".</span>
                </header>
                <ul className="beds-grid">
                  {data.elsewhere.map((s) => (
                    <li key={s.id} className="bed is-occupied">
                      <div className="bed-head">
                        <strong className="bed-name">{[s.ward, s.bed].filter(Boolean).join(' · ') || 'No bed written'}</strong>
                        <StatusPill tone="admitted" icon={User}>
                          Admitted
                        </StatusPill>
                      </div>
                      <Occupant stay={s} canBill={canBill} moveLabel="Move to a bed" onMove={free.length ? () => setMoving({ stay: s, from: [s.ward, s.bed].filter(Boolean).join(' · ') }) : null} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      {admitTo && <AdmitDialog bed={admitTo} onClose={() => setAdmitTo(null)} onAdmitted={admitted} />}
      {moving && <MoveDialog stay={moving.stay} from={moving.from} beds={free} onClose={() => setMoving(null)} onMoved={moved} />}
      {slip && <AdmissionSlip info={slip} onClose={() => setSlip(null)} />}
    </>
  );
}

/** Who is in the bed: name (a link to her record), patient number, doctor, since when, the reason when shown. */
function Occupant({ stay, canBill, onMove, moveLabel = 'Move' }) {
  const p = stay.patient;
  return (
    <div className="bed-who">
      <Link to={`/patients/${p.id}`} className="bed-patient">
        {p.fullName}
      </Link>
      <span className="muted">
        {p.mrn}
        {p.assignedDoctorName ? ` · ${p.assignedDoctorName}` : ''}
      </span>
      <span className="muted">Since {formatDateTime(stay.admittedAt)}</span>
      {stay.reason && <span className="bed-reason">{stay.reason}</span>}
      {p.closed && <span className="muted">Record closed</span>}
      <div className="bed-actions">
        {stay.canMove && onMove && (
          <button type="button" className="btn btn-link btn-sm" onClick={onMove}>
            <ArrowRightLeft aria-hidden="true" /> {moveLabel}
          </button>
        )}
        {canBill && (
          <Link to={`/patients/${p.id}/bills`} className="btn btn-link btn-sm">
            <Receipt aria-hidden="true" /> Bill
          </Link>
        )}
      </div>
    </div>
  );
}

function AdmitDialog({ bed, onClose, onAdmitted }) {
  const [patient, setPatient] = useState(null);
  const [form, setForm] = useState({ reasonCode: 'labour', reasonNote: '', admittedAt: nowLocal() });
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const blocked = patient && (patient.duplicateOf || patient.closed);

  const send = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const body = { clientRequestId, patientId: patient.id, reasonCode: form.reasonCode, reasonNote: form.reasonNote.trim(), admittedAt: form.admittedAt ? new Date(form.admittedAt).toISOString() : '' };
      const { admission } = await api(`/beds/${bed.id}/admit`, { method: 'POST', body });
      onAdmitted({ patient, ward: admission.ward, bed: admission.bed, admittedAt: admission.admittedAt });
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal id="bed-admit" title="Admit a patient" onClose={onClose}>
      <p className="appt-when">
        <BedDouble aria-hidden="true" /> {bed.ward} · {bed.name}
      </p>
      <Alert type="error">{error}</Alert>
      {!patient && <PatientFinder onPick={setPatient} />}
      {patient && (
        <>
          <div className="appt-chosen">
            <strong>{patient.fullName}</strong>
            <span className="muted">
              {patient.mrn}
              {patient.assignedDoctorName ? ` · ${patient.assignedDoctorName}` : ''}
            </span>
            <button type="button" className="btn btn-link btn-sm" onClick={() => setPatient(null)}>
              Choose someone else
            </button>
          </div>
          {blocked && <Alert type="warning">{patient.duplicateOf ? `This record is a duplicate: choose ${patient.duplicateOf.mrn} instead.` : 'This record is closed: it takes no admission.'}</Alert>}
          <div className="form-grid">
            <Field label="Reason for admission" id="bed-reason" error={fields.reasonCode} hint="Choose from the list – no medical details here.">
              <select id="bed-reason" value={form.reasonCode} onChange={set('reasonCode')}>
                {REASONS.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={form.reasonCode === 'other' ? 'Note' : 'Note (optional)'} id="bed-note" error={fields.reasonNote} hint="A few words, e.g. sent from the OPD.">
              <input id="bed-note" value={form.reasonNote} onChange={set('reasonNote')} maxLength={120} />
            </Field>
            <Field label="Admitted at" id="bed-at" error={fields.admittedAt}>
              <input id="bed-at" type="datetime-local" value={form.admittedAt} onChange={set('admittedAt')} max={nowLocal()} />
            </Field>
          </div>
          <p className="hint">Her bill for the stay opens with this ward's bed charge. The RMO writes the admission notes.</p>
        </>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!patient || blocked || busy} onClick={send}>
          <LogIn aria-hidden="true" /> {busy ? 'Admitting…' : 'Admit'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function MoveDialog({ stay, from, beds, onClose, onMoved }) {
  const [bedId, setBedId] = useState(beds[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const { admission } = await api(`/beds/stays/${stay.id}/move`, { method: 'POST', body: { bedId } });
      onMoved({ patient: stay.patient, ward: admission.ward, bed: admission.bed });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal id="bed-move" title={`Move ${stay.patient.fullName}`} onClose={onClose}>
      {from && <p className="muted">Now in {from}</p>}
      <Alert type="error">{error}</Alert>
      <Field label="To the free bed" id="bed-to">
        <select id="bed-to" value={bedId} onChange={(e) => setBedId(e.target.value)} autoFocus>
          {beds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!bedId || busy} onClick={send}>
          <ArrowRightLeft aria-hidden="true" /> {busy ? 'Moving…' : 'Move'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** The admission slip: hospital, patient, doctor, ward, bed and date – nothing medical. */
function AdmissionSlip({ info, onClose }) {
  const lh = useFetch('/tenant/settings/letterhead');
  return (
    <PrintPreview title="Admission slip – print preview" hint="For the patient and the ward. It has no medical details." page={{ size: 'A5', margin: '10mm' }} onClose={onClose}>
      <Alert type="error">{lh.error}</Alert>
      {!lh.data && !lh.error && <p className="muted">Preparing the slip…</p>}
      {lh.data && (
        <PrintDocument className="bed-slip">
          {lh.data.letterhead && <Letterhead letterhead={lh.data.letterhead} />}
          <h1 className="pdoc-title">Admission slip</h1>
          <PrintFacts
            items={[
              ['Name', info.patient.fullName],
              ['Patient number', info.patient.mrn],
              ['Doctor', info.patient.assignedDoctorName ?? ''],
              ['Ward', info.ward],
              ['Bed', info.bed],
              ['Admitted', formatDateTime(info.admittedAt)],
            ]}
          />
        </PrintDocument>
      )}
    </PrintPreview>
  );
}
