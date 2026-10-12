import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { canRegisterPatients, patientTabs } from '../../platform/modules.js';
import { PatientForm } from './PatientForm.jsx';
import { PossibleMatchesDialog } from './PossibleMatchesDialog.jsx';
import { CARE_TYPE_LABELS, CARE_TYPE_SHORT, CARE_TYPES, NEW_PATIENT_LINKS, ageText } from './patientFormat.js';

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
export function PatientNewPage() {
  const { careType: chosen } = useParams();
  const { user, activeMembership } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // A quick booking being registered (appointment booking: "Register" on the Today page): its name, phone and doctor
  // fill in the form, and once she is saved the booking joins her record. Carried in the page's navigation state.
  const booking = location.state?.fromBooking ?? null;
  // A Scan & Share registration (ABDM, Today page): her ABHA name, phone and age fill in the form; once saved her ABHA
  // is linked to the new record.
  const fromAbha = location.state?.fromScanShare ?? null;
  const roles = activeMembership.roles;
  const clinical = roles.includes('doctor') || roles.includes('rmo');
  const careType = CARE_TYPES.includes(chosen) ? chosen : null;
  const dictatedClinical = useRef(null);
  // "She may already be registered": the matching records, and the details that were about to be saved
  const [matches, setMatches] = useState(null); // { list, total, payload } | null
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
  const save = async (payload) => {
    let patient;
    try {
      ({ patient } = await api('/patients', { method: 'POST', body: payload }));
    } catch (err) {
      if (err.code !== 'POSSIBLE_MATCHES') throw err; // the form shows every other problem
      setMatchError(null);
      setMatches({ list: err.matches ?? [], total: err.total ?? 0, payload });
      return;
    }
    await afterRegistered(patient);
  };

  // "Register as a new patient anyway": the same details again, with the explicit confirmation.
  const registerAnyway = async () => {
    setChoosing('register');
    setMatchError(null);
    try {
      const { patient } = await api('/patients', { method: 'POST', body: { ...matches.payload, registerAnyway: true } });
      await afterRegistered(patient);
    } catch (err) {
      setMatchError(err.fields && Object.keys(err.fields).length ? `${err.message} Go back to the form to correct them.` : err.message);
      setChoosing(null);
    }
  };

  // "Open this record": she is already registered. A quick booking being registered joins that record.
  const openExisting = async (match) => {
    setChoosing(match.id);
    let flash = null;
    if (booking) {
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
  const afterRegistered = async (patient) => {
    let registered = `${patient.fullName} was registered in ${activeMembership.tenantName} as ${patient.mrn}.`;
    if (fromAbha) {
      try {
        await api(`/abdm/scan-share/${fromAbha.id}/link`, { method: 'POST', body: { patientId: patient.id } });
        registered += ' Her ABHA is linked.';
      } catch (err) {
        registered += ` Her ABHA could not be linked (${err.message}) – use the ABHA tab on her record.`;
      }
    }
    if (booking) {
      try {
        await api(`/appointments/${booking.id}/link`, { method: 'POST', body: { patientId: patient.id } });
        registered += ' Her appointment is now on her record.';
      } catch (err) {
        registered += ` Her appointment could not be added to her record (${err.message}) – book her again on the Appointments page.`;
      }
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
          <section className="card narrow">
            <h2>Type of care</h2>
            <ul className="plain-list care-type-list">
              {NEW_PATIENT_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} state={booking ? { fromBooking: booking } : fromAbha ? { fromScanShare: fromAbha } : undefined}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {allowed && careType && (
          <>
            {clinical && <RegistrationSteps step={1} careType={careType} />}
            {fromAbha && <Alert type="info">Registering {fromAbha.name} from Scan & Share (ABHA). Her ABHA is linked once she is saved.</Alert>}
            {booking && (
              <Alert type="info">
                Registering {booking.name}, booked by phone. Her appointment joins her record once she is saved.
              </Alert>
            )}
            <PatientForm
              key={booking?.id ?? fromAbha?.id ?? 'new'}
              prefill={booking ? { fullName: booking.name, phone: booking.phone, assignedDoctor: booking.doctorId ?? '' } : fromAbha ? { fullName: fromAbha.name, phone: fromAbha.phone ?? '', ageYears: fromAbha.age ?? '' } : null}
              careType={careType}
              part="info"
              onSubmit={save}
              submitLabel="Register patient"
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
          openNote={booking ? 'Her appointment is added to the record you open.' : null}
          onOpen={openExisting}
          onRegisterAnyway={registerAnyway}
          onBack={() => setMatches(null)}
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
