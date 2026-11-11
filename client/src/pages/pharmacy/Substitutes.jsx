import { useState } from 'react';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { expiryLabel, medicineLabel } from './pharmacyFormat.js';
import { Modal } from './pharmacyUi.jsx';

// PH10 (docs/PHARMACY_BUILD_NOTE.md, owner's decision 3): another brand of the same medicine for a prescription line –
// only with a doctor's yes (the pharmacist asks and writes which doctor agreed), never for a medicine on the doctors'
// "never substitute" list. The candidates are the strict matcher's: same generic name, strength and form, in stock;
// alphabetical, then earliest expiry; no prices or margins shown.

/** onPick(medicine, { agreedById?, agreedByName }) */
export function OtherBrandsDialog({ line, onClose, onPick }) {
  const res = useFetch(`/pharmacy/medicines/${line.medicine.id}/substitutes`);
  const doctors = useFetch('/pharmacy/doctors');
  const [chosen, setChosen] = useState(null);
  const [doctorId, setDoctorId] = useState('');
  const [outside, setOutside] = useState('');
  const ready = chosen && (doctorId || outside.trim().length >= 3);
  return (
    <Modal id="ph-subs" title={`Other brands of ${line.medicine.name}`} onClose={onClose}>
      <Alert type="error">{res.error}</Alert>
      {res.data?.blocked && <Alert type="warning">The doctors do not allow another brand for this medicine. Give the brand prescribed, or ask the doctor to change the prescription.</Alert>}
      {res.data && !res.data.blocked && !res.data.substitutes.length && (
        <p className="muted">No other brand of the same medicine (generic name, strength and form) is in stock. A medicine without a generic name on the stock list is never offered.</p>
      )}
      {res.data?.substitutes?.length > 0 && (
        <>
          <p>Another brand needs the doctor’s yes: ask, then write which doctor agreed.</p>
          <fieldset className="fieldset">
            <legend>Brand to give</legend>
            {res.data.substitutes.map((m) => (
              <label key={m.id} className="check">
                <input type="radio" name="ph-sub" checked={chosen?.id === m.id} onChange={() => setChosen(m)} /> {medicineLabel(m)} <span className="muted">· {m.inStock} in stock · first expiry {expiryLabel(m.nearestExpiry)}</span>
              </label>
            ))}
          </fieldset>
          <div className="form-grid">
            <Field label="Which doctor agreed" id="ph-sub-doc">
              <select id="ph-sub-doc" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">A doctor of this hospital…</option>
                {(doctors.data?.doctors ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            {!doctorId && (
              <Field label="Or an outside doctor’s name" id="ph-sub-outside" hint="For an outside prescription.">
                <input id="ph-sub-outside" maxLength={150} value={outside} onChange={(e) => setOutside(e.target.value)} />
              </Field>
            )}
          </div>
        </>
      )}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready}
          onClick={() => onPick(chosen, doctorId ? { agreedById: doctorId, agreedByName: doctors.data.doctors.find((d) => d.id === doctorId)?.name ?? '' } : { agreedByName: outside.trim() })}
        >
          Give this brand
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
