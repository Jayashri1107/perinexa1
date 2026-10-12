import { useRef, useState } from 'react';
import { ArrowLeft, BedDouble, CircleCheck, CircleMinus, FilePlus2, HeartPulse } from 'lucide-react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { MenuButton } from '../../components/MenuButton.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { RedFlagCard } from '../redflags/RedFlagList.jsx';
import { notCheckedCareText } from '../redflags/redFlagFormat.js';
import { DOCTOR_CONFIRMS, KIND_LABELS, ONE_PER_STAY, docStatusLook, docTime, fromLocalInput, toLocalInput, vitalsLine } from './inpatientFormat.js';

// One stay in hospital (Version 2): when and why she was admitted, the ward and bed, the documents (each opens on
// its own page) and the nursing chart. The patient's doctor or an RMO writes documents; nurses, the doctor and RMOs
// write the chart. After discharge everything stays readable; nothing new is added.
// While she is in hospital the page shows her red flags: the latest vital signs on the chart are checked against the
// hospital's rules for her type of care, with her lab results (the card follows each new chart entry).

const NURSING_WORDS = { vitals: 'Vital signs', medicine: 'Medicine given', note: 'Note' };
// The stay's red flags as one text, to see whether a chart entry changed them
const flagKeys = (redFlags) => (redFlags?.flags ?? []).map((f) => `${f.key}:${f.detail}`).join('|');

function NursingChart({ patient, page, onSaved }) {
  const blank = { kind: 'vitals', at: '', bpSystolic: '', bpDiastolic: '', pulse: '', temperatureF: '', spo2: '', drug: '', dose: '', route: '', note: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const requestId = useRef(newRequestId());
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const a = page.admission;

  const add = async (e) => {
    e.preventDefault();
    if (patient.careType !== 'newborn' && ['note', 'drug', 'dose', 'route'].some((k) => mentionsFetalSex(form[k]))) return setFields({ note: PCPNDT_MESSAGE });
    setSaving(true);
    setError(null);
    setFields({});
    const body = {
      clientRequestId: requestId.current,
      kind: form.kind,
      at: fromLocalInput(form.at),
      ...(form.kind === 'vitals' ? { vitals: { bpSystolic: form.bpSystolic, bpDiastolic: form.bpDiastolic, pulse: form.pulse, temperatureF: form.temperatureF, spo2: form.spo2 } } : {}),
      ...(form.kind === 'medicine' ? { medicine: { drug: form.drug, dose: form.dose, route: form.route } } : {}),
      note: form.note,
    };
    try {
      const res = await api(`/patients/${patient.id}/admissions/${a.id}/nursing`, { method: 'POST', body });
      requestId.current = newRequestId();
      setForm({ ...blank, kind: form.kind });
      onSaved(res);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
    } finally {
      setSaving(false);
    }
    return undefined;
  };
  const cancel = async (entry) => {
    const reason = cancelling?.reason?.trim() ?? '';
    if (reason.length < 5) return setError('Please say why the entry is wrong (at least 5 characters).');
    try {
      onSaved(await api(`/patients/${patient.id}/admissions/${a.id}/nursing/${entry.id}/cancel`, { method: 'POST', body: { reason } }));
      setCancelling(null);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
    return undefined;
  };

  return (
    <section className="card ip-chart" aria-labelledby="ip-chart-title">
      <h2 id="ip-chart-title">
        <HeartPulse aria-hidden="true" /> Nursing chart
      </h2>
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      {page.access.canChart && (
        <form className="ip-chart-form" onSubmit={add} noValidate>
          <div className="segmented" role="group" aria-label="What to record">
            {Object.entries(NURSING_WORDS).map(([k, w]) => (
              <button key={k} type="button" aria-pressed={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>
                {w}
              </button>
            ))}
          </div>
          <div className="form-grid ip-chart-grid">
            {form.kind === 'vitals' && (
              <>
                <Field label="BP upper" id="nc-sys" error={fields['vitals.bpSystolic']}>
                  <input id="nc-sys" inputMode="numeric" value={form.bpSystolic} onChange={set('bpSystolic')} />
                </Field>
                <Field label="BP lower" id="nc-dia" error={fields['vitals.bpDiastolic']}>
                  <input id="nc-dia" inputMode="numeric" value={form.bpDiastolic} onChange={set('bpDiastolic')} />
                </Field>
                <Field label="Pulse" id="nc-pulse" error={fields['vitals.pulse']}>
                  <input id="nc-pulse" inputMode="numeric" value={form.pulse} onChange={set('pulse')} />
                </Field>
                <Field label="Temp (°F)" id="nc-temp" error={fields['vitals.temperatureF']}>
                  <input id="nc-temp" inputMode="decimal" value={form.temperatureF} onChange={set('temperatureF')} />
                </Field>
                <Field label="SpO2 (%)" id="nc-spo2" error={fields['vitals.spo2'] ?? fields.vitals}>
                  <input id="nc-spo2" inputMode="numeric" value={form.spo2} onChange={set('spo2')} />
                </Field>
              </>
            )}
            {form.kind === 'medicine' && (
              <>
                <Field label="Medicine" id="nc-drug" error={fields['medicine.drug']}>
                  <input id="nc-drug" value={form.drug} maxLength={120} onChange={set('drug')} />
                </Field>
                <Field label="Dose" id="nc-dose" error={fields['medicine.dose']}>
                  <input id="nc-dose" value={form.dose} maxLength={60} onChange={set('dose')} />
                </Field>
                <Field label="Route" id="nc-route" error={fields['medicine.route']}>
                  <input id="nc-route" value={form.route} maxLength={40} onChange={set('route')} />
                </Field>
              </>
            )}
            <Field label={form.kind === 'note' ? 'Note' : 'Note (optional)'} id="nc-note" error={fields.note}>
              <input id="nc-note" value={form.note} maxLength={1000} onChange={set('note')} />
            </Field>
            <Field label="Time (empty: now)" id="nc-at" error={fields.at}>
              <input id="nc-at" type="datetime-local" value={form.at} max={toLocalInput(new Date().toISOString())} onChange={set('at')} />
            </Field>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add to the chart'}
          </button>
        </form>
      )}
      {page.nursing.length === 0 ? (
        <p className="muted">Nothing on the chart yet.</p>
      ) : (
        <ol className="ip-chart-list">
          {page.nursing.map((e) => (
            <li key={e.id} className={e.cancelled ? 'is-cancelled' : undefined}>
              <span className="tabular muted">{formatDateTime(e.at)}</span>
              <strong>{NURSING_WORDS[e.kind]}</strong>
              <span>
                {e.kind === 'vitals' && vitalsLine(e.vitals)}
                {e.kind === 'medicine' && [e.medicine.drug, e.medicine.dose, e.medicine.route].filter(Boolean).join(' · ')}
                {e.note && `${e.kind === 'note' ? '' : ' – '}${e.note}`}
              </span>
              <span className="muted">{e.byName}</span>
              {e.cancelled ? (
                <StatusPill tone="inactive" icon={CircleMinus} title={e.cancelled.reason}>
                  Entered in error
                </StatusPill>
              ) : (
                page.access.canChart &&
                (cancelling?.id === e.id ? (
                  <span className="ip-cancel">
                    <input aria-label="Why is this entry wrong?" placeholder="Why is it wrong?" value={cancelling.reason} maxLength={300} onChange={(ev) => setCancelling({ ...cancelling, reason: ev.target.value })} />
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => cancel(e)}>
                      Mark entered in error
                    </button>
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setCancelling(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-link btn-sm" onClick={() => setCancelling({ id: e.id, reason: '' })}>
                    Entered in error
                  </button>
                ))
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AdmissionPage() {
  const { patient, reload: reloadPatient } = useOutletContext();
  const { admissionId } = useParams();
  const navigate = useNavigate();
  const { data, error, reload } = useFetch(`/patients/${patient.id}/admissions/${admissionId}`);
  const [latest, setLatest] = useState(null);
  const [notice, setNotice] = useState(null);
  const [place, setPlace] = useState(null); // editing the ward and bed
  const page = latest && latest.admission.id === admissionId ? latest : data;
  if (error && !page) return <Alert type="error">{error}</Alert>;
  if (!page) return <div className="card plan-loading" aria-busy="true" />;
  const a = page.admission;
  const docs = page.documents;
  const base = `/patients/${patient.id}/stays/${a.id}`;
  const active = (kind) => docs.some((d) => d.kind === kind && d.status !== 'cancelled');

  const newDoc = async (kind) => {
    setNotice(null);
    try {
      const res = await api(`/patients/${patient.id}/admissions/${a.id}/documents`, { method: 'POST', body: { clientRequestId: newRequestId(), kind } });
      navigate(`${base}/docs/${res.document.id}`);
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
      reload();
    }
  };
  const kinds = ['admission', 'round', 'operation', ...(['newborn', 'abortion'].includes(patient.careType) ? [] : ['delivery']), 'discharge'].filter((k) => !(ONE_PER_STAY.includes(k) && active(k)));
  const savePlace = async () => {
    try {
      setLatest(await api(`/patients/${patient.id}/admissions/${a.id}`, { method: 'PATCH', body: { ward: place.ward.trim(), bed: place.bed.trim() } }));
      setPlace(null);
      reloadPatient();
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    }
  };

  return (
    <div className="vs-page ip-page">
      <section className="card vs-visit-head">
        <div className="vs-visit-top">
          <Link to={`/patients/${patient.id}/stays`} className="btn btn-link vs-back">
            <ArrowLeft aria-hidden="true" /> All stays
          </Link>
          {page.access.canWrite && kinds.length > 0 && (
            <MenuButton className="btn btn-primary" icon={FilePlus2} label="New document" align="end" items={kinds.map((k) => ({ label: KIND_LABELS[k], onSelect: () => newDoc(k) }))} />
          )}
        </div>
        <div className="vs-visit-title">
          <h2>Stay · admitted {formatDateTime(a.admittedAt)}</h2>
          {a.status === 'admitted' ? (
            <StatusPill tone="admitted" icon={BedDouble}>
              In hospital
            </StatusPill>
          ) : (
            <StatusPill tone="stable" icon={CircleCheck}>
              Discharged {formatDateTime(a.dischargedAt)}
            </StatusPill>
          )}
        </div>
        <p className="hint">
          {a.reason} · admitted by {a.admittedByName}
          {a.dischargedByName ? ` · discharge confirmed by ${a.dischargedByName}` : ''}
        </p>
        {place ? (
          <div className="row ip-place">
            <Field label="Ward" id="ip-ward">
              <input id="ip-ward" value={place.ward} maxLength={60} onChange={(e) => setPlace({ ...place, ward: e.target.value })} />
            </Field>
            <Field label="Bed" id="ip-bed">
              <input id="ip-bed" value={place.bed} maxLength={30} onChange={(e) => setPlace({ ...place, bed: e.target.value })} />
            </Field>
            <button type="button" className="btn btn-secondary" onClick={savePlace}>
              Save
            </button>
            <button type="button" className="btn btn-link" onClick={() => setPlace(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <p>
            <strong>{[a.ward, a.bed && `Bed ${a.bed}`].filter(Boolean).join(' · ') || 'No ward or bed recorded'}</strong>{' '}
            {page.access.canWrite && (
              <button type="button" className="btn btn-link btn-sm" onClick={() => setPlace({ ward: a.ward, bed: a.bed })}>
                Change ward or bed
              </button>
            )}
          </p>
        )}
      </section>
      {notice && (
        <Alert type={notice.type} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      <RedFlagCard redFlags={page.redFlags} patientId={patient.id} about="From the nursing chart of this stay, the lab results and the latest visit" />
      {/* No rule for her type of care: say that nothing is checked, never leave it looking like "no red flags" */}
      {page.redFlags?.checked === false && <p className="hint">{notCheckedCareText(page.redFlags.careType, page.redFlags.workupOnly)}</p>}

      <section className="card" aria-labelledby="ip-docs-title">
        <h2 id="ip-docs-title">Documents</h2>
        {docs.length === 0 ? (
          <p className="muted">No documents yet.{page.access.canWrite ? ' Start with New document → Admission note.' : ''}</p>
        ) : (
          <ul className="plain-list ip-doc-list">
            {docs.map((d) => {
              const look = docStatusLook(d);
              return (
                <li key={d.id} className={d.status === 'cancelled' ? 'is-cancelled' : undefined}>
                  <Link to={`${base}/docs/${d.id}`} className="strong-name">
                    {KIND_LABELS[d.kind]}
                  </Link>
                  <span className="tabular muted">{formatDateTime(docTime(d))}</span>
                  <StatusPill tone={look.tone} icon={look.icon}>
                    {look.word}
                  </StatusPill>
                  <span className="muted t-caption">
                    {d.signed ? `${DOCTOR_CONFIRMS.includes(d.kind) ? 'Confirmed' : 'Signed'} by ${d.signed.byName}` : `Written by ${d.savedByName ?? d.createdByName}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <NursingChart
        patient={patient}
        page={page}
        onSaved={(res) => {
          // A chart entry can raise or clear a red flag: the "Red flag" pill in the page header follows
          if (flagKeys(res?.redFlags) !== flagKeys(page.redFlags)) reloadPatient();
          setLatest(res);
        }}
      />
    </div>
  );
}
