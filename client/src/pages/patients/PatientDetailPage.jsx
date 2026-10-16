import { useCallback, useEffect, useRef, useState } from 'react';
import { Tip } from '../../components/Tip.jsx';
import { PregnancyTimeline } from './PregnancyTimeline.jsx';
import { KeepsakeButton } from './KeepsakeCard.jsx';
import { Archive, BadgeCheck, BedDouble, CalendarPlus, Copy, Eye, FileText, Files, IdCard, Lock, MessageCircle, MoreHorizontal, Pencil, Siren, Stethoscope, Undo2, UserRound } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PatientCard } from '../appointments/PatientCard.jsx';
import { AdmissionSlip, AdmitDialog } from '../beds/BedBoardPage.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Avatar, ConfirmDialog, Field, StatusPill, formatDate, formatDateTime, hasRole, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { AiBriefCard } from '../ai/AiBriefCard.jsx';
import { LetterDialog } from '../ai/LetterDialog.jsx';
import { RedFlagCard } from '../redflags/RedFlagList.jsx';
import { flagCountText } from '../redflags/redFlagFormat.js';
import { CarePlanCard, showsCarePlan } from './CarePlanCard.jsx';
import { DuplicateBanner, DuplicateHistory, EarlierRecordsNote, MarkDuplicateDialog, UndoDuplicateDialog } from './DuplicateDialogs.jsx';
import { ClosedBanner, DeathHistory, RecordDeathDialog, UndoDeathDialog } from './DeathDialogs.jsx';
import { PatientMessagesDialog } from './PatientMessagesDialog.jsx';
import { PatientForm } from './PatientForm.jsx';
import { RecordCopy } from './RecordCopy.jsx';
import { RiskBadge, RiskCard } from './RiskCard.jsx';
import { SafetyStrip } from './SafetyStrip.jsx';
import { InformationDue } from '../consents/InformationDue.jsx';
import { DELIVERY_MODE_LABELS } from '../inpatient/inpatientFormat.js';
import { ANTI_D, ECTOPIC_SITES, HISTOLOGY, LOSS_LABELS, MANAGEMENT, MOLE_KINDS, OUTCOME_LABELS, RETIRED_LOSS_MESSAGE, gaText, isRetiredLoss, lossFlagsText, lossRulesOn, showsPregnancyFields } from './abortionFormat.js';
import { LossFindingsList } from './LossFindings.jsx';
import {
  CARE_TYPE_SHORT,
  BREASTFEEDING_LABELS,
  CONDITION_LABELS,
  FEEDING_AT_DISCHARGE_LABELS,
  NEWBORN_SEX_LABELS,
  PAST_COMPLICATION_LABELS,
  PREGNANCY_FINDING_LABELS,
  ageText,
  bmi,
  currentFindings,
  formatGestation,
  formatGestationShort,
  formatGpla,
  isFirstPregnancy,
  nicuStayText,
  pastFindings,
  readingRows,
} from './patientFormat.js';

function Details({ rows }) {
  return (
    <dl className="details">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value === '' || value == null ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Pop-up to change the assigned doctor (header: More → Change doctor).
function DoctorDialog({ patient, onChanged, onCancel }) {
  const doctors = useFetch('/tenant/doctors');
  const [doctorId, setDoctorId] = useState(patient.assignedDoctor ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useDialogFocus(onCancel);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/patients/${patient.id}/doctor`, { method: 'PATCH', body: { doctorId: doctorId || null } });
      onChanged();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="doctor-title" onSubmit={save} noValidate>
        <h2 id="doctor-title">Assigned doctor</h2>
        <Field label="Doctor responsible for this patient" id="doctor-pick" error={error}>
          <select id="doctor-pick" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} disabled={busy}>
            <option value="">Not assigned</option>
            {(doctors.data?.doctors ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || doctorId === (patient.assignedDoctor ?? '')}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// Pop-up to record emergency treatment on another doctor's patient. A reason is required.
function EmergencyNoteDialog({ patient, onSaved, onCancel }) {
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      await api(`/patients/${patient.id}/emergency-notes`, { method: 'POST', body: { reason, text } });
      onSaved();
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
    }
  };

  const dialogRef = useDialogFocus(onCancel);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="em-title" onSubmit={save} noValidate>
        <h2 id="em-title">Emergency treatment note</h2>
        <p className="hint">
          {patient.fullName} is {patient.assignedDoctorName ? `${patient.assignedDoctorName}'s` : "another doctor's"} patient. Record the emergency
          treatment you gave and why. The note can't be edited or deleted afterwards, and the reason is recorded in the audit log.
        </p>
        <Alert type="error">{error}</Alert>
        <Field label="Reason (why you are treating this patient)" id="em-reason" error={fieldErrors.reason} hint='e.g. "Patient collapsed in OPD; treating doctor not available"'>
          <input id="em-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
        </Field>
        <Field label="Treatment given" id="em-text" error={fieldErrors.text}>
          <textarea id="em-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save emergency note'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// One patient, with tabs: Overview, Care plan, Visits, Consent forms, Information given and Edit details. What is shown depends on the person's access.
export function PatientDetailPage() {
  const { id } = useParams();
  const { activeMembership } = useAuth();
  const location = useLocation();
  const { data, error, reload } = useFetch(`/patients/${id}`);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [actionError, setActionError] = useState(null);
  // Another patient's record opened from this one (the main record of a duplicate, an earlier record, a baby's
  // mother): what was said about the record that was left ("Marked as a duplicate of …", a refusal) is not carried
  // over to this one.
  const shownId = useRef(id);
  const arrivedWith = location.state?.flash ?? null;
  useEffect(() => {
    if (shownId.current === id) return;
    shownId.current = id;
    setFlash(arrivedWith);
    setActionError(null);
  }, [id, arrivedWith]);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const [writingLetter, setWritingLetter] = useState(false);
  const [changingDoctor, setChangingDoctor] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [printingCard, setPrintingCard] = useState(false); // the patient card (reception)
  const [admitting, setAdmitting] = useState(false); // admit to a free bed (reception, her doctor, RMOs)
  const [admissionSlip, setAdmissionSlip] = useState(null);
  const [markingDuplicate, setMarkingDuplicate] = useState(false); // "Mark as a duplicate" (her doctor or an RMO)
  const [undoingDuplicate, setUndoingDuplicate] = useState(false);
  const [copyingRecord, setCopyingRecord] = useState(false); // "Copy of the whole record" (her doctor or an RMO)
  // "Record a death" and its undo (a doctor of the record)
  const [recordingDeath, setRecordingDeath] = useState(false);
  const [undoingDeath, setUndoingDeath] = useState(false);
  // A copy belongs to the record it was opened from: going to another record while it is open (the browser's Back
  // button) closes it – a copy of that other record is never made without being asked for. So does "Record a death":
  // it is never saved on a record other than the one it was opened from.
  useEffect(() => {
    setCopyingRecord(false);
    setRecordingDeath(false);
    setUndoingDeath(false);
  }, [id]);
  const [startingVisit, setStartingVisit] = useState(false);
  const visitRequest = useRef(null); // one id per "Start today's visit" press, kept for a retry
  const navigate = useNavigate();
  const [notesVersion, setNotesVersion] = useState(0);
  const patient = data?.patient;
  // The care plan's summary from the latest plan change, until the record itself is loaded again: keeps the
  // Overview card current without re-reading the whole record (which would add a "Patient record viewed" entry).
  const [localSummary, setLocalSummary] = useState(null);
  useEffect(() => setLocalSummary(null), [patient]);
  const onPlanChanged = useCallback((summary) => setLocalSummary(summary ?? null), []);

  if (error && !patient) {
    return (
      <>
        <PageHeader
          breadcrumbs={[{ label: 'Patients', to: '/patients' }, { label: 'Not found' }]}
          title="Patient not found"
        />
        <div className="pf-content">
          <div className="card narrow pf-message">
            <p>
              This patient doesn't exist in <strong>{activeMembership.tenantName}</strong>, or you don't have access.
            </p>
            <Link to="/patients" className="btn btn-link">
              Back to patients
            </Link>
          </div>
        </div>
      </>
    );
  }
  if (!patient) return <FullPageSpinner />;

  const a = patient.access;
  const canEdit = a.canEditIdentity || a.canEditClinical;
  const base = `/patients/${patient.id}`;
  // On the Edit details tab, "Save changes" is the screen's one primary action: the header's Edit button is hidden
  // there, and today's visit button is shown as a secondary button.
  const onEditTab = /\/edit\/?$/.test(location.pathname);
  const carePlanSummary = localSummary ?? patient.carePlanSummary;
  const planTab = showsCarePlan(patient, carePlanSummary);
  const subtitle = [
    patient.mrn,
    patient.currentAge !== undefined || patient.newborn ? ageText(patient) : null,
    patient.careType === 'antenatal' && patient.gestationalAge ? `${formatGestationShort(patient.gestationalAge)} pregnant` : null,
    patient.careType === 'abortion' ? (LOSS_LABELS[patient.abortion?.lossType] ?? null) : null,
    patient.assignedDoctorName !== undefined ? (patient.assignedDoctorName ? `Doctor: ${patient.assignedDoctorName}` : 'No doctor assigned') : null,
    patient.abha?.linked ? `ABHA ${patient.abha.masked}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Start today's visit: one visit per press, even if pressed twice; then its page.
  const startVisit = async () => {
    setStartingVisit(true);
    setActionError(null);
    visitRequest.current ??= newRequestId();
    try {
      const { visit } = await api(`/patients/${patient.id}/visits`, { method: 'POST', body: { clientRequestId: visitRequest.current } });
      visitRequest.current = null;
      reload();
      navigate(`${base}/visits/${visit.id}`);
    } catch (err) {
      setActionError(`Couldn't start the visit. ${err.message}`);
    } finally {
      setStartingVisit(false);
    }
  };

  // The header: one main button – today's visit (open it, or start it) for those who work with visits, else Edit
  // details – and "More" for what is used less often. A record marked as a duplicate, or closed after a death, takes no
  // new visit (a visit already started today can still be opened and finished).
  const visitButton = a.canViewVisits
    ? patient.todayVisitId
      ? { kind: 'open', to: `${base}/visits/${patient.todayVisitId}` }
      : a.canRecordVitals && !patient.duplicateOf && !patient.closed
        ? { kind: 'start' }
        : null
    : null;
  const editInMenu = canEdit && !onEditTab && Boolean(visitButton);
  // Booking and admitting from her record (owner, 13 Oct 2026): buttons beside More for reception, in More for doctors
  // and RMOs. Not for a record marked as a duplicate or closed; admitting not while she is in hospital (the server
  // checks that too – reception does not see her current stay).
  const isReception = hasRole(activeMembership, 'receptionist');
  const open = !patient.duplicateOf && !patient.closed;
  const canBookHere = open && hasRole(activeMembership, 'receptionist', 'doctor');
  const canAdmitHere = open && !patient.currentAdmission && (isReception || (a.canEditClinical && hasRole(activeMembership, 'doctor', 'rmo')));
  const bookHere = () => navigate('/appointments', { state: { bookFor: { id: patient.id, fullName: patient.fullName, mrn: patient.mrn, phone: patient.phone ?? '' } } });
  const more = [
    ...(!isReception && canBookHere ? [{ label: 'Book an appointment', icon: CalendarPlus, onSelect: bookHere }] : []),
    ...(!isReception && canAdmitHere ? [{ label: 'Admit to a bed', icon: BedDouble, onSelect: () => setAdmitting(true) }] : []),
    ...(editInMenu ? [{ label: 'Edit details', icon: Pencil, onSelect: () => navigate(`${base}/edit`) }] : []),
    ...(a.canAssign ? [{ label: 'Change doctor', icon: UserRound, onSelect: () => setChangingDoctor(true) }] : []),
    ...(a.canMarkSensitive ? [{ label: patient.sensitive ? 'Remove sensitive marking' : 'Mark sensitive', icon: Lock, onSelect: () => setConfirmSensitive(true) }] : []),
    ...(a.canEditClinical && hasRole(activeMembership, 'doctor', 'rmo') ? [{ label: 'Write a letter', icon: FileText, onSelect: () => setWritingLetter(true) }] : []),
    ...(a.canAddEmergencyNote ? [{ label: 'Emergency note', icon: Siren, onSelect: () => setEmergencyOpen(true) }] : []),
    // The patient card: her name, number, doctor and appointments to keep (reception, doctors, RMOs, nurses) – never
    // for a record marked as a duplicate (her card carries the number of her main record), nor for a closed record
    ...(patient.phone !== undefined && !patient.duplicateOf && !patient.closed && hasRole(activeMembership, 'receptionist', 'doctor', 'rmo', 'nurse')
      ? [{ label: 'Print patient card', icon: IdCard, onSelect: () => setPrintingCard(true) }]
      : []),
    // Automatic reminders and the patient portal (Version 2): staff who see her phone number – not on a closed record,
    // which gets no message of any kind (closing it stopped the waiting messages and ended the portal access)
    ...((a.canEditIdentity || a.canViewVisits) && !patient.closed ? [{ label: 'Reminders and portal', icon: MessageCircle, onSelect: () => setMessaging(true) }] : []),
    // Two records of one person: her doctor or an RMO marks one as a duplicate of the other, or undoes it
    ...(a.canMarkDuplicate ? [{ label: 'Mark as a duplicate', icon: Copy, onSelect: () => setMarkingDuplicate(true) }] : []),
    ...(a.canUndoDuplicate ? [{ label: 'Undo duplicate marking', icon: Undo2, onSelect: () => setUndoingDuplicate(true) }] : []),
    // Everything in the record as one printout or PDF, for the patient herself or a referral: her doctor or an RMO
    ...(a.canCopyRecord ? [{ label: 'Copy of the whole record', icon: Files, onSelect: () => setCopyingRecord(true) }] : []),
    // A death, recorded by a doctor of the record (the record is then closed), and undone when it was recorded in error
    ...(a.canRecordDeath ? [{ label: 'Record a death', icon: Archive, onSelect: () => setRecordingDeath(true) }] : []),
    ...(a.canUndoDeath ? [{ label: 'Undo recorded death', icon: Undo2, onSelect: () => setUndoingDeath(true) }] : []),
  ];

  // Runs after the person confirms in the dialog.
  const toggleSensitive = async () => {
    const next = !patient.sensitive;
    setConfirmSensitive(false);
    setActionError(null);
    try {
      await api(`/patients/${patient.id}/sensitive`, { method: 'PATCH', body: { sensitive: next } });
      setFlash(next ? 'Record marked as sensitive.' : 'Sensitive marking removed.');
      reload();
    } catch (err) {
      setActionError(err.message);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Patients', to: '/patients' }, { label: patient.mrn }]}
        title={patient.fullName}
        documentTitle="Patient record" /* never the patient's name: tab titles stay in browser history */
        badges={
          <>
            <StatusPill tone="neutral">{CARE_TYPE_SHORT[patient.careType]}</StatusPill>
            {patient.risk?.level && <RiskBadge risk={patient.risk} large />}
            {patient.redFlags?.flags?.length > 0 && (
              <StatusPill tone="high" icon={Siren} title={flagCountText(patient.redFlags.flags)}>
                Red flag{patient.redFlags.flags.length > 1 ? `s ${patient.redFlags.flags.length}` : ''}
              </StatusPill>
            )}
            {patient.sensitive && (
              <StatusPill tone="brand" icon={Lock}>
                Sensitive
              </StatusPill>
            )}
            {patient.duplicateOf && (
              <StatusPill tone="inactive" icon={Copy} title={`Marked as a duplicate of ${patient.duplicateOf.mrn}`}>
                Duplicate
              </StatusPill>
            )}
            {patient.closed && (
              <StatusPill tone="inactive" icon={Archive}>
                Record closed
              </StatusPill>
            )}
            {patient.currentAdmission && (
              <Link to={`${base}/stays/${patient.currentAdmission.id}`} className="pill-link">
                <StatusPill tone="admitted" icon={BedDouble}>
                  In hospital{patient.currentAdmission.bed ? ` · Bed ${patient.currentAdmission.bed}` : ''}
                </StatusPill>
              </Link>
            )}
          </>
        }
        subtitle={<span className="tabular">{subtitle}</span>}
        actions={
          <>
            {more.length > 0 && <MenuButton className="btn btn-secondary" icon={MoreHorizontal} label="More" items={more} align="end" ariaLabel="More actions for this patient" />}
            {isReception && canAdmitHere && (
              <button type="button" className="btn btn-secondary" onClick={() => setAdmitting(true)}>
                <BedDouble aria-hidden="true" /> Admit
              </button>
            )}
            {isReception && canBookHere && (
              <button type="button" className="btn btn-secondary" onClick={bookHere}>
                <CalendarPlus aria-hidden="true" /> Book appointment
              </button>
            )}
            {visitButton?.kind === 'open' && (
              <Link to={visitButton.to} className={`btn ${onEditTab ? 'btn-secondary' : 'btn-primary'}`}>
                <Stethoscope aria-hidden="true" /> Open today's visit
              </Link>
            )}
            {visitButton?.kind === 'start' && (
              <button type="button" className={`btn ${onEditTab ? 'btn-secondary' : 'btn-primary'}`} onClick={startVisit} disabled={startingVisit}>
                <Stethoscope aria-hidden="true" /> {startingVisit ? 'Starting…' : "Start today's visit"}
              </button>
            )}
            {!visitButton && canEdit && !onEditTab && (
              <Link to={`${base}/edit`} className="btn btn-primary">
                <Pencil aria-hidden="true" /> Edit details
              </Link>
            )}
          </>
        }
        tabs={[
          { label: 'Overview', to: base, end: true },
          ...(planTab ? [{ label: 'Care plan', to: `${base}/care-plan`, end: true }] : []),
          ...(a.canViewVisits ? [{ label: 'Visits', to: `${base}/visits`, end: false }] : []),
          ...(a.canViewVisits ? [{ label: 'Stays', to: `${base}/stays`, end: false }] : []),
          ...(a.canViewVisits ? [{ label: 'Lab and scans', to: `${base}/lab`, end: false }] : []),
          // Appointment booking: for reception, doctors, RMOs and nurses who may see her phone number
          ...(patient.phone !== undefined && hasRole(activeMembership, 'receptionist', 'doctor', 'rmo', 'nurse') ? [{ label: 'Appointments', to: `${base}/appointments`, end: true }] : []),
          // ABDM linking (M1): her ABHA – reception, doctors and RMOs
          ...(patient.phone !== undefined && hasRole(activeMembership, 'receptionist', 'doctor', 'rmo') ? [{ label: 'ABHA', to: `${base}/abha`, end: true }] : []),
          // Billing: reception and the billing department (the hospital admin opens bills from Billing)
          ...(hasRole(activeMembership, 'receptionist', 'billing') ? [{ label: 'Bills', to: `${base}/bills`, end: true }] : []),
          ...(a.canViewConsents ? [{ label: 'Consent forms', to: `${base}/consents`, end: true }] : []),
          ...(a.canViewConsents ? [{ label: 'Information given', to: `${base}/information`, end: true }] : []),
          // Edit details: in the header (More, or the main button) – no tab of its own, except while it is open
          ...(onEditTab ? [{ label: 'Edit details', to: `${base}/edit`, end: true }] : []),
        ]}
      />
      <div className="pf-content">
        <DuplicateBanner patient={patient} onUndo={() => setUndoingDuplicate(true)} />
        <ClosedBanner patient={patient} onUndo={() => setUndoingDeath(true)} />
        <EarlierRecordsNote patient={patient} />
        <SafetyStrip patient={patient} />
        <InformationDue patient={patient} />
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
        {a.level === 'read_only' && (
          <Alert type="patient-note" icon={Eye}>
            <strong>Read-only:</strong> this is {patient.assignedDoctorName ? `${patient.assignedDoctorName}'s` : "another doctor's"} patient. You can view the
            record, but not change it. In an emergency, use <em>Emergency note</em> to record treatment with a reason.
          </Alert>
        )}
        {(a.level === 'identity' || a.level === 'name_only') && (
          <Alert type="patient-note" icon={Lock}>
            {patient.sensitive && a.canAddEmergencyNote
              ? 'This is a sensitive record: medical details are only visible to the treating doctor and RMOs.'
              : 'Medical details are not shown for your role.'}
          </Alert>
        )}
        <Outlet context={{ patient, reload, setFlash, notesVersion, carePlanSummary, onPlanChanged }} />
      </div>
      {confirmSensitive && (
        <ConfirmDialog
          id="sensitive"
          title={patient.sensitive ? 'Remove the sensitive marking?' : 'Mark this record as sensitive?'}
          confirmLabel={patient.sensitive ? 'Remove sensitive' : 'Mark sensitive'}
          onConfirm={toggleSensitive}
          onCancel={() => setConfirmSensitive(false)}
        >
          {patient.sensitive
            ? 'Nurses and other doctors will be able to see the medical details again.'
            : 'Only the treating doctor and RMOs will see the medical details.'}
        </ConfirmDialog>
      )}
      {markingDuplicate && (
        <MarkDuplicateDialog
          patient={patient}
          onCancel={() => setMarkingDuplicate(false)}
          onDone={(text) => {
            setMarkingDuplicate(false);
            setActionError(null);
            setFlash(text);
            reload();
            navigate(base); // the Overview: the other tabs read what they may offer again when they are opened
          }}
        />
      )}
      {undoingDuplicate && (
        <UndoDuplicateDialog
          patient={patient}
          onCancel={() => setUndoingDuplicate(false)}
          onDone={(text) => {
            setUndoingDuplicate(false);
            setActionError(null);
            setFlash(text);
            reload();
            navigate(base);
          }}
          onError={(text) => {
            setUndoingDuplicate(false);
            setActionError(text);
          }}
        />
      )}
      {recordingDeath && (
        <RecordDeathDialog
          patient={patient}
          onCancel={() => setRecordingDeath(false)}
          onDone={(text) => {
            setRecordingDeath(false);
            setActionError(null);
            setFlash(text);
            reload();
            navigate(base); // the Overview: the other tabs read what they may offer again when they are opened
          }}
        />
      )}
      {undoingDeath && (
        <UndoDeathDialog
          patient={patient}
          onCancel={() => setUndoingDeath(false)}
          onDone={(text) => {
            setUndoingDeath(false);
            setActionError(null);
            setFlash(text);
            reload();
            navigate(base);
          }}
        />
      )}
      {writingLetter && <LetterDialog patient={patient} onClose={() => setWritingLetter(false)} />}
      {printingCard && <PatientCard patient={patient} onClose={() => setPrintingCard(false)} />}
      {admitting && (
        <AdmitDialog
          patient={patient}
          onClose={() => setAdmitting(false)}
          onAdmitted={(info) => {
            setAdmitting(false);
            setFlash(`${patient.fullName} is admitted to ${info.ward} · ${info.bed}.`);
            setAdmissionSlip(info);
            reload();
          }}
        />
      )}
      {admissionSlip && <AdmissionSlip info={admissionSlip} onClose={() => setAdmissionSlip(null)} />}
      {copyingRecord && <RecordCopy patient={patient} onClose={() => setCopyingRecord(false)} />}
      {messaging && (
        <PatientMessagesDialog
          patient={patient}
          onCancel={() => setMessaging(false)}
          onDone={(text) => {
            setMessaging(false);
            setFlash(text);
            reload();
          }}
        />
      )}
      {changingDoctor && (
        <DoctorDialog
          patient={patient}
          onCancel={() => setChangingDoctor(false)}
          onChanged={() => {
            setChangingDoctor(false);
            setFlash('Assigned doctor changed.');
            reload();
          }}
        />
      )}
      {emergencyOpen && (
        <EmergencyNoteDialog
          patient={patient}
          onCancel={() => setEmergencyOpen(false)}
          onSaved={() => {
            setEmergencyOpen(false);
            setFlash('Emergency note saved.');
            setNotesVersion((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function NotesCard({ patient, version }) {
  const { data, error } = useFetch(`/patients/${patient.id}/notes`, { v: version });
  const notes = data?.notes ?? [];
  if (!error && data && notes.length === 0) return null;
  return (
    <section className="card card-wide">
      <h2>Emergency notes</h2>
      <Alert type="error">{error}</Alert>
      <ul className="note-list">
        {notes.map((n) => (
          <li key={n.id}>
            <div className="note-head">
              <StatusPill tone="neutral" icon={Siren}>
                Emergency
              </StatusPill>
              <span className="name-cell">
                <Avatar name={n.authorName} seed={n.author ?? n.authorName} />
                <span className="name-cell-text">
                  <strong>{n.authorName}</strong>
                  <span className="t-caption muted">{formatDateTime(n.createdAt)}</span>
                </span>
              </span>
            </div>
            <div className="note-reason">
              <span className="muted">Reason:</span> {n.reason}
            </div>
            <p className="pre-line">{n.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The latest visit in short: the date, the key values, the diagnosis and the medicines (opens the visit). */
function LastVisitCard({ patient, visit }) {
  const values = [visit.bp && `BP ${visit.bp}`, visit.weightKg != null && `${visit.weightKg} kg`, visit.hb != null && `Hb ${visit.hb}`].filter(Boolean);
  return (
    <section className="card ov-last-visit" aria-labelledby="ov-last-title">
      <div className="ov-last-head">
        <h2 id="ov-last-title">Last visit · {formatDate(visit.visitOn)}</h2>
        {visit.signed ? (
          <StatusPill tone="stable" icon={BadgeCheck}>
            Signed
          </StatusPill>
        ) : null}
        <Link to={`/patients/${patient.id}/visits/${visit.id}`} className="btn btn-link btn-sm">
          Open the visit
        </Link>
      </div>
      <Details
        rows={[
          ['Values', values.join(' · ')],
          ['Diagnosis', visit.diagnosis],
          ['Medicines', visit.medicineCount ? `${visit.medicines.join(', ')}${visit.medicineCount > visit.medicines.length ? ` and ${visit.medicineCount - visit.medicines.length} more` : ''}` : 'None'],
          ...(visit.nextVisitOn ? [['Next visit', formatDate(visit.nextVisitOn)]] : []),
        ]}
      />
    </section>
  );
}

/**
 * Findings in this pregnancy, on the Overview's Pregnancy card: each one ticked on the record with who recorded it
 * and when, the readings the risk rules use (lowest Hb, latest BP), and the earlier entries (unticked, or from an
 * earlier pregnancy). They are ticked and unticked in Edit details (the doctor or an RMO).
 * carePlanSummary: the plan's short summary as the page has it now (it names the ticked findings her plan has no
 * items for yet, because the plan was built from an older version of the template).
 */
export function PregnancyFindings({ patient: p, carePlanSummary = p.carePlanSummary }) {
  const findings = currentFindings(p);
  const past = pastFindings(p, formatDate);
  // Ticked findings that switch nothing on in her care plan: it was built from an older version of the template,
  // from before the template had items for them (the Care plan tab offers the update).
  const planBehind = (carePlanSummary?.findingsWithoutItems ?? []).map((k) => PREGNANCY_FINDING_LABELS[k] ?? k);
  return (
    <div className="pf-findings">
      <h3>Findings in this pregnancy</h3>
      {findings.length ? (
        <ul className="plain-list pf-finding-list">
          {findings.map((f) => (
            <li key={f.key}>
              <span className="reason-label">{PREGNANCY_FINDING_LABELS[f.key] ?? f.key}</span>
              <span className="muted">
                {' '}
                – {f.byName}, {formatDate(f.at)}
                {f.via === 'visit' ? ' (confirmed at a visit)' : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted pf-finding-none">None recorded.</p>
      )}
      {planBehind.length > 0 && (
        <Alert type="warning">
          Her care plan has no items yet for: {planBehind.join(', ')}. It was built from an older version of the template.{' '}
          {p.access.canEditClinical ? (
            <>
              <Link to={`/patients/${p.id}/care-plan`}>Update the plan on the Care plan tab</Link> to add them.
            </>
          ) : (
            <>
              The treating doctor or an RMO updates it on the <Link to={`/patients/${p.id}/care-plan`}>Care plan tab</Link>.
            </>
          )}
        </Alert>
      )}
      {readingRows(p, formatDate).length > 0 && <Details rows={readingRows(p, formatDate)} />}
      <p className="hint">
        {p.access.canEditClinical ? (
          <>
            Tick or untick a finding in <Link to={`/patients/${p.id}/edit`}>Edit details</Link>.
          </>
        ) : (
          'The doctor or an RMO ticks a finding in Edit details.'
        )}{' '}
        Each one counts for the risk level and the care plan as the hospital's risk rules and care-plan template say – the Risk card shows the reason.
      </p>
      {past.length > 0 && (
        <details className="override-history">
          <summary>Earlier entries ({past.length})</summary>
          <ul>
            {past.map((f, i) => (
              <li key={i}>
                <span className="reason-label">{f.label}</span> <span className="muted">– {f.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// The pregnancy loss (Abortion type of care), for those who see the medical details. Lab results are on the Lab tab.
function PregnancyLossCard({ patient: p }) {
  const a = p.abortion;
  const m = a?.management ?? {};
  const weeks = a?.lmp && a?.presentedOn ? gaText(a.lmp, a.presentedOn) : a?.weeks != null ? `${a.weeks} w ${a.days ?? 0} d` : '';
  return (
    <section className="card">
      <h2>Pregnancy loss</h2>
      {!a?.lossType && <Alert type="warning">The type of loss is not entered yet – a doctor or RMO should add it in Edit details.</Alert>}
      {isRetiredLoss(a?.lossType) && <Alert type="warning">{RETIRED_LOSS_MESSAGE} A doctor or RMO can do this in Edit details.</Alert>}
      {a && (
        <Details
          rows={[
            ['Type of loss', LOSS_LABELS[a.lossType] ?? ''],
            ...(a.lossType === 'ectopic' ? [['Site', ECTOPIC_SITES[a.ectopicSite] ?? '']] : []),
            ...(a.lossType === 'molar' ? [['Kind of mole', MOLE_KINDS[a.moleKind] ?? '']] : []),
            ['Date seen', a.presentedOn ? formatDate(a.presentedOn) : ''],
            ...(a.lossType !== 'recurrent' ? [['LMP', a.lmp ? formatDate(a.lmp) : ''], ['Weeks at presentation', weeks]] : []),
            ['Management', m.method ? `${MANAGEMENT[m.method]}${m.on ? ` · ${formatDate(m.on)}` : ''}` : ''],
            ['Outcome', OUTCOME_LABELS[m.outcome] ?? ''],
            ...(a.lossType === 'molar'
              ? [['Histology', [HISTOLOGY[a.histology?.status], a.histology?.result].filter(Boolean).join(' · ')]]
              : []),
            ...(a.lossType !== 'recurrent' ? [['Anti-D', a.antiD?.status ? `${ANTI_D[a.antiD.status]}${a.antiD.on ? ` · ${formatDate(a.antiD.on)}` : ''}` : '']] : []),
            ...(a.note ? [['Note', a.note]] : []),
          ]}
        />
      )}
      {/* What was found on examination and on the scan: each value with who recorded it and when */}
      {a?.lossType && !isRetiredLoss(a.lossType) && showsPregnancyFields(a.lossType) && (
        <div className="pf-findings">
          <h3>Findings</h3>
          {(a.findings ?? []).length ? <LossFindingsList abortion={a} /> : <p className="muted pf-finding-none">None recorded.</p>}
          <p className="hint">
            {p.access.canEditClinical ? (
              <>
                Record or change a finding in <Link to={`/patients/${p.id}/edit`}>Edit details</Link>, or on a visit page.
              </>
            ) : (
              'The doctor or an RMO records a finding in Edit details, or on a visit page.'
            )}{' '}
            A finding stays as recorded until someone changes it. {lossFlagsText(lossRulesOn(p.redFlags?.rules))}
          </p>
        </div>
      )}
      {p.access.canViewVisits && (
        <p className="hint">
          <Link to={`/patients/${p.id}/lab`}>Lab results (beta hCG and others)</Link>
        </p>
      )}
    </section>
  );
}

export function PatientOverviewTab() {
  const { patient, notesVersion, reload, setFlash, carePlanSummary, onPlanChanged } = useOutletContext();
  const { activeMembership } = useAuth();
  const p = patient;
  // The AI brief: for doctors and RMOs who may write her clinical record (as the other AI help) – not on a closed
  // record (nothing is to be looked at first any more; the server refuses it)
  const canBrief = (activeMembership?.roles ?? []).some((r) => ['doctor', 'rmo'].includes(r)) && p.access.canEditClinical && !p.closed;
  const isNewborn = p.careType === 'newborn';
  const conditions = [...(p.medical?.conditions ?? []).map((c) => CONDITION_LABELS[c] ?? c), p.medical?.otherConditions].filter(Boolean).join(', ');
  const b = bmi(p.medical);
  const has = (key) => p[key] !== undefined;
  const showPlan = showsCarePlan(p, carePlanSummary);
  const showRisk = p.careType === 'antenatal' && Boolean(p.risk?.level);
  const hasMore = p.babies?.length > 0 || p.notes || p.access.canViewNotes;
  const wasDuplicate = (p.duplicateHistory ?? []).length > 0;

  // Everything on one screen: care plan and risk side by side, then the clinical facts in a row. Name, patient no.,
  // age, weeks and doctor are in the page header, so contact details (phone, address) are only on Edit details.
  return (
    <div className="patient-overview">
      {canBrief && (
        <AiBriefCard
          endpoint={`/ai/brief/patient/${p.id}`}
          resetKey={p.id}
          intro="What to look at first on this page."
        />
      )}
      <RedFlagCard redFlags={p.redFlags} patientId={p.id} />
      {p.lastVisit && <LastVisitCard patient={p} visit={p.lastVisit} />}
      {(showPlan || showRisk) && (
        <div className="ov-row ov-top">
          {showPlan && <CarePlanCard patient={p} summary={carePlanSummary} onPlanChanged={onPlanChanged} />}
          {showRisk && (
            <RiskCard
              patient={p}
              onChanged={(_updated, message) => {
                setFlash(message);
                reload();
              }}
            />
          )}
        </div>
      )}

      <div className="ov-row ov-facts">
        {p.careType === 'antenatal' && has('pregnancy') && (
          <section className="card">
            <h2>Pregnancy</h2>
            {!p.pregnancy?.effectiveEdd && <Alert type="warning">Pregnancy dates not entered yet – a doctor or RMO should add the LMP or scan EDD.</Alert>}
            <Details
              rows={[
                ['Weeks today', <strong key="ga" className="ga-value">{formatGestation(p.gestationalAge)}</strong>],
                ['EDD', p.pregnancy?.effectiveEdd ? `${formatDate(p.pregnancy.effectiveEdd)}${p.pregnancy?.scanEdd ? ' (from scan)' : ' (from LMP)'}` : ''],
                ['LMP', p.pregnancy?.lmp ? formatDate(p.pregnancy.lmp) : ''],
                // The LMP's EDD only when the scan's is used instead, to compare
                ...(p.pregnancy?.scanEdd && p.pregnancy?.edd ? [['EDD from LMP', formatDate(p.pregnancy.edd)]] : []),
              ]}
            />
            <PregnancyFindings patient={p} carePlanSummary={carePlanSummary} />
            {p.pregnancy?.effectiveEdd && <PregnancyTimeline patient={p} />}
          </section>
        )}

        {p.careType === 'abortion' && has('abortion') && <PregnancyLossCard patient={p} />}

        {p.careType === 'postnatal' && has('postnatal') && (
          <section className="card">
            <h2>After delivery</h2>
            <Details
              rows={[
                ['Delivered', p.lastDelivery?.at ? `${formatDate(p.lastDelivery.at)}${p.lastDelivery.mode ? ` – ${DELIVERY_MODE_LABELS[p.lastDelivery.mode] ?? p.lastDelivery.mode}` : ''}` : 'Not recorded yet'],
                ['Breastfeeding', p.postnatal?.breastfeeding ? BREASTFEEDING_LABELS[p.postnatal.breastfeeding] : 'Not recorded yet'],
              ]}
            />
          </section>
        )}

        {isNewborn && has('newborn') && (
          <section className="card">
            <div className="plan-card-head">
              <h2>Birth details</h2>
              {/* The baby keepsake card for the family (doctor ideas #10) */}
              <KeepsakeButton patient={p} />
            </div>
            {p.newborn?.birthAt && <Tip id="keepsake-2026-10" />}
            <Details
              rows={[
                ['Born', p.newborn?.birthAt ? formatDateTime(p.newborn.birthAt) : ''],
                ['Birth weight', p.newborn?.birthWeightGrams ? `${p.newborn.birthWeightGrams} g` : ''],
                ['Sex', NEWBORN_SEX_LABELS[p.newborn?.sex] ?? ''],
                ...(has('medical') ? [['Blood group', p.medical?.bloodGroup]] : []),
                [
                  'Mother',
                  p.motherInfo ? (
                    <span key="m" className="name-cell">
                      <Avatar name={p.motherInfo.fullName} seed={p.motherInfo.id} />
                      <span className="name-cell-text">
                        <Link to={`/patients/${p.motherInfo.id}`}>{p.motherInfo.fullName}</Link>
                        <span className="muted tabular">
                          {p.motherInfo.mrn}
                          {p.motherInfo.closed ? ' · Record closed' : ''}
                        </span>
                      </span>
                    </span>
                  ) : (
                    'Not linked'
                  ),
                ],
              ]}
            />
          </section>
        )}

        {isNewborn && has('newbornCare') && (
          <section className="card">
            <h2>Care after birth</h2>
            <Details
              rows={[
                ['NICU or SNCU', nicuStayText(p.newbornCare?.nicu, formatDate)],
                ['Feeding at discharge', FEEDING_AT_DISCHARGE_LABELS[p.newbornCare?.feedingAtDischarge ?? ''] ?? 'Not recorded'],
              ]}
            />
            <p className="hint">{p.access.canEditClinical ? <Link to={`/patients/${p.id}/edit`}>Change it in Edit details</Link> : 'The doctor or an RMO records it in Edit details.'}</p>
          </section>
        )}

        {!isNewborn && has('obstetric') && (
          <section className="card">
            <h2>Obstetric history</h2>
            <Details
              rows={[
                ['Summary', formatGpla(p.obstetric)],
                ['Previous caesareans', p.obstetric?.previousCaesareans ?? ''],
                [
                  'Problems in previous pregnancies',
                  p.obstetric?.pastComplications?.length
                    ? p.obstetric.pastComplications.map((c) => PAST_COMPLICATION_LABELS[c] ?? c).join(', ')
                    : isFirstPregnancy(p.careType, p.obstetric)
                      ? 'None (first pregnancy)'
                      : p.obstetric?.complicationsReviewed
                        ? 'None (confirmed)'
                        : 'Not recorded yet',
                ],
              ]}
            />
          </section>
        )}

        {!isNewborn && has('medical') && (
          <section className="card">
            <h2>Medical background</h2>
            <Details
              rows={[
                ['Blood group', p.medical?.bloodGroup],
                ['Height', p.medical?.heightCm ? `${p.medical.heightCm} cm` : ''],
                ['Weight', p.medical?.weightKg ? `${p.medical.weightKg} kg` : ''],
                ['BMI', b ?? ''],
                ['Conditions', conditions || (p.medical?.conditionsReviewed ? 'None known (confirmed)' : 'Not recorded yet')],
                ['Allergies', p.medical?.allergies?.trim() || 'Not recorded yet'],
              ]}
            />
          </section>
        )}
      </div>

      {hasMore && (
        <div className="card-columns">
          {p.babies?.length > 0 && (
            <section className="card">
              <h2>Babies</h2>
              <ul className="plain-list baby-list">
                {p.babies.map((baby) => (
                  <li key={baby.id}>
                    <span className="name-cell">
                      <Avatar name={baby.fullName} seed={baby.id} />
                      <span className="name-cell-text">
                        <Link to={`/patients/${baby.id}`}>{baby.fullName}</Link>
                        <span className="muted tabular">
                          {baby.mrn} · born {formatDateTime(baby.birthAt)}
                          {baby.closed ? ' · Record closed' : ''}
                        </span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {p.notes && (
            <section className="card">
              <h2>Notes</h2>
              <p className="pre-line">{p.notes}</p>
            </section>
          )}

          {p.access.canViewNotes && <NotesCard patient={p} version={notesVersion} />}
        </div>
      )}
      {wasDuplicate && <DuplicateHistory patient={p} />}
      <DeathHistory patient={p} />
    </div>
  );
}

export function PatientEditTab() {
  const { patient, reload, setFlash } = useOutletContext();
  const navigate = useNavigate();
  const a = patient.access;
  if (!a.canEditIdentity && !a.canEditClinical) return <div className="card">You can't change this patient's details.</div>;
  const save = async (payload) => {
    await api(`/patients/${patient.id}`, { method: 'PATCH', body: payload });
    setFlash('Changes saved.');
    reload();
    navigate(`/patients/${patient.id}`);
  };
  return (
    <div className="form-page">
      <PatientForm patient={patient} onSubmit={save} submitLabel="Save changes" access={a} cancelTo={`/patients/${patient.id}`} />
    </div>
  );
}
