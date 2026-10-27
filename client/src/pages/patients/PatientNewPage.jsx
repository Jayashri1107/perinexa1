import { useEffect, useRef, useState } from 'react';
import { Baby, BedDouble, Check, ChevronRight, HeartHandshake, HeartPulse, Flower2, Mic, Stethoscope, Sun, UserPlus, Users } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { canRegisterPatients, patientTabs } from '../../platform/modules.js';
import { AdmitDialog } from '../beds/BedBoardPage.jsx';
import { ChargeLines, billCharges, billedText, chargesOk, useChargeItems } from '../billing/ServiceChargeDialog.jsx';
import { PatientForm } from './PatientForm.jsx';
import { VoiceEntry } from './VoiceEntry.jsx';
import { careTypeFromSpeech, withoutCareTypeWords } from './careTypeSpeech.js';
import { hearingPhrases } from './obgyTerms.js';
import { PossibleMatchesDialog } from './PossibleMatchesDialog.jsx';
import { CARE_TYPE_HINTS, CARE_TYPE_LABELS, CARE_TYPE_SHORT, CARE_TYPES, NEW_PATIENT_LINKS, ageText } from './patientFormat.js';

// An icon for each type of care on the chooser
const CARE_TYPE_ICONS = { antenatal: HeartPulse, postnatal: Users, infertility: Flower2, gynaecology: Stethoscope, abortion: HeartHandshake, newborn: Baby };

// Registering a patient: the type of care is chosen from the "New patient" menu, then two pages – 1 the patient's
// details, saved first (the patient gets a number), then 2 the clinical details, only for those who may enter
// them for this patient (need-to-know).
// Before page 1 is saved the server looks for records with the same phone number or name: "She may already be
// registered" then offers the existing record, or "Register as a new patient anyway" (PossibleMatchesDialog).

const CLINICAL_CONTENTS = {
  antenatal: 'Pregnancy dates, history and medical background',
  abortion: 'Type of loss, weeks, management and medical background',
  newborn: 'Blood group and notes',
};

// Who adds the clinical details when the person registering can't (reception, or a colleague's patient).
const clinicalDetailsBy = (patient) => (patient.assignedDoctorName ? `${patient.assignedDoctorName} or an RMO` : 'A doctor or an RMO');

// Said on the chooser (the type of care and her details), waiting for the form it opened. PRIVACY: this tab's memory
// only – never the address bar or the browser history.
let spokenForForm = null; // { careType, text }

const NOTHING_READ = { values: {}, paths: [], found: [], questions: [], notes: [], unused: [], corrections: [] };
const NOTHING_FILLED = { here: [], later: [], notes: [], questions: [], unused: [] };
const CHOOSER_INTRO =
  'Say the type of care first, then her details – for example “Pregnancy, Asha Sample, age 28, phone 98765 43210, LMP 5 March”. ' +
  'When you stop, the form for that type of care opens with the details filled in for you to check. Speech is turned into text on this ' +
  'computer: nothing is sent anywhere or kept.';

/** The chooser's voice entry: picks the type of care from what was said, then opens its form with the words. */
function SayCareType({ onChosen }) {
  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState(null); // { careType, candidates, text }
  const latest = useRef(null);
  const wasBusy = useRef(false);
  const read = (said) => {
    const found = { ...careTypeFromSpeech(said), text: said };
    latest.current = found;
    setHeard(found);
    return NOTHING_READ;
  };
  // A recording that ends with one type of care heard opens its form
  const onBusy = (busy) => {
    if (wasBusy.current && !busy && latest.current?.careType) onChosen(latest.current.careType, latest.current.text);
    wasBusy.current = busy;
  };
  if (!open) {
    return (
      <div className="voice-folded">
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
          <Mic aria-hidden="true" /> Dictate
        </button>
      </div>
    );
  }
  return (
    <div className="care-type-voice">
      <VoiceEntry
        careType={null}
        read={read}
        onDetails={() => NOTHING_FILLED}
        onAnswer={() => ({ here: [], later: [] })}
        onBusy={onBusy}
        canNote={false}
        emptyNote={null}
        intro={CHOOSER_INTRO}
        example="“Pregnancy, Asha Sample, age 28 …” or “Gynaecology, Meena Sample …”"
        hearing={(c, words) => hearingPhrases('antenatal', words)}
        onHide={() => setOpen(false)}
      />
      {heard?.careType && (
        <p className="care-type-heard">
          <Check aria-hidden="true" /> Heard: <strong>{CARE_TYPE_LABELS[heard.careType]}</strong>.{' '}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChosen(heard.careType, heard.text)}>
            Open this form
          </button>
        </p>
      )}
      {heard && !heard.careType && heard.text.trim() && (
        <p className="hint">
          {heard.candidates.length > 1
            ? `More than one type of care was heard (${heard.candidates.map((t) => CARE_TYPE_LABELS[t]).join(', ')}). Please choose one below.`
            : 'The type of care was not heard. Say it (for example “pregnancy” or “gynaecology”), or choose it below.'}
        </p>
      )}
    </div>
  );
}

// Clinical details said by voice on page 1, waiting for page 2. PRIVACY: kept in this browser tab's memory only
// (never stored or sent), and only until page 2 opens.
const carriedOver = new Map();

function RegistrationSteps({ step, mrn, careType }) {
  const steps = [
    {
      label: 'Patient information',
      caption: step === 1 ? (careType === 'newborn' ? "Baby's name, contact and birth details" : 'Name, age and contact details') : `Saved as ${mrn}`,
    },
    { label: 'Clinical details', caption: step === 1 ? 'Opens once the patient is saved' : (CLINICAL_CONTENTS[careType] ?? 'History and medical background') },
  ];
  return (
    <ol className="card reg-steps" aria-label="Registration steps">
      {steps.map((s, i) => {
        const state = i + 1 < step ? 'done' : i + 1 === step ? 'current' : 'next';
        return (
          <li key={s.label} className={`reg-step reg-step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="reg-step-mark" aria-hidden="true">
              {state === 'done' ? <Check /> : i + 1}
            </span>
            <span className="reg-step-text">
              <strong>
                <span className="sr-only">Step {i + 1}: </span>
                {s.label}
              </strong>
              <span className="t-caption muted">{s.caption}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Step 1: the patient's details, for the type of care chosen from the menu (/patients/new/antenatal …).
// OPD, IPD or day care (owner, 26 Oct 2026, as in the hospital's earlier software): asked with the form; an IPD or
// day-care patient is admitted right after she is registered (the Admit popup, with the admission type filled in).
const SETTINGS = [
  ['opd', 'OPD', Stethoscope],
  ['ipd', 'IPD', BedDouble],
  ['day_care', 'Day care', Sun],
];

// Service charges on the registration form (owner, 27 Oct 2026): billed as soon as she is saved – no trip to Billing.
// The registration fee itself is added by the app.
function RegistrationCharges({ charges, onCharges }) {
  const { items, error } = useChargeItems();
  return (
    <section className="card form-section" aria-labelledby="reg-charges">
      <h2 id="reg-charges">Service charges (optional)</h2>
      <p className="hint">Consultation, procedures or other services to bill today. The registration fee is added by itself.</p>
      <Alert type="error">{error}</Alert>
      <ChargeLines idPrefix="reg-charge" items={items} lines={charges.lines} onLines={(lines) => onCharges({ ...charges, lines })} pay={charges.pay} onPay={(pay) => onCharges({ ...charges, pay })} />
    </section>
  );
}
const NO_CHARGES = { lines: [], pay: 'cash' };

export function PatientNewPage() {
  const { careType: chosen } = useParams();
  const { user, activeMembership } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const setting = SETTINGS.some(([k]) => k === params.get('as')) ? params.get('as') : 'opd';
  const [admitting, setAdmitting] = useState(null); // { patient, registered, go } – registered as IPD or day care
  const location = useLocation();
  // A quick booking being registered (appointment booking: "Register" on the Today page): its name, phone and doctor
  // fill in the form, and once she is saved the booking joins her record. Carried in the page's navigation state.
  const booking = location.state?.fromBooking ?? null;
  // A Scan & Share registration (ABDM, Today page): her ABHA name, phone and age fill in the form; once saved her ABHA
  // is linked to the new record.
  const fromAbha = location.state?.fromScanShare ?? null;
  // A patient's online sign-up being registered (Patients → Online sign-ups, 16 Oct 2026): her name, mobile and age fill
  // in the form; once saved (or an existing record chosen) her sign-up is approved for that record.
  const fromSignup = location.state?.fromSignup ?? null;
  const roles = activeMembership.roles;
  const canCharge = ['receptionist', 'billing', 'admin'].some((r) => roles.includes(r));
  const [charges, setCharges] = useState(NO_CHARGES);
  const clinical = roles.includes('doctor') || roles.includes('rmo');
  const careType = CARE_TYPES.includes(chosen) ? chosen : null;
  const dictatedClinical = useRef(null);
  // What was said on the chooser, for the form it opened (taken once; the page stays mounted between the two)
  const [spoken, setSpoken] = useState({ for: careType, text: spokenForForm?.careType === careType ? spokenForForm.text : '' });
  if (spoken.for !== careType) setSpoken({ for: careType, text: careType && spokenForForm?.careType === careType ? spokenForForm.text : '' });
  useEffect(() => {
    if (careType) spokenForForm = null;
  }, [careType]);
  const linkState = booking ? { fromBooking: booking } : fromAbha ? { fromScanShare: fromAbha } : fromSignup ? { fromSignup } : undefined;
  const chooseBySpeech = (type, text) => {
    spokenForForm = { careType: type, text: withoutCareTypeWords(text) };
    navigate(`/patients/new/${type}`, { state: linkState });
  };
  // "She may already be registered": the matching records, and the details that were about to be saved
  const [matches, setMatches] = useState(null); // { list, total, payload } | null
  // "Save and register another" (owner, 13 Oct 2026): a fresh form for the next patient, with what was saved above it
  const [round, setRound] = useState(0);
  const [savedNote, setSavedNote] = useState(null);
  const [choosing, setChoosing] = useState(null); // the choice being carried out: 'register', or the id of the record being opened
  const [matchError, setMatchError] = useState(null);

  // Another type of care chosen from the menu: clinical details said for the old one no longer apply.
  useEffect(() => {
    dictatedClinical.current = null;
    setMatches(null);
  }, [careType]);

  // Whether the clinical-details page follows the save: RMOs always; doctors for their own or an unassigned
  // patient. This only sets the button label – after saving, the server's answer decides.
  const clinicalStep = (v) => roles.includes('rmo') || (roles.includes('doctor') && (!v.assignedDoctor || v.assignedDoctor === user.id));

  // Saves the patient's details. Records with the same phone number or name: nothing is saved – the warning opens.
  const save = async (payload, { another = false } = {}) => {
    if (!chargesOk(charges.lines)) throw new Error('Enter the amount for each service charge, or remove it.');
    let patient;
    try {
      ({ patient } = await api('/patients', { method: 'POST', body: payload }));
    } catch (err) {
      if (err.code !== 'POSSIBLE_MATCHES') throw err; // the form shows every other problem
      setMatchError(null);
      setMatches({ list: err.matches ?? [], total: err.total ?? 0, payload, another });
      return;
    }
    await afterRegistered(patient, another);
  };

  // "Register as a new patient anyway": the same details again, with the explicit confirmation.
  const registerAnyway = async () => {
    setChoosing('register');
    setMatchError(null);
    try {
      const { patient } = await api('/patients', { method: 'POST', body: { ...matches.payload, registerAnyway: true } });
      await afterRegistered(patient, matches.another);
    } catch (err) {
      setMatchError(err.fields && Object.keys(err.fields).length ? `${err.message} Go back to the form to correct them.` : err.message);
      setChoosing(null);
    }
  };

  // Approves her online sign-up for this record; the sentence to show either way.
  const approveSignup = async (patientId) => {
    try {
      await api(`/patient-accounts/${fromSignup.id}/approve`, { method: 'POST', body: { patientId } });
      return 'Her online sign-up is approved: she can sign in now.';
    } catch (err) {
      return `Her online sign-up was not approved (${err.message}) – approve it in Patients → Online sign-ups.`;
    }
  };

  // "Open this record": she is already registered. A quick booking being registered joins that record.
  const openExisting = async (match) => {
    setChoosing(match.id);
    let flash = null;
    if (fromSignup) {
      flash = await approveSignup(match.id);
    } else if (booking) {
      try {
        await api(`/appointments/${booking.id}/link`, { method: 'POST', body: { patientId: match.id } });
        flash = 'Her appointment is now on this record.';
      } catch (err) {
        flash = `Her appointment could not be added to this record (${err.message}) – book her again on the Appointments page.`;
      }
    } else if (fromAbha) {
      flash = 'Her ABHA is not linked yet – link it on the ABHA tab of this record.';
    }
    navigate(`/patients/${match.id}`, { state: flash ? { flash } : undefined });
  };

  // After she is saved: her ABHA or quick booking joins the new record, then page 2 (or her record).
  const afterRegistered = async (patient, another = false) => {
    let registered = `${patient.fullName} was registered in ${activeMembership.tenantName} as ${patient.mrn}.`;
    if (fromAbha) {
      try {
        await api(`/abdm/scan-share/${fromAbha.id}/link`, { method: 'POST', body: { patientId: patient.id } });
        registered += ' Her ABHA is linked.';
      } catch (err) {
        registered += ` Her ABHA could not be linked (${err.message}) – use the ABHA tab on her record.`;
      }
    }
    if (fromSignup) registered += ` ${await approveSignup(patient.id)}`;
    if (charges.lines.length) {
      try {
        registered += ` ${billedText(await billCharges(patient.id, charges.lines, charges.pay))}`;
      } catch (err) {
        registered += err.bill
          ? ` The service charges are on bill ${err.bill.number}, but the payment was not saved (${err.message}) – take it under Billing.`
          : ` The service charges could not be billed (${err.message}) – add them from Patients → Add service charge.`;
      }
      setCharges(NO_CHARGES);
    }
    if (booking) {
      try {
        await api(`/appointments/${booking.id}/link`, { method: 'POST', body: { patientId: patient.id } });
        registered += ' Her appointment is now on her record.';
      } catch (err) {
        registered += ` Her appointment could not be added to her record (${err.message}) – book her again on the Appointments page.`;
      }
    }
    if (setting !== 'opd') {
      const go = (note) => {
        setAdmitting(null);
        navigate(`/patients/${patient.id}`, { replace: true, state: { flash: `${registered}${note}` } });
      };
      setAdmitting({ patient, go });
      return;
    }
    if (another && !patient.access.canEditClinical && !booking && !fromAbha && !fromSignup) {
      setMatches(null);
      setChoosing(null);
      dictatedClinical.current = null;
      setSavedNote(`${registered} ${clinicalDetailsBy(patient)} will add the clinical details. The form is ready for the next patient.`);
      setRound((r) => r + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (patient.access.canEditClinical) {
      if (dictatedClinical.current) carriedOver.set(patient.id, dictatedClinical.current);
      navigate(`/patients/new/${patient.id}/clinical`, { replace: true, state: { flash: registered } });
    } else {
      const lost = dictatedClinical.current ? ' The clinical details that were said were not kept.' : '';
      navigate(`/patients/${patient.id}`, { replace: true, state: { flash: `${registered} ${clinicalDetailsBy(patient)} will add the clinical details.${lost}` } });
    }
  };

  const allowed = canRegisterPatients(roles);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Patients', to: '/patients' }, { label: 'New patient' }]}
        title="New patient"
        badges={careType && <StatusPill tone="neutral">{CARE_TYPE_LABELS[careType]}</StatusPill>}
        subtitle={careType ? undefined : 'Choose the type of care first; the form then shows only what is needed.'}
        tabs={patientTabs(roles)}
      />
      <div className="pf-content form-page form-page-voice">
        {!allowed && <div className="card narrow">Only reception, doctors and RMOs can register patients.</div>}
        {allowed && !careType && (
          // Cards, each with an icon and a line on what it is for (owner, 13 Oct 2026)
          <section aria-labelledby="care-type-title">
            <h2 id="care-type-title">Choose the type of care</h2>
            <SayCareType onChosen={chooseBySpeech} />
            <ul className="care-type-cards">
              {NEW_PATIENT_LINKS.map((l) => {
                const Icon = CARE_TYPE_ICONS[l.type] ?? UserPlus;
                return (
                  <li key={l.to}>
                    <Link to={l.to} className="care-type-card" state={linkState}>
                      <span className="care-type-icon" aria-hidden="true">
                        <Icon />
                      </span>
                      <span className="care-type-text">
                        <strong>{l.label}</strong>
                        <span>{CARE_TYPE_HINTS[l.type]}</span>
                      </span>
                      <ChevronRight className="care-type-go" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {allowed && careType && (
          <>
            {clinical && <RegistrationSteps step={1} careType={careType} />}
            <Alert type="success" onClose={() => setSavedNote(null)}>
              {savedNote}
            </Alert>
            {fromSignup && <Alert type="info">Registering {fromSignup.name} from her online sign-up. Her sign-up is approved for this record once she is saved.</Alert>}
            {fromAbha && <Alert type="info">Registering {fromAbha.name} from Scan & Share (ABHA). Her ABHA is linked once she is saved.</Alert>}
            {booking && (
              <Alert type="info">
                Registering {booking.name}, booked by phone. Her appointment joins her record once she is saved.
              </Alert>
            )}
            <div className="pn-setting">
              <span className="field-label" id="pn-setting-label">
                Patient type
              </span>
              <div className="segmented" role="group" aria-labelledby="pn-setting-label">
                {SETTINGS.map(([k, label, Icon]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={setting === k}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      if (k === 'opd') next.delete('as');
                      else next.set('as', k);
                      setParams(next, { replace: true, state: linkState });
                    }}
                  >
                    <Icon aria-hidden="true" /> {label}
                  </button>
                ))}
              </div>
              {setting !== 'opd' && <p className="hint">After she is registered, choose her bed: the admission opens as {setting === 'ipd' ? 'an inpatient stay' : 'day care'}.</p>}
            </div>
            <PatientForm
              key={booking?.id ?? fromAbha?.id ?? fromSignup?.id ?? `new-${round}`}
              spoken={round === 0 ? spoken.text : ''}
              prefill={booking ? { fullName: booking.name, phone: booking.phone, assignedDoctor: booking.doctorId ?? '' } : fromAbha ? { fullName: fromAbha.name, phone: fromAbha.phone ?? '', ageYears: fromAbha.age ?? '' } : fromSignup ? { fullName: fromSignup.name, phone: fromSignup.phone ?? '', ageYears: fromSignup.age ?? '' } : null}
              careType={careType}
              beforeActions={canCharge && careType ? <RegistrationCharges charges={charges} onCharges={setCharges} /> : null}
              onCareTypeChange={(type) => navigate({ pathname: `/patients/new/${type}`, search: location.search }, { replace: true, state: location.state })}
              part="info"
              onSubmit={save}
              submitLabel="Register patient"
              anotherLabel={booking || fromAbha || fromSignup ? null : 'Save and register another'}
              access={{ canEditIdentity: true, canEditNewborn: true, canEditClinical: clinical }}
              clinicalStep={clinicalStep}
              cancelTo="/patients"
              voice
              onDictatedClinical={(details) => {
                dictatedClinical.current = details;
              }}
            />
          </>
        )}
      </div>
      {matches && (
        <PossibleMatchesDialog
          careType={careType}
          matches={matches.list}
          total={matches.total}
          busy={choosing}
          error={matchError}
          openNote={fromSignup ? 'Her online sign-up is approved for the record you open.' : booking ? 'Her appointment is added to the record you open.' : null}
          onOpen={openExisting}
          onRegisterAnyway={registerAnyway}
          onBack={() => setMatches(null)}
        />
      )}
      {admitting && (
        <AdmitDialog
          patient={admitting.patient}
          admissionType={setting === 'day_care' ? 'day_care' : 'planned'}
          onClose={() => admitting.go(' She is not admitted yet: admit her from Beds when her bed is ready.')}
          onAdmitted={(a) => admitting.go(` Admitted${setting === 'day_care' ? ' for day care' : ''}: ${a.ward}, bed ${a.bed}${a.ipdNo ? ` (${a.ipdNo})` : ''}.`)}
        />
      )}
    </>
  );
}

// Step 2: the clinical details of a patient registered in step 1.
export function NewPatientClinicalPage() {
  const { id } = useParams();
  const { activeMembership } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, error } = useFetch(`/patients/${id}`);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  // Read here, forgotten once the page is open (read without removing, so React's double start in development keeps it).
  const [dictated] = useState(() => carriedOver.get(id) ?? null);
  useEffect(() => {
    carriedOver.delete(id);
  }, [id]);
  const patient = data?.patient;
  const breadcrumbs = [{ label: 'Patients', to: '/patients' }, { label: 'New patient' }];
  const tabs = patientTabs(activeMembership.roles);

  if (error && !patient) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Patient not found" tabs={tabs} />
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

  const record = `/patients/${patient.id}`;
  const save = async (payload) => {
    await api(`/patients/${patient.id}`, { method: 'PATCH', body: payload });
    navigate(record, { replace: true, state: { flash: 'Clinical details saved.' } });
  };
  // Only what this person may see (as on the patient page).
  const subtitle = [
    patient.mrn,
    patient.currentAge !== undefined || patient.newborn ? ageText(patient) : null,
    patient.assignedDoctorName !== undefined ? (patient.assignedDoctorName ? `Doctor: ${patient.assignedDoctorName}` : 'No doctor assigned') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={patient.fullName}
        documentTitle="New patient" /* never the patient's name: tab titles stay in browser history */
        badges={<StatusPill tone="neutral">{CARE_TYPE_SHORT[patient.careType]}</StatusPill>}
        subtitle={<span className="tabular">{subtitle}</span>}
        tabs={tabs}
      />
      <div className="pf-content form-page form-page-voice">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <RegistrationSteps step={2} mrn={patient.mrn} careType={patient.careType} />
        {patient.access.canEditClinical ? (
          <PatientForm
            key={patient.id}
            part="clinical"
            patient={patient}
            onSubmit={save}
            submitLabel="Save clinical details"
            access={patient.access}
            cancelTo={record}
            cancelLabel="Add later"
            voice
            dictated={dictated}
          />
        ) : (
          <div className="card narrow pf-message">
            <p>{clinicalDetailsBy(patient)} will add the clinical details.</p>
            <Link to={record} className="btn btn-link">
              Open the patient record
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
