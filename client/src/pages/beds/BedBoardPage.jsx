import { useState } from 'react';
import { ArrowRightLeft, BedDouble, BedSingle, Building2, Check, ChevronDown, ChevronUp, CircleSlash, ClipboardList, Eye, FileText, LogIn, Plus, Receipt, Search, Tag, User, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDateTime, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { canRegisterPatients } from '../../platform/modules.js';
import { AdmitRegister } from './AdmitRegister.jsx';
import { REASONS, freeBeds, nowLocal } from './bedFormat.js';
import { ChecklistDialog, ChecklistFields, EMPTY_CHECKLIST, RequestsSection, StayPaper, ToClearSection, checklistFromPatient } from './AdmissionDesk.jsx';
import { ExportButton } from '../../components/ExportButton.jsx';

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
  // Admission like a hospital system (docs/ADMISSION_DESK_PLAN.md): doctors' requests, papers, the checklist
  const requests = useFetch('/admission-desk/requests');
  const [fromRequest, setFromRequest] = useState(null); // a request reception admits from
  const [paper, setPaper] = useState(null); // { stay, what }
  const [checking, setChecking] = useState(null); // a stay whose checklist is completed
  const data = board.data;
  const canBill = hasRole(activeMembership, 'receptionist');
  const free = freeBeds(data?.wards);
  const notInUse = (data?.wards ?? []).reduce((n, w) => n + w.beds.filter((b) => !b.active).length, 0);

  const admitted = (info) => {
    setAdmitTo(null);
    setFromRequest(null);
    setNotice(`${info.patient.fullName} is admitted to ${info.ward} · ${info.bed}${info.ipdNo ? ` – IPD number ${info.ipdNo}` : ''}.${info.checklistComplete === false ? ' Complete her admission checklist (Checklist on her bed).' : ''}`);
    setSlip(info);
    board.reload();
    requests.reload();
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

  const occupiedN = data?.counts.occupied ?? 0;
  const inUseN = (data?.counts.total ?? 0) - notInUse;
  const pct = inUseN ? Math.round((occupiedN / inUseN) * 100) : 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Beds' }]}
        title="Beds"
        subtitle="Who is in which bed, and which beds are free."
        actions={
          <>
            <ExportButton what="admissions" />
            {data?.canAdmit && (
              <button type="button" className="btn btn-primary" onClick={() => setAdmitTo('any')} disabled={!free.length} title={free.length ? undefined : 'No bed is free'}>
                <Plus aria-hidden="true" /> Admit a patient
              </button>
            )}
          </>
        }
      />
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
            {/* Redesigned (owner, 27 Oct 2026): one summary, one row of filters, simple bed tiles with one Actions menu */}
            <section className="card bb-summary" aria-label="Beds today">
              <div className="bb-occupancy">
                <span className="bb-occupancy-text">
                  <strong className="tabular">{occupiedN}</strong> of <strong className="tabular">{inUseN}</strong> beds occupied
                </span>
                <span className="bb-meter" role="img" aria-label={`${pct}% of the beds in use are occupied`}>
                  <span style={{ width: `${pct}%` }} />
                </span>
              </div>
              <ul className="bb-counts">
                <li className="is-free">
                  <BedSingle aria-hidden="true" /> <strong className="tabular">{data.counts.free}</strong> free
                </li>
                <li className="is-occupied">
                  <Users aria-hidden="true" /> <strong className="tabular">{occupiedN}</strong> occupied
                </li>
                {notInUse > 0 && (
                  <li className="is-off">
                    <CircleSlash aria-hidden="true" /> <strong className="tabular">{notInUse}</strong> not in use
                  </li>
                )}
              </ul>
            </section>

            <div className="bb-toolbar">
              <div className="segmented" role="group" aria-label="Show">
                {STATUS_FILTERS.filter(([k]) => k !== 'off' || notInUse > 0).map(([k, label]) => (
                  <button key={k || 'all'} type="button" aria-pressed={statusFilter === k} onClick={() => setStatusFilter(k)}>
                    {label}
                  </button>
                ))}
              </div>
              {data.wards.length > 1 && (
                <label className="bb-ward-pick">
                  <span className="sr-only">Ward</span>
                  <select value={wardFilter} onChange={(e) => setWardFilter(e.target.value)}>
                    <option value="">All wards</option>
                    {data.wards.map((w) => (
                      <option key={w.ward} value={w.ward}>
                        {w.ward}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="beds-search bb-search">
                <Search aria-hidden="true" />
                <span className="sr-only">Search</span>
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bed, patient name or number" />
              </label>
            </div>

            <RequestsSection data={requests.data} onAdmit={data.canAdmit && free.length ? (r) => setFromRequest(r) : null} />
            <ToClearSection onCleared={(s) => setPaper({ stay: s, what: 'gatepass' })} />

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
                const wardPct = inUse.length ? Math.round((occupied / inUse.length) * 100) : 0;
                return (
                  <section key={w.ward} className="card bb-ward" aria-labelledby={id}>
                    <button type="button" className="bb-ward-head" aria-expanded={open} aria-controls={`${id}-beds`} onClick={() => toggle(w.ward)}>
                      <Building2 className="bb-ward-icon" aria-hidden="true" />
                      <h2 id={id}>{w.ward}</h2>
                      <span className="bb-ward-counts tabular">
                        {occupied} of {inUse.length} occupied · {Math.max(0, inUse.length - occupied)} free
                      </span>
                      <span className="bb-meter bb-meter-sm" aria-hidden="true">
                        <span style={{ width: `${wardPct}%` }} />
                      </span>
                      {open ? <ChevronUp className="bb-chevron" aria-hidden="true" /> : <ChevronDown className="bb-chevron" aria-hidden="true" />}
                    </button>
                    {open && (
                      <ul className="bb-grid" id={`${id}-beds`}>
                        {w.shown.map((b) => (
                          <li key={b.id} className={`bb-bed is-${bedState(b)}`}>
                            {b.stay ? (
                              <Occupant
                                bedName={b.name}
                                stay={b.stay}
                                canBill={canBill}
                                onMove={free.length ? () => setMoving({ stay: b.stay, from: `${w.ward} · ${b.name}` }) : null}
                                onPaper={(what) => setPaper({ stay: b.stay, what })}
                                onChecklist={() => setChecking(b.stay)}
                              />
                            ) : (
                              <>
                                <span className="bb-bed-top">
                                  <strong className="bb-bed-name">{b.name}</strong>
                                  {b.active ? (
                                    <StatusPill tone="stable" icon={Check}>
                                      Free
                                    </StatusPill>
                                  ) : (
                                    <StatusPill tone="inactive" icon={CircleSlash}>
                                      Not in use
                                    </StatusPill>
                                  )}
                                </span>
                                {b.active && data.canAdmit && (
                                  <button type="button" className="btn btn-secondary btn-sm bb-admit" onClick={() => setAdmitTo({ id: b.id, ward: w.ward, name: b.name })} aria-label={`Admit a patient to ${w.ward} ${b.name}`}>
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
              <section className="card bb-ward" aria-labelledby="beds-elsewhere">
                <div className="bb-ward-head is-static">
                  <BedDouble className="bb-ward-icon" aria-hidden="true" />
                  <h2 id="beds-elsewhere">Admitted without a bed from the list</h2>
                  <span className="bb-ward-counts">Choose a bed for them with "Move to a bed".</span>
                </div>
                <ul className="bb-grid">
                  {data.elsewhere.map((s) => (
                    <li key={s.id} className="bb-bed is-occupied">
                      <Occupant bedName={[s.ward, s.bed].filter(Boolean).join(' · ') || 'No bed written'} stay={s} canBill={canBill} moveLabel="Move to a bed" onMove={free.length ? () => setMoving({ stay: s, from: [s.ward, s.bed].filter(Boolean).join(' · ') }) : null} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      {admitTo && <AdmitDialog bed={admitTo === 'any' ? null : admitTo} onClose={() => setAdmitTo(null)} onAdmitted={admitted} />}
      {fromRequest && <AdmitDialog patient={fromRequest.patient} request={fromRequest} onClose={() => setFromRequest(null)} onAdmitted={admitted} />}
      {paper && <StayPaper stay={paper.stay} what={paper.what} onClose={() => setPaper(null)} />}
      {checking && (
        <ChecklistDialog
          stay={checking}
          onClose={() => setChecking(null)}
          onSaved={(message) => {
            setChecking(null);
            setNotice(message);
            board.reload();
          }}
        />
      )}
      {moving && <MoveDialog stay={moving.stay} from={moving.from} beds={free} onClose={() => setMoving(null)} onMoved={moved} />}
      {slip && <AdmissionSlip info={slip} onClose={() => setSlip(null)} />}
    </>
  );
}

/**
 * An occupied bed: the bed, who is in it (a link to her record), her IPD number and how long she has stayed, her doctor,
 * and one Actions menu – her record, the bill, the admission form, the wristband, the checklist, a transfer.
 */
function Occupant({ bedName, stay, canBill, onMove, onPaper, onChecklist, moveLabel = 'Transfer to another bed' }) {
  const p = stay.patient;
  const items = [
    { label: 'Open her record', icon: Eye, to: `/patients/${p.id}` },
    ...(canBill ? [{ label: 'Bill', icon: Receipt, to: `/patients/${p.id}/bills` }] : []),
    ...(onPaper ? [{ label: 'Admission form', icon: FileText, onSelect: () => onPaper('form') }, { label: 'Wristband', icon: Tag, onSelect: () => onPaper('wristband') }] : []),
    ...(onPaper && stay.checklistIncomplete && stay.canMove ? [{ label: 'Complete the checklist', icon: ClipboardList, onSelect: onChecklist }] : []),
    ...(stay.canMove && onMove ? [{ label: moveLabel, icon: ArrowRightLeft, onSelect: onMove }] : []),
  ];
  return (
    <>
      <span className="bb-bed-top">
        <strong className="bb-bed-name">{bedName}</strong>
        <StatusPill tone="admitted" icon={User}>
          {stayLength(stay.admittedAt)}
        </StatusPill>
      </span>
      <Link to={`/patients/${p.id}`} className="bb-patient">
        {p.fullName}
      </Link>
      <span className="bb-line muted tabular">{[p.mrn, stay.ipdNo].filter(Boolean).join(' · ')}</span>
      <span className="bb-line muted">Since {formatDateTime(stay.admittedAt)}</span>
      {p.assignedDoctorName && <span className="bb-line">{p.assignedDoctorName}</span>}
      {stay.reason && <span className="bb-line bb-reason">{stay.reason}</span>}
      {stay.checklistIncomplete && (
        <StatusPill tone="watch" icon={ClipboardList}>
          Checklist incomplete
        </StatusPill>
      )}
      {p.closed && <span className="muted">Record closed</span>}
      <MenuButton className="btn btn-secondary btn-sm bb-actions" label="Actions" items={items} align="start" />
    </>
  );
}

/**
 * Admit a patient: to the bed clicked on the board (bed), or – from her record (patient) – to a free bed chosen here.
 */
// admissionType: the type to start with (a patient just registered as IPD or day care – PatientNewPage.jsx)
export function AdmitDialog({ bed: fixedBed = null, patient: preset = null, request = null, admissionType: startType = null, onClose, onAdmitted }) {
  const { activeMembership } = useAuth();
  const [patient, setPatient] = useState(preset);
  const freeList = useFetch(fixedBed ? null : '/beds', { free: '1' });
  const [bedId, setBedId] = useState('');
  const bed = fixedBed ?? freeList.data?.beds.find((b) => b.id === (bedId || freeList.data.beds[0]?.id)) ?? null;
  const [form, setForm] = useState({ reasonCode: request?.reasonCode ?? 'labour', reasonNote: '', admittedAt: nowLocal(), admissionType: request?.admissionType ?? startType ?? 'planned', mlc: false, mlcPolice: '' });
  // The checklist, first filled from her record (ID proof, payer, emergency contact); her open request, if any
  const record = useFetch(patient ? `/patients/${patient.id}` : null);
  const [checklist, setChecklist] = useState(null);
  const shownChecklist = checklist ?? (record.data?.patient ? checklistFromPatient(record.data.patient) : EMPTY_CHECKLIST);
  const open = useFetch(patient && !request ? '/admission-desk/requests' : null, patient && !request ? { patientId: patient.id } : undefined);
  const req = request ?? open.data?.requests?.[0] ?? null;
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
      const body = {
        clientRequestId,
        patientId: patient.id,
        reasonCode: form.reasonCode,
        reasonNote: form.reasonNote.trim(),
        admissionType: form.admissionType,
        mlc: form.mlc,
        mlcPolice: form.mlc ? form.mlcPolice.trim() : '',
        admittedAt: form.admittedAt ? new Date(form.admittedAt).toISOString() : '',
        checklist: shownChecklist,
        ...(req ? { requestId: req.id } : {}),
      };
      const { admission } = await api(`/beds/${bed.id}/admit`, { method: 'POST', body });
      onAdmitted({ patient, ward: admission.ward, bed: admission.bed, admittedAt: admission.admittedAt, ipdNo: admission.ipdNo, checklistComplete: admission.checklistComplete, stayId: admission.id });
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
          {req && (
            <Alert type="info">
              Admitting from {req.requested.byName}'s request{req.reason ? `: ${req.reason}` : ''}
              {req.note ? ` – ${req.note}` : ''}.
            </Alert>
          )}
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
          {form.mlc && (
            <Field label="Police station informed" id="bed-police" error={fields.mlcPolice} hint='Or write "to inform".'>
              <input id="bed-police" maxLength={120} value={form.mlcPolice} onChange={set('mlcPolice')} />
            </Field>
          )}
          <ChecklistFields value={shownChecklist} onChange={setChecklist} fields={fields} idPrefix="bed-ck" />
          {form.admissionType === 'emergency' && <p className="hint">An emergency is admitted at once: anything missing in the checklist can be completed later (Checklist on her bed).</p>}
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
              ['IPD number', info.ipdNo ?? ''],
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
