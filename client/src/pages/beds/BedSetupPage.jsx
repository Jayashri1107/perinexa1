import { useState } from 'react';
import { Check, CircleSlash, Plus, User } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_ADMIN } from '../../platform/modules.js';
import { bedNames } from './bedFormat.js';

// Hospital admin → Beds (owner, 13 Oct 2026): the wards and their beds, for the bed board. The admin sees only whether a
// bed is free or occupied – never who is in it. A bed is never deleted: it is taken out of use (only when empty).
// The bed charge comes from the price list: a bed price for a ward with the same name, else the general bed price.
/** The hospital's admission rules (docs/ADMISSION_DESK_PLAN.md): a doctor's request first; the checklist complete. */
function AdmissionRules() {
  const res = useFetch('/admission-desk/rules');
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  if (!res.data) return null;
  const rules = saved ?? res.data;
  const change = async (k, v) => {
    setError(null);
    try {
      setSaved(await api('/admission-desk/rules', { method: 'PUT', body: { requireAdmissionRequest: rules.requireAdmissionRequest, requireChecklist: rules.requireChecklist, [k]: v } }));
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <section className="card" aria-labelledby="adm-rules">
      <h2 id="adm-rules">Admission rules</h2>
      <Alert type="error">{error}</Alert>
      <label className="check">
        <input type="checkbox" checked={rules.requireAdmissionRequest} disabled={!rules.canChange} onChange={(e) => change('requireAdmissionRequest', e.target.checked)} /> Reception admits only
        after a doctor's admission request (an emergency still can, and is marked so)
      </label>
      <label className="check">
        <input type="checkbox" checked={rules.requireChecklist} disabled={!rules.canChange} onChange={(e) => change('requireChecklist', e.target.checked)} /> A planned or day-care
        admission needs the admission checklist complete (ID proof seen, attendant, who pays, consent signed)
      </label>
      <p className="hint">Without these rules the bed board still shows "Checklist incomplete" until the desk completes it.</p>
    </section>
  );
}

export function BedSetupPage() {
  const setup = useFetch('/beds/setup');
  const [form, setForm] = useState({ ward: '', names: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [notice, setNotice] = useState(null);
  const names = bedNames(form.names);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { beds } = await api('/beds/setup', { method: 'POST', body: { ward: form.ward.trim(), names } });
      setNotice(`${beds.length} bed${beds.length === 1 ? '' : 's'} added to ${beds[0]?.ward ?? form.ward}.`);
      setForm({ ward: form.ward, names: '' });
      setup.reload();
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (bed) => {
    setError(null);
    try {
      await api(`/beds/setup/${bed.id}`, { method: 'PATCH', body: { active: !bed.active } });
      setup.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Hospital admin', to: '/admin/staff' }, { label: 'Beds' }]} title="Beds" tabs={HOSPITAL_ADMIN.tabs} />
      <div className="pf-content beds-page">
        <Alert type="error">{error || setup.error}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <AdmissionRules />
        <form className="card beds-add" onSubmit={add} noValidate>
          <h2>Add beds</h2>
          <div className="form-grid">
            <Field label="Ward" id="bed-ward" error={fields.ward} hint="e.g. General ward, Private, Labour ward">
              <input id="bed-ward" value={form.ward} onChange={(e) => setForm({ ...form, ward: e.target.value })} maxLength={60} list="bed-wards" />
              <datalist id="bed-wards">
                {(setup.data?.wards ?? []).map((w) => (
                  <option key={w.ward} value={w.ward} />
                ))}
              </datalist>
            </Field>
            <Field label="Beds" id="bed-names" error={fields.names} hint={names.length ? `${names.length} bed${names.length === 1 ? '' : 's'}: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ' …' : ''}` : 'A range like G1-G10, or names with commas: P1, P2, P3'} keepHint={names.length > 0}>
              <input id="bed-names" value={form.names} onChange={(e) => setForm({ ...form, names: e.target.value })} />
            </Field>
          </div>
          <p className="hint">The bed charge is the bed price in Billing → Price list for a ward with the same name, or the general bed price.</p>
          <div className="acc-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !form.ward.trim() || names.length === 0}>
              <Plus aria-hidden="true" /> {busy ? 'Adding…' : 'Add beds'}
            </button>
          </div>
        </form>

        {setup.data?.wards.map((w) => (
          <section key={w.ward} className="card beds-ward" aria-labelledby={`setup-${w.ward}`}>
            <header className="beds-ward-head">
              <h2 id={`setup-${w.ward}`}>{w.ward}</h2>
              <span className="muted tabular">{w.beds.filter((b) => b.active).length} beds in use</span>
            </header>
            <ul className="beds-grid">
              {w.beds.map((b) => (
                <li key={b.id} className={`bed ${b.occupied ? 'is-occupied' : b.active ? 'is-free' : 'is-off'}`}>
                  <div className="bed-head">
                    <strong className="bed-name">{b.name}</strong>
                    {b.occupied ? (
                      <StatusPill tone="admitted" icon={User}>
                        Occupied
                      </StatusPill>
                    ) : b.active ? (
                      <StatusPill tone="stable" icon={Check}>
                        Free
                      </StatusPill>
                    ) : (
                      <StatusPill tone="inactive" icon={CircleSlash}>
                        Not in use
                      </StatusPill>
                    )}
                  </div>
                  {!b.occupied && (
                    <button type="button" className="btn btn-link btn-sm bed-action" onClick={() => toggle(b)}>
                      {b.active ? 'Take out of use' : 'Put back in use'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
