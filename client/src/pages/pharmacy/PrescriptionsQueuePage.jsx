// The pharmacy's Prescriptions tab (owner, 8 Oct 2026): what doctors sent with "Send to pharmacy", oldest first, and
// what was given today. "Sell at the counter" opens the counter with her and these medicines filled in; the sale then
// takes the prescription off the list. "Mark as given" is for one given another way (for example on the ward).
// Three tabs (owner, 9 Oct 2026): Waiting, Given today, and All given – every earlier prescription, found by the
// patient's name or number and by date, a page at a time.
import { CircleCheck, Clock, Eye, History, Search, ShoppingCart } from 'lucide-react';
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

// Every prescription given, newest first.
function AllGiven({ onBill }) {
  const [query, setQuery] = useState({ search: '', from: '', to: '', page: 1 });
  const [text, setText] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const q = { page: query.page, limit: 20, ...(query.search && { search: query.search }), ...(query.from && { from: query.from }), ...(query.to && { to: query.to }) };
    pharmacyPrescriptionsApi.history(q).then(setData).catch((err) => setError(err.message));
  }, [query]);
  // search as she types, a moment after the last key
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.search === text.trim() ? q : { ...q, search: text.trim(), page: 1 })), 350);
    return () => clearTimeout(t);
  }, [text]);
  const set = (k, v) => setQuery((q) => ({ ...q, [k]: v, page: 1 }));
  return (
    <section className="card">
      <div className="rxq-filters">
        <label className="svc-search"><Search size={16} aria-hidden /><input aria-label="Find by patient name or number" placeholder="Patient name or number" value={text} onChange={(e) => setText(e.target.value)} /></label>
        <label className="filter">From <input type="date" value={query.from} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="filter">To <input type="date" value={query.to} onChange={(e) => set('to', e.target.value)} /></label>
        {(query.from || query.to || query.search) && <button type="button" className="btn btn-link btn-sm" onClick={() => { setText(''); setQuery({ search: '', from: '', to: '', page: 1 }); }}>Clear</button>}
      </div>
      <Alert type="error">{error}</Alert>
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.items.length === 0 && <p className="muted">No prescriptions given{query.search || query.from || query.to ? ' match this search' : ' yet'}.</p>}
      {data && data.items.length > 0 && (
        <>
          <ul className="plain-list rxq-done">
            {data.items.map((rx) => (
              <li key={rx.visitId}>
                <Who rx={rx} />
                <span className="rxq-meds small">{rx.items.map((i) => i.drug ?? i.name).filter(Boolean).join(', ')}</span>
                <span className="rxq-when">
                  <StateBadge look={GIVEN} small />
                  <span className="muted small">{rx.givenByName}, {formatDateTime(rx.givenAt)}{rx.invoiceNumber ? ` · ${rx.invoiceNumber}` : ''}</span>
                </span>
                {rx.billId && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onBill(rx.billId)}><Eye size={14} aria-hidden /> View bill</button>}
              </li>
            ))}
          </ul>
          <div className="rxq-pages">
            <span className="muted small">{data.total} prescription{data.total === 1 ? '' : 's'} · page {data.page} of {data.pages}</span>
            <span className="row-actions">
              <button type="button" className="btn btn-ghost btn-sm" disabled={data.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}>Newer</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={data.page >= data.pages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}>Older</button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

export function PrescriptionsQueuePage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [billOf, setBillOf] = useState(null); // the bill shown in the pop-up
  const [tab, setTab] = useState('waiting');

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
        <div className="care-tabs lab-tabs" role="tablist" aria-label="Prescriptions">
          {[
            ['waiting', 'Waiting', Clock, data.waiting.length],
            ['today', 'Given today', CircleCheck, data.givenToday.length],
            ['all', 'All given', History, null],
          ].map(([key, label, Icon, n]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
              <Icon size={15} aria-hidden /> {label}{n != null && <span className={`rxq-count${key === 'today' ? ' rxq-count-done' : ''}`}>{n}</span>}
            </button>
          ))}
        </div>
      )}
      {data && tab === 'all' && <AllGiven onBill={setBillOf} />}
      {data && tab === 'waiting' && (
        <>
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
        </>
      )}
      {data && tab === 'today' && (
        <>
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
