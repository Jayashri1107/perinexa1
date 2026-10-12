import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { DoctorSignature } from '../components/print/Letterhead.jsx';
import { Alert, Field } from '../components/ui.jsx';

// My settings → Professional details (doctors and RMOs): printed under the person's name on prescriptions.
export function ProfessionalDetailsSection() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ qualification: '', registrationNumber: '', council: '', ...(user.professional ?? {}) });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => {
    setSaved(false);
    setForm({ ...form, [key]: e.target.value });
  };

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const res = await api('/auth/me/professional', { method: 'PUT', body: form });
      setUser(res.user);
      setSaved(true);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* The form, with the print preview in a right rail (under the form on narrower screens) */}
      <div className="acc-with-rail" id="professional">
          <form className="card" onSubmit={save} noValidate>
            <h2>Professional details</h2>
            <p className="hint help">Printed under your name on prescriptions and consent forms, in every hospital you work at.</p>
            <Alert type="success">{saved && 'Saved.'}</Alert>
            <Alert type="error">{error}</Alert>
            <Field label="Qualification" id="qualification" error={fieldErrors.qualification} hint="e.g. MBBS, MS (OBGY)">
              <input id="qualification" value={form.qualification} onChange={update('qualification')} maxLength={150} />
            </Field>
            <Field label="Medical registration number" id="registrationNumber" error={fieldErrors.registrationNumber}>
              <input id="registrationNumber" value={form.registrationNumber} onChange={update('registrationNumber')} maxLength={60} />
            </Field>
            <Field label="Medical council" id="council" error={fieldErrors.council} hint="e.g. the State Medical Council or NMC">
              <input id="council" value={form.council} onChange={update('council')} maxLength={120} />
            </Field>
            <div className="acc-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
          <section className="card" aria-labelledby="print-preview-title">
            <h2 id="print-preview-title">How it prints</h2>
            <div className="acc-print-sample">
              <DoctorSignature user={{ name: user.name, professional: form }} />
            </div>
          </section>
      </div>
    </>
  );
}
