import { useState } from 'react';
import { api } from '../../api.js';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';

// Alerts that follow the patient (Clinical Requirements Group C – PX-X-13; DRAFT list from the server): the list with
// the ended ones, adding one, and ending one that no longer applies (with a reason – never deleted).

export function PatientAlertsDialog({ patientId, newborn = false, onClose, onChanged }) {
  const { data, error, reload } = useFetch('/patient-alerts', { patientId });
  const [kind, setKind] = useState('');
  const [note, setNote] = useState('');
  const [ending, setEnding] = useState(null);
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const kinds = data?.rules?.kinds ?? {};
  const write = data?.access?.write === true;

  const send = async (path, body, done) => {
    setBusy(true);
    setFields({});
    setMessage(null);
    try {
      await api(path, { method: 'POST', body });
      done();
      reload();
      onChanged?.();
    } catch (err) {
      setFields(err.fields ?? {});
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    if (ending) {
      if (reason.trim().length < 3) return setFields({ reason: 'Write why it no longer applies' });
      return send(`/patient-alerts/${ending.id}/end`, { reason: reason.trim() }, () => {
        setEnding(null);
        setReason('');
      });
    }
    if (!kind) return setFields({ kind: 'Choose the kind of alert' });
    if (!newborn && mentionsFetalSex(note)) return setFields({ note: PCPNDT_MESSAGE });
    return send('/patient-alerts', { patientId, kind, note: note.trim() }, () => {
      setKind('');
      setNote('');
    });
  };

  return (
    <FormDialog id="pa" title={ending ? `End the alert – ${ending.label}` : 'Patient alerts'} submitLabel={ending ? 'End the alert' : 'Add the alert'} busy={busy} onSubmit={submit} onCancel={ending ? () => setEnding(null) : onClose}>
      <Alert type="error">{error ?? message}</Alert>
      {data?.rules?.source && <p className="hint">{data.rules.source}</p>}
      {!ending && (
        <>
          <ul className="pa-list">
            {(data?.alerts ?? []).map((a) => (
              <li key={a.id}>
                <StatusPill tone={a.ended ? 'inactive' : 'high'}>{a.ended ? `${a.label} – ended` : a.label}</StatusPill>
                <span>{[a.note, `added by ${a.byName}, ${formatDateTime(a.at)}`, a.ended && `ended by ${a.ended.byName}, ${formatDateTime(a.ended.at)}: ${a.ended.reason}`].filter(Boolean).join(' · ')}</span>
                {write && !a.ended && (
                  <button type="button" className="btn btn-link" onClick={() => setEnding(a)}>
                    End
                  </button>
                )}
              </li>
            ))}
            {data && data.alerts.length === 0 && <li>No alerts recorded.</li>}
          </ul>
          {write ? (
            <div className="form-grid">
              <Field label="Kind of alert" id="pa-kind" error={fields.kind} hint={kinds[kind]?.hint} keepHint>
                <select id="pa-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="">Choose…</option>
                  {Object.entries(kinds).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Note" id="pa-note" error={fields.note}>
                <input id="pa-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          ) : (
            data && <p className="hint">Her doctor, RMOs and nurses add and end alerts.</p>
          )}
        </>
      )}
      {ending && (
        <Field label="Why it no longer applies" id="pa-reason" error={fields.reason}>
          <input id="pa-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      )}
    </FormDialog>
  );
}
