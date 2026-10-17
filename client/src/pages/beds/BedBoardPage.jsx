import { useState } from 'react';
import { ArrowRightLeft, BedDouble, BedSingle, Building2, Check, ChevronDown, ChevronUp, CircleSlash, Eye, LogIn, Plus, Receipt, Search, User, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDateTime, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { canRegisterPatients } from '../../platform/modules.js';
import { AdmitRegister } from './AdmitRegister.jsx';
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

const DAY_MS = 86_400_000;
/** "Less than a day", "1 day", "3 days" – how long she has been in (from the admission time). */
export function stayLength(admittedAt, now = Date.now()) {
  const days = Math.floor((now - new Date(admittedAt).getTime()) / DAY_MS);
  return days < 1 ? 'Less than a day' : days === 1 ? '1 day' : `${days} days`;
}
const STATUS_FILTERS = [
  ['', 'All beds'],
  ['free', 'Available'],
  ['occupied', 'Occupied'],
  ['off', 'Not in use'],
];
const bedState = (b) => (b.stay ? 'occupied' : b.active ? 'free' : 'off');

export function BedBoardPage() {
  const { activeMembership } = useAuth();
  const board = useFetch('/beds');
  const [admitTo, setAdmitTo] = useState(null); // a free bed { id, ward, name }, or 'any' (the bed is chosen in the dialog)
  const [moving, setMoving] = useState(null); // { stay, from }
  const [slip, setSlip] = useState(null); // { patient, ward, bed, admittedAt }
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState('');
  const [wardFilter, setWardFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [folded, setFolded] = useState(() => new Set()); // wards closed by the person
  const data = board.data;
  const canBill = hasRole(activeMembership, 'receptionist');
  const free = freeBeds(data?.wards);
  const notInUse = (data?.wards ?? []).reduce((n, w) => n + w.beds.filter((b) => !b.active).length, 0);

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
  const toggle = (ward) =>
    setFolded((cur) => {
      const next = new Set(cur);
      if (next.has(ward)) next.delete(ward);
      else next.add(ward);
      return next;
    });
  // Search: the bed's name, or the patient's name or number
  const q = search.trim().toLowerCase();
  const shows = (b) =>
    (!statusFilter || bedState(b) === statusFilter) &&
    (!q || b.name.toLowerCase().includes(q) || b.stay?.patient.fullName.toLowerCase().includes(q) || b.stay?.patient.mrn.toLowerCase().includes(q));
  const wards = (data?.wards ?? []).filter((w) => !wardFilter || w.ward === wardFilter).map((w) => ({ ...w, shown: w.beds.filter(shows) }));
  const filtering = Boolean(q || statusFilter || wardFilter);

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Beds' }]} title="Beds" subtitle="Occupancy, available beds and who is staying, at a glance." />
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
            <div className="beds-stats" role="list" aria-label="Beds today">
              {[
                ['total', BedDouble, 'Total beds', data.counts.total],
                ['occupied', Users, 'Occupied', data.counts.occupied],
                ['free', BedSingle, 'Available', data.counts.free],
                ['off', CircleSlash, 'Not in use', notInUse],
              ].map(([key, Icon, label, n]) => (
                <div key={key} className={`card beds-stat is-${key}`} role="listitem">
                  <span className="beds-stat-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="beds-stat-text">
                    <span>{label}</span>
                    <strong className="tabular">{n}</strong>
                  </span>
                </div>
              ))}
            </div>

            <div className="card beds-filters">
              <label className="beds-search">
                <Search aria-hidden="true" />
                <span className="sr-only">Search</span>
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by bed, patient name or number" />
              </label>
              <label className="dt-filter">
                <span className="dt-filter-label">Ward</span>
                <select value={wardFilter} onChange={(e) => setWardFilter(e.target.value)}>
                  <option value="">All wards</option>
                  {data.wards.map((w) => (
                    <option key={w.ward} value={w.ward}>
                      {w.ward}
                    </option>
                  ))}
                </select>
              </label>
              <label className="dt-filter">
                <span className="dt-filter-label">Status</span>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  {STATUS_FILTERS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {data.canAdmit && (
                <button type="button" className="btn btn-primary beds-register" onClick={() => setAdmitTo('any')} disabled={!free.length}>
                  <Plus aria-hidden="true" /> Register admission
                </button>
              )}
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
            {filtering && wards.every((w) => !w.shown.length) && <p className="muted">No bed matches the search or filters.</p>}

            {wards
              .filter((w) => w.shown.length || !filtering)
              .map((w) => {
                const inUse = w.beds.filter((b) => b.active);
                const occupied = w.beds.filter((b) => b.stay).length;
                const open = !folded.has(w.ward);
                const id = `ward-${w.ward.replace(/\W+/g, '-')}`;
                return (
                  <section key={w.ward} className="card beds-ward" aria-labelledby={id}>
                    <header className="beds-ward-head">
                      <span className="beds-ward-icon" aria-hidden="true">
                        <Building2 />
                      </span>
                      <h2 id={id}>{w.ward}</h2>
                      <span className="muted tabular beds-ward-counts">
                        {inUse.length} {inUse.length === 1 ? 'bed' : 'beds'} · {occupied} occupied · {Math.max(0, inUse.length - occupied)} available
                      </span>
                      <button
                        type="button"
                        className="icon-btn beds-fold"
                        aria-expanded={open}
                        aria-controls={`${id}-beds`}
                        aria-label={open ? `Fold ${w.ward}` : `Open ${w.ward}`}
                        onClick={() => toggle(w.ward)}
                      >
                        {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                      </button>
                    </header>
                    {open && (
                      <ul className="beds-grid" id={`${id}-beds`}>
                        {w.shown.map((b) => (
                          <li key={b.id} className={`bed is-${bedState(b)}`}>
                            <div className="bed-head">
                              <span className="bed-title">
                                <strong className="bed-name">{b.name}</strong>
                                <span className="bed-ward">{w.ward}</span>
                              </span>
                              {b.stay ? (
                                <StatusPill tone="admitted" icon={User}>
                                  Occupied
                                </StatusPill>
                              ) : b.active ? (
                                <StatusPill tone="stable" icon={Check}>
                                  Available
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
                              <>
                                <BedSingle className="bed-picture" aria-hidden="true" />
                                {b.active && data.canAdmit && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm bed-action"
                                    onClick={() => setAdmitTo({ id: b.id, ward: w.ward, name: b.name })}
                                    aria-label={`Admit a patient to ${w.ward} ${b.name}`}
                                  >
                                    <Plus aria-hidden="true" /> Admit
                                  </button>
                                )}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}

            {data.elsewhere.length > 0 && !filtering && (
              <section className="card beds-ward" aria-labelledby="beds-elsewhere">
                <header className="beds-ward-head">
                  <span className="beds-ward-icon" aria-hidden="true">
                    <BedDouble />
                  </span>
                  <h2 id="beds-elsewhere">Admitted without a bed from the list</h2>
                  <span className="muted beds-ward-counts">Choose a bed for them with "Move to a bed".</span>
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
      {admitTo && <AdmitDialog bed={admitTo === 'any' ? null : admitTo} onClose={() => setAdmitTo(null)} onAdmitted={admitted} />}
      {moving && <MoveDialog stay={moving.stay} from={moving.from} beds={free} onClose={() => setMoving(null)} onMoved={moved} />}
      {slip && <AdmissionSlip info={slip} onClose={() => setSlip(null)} />}
    </>
  );
}

/** Who is in the bed: name (a link to her record), patient number, doctor, since when, the reason when shown. */
function Occupant({ stay, canBill, onMove, moveLabel = 'Transfer' }) {
  const p = stay.patient;
  return (
    <div className="bed-who">
      <strong className="bed-patient">{p.fullName}</strong>
      <span className="muted">
        {p.mrn}
        {p.assignedDoctorName ? ` · ${p.assignedDoctorName}` : ''}
      </span>
      <span className="muted">Admitted {formatDateTime(stay.admittedAt)}</span>
      <span className="bed-stay">Stay: {stayLength(stay.admittedAt)}</span>
      {stay.reason && <span className="bed-reason">{stay.reason}</span>}
      {p.closed && <span className="muted">Record closed</span>}
      <div className="bed-actions">
        <Link to={`/patients/${p.id}`} className="btn btn-link btn-sm">
          <Eye aria-hidden="true" /> View
        </Link>
        {canBill && (
          <Link to={`/patients/${p.id}/bills`} className="btn btn-link btn-sm">
            <Receipt aria-hidden="true" /> Bill
          </Link>
        )}
        {stay.canMove && onMove && (
          <button type="button" className="btn btn-link btn-sm" onClick={onMove}>
            <ArrowRightLeft aria-hidden="true" /> {moveLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Admit a patient: to the bed clicked on the board (bed), or – from her record (patient) – to a free bed chosen here.
 */
export function AdmitDialog({ bed: fixedBed = null, patient: preset = null, onClose, onAdmitted }) {
  const { activeMembership } = useAuth();
  const [patient, setPatient] = useState(preset);
  const freeList = useFetch(fixedBed ? null : '/beds', { free: '1' });
  const [bedId, setBedId] = useState('');
  const bed = fixedBed ?? freeList.data?.beds.find((b) => b.id === (bedId || freeList.data.beds[0]?.id)) ?? null;
  const [form, setForm] = useState({ reasonCode: 'labour', reasonNote: '', admittedAt: nowLocal(), admissionType: 'planned', mlc: false });
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
      const body = { clientRequestId, patientId: patient.id, reasonCode: form.reasonCode, reasonNote: form.reasonNote.trim(), admissionType: form.admissionType, mlc: form.mlc, admittedAt: form.admittedAt ? new Date(form.admittedAt).toISOString() : '' };
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
        <BedDouble aria-hidden="true" /> {fixedBed ? `${fixedBed.ward} · ${fixedBed.name}` : 'Choose a free bed'}
      </p>
      {!fixedBed && (
        <>
          <Alert type="error">{freeList.error}</Alert>
          {freeList.data && freeList.data.beds.length === 0 && <Alert type="warning">There is no free bed. Free a bed first, or ask the hospital admin to add beds (Hospital admin → Beds).</Alert>}
          {freeList.data?.beds.length > 0 && (
            <Field label="Bed" id="bed-pick">
              <select id="bed-pick" value={bed?.id ?? ''} onChange={(e) => setBedId(e.target.value)}>
                {freeList.data.beds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
      <Alert type="error">{error}</Alert>
      {!patient && <PatientFinder onPick={setPatient} />}
      {!patient && canRegisterPatients(activeMembership?.roles ?? []) && <AdmitRegister onRegistered={setPatient} />}
      {patient && (
        <>
          <div className="appt-chosen">
            <strong>{patient.fullName}</strong>
            <span className="muted">
              {patient.mrn}
              {patient.assignedDoctorName ? ` · ${patient.assignedDoctorName}` : ''}
            </span>
            {!preset && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => setPatient(null)}>
                Choose someone else
              </button>
            )}
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
            <Field label="Admission type" id="bed-type" error={fields.admissionType}>
              <select id="bed-type" value={form.admissionType} onChange={set('admissionType')}>
                <option value="planned">Planned</option>
                <option value="emergency">Emergency</option>
                <option value="day_care">Day care</option>
              </select>
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.mlc} onChange={(e) => setForm({ ...form, mlc: e.target.checked })} /> Medico-legal case (MLC) – e.g. an
            accident, assault, burns or poisoning; the police are informed as the hospital's rules say
          </label>
          <p className="hint">Her bill for the stay opens with this ward's bed charge. The RMO writes the admission notes.</p>
        </>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!patient || !bed || blocked || busy} onClick={send}>
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
export function AdmissionSlip({ info, onClose }) {
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
