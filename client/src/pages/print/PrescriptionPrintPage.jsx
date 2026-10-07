// A visit's prescription for printing: letterhead, the patient, vitals, findings, the medicines (℞), advice and the
// next visit, and the doctor's name and registration. Never printed: the private note and the reasons for going ahead
// despite a warning. No fetal-sex information exists to print (PC-PNDT).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { visitsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { labelOf } from '../../utils/format.js';
import { dayText } from '../appointments/appointmentFormat.js';
import { rxLine } from '../visits/visitFormat.js';
import { Letterhead, PrintFrame } from './PrintFrame.jsx';

export function PrescriptionPrintPage() {
  const { patientId, visitId } = useParams();
  const { patients: settings } = useAppConfig();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    visitsApi.get(patientId, visitId).then(setData).catch((err) => setError(err.message));
  }, [patientId, visitId]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { visit, patient, doctor, checks, print } = data;
  const v = visit.vitals;
  const d = visit.details;
  const vitals = [v.bpSystolic != null && `BP ${v.bpSystolic}/${v.bpDiastolic ?? '–'}`, v.weightKg != null && `Wt ${v.weightKg} kg`, v.pulse != null && `Pulse ${v.pulse}`, v.hb != null && `Hb ${v.hb}`, v.urineAlbumin && `Urine alb ${v.urineAlbumin}`].filter(Boolean);

  return (
    <PrintFrame ready title={`Prescription ${patient.patientNumber}`} footer={print.letterhead?.footer}>
      <Letterhead letterhead={print.letterhead} hospitalName={print.hospitalName} extra={<div className="print-doc">PRESCRIPTION<br /><strong>{dayText(visit.visitOn)}</strong></div>} />
      <p>
        <strong>{patient.name}</strong> · {patient.patientNumber} · {labelOf(settings.careTypes, visit.careType)}
        {checks.weeks != null && ` · ${checks.weeks} weeks`}
        {patient.allergies && <><br />Allergies: {patient.allergies}</>}
      </p>
      {vitals.length > 0 && <p className="small">{vitals.join(' · ')}</p>}
      {d.complaints && <p className="small"><strong>Complaints:</strong> {d.complaints}</p>}
      {d.diagnosis && <p className="small"><strong>Diagnosis:</strong> {d.diagnosis}</p>}
      <h3 className="rx-symbol">℞</h3>
      <ol className="rx-list">
        {visit.prescription.items.map((i) => <li key={i.id}>{rxLine(i)}{i.instructions && <span className="block small">{i.instructions}</span>}</li>)}
      </ol>
      {visit.prescription.notes && <p className="pre small">{visit.prescription.notes}</p>}
      {d.investigations && <p className="small"><strong>Tests advised:</strong> {d.investigations}</p>}
      {d.advice && <p className="small pre"><strong>Advice:</strong> {d.advice}</p>}
      {d.nextVisitOn && <p><strong>Next visit:</strong> {dayText(d.nextVisitOn, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}{d.nextVisitNote && ` – ${d.nextVisitNote}`}</p>}
      {doctor && (
        <p className="print-sign">
          <strong>{doctor.name}</strong>
          {doctor.qualification && <><br />{doctor.qualification}</>}
          {doctor.registrationNumber && <><br />Reg. no. {doctor.registrationNumber}{doctor.council && ` (${doctor.council})`}</>}
        </p>
      )}
      {!visit.signed && <p className="small muted">Not signed yet.</p>}
    </PrintFrame>
  );
}
