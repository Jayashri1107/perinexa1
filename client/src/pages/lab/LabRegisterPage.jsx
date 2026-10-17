import { useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Letterhead } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { DepartmentSelect } from './LabWorklistPage.jsx';
import { LATE_LOOK, departmentName, orderLook, registerCsv, turnaround } from './labFormat.js';

// Lab → Register (docs/LAB_LIMS_PLAN.md feature 8): every order made between two dates (at most 62 days), in one
// department or all, with the day's counts – to print or to save as a CSV file for Excel. A confidential test is
// listed under its neutral name. Opening the register is recorded (the dates and how many orders, no names).

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const COUNTS = [
  ['orders', 'Orders'],
  ['tests', 'Tests'],
  ['collected', 'Samples taken'],
  ['rejected', 'With a rejected sample'],
  ['waiting', 'Not reported yet'],
  ['reported', 'Reported'],
  ['reviewed', 'Reviewed by a doctor'],
  ['abnormal', 'Outside the usual range'],
  ['late', 'Late'],
  ['outside', 'Sent to an outside lab'],
  ['urgent', 'Urgent'],
  ['cancelled', 'Cancelled'],
];

function RegisterTable({ orders }) {
  return (
    <table className="ptable pdoc-table lab-register-table">
      <thead>
        <tr>
          <th scope="col">Sample</th>
          <th scope="col">Ordered</th>
          <th scope="col">Patient</th>
          <th scope="col">Tests</th>
          <th scope="col">Status</th>
          <th scope="col">Time taken</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td className="pdoc-tabular">{o.sampleNo ?? '—'}</td>
            <td>{formatDateTime(o.ordered.at)}</td>
            <td>
              {o.patient.fullName}
              <span className="pdoc-kind">{o.patient.mrn}</span>
            </td>
            <td>
              {o.tests.map((t) => t.name).join(', ')}
              {o.tests.some((t) => t.outside) && <span className="pdoc-kind">Outside: {[...new Set(o.tests.filter((t) => t.outside).map((t) => t.outside.labName))].join(', ')}</span>}
            </td>
            <td>
              {orderLook(o).word}
              {o.urgent ? ' · urgent' : ''}
              {o.rejections.length ? ` · ${o.rejections.length} rejected` : ''}
            </td>
            <td>
              {o.status === 'cancelled' ? '—' : turnaround(o)}
              {o.late ? ' · late' : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LabRegisterPage() {
  const [form, setForm] = useState({ from: today(), to: today(), department: '' });
  const [query, setQuery] = useState(form);
  const [printing, setPrinting] = useState(false);
  const { data, error, loading } = useFetch('/lab/register', { from: query.from, to: query.to, ...(query.department ? { department: query.department } : {}) });
  const lh = useFetch(printing ? '/tenant/settings/letterhead' : null);
  const span = data ? (data.from === data.to ? formatDate(data.from) : `${formatDate(data.from)} to ${formatDate(data.to)}`) : '';
  const save = () => downloadFile(new Blob([`﻿${registerCsv(data.orders)}`], { type: 'text/csv;charset=utf-8' }), `lab-register-${data.from}-to-${data.to}.csv`);

  return (
    <>
      <PageHeader title="Lab register" documentTitle="Lab register" help="The lab's orders between two dates with the day's counts. Print it, or save it as a file for Excel." />
      <div className="pf-content">
        <form
          className="card lab-find"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(form);
          }}
        >
          <div className="form-grid">
            <Field label="From" id="lab-reg-from">
              <input id="lab-reg-from" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
            </Field>
            <Field label="To" id="lab-reg-to">
              <input id="lab-reg-to" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
            </Field>
          </div>
          <div className="row">
            <DepartmentSelect id="lab-reg-department" value={form.department} onChange={(d) => setForm({ ...form, department: d })} />
            <button type="submit" className="btn btn-primary">
              Show
            </button>
            {data && (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => setPrinting(true)}>
                  <Printer aria-hidden="true" /> Print
                </button>
                <button type="button" className="btn btn-secondary" onClick={save} disabled={!data.orders.length}>
                  <FileDown aria-hidden="true" /> Save for Excel (CSV)
                </button>
              </>
            )}
          </div>
          <p className="hint">The file holds patients' names: keep it on the hospital's computers only. Use only fake sample data until the app has been reviewed.</p>
        </form>
        <Alert type="error">{error}</Alert>
        {loading && !data && <p className="muted">Loading…</p>}
        {data && (
          <>
            <section className="card" aria-labelledby="lab-reg-counts">
              <h2 id="lab-reg-counts">
                {span}
                {data.department ? ` · ${departmentName(data.department)}` : ''}
              </h2>
              <dl className="lab-counts">
                {COUNTS.map(([k, w]) => (
                  <div key={k}>
                    <dt>{w}</dt>
                    <dd className="tabular">{data.summary[k]}</dd>
                  </div>
                ))}
              </dl>
              {Object.keys(data.byDepartment).length > 0 && (
                <p className="hint">
                  Tests by department:{' '}
                  {Object.entries(data.byDepartment)
                    .map(([k, n]) => `${departmentName(k)} ${n}`)
                    .join(' · ')}
                </p>
              )}
              {data.more && <Alert type="warning">Only the first 3,000 orders are shown – choose fewer days.</Alert>}
            </section>
            <section className="card" aria-labelledby="lab-reg-list">
              <h2 id="lab-reg-list">Orders</h2>
              {data.orders.length === 0 ? (
                <p className="muted">No lab orders on these days.</p>
              ) : (
                <ul className="wl-list">
                  {data.orders.map((o) => (
                    <li key={o.id}>
                      <div className="wl-row-head">
                        <span className="wl-who">
                          <Link to={`/lab/orders/${o.id}`} className="strong-name">
                            {o.patient.fullName}
                          </Link>
                          <span className="muted tabular">{[o.sampleNo, o.patient.mrn, formatDateTime(o.ordered.at)].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="wl-counts">
                          {o.late && (
                            <StatusPill tone={LATE_LOOK.tone} icon={LATE_LOOK.icon}>
                              {LATE_LOOK.word}
                            </StatusPill>
                          )}
                          <StatusPill tone={orderLook(o).tone} icon={orderLook(o).icon}>
                            {orderLook(o).word}
                          </StatusPill>
                        </span>
                      </div>
                      <span className="hint">
                        {o.tests.map((t) => t.name).join(', ')}
                        {o.status === 'cancelled' ? '' : ` · time taken ${turnaround(o)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
      {printing && data && (
        <PrintPreview title="Lab register – print preview" hint="Print on A4 paper. It holds patients' names: file it with the lab's records." onClose={() => setPrinting(false)}>
          {!lh.data && !lh.error ? (
            <p className="muted">Preparing…</p>
          ) : (
            <PrintDocument className="lab-register">
              {lh.data?.letterhead && <Letterhead letterhead={lh.data.letterhead} />}
              <h1 className="pdoc-title">Lab register</h1>
              <PrintFacts
                items={[
                  ['Days', span],
                  ['Department', data.department ? departmentName(data.department) : 'All departments'],
                  ...COUNTS.map(([k, w]) => [w, String(data.summary[k])]),
                ]}
              />
              <RegisterTable orders={data.orders} />
            </PrintDocument>
          )}
        </PrintPreview>
      )}
    </>
  );
}
