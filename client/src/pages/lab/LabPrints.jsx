import { useState } from 'react';
import { ArrowDown, ArrowUp, TriangleAlert } from 'lucide-react';
import { api } from '../../api.js';
import { blobToBase64 } from '../visits/whatsapp.js';
import { Barcode } from '../../components/print/Barcode.jsx';
import { Letterhead, LetterheadFooter } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { departmentName, isAbnormal, isConfidential, sampleLabels, shownName, testDef, valueWords } from './labFormat.js';

// The lab's printouts (docs/LAB_LIMS_PLAN.md features 1 and 4), printed by the browser on A4:
//  - sample labels: one per container, with a Code 128 barcode of the sample number and the container's number,
//    the patient's name, number and age, the sample and its tests (a confidential test by its neutral name);
//  - the lab report: the letterhead, the patient and sample, the results by department with the range used and the
//    flag (icon + word), the lab remark, who entered and who checked it. A confidential test (HIV) is left out unless
//    the person printing includes it, and then prints under its neutral name. Ranges a doctor has not approved are
//    marked DRAFT. Each printout is recorded in the audit log (ids only).

const FLAG_PRINT = { low: { icon: ArrowDown, word: 'Low' }, high: { icon: ArrowUp, word: 'High' }, abnormal: { icon: TriangleAlert, word: 'Abnormal' } };

export function LabLabels({ order, catalogue, onPrinted, onClose }) {
  const labels = order.sampleNo ? sampleLabels(order, catalogue) : [];
  const p = order.patient;
  const record = async () => {
    const res = await api(`/lab/orders/${order.id}/labels-printed`, { method: 'POST' });
    onPrinted?.(res.order);
  };
  return (
    <PrintPreview title="Sample labels – print preview" hint="One label per container. Print on A4 label sheets (50 × 25 mm) or plain paper and cut." onPrint={record} onClose={onClose}>
      {!order.sampleNo ? (
        <Alert type="info">This order was made before sample numbers. Press Print to give it a number – the labels then show it.</Alert>
      ) : (
        <PrintDocument className="lab-labels">
          {labels.map((l) => (
            <div key={l.code} className="lab-label">
              <Barcode value={l.code} height={8} />
              <div className="lab-label-code">{l.code}</div>
              <div className="lab-label-name">{p.fullName}</div>
              <div className="lab-label-line">
                {p.mrn}
                {p.age != null ? ` · ${p.age} yrs` : ''} · {formatDate(order.ordered.at)}
                {order.urgent ? ' · URGENT' : ''}
              </div>
              <div className="lab-label-line">
                <strong>{l.sample}</strong>: {l.tests.join(', ')}
              </div>
            </div>
          ))}
        </PrintDocument>
      )}
    </PrintPreview>
  );
}

/** The tests of the report by department, in the order's order. */
function byDepartment(tests, catalogue) {
  const groups = new Map();
  for (const t of tests) {
    const dept = t.department || testDef(catalogue, t.key)?.department || 'other';
    if (!groups.has(dept)) groups.set(dept, []);
    groups.get(dept).push(t);
  }
  return [...groups.entries()];
}

export function LabReportDocument({ order, catalogue, letterhead, withConfidential }) {
  const tests = order.tests.filter((t) => withConfidential || !isConfidential(t));
  const left = order.tests.length - tests.length;
  const draft = tests.some((t) => testDef(catalogue, t.key)?.status === 'draft' && t.values.some((v) => v.range || testDef(catalogue, t.key)?.fields?.some((f) => f.key === v.key && f.range)));
  const p = order.patient;
  const checkedBy = order.verified?.byName ?? null;
  return (
    <PrintDocument
      className="lab-report"
      draft={draft ? 'Usual ranges marked DRAFT are not yet approved by the hospital’s doctor. The flags only draw attention: the treating doctor decides.' : undefined}
      footer={
        <>
          {letterhead && <LetterheadFooter letterhead={letterhead} />}
          <span>Sample {order.sampleNo ?? '—'} · printed {formatDateTime(new Date())}</span>
        </>
      }
    >
      {letterhead && <Letterhead letterhead={letterhead} />}
      <h1 className="pdoc-title">Laboratory report</h1>
      <PrintFacts
        items={[
          ['Patient', p.fullName],
          ['Patient number', p.mrn],
          ['Age', p.age != null ? `${p.age} years` : ''],
          ['Sample number', order.sampleNo ?? ''],
          ['Ordered by', order.ordered.byName],
          ['Ordered', formatDateTime(order.ordered.at)],
          ['Sample taken', order.collected ? formatDateTime(order.collected.at) : ''],
          ['Reported', order.reported ? formatDateTime(order.reported.at) : ''],
        ]}
      />
      <table className="ptable pdoc-table lab-report-table">
        <thead>
          <tr>
            <th scope="col">Test</th>
            <th scope="col">Result</th>
            <th scope="col">Unit</th>
            <th scope="col">Usual range</th>
          </tr>
        </thead>
        <tbody>
          {byDepartment(tests, catalogue).map(([dept, list]) => [
            <tr key={`d-${dept}`} className="pdoc-group">
              <td colSpan={4}>{departmentName(dept)}</td>
            </tr>,
            ...list.flatMap((t, ti) => {
              const def = testDef(catalogue, t.key);
              const values = t.values.filter((v) => v.value !== '');
              const isDraft = def?.status === 'draft';
              return [
                <tr key={`t-${dept}-${ti}`}>
                  <td colSpan={4}>
                    <strong>{shownName(t)}</strong>
                    {t.outside && <span className="pdoc-kind">Done at {t.outside.labName}</span>}
                  </td>
                </tr>,
                ...values.map((v) => {
                  const w = valueWords(v, def);
                  const flag = FLAG_PRINT[v.flag];
                  const Icon = flag?.icon;
                  return (
                    <tr key={`v-${dept}-${ti}-${v.key}`}>
                      <td className="lab-report-indent">{isConfidential(t) ? 'Result' : w.name}</td>
                      <td className="pdoc-tabular">
                        {isAbnormal(v.flag) ? <strong>{v.value}</strong> : v.value}
                        {flag && (
                          <span className="lab-report-flag">
                            {' '}
                            <Icon aria-hidden="true" /> {flag.word}
                          </span>
                        )}
                      </td>
                      <td>{w.unit}</td>
                      <td>
                        {w.range}
                        {w.range && isDraft ? ' (DRAFT)' : ''}
                      </td>
                    </tr>
                  );
                }),
                ...(t.text
                  ? [
                      <tr key={`x-${dept}-${ti}`}>
                        <td className="lab-report-indent" colSpan={4}>
                          {t.text}
                        </td>
                      </tr>,
                    ]
                  : []),
                ...(!values.length && !t.text
                  ? [
                      <tr key={`n-${dept}-${ti}`}>
                        <td className="lab-report-indent" colSpan={4}>
                          See the attached report.
                        </td>
                      </tr>,
                    ]
                  : []),
              ];
            }),
          ])}
        </tbody>
      </table>
      {left > 0 && <p className="pdoc-small">{left === 1 ? 'One confidential test is' : `${left} confidential tests are`} not on this printout. The doctor has the result.</p>}
      {order.labNote && (
        <p>
          <strong>Lab remark: </strong>
          {order.labNote}
        </p>
      )}
      <div className="pdoc-sigs">
        <div className="pdoc-sig">
          <h2 className="pdoc-sig-title">Entered by</h2>
          <p>{order.entered?.byName ?? order.reported?.byName ?? ''}</p>
        </div>
        <div className="pdoc-sig">
          <h2 className="pdoc-sig-title">{checkedBy ? 'Checked and reported by' : 'Signature'}</h2>
          {checkedBy && <p>{checkedBy}</p>}
          <div className="pdoc-sig-line">
            <span className="pdoc-sig-label">Signature</span>
            <span className="pdoc-sig-fill" />
          </div>
        </div>
      </div>
      <p className="pdoc-small">{order.status === 'reviewed' ? `Reviewed by ${order.reviewed.byName}, ${formatDate(order.reviewed.at)}.` : 'Not reviewed by a doctor yet.'}</p>
    </PrintDocument>
  );
}

export function LabReportPrint({ order, catalogue, onClose }) {
  const lh = useFetch('/tenant/settings/letterhead');
  const hasConfidential = order.tests.some(isConfidential);
  const [withConfidential, setWithConfidential] = useState(false);
  const record = () => api(`/lab/orders/${order.id}/report-printed`, { method: 'POST', body: { confidential: hasConfidential && withConfidential } });
  // On WhatsApp in one click once a doctor reviewed it, with her agreement – never with the confidential test
  const offer = useFetch(order.status === 'reviewed' ? `/lab/orders/${order.id}/whatsapp` : null);
  const pdf = {
    fileName: `Lab report ${order.sampleNo ?? order.patient.mrn}.pdf`,
    title: `Lab report ${order.sampleNo ?? ''}`.trim(),
    onSaved: () => record(),
    sendNow:
      offer.data?.available && !withConfidential
        ? { label: offer.data.label, practice: offer.data.practice, send: async (blob) => api(`/lab/orders/${order.id}/whatsapp`, { method: 'POST', body: { pdf: await blobToBase64(blob), confidential: false } }) }
        : null,
  };
  return (
    <PrintPreview
      pdf={pdf}
      docKey={lh.data ? `${order.id}-${withConfidential}` : null}
      title="Lab report – print preview"
      hint="Check it, then print on A4 paper. Use only fake sample data until the app has been reviewed."
      controls={
        hasConfidential ? (
          <label className="check">
            <input type="checkbox" checked={withConfidential} onChange={(e) => setWithConfidential(e.target.checked)} /> Include the confidential test (printed as “Lab test
            (confidential)”)
          </label>
        ) : null
      }
      onPrint={record}
      onClose={onClose}
    >
      {lh.error && <Alert type="error">{lh.error}</Alert>}
      {!lh.data && !lh.error ? <p className="muted">Preparing the report…</p> : <LabReportDocument order={order} catalogue={catalogue} letterhead={lh.data?.letterhead} withConfidential={withConfidential} />}
    </PrintPreview>
  );
}
