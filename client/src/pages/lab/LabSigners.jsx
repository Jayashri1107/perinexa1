import { useState } from 'react';
import { CircleCheck, PenLine, Plus } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, StatusPill, useDialogFocus } from '../../components/ui.jsx';

// Lab → Settings → Who signs the report (docs/LAB_TEMPLATES_PLAN.md part 4): the pathologist or lab in charge, with
// qualification, registration number and a picture of the signature. The picture prints only on a report that person
// checked (or reported); on other reports the default signer's name prints with a line to sign by hand. A doctor
// changes the list; a signer no longer signing is made inactive (never deleted).

const MAX_BYTES = 150 * 1024;
const empty = { name: '', title: '', qualification: '', regNo: '', userId: '', signature: '', isDefault: false, active: true };

const readDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The picture could not be read.'));
    r.readAsDataURL(file);
  });

function SignerDialog({ signer, staff, onSaved, onCancel }) {
  const [form, setForm] = useState(() => ({ ...empty, ...(signer ?? {}), userId: signer?.userId ?? '' }));
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > MAX_BYTES) {
      setFields({ signature: 'Choose a PNG or JPEG picture of the signature, at most 150 KB.' });
      return;
    }
    setFields({});
    set('signature', await readDataUrl(file));
  };
  const save = async (e) => {
    e.preventDefault();
    if (form.name.trim().length < 2) return setFields({ name: 'Write the name.' });
    setSaving(true);
    setError(null);
    try {
      const body = { name: form.name.trim(), title: form.title.trim(), qualification: form.qualification.trim(), regNo: form.regNo.trim(), userId: form.userId || null, signature: form.signature, isDefault: form.isDefault, active: form.active };
      const res = signer ? await api(`/lab-setup/signatories/${signer.id}`, { method: 'PUT', body }) : await api('/lab-setup/signatories', { method: 'POST', body });
      onSaved(res);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
    return undefined;
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="signer-title" onSubmit={save} noValidate>
        <h2 id="signer-title">{signer ? 'Change the signer' : 'Add a signer'}</h2>
        <Alert type="error">{error}</Alert>
        <div className="form-grid">
          <Field label="Name" id="sg-name" error={fields.name}>
            <input id="sg-name" maxLength={100} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>
          <Field label="Qualification" id="sg-qual" error={fields.qualification} hint="For example: MD (Pathology)">
            <input id="sg-qual" maxLength={100} value={form.qualification} onChange={(e) => set('qualification', e.target.value)} />
          </Field>
          <Field label="Title (optional)" id="sg-title" error={fields.title} hint="For example: Consultant pathologist">
            <input id="sg-title" maxLength={80} value={form.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Registration number" id="sg-reg" error={fields.regNo}>
            <input id="sg-reg" maxLength={60} value={form.regNo} onChange={(e) => set('regNo', e.target.value)} />
          </Field>
          <Field label="Staff member (whose checked reports carry the signature)" id="sg-user" error={fields.userId}>
            <select id="sg-user" value={form.userId} onChange={(e) => set('userId', e.target.value)}>
              <option value="">None</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Signature picture (PNG or JPEG, at most 150 KB)" id="sg-sig" error={fields.signature}>
          <input id="sg-sig" type="file" accept="image/png,image/jpeg" onChange={pick} />
        </Field>
        {form.signature && (
          <div className="row">
            <img className="lab-signer-preview" src={form.signature} alt="The signature" />
            <button type="button" className="btn btn-link btn-sm" onClick={() => set('signature', '')}>
              Remove the picture
            </button>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={form.isDefault} onChange={(e) => set('isDefault', e.target.checked)} /> Default signer (named on reports checked by someone else, to sign by hand)
        </label>
        <label className="check">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Signs reports
        </label>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function LabSigners({ data, onChanged }) {
  const [editing, setEditing] = useState(null); // a signer, or 'new'
  const staffName = (id) => data.staff.find((s) => s.id === id)?.name ?? null;
  return (
    <section className="card" aria-labelledby="signers-title">
      <div className="plan-card-head">
        <h2 id="signers-title">Who signs the report</h2>
        {data.canEdit && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" /> Add a signer
          </button>
        )}
      </div>
      <p className="hint">The signature picture prints only on a report its signer checked (or reported). On other reports the default signer is named, with a line to sign by hand.</p>
      {data.signatories.length === 0 ? (
        <p className="muted">No signer yet: reports print an empty line to sign by hand.</p>
      ) : (
        <ul className="wl-list">
          {data.signatories.map((s) => (
            <li key={s.id}>
              <div className="wl-row-head">
                <span className="wl-who">
                  <strong>{s.name}</strong>
                  <span className="muted">{[s.qualification, s.title, s.regNo ? `Reg. No. ${s.regNo}` : null, staffName(s.userId) ? `checks as ${staffName(s.userId)}` : null].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="wl-counts">
                  {s.isDefault && (
                    <StatusPill tone="stable" icon={CircleCheck}>
                      Default
                    </StatusPill>
                  )}
                  {!s.active && (
                    <StatusPill tone="inactive" icon={PenLine}>
                      Not signing
                    </StatusPill>
                  )}
                  {s.signature ? <img className="lab-signer-preview" src={s.signature} alt={`Signature of ${s.name}`} /> : <span className="muted">No picture</span>}
                  {data.canEdit && (
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setEditing(s)}>
                      Change
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <SignerDialog
          signer={editing === 'new' ? null : editing}
          staff={data.staff}
          onCancel={() => setEditing(null)}
          onSaved={(res) => {
            setEditing(null);
            onChanged(res);
          }}
        />
      )}
    </section>
  );
}
