import { useState } from 'react';
import { CircleCheck, Send, Truck, Undo2 } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { REJECT_REASONS } from './labFormat.js';

// Parts of one lab order for the full lab system (docs/LAB_LIMS_PLAN.md): rejecting a sample, the check before the
// report, and tests sent to an outside lab. Each change answers with the order, passed to onSaved(order, message).

function Dialog({ id, title, children, onSubmit, onCancel }) {
  const ref = useDialogFocus(onCancel);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onSubmit={onSubmit} noValidate>
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </form>
    </div>
  );
}

/** The lab refuses the sample: the order goes back to "Sample to take" and a new sample is needed. */
export function RejectDialog({ order, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!reason) return setFields({ reason: 'Choose why the sample is rejected.' });
    if (reason === 'other' && note.trim().length < 3) return setFields({ note: 'Write what was wrong with the sample.' });
    setSaving(true);
    try {
      const res = await api(`/lab/orders/${order.id}/reject`, { method: 'POST', body: { rev: order.rev, reason, note: note.trim() } });
      onDone(res.order, 'Sample rejected. The order is back under Samples to take – a new sample is needed.');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
    return undefined;
  };
  return (
    <Dialog id="lab-reject" title="Reject this sample?" onSubmit={save} onCancel={onCancel}>
      <p>The order goes back to Samples to take, marked New sample needed. The rejection is kept with your name.</p>
      <Alert type="error">{error}</Alert>
      <Field label="Why" id="lab-reject-reason" error={fields.reason}>
        <select id="lab-reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
          <option value="">Choose…</option>
          {Object.entries(REJECT_REASONS).map(([k, w]) => (
            <option key={k} value={k}>
              {w}
            </option>
          ))}
        </select>
      </Field>
      <Field label={reason === 'other' ? 'What was wrong' : 'Note (optional)'} id="lab-reject-note" error={fields.note}>
        <input id="lab-reject-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="row">
        <button type="submit" className="btn btn-danger" disabled={saving}>
          {saving ? 'Saving…' : 'Reject the sample'}
        </button>
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Keep it
        </button>
      </div>
    </Dialog>
  );
}

/** The check before the report: approve (the results go to the doctor) or send back with a reason. */
export function VerifyCard({ order, onSaved, onError }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true);
    try {
      onSaved((await api(`/lab/orders/${order.id}/verify`, { method: 'POST', body: { rev: order.rev } })).order, 'Checked. The results are reported to the doctor.');
    } catch (err) {
      onError(err);
      setBusy(false);
    }
  };
  const sendBack = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Write what needs to be looked at again.');
    setBusy(true);
    try {
      onSaved((await api(`/lab/orders/${order.id}/send-back`, { method: 'POST', body: { rev: order.rev, reason: reason.trim() } })).order, 'Sent back. The results are under Results to enter again.');
    } catch (err) {
      setError(err.fields?.reason ?? err.message);
      setBusy(false);
    }
    return undefined;
  };
  return (
    <section className="card" aria-labelledby="lab-verify-title">
      <h2 id="lab-verify-title">Check the results</h2>
      <p>
        Entered by {order.entered?.byName}, {formatDateTime(order.entered?.at)}. Check every value against the sample and the machine print-out before
        approving.
      </p>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={approve}>
          <CircleCheck aria-hidden="true" /> {busy && !asking ? 'Saving…' : 'Approve and report'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setAsking(true)}>
          <Undo2 aria-hidden="true" /> Send back
        </button>
      </div>
      {asking && (
        <Dialog id="lab-sendback" title="Send the results back?" onSubmit={sendBack} onCancel={() => setAsking(false)}>
          <p>They go back to Results to enter, with your reason.</p>
          <Field label="What needs to be looked at again" id="lab-sendback-reason" error={error}>
            <input id="lab-sendback-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send back'}
            </button>
            <button type="button" className="btn btn-link" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function SendOutsideDialog({ order, catalogue, onDone, onCancel }) {
  const free = order.tests.map((t, i) => ({ t, i })).filter(({ t }) => !t.outside || t.outside.received);
  const usual = catalogue?.tests?.find((x) => free.some(({ t }) => t.key === x.key) && x.outsideLab)?.outsideLab ?? '';
  const [chosen, setChosen] = useState(() => new Set(free.length === 1 ? [free[0].i] : []));
  const [labName, setLabName] = useState(usual);
  const [ref, setRef] = useState('');
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const toggle = (i) => setChosen((cur) => {
    const next = new Set(cur);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });
  const save = async (e) => {
    e.preventDefault();
    const f = {};
    if (!chosen.size) f.tests = 'Choose the tests sent.';
    if (labName.trim().length < 2) f.labName = 'Write the name of the outside lab.';
    if (Object.keys(f).length) return setFields(f);
    setSaving(true);
    try {
      const res = await api(`/lab/orders/${order.id}/outside`, { method: 'POST', body: { rev: order.rev, tests: [...chosen].sort((a, b) => a - b), labName: labName.trim(), ref: ref.trim() } });
      onDone(res.order, `Recorded as sent to ${labName.trim()}.`);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
    return undefined;
  };
  return (
    <Dialog id="lab-outside" title="Send tests to an outside lab" onSubmit={save} onCancel={onCancel}>
      <Alert type="error">{error}</Alert>
      <fieldset className="fieldset">
        <legend>Tests sent</legend>
        {fields.tests && <p className="field-error">{fields.tests}</p>}
        {free.map(({ t, i }) => (
          <label key={i} className="check">
            <input type="checkbox" checked={chosen.has(i)} onChange={() => toggle(i)} /> {t.name}
          </label>
        ))}
      </fieldset>
      <Field label="Outside lab" id="lab-outside-name" error={fields.labName}>
        <input id="lab-outside-name" maxLength={120} value={labName} onChange={(e) => setLabName(e.target.value)} />
      </Field>
      <Field label="Their reference (optional)" id="lab-outside-ref" error={fields.ref}>
        <input id="lab-outside-ref" maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Send aria-hidden="true" /> {saving ? 'Saving…' : 'Record as sent'}
        </button>
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/** Tests at outside labs: when they were sent and came back. The outside report is attached under Report files. */
export function OutsideSection({ order, catalogue, onSaved, onError }) {
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const outside = order.tests.map((t, i) => ({ t, i })).filter(({ t }) => t.outside);
  const a = order.access;
  if (!outside.length && !a.canSendOutside) return null;
  const receive = async (i) => {
    setBusy(true);
    try {
      onSaved((await api(`/lab/orders/${order.id}/outside/received`, { method: 'POST', body: { rev: order.rev, tests: [i] } })).order, 'Marked as come back. Enter the results and attach the outside report.');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="lab-outside-title">
      <h2 id="lab-outside-title">
        <Truck aria-hidden="true" /> Outside lab
      </h2>
      {outside.length > 0 ? (
        <ul className="plain-list">
          {outside.map(({ t, i }) => (
            <li key={i}>
              <strong>{t.name}</strong> – {t.outside.labName}
              {t.outside.ref ? ` (ref. ${t.outside.ref})` : ''}
              <span className="muted">
                {' '}
                · sent by {t.outside.sent.byName}, {formatDateTime(t.outside.sent.at)}
                {t.outside.received ? ` · came back ${formatDateTime(t.outside.received.at)} (${t.outside.received.byName})` : ' · not back yet'}
              </span>
              {!t.outside.received && a.canReceiveOutside && (
                <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => receive(i)}>
                  Mark as come back
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No test of this order is at an outside lab.</p>
      )}
      {a.canSendOutside && order.tests.some((t) => !t.outside || t.outside.received) && (
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={() => setSending(true)}>
            <Send aria-hidden="true" /> Send tests to an outside lab
          </button>
        </div>
      )}
      {sending && (
        <SendOutsideDialog
          order={order}
          catalogue={catalogue}
          onCancel={() => setSending(false)}
          onDone={(next, message) => {
            setSending(false);
            onSaved(next, message);
          }}
        />
      )}
    </section>
  );
}
