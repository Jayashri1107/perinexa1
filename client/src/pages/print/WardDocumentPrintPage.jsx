// A signed ward document for printing (the discharge card above all): letterhead, the patient and her stay, the
// document's fields, who signed it, and any corrections added below it.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { admissionsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { formatDateTime } from '../../utils/format.js';
import { DocumentView } from '../inpatient/DocumentEditor.jsx';
import { DischargeSummaryView } from '../inpatient/DischargeSummary.jsx';
import { KIND_LABELS } from '../inpatient/inpatientFormat.js';
import { PrintFrame } from './PrintFrame.jsx';

export function WardDocumentPrintPage() {
  const { stayId, docId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    admissionsApi.get(stayId).then(setData).catch((err) => setError(err.message));
  }, [stayId]);
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const doc = data.documents.find((d) => d.id === docId);
  if (!doc) return <Alert type="error">Document not found.</Alert>;
  const { patient, stay } = data;
  if (doc.kind === 'discharge') {
    return (
      <PrintFrame ready title={`Discharge_Summary_${patient.patientNumber}_${doc.status === 'signed' ? 'final' : 'DRAFT'}`}>
        <header className="print-head">
          <div className="print-name">DISCHARGE SUMMARY</div>
          <div className="print-doc">{doc.status === 'signed' ? 'Finalized' : 'DRAFT – not final, not for the patient'}</div>
        </header>
        <DischargeSummaryView patient={patient} stay={stay} content={doc.content} />
      </PrintFrame>
    );
  }
  return (
    <PrintFrame ready title={`${KIND_LABELS[doc.kind]} ${patient.patientNumber}`}>
      <header className="print-head">
        <div className="print-name">{KIND_LABELS[doc.kind].toUpperCase()}</div>
        <div className="print-doc">{patient.name}<br />{patient.patientNumber}</div>
      </header>
      <p className="small">
        Admitted {formatDateTime(stay.admittedAt)} · {stay.ward}{stay.bed && `, bed ${stay.bed}`}
        {patient.allergies && ` · Allergies: ${patient.allergies}`}
      </p>
      <DocumentView kind={doc.kind} content={doc.content} />
      {doc.signed && <p className="print-sign"><strong>{doc.signed.byName}</strong><br />Signed {formatDateTime(doc.signed.at)}</p>}
      {doc.additions.length > 0 && (
        <>
          <h3>Corrections and additions</h3>
          {doc.additions.map((a, i) => <p key={i} className="small">{a.text} – {a.byName}, {formatDateTime(a.at)}</p>)}
        </>
      )}
    </PrintFrame>
  );
}
