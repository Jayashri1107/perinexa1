import { useState } from 'react';
import { CircleCheck, Phone, Siren } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { mentionsFetalSex, PCPNDT_MESSAGE } from '../../pcpndtWords.js';
import { CALL_HOW, CRITICAL_LOOK, OPEN_CALL_LOOK, criticalCallBody, criticalValueWords, emptyCall } from './labFormat.js';

// P5 and P6 of docs/LAB_BUILD_NOTE.md on the lab order page:
//  - CallFields: whom the lab told about a critical result (name, role, how, read back) – or, if nobody could be
//    reached, whom it tried. Used when reporting, when checking (the hospital's check) and to note a call later.
//  - CriticalCard: the critical values, the calls, and the doctor's one-click Acknowledge.
//  - DeltaQuestion: "Hb 7.1 g/dL; it was 11.8 on 29 Oct. Check the sample and the number." – Change, or Confirm.

export function CriticalPill() {
  return (
    <StatusPill tone={CRITICAL_LOOK.tone} icon={CRITICAL_LOOK.icon}>
      {CRITICAL_LOOK.word}
    </StatusPill>
  );
}

/** The call about a critical result: a controlled set of fields (value: emptyCall()); errors: the server's fields. */
export function CallFields({ id, values, value, onChange, errors = {} }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <fieldset className="fieldset lab-critical-call" aria-describedby={`${id}-what`}>
      <legend>
        <Siren aria-hidden="true" /> Critical result – note the call
      </legend>
      <p id={`${id}-what`}>
        {values?.length ? `${criticalValueWords(values)}. ` : ''}Tell a doctor (or the nurse in charge) now, ask them to read the value back, then note it here.
      </p>
      <label className="check">
        <input type="checkbox" checked={value.notReached} onChange={(e) => set('notReached', e.target.checked)} /> Nobody could be reached
      </label>
      {value.notReached ? (
        <Field label="Whom did you try, and how" id={`${id}-tried`} error={errors['criticalNotReached.triedName']} hint="The result is reported and stays at the top of the lab's list until a call is noted.">
          <input id={`${id}-tried`} maxLength={200} value={value.triedName} onChange={(e) => set('triedName', e.target.value)} />
        </Field>
      ) : (
        <div className="form-grid">
          <Field label="Whom you told" id={`${id}-name`} error={errors['criticalCall.toldName']}>
            <input id={`${id}-name`} maxLength={100} value={value.toldName} onChange={(e) => set('toldName', e.target.value)} />
          </Field>
          <Field label="Their role" id={`${id}-role`} error={errors['criticalCall.toldRole']} hint="Doctor, RMO, nurse in charge …">
            <input id={`${id}-role`} maxLength={60} value={value.toldRole} onChange={(e) => set('toldRole', e.target.value)} />
          </Field>
          <Field label="How" id={`${id}-how`} error={errors['criticalCall.how']}>
            <select id={`${id}-how`} value={value.how} onChange={(e) => set('how', e.target.value)}>
              {Object.entries(CALL_HOW).map(([k, w]) => (
                <option key={k} value={k}>
                  {w}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <label className="check">
              <input type="checkbox" checked={value.readBack} onChange={(e) => set('readBack', e.target.checked)} /> They read the value back to me
            </label>
            {errors['criticalCall.readBack'] && <p className="field-error">{errors['criticalCall.readBack']}</p>}
          </div>
        </div>
      )}
    </fieldset>
  );
}

/** Words checked before a call is sent: PCPNDT, and the obvious gaps (the server checks again). */
export function callProblem(call) {
  const texts = call.notReached ? [call.triedName] : [call.toldName, call.toldRole];
  if (texts.some((t) => mentionsFetalSex(t))) return PCPNDT_MESSAGE;
  if (call.notReached) return call.triedName.trim().length < 2 ? 'Write whom you tried to reach.' : null;
  if (call.toldName.trim().length < 2) return 'Write whom you told.';
  if (call.toldRole.trim().length < 2) return 'Write their role.';
  if (!call.readBack) return 'Ask them to read the value back, then tick the box.';
  return null;
}

/** The critical values of a reported order, the calls, and Acknowledge (for the doctor) or Note a call (the lab). */
export function CriticalCard({ order, onSaved, onError }) {
  const c = order.critical;
  const [noting, setNoting] = useState(false);
  const [call, setCall] = useState(emptyCall);
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!c) return null;
  const names = order.tests.flatMap((t) => t.values.filter((v) => v.critical).map((v) => ({ ...v, testKey: t.key })));
  const acknowledge = async () => {
    setBusy(true);
    try {
      onSaved((await api(`/lab/orders/${order.id}/acknowledge`, { method: 'POST', body: { rev: order.rev } })).order, 'Critical result acknowledged.');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  const noteCall = async (e) => {
    e.preventDefault();
    const problem = callProblem(call);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/lab/orders/${order.id}/critical-call`, { method: 'POST', body: { rev: order.rev, ...criticalCallBody(call) } });
      setNoting(false);
      setCall(emptyCall());
      onSaved(res.order, call.notReached ? 'Noted: nobody reached yet.' : 'Call noted.');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      if (err.status === 409) onError(err);
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  return (
    <section className="card lab-critical-card" aria-labelledby="lab-critical-title">
      <div className="plan-card-head">
        <h2 id="lab-critical-title">Critical result</h2>
        {c.open ? (
          <StatusPill tone={OPEN_CALL_LOOK.tone} icon={OPEN_CALL_LOOK.icon}>
            {OPEN_CALL_LOOK.word}
          </StatusPill>
        ) : c.acknowledged ? (
          <StatusPill tone="stable" icon={CircleCheck}>
            Acknowledged
          </StatusPill>
        ) : (
          <CriticalPill />
        )}
      </div>
      {names.length > 0 && <p>{criticalValueWords(names)}</p>}
      <ul className="plain-list lab-history">
        {c.calls.map((x, i) => (
          <li key={`c-${i}`}>
            <Phone aria-hidden="true" /> Told {x.toldName} ({x.toldRole}), {CALL_HOW[x.how]?.toLowerCase() ?? x.how}, {formatDateTime(x.at)}
            {x.readBack ? ' – read back' : ''} · noted by {x.byName}
          </li>
        ))}
        {c.notReached.map((x, i) => (
          <li key={`n-${i}`}>
            Nobody reached – tried {x.triedName}, {formatDateTime(x.at)} · {x.byName}
          </li>
        ))}
        {c.acknowledged && (
          <li>
            <CircleCheck aria-hidden="true" /> Acknowledged by {c.acknowledged.byName}, {formatDateTime(c.acknowledged.at)}
          </li>
        )}
      </ul>
      {order.access.canAcknowledge && (
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={acknowledge}>
            <CircleCheck aria-hidden="true" /> {busy ? 'Saving…' : 'Acknowledge'}
          </button>
        </div>
      )}
      {order.access.canCallCritical &&
        (noting ? (
          <form onSubmit={noteCall} noValidate>
            <Alert type="error">{error}</Alert>
            <CallFields id="lab-call-later" value={call} onChange={setCall} errors={fields} />
            <div className="row">
              <button type="submit" className="btn btn-secondary" disabled={busy}>
                {busy ? 'Saving…' : 'Note the call'}
              </button>
              <button type="button" className="btn btn-link" onClick={() => setNoting(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="row">
            <button type="button" className={`btn ${c.open ? 'btn-secondary' : 'btn-link'}`} onClick={() => setNoting(true)}>
              <Phone aria-hidden="true" /> {c.open ? 'Note the call' : 'Note another call'}
            </button>
          </div>
        ))}
    </section>
  );
}

/** P6: the values far from her last result, before the report. values: the server's DELTA_CHECK details. */
export function DeltaQuestion({ values, busy, onConfirm, onChange }) {
  return (
    <Alert type="warning">
      <div className="lab-delta-question">
        <p>
          <strong>Far from her last result.</strong> Check the sample and the number before reporting.
        </p>
        <ul>
          {values.map((v) => (
            <li key={`${v.testKey}.${v.valueKey}`}>
              {v.name} {v.value}
              {v.unit ? ` ${v.unit}` : ''}; it was {v.previous}
              {v.previousAt ? ` on ${formatDate(v.previousAt)}` : ''}.
            </li>
          ))}
        </ul>
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={onChange}>
            Change
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'Saving…' : 'Confirm and report'}
          </button>
        </div>
      </div>
    </Alert>
  );
}

/** Today (the doctor's list of results to review): Acknowledge a critical result in one click. */
export function AcknowledgeButton({ order, onDone, onError }) {
  const [busy, setBusy] = useState(false);
  if (!order.access?.canAcknowledge) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/lab/orders/${order.id}/acknowledge`, { method: 'POST', body: { rev: order.rev } });
          onDone();
        } catch (err) {
          onError(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <CircleCheck aria-hidden="true" /> {busy ? 'Saving…' : 'Acknowledge'}
    </button>
  );
}
