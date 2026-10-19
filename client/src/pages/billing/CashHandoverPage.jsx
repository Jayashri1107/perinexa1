import { useState } from 'react';
import { CircleCheck, Clock, HandCoins, TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { MODE_LABELS, billingTabs, rupees, toInput, toPaise } from './billingFormat.js';

// The daily cash handover (owner, 17 Oct 2026 – docs/WHATSAPP_DESK_PLAN.md; like Docterz's "Hisaab Kitaab"): whoever
// took payments sees what Perinexa counted from their own payments and hands over the cash; a doctor or the hospital
// admin confirms what they received. A difference needs a note and is always shown. Amounts only – no patient.

const signed = (paise) => (paise === 0 ? 'no difference' : `${paise > 0 ? 'more' : 'less'} by ${rupees(Math.abs(paise))}`);

function HandoverStatus({ h }) {
  if (h.received) {
    const diff = h.received.differencePaise;
    return diff === 0 ? (
      <StatusPill tone="stable" icon={CircleCheck}>
        Confirmed
      </StatusPill>
    ) : (
      <StatusPill tone="high" icon={TriangleAlert}>
        Confirmed – {signed(diff)}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="due" icon={Clock}>
      Waiting for confirmation
    </StatusPill>
  );
}

function HandOverForm({ data, onSaved }) {
  const mine = data.mine;
  const [amount, setAmount] = useState(toInput(mine.handover?.handedPaise ?? mine.cashPaise) || '0');
  const [note, setNote] = useState(mine.handover?.note ?? '');
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const paise = toPaise(amount);
  const save = async (e) => {
    e.preventDefault();
    if (paise == null) return setFields({ handedPaise: 'Enter the amount in rupees.' });
    if (paise !== mine.cashPaise && note.trim().length < 3) return setFields({ note: 'Write why the cash is different.' });
    setSaving(true);
    setError(null);
    setFields({});
    try {
      await api('/cash-handover', { method: 'POST', body: { date: data.date, handedPaise: paise, note: note.trim() } });
      onSaved('Handed over. A doctor or the hospital admin confirms it.');
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setSaving(false);
    }
    return undefined;
  };
  const locked = Boolean(mine.handover?.received);
  return (
    <form className="card" onSubmit={save} noValidate aria-labelledby="ch-mine">
      <h2 id="ch-mine">Your collection</h2>
      <dl className="lab-counts">
        <div>
          <dt>Cash (Perinexa's count)</dt>
          <dd className="tabular">{rupees(mine.cashPaise)}</dd>
        </div>
        {data.modes
          .filter((m) => m.mode !== 'cash')
          .map((m) => (
            <div key={m.mode}>
              <dt>{m.label}</dt>
              <dd className="tabular">{rupees(mine.byMode[m.mode] ?? 0)}</dd>
            </div>
          ))}
        <div>
          <dt>Payments and refunds</dt>
          <dd className="tabular">{mine.payments}</dd>
        </div>
      </dl>
      <p className="hint">Only cash is handed over. UPI, card and insurance go to the bank and are listed for checking.</p>
      {mine.handover && (
        <p>
          <HandoverStatus h={mine.handover} /> Handed over {rupees(mine.handover.handedPaise)}, {formatDateTime(mine.handover.handed.at)}
          {mine.handover.received ? ` · ${mine.handover.received.byName} received ${rupees(mine.handover.received.receivedPaise)}` : ''}
        </p>
      )}
      {!locked && (
        <>
          <Alert type="error">{error}</Alert>
          <div className="form-grid">
            <Field label="Cash you hand over (₹)" id="ch-amount" error={fields.handedPaise}>
              <input id="ch-amount" className="tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={paise != null && paise !== mine.cashPaise ? 'Why is it different?' : 'Note (optional)'} id="ch-note" error={fields.note}>
              <input id="ch-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {paise != null && paise !== mine.cashPaise && <p className="hint">This is {signed(paise - mine.cashPaise)} than Perinexa's count.</p>}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <HandCoins aria-hidden="true" /> {saving ? 'Saving…' : mine.handover ? 'Hand over again' : 'Hand over the cash'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function ConfirmRow({ h, me, onSaved }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(toInput(h.handedPaise) || '0');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const paise = toPaise(amount);
  const confirm = async (e) => {
    e.preventDefault();
    if (paise == null) return setError('Enter the amount in rupees.');
    if (paise !== h.handedPaise && note.trim().length < 3) return setError('Write why it is different.');
    setSaving(true);
    try {
      await api(`/cash-handover/${h.id}/confirm`, { method: 'POST', body: { receivedPaise: paise, note: note.trim() } });
      onSaved(`Confirmed: ${rupees(paise)} received from ${h.userName}.`);
    } catch (err) {
      setError(err.fields?.note ?? err.message);
      setSaving(false);
    }
    return undefined;
  };
  return (
    <li>
      <div className="wl-row-head">
        <span className="wl-who">
          <strong>{h.userName}</strong>
          <span className="muted tabular">
            Perinexa's count {rupees(h.cashPaise)} · handed over {rupees(h.handedPaise)}
            {h.differencePaise ? ` (${signed(h.differencePaise)})` : ''} · {formatDateTime(h.handed.at)}
          </span>
        </span>
        <span className="wl-counts">
          <HandoverStatus h={h} />
        </span>
      </div>
      {h.note && <span className="hint">Note: {h.note}</span>}
      {/* A payment corrected after the handover was confirmed (owner, 19 Oct 2026): shown, the handover itself kept */}
      {h.correctedAfter?.map((c, i) => (
        <span key={i} className="hint">
          Corrected after it was confirmed: receipt {c.receipt} {rupees(c.beforePaise)} {MODE_LABELS[c.beforeMode] ?? c.beforeMode} → {rupees(c.afterPaise)} {MODE_LABELS[c.afterMode] ?? c.afterMode} ({c.byName}, {formatDateTime(c.at)})
        </span>
      ))}
      {h.received && (
        <span className="hint">
          {h.received.byName} received {rupees(h.received.receivedPaise)}, {formatDateTime(h.received.at)}
          {h.received.note ? ` – ${h.received.note}` : ''}
        </span>
      )}
      {!h.received && h.userId !== me && !open && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
          Count and confirm
        </button>
      )}
      {open && (
        <form className="ch-confirm" onSubmit={confirm} noValidate>
          <Alert type="error">{error}</Alert>
          <div className="form-grid">
            <Field label="Cash you received (₹)" id={`ch-r-${h.id}`}>
              <input id={`ch-r-${h.id}`} className="tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </Field>
            <Field label={paise != null && paise !== h.handedPaise ? 'Why is it different?' : 'Note (optional)'} id={`ch-n-${h.id}`}>
              <input id={`ch-n-${h.id}`} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-secondary" disabled={saving}>
              <CircleCheck aria-hidden="true" /> {saving ? 'Saving…' : 'Confirm received'}
            </button>
            <button type="button" className="btn btn-link" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function CashHandoverPage() {
  const { activeMembership, user } = useAuth();
  const roles = activeMembership?.roles ?? [];
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? '';
  const { data, error, reload } = useFetch('/cash-handover', date ? { date } : {});
  const [notice, setNotice] = useState(null);
  const saved = (message) => {
    setNotice(message);
    reload();
  };
  const isBilling = roles.some((r) => ['receptionist', 'billing', 'admin'].includes(r));
  return (
    <>
      <PageHeader
        title="Cash handover"
        documentTitle="Cash handover"
        subtitle={data ? dayLabel(data.date) : undefined}
        tabs={isBilling ? billingTabs(roles) : undefined}
        help="At the end of the day: hand over the cash you took; a doctor or the hospital admin counts it and confirms."
      />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
        <label className="lab-filter" htmlFor="ch-date">
          <span>Day</span>
          <input id="ch-date" type="date" value={data?.date ?? date} max={data?.today} onChange={(e) => setParams(e.target.value ? { date: e.target.value } : {}, { replace: true })} />
        </label>
        {!data && !error && <p className="muted">Loading…</p>}
        {data?.mine && data.canHandOver && <HandOverForm key={`${data.date}-${data.mine.handover?.handed?.at ?? ''}`} data={data} onSaved={saved} />}
        {data?.canConfirm && (
          <section className="card" aria-labelledby="ch-all">
            <h2 id="ch-all">Handed over on this day</h2>
            {data.handovers.length === 0 ? (
              <p className="muted">Nothing handed over yet.</p>
            ) : (
              <ul className="wl-list">
                {data.handovers.map((h) => (
                  <ConfirmRow key={h.id} h={h} me={user?.id} onSaved={saved} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}
