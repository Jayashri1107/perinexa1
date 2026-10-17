import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { Alert, Field, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// Lab → Referrers (Lab version 2 – docs/LAB_V2_PLAN.md): the doctors and centres who refer walk-in patients, chosen on a
// walk-in order and printed on its report. No money is recorded for a referrer – commissions are not allowed.

const EMPTY = { kind: 'doctor', name: '', qualification: '', registrationNumber: '', phone: '', address: '', active: true };

export function LabReferrersPage() {
  const { data, error, reload } = useFetch('/lab-setup/referrers');
  const [form, setForm] = useState(null); // { id?, ...fields }
  const [fields, setFields] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setSaveError(null);
    setFields({});
    try {
      const { id, ...body } = form;
      await api(id ? `/lab-setup/referrers/${id}` : '/lab-setup/referrers', { method: id ? 'PUT' : 'POST', body });
      setForm(null);
      reload();
    } catch (err) {
      setSaveError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader tabs={HOSPITAL_LAB.tabs} title="Referrers" documentTitle="Lab referrers" help="Doctors and centres who send patients to the lab. Chosen on a walk-in order and printed on its report. No commissions are recorded." />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        {data?.canEdit && !form && (
          <button type="button" className="btn btn-primary" onClick={() => setForm(EMPTY)}>
            <Plus aria-hidden="true" /> Add a referrer
          </button>
        )}
        {form && (
          <form className="card" onSubmit={save} noValidate>
            <h2>{form.id ? 'Change the referrer' : 'Add a referrer'}</h2>
            <Alert type="error">{saveError}</Alert>
            <div className="form-grid">
              <Field label="Doctor or centre" id="rf-kind">
                <select id="rf-kind" value={form.kind} onChange={set('kind')}>
                  <option value="doctor">Doctor</option>
                  <option value="centre">Centre (clinic, hospital, collection centre)</option>
                </select>
              </Field>
              <Field label="Name" id="rf-name" error={fields.name}>
                <input id="rf-name" maxLength={120} value={form.name} onChange={set('name')} />
              </Field>
              <Field label="Qualification" id="rf-q">
                <input id="rf-q" maxLength={80} value={form.qualification} onChange={set('qualification')} />
              </Field>
              <Field label="Registration number" id="rf-reg">
                <input id="rf-reg" maxLength={40} value={form.registrationNumber} onChange={set('registrationNumber')} />
              </Field>
              <Field label="Phone" id="rf-ph" error={fields.phone}>
                <input id="rf-ph" maxLength={20} value={form.phone} onChange={set('phone')} />
              </Field>
              <Field label="Address" id="rf-addr">
                <input id="rf-addr" maxLength={200} value={form.address} onChange={set('address')} />
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.active} onChange={set('active')} /> In use
            </label>
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn btn-link" onClick={() => setForm(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        <section className="card">
          {!data ? (
            <p className="muted">Loading…</p>
          ) : data.referrers.length === 0 ? (
            <p className="muted">No referrers yet.</p>
          ) : (
            <ul className="wl-list">
              {data.referrers.map((r) => (
                <li key={r.id}>
                  <div className="wl-row-head">
                    <span className="wl-who">
                      <strong>{r.name}</strong>
                      <span className="muted">{[r.kind === 'centre' ? 'Centre' : 'Doctor', r.qualification, r.registrationNumber && `Reg. ${r.registrationNumber}`, r.phone, r.address].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="wl-counts">
                      {!r.active && <StatusPill tone="inactive">Not in use</StatusPill>}
                      {data.canEdit && (
                        <button type="button" className="btn btn-link btn-sm" onClick={() => setForm({ ...r })}>
                          Change
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
