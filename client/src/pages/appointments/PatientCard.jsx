import { api } from '../../api.js';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel, timeLabel } from './appointmentFormat.js';

// The patient card (reception, docs/USE_CASE.md "Print a patient card"): an A5 page for the patient to keep and bring
// to every visit – the hospital, her name and patient number, her doctor, her next booked appointments and empty rows
// to write later ones in. Nothing medical and no phone number: a card can be lost or seen by others. Each printout is
// recorded in the audit log (ids only).

const SHOWN_APPOINTMENTS = 3;
const EMPTY_ROWS = 6;

export function PatientCard({ patient, onClose }) {
  const lh = useFetch('/tenant/settings/letterhead');
  const appts = useFetch(`/appointments/patient/${patient.id}`);
  const upcoming = (appts.data?.upcoming ?? []).filter((a) => a.kind === 'slot').slice(0, SHOWN_APPOINTMENTS);
  const ready = Boolean(lh.data && appts.data);
  const record = () => api(`/appointments/patient/${patient.id}/card-printed`, { method: 'POST' });

  return (
    <PrintPreview
      title="Patient card – print preview"
      hint="Give the card to the patient. It has no medical details."
      page={{ size: 'A5', margin: '10mm' }}
      onPrint={record}
      onClose={onClose}
    >
      {(lh.error || appts.error) && <Alert type="error">{lh.error || appts.error}</Alert>}
      {!ready && !lh.error && !appts.error && <p className="muted">Preparing the card…</p>}
      {ready && (
        <PrintDocument className="pcard">
          {lh.data.letterhead && <Letterhead letterhead={lh.data.letterhead} />}
          <h1 className="pdoc-title pcard-title">Patient card</h1>
          <dl className="pcard-facts">
            <div>
              <dt>Name</dt>
              <dd>{patient.fullName}</dd>
            </div>
            <div>
              <dt>Patient number</dt>
              <dd className="pcard-mrn">{patient.mrn}</dd>
            </div>
            {patient.assignedDoctorName && (
              <div>
                <dt>Doctor</dt>
                <dd>{patient.assignedDoctorName}</dd>
              </div>
            )}
          </dl>
          <table className="pcard-appts">
            <caption>Appointments</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Time</th>
                <th scope="col">Doctor</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((a) => (
                <tr key={a.id}>
                  <td>{dayLabel(a.date)}</td>
                  <td>{a.start ? timeLabel(a.start) : 'To be given'}</td>
                  <td>{a.doctor.name}</td>
                </tr>
              ))}
              {Array.from({ length: Math.max(0, EMPTY_ROWS - upcoming.length) }, (_, i) => (
                <tr key={`empty-${i}`} className="pcard-empty">
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pdoc-small pcard-note">
            Please bring this card to every visit and show it at the reception desk. To change an appointment, call the
            hospital{lh.data.letterhead?.phone ? ` on ${lh.data.letterhead.phone}` : ''}.
          </p>
        </PrintDocument>
      )}
    </PrintPreview>
  );
}
