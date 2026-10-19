import { useState } from 'react';
import { ClipboardPen, FileText, Save, Siren } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { DepartmentSelect } from './LabWorklistPage.jsx';
import { FLAG_OPTIONS, departmentName, formFromOrder, testDef, testsFromForm } from './labFormat.js';

// Result entry by department (owner, 19 Oct 2026 – docs/LAB_DASHBOARD_PLAN.md, as in eLabAssist): the samples received
// in one department, each with its values in a row – type them one after another, save each sample, and report it when
// all its tests have results. The other departments' tests of a sample keep what was entered there.

/** One sample: its tests of this department as rows of values. */
function SampleCard({ order, department, catalogue, verify, onSaved }) {
  const [form, setForm] = useState(() => formFromOrder(order));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const mine = order.tests.map((t, i) => [t, i]).filter(([t]) => (t.department || 'other') === department);
  // The flag is left to the server unless someone chooses it: it applies HER usual range (age, pregnancy), which this
  // screen does not know (the range shown is the general one)
  const setValue = (i, f, value) =>
    setForm((cur) => cur.map((e, j) => (j === i ? { ...e, values: { ...e.values, [f.key]: { ...(e.values[f.key] ?? {}), value, flag: e.values[f.key]?.flagChosen ? e.values[f.key].flag : '' } } } : e)));
  const setFlag = (i, f, flag) => setForm((cur) => cur.map((e, j) => (j === i ? { ...e, values: { ...e.values, [f.key]: { ...(e.values[f.key] ?? { value: '' }), flag, flagChosen: true } } } : e)));
  const setText = (i, text) => setForm((cur) => cur.map((e, j) => (j === i ? { ...e, text } : e)));
  const filled = (i) => Object.values(form[i]?.values ?? {}).some((v) => v.value !== '') || (form[i]?.text ?? '').trim() !== '';
  const allFilled = order.tests.every((_, i) => filled(i));

  const send = async (report) => {
    const texts = form.flatMap((e) => [e.text, ...Object.values(e.values).map((v) => v.value)]);
    if (texts.some((t) => mentionsFetalSex(String(t ?? '')))) {
      setError(PCPNDT_MESSAGE);
      return;
    }
    setBusy(report ? 'report' : 'save');
    setError(null);
    setFields({});
    try {
      const res = await api(`/lab/orders/${order.id}/results`, { method: 'PUT', body: { rev: order.rev, tests: testsFromForm(order, form, catalogue), labNote: order.labNote ?? '', report, reason: '', qcReason: '' } });
      onSaved(res.order, report ? (res.order.status === 'entered' ? 'sent for checking' : 'reported') : 'saved');
    } catch (err) {
      setError(err.fields?.qcReason ? 'Quality control was rejected today for this test: open the sample to report it with a reason.' : err.message);
      setFields(err.fields ?? {});
      setBusy(null);
    }
  };

  return (
    <li className="card lab-res-card">
      <div className="lab-res-head">
        <span>
          <strong className="tabular">{order.sampleNo ?? 'No sample no.'}</strong> · {order.patient.fullName} <span className="muted tabular">{order.patient.mrn}</span>
        </span>
        <span className="lab-res-meta">
          {order.urgent && (
            <StatusPill tone="high" icon={Siren}>
              Urgent
            </StatusPill>
          )}
          <span className="muted">Received {order.received ? formatDateTime(order.received.at) : '–'}</span>
          <Link to={`/lab/orders/${order.id}`} className="btn btn-link btn-sm">
            Open
          </Link>
        </span>
      </div>
      <Alert type="error">{error}</Alert>
      <table className="bill-lines lab-res-table">
        <thead>
          <tr>
            <th scope="col">Test</th>
            <th scope="col">Value</th>
            <th scope="col">Result</th>
            <th scope="col">Unit</th>
            <th scope="col">Usual range (general)</th>
            <th scope="col">Flag</th>
          </tr>
        </thead>
        <tbody>
          {mine.flatMap(([t, i]) => {
            const def = testDef(catalogue, t.key);
            const rows = (def?.fields ?? []).map((f, n) => {
              const v = form[i]?.values[f.key] ?? { value: '', flag: '' };
              const id = `res-${order.id}-${i}-${f.key}`;
              const err = fields[`tests.${i}.${f.key}`];
              return (
                <tr key={`${i}-${f.key}`}>
                  <td data-label="Test">{n === 0 ? <strong>{t.name}</strong> : ''}</td>
                  <td data-label="Value">
                    <label htmlFor={id}>{f.name}</label>
                  </td>
                  <td data-label="Result">
                    {f.type === 'choice' ? (
                      <select id={id} value={v.value} onChange={(e) => setValue(i, f, e.target.value)}>
                        <option value="">—</option>
                        {f.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input id={id} className={f.type === 'number' ? 'tabular lab-res-input' : 'lab-res-input'} inputMode={f.type === 'number' ? 'decimal' : undefined} maxLength={f.type === 'number' ? 20 : 100} value={v.value} onChange={(e) => setValue(i, f, e.target.value)} />
                    )}
                    {err && <span className="field-error">{err}</span>}
                  </td>
                  <td data-label="Unit">{f.unit ?? ''}</td>
                  <td data-label="Usual range" className="muted">
                    {f.range ?? ''}
                  </td>
                  <td data-label="Flag">
                    {f.type !== 'text' && (
                      <select aria-label={`Flag for ${f.name}`} value={v.flag ?? ''} onChange={(e) => setFlag(i, f, e.target.value)}>
                        {FLAG_OPTIONS.map(([k, w]) => (
                          <option key={k} value={k}>
                            {k === '' ? 'Auto (her range)' : w}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              );
            });
            // A test with no set values (e.g. "Other test"): the result in words
            if (!def?.fields?.length) {
              rows.push(
                <tr key={`${i}-text`}>
                  <td data-label="Test">
                    <strong>{t.name}</strong>
                  </td>
                  <td data-label="Value">
                    <label htmlFor={`res-${order.id}-${i}-text`}>Result</label>
                  </td>
                  <td data-label="Result" colSpan={4}>
                    <input id={`res-${order.id}-${i}-text`} className="lab-res-input" maxLength={2000} value={form[i]?.text ?? ''} onChange={(e) => setText(i, e.target.value)} />
                  </td>
                </tr>,
              );
            }
            return rows;
          })}
        </tbody>
      </table>
      <div className="row">
        <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => send(false)}>
          <Save aria-hidden="true" /> {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy) || !allFilled} onClick={() => send(true)} title={allFilled ? undefined : 'Every test of this sample needs a result first (other departments too).'}>
          <FileText aria-hidden="true" /> {busy === 'report' ? 'Saving…' : verify ? 'Send for checking' : 'Report'}
        </button>
        {!allFilled && mine.length < order.tests.length && <span className="hint">Other departments' tests of this sample still need results before it is reported.</span>}
      </div>
    </li>
  );
}

export function LabResultsPage() {
  const [params, setParams] = useSearchParams();
  const department = params.get('department') || 'haematology';
  const list = useFetch('/lab/worklist', { list: 'report', department });
  const catalogue = useFetch('/lab/tests');
  const [notice, setNotice] = useState(null);
  const [gone, setGone] = useState([]); // samples reported here (they leave the list)
  const orders = (list.data?.orders ?? []).filter((o) => !gone.includes(o.id));
  const saved = (order, what) => {
    setNotice(`${order.sampleNo ?? 'Sample'}: ${what}.`);
    if (what !== 'saved') setGone((g) => [...g, order.id]);
    else list.reload();
  };

  return (
    <>
      <PageHeader
        tabs={HOSPITAL_LAB.tabs}
        title="Result entry by department"
        documentTitle="Lab result entry"
        help="The samples received in one department. Type the values row by row, save each sample, and report it once all its tests have results."
      />
      <div className="pf-content lab-res">
        <div className="lab-toolbar">
          <DepartmentSelect
            value={department}
            onChange={(d) => {
              setGone([]);
              setParams(d ? { department: d } : {}, { replace: true });
            }}
          />
          <span className="muted">
            <ClipboardPen aria-hidden="true" /> {orders.length} sample{orders.length === 1 ? '' : 's'} in {departmentName(department)}
          </span>
        </div>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <Alert type="error">{list.error || catalogue.error}</Alert>
        {!list.data || !catalogue.data ? (
          <p className="muted">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="muted">No results waiting in {departmentName(department)}. Samples appear here once they are received in the lab.</p>
        ) : (
          <ul className="lab-res-list">
            {orders.map((o) => (
              <SampleCard key={`${o.id}-${o.rev}`} order={o} department={department} catalogue={catalogue.data} verify={list.data.verify} onSaved={saved} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
