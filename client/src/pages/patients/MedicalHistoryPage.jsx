// Her medical history on one page (doctors, RMOs, nurses): stays and discharge cards, visits with diagnosis and
// medicines, lab orders and scanned documents – newest first. Each item opens in its own screen.
import { ArrowLeft, FileDown, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { medicalHistoryApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { formatDate, labelOf } from '../../utils/format.js';
import { openDocument } from '../documents/PatientDocumentsCard.jsx';

const LAB_WORDS = { ordered: 'Ordered', collected: 'Sample taken', reported: 'Reported', reviewed: 'Reviewed', cancelled: 'Cancelled' };

function Section({ title, empty, children, count }) {
  return (
    <section className="card top-gap">
      <div className="card-head"><h2>{title}</h2><span className="muted small">{count}</span></div>
      {count === 0 ? <p className="muted">{empty}</p> : <ul className="plain-list rows">{children}</ul>}
    </section>
  );
}

export function MedicalHistoryPage() {
  const { id } = useParams();
  const { documents: docSettings } = useAppConfig();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    medicalHistoryApi.get(id).then(setData).catch((err) => setError(err.message));
  }, [id]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { patient, stays, visits, labOrders, documents } = data;

  return (
    <>
      <PageHeader
        back={<Link to={`/hospital/patients/${id}`} className="back-link"><ArrowLeft size={16} aria-hidden /> {patient.name}</Link>}
        title="Medical history"
        subtitle={`${patient.name} · ${patient.patientNumber}${patient.bloodGroup ? ` · Blood group ${patient.bloodGroup}` : ''}${patient.allergies ? ` · Allergies: ${patient.allergies}` : ''}`}
      />

      <Section title="Admissions and discharges" count={stays.length} empty="Never admitted.">
        {stays.map((s) => (
          <li key={s.id} className="appt-line">
            <span>
              <Link to={`/hospital/inpatients/${s.id}`}><strong>{formatDate(s.admittedAt)}</strong>{s.dischargedAt ? ` – ${formatDate(s.dischargedAt)}` : ' – in hospital'}</Link>
              <span className="muted block small">{[s.ward, s.reason].filter(Boolean).join(' · ')}</span>
              {s.dischargeCard?.finalDiagnosis && <span className="block small">Final diagnosis: {s.dischargeCard.finalDiagnosis}</span>}
            </span>
            {s.dischargeCard && (
              <a className="btn btn-ghost btn-sm" href={`/hospital/print/discharge-card/${s.dischargeCard.id}`} target="_blank" rel="noreferrer">
                <FileDown size={14} aria-hidden /> Discharge card
              </a>
            )}
          </li>
        ))}
      </Section>

      <Section title="Visits, diagnoses and prescriptions" count={visits.length} empty="No visits yet.">
        {visits.map((v) => (
          <li key={v.id} className="appt-line">
            <span>
              <Link to={`/hospital/patients/${id}/visits/${v.id}`}><strong>{formatDate(v.visitOn)}</strong></Link> <span className="muted">{v.doctorName}{!v.signed && ' · not signed yet'}</span>
              {v.diagnosis && <span className="block small">Diagnosis: {v.diagnosis}</span>}
              {!v.diagnosis && v.complaints && <span className="block small">Complaints: {v.complaints}</span>}
              {v.medicines.length > 0 && <span className="block small muted">Medicines: {v.medicines.join(', ')}</span>}
            </span>
          </li>
        ))}
      </Section>

      <Section title="Lab reports" count={labOrders.length} empty="No lab orders yet.">
        {labOrders.map((o) => (
          <li key={o.id} className="appt-line">
            <span>
              <strong>{formatDate(o.orderedAt)}</strong> <span className="muted">{o.orderNumber} · {LAB_WORDS[o.status] ?? o.status}</span>
              <span className="block small">{o.tests.join(', ')}</span>
            </span>
          </li>
        ))}
      </Section>

      <Section title="Scanned documents" count={documents.length} empty="No documents uploaded. Upload them from her record (Documents).">
        {documents.map((d) => (
          <li key={d.id} className="appt-line">
            <span>
              <button type="button" className="btn btn-link" onClick={() => openDocument(d.id).catch((err) => setError(err.message))}>
                <FileText size={14} aria-hidden /> {labelOf(docSettings.kinds, d.kind)}
              </button>
              {d.title && ` – ${d.title}`}
              <span className="muted block small">{d.documentDate ? `Dated ${formatDate(d.documentDate)} · ` : ''}uploaded {formatDate(d.uploadedAt)} by {d.uploadedByName}</span>
            </span>
          </li>
        ))}
      </Section>
    </>
  );
}
