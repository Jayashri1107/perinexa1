import { useState } from 'react';
import { BedDouble, CircleCheck, Clock, Hospital } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { AdmissionLabelFields } from '../../components/AdmissionLabels.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { nowLocal, toIso } from './nicuFields.js';

// A baby's record → NICU, for reception (9 Nov 2026): admit the baby to the NICU at the desk – the unit, the bed, where
// the baby came from, when, and the doctor who asked for it – and see where the baby is now. Never the NICU form: the
// admitting doctor and the nurses are told by the notification bell and complete it on the Newborn care tab.

function DeskAdmit({ patientId, onDone, onCancel }) {
  const { data: o, error: loadError } = useFetch('/newborn-care/nicu/options', { patientId });
  const [requestId, setRequestId] = useState(newRequestId);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (loadError) return <Alert type="error">{loadError}</Alert>;
  if (!o) return <p className="muted">Loading…</p>;
  const form = f ?? { unit: o.units[0]?.key ?? '', source: '', transferFromName: '', admittedAt: nowLocal(), bedId: '', admittingDoctorId: '', consultantId: '', billingType: '' };
  const set = (k, v) => setF({ ...form, [k]: v });
  const unit = o.units.find((u) => u.key === form.unit);
  const beds = o.beds.filter((b) => b.unit === form.unit);
  const doctors = o.people.filter((p) => p.roles.includes('doctor'));
  const admitting = o.people.filter((p) => p.roles.some((r) => r === 'doctor' || r === 'rmo'));
  const full = beds.length > 0 && beds.every((b) => b.occupied);
  const fe = (k) => error?.fields?.[k];
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/newborn-care/nicu', { method: 'POST', body: { ...form, clientRequestId: requestId, patientId, admittedAt: toIso(form.admittedAt), consultantId: form.consultantId || null, admittingDoctorId: form.admittingDoctorId || null, motherId: o.prefill.motherId ?? undefined } });
      setRequestId(newRequestId());
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Alert type="error">{error?.message}</Alert>
      {full && <Alert type="info">This unit is full. The hospital admin can allow one more admission; otherwise the doctor arranges a transfer.</Alert>}
      {o.prefill.motherMrn && <p className="hint">{`Mother's record: ${o.prefill.motherMrn}`}</p>}
      <div className="form-grid">
        <Field label="Unit" id="nd-unit" error={fe('unit')}>
          <select id="nd-unit" value={form.unit} onChange={(e) => setF({ ...form, unit: e.target.value, source: '', bedId: '' })}>
            {o.units.map((u) => (
              <option key={u.key} value={u.key}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Came from" id="nd-src" error={fe('source') ?? fe('motherId')}>
          <select id="nd-src" value={form.source} onChange={(e) => set('source', e.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(unit?.sources ?? {}).map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        {form.source === 'transfer_other' && (
          <Field label="Hospital it came from" id="nd-from" error={fe('transferFromName')}>
            <input id="nd-from" maxLength={150} value={form.transferFromName} onChange={(e) => set('transferFromName', e.target.value)} />
          </Field>
        )}
        <Field label="Admitted" id="nd-at" error={fe('admittedAt')}>
          <DateTimeInput id="nd-at" value={form.admittedAt} onChange={(e) => set('admittedAt', e.target.value)} />
        </Field>
        {/* Asked at every admission, the baby's too (owner, 9 Nov 2026) */}
        <AdmissionLabelFields value={form} onChange={setF} fields={error?.fields ?? {}} idPrefix="nd" stayType={false} />
        <Field label="Bed" id="nd-bed" error={fe('bedId')} hint={beds.length ? `${beds.filter((b) => !b.occupied).length} of ${beds.length} free` : 'No NICU beds set up for this unit'}>
          <select id="nd-bed" value={form.bedId} onChange={(e) => set('bedId', e.target.value)}>
            <option value="">Choose…</option>
            {beds.map((b) => (
              <option key={b.id} value={b.id}>
                {`${b.ward} · ${b.name} – ${b.occupied ? 'taken' : 'free'}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Admitting doctor" id="nd-doc" error={fe('admittingDoctorId')} hint="The doctor or RMO who asked for the admission">
          <select id="nd-doc" value={form.admittingDoctorId} onChange={(e) => set('admittingDoctorId', e.target.value)}>
            <option value="">Choose…</option>
            {admitting.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Consultant (optional)" id="nd-cons" error={fe('consultantId')}>
          <select id="nd-cons" value={form.consultantId} onChange={(e) => set('consultantId', e.target.value)}>
            <option value="">Not chosen</option>
            {doctors.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="hint">The admitting doctor and the nurses are told at once; they record the baby's weight, temperature and the rest of the NICU form.</p>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Admitting…' : 'Admit to the NICU'}
        </button>
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function NicuDeskTab() {
  const { id } = useParams();
  const { data, error, reload } = useFetch('/newborn-care/nicu/desk', { patientId: id });
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <p className="muted">Loading…</p>;
  const now = data.admissions.find((a) => a.state === 'in');
  return (
    <section className="card stack" aria-labelledby="nd-title">
      <div className="item-editor-head">
        <h2 id="nd-title">NICU</h2>
        {data.access.admit && !open && (
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            Admit to the NICU
          </button>
        )}
      </div>
      {done && (
        <Alert type="success" onClose={() => setDone(false)}>
          Admitted to the NICU. The admitting doctor and the nurses have been told.
        </Alert>
      )}
      {open && (
        <DeskAdmit
          patientId={id}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            setDone(true);
            reload();
          }}
        />
      )}
      {!data.admissions.length && !open && <p className="muted">Not admitted to the NICU.</p>}
      <ul className="plain-list stack">
        {data.admissions.map((a) => (
          <li key={a.id} className={a.state === 'cancelled' ? 'muted' : undefined}>
            <span className="row">
              <StatusPill tone={a.state === 'in' ? 'admitted' : 'inactive'} icon={a.state === 'in' ? Hospital : CircleCheck}>
                {a.state === 'in' ? 'In the NICU' : a.state === 'left' ? `Left the NICU ${formatDateTime(a.leftAt)}` : 'Entered in error'}
              </StatusPill>
              <strong>{`${a.registerLabel} · ${a.unitName}`}</strong>
              {a.bed && (
                <span className="row">
                  <BedDouble aria-hidden="true" /> {a.bed}
                </span>
              )}
              {a.state === 'in' && a.assessmentNeeded && (
                <StatusPill tone="watch" icon={Clock}>
                  Waiting for the nurse or doctor
                </StatusPill>
              )}
            </span>
            <span className="ca-group-words">{`Admitted ${formatDateTime(a.admittedAt)} · ${a.sourceWords}${a.transferFromName ? ` – ${a.transferFromName}` : ''}${a.admittingDoctor ? ` · admitting doctor: ${a.admittingDoctor}` : ''} · by ${a.byName}`}</span>
          </li>
        ))}
      </ul>
      {now && <p className="hint">The baby's NICU form is kept by the doctors and nurses.</p>}
    </section>
  );
}
