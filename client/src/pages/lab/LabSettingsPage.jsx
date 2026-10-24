import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { Alert, formatDateTime, rolesLabel } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useFetch } from '../../hooks/useFetch.js';
import { LabSigners } from './LabSigners.jsx';

// Lab → Settings (docs/LAB_LIMS_PLAN.md feature 5): whether results are checked by a second person before they go to
// the doctor, and who may check them; who signs the printed report (report templates). Doctors change it; the lab,
// RMOs and nurses read it.

export function LabSettingsPage() {
  const { data: loaded, error } = useFetch('/lab-setup/settings');
  const [changed, setChanged] = useState(null); // the settings as the latest signer change answered
  const data = changed ?? loaded;
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setForm({ verify: data.verify, verifierIds: data.verifierIds });
  }, [data]);
  const toggle = (id) => setForm((f) => ({ ...f, verifierIds: f.verifierIds.includes(id) ? f.verifierIds.filter((x) => x !== id) : [...f.verifierIds, id] }));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api('/lab-setup/settings', { method: 'PUT', body: form });
      setForm({ verify: res.verify, verifierIds: res.verifierIds });
      setNotice(res.verify ? 'Saved. Results now go to the doctor only after a second person has checked them.' : 'Saved. Results go to the doctor as soon as they are reported.');
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const locked = !data?.canEdit;

  return (
    <>
      <PageHeader tabs={HOSPITAL_LAB.tabs} title="Lab settings" documentTitle="Lab settings" help="Whether a second person checks lab results before they go to the doctor. A doctor changes this." />
      <div className="pf-content lab-settings-page">
        <Alert type="error">{error || saveError}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        {!form ? (
          <p className="muted">Loading…</p>
        ) : (
          <form className="card" onSubmit={save} noValidate>
            <h2>Check before the report</h2>
            <label className="check">
              <input type="checkbox" checked={form.verify} disabled={locked} onChange={(e) => setForm({ ...form, verify: e.target.checked })} /> A second person checks the results
              before they go to the doctor
            </label>
            <p className="hint">
              When on, Report results by the person who typed them only marks them Entered – to check. Someone else approves them (they then go to the doctor) or sends them back.
              Red flags from lab results start once they are approved.
            </p>
            {form.verify && (
              <fieldset className="fieldset">
                <legend>Who may check</legend>
                <p className="hint">Tick none and any lab staff, doctor or RMO may check – never the person who entered the results.</p>
                <div className="check-grid">
                  {data.staff.map((s) => (
                    <label key={s.id} className="check">
                      <input type="checkbox" checked={form.verifierIds.includes(s.id)} disabled={locked} onChange={() => toggle(s.id)} /> {s.name}{' '}
                      <span className="muted">({rolesLabel(s.roles)})</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {!locked && (
              <div className="row">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
            {data.updatedByName && (
              <p className="hint">
                Last changed by {data.updatedByName}
                {data.updatedAt ? `, ${formatDateTime(data.updatedAt)}` : ''}.
              </p>
            )}
          </form>
        )}
        {data && (
          <LabSigners
            data={data}
            onChanged={(res) => {
              setChanged(res);
              setNotice('Saved who signs the report.');
            }}
          />
        )}
      </div>
    </>
  );
}
