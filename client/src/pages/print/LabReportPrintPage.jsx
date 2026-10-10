// A finalized lab report for printing or saving as PDF, to give to the patient (owner, 10 Oct 2026): A4 with the
// hospital's letterhead, LAB REPORT and the order number; name, age / sex, Reg. no., sample, who ordered it and when
// the sample was taken and reported; each test's results with the flag and the reference range (marked DRAFT while
// the ranges are drafts); the lab's remark; and the doctor who finalized it. Only a finalized report is printed
// (GET /hospital/lab/orders/:id/print – the lab, her doctor or an RMO; config.access.labPrint).
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { labApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { ageText, formatDate, formatDateTime, labelOf } from '../../utils/format.js';
import { DocTitle, Letterhead, PrintFrame } from './PrintFrame.jsx';

const FLAG_WORDS = { low: 'Low', high: 'High', abnormal: 'Abnormal' };

// The saved file's name, e.g. "Lab_Report_L-000012_P-000001" (no patient name: file names end up in many places).
const fileTitle = (order, patient) => `Lab_Report_${order.orderNumber}_${patient.patientNumber}`;

export function LabReportPrintPage() {
  const { id } = useParams();
  const { patients: patientSettings } = useAppConfig();
  const [data, setData] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([labApi.printReport(id), labApi.catalogue()])
      .then(([report, cat]) => {
        setData(report);
        setCatalogue(cat);
      })
      .catch((err) => setError(err.message));
  }, [id]);
  const defs = useMemo(() => new Map((catalogue?.tests ?? []).map((t) => [t.key, t])), [catalogue]);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data || !catalogue) return <Loader />;
  const { order, patient, print, verifiedBy } = data;
  const age = patient.birthDate ? ageText(patient.birthDate, patient.birthDateApprox) : '';
  const sex = patient.sex ? labelOf(patientSettings.sexes, patient.sex) : '';

  return (
    <PrintFrame ready title={fileTitle(order, patient)} footer={print.letterhead?.footer} size="A4">
      <Letterhead letterhead={print.letterhead} hospitalName={print.hospitalName} />
      <DocTitle right={order.orderNumber}>LAB REPORT</DocTitle>

      <table className="print-table lab-report-head">
        <tbody>
          <tr>
            <th scope="row">Name</th><td><strong>{patient.name}</strong></td>
            <th scope="row">Age / Sex</th><td>{[age, sex].filter(Boolean).join(' / ') || '—'}</td>
          </tr>
          <tr>
            <th scope="row">Reg. No.</th><td>{patient.patientNumber}</td>
            <th scope="row">Sample</th><td>{order.sample ? [order.sample.number, ...order.sample.types].join(' · ') : '—'}</td>
          </tr>
          <tr>
            <th scope="row">Ordered by</th><td>{order.ordered?.by || '—'}</td>
            <th scope="row">Sample taken</th><td>{order.collected ? formatDateTime(order.collected.at) : '—'}</td>
          </tr>
          <tr>
            <th scope="row">Reported</th><td>{order.reported ? formatDateTime(order.reported.at) : '—'}</td>
            <th scope="row">Finalized</th><td>{order.reviewed ? formatDateTime(order.reviewed.at) : '—'}</td>
          </tr>
        </tbody>
      </table>

      <table className="print-table">
        <thead>
          <tr><th>Test</th><th>Result</th><th>Flag</th><th>Reference range (DRAFT)</th></tr>
        </thead>
        <tbody>
          {order.tests.map((t) => {
            const fields = (defs.get(t.key)?.fields ?? []).filter((f) => f.type !== 'text');
            const rows = fields.length ? fields : [null];
            return [
              ...rows.map((f, i) => {
                const v = f && t.values.find((x) => x.key === f.key);
                return (
                  <tr key={`${t.key}:${t.name}:${f?.key ?? 'text'}`}>
                    <td>{i === 0 ? <strong>{t.name}</strong> : ''}{f && f.name !== t.name && <span className="block small">{f.name}</span>}</td>
                    <td>{f ? (v?.value ? `${v.value}${f.unit ? ` ${f.unit}` : ''}` : '—') : t.text || '—'}</td>
                    <td>{v?.flag && FLAG_WORDS[v.flag] ? <strong>{FLAG_WORDS[v.flag]}</strong> : ''}</td>
                    <td className="small">{f?.range || (f?.type === 'choice' && f.abnormal?.length ? `Flagged: ${f.abnormal.join(', ')}` : '')}</td>
                  </tr>
                );
              }),
              ...(t.text && fields.length ? [<tr key={`${t.key}:${t.name}:note`}><td /><td colSpan={3} className="small">Comment: {t.text}</td></tr>] : []),
            ];
          })}
        </tbody>
      </table>

      {order.labNote && <p className="small pre"><strong>Remark:</strong> {order.labNote}</p>}
      {order.amendments.length > 0 && <p className="small">Results corrected after the first report on {order.amendments.map((a) => formatDate(a.at)).join(', ')}.</p>}
      <p className="small muted">The reference ranges are drafts until the hospital approves them. Results are to be read by a doctor.</p>

      <div className="print-sign-row">
        <p className="print-sign">{order.reported?.by}<br />Lab</p>
        <p className="print-sign">
          <strong>{verifiedBy?.name ?? order.reviewed?.by}</strong>
          {verifiedBy?.qualification && <><br />{verifiedBy.qualification}</>}
          {verifiedBy?.registrationNumber && <><br />Reg. no. {verifiedBy.registrationNumber}</>}
          <br />Finalized by the doctor
        </p>
      </div>
    </PrintFrame>
  );
}
