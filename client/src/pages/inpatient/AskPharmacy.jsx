import { useState } from 'react';
import { CircleAlert, CircleCheck, CircleMinus, Clock, Pill, Plus, Siren, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field, StatusPill, formatDateTime, useDebounced } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';

// PH12 (docs/PHARMACY_BUILD_NOTE.md): the ward asks the pharmacy on screen, on her stay page. Nurses, her doctor and
// RMOs ask (server/src/routes/wardRequests.js); they see what doctors see while prescribing – in stock, low, not in
// stock – never a quantity or a price. The pharmacist answers in Pharmacy → Ward requests. The paper slip still works.

const STOCK = { in: ['stable', CircleCheck, 'In stock'], low: ['watch', CircleAlert, 'Low'], out: ['high', CircleMinus, 'Not in stock'] };
export const REQUEST_LOOK = {
  requested: ['due', Clock, 'Asked'],
  part_issued: ['watch', CircleAlert, 'Part given'],
  issued: ['stable', CircleCheck, 'Given'],
  refused: ['high', CircleMinus, 'Not given'],
  cancelled: ['inactive', CircleMinus, 'Cancelled'],
};
export function RequestStatus({ status }) {
  const [tone, Icon, word] = REQUEST_LOOK[status] ?? REQUEST_LOOK.requested;
  return (
    <StatusPill tone={tone} icon={Icon}>
      {word}
    </StatusPill>
  );
}
export const lineWords = (l) => `${l.name} × ${l.qty}${l.issuedQty ? ` – given ${l.issuedQty}` : ''}${l.refused ? ` – not given: ${l.refused.reason}` : ''}`;

export function AskPharmacy({ patient }) {
  const res = useFetch(`/patients/${patient.id}/ward-requests`);
  const [asking, setAsking] = useState(false);
  const [lines, setLines] = useState([]); // { medicine, qty }
  const [urgent, setUrgent] = useState(false);
  const [note, setNote] = useState('');
  const [orderedById, setOrderedById] = useState('');
  const [text, setText] = useState('');
  const term = useDebounced(text.trim(), 250);
  const found = useFetch(asking && term.length >= 2 ? `/patients/${patient.id}/ward-requests/medicines` : null, { q: term });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const d = res.data;
  if (res.error || !d) return null; // not someone who charts for her
  const doctorChosen = orderedById || d.me || '';

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api(`/patients/${patient.id}/ward-requests`, { method: 'POST', body: { lines: lines.map((l) => ({ medicineId: l.medicine.id, qty: Number.parseInt(l.qty, 10) || 0 })), urgent, note, ...(doctorChosen ? { orderedById: doctorChosen } : {}) } });
      setFlash(`${out.request.number} is sent to the pharmacy.`);
      setAsking(false);
      setLines([]);
      setUrgent(false);
      setNote('');
      res.reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const [cancelling, setCancelling] = useState(null); // { id, reason }
  const cancel = async () => {
    try {
      await api(`/patients/${patient.id}/ward-requests/${cancelling.id}/cancel`, { method: 'POST', body: { reason: cancelling.reason } });
      setCancelling(null);
      res.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card" aria-labelledby="ip-askph-title">
      <h2 id="ip-askph-title">
        <Pill aria-hidden="true" className="ip-askph-icon" /> Pharmacy requests
      </h2>
      <Alert type="success" onClose={() => setFlash(null)}>
        {flash}
      </Alert>
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      {d.admitted && !asking && (
        <button type="button" className="btn btn-secondary" onClick={() => setAsking(true)}>
          <Plus aria-hidden="true" /> Ask the pharmacy
        </button>
      )}
      {asking && (
        <div className="ip-askph-form">
          <Field label="Find a medicine or item" id="askph-find" keepHint hint="Shows in stock, low or not in stock – as doctors see it while prescribing.">
            <input id="askph-find" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type at least 2 letters" />
          </Field>
          <ul className="plain-list">
            {(found.data?.medicines ?? []).slice(0, 8).map((m) => {
              const [tone, Icon, word] = STOCK[m.stock] ?? STOCK.out;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className="btn btn-link btn-sm"
                    onClick={() => {
                      setLines((ls) => (ls.some((l) => l.medicine.id === m.id) ? ls : [...ls, { medicine: m, qty: '1' }]));
                      setText('');
                    }}
                  >
                    <Plus aria-hidden="true" /> {[m.name, m.strength].filter(Boolean).join(' ')}
                  </button>{' '}
                  <StatusPill tone={tone} icon={Icon}>
                    {word}
                  </StatusPill>
                </li>
              );
            })}
          </ul>
          {lines.length > 0 && (
            <ul className="plain-list">
              {lines.map((l, i) => (
                <li key={l.medicine.id} className="kit-line">
                  <span>{[l.medicine.name, l.medicine.strength].filter(Boolean).join(' ')}</span>
                  <label className="sr-only" htmlFor={`askph-qty-${i}`}>
                    Quantity of {l.medicine.name}
                  </label>
                  <input id={`askph-qty-${i}`} className="kit-qty" inputMode="numeric" value={l.qty} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
                  <span className="muted">{l.medicine.unit}</span>
                  <button type="button" className="icon-btn" aria-label={`Take ${l.medicine.name} out`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="form-grid">
            <Field label="Ordered by" id="askph-doctor">
              <select id="askph-doctor" value={doctorChosen} onChange={(e) => setOrderedById(e.target.value)}>
                <option value="">Choose the doctor…</option>
                {d.doctors.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note (optional)" id="askph-note">
              <input id="askph-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <label className="appt-reason">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
          </label>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy || !lines.length || !doctorChosen} onClick={send}>
              Send to the pharmacy
            </button>
            <button type="button" className="btn btn-link" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {d.requests.length === 0 ? (
        !asking && <p className="muted">No requests yet.</p>
      ) : (
        <ul className="plain-list">
          {d.requests.slice(0, 10).map((r) => (
            <li key={r.id} className="mm-row">
              <strong>{r.number}</strong> <RequestStatus status={r.status} />{' '}
              {r.urgent && (
                <StatusPill tone="high" icon={Siren}>
                  Urgent
                </StatusPill>
              )}
              <p className="hint">
                {formatDateTime(r.requested.at)} · asked by {r.requested.byName} · ordered by {r.orderedBy.name}
                {r.note ? ` · ${r.note}` : ''}
              </p>
              <ul className="plain-list">
                {r.lines.map((l) => (
                  <li key={l.medicineId}>{lineWords(l)}</li>
                ))}
              </ul>
              {r.status === 'requested' &&
                (cancelling?.id === r.id ? (
                  <div className="row">
                    <Field label="Why is it cancelled?" id={`askph-why-${r.id}`}>
                      <input id={`askph-why-${r.id}`} value={cancelling.reason} maxLength={200} onChange={(e) => setCancelling({ ...cancelling, reason: e.target.value })} />
                    </Field>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={cancelling.reason.trim().length < 3} onClick={cancel}>
                      Cancel the request
                    </button>
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setCancelling(null)}>
                      Keep it
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-link btn-sm" onClick={() => setCancelling({ id: r.id, reason: '' })}>
                    Cancel the request
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
