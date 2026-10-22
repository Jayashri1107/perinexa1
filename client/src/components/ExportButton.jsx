import { useState } from 'react';
import { Download } from 'lucide-react';
import { apiFile } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { downloadFile } from './print/pdfExport.js';
import { Alert, Field, useDialogFocus } from './ui.jsx';

// "Export" (21 Oct 2026): a list saved as an Excel-ready CSV file (server/src/routes/exports.js). Doctors only, and only
// their OWN patients – an export never shows more than the person may already see (a hospital admin sees no patient
// data, so has no button). Each file saved is in the audit log.
export const EXPORT_LISTS = {
  patients: { label: 'patients', dated: false, help: 'Your own patients. Leave the dates empty for all of them, or choose when they were registered.' },
  appointments: { label: 'appointments', dated: true, help: 'Your own appointments on these days.' },
  admissions: { label: 'admissions', dated: true, help: 'Stays of your own patients admitted on these days.' },
  lab: { label: 'lab orders', dated: true, help: 'Lab orders of your own patients on these days: the tests and their status, never the results.' },
  scans: { label: 'scans', dated: true, help: 'Scans of your own patients ordered on these days: the study and its status, never the report.' },
  referrals: { label: 'referrals', dated: true, help: 'Referrals received on these days for which you are the consultant.' },
};

/** Who sees the Export button: a doctor working in the hospital (not a platform user who opened its setup). */
export const canExport = (membership) => Boolean(membership && !membership.platform && membership.roles?.includes('doctor'));

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** This month so far: the first of the month to today (this computer's date). */
export const thisMonth = (now = new Date()) => ({ from: dayOf(new Date(now.getFullYear(), now.getMonth(), 1)), to: dayOf(now) });

/** The Export button of a list page – shown to doctors only. */
export function ExportButton({ what }) {
  const { activeMembership } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canExport(activeMembership) || !EXPORT_LISTS[what]) return null;
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)} title={`Save your ${EXPORT_LISTS[what].label} as a file for Excel`}>
        <Download aria-hidden="true" /> Export
      </button>
      {open && <ExportDialog what={what} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ExportDialog({ what, onClose }) {
  const list = EXPORT_LISTS[what];
  const ref = useDialogFocus(onClose);
  const [dates, setDates] = useState(list.dated ? thisMonth() : { from: '', to: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { blob, name } = await apiFile(`/exports/${what}`, { query: dates });
      downloadFile(blob, name);
      onClose();
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };
  const set = (k) => (e) => setDates({ ...dates, [k]: e.target.value });
  const ready = list.dated ? dates.from && dates.to : Boolean(dates.from) === Boolean(dates.to);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onSubmit={submit} noValidate>
        <h2 id="export-title">Export {list.label}</h2>
        <p>{list.help}</p>
        <Alert type="error">{error}</Alert>
        <div className="row">
          <Field label={list.dated ? 'From' : 'Registered from'} id="export-from" error={fields.from}>
            <input id="export-from" type="date" value={dates.from} onChange={set('from')} />
          </Field>
          <Field label="To" id="export-to" error={fields.to}>
            <input id="export-to" type="date" value={dates.to} onChange={set('to')} />
          </Field>
        </div>
        <Alert type="warning">The file has patients&rsquo; names and phone numbers. Keep it on this computer, never send it by WhatsApp or email. Saving it is recorded.</Alert>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
            <Download aria-hidden="true" /> {busy ? 'Saving…' : 'Save the file'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
