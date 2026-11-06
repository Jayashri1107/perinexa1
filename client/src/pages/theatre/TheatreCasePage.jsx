import { useEffect, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { ShowChoice } from '../quality/SimpleTable.jsx';
import { ChecklistProgress, STATUS_LOOK } from './TheatreListPage.jsx';
import { ANAESTHESIA, PHASES, PHASE_ORDER, URGENCY, WHO_SOURCE, missingInPhase } from './whoRules.js';

// One operation and its WHO Surgical Safety Checklist (Clinical Requirements Group B, item 16 – PX-OT-02): sign in,
// time out and sign out, in order; each is saved as it is filled and confirmed once by a member of the team, then
// locked. The second person who checks the counts comes with the base rules (Group C).

const ANSWER_WORDS = { yes: 'Yes', no: 'No', na: 'Not applicable' };
const optionsFor = (item) => (item.kind === 'check' ? [['yes', 'Yes'], ['no', 'No'], ...(item.na ? [['na', 'Not applicable']] : [])] : [['yes', 'Yes'], ['no', 'No']]);

function Phase({ c, phase, canWrite, onSaved }) {
  const def = PHASES[phase];
  const confirmed = c.progress[phase];
  const previous = PHASE_ORDER.slice(0, PHASE_ORDER.indexOf(phase)).find((p) => !c.progress[p]);
  const [answers, setAnswers] = useState(c.checklist[phase].answers);
  const [notes, setNotes] = useState(c.checklist[phase].notes);
  const [fields, setFields] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAnswers(c.checklist[phase].answers);
    setNotes(c.checklist[phase].notes);
  }, [c, phase]);
  const editable = canWrite && !confirmed && c.status !== 'cancelled';
  const body = () => ({ answers: Object.fromEntries(def.items.map((i) => [i.key, answers[i.key] ?? ''])), notes: Object.fromEntries(def.items.map((i) => [i.key, notes[i.key] ?? ''])) });
  const call = async (path, method, okText) => {
    setBusy(true);
    try {
      await api(path, { method, body: body() });
      setFields({});
      setMessage({ type: 'success', text: okText });
      onSaved();
    } catch (err) {
      setFields(err.fields ?? {});
      setMessage({ type: 'error', text: err.message });
    }
    setBusy(false);
  };
  const missing = missingInPhase(phase, answers, notes);
  return (
    <section className="card" aria-labelledby={`ph-${phase}`}>
      <div className="item-editor-head">
        <h2 id={`ph-${phase}`}>{def.label}</h2>
        {confirmed ? (
          <StatusPill tone="stable" icon={BadgeCheck}>{`Confirmed – ${confirmed.byName} (${confirmed.role}), ${formatDateTime(confirmed.at)}`}</StatusPill>
        ) : (
          <StatusPill tone="neutral">Not confirmed yet</StatusPill>
        )}
      </div>
      {message && (
        <Alert type={message.type} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      <div className="dc-items">
        {def.items.map((i) => {
          const a = answers[i.key] ?? '';
          const needNote = (i.kind === 'question' && a === 'yes') || (i.kind === 'count' && a === 'no') || notes[i.key];
          const err = fields[`answers.${i.key}`] ?? (editable ? null : null);
          return (
            <div key={i.key} className={`dc-item ${err || fields[`notes.${i.key}`] ? 'has-error' : ''}`.trim()}>
              <span className="dc-item-label">{i.label}</span>
              {editable ? <ShowChoice label={i.label} options={optionsFor(i)} value={a} onChange={(v) => setAnswers({ ...answers, [i.key]: v })} /> : <strong>{ANSWER_WORDS[a] ?? '–'}</strong>}
              {err && <span className="field-error">{err}</span>}
              {needNote && (
                <Field label={i.kind === 'count' ? 'What was done' : i.ifYes} id={`n-${phase}-${i.key}`} error={fields[`notes.${i.key}`]}>
                  <input id={`n-${phase}-${i.key}`} maxLength={300} disabled={!editable} value={notes[i.key] ?? ''} onChange={(e) => setNotes({ ...notes, [i.key]: e.target.value })} />
                </Field>
              )}
            </div>
          );
        })}
      </div>
      {phase === 'signOut' && <p className="hint">The counts are recorded by one person for now; a second person checking them comes with the base rules. Wrong counts: also report an incident.</p>}
      {editable && (
        <div className="row">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => call(`/theatre/${c.id}/checklist/${phase}`, 'PUT', 'Saved.')}>
            Save
          </button>
          <button type="button" className="btn btn-positive" disabled={busy || Boolean(previous)} onClick={() => call(`/theatre/${c.id}/checklist/${phase}/confirm`, 'POST', 'Confirmed.')}>
            <BadgeCheck aria-hidden="true" /> {`Confirm ${def.label.split(' – ')[0].toLowerCase()}`}
          </button>
          <span className="hint">{previous ? `Confirm ${PHASES[previous].label.split(' – ')[0].toLowerCase()} first.` : Object.keys(missing).length ? `${Object.keys(missing).length} to answer` : 'Everything answered'}</span>
        </div>
      )}
    </section>
  );
}

function CancelDialog({ c, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(`/theatre/${c.id}/cancel`, { method: 'POST', body: { reason } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="th-cancel" title="Take this operation off the list" submitLabel="Take off the list" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Why" id="th-why" error={error?.fields?.reason}>
        <input id="th-why" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

export function TheatreCasePage() {
  const { id } = useParams();
  const { data, error, reload } = useFetch(`/theatre/${id}`);
  const [cancelling, setCancelling] = useState(false);
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <p className="muted">Loading…</p>;
  const c = data.case;
  const look = STATUS_LOOK[c.status];
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Theatre list', to: `/theatre?date=${c.listDate}` }, { label: c.procedure }]} title={c.procedure} documentTitle="Theatre case" />
      <div className="pf-content stack">
        <section className="card">
          <div className="item-editor-head">
            <strong>{`${c.patient.fullName} · ${c.patient.mrn}`}</strong>
            <StatusPill tone={look.tone}>{look.word}</StatusPill>
          </div>
          <dl className="details">
            <div>
              <dt>When and where</dt>
              <dd>{`${formatDate(c.listDate)} · ${c.theatre}, number ${c.order} · ${URGENCY[c.urgency]}`}</dd>
            </div>
            <div>
              <dt>Operation</dt>
              <dd>{`${c.procedure}${c.site ? ` – ${c.site}` : ''}`}</dd>
            </div>
            <div>
              <dt>Team</dt>
              <dd>{[c.surgeon && `Surgeon ${c.surgeon}`, c.assistant && `assistant ${c.assistant}`, c.anaesthetist && `anaesthetist ${c.anaesthetist}`, c.anaesthesia && ANAESTHESIA[c.anaesthesia]].filter(Boolean).join(' · ') || '–'}</dd>
            </div>
          </dl>
          {c.status !== 'cancelled' && <ChecklistProgress progress={c.progress} />}
          {c.cancelled && <p>{`Taken off the list by ${c.cancelled.byName}: ${c.cancelled.reason}`}</p>}
          {data.access.write && c.status !== 'done' && !c.cancelled && (
            <button type="button" className="btn btn-link" onClick={() => setCancelling(true)}>
              Take off the list
            </button>
          )}
        </section>
        {PHASE_ORDER.map((p) => (
          <Phase key={p} c={c} phase={p} canWrite={data.access.write} onSaved={reload} />
        ))}
        <p className="muted small">{`Source: ${WHO_SOURCE}. DRAFT until compared with the hospital's manual page (OBG-F-16).`}</p>
      </div>
      {cancelling && (
        <CancelDialog
          c={c}
          onCancel={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            reload();
          }}
        />
      )}
    </>
  );
}
