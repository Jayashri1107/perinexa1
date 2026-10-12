import { useState } from 'react';
import { FileSearch } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, StatusPill, useDialogFocus } from '../../components/ui.jsx';

const MAX_BYTES = 6 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const FLAG_TONE = { high: 'high', low: 'high', abnormal: 'high' };

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error("The file couldn't be read."));
    r.readAsDataURL(file);
  });

/** One line for the visit notes: "Report 2026-09-27 (CBC): Haemoglobin 9.4 g/dL (low); … – Low Hb." */
export function reportLine(r) {
  const values = (r.values ?? []).map((v) => `${v.name} ${v.value}${v.unit ? ` ${v.unit}` : ''}${['high', 'low', 'abnormal'].includes(v.flag) ? ` (${v.flag})` : ''}`);
  return `Report${r.reportDate ? ` ${r.reportDate}` : ''}${r.title ? ` (${r.title})` : ''}: ${values.join('; ')}${r.summary ? ` – ${r.summary}` : ''}`;
}

/**
 * "Read a report" (Smart features, step 8): a photo or PDF of a lab or scan report is read by AI; the doctor
 * checks the values, then adds them to this visit's notes (and the Hb to the vital signs). Nothing is saved
 * until the visit is saved. The file itself is not kept.
 */
export function ReportReaderDialog({ patientId, canHb, onUse, onClose }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [useHb, setUseHb] = useState(true);
  const dialogRef = useDialogFocus(onClose);

  const read = async () => {
    setError(null);
    if (!file) return setError('Choose a photo or PDF of the report first.');
    if (!TYPES.includes(file.type)) return setError('Choose a photo (JPG or PNG) or a PDF.');
    if (file.size > MAX_BYTES) return setError('The file is too big – at most 6 MB. Take the photo again at a lower size.');
    setBusy(true);
    try {
      const data = await toBase64(file);
      setResult(await api(`/patients/${patientId}/ai/read-report`, { method: 'POST', body: { fileName: file.name, mediaType: file.type, data } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="rr-title">
        <h2 id="rr-title">Read a report</h2>
        <p className="hint">
          A photo or PDF of a lab or scan report is read by AI (OpenAI). Use fake sample reports only. Cover or crop out the patient's name before taking the
          photo. The file is not kept.
        </p>
        <Alert type="error">{error}</Alert>
        {!result ? (
          <label className="field">
            <span className="field-label">Photo or PDF</span>
            <input type="file" accept={TYPES.join(',')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        ) : !result.readable ? (
          <Alert type="warning">This doesn't look like a report that can be read. Try a clearer, straight photo.</Alert>
        ) : (
          <>
            <p>
              <strong>{result.title || 'Report'}</strong>
              {result.reportDate && <span className="muted tabular"> · {result.reportDate}</span>}
            </p>
            <table className="dt rr-table">
              <thead>
                <tr>
                  <th scope="col">Test</th>
                  <th scope="col">Value</th>
                  <th scope="col">Marked</th>
                </tr>
              </thead>
              <tbody>
                {result.values.map((v, i) => (
                  <tr key={i}>
                    <td data-label="Test">{v.name}</td>
                    <td data-label="Value" className="tabular">
                      {v.value} {v.unit}
                    </td>
                    <td data-label="Marked">{FLAG_TONE[v.flag] ? <StatusPill tone="high">{v.flag}</StatusPill> : <span className="muted">{v.flag === 'normal' ? 'normal' : '—'}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.summary && <p>{result.summary}</p>}
            {canHb && result.hb != null && (
              <label className="check">
                <input type="checkbox" checked={useHb} onChange={(e) => setUseHb(e.target.checked)} />
                <span>Also put Hb {result.hb} g/dL into this visit's vital signs</span>
              </label>
            )}
            <p className="hint">Compare every value with the report itself before adding it.</p>
          </>
        )}
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
          {result?.readable ? (
            <button type="button" className="btn btn-primary" onClick={() => onUse({ line: reportLine(result), hb: canHb && useHb ? result.hb : null })}>
              Add to this visit
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={result ? () => setResult(null) : read} disabled={busy}>
              <FileSearch aria-hidden="true" /> {busy ? 'Reading…' : result ? 'Choose another file' : 'Read the report'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
