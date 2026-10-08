// Admissions at the front desk (reception): who is in hospital now and who went home today, and New admission –
// find the patient (or register her first), then admit her with her doctor, ward and bed.
import { BedDouble, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { admissionsApi, patientsApi, wardsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { PatientPicker } from '../../components/PatientPicker.jsx';
import { formatDateTime } from '../../utils/format.js';
import { AdmitDialog } from './AdmitDialog.jsx';
import { BookedBedsList, bedCounts } from './BookedBeds.jsx';

const searchPatients = (text) => patientsApi.list({ search: text, limit: 10, status: 'active' }).then((r) => ({ items: r.items }));

export function AdmissionsDeskPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [patient, setPatient] = useState(null);
  const [beds, setBeds] = useState(null);

  const load = useCallback(() => {
    admissionsApi.frontDesk().then(setData).catch((err) => setError(err.message));
    wardsApi.availability().then(setBeds).catch(() => setBeds(null));
  }, []);
  useEffect(load, [load]);

  const inHospital = (data?.items ?? []).filter((s) => s.status === 'admitted');
  const wentHome = (data?.items ?? []).filter((s) => s.status !== 'admitted');

  const Row = ({ s }) => (
    <li className="appt-line">
      <span>
        <Link to={`/hospital/patients/${s.patient.id}`}><strong>{s.patient.name}</strong></Link> <span className="muted">{s.patient.patientNumber}{s.admissionNumber && ` · ${s.admissionNumber}`}</span>
        <span className="muted block small">
          {[s.ward, s.bed && `bed ${s.bed}`, s.doctorName].filter(Boolean).join(' · ')} · admitted {formatDateTime(s.admittedAt)}
          {s.dischargedAt && ` · discharged ${formatDateTime(s.dischargedAt)}`}
        </span>
      </span>
    </li>
  );

  return (
    <>
      <PageHeader
        title="Admissions"
        subtitle="Who is in hospital now, and who went home today."
        actions={
          <>
            <Link to="/hospital/patients/new" className="btn btn-ghost"><UserPlus size={16} aria-hidden /> Register new patient</Link>
            <button type="button" className="btn btn-primary" onClick={() => setChoosing(true)}><BedDouble size={16} aria-hidden /> New admission</button>
          </>
        }
      />
      <Alert type="error">{error}</Alert>
      <Alert type="success">{notice}</Alert>
      {!data && !error && <Loader />}
      {beds && beds.items.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Beds</h2>
            <span className="muted small">{bedCounts(beds).booked} booked · {bedCounts(beds).free} of {bedCounts(beds).total} free</span>
          </div>
          <div className="occupancy">
            {beds.items.map((w) => (
              <div key={w.id} className={`ward-card${w.free === 0 ? ' full' : ''}`}>
                <strong>{w.name}</strong>
                <span className={`ward-free${w.free === 0 ? ' none' : ''}`}>{w.free === 0 ? 'Full' : `${w.free} free`}</span>
                <span className="muted small">{w.total - w.free} booked · {w.total} beds</span>
              </div>
            ))}
          </div>
          <h3 className="top-gap">Booked beds</h3>
          <BookedBedsList beds={beds} />
        </section>
      )}
      {data && (
        <>
          <section className="card top-gap">
            <div className="card-head"><h2>In hospital now</h2><span className="muted small">{inHospital.length}</span></div>
            {inHospital.length === 0 ? <p className="muted">Nobody is admitted.</p> : <ul className="plain-list rows">{inHospital.map((s) => <Row key={s.id} s={s} />)}</ul>}
          </section>
          <section className="card top-gap">
            <div className="card-head"><h2>Went home today</h2><span className="muted small">{wentHome.length}</span></div>
            {wentHome.length === 0 ? <p className="muted">No discharges yet today.</p> : <ul className="plain-list rows">{wentHome.map((s) => <Row key={s.id} s={s} />)}</ul>}
            <p className="small"><Link to="/hospital/discharges">Discharge cards and scans →</Link></p>
          </section>
        </>
      )}

      {choosing && !patient && (
        <Modal title="New admission" onClose={() => setChoosing(false)}>
          <p>Find the patient. A new patient is registered first.</p>
          <PatientPicker search={searchPatients} value={null} onChange={(p) => setPatient(p)} />
          <p className="small top-gap"><Link to="/hospital/patients/new">Register a new patient</Link></p>
        </Modal>
      )}
      {patient && (
        <AdmitDialog
          patient={patient}
          onClose={() => {
            setPatient(null);
            setChoosing(false);
          }}
          onAdmitted={(stay) => {
            setNotice(`${patient.name} admitted${stay.admissionNumber ? ` – ${stay.admissionNumber}` : ''}.`);
            setPatient(null);
            setChoosing(false);
            load();
          }}
        />
      )}
    </>
  );
}
