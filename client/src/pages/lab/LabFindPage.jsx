import { useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { LabRow, DepartmentSelect } from './LabWorklistPage.jsx';

// Lab → Find (docs/LAB_LIMS_PLAN.md feature 6): a sample number (or a label's barcode scanned into the box – the
// scanner types it and presses Enter, and the order opens), a patient number or name, between two dates, in one
// status or department. Only orders of patients this person may see. The search is recorded without what was typed.

const STATUSES = [
  ['', 'Any status'],
  ['ordered', 'Sample to take'],
  ['collected', 'Sample taken'],
  ['entered', 'Entered – to check'],
  ['reported', 'Reported – to review'],
  ['reviewed', 'Reviewed'],
  ['cancelled', 'Cancelled'],
  ['late', 'Late'],
  ['rejected', 'A sample was rejected'],
  ['outside', 'Sent to an outside lab'],
];
const SAMPLE = /^\d{6}-\d{4}(?:-\d{1,2})?$/;

export function LabFindPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ q: '', status: '', department: '', from: '', to: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const find = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const params = new URLSearchParams(Object.entries({ ...form, q: form.q.trim() }).filter(([, v]) => v));
      const res = await api(`/lab/search?${params}`);
      // A scanned label: straight to its order
      if (SAMPLE.test(form.q.trim()) && res.orders.length === 1) return navigate(`/lab/orders/${res.orders[0].id}`);
      setResult(res);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <>
      <PageHeader title="Find lab orders" documentTitle="Find lab orders" help="Type or scan a sample number, or type a patient number or name. Dates, status and department narrow the list." />
      <div className="pf-content">
        <form className="card lab-find" onSubmit={find} noValidate>
          <Alert type="error">{error}</Alert>
          <div className="form-grid">
            <Field label="Sample number, patient number or name" id="lab-find-q" error={fields.q}>
              <input id="lab-find-q" maxLength={100} value={form.q} onChange={set('q')} autoFocus autoComplete="off" />
            </Field>
            <Field label="Status" id="lab-find-status">
              <select id="lab-find-status" value={form.status} onChange={set('status')}>
                {STATUSES.map(([k, w]) => (
                  <option key={k} value={k}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ordered from" id="lab-find-from" error={fields.from}>
              <input id="lab-find-from" type="date" value={form.from} onChange={set('from')} />
            </Field>
            <Field label="Ordered to" id="lab-find-to" error={fields.to}>
              <input id="lab-find-to" type="date" value={form.to} onChange={set('to')} />
            </Field>
          </div>
          <div className="row">
            <DepartmentSelect id="lab-find-department" value={form.department} onChange={set('department')} />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Search aria-hidden="true" /> {busy ? 'Finding…' : 'Find'}
            </button>
          </div>
        </form>
        {result && (
          <section className="card" aria-labelledby="lab-find-results">
            <h2 id="lab-find-results">
              {result.orders.length === 0 ? 'No orders found' : `${result.orders.length} ${result.orders.length === 1 ? 'order' : 'orders'}${result.more ? ' (the newest 200 – narrow the search)' : ''}`}
            </h2>
            <ul className="wl-list">
              {result.orders.map((o) => (
                <LabRow key={o.id} o={o} list="find" />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
