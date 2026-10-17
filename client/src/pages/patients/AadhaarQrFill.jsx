import { useEffect, useRef, useState } from 'react';
import { Camera, QrCode, ScanLine, Upload } from 'lucide-react';
import { Alert } from '../../components/ui.jsx';
import { parseAadhaarQr, prepareQrReaders, readQrFrom, readQrFromImage } from './aadhaarQr.js';

// "Fill from Aadhaar card" on the patient's details (owner, 16 Oct 2026): reception, doctor or RMO reads the QR code on
// the patient's own Aadhaar card (the paper letter or the plastic card – owner, 17 Oct 2026: "people have the normal
// Aadhaar, not e-Aadhaar"), with her agreement, in one of three ways:
//  - a camera, live: it starts by itself once the agreement is ticked; the card is held up to the webcam (or her
//    phone's camera) and the QR is read from the moving picture in this browser the moment it is clear – no photo is
//    taken or kept, and the camera turns itself off (owner, 17 Oct 2026: "capture it automatically, no stop button");
//  - a USB QR scanner (staff only): the scanner types what the QR holds into a box, as a keyboard would;
//  - a photo or scan of the card, uploaded (the way back when there is no camera or scanner).
// The name, age, address and last 4 digits go into the form for staff to check (aadhaarQr.js). Nothing is sent
// anywhere and nothing of the card is kept.

export const AADHAAR_FIELD_LABELS = { fullName: 'name', ageYears: 'age', address: 'address', pinCode: 'PIN code', city: 'city', state: 'state', last4: 'last 4 digits' };

// Staff wording (English); the patient's sign-up passes its own (portalAccountWords.js aadhaar), in her language
export const AADHAAR_WORDS = {
  open: 'Fill from Aadhaar card',
  intro:
    'Read the QR code on the patient’s Aadhaar card – the paper letter or the plastic card. It is read on this computer: nothing is saved or sent anywhere, and only the name, age, address and the last 4 digits are used.',
  agree: 'The patient agrees to her Aadhaar card being read for these details',
  camera: 'Scan with camera',
  scanAgain: 'Scan again',
  looking: 'Looking for the QR code…',
  noCamera: 'No camera was found on this computer. Use a QR scanner or upload a photo of the card.',
  cameraHint: 'Hold the QR code of the card inside the box, about a hand’s width from the camera. Keep it still, in good light – it is read by itself.',
  cameraBlocked: 'The camera could not be opened. Allow the camera for this site in the browser, or use a QR scanner or a photo.',
  scanner: 'Or scan with a QR scanner',
  scannerHint: 'Click here, then scan the QR code on the card',
  upload: 'Upload a photo of the card',
  reading: 'Reading the QR code…',
  close: 'Close',
  filled: (list) => `Filled from the Aadhaar QR: ${list}. Please check them against the card – the card's digital signature is not checked.`,
  noQr: 'No QR code found in this picture. Please upload a clearer photo of the side with the QR code, or type the details.',
  notAadhaar: 'This QR code is not an Aadhaar QR code. Please type the details.',
  notImage: 'This file could not be opened as a picture. Please upload a photo (JPG or PNG) or a screenshot.',
};

/** Reads QR codes from the camera, live, until one is found (onText). Nothing is recorded. */
function CameraScan({ words, onText, onBlocked }) {
  const video = useRef(null);
  useEffect(() => {
    let stream = null;
    let timer = null;
    let stopped = false;
    const canvas = document.createElement('canvas');
    (async () => {
      try {
        // The back camera on a phone; the sharpest picture the camera gives (4K, Full HD, …) – the Secure QR on the card
        // is dense, and each of its squares needs about 3 camera dots to be read
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
        // Focus that follows the card, where the camera can (most phones, some webcams)
        const [track] = stream.getVideoTracks();
        if (track?.getCapabilities?.().focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        let frame = 0;
        const look = async () => {
          if (stopped) return;
          const v = video.current;
          if (v && v.readyState >= 2 && v.videoWidth) {
            const text = await readQrFrom(v, v.videoWidth, v.videoHeight, { quick: true, frame: frame++, canvas });
            if (text && !stopped) {
              onText(text);
              return;
            }
          }
          if (!stopped) timer = setTimeout(look, 60);
        };
        look();
      } catch (err) {
        if (!stopped) onBlocked(err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError' ? 'none' : 'blocked');
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop()); // the camera light goes off
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="aadhaar-camera">
      <div className="aadhaar-camera-view">
        <video ref={video} muted playsInline aria-label={words.camera} />
        <span className="aadhaar-camera-box" aria-hidden="true" />
      </div>
      <p className="hint" role="status">
        <Camera aria-hidden="true" /> {words.looking} {words.cameraHint}
      </p>
    </div>
  );
}

/**
 * onFill({ fullName, ageYears, address, pinCode, city, state, last4 }) with what the card holds ('' when missing).
 * scanner: offer the USB QR scanner box (staff desks; not on the patient's own sign-up).
 */
export function AadhaarQrFill({ onFill, disabled = false, words = AADHAAR_WORDS, scanner = true }) {
  const t = { ...AADHAAR_WORDS, ...words };
  const problem = { NO_QR: t.noQr, NOT_AADHAAR: t.notAadhaar, NOT_IMAGE: t.notImage };
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [scanned, setScanned] = useState('');
  const [result, setResult] = useState(null); // { ok: [labels] } or { problem }
  const input = useRef(null);
  const labels = t.fields ?? AADHAAR_FIELD_LABELS;

  // What a QR holds (from the camera, the scanner or a photo) → the form
  const use = async (getText) => {
    setBusy(true);
    setResult(null);
    try {
      const values = await parseAadhaarQr(await getText());
      onFill(values);
      setResult({ ok: Object.keys(labels).filter((k) => values[k]).map((k) => labels[k]) });
    } catch (err) {
      setResult({ problem: problem[err.message] ?? problem.NO_QR });
    } finally {
      setBusy(false);
    }
  };
  const fromFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the picture is not kept, even in the file box
    if (file) use(() => readQrFromImage(file));
  };
  const fromCamera = (text) => {
    setCamera(false); // off by itself once read
    use(() => text);
  };
  const cameraProblem = (why) => {
    setCamera(false);
    setResult({ problem: why === 'none' ? t.noCamera : t.cameraBlocked });
  };
  const fromScanner = (text) => {
    setScanned(''); // not kept in the box
    if (text.trim()) use(() => text);
  };
  const close = () => {
    setCamera(false);
    setOpen(false);
    setResult(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm aadhaar-open"
        onClick={() => {
          prepareQrReaders(); // ready by the time the card is shown
          setOpen(true);
        }}
        disabled={disabled}
      >
        <QrCode aria-hidden="true" /> {t.open}
      </button>
    );
  }
  const can = agreed && !busy && !disabled;
  return (
    <div className="aadhaar-fill">
      <p className="hint">{t.intro}</p>
      <label className="check">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => {
            setAgreed(e.target.checked);
            setCamera(e.target.checked); // the camera starts by itself once she agrees
            if (e.target.checked) setResult(null);
          }}
        />{' '}
        {t.agree}
      </label>
      <div className="row">
        {!camera && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!can}
            onClick={() => {
              setResult(null);
              setCamera(true);
            }}
          >
            <Camera aria-hidden="true" /> {result ? t.scanAgain : t.camera}
          </button>
        )}
        <input ref={input} type="file" accept="image/*" className="sr-only" onChange={fromFile} aria-label={t.upload} tabIndex={-1} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={!can} onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" /> {busy ? t.reading : t.upload}
        </button>
        <button type="button" className="btn btn-link btn-sm" onClick={close}>
          {t.close}
        </button>
      </div>
      {camera && agreed && !disabled && (
        <CameraScan words={t} onText={fromCamera} onBlocked={cameraProblem} />
      )}
      {scanner && (
        <label className="aadhaar-scanner">
          <span>
            <ScanLine aria-hidden="true" /> {t.scanner}
          </span>
          <input
            type="text"
            value={scanned}
            disabled={!can}
            autoComplete="off"
            spellCheck={false}
            placeholder={t.scannerHint}
            onChange={(e) => setScanned(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault(); // the scanner ends with Enter: read it, never submit the form
                fromScanner(scanned);
              }
            }}
          />
        </label>
      )}
      {result?.ok && <Alert type="success">{t.filled(result.ok.join(', '))}</Alert>}
      {result?.problem && <Alert type="warning">{result.problem}</Alert>}
    </div>
  );
}
