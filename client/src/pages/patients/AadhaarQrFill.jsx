import { useRef, useState } from 'react';
import { QrCode } from 'lucide-react';
import { Alert } from '../../components/ui.jsx';
import { parseAadhaarQr, readQrFromImage } from './aadhaarQr.js';

// "Fill from Aadhaar card" on the patient's details (owner, 16 Oct 2026): reception, doctor or RMO uploads a photo or
// scan of the card, with the patient's agreement; the QR is read in this browser (aadhaarQr.js) and the name, age,
// address and last 4 digits are put in the form for staff to check. The image is not kept or sent anywhere.

export const AADHAAR_FIELD_LABELS = { fullName: 'name', ageYears: 'age', address: 'address', pinCode: 'PIN code', city: 'city', state: 'state', last4: 'last 4 digits' };

const PROBLEMS = {
  NO_QR: 'No QR code found in this picture. Please upload a clearer photo of the side with the QR code, or type the details.',
  NOT_AADHAAR: 'This QR code is not an Aadhaar QR code. Please type the details.',
  NOT_IMAGE: 'This file could not be opened as a picture. Please upload a photo (JPG or PNG) or a screenshot.',
};

/** onFill({ fullName, ageYears, address, pinCode, city, state, last4 }) with what the card holds ('' when missing). */
export function AadhaarQrFill({ onFill, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok: [labels] } or { problem }
  const input = useRef(null);

  const read = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the picture is not kept, even in the file box
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const values = await parseAadhaarQr(await readQrFromImage(file));
      onFill(values);
      setResult({ ok: Object.keys(AADHAAR_FIELD_LABELS).filter((k) => values[k]).map((k) => AADHAAR_FIELD_LABELS[k]) });
    } catch (err) {
      setResult({ problem: PROBLEMS[err.message] ?? PROBLEMS.NO_QR });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-sm aadhaar-open" onClick={() => setOpen(true)} disabled={disabled}>
        <QrCode aria-hidden="true" /> Fill from Aadhaar card
      </button>
    );
  }
  return (
    <div className="aadhaar-fill">
      <p className="hint">
        Upload a photo or scan of the side of the Aadhaar card with the QR code. The QR is read on this computer: the picture is not saved or sent anywhere,
        and only the name, age, address and the last 4 digits are used.
      </p>
      <label className="check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> The patient agrees to her Aadhaar card being read for these details
      </label>
      <div className="row">
        <input ref={input} type="file" accept="image/*" className="sr-only" onChange={read} aria-label="Photo of the Aadhaar card" tabIndex={-1} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={!agreed || busy || disabled} onClick={() => input.current?.click()}>
          <QrCode aria-hidden="true" /> {busy ? 'Reading the QR code…' : 'Upload photo of the card'}
        </button>
        <button type="button" className="btn btn-link btn-sm" onClick={() => { setOpen(false); setResult(null); }}>
          Close
        </button>
      </div>
      {result?.ok && (
        <Alert type="success">
          Filled from the Aadhaar QR: {result.ok.join(', ')}. Please check them against the card – the card&apos;s digital signature is not checked.
        </Alert>
      )}
      {result?.problem && <Alert type="warning">{result.problem}</Alert>}
    </div>
  );
}
