import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field } from '../../components/ui.jsx';
import { AadhaarQrFill } from '../patients/AadhaarQrFill.jsx';
import { CARE_TYPE_LABELS, CARE_TYPES } from '../patients/patientFormat.js';

// Admitting someone not registered yet (owner, 17 Oct 2026: Aadhaar upload "at registration and admission"): her details
// from the Aadhaar card's QR (or typed), registered here, then admitted in the same dialog. The phone is typed – the
// Aadhaar QR does not hold the mobile number. Records that may be hers are shown first, as on New patient.

const EMPTY = { careType: 'antenatal', fullName: '', ageYears: '', phone: '', address: '', pinCode: '', city: '', state: '', last4: '' };
const MOTHER_TYPES = CARE_TYPES.filter((t) => t !== 'newborn');

/** onRegistered(patient) with the new (or chosen existing) record, as the admit dialog's patient. */
export function AdmitRegister({ onRegistered }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [matches, setMatches] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const fill = (a) => setV((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(a).filter(([, x]) => x)) }));

  const register = async (anyway = false) => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { last4, ...rest } = v;
      const body = { ...rest, ...(last4 ? { idProof: { kind: 'aadhaar', last4 } } : {}), ...(anyway ? { registerAnyway: true } : {}) };
      const { patient } = await api('/patients', { method: 'POST', body });
      onRegistered(patient);
    } catch (err) {
      if (err.code === 'POSSIBLE_MATCHES') setMatches(err.matches ?? []);
      else {
        setError(err.message);
        setFields(err.fields ?? {});
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-link btn-sm admit-register-open" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" /> Not registered yet? Register her here (from the Aadhaar card)
      </button>
    );
  }
  if (matches) {
    return (
      <div className="admit-register">
        <Alert type="warning">She may already be registered. Choose her record, or register a new patient.</Alert>
        <ul className="admit-matches">
          {matches.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.fullName}</strong> <span className="muted">{[m.mrn, m.age != null ? `${m.age} yrs` : null, m.phoneEnd ? `phone …${m.phoneEnd}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRegistered({ id: m.id, fullName: m.fullName, mrn: m.mrn, assignedDoctorName: m.doctorName ?? null })}>
                Use this record
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => register(true)}>
            Register as a new patient anyway
          </button>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setMatches(null)}>
            Back
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="admit-register">
      <h3>Register her</h3>
      <AadhaarQrFill onFill={fill} />
      <Alert type="error">{error}</Alert>
      <div className="form-grid">
        <Field label="Type of care" id="ar-care" error={fields.careType}>
          <select id="ar-care" value={v.careType} onChange={set('careType')}>
            {MOTHER_TYPES.map((t) => (
              <option key={t} value={t}>
                {CARE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Full name" id="ar-name" error={fields.fullName}>
          <input id="ar-name" value={v.fullName} onChange={set('fullName')} maxLength={150} />
        </Field>
        <Field label="Age (years)" id="ar-age" error={fields.ageYears}>
          <input id="ar-age" inputMode="numeric" value={v.ageYears} onChange={set('ageYears')} maxLength={3} />
        </Field>
        <Field label="Phone" id="ar-phone" error={fields.phone} hint="Not on the Aadhaar QR – please type it.">
          <input id="ar-phone" type="tel" value={v.phone} onChange={set('phone')} maxLength={30} />
        </Field>
        <Field label="Address" id="ar-address" error={fields.address}>
          <input id="ar-address" value={v.address} onChange={set('address')} maxLength={300} />
        </Field>
      </div>
      <div className="row">
        <button type="button" className="btn btn-secondary" disabled={busy || !v.fullName.trim()} onClick={() => register(false)}>
          <UserPlus aria-hidden="true" /> {busy ? 'Registering…' : 'Register and continue'}
        </button>
        <button type="button" className="btn btn-link btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="hint">The doctor or RMO adds the clinical details on her record later.</p>
    </div>
  );
}
