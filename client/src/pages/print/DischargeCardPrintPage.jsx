// A signed discharge card with the hospital's letterhead, for printing or saving as PDF (the print dialog's "Save as
// PDF"). For her doctor, nurses and reception alike: it reads only the signed card (GET /hospital/discharges/:id).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { dischargesApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { DischargeSummaryView } from '../inpatient/DischargeSummary.jsx';
import { Letterhead, PrintFrame } from './PrintFrame.jsx';

// The saved file's name, e.g. "Discharge_P-000001_2026-10-07" (no patient name: file names end up in many places).
const fileTitle = (d) => `Discharge_Summary_${d.patient.patientNumber}_${new Date(d.card.content?.dischargedAt ?? d.card.signed?.at ?? Date.now()).toISOString().slice(0, 10)}`;

export function DischargeCardPrintPage() {
  const { cardId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    dischargesApi.card(cardId).then(setData).catch((err) => setError(err.message));
  }, [cardId]);
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { patient, stay, card } = data;
  const address = [patient.address?.line, patient.address?.city, patient.address?.state, patient.address?.pincode].filter(Boolean).join(', ');
  return (
    <PrintFrame ready title={fileTitle(data)} footer={data.letterhead?.footer}>
      <Letterhead letterhead={data.letterhead} hospitalName={data.hospitalName} extra={<div className="print-doc">DISCHARGE SUMMARY</div>} />
      <DischargeSummaryView patient={patient} stay={stay ?? {}} content={card.content} />
      {address && <p className="small">Address: {address}</p>}
      {card.additions.length > 0 && (
        <>
          <h3 className="summary-h">Corrections and additions</h3>
          {card.additions.map((a, i) => <p key={i} className="small">{a.text} – {a.byName}, {formatDateTime(a.at)}</p>)}
        </>
      )}
      <div className="print-sign-row">
        <p className="print-sign"><strong>{card.signed?.byName}</strong><br />Finalized {formatDate(card.signed?.at)}<br />Doctor’s signature</p>
        <p className="print-sign">&nbsp;<br />&nbsp;<br />Hospital stamp</p>
      </div>
    </PrintFrame>
  );
}
