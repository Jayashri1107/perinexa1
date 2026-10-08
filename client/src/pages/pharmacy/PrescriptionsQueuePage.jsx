// The pharmacy's Prescriptions tab (owner, 8 Oct 2026): what doctors sent with "Send to pharmacy", oldest first, and
// what was given today. "Sell at the counter" opens the counter with her and these medicines filled in; the sale then
// takes the prescription off the list. "Mark as given" is for one given another way (for example on the ward).
import { CircleCheck, Clock, Eye, ShoppingCart } from 'lucide-react';
import { BillPopup } from '../dispensing/BillPopup.jsx';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pharmacyPrescriptionsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDateTime, initialsOf, timeAgo } from '../../utils/format.js';
import { rxLine } from '../visits/visitFormat.js';
import { PharmacyFrame } from './PharmacyFrame.jsx';

const EVERY_MS = 30_000;
const WAITING = { tone: 'pending', icon: Clock, word: 'Waiting' };
const GIVEN = { tone: 'active', icon: CircleCheck, word: 'Given' };

function Who({ rx }) {
  return (
    <div className="rxq-who">
      <span className="avatar" aria-hidden>{initialsOf(rx.patient.name)}</span>
      <span>
        <strong>{rx.patient.name}</strong> <span className="muted small">{rx.patient.patientNumber}</span>
        <span className="block muted small">From {rx.doctor || rx.sentByName}</span>
      </span>
    </div>
  );
}

export function PrescriptionsQueuePage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [billOf, setBillOf] = useState(null); // the bill shown in the pop-up

  const load = useCallback(() => {
    pharmacyPrescriptionsApi.queue().then(setData).catch((err) => setError(err.message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), EVERY_MS);
    return () => clearInterval(t);
  }, [load]);

  const given = async (rx) => {
    if (!window.confirm(`Mark ${rx.patient.name}'s prescription as given? It leaves the waiting list. Use "Sell at the counter" when she buys the medicines here.`)) return;
    setBusy(rx.visitId);
    setError('');
    try {
      setData(await pharmacyPrescriptionsApi.markGiven(rx.visitId));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const sell = (rx) => navigate(`/hospital/dispensing/${rx.visitId}`);

  return (
    <PharmacyFrame subtitle="Prescriptions the doctors sent to the pharmacy. The list updates by itself.">
      <Alert type="error">{error}</Alert>
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="section-head">
            <h2>Waiting <span className="rxq-count">{data.waiting.length}</span></h2>
          </div>
          {data.waiting.length === 0 ? (
            <div className="card rxq-empty">
              <p className="muted">No prescriptions waiting. When a doctor clicks “Send to pharmacy” on a visit, it appears here and you get a notification.</p>
            </div>
          ) : (
            <div className="rxq-grid">
              {data.waiting.map((rx) => (
                <article key={rx.visitId} className="card rxq-card">
                  <div className="rxq-head">
                    <Who rx={rx} />
                    <span className="rxq-when">
                      <StateBadge look={WAITING} small />
                      <span className="muted small" title={formatDateTime(rx.sentAt)}>{timeAgo(rx.sentAt)}</span>
                    </span>
                  </div>
                  <ol className="rx-list rxq-items">
                    {rx.items.map((i, n) => <li key={n}>{rxLine(i)}</li>)}
                  </ol>
                  <div className="rxq-actions">
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy === rx.visitId} onClick={() => given(rx)}>Mark as given</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => sell(rx)}><ShoppingCart size={14} aria-hidden /> Give prescription</button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="section-head">
            <h2>Given today <span className="rxq-count rxq-count-done">{data.givenToday.length}</span></h2>
          </div>
          <div className="card">
            {data.givenToday.length === 0 ? (
              <p className="muted">Nothing given yet today.</p>
            ) : (
              <ul className="plain-list rxq-done">
                {data.givenToday.map((rx) => (
                  <li key={rx.visitId}>
                    <Who rx={rx} />
                    <span className="rxq-when">
                      <StateBadge look={GIVEN} small />
                      <span className="muted small">{rx.givenByName}, {formatDateTime(rx.givenAt)}{rx.invoiceNumber ? ` · ${rx.invoiceNumber}` : ''}</span>
                    </span>
                    {rx.billId && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBillOf(rx.billId)}><Eye size={14} aria-hidden /> View bill</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {billOf && <BillPopup billId={billOf} onClose={() => setBillOf(null)} />}
    </PharmacyFrame>
  );
}
