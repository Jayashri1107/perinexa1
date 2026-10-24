import { useEffect, useRef, useState } from 'react';
import { Aperture, Camera, FlipHorizontal2, ScanLine, SwitchCamera, Upload } from 'lucide-react';
import { Alert } from '../../components/ui.jsx';
import { parseAadhaarQr, prepareQrReaders, readQrFrom, readQrFromImage } from './aadhaarQr.js';

// "Fill from Aadhaar card" on the patient's details (owner, 16 Oct 2026): reception, doctor or RMO reads the QR code on
// the patient's own Aadhaar card (the paper letter or the plastic card – owner, 17 Oct 2026: "people have the normal
// Aadhaar, not e-Aadhaar"), with her agreement (said on the button: one click opens the camera), in one of three ways:
//  - a camera, live: it opens with the click; the card is held up to the webcam (or her
//    phone's camera) and the QR is read from the moving picture in this browser the moment it is clear – no photo is
//    taken or kept, and the camera turns itself off (owner, 17 Oct 2026: "capture it automatically, no stop button");
//  - a USB QR scanner (staff only): the scanner types what the QR holds into a box, as a keyboard would;
//  - a photo or scan of the card, uploaded (the way back when there is no camera or scanner).
// The name, age, address and last 4 digits go into the form for staff to check (aadhaarQr.js). Nothing is sent
// anywhere and nothing of the card is kept.

export const AADHAAR_FIELD_LABELS = { fullName: 'name', ageYears: 'age', address: 'address', pinCode: 'PIN code', city: 'city', state: 'state', last4: 'last 4 digits' };

// Staff wording (English); the patient's sign-up passes its own (portalAccountWords.js aadhaar), in her language
export const AADHAAR_WORDS = {
  open: 'Scan Aadhaar card',
  openHint: 'With the patient’s agreement. The QR code on her card (paper letter or plastic card) is read on this computer – nothing is saved or sent.',
  camera: 'Scan with camera',
  scanAgain: 'Scan again',
  capture: 'Capture',
  whichCamera: 'Camera',
  switchCamera: 'Switch camera',
  oneCamera: 'This device has only one camera. Plug in a USB webcam, then press Switch camera.',
  mirror: 'Mirror picture',
  defaultCamera: 'This computer’s usual camera',
  cameraSize: (size) => `Camera picture: ${size}`,
  captureMissed: 'The QR code could not be read from this picture. Hold the card still, a little closer or further, with no shine on it, and press Capture again.',
  slowTips:
    'Not read yet? Hold the card flat and still with the QR code filling most of the box. If the picture is blurry, move the card a little further away until it is sharp, then press Capture. A laptop camera may not be sharp enough: a USB QR scanner, a phone or a close photo works then.',
  looking: 'Looking for the QR code…',
  noCamera: 'No camera was found on this computer. Use a QR scanner or upload a photo of the card.',
  cameraHint: 'Hold the QR code of the card inside the box, about a hand’s width from the camera. Keep it still, in good light – it is read by itself.',
  cameraBlocked: 'The camera could not be opened. Allow the camera for this site in the browser, or use a QR scanner or a photo.',
  scanner: 'Or with a USB QR scanner',
  scannerHint: 'Click here, then scan the QR code on the card',
  upload: 'Upload a photo instead',
  reading: 'Reading the QR code…',
  close: 'Close',
  filled: (list) => `Filled from the Aadhaar QR: ${list}. Please check them against the card.`,
  // The Secure QR's UIDAI signature (24 Oct 2026, aadhaarSignature.js)
  signedOk: 'UIDAI signature checked: these details are as UIDAI issued them.',
  signedNot: 'The UIDAI signature could not be confirmed. Compare every detail with the card before saving.',
  signedNone: 'This older QR code has no UIDAI signature. Compare the details with the card before saving.',
  // (23 Oct 2026) What makes a photo readable: the QR big and sharp. A photo of a phone screen, or a photo forwarded on
  // WhatsApp (made smaller), is usually too small or blurred.
  noQr:
    'The QR code could not be read – it is too small or blurred in this picture. Take the photo again close up: the QR code fills about half the picture, in focus, no glare. For an e-Aadhaar, upload a screenshot zoomed in on the QR code, not a photo of the screen. Or type the details.',
  notAadhaar: 'This QR code is not an Aadhaar QR code. Please type the details.',
  notImage: 'This file could not be opened as a picture. Please upload a photo (JPG or PNG) or a screenshot.',
  pdf: 'A PDF cannot be read here (an e-Aadhaar PDF is locked with a password). Open it, take a screenshot zoomed in on the QR code, and upload that.',
  tooBig: 'This file is too large (over 25 MB). Please upload a smaller photo or a screenshot.',
};

// What a photo of the card may be (24 Oct 2026): pictures Chrome can open, at most 25 MB
const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'];
const MAX_FILE_BYTES = 25 * 1024 * 1024;
export function fileProblem(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '')) return 'PDF';
  if (file.size > MAX_FILE_BYTES) return 'TOO_BIG';
  if (file.type && !PICTURE_TYPES.includes(file.type)) return 'NOT_IMAGE';
  return null;
}

// The camera's still photo (often sharper and larger than its live picture), else the frame shown now
async function stillFrom(track, v) {
  if (typeof window !== 'undefined' && 'ImageCapture' in window && track) {
    try {
      const blob = await new window.ImageCapture(track).takePhoto();
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, w: bitmap.width, h: bitmap.height, done: () => bitmap.close() };
    } catch {
      // not on this camera: the live frame
    }
  }
  return { source: v, w: v.videoWidth, h: v.videoHeight, done: () => {} };
}

/**
 * Reads the QR from the camera, live, until found (onText): a quick look at every frame, a closer look about every 2
 * seconds, and Capture for a still photo looked at closely. Nothing is recorded or kept.
 */
// The camera chosen for reading Aadhaar on this computer (a USB webcam rather than the laptop's own): its id only
const CAMERA_KEY = 'perinexa:aadhaarCamera';
const savedCamera = () => {
  try {
    return localStorage.getItem(CAMERA_KEY) || '';
  } catch {
    return '';
  }
};
const saveCamera = (id) => {
  try {
    if (id) localStorage.setItem(CAMERA_KEY, id);
    else localStorage.removeItem(CAMERA_KEY);
  } catch {
    /* not important if it can't be remembered */
  }
};
// A laptop's own camera, by its name – a USB webcam is preferred when there is one
export const isBuiltInCamera = (label) => /integrated|built-?in|facetime|internal|laptop|\bfront\b/i.test(label ?? '');

/** The cameras of this computer: [{ id, label }] (names only once the camera is allowed). */
async function listCameras() {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

// Mirror picture: shown flipped left–right, like a mirror (only what is shown – the reading is the same)
const MIRROR_KEY = 'perinexa:aadhaarMirror';
const savedMirror = () => {
  try {
    return localStorage.getItem(MIRROR_KEY) === '1';
  } catch {
    return false;
  }
};

// facing: 'environment' (the back camera of a phone) or 'user' (the front one); facingExact: only that one (Switch)
function CameraScan({ words, onText, onBlocked, deviceId = '', facing = 'environment', facingExact = false, onCameras = () => {}, onGone = () => {}, onSwitch = null, mirror = false, onMirror = () => {} }) {
  const video = useRef(null);
  const trackRef = useRef(null);
  const stoppedRef = useRef(false);
  const [size, setSize] = useState(null); // the camera's picture, e.g. "1280 × 720"
  const [slow, setSlow] = useState(false); // nothing read after a while: the tips
  const [capturing, setCapturing] = useState(false);
  const [missed, setMissed] = useState(false); // Capture did not read it
  const deepBusy = useRef(false);

  useEffect(() => {
    let stream = null;
    let timer = null;
    const canvas = document.createElement('canvas');
    const deepCanvas = document.createElement('canvas');
    stoppedRef.current = false;
    const tipTimer = setTimeout(() => setSlow(true), 8000);
    (async () => {
      try {
        // The back camera on a phone; the sharpest picture the camera gives (4K, Full HD, …) – the Secure QR on the card
        // is dense, and each of its squares needs about 3 camera dots to be read
        const sharpest = { width: { ideal: 3840 }, height: { ideal: 2160 } };
        const face = facingExact ? { exact: facing } : { ideal: facing };
        stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, ...sharpest } : { facingMode: face, ...sharpest }, audio: false });
        const [track] = stream.getVideoTracks();
        trackRef.current = track;
        onCameras(await listCameras(), track?.getSettings?.().deviceId ?? deviceId, track?.label ?? '');
        // Focus that follows the card, where the camera can (most phones, some webcams)
        if (track?.getCapabilities?.().focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        if (stoppedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        let frame = 0;
        let lastDeep = Date.now();
        const look = async () => {
          if (stoppedRef.current) return;
          const v = video.current;
          if (v && v.readyState >= 2 && v.videoWidth) {
            setSize(`${v.videoWidth} × ${v.videoHeight}`);
            let text = await readQrFrom(v, v.videoWidth, v.videoHeight, { quick: true, frame: frame++, canvas });
            // A closer look at the frame about every 2 seconds
            if (!text && !deepBusy.current && Date.now() - lastDeep > 2000) {
              deepBusy.current = true;
              text = await readQrFrom(v, v.videoWidth, v.videoHeight, { deep: true, canvas: deepCanvas });
              deepBusy.current = false;
              lastDeep = Date.now();
            }
            if (text && !stoppedRef.current) {
              stoppedRef.current = true;
              onText(text);
              return;
            }
          }
          if (!stoppedRef.current) timer = setTimeout(look, 60);
        };
        look();
      } catch (err) {
        if (stoppedRef.current) return;
        const gone = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError';
        if (gone && (deviceId || facingExact)) onGone(); // the chosen camera is not there: back to the usual one
        else onBlocked(gone ? 'none' : 'blocked');
      }
    })();
    return () => {
      stoppedRef.current = true;
      clearTimeout(timer);
      clearTimeout(tipTimer);
      stream?.getTracks().forEach((t) => t.stop()); // the camera light goes off
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture: a still photo from the camera, looked at closely
  const capture = async () => {
    const v = video.current;
    if (!v?.videoWidth || capturing) return;
    setCapturing(true);
    setMissed(false);
    const still = await stillFrom(trackRef.current, v);
    try {
      const text = (await readQrFrom(still.source, still.w, still.h, { deep: true })) ?? (await readQrFrom(still.source, still.w, still.h));
      if (text && !stoppedRef.current) {
        stoppedRef.current = true;
        onText(text);
        return;
      }
      setMissed(true);
    } finally {
      still.done();
      setCapturing(false);
    }
  };

  return (
    <div className="aadhaar-camera">
      <div className="aadhaar-camera-view">
        <video ref={video} muted playsInline aria-label={words.camera} className={mirror ? 'is-mirrored' : undefined} />
        <span className="aadhaar-camera-box" aria-hidden="true" />
      </div>
      <div className="row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={capture} disabled={capturing || !size}>
          <Aperture aria-hidden="true" /> {capturing ? words.reading : words.capture}
        </button>
        {onSwitch && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onSwitch}>
            <SwitchCamera aria-hidden="true" /> {words.switchCamera}
          </button>
        )}
        <button type="button" className="btn btn-link btn-sm" aria-pressed={mirror} onClick={onMirror}>
          <FlipHorizontal2 aria-hidden="true" /> {words.mirror}
        </button>
        {size && <span className="hint tabular">{words.cameraSize(size)}</span>}
      </div>
      <p className="hint" role="status">
        <Camera aria-hidden="true" /> {words.looking} {words.cameraHint}
      </p>
      {missed && <Alert type="warning">{words.captureMissed}</Alert>}
      {slow && !missed && <Alert type="info">{words.slowTips}</Alert>}
    </div>
  );
}

/**
 * onFill({ fullName, ageYears, address, pinCode, city, state, last4 }) with what the card holds ('' when missing).
 * scanner: offer the USB QR scanner box (staff desks; not on the patient's own sign-up).
 */
// signature: say whether the UIDAI signature was checked (staff; the patient's sign-up has no wording for it yet)
export function AadhaarQrFill({ onFill, disabled = false, words = AADHAAR_WORDS, scanner = true, signature = true }) {
  const t = { ...AADHAAR_WORDS, ...words };
  const problem = { NO_QR: t.noQr, NOT_AADHAAR: t.notAadhaar, NOT_IMAGE: t.notImage, PDF: t.pdf, TOO_BIG: t.tooBig };
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [cameraId, setCameraId] = useState(savedCamera);
  const [cameras, setCameras] = useState([]);
  const [inUse, setInUse] = useState('');
  const [facing, setFacing] = useState('environment');
  const [facingExact, setFacingExact] = useState(false);
  const [oneCamera, setOneCamera] = useState(false);
  const [mirror, setMirror] = useState(savedMirror);
  // Told by the camera once it is open: the list, and which one is in use. With no choice saved, a USB webcam is
  // used in place of the laptop's own camera.
  const camerasFound = (list, using, label) => {
    setCameras(list);
    setInUse(using);
    if (!cameraId && list.length > 1 && isBuiltInCamera(label)) {
      const usb = list.find((c) => c.id !== using && !isBuiltInCamera(c.label));
      if (usb) setCameraId(usb.id);
    }
  };
  const chooseCamera = (id) => {
    saveCamera(id);
    setCameraId(id);
  };
  // Switch camera (owner, 17 Oct 2026: always there): the next camera in the list (a computer's own ↔ a USB webcam,
  // a phone's back ↔ front); where the list has one camera, the other side (back ↔ front), else "only one camera"
  const switchCamera = () => {
    setOneCamera(false);
    if (cameras.length > 1) {
      const at = cameras.findIndex((c) => c.id === (cameraId || inUse));
      const next = cameras[(at + 1) % cameras.length];
      if (next && next.id !== (cameraId || inUse)) {
        chooseCamera(next.id);
        return;
      }
    }
    if (cameraId) chooseCamera('');
    setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
    setFacingExact(true);
  };
  // The chosen camera is not there: the usual one, and when it was the other side of a phone, say there is only one
  const cameraGone = () => {
    if (facingExact) {
      setFacing('environment');
      setFacingExact(false);
      setOneCamera(true);
    } else chooseCamera('');
  };
  const toggleMirror = () => {
    setMirror((m) => {
      try {
        localStorage.setItem(MIRROR_KEY, m ? '0' : '1');
      } catch {
        /* not important if it can't be remembered */
      }
      return !m;
    });
  };
  const [scanned, setScanned] = useState('');
  const [result, setResult] = useState(null); // { ok: [labels], signature } or { problem }
  const input = useRef(null);
  const labels = t.fields ?? AADHAAR_FIELD_LABELS;

  // What a QR holds (from the camera, the scanner or a photo) → the form
  const use = async (getText) => {
    setBusy(true);
    setResult(null);
    try {
      const { signature: signed, ...values } = await parseAadhaarQr(await getText());
      onFill(values);
      setResult({ ok: Object.keys(labels).filter((k) => values[k]).map((k) => labels[k]), signature: signed });
    } catch (err) {
      setResult({ problem: problem[err.message] ?? problem.NO_QR });
    } finally {
      setBusy(false);
    }
  };
  const fromFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the picture is not kept, even in the file box
    if (!file) return;
    setCamera(false);
    const wrong = fileProblem(file);
    if (wrong) setResult({ problem: problem[wrong] });
    else use(() => readQrFromImage(file));
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
    if (text.trim()) {
      setCamera(false);
      use(() => text);
    }
  };
  const scan = () => {
    setResult(null);
    setCamera(true);
  };
  const close = () => {
    setCamera(false);
    setOpen(false);
    setResult(null);
  };

  // One click (owner, 17 Oct 2026): the button says it is done with her agreement, and the camera opens straight away
  if (!open) {
    return (
      <div className="aadhaar-start">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            prepareQrReaders();
            setOpen(true);
            scan();
          }}
          disabled={disabled}
        >
          <Camera aria-hidden="true" /> {t.open}
        </button>
        <span className="hint">{t.openHint}</span>
      </div>
    );
  }
  const can = !busy && !disabled;
  return (
    <div className="aadhaar-fill">
      {camera && cameras.length > 1 && (
        <label className="aadhaar-camera-pick">
          <span>{t.whichCamera}</span>
          <select value={cameraId || ''} onChange={(e) => chooseCamera(e.target.value)}>
            {!cameraId && <option value="">{t.defaultCamera}</option>}
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {camera && !disabled && (
        <CameraScan
          key={`${cameraId || 'default'}-${facing}-${facingExact}`}
          words={t}
          deviceId={cameraId}
          facing={facing}
          facingExact={facingExact}
          onCameras={camerasFound}
          onGone={cameraGone}
          onSwitch={switchCamera}
          mirror={mirror}
          onMirror={toggleMirror}
          onText={fromCamera}
          onBlocked={cameraProblem}
        />
      )}
      {camera && oneCamera && <Alert type="info">{t.oneCamera}</Alert>}
      {result?.ok && <Alert type="success">{t.filled(result.ok.join(', '))}</Alert>}
      {result?.ok && signature && result.signature === 'verified' && <Alert type="success">{t.signedOk}</Alert>}
      {result?.ok && signature && result.signature === 'not-verified' && <Alert type="warning">{t.signedNot}</Alert>}
      {result?.ok && signature && result.signature === 'none' && <Alert type="info">{t.signedNone}</Alert>}
      {result?.problem && <Alert type="warning">{result.problem}</Alert>}
      {busy && <p className="hint" role="status">{t.reading}</p>}
      <div className="row">
        {!camera && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={!can} onClick={scan}>
            <Camera aria-hidden="true" /> {t.scanAgain}
          </button>
        )}
        <input ref={input} type="file" accept="image/*,application/pdf" className="sr-only" onChange={fromFile} aria-label={t.upload} tabIndex={-1} />
        <button type="button" className="btn btn-link btn-sm" disabled={!can} onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" /> {t.upload}
        </button>
        <button type="button" className="btn btn-link btn-sm" onClick={close}>
          {t.close}
        </button>
      </div>
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
    </div>
  );
}
