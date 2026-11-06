import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { nowLocal, toIso } from '../quality/FormDialog.jsx';
import { SpecimenList } from './SpecimenList.jsx';
import { SPECIMEN_KIND_LABELS } from './specimenFormat.js';

// Her specimens (Clinical Requirements Group A, item 3): log a specimen when it is sent, and follow its report.

const empty = () => ({ kind: 'histopathology', specimen: '', procedure: '', collectedAt: nowLocal(), sentAt: nowLocal(), lab: '', labReference: '' });

export function PatientSpecimensTab() {
  const { patient } = useOutletContext();
  const { data, error, loading, reload } = useFetch('/specimens', { show: 'all', patientId: patient.id });
  const [form, setForm] = useState(empty);
  const [requestId, setRequestId] = useState(newRequestId);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const fe = (k) => result?.error?.fields?.[k];
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api('/specimens', { method: 'POST', body: { ...form, clientRequestId: requestId, patientId: patient.id, collectedAt: toIso(form.collectedAt), sentAt: toIso(form.sentAt) } });
      setResult({ text: `Specimen ${res.specimen.serial} logged.` });
      setForm(empty());
      setRequestId(newRequestId());
      reload();
    } catch (err) {
      setResult({ error: err });
    }
    setBusy(false);
  };
  return (
    <div className="stack">
      <Alert type="error">{error ?? result?.error?.message}</Alert>
      {result?.text && <Alert type="success" onClose={() => setResult(null)}>{result.text}</Alert>}
      <section className="card" aria-labelledby="ps-log">
        <h2 id="ps-log">Log a specimen sent</h2>
        <form className="form-grid" onSubmit={save}>
          <Field label="Examination" id="ps-kind" error={fe('kind')}>
            <select id="ps-kind" value={form.kind} onChange={set('kind')}>
              {Object.entries(SPECIMEN_KIND_LABELS).map(([k, w]) => (
                <option key={k} value={k}>
                  {w}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Specimen" id="ps-specimen" error={fe('specimen')}>
            <input id="ps-specimen" maxLength={300} value={form.specimen} onChange={set('specimen')} />
          </Field>
          <Field label="Procedure (optional)" id="ps-procedure" error={fe('procedure')}>
            <input id="ps-procedure" maxLength={300} value={form.procedure} onChange={set('procedure')} />
          </Field>
          <Field label="Collected" id="ps-collected" error={fe('collectedAt')}>
            <DateTimeInput id="ps-collected" value={form.collectedAt} onChange={set('collectedAt')} />
          </Field>
          <Field label="Sent" id="ps-sent" error={fe('sentAt')}>
            <DateTimeInput id="ps-sent" value={form.sentAt} onChange={set('sentAt')} />
          </Field>
          <Field label="Laboratory (optional)" id="ps-lab" error={fe('lab')}>
            <input id="ps-lab" maxLength={200} value={form.lab} onChange={set('lab')} />
          </Field>
          <Field label="Laboratory reference (optional)" id="ps-ref" error={fe('labReference')}>
            <input id="ps-ref" maxLength={100} value={form.labReference} onChange={set('labReference')} />
          </Field>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Log the specimen'}
            </button>
          </div>
        </form>
      </section>
      <section className="card" aria-labelledby="ps-list">
        <h2 id="ps-list">Her specimens</h2>
        <SpecimenList specimens={data?.specimens ?? []} loading={loading && !data} showPatient={false} onChanged={reload} />
      </section>
    </div>
  );
}
