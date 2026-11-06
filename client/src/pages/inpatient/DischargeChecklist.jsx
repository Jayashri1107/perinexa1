import { useEffect, useState } from 'react';
import { BadgeCheck, CircleCheck, ClipboardList } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { ShowChoice } from '../quality/SimpleTable.jsx';
import { DANGER_SIGNS_BABY, DANGER_SIGNS_MOTHER, DISCHARGE_ITEMS, DISCHARGE_SOURCE, TEACHING_LANGUAGES, TEACH_BACK_BY, missingToComplete } from './postnatalRules.js';

// The postnatal discharge checklist and danger-sign teaching (Clinical Requirements Group B, item 14 – DRAFT until
// OBG-F-11 and OBG-P-03 replace it; English only until the translations are approved): the checks before she goes
// home, each danger sign explained, and the teach-back – she (or her family) says them back. Saved as a draft; marked
// complete once nothing is missing, then locked.

const ANSWER_WORDS = { yes: 'Yes', no: 'No', na: 'Not applicable' };
const empty = () => ({ items: Object.fromEntries(DISCHARGE_ITEMS.map((i) => [i.key, ''])), itemNotes: '', dangerSigns: [], teachBack: { done: false, by: '', language: '', note: '' }, followUpOn: '' });
const fromServer = (c) => ({ items: { ...c.items }, itemNotes: c.itemNotes ?? '', dangerSigns: [...c.dangerSigns], teachBack: { ...c.teachBack }, followUpOn: c.followUpOn ?? '' });
const GROUPS = { mother: 'The mother', baby: 'The baby', both: 'Going home' };

function SignBoxes({ title, signs, value, onChange, disabled }) {
  return (
    <fieldset className="fieldset">
      <legend>{title}</legend>
      <div className="stack">
        {signs.map((s) => (
          <label key={s.key} className="check">
            <input type="checkbox" disabled={disabled} checked={value.includes(s.key)} onChange={(e) => onChange(e.target.checked ? [...value, s.key] : value.filter((k) => k !== s.key))} /> {s.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CancelDialog({ checklist, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(`/discharge-checklist/${checklist.id}/cancel`, { method: 'POST', body: { reason } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="dc-cancel" title="Mark the checklist as entered in error" submitLabel="Mark as entered in error" onSubmit={submit} onCancel={onCancel}>
      <p>It stays on the stay, marked entered in error with your reason; a new checklist can be started.</p>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Why" id="dc-why" error={error?.fields?.reason}>
        <input id="dc-why" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

export function DischargeChecklistSection({ patient, admissionId }) {
  const skip = !['antenatal', 'postnatal', 'abortion'].includes(patient.careType);
  const { data, error, reload } = useFetch(skip ? null : '/discharge-checklist', { patientId: patient.id, admissionId });
  const [form, setForm] = useState(empty);
  const [notice, setNotice] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const c = data?.checklist ?? null;
  useEffect(() => {
    setForm(c ? fromServer(c) : empty());
    setFields({});
  }, [c?.id, c?.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  if (skip) return null;
  const locked = c?.status === 'complete';
  const canWrite = data?.access.write && !locked;
  const missing = missingToComplete(form);
  const fe = (k) => fields[k];
  const setItem = (k, v) => setForm({ ...form, items: { ...form.items, [k]: v } });
  const setTeach = (k, v) => setForm({ ...form, teachBack: { ...form.teachBack, [k]: v } });

  const saveDraft = async () => {
    setBusy(true);
    try {
      const res = await api('/discharge-checklist', { method: 'PUT', body: { patientId: patient.id, admissionId, rev: c ? c.rev : -1, ...form, followUpOn: form.followUpOn || null } });
      setNotice({ type: 'success', text: 'Checklist saved.' });
      setFields({});
      reload();
      return res.checklist;
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
      setFields(err.fields ?? {});
      return null;
    } finally {
      setBusy(false);
    }
  };
  const complete = async () => {
    if (Object.keys(missing).length) {
      setFields(missing);
      setNotice({ type: 'error', text: 'Fill in the highlighted parts before marking it complete.' });
      return;
    }
    const saved = await saveDraft();
    if (!saved) return;
    try {
      await api(`/discharge-checklist/${saved.id}/complete`, { method: 'POST', body: { rev: saved.rev } });
      setNotice({ type: 'success', text: 'Checklist complete.' });
      reload();
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
      setFields(err.fields ?? {});
    }
  };

  return (
    <section className="card" aria-labelledby="dc-title">
      <div className="item-editor-head">
        <h2 id="dc-title">Postnatal discharge checklist</h2>
        {c &&
          (locked ? (
            <StatusPill tone="stable" icon={BadgeCheck}>{`Complete – ${c.completed.byName}, ${formatDateTime(c.completed.at)}`}</StatusPill>
          ) : (
            <StatusPill tone="due" icon={ClipboardList}>{`Draft – saved by ${c.savedByName}`}</StatusPill>
          ))}
      </div>
      <Alert type="error">{error}</Alert>
      {notice && (
        <Alert type={notice.type} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      {data && (
        <div className="stack">
          {['mother', 'baby', 'both'].map((g) => (
            <fieldset key={g} className="fieldset">
              <legend>{GROUPS[g]}</legend>
              <div className="dc-items">
                {DISCHARGE_ITEMS.filter((i) => i.group === g).map((i) => (
                  <div key={i.key} className={`dc-item ${fe(`items.${i.key}`) ? 'has-error' : ''}`.trim()}>
                    <span className="dc-item-label">{i.label}</span>
                    {canWrite ? (
                      <ShowChoice label={i.label} options={[['yes', 'Yes'], ['no', 'No'], ...(i.na ? [['na', 'Not applicable']] : [])]} value={form.items[i.key]} onChange={(v) => setItem(i.key, v)} />
                    ) : (
                      <strong>{ANSWER_WORDS[form.items[i.key]] ?? '–'}</strong>
                    )}
                    {fe(`items.${i.key}`) && <span className="field-error">{fe(`items.${i.key}`)}</span>}
                  </div>
                ))}
              </div>
              {g === 'both' && (form.items.followUp === 'yes' || form.followUpOn) && (
                <Field label="Date of the next postnatal visit" id="dc-next" error={fe('followUpOn')}>
                  <input id="dc-next" type="date" disabled={!canWrite} value={form.followUpOn} onChange={(e) => setForm({ ...form, followUpOn: e.target.value })} />
                </Field>
              )}
            </fieldset>
          ))}
          <Field label="Notes (optional) – e.g. why an answer is No" id="dc-notes" error={fe('itemNotes')}>
            <textarea id="dc-notes" rows={2} maxLength={1000} disabled={!canWrite} value={form.itemNotes} onChange={(e) => setForm({ ...form, itemNotes: e.target.value })} />
          </Field>

          <h3>Danger signs – tell her to come to the hospital at once if any happen</h3>
          <p className="hint">Explain each sign to her and her family, then tick it.</p>
          {fe('dangerSigns') && <p className="field-error">{fe('dangerSigns')}</p>}
          <div className="dc-signs">
            <SignBoxes title="In the mother" signs={DANGER_SIGNS_MOTHER} value={form.dangerSigns} onChange={(v) => setForm({ ...form, dangerSigns: v })} disabled={!canWrite} />
            <SignBoxes title="In the baby" signs={DANGER_SIGNS_BABY} value={form.dangerSigns} onChange={(v) => setForm({ ...form, dangerSigns: v })} disabled={!canWrite} />
          </div>

          <fieldset className="fieldset">
            <legend>Teach-back</legend>
            <label className="check">
              <input type="checkbox" disabled={!canWrite} checked={form.teachBack.done} onChange={(e) => setTeach('done', e.target.checked)} /> She (or her family) said the danger signs back in her own words, and what to do
            </label>
            {fe('teachBack.done') && <p className="field-error">{fe('teachBack.done')}</p>}
            {form.teachBack.done && (
              <div className="form-grid">
                <Field label="Who said them back" id="dc-by" error={fe('teachBack.by')}>
                  <select id="dc-by" disabled={!canWrite} value={form.teachBack.by} onChange={(e) => setTeach('by', e.target.value)}>
                    <option value="">Choose…</option>
                    {Object.entries(TEACH_BACK_BY).map(([k, w]) => (
                      <option key={k} value={k}>
                        {w}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Language of the teaching (optional)" id="dc-lang">
                  <select id="dc-lang" disabled={!canWrite} value={form.teachBack.language} onChange={(e) => setTeach('language', e.target.value)}>
                    <option value="">Not recorded</option>
                    {Object.entries(TEACHING_LANGUAGES).map(([k, w]) => (
                      <option key={k} value={k}>
                        {w}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Note (optional)" id="dc-tnote">
                  <input id="dc-tnote" maxLength={500} disabled={!canWrite} value={form.teachBack.note} onChange={(e) => setTeach('note', e.target.value)} />
                </Field>
              </div>
            )}
          </fieldset>

          {canWrite && (
            <>
              <p className="hint">
                {Object.keys(missing).length ? (
                  `Still to do before it can be marked complete: ${Object.keys(missing).length} part${Object.keys(missing).length === 1 ? '' : 's'}.`
                ) : (
                  <>
                    <CircleCheck aria-hidden="true" className="inline-icon" /> Everything is filled in: it can be marked complete.
                  </>
                )}
              </p>
              <div className="row">
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={saveDraft}>
                  {busy ? 'Saving…' : 'Save draft'}
                </button>
                <button type="button" className="btn btn-positive" disabled={busy} onClick={complete}>
                  <BadgeCheck aria-hidden="true" /> Mark complete
                </button>
                {c && (
                  <button type="button" className="btn btn-link" onClick={() => setCancelling(true)}>
                    Entered in error
                  </button>
                )}
              </div>
            </>
          )}
          {locked && form.followUpOn && <p>{`Next postnatal visit: ${formatDate(form.followUpOn)}`}</p>}
          {data.earlier.length > 0 && <p className="hint">{`Earlier checklists marked entered in error: ${data.earlier.map((e) => `${e.cancelled.byName} – ${e.cancelled.reason}`).join('; ')}`}</p>}
          <p className="muted small">{`DRAFT until the leads replace it with the manual's pages (OBG-F-11, OBG-P-03). English only until the Marathi and Hindi wording is approved. Source: ${DISCHARGE_SOURCE}.`}</p>
        </div>
      )}
      {cancelling && c && (
        <CancelDialog
          checklist={c}
          onCancel={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            reload();
          }}
        />
      )}
    </section>
  );
}
