// Today for lab staff (owner, 9 Oct 2026): the laboratory's workload – new requests, samples waiting, tests in progress,
// results awaiting the doctor's verification – as tiles that open the matching Lab tab; quick actions; and the pending
// work, urgent first, then oldest. Every number comes from the lab orders.
import { AlertTriangle, ArrowRight, CircleCheck, ClipboardList, FileCheck2, FlaskConical, RotateCcw, TestTube, Truck, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { labApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDateTime } from '../../utils/format.js';
import { stageLook } from './labFormat.js';

function Tile({ icon: Icon, label, value, hint, tone, to }) {
  return (
    <Link to={to} className={`nt-tile tone-${tone}`}>
      <span className="nt-tile-icon"><Icon size={18} aria-hidden /></span>
      <span className="nt-tile-value">{value}</span>
      <span className="nt-tile-label">{label}</span>
      {hint && <span className="nt-tile-hint">{hint}</span>}
    </Link>
  );
}

const QUICK = [
  { to: '/hospital/lab?view=collect', icon: ClipboardList, label: 'New requests', hint: 'Tests the doctors ordered' },
  { to: '/hospital/lab?view=received', icon: TestTube, label: 'Sample tracking', hint: 'Taken, on the way, received' },
  { to: '/hospital/lab?view=processing', icon: FlaskConical, label: 'Tests in progress', hint: 'Enter the results' },
  { to: '/hospital/lab?view=review', icon: FileCheck2, label: 'Lab reports', hint: 'Waiting for verification' },
];

export function LabToday() {
  const { user, activeMembership } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    labApi.dashboard().then((d) => { setData(d); setError(''); }).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const c = data.counts;
  const dateText = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <div className="nurse-today">
      <section className="card nt-hero">
        <div>
          <p className="muted small nt-date">{dateText} · Laboratory</p>
          <h1>Laboratory overview</h1>
          <p className="muted">Today's workload · {activeMembership?.hospital?.name ?? ''} · {user.name}</p>
        </div>
        <div className="nt-hero-actions">
          <Link to="/hospital/lab?view=collect" className="btn btn-primary"><ClipboardList size={16} aria-hidden /> Open the requests</Link>
        </div>
      </section>

      <div className="nt-tiles lab-tiles">
        <Tile icon={ClipboardList} label="New test requests" value={c.requests} hint={c.recollect ? `${c.recollect} need a new sample` : `${c.orderedToday} ordered today`} tone={c.recollect ? 'danger' : 'primary'} to="/hospital/lab?view=collect" />
        <Tile icon={TestTube} label="Samples pending" value={c.samplesPending} hint={c.onTheWay ? `${c.onTheWay} on the way from the ward` : 'Taken, test not started'} tone="amber" to="/hospital/lab?view=received" />
        <Tile icon={FlaskConical} label="Tests in progress" value={c.inProgress} hint="Results to enter" tone="blue" to="/hospital/lab?view=processing" />
        <Tile icon={FileCheck2} label="Awaiting verification" value={c.toVerify} hint={`${c.reportedToday} reported today`} tone="grey" to="/hospital/lab?view=review" />
      </div>

      {c.urgentOpen > 0 && (
        <Alert type="error"><Zap size={14} aria-hidden /> {c.urgentOpen === 1 ? '1 urgent order is still open – it is' : `${c.urgentOpen} urgent orders are still open – they are`} at the top of the list below.</Alert>
      )}

      <div className="nt-grid">
        <section className="card">
          <div className="card-head">
            <h2><AlertTriangle size={18} aria-hidden /> Pending lab work</h2>
            <Link to="/hospital/lab" className="small">View all <ArrowRight size={12} aria-hidden /></Link>
          </div>
          {data.pending.length === 0 ? (
            <p className="muted"><CircleCheck size={14} aria-hidden /> Nothing pending. All requests are done.</p>
          ) : (
            <ul className="plain-list nt-due">
              {data.pending.map((o) => (
                <li key={o.id}>
                  <button type="button" className={`nt-due-row lab-row${o.urgent ? ' overdue' : ''}`} onClick={() => navigate(`/hospital/lab/orders/${o.id}`)}>
                    <span className="nt-due-what">
                      <strong>{o.patient.name}</strong> <span className="muted small">{o.patient.patientNumber} · {o.orderNumber}</span>
                      <span className="small block">{o.tests.join(', ')}{o.sampleTypes.length > 0 && <span className="muted"> · {o.sampleTypes.join(', ')}</span>}</span>
                      <span className="muted small block">Ordered {formatDateTime(o.orderedAt)}{o.sampleNumber && ` · sample ${o.sampleNumber}`}</span>
                    </span>
                    <span className="lab-row-badges">
                      {o.urgent && <StateBadge look={{ tone: 'danger', icon: Zap, word: 'Urgent' }} small />}
                      <StateBadge look={stageLook(o)} small />
                    </span>
                    <ArrowRight size={16} className="muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="stack">
          <section className="card">
            <h2>Quick actions</h2>
            <div className="lab-quick">
              {QUICK.map(({ to, icon: Icon, label, hint }) => (
                <Link key={to} to={to} className="lab-quick-item">
                  <span className="nt-tile-icon"><Icon size={18} aria-hidden /></span>
                  <span><strong className="block">{label}</strong><span className="muted small">{hint}</span></span>
                </Link>
              ))}
            </div>
          </section>
          <section className="card">
            <h2>How an order moves</h2>
            <ol className="lab-flow small">
              <li><ClipboardList size={14} aria-hidden /> A doctor orders the test</li>
              <li><TestTube size={14} aria-hidden /> Sample taken (here or on the ward) and numbered</li>
              <li><Truck size={14} aria-hidden /> Received in the lab, or rejected <RotateCcw size={12} aria-hidden /> for a new sample</li>
              <li><FlaskConical size={14} aria-hidden /> Test started, results entered</li>
              <li><FileCheck2 size={14} aria-hidden /> The doctor verifies – the report is final</li>
            </ol>
            <p className="muted small">The lab does not change what the doctor ordered: ask the doctor instead. Changes to reported results need a reason and keep the earlier results.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
