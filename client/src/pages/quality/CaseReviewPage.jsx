import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { toIso } from './FormDialog.jsx';
import { ManualPrint } from '../../components/print/ManualPage.jsx';
import { REVIEW_LOOK, reviewNumber } from './CaseReviewsPage.jsx';

// One maternal death or near-miss review (Clinical Requirements Group C – PX-OBG-30, DRAFT lists; PX-X-05 sealing): a
// draft is filled in and saved by the team; a doctor signs and seals it. A sealed review is shown as signed, with the
// corrections added after it underneath – never changed.

/** ISO → "2026-11-08T22:00" in this computer's time, for the date-and-time box. */
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const EMPTY_ACTION = { text: '', owner: '', dueOn: '' };
const formOf = (r) => ({
  eventAt: toLocalInput(r.eventAt),
  summary: r.summary,
  criteria: r.criteria,
  cause: r.cause,
  causeDetail: r.causeDetail,
  delays: r.delays,
  avoidable: r.avoidable,
  factors: r.factors,
  lessons: r.lessons,
  actions: r.actions.length ? r.actions : [EMPTY_ACTION],
  meetingOn: r.meetingOn,
  members: r.members,
});

function DraftForm({ review, rules, onSaved }) {
  const [f, setF] = useState(() => formOf(review));
  const [fields, setFields] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const body = () => ({ ...f, eventAt: toIso(f.eventAt), actions: f.actions.filter((a) => a.text.trim()) });
  const run = async (fn, ok) => {
    setBusy(true);
    setFields({});
    setMessage(null);
    try {
      const res = await fn();
      setMessage({ type: 'success', text: ok });
      onSaved(res.review);
    } catch (err) {
      setFields(err.fields ?? {});
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => api(`/case-reviews/${review.id}`, { method: 'PATCH', body: body() }), 'Saved.');
  const seal = () =>
    run(async () => {
      await api(`/case-reviews/${review.id}`, { method: 'PATCH', body: body() });
      return api(`/case-reviews/${review.id}/seal`, { method: 'POST', body: {} });
    }, 'Signed and sealed. From now on mistakes are corrected on top.');
  const groups = [...new Set(rules.criteria.map((c) => c.group))];

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {message && <Alert type={message.type}>{message.text}</Alert>}
      <section className="card">
        <h2>The case</h2>
        <div className="form-grid">
          <Field label="When it happened" id="cr-at" error={fields.eventAt}>
            <DateTimeInput id="cr-at" value={f.eventAt} onChange={set('eventAt')} />
          </Field>
        </div>
        <Field label="Summary of the case" id="cr-summary" error={fields.summary}>
          <textarea id="cr-summary" rows={5} maxLength={3000} value={f.summary} onChange={set('summary')} />
        </Field>
      </section>
      {review.kind === 'near_miss' && (
        <fieldset className="card fieldset">
          <legend>Near-miss criteria (one or more)</legend>
          {fields.criteria && <p className="field-error">{fields.criteria}</p>}
          {groups.map((g) => (
            <div key={g}>
              <h3>{g}</h3>
              {rules.criteria
                .filter((c) => c.group === g)
                .map((c) => (
                  <label key={c.key} className="check">
                    <input
                      type="checkbox"
                      checked={f.criteria.includes(c.key)}
                      onChange={(e) => setF({ ...f, criteria: e.target.checked ? [...f.criteria, c.key] : f.criteria.filter((k) => k !== c.key) })}
                    />{' '}
                    {c.label}
                  </label>
                ))}
            </div>
          ))}
        </fieldset>
      )}
      <section className="card">
        <h2>Cause and delays</h2>
        <div className="form-grid">
          <Field label="Underlying cause" id="cr-cause" error={fields.cause}>
            <select id="cr-cause" value={f.cause} onChange={set('cause')}>
              <option value="">Choose…</option>
              {Object.entries(rules.causes).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cause in words" id="cr-cause-words" error={fields.causeDetail}>
            <input id="cr-cause-words" maxLength={500} value={f.causeDetail} onChange={set('causeDetail')} />
          </Field>
        </div>
        {Object.entries(rules.delays).map(([k, label]) => (
          <div key={k} className="form-grid">
            <Field label={label} id={`cr-${k}`} error={fields[`delays.${k}`]}>
              <select id={`cr-${k}`} value={f.delays[k].answer} onChange={(e) => setF({ ...f, delays: { ...f.delays, [k]: { ...f.delays[k], answer: e.target.value } } })}>
                <option value="">Choose…</option>
                {Object.entries(rules.delayAnswers).map(([a, w]) => (
                  <option key={a} value={a}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="What happened" id={`cr-${k}-note`}>
              <input id={`cr-${k}-note`} maxLength={500} value={f.delays[k].note} onChange={(e) => setF({ ...f, delays: { ...f.delays, [k]: { ...f.delays[k], note: e.target.value } } })} />
            </Field>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Avoidability, lessons and actions</h2>
        <div className="form-grid">
          <Field label="Avoidable" id="cr-avoid" error={fields.avoidable}>
            <select id="cr-avoid" value={f.avoidable} onChange={set('avoidable')}>
              <option value="">Choose…</option>
              {Object.entries(rules.avoidable).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Avoidable factors" id="cr-factors">
          <textarea id="cr-factors" rows={3} maxLength={2000} value={f.factors} onChange={set('factors')} />
        </Field>
        <Field label="Lessons" id="cr-lessons">
          <textarea id="cr-lessons" rows={3} maxLength={2000} value={f.lessons} onChange={set('lessons')} />
        </Field>
        <h3>Actions</h3>
        {f.actions.map((a, i) => (
          <div key={i} className="form-grid">
            {['text', 'owner', 'dueOn'].map((k) => (
              <Field key={k} label={{ text: 'Action', owner: 'Who', dueOn: 'By (date)' }[k]} id={`cr-act-${i}-${k}`}>
                <input id={`cr-act-${i}-${k}`} type={k === 'dueOn' ? 'date' : 'text'} value={a[k]} onChange={(e) => setF({ ...f, actions: f.actions.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
              </Field>
            ))}
          </div>
        ))}
        <button type="button" className="btn btn-link" onClick={() => setF({ ...f, actions: [...f.actions, EMPTY_ACTION] })}>
          Add another action
        </button>
      </section>
      <section className="card">
        <h2>The review meeting</h2>
        <div className="form-grid">
          <Field label="Day of the meeting" id="cr-meet" error={fields.meetingOn}>
            <input id="cr-meet" type="date" value={f.meetingOn} onChange={set('meetingOn')} />
          </Field>
          <Field label="Present at the meeting" id="cr-members">
            <input id="cr-members" maxLength={500} value={f.members} onChange={set('members')} />
          </Field>
        </div>
      </section>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save the draft'}
        </button>
        {review.access.seal && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={seal}>
            Sign and seal
          </button>
        )}
      </div>
      <p className="hint">Once sealed the review cannot be changed; a mistake found later is added as a correction with the reason.</p>
    </form>
  );
}

function SealedView({ review, rules, onSaved }) {
  const [c, setC] = useState({ part: '', should: '', reason: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const words = (k, v) => (v ? v : '–');
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved((await api(`/case-reviews/${review.id}/corrections`, { method: 'POST', body: c })).review);
      setC({ part: '', should: '', reason: '' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const rows = [
    ['When it happened', formatDateTime(review.eventAt)],
    ['Summary of the case', review.summary],
    ...(review.kind === 'near_miss' ? [['Near-miss criteria', review.criteria.map((k) => rules.criteria.find((x) => x.key === k)?.label ?? k).join('; ')]] : []),
    ['Underlying cause', [rules.causes[review.cause], review.causeDetail].filter(Boolean).join(' – ')],
    ...Object.entries(rules.delays).map(([k, label]) => [label, [rules.delayAnswers[review.delays[k].answer], review.delays[k].note].filter(Boolean).join(' – ')]),
    ['Avoidable', rules.avoidable[review.avoidable]],
    ['Avoidable factors', review.factors],
    ['Lessons', review.lessons],
    ['Actions', review.actions.map((a) => [a.text, a.owner, a.dueOn && `by ${formatDate(a.dueOn)}`].filter(Boolean).join(' · ')).join('; ')],
    ['Day of the meeting', review.meetingOn ? formatDate(review.meetingOn) : ''],
    ['Present at the meeting', review.members],
  ];
  return (
    <div className="stack">
      <div className="row">
        <ManualPrint screen="case_review" on={String(review.eventAt).slice(0, 10)} title="Death or near-miss review">
          <h2>{`${rules.kinds[review.kind]} review ${reviewNumber(review.serial)} · ${review.patient?.fullName ?? ''} · ${review.patient?.mrn ?? ''}`}</h2>
          <table className="mp-table">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{`Signed and sealed by ${review.sealed.byName}, ${formatDateTime(review.sealed.at)}`}</p>
          {review.corrections.length > 0 && <h2>Corrections after sealing</h2>}
          {review.corrections.map((x) => (
            <p key={x.id}>{`${rules.correctable[x.part]}: should say ${x.should} – ${x.reason} (${x.byName}, ${formatDateTime(x.at)})`}</p>
          ))}
          <p>Confidential: for the review committee only.</p>
        </ManualPrint>
      </div>
      <section className="card">
        <h2>The review as signed</h2>
        <dl className="details">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{words(k, v)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card">
        <h2>Corrections</h2>
        {review.corrections.length === 0 && <p className="muted">No corrections.</p>}
        <ul className="pa-list">
          {review.corrections.map((x) => (
            <li key={x.id}>
              <StatusPill tone="watch">{rules.correctable[x.part]}</StatusPill>
              <span>{`Should say: ${x.should} · why: ${x.reason} · ${x.byName}, ${formatDateTime(x.at)}`}</span>
            </li>
          ))}
        </ul>
        <form className="stack" onSubmit={add}>
          <Alert type="error">{error?.fields ? null : error?.message}</Alert>
          <div className="form-grid">
            <Field label="Which part is wrong" id="cr-c-part" error={error?.fields?.part}>
              <select id="cr-c-part" value={c.part} onChange={(e) => setC({ ...c, part: e.target.value })}>
                <option value="">Choose…</option>
                {Object.entries(rules.correctable).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="What it should say" id="cr-c-should" error={error?.fields?.should}>
              <input id="cr-c-should" maxLength={1000} value={c.should} onChange={(e) => setC({ ...c, should: e.target.value })} />
            </Field>
            <Field label="Why it is corrected" id="cr-c-reason" error={error?.fields?.reason}>
              <input id="cr-c-reason" maxLength={300} value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} />
            </Field>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Add the correction'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function CaseReviewPage() {
  const { id } = useParams();
  const { data, error } = useFetch(`/case-reviews/${id}`);
  const [saved, setReview] = useState(null);
  const review = saved ?? data?.review ?? null;
  if (error) return <Alert type="error">{error}</Alert>;
  if (!review) return <p className="muted">Loading…</p>;
  const look = REVIEW_LOOK[review.status];
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Death and near-miss reviews', to: '/clinical-audit/reviews' }, { label: reviewNumber(review.serial) }]}
        title={`${data.rules.kinds[review.kind]} review ${reviewNumber(review.serial)}`}
        documentTitle="Death or near-miss review"
      />
      <div className="pf-content stack">
        <section className="card">
          <div className="item-editor-head">
            <strong>{review.patient ? `${review.patient.fullName} · ${review.patient.mrn}` : ''}</strong>
            <StatusPill tone={look.tone} icon={look.icon}>
              {look.word}
            </StatusPill>
          </div>
          <p className="hint">
            {[`Started by ${review.started.byName}, ${formatDateTime(review.started.at)}`, review.sealed && `signed and sealed by ${review.sealed.byName}, ${formatDateTime(review.sealed.at)}`].filter(Boolean).join(' · ')}
          </p>
          <p className="hint">{data.rules.source}. Confidential: not shown on her record.</p>
        </section>
        {review.status === 'draft' ? <DraftForm review={review} rules={data.rules} onSaved={setReview} /> : <SealedView review={review} rules={data.rules} onSaved={setReview} />}
      </div>
    </>
  );
}
