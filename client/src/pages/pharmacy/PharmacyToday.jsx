// Today for pharmacists (owner, 9 Oct 2026): the pharmacy's day at a glance – prescriptions waiting and given, sales,
// stock running low and batches expiring – with quick actions; then the waiting prescriptions (oldest first, each with
// Give prescription) beside those given today; then stock alerts. Rows of equal height, so no empty gaps.
import { ArrowRight, CalendarX, CircleCheck, ClipboardList, Clock, Hourglass, IndianRupee, PackageMinus, PackagePlus, Pill, ShoppingCart, Truck, Warehouse } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pharmacyPrescriptionsApi, pharmacyReportsApi, stockApi, todayApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { CountUp } from '../../components/CountUp.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatDateTime, formatMoney, timeAgo } from '../../utils/format.js';

function Tile({ icon: Icon, label, value, hint, tone, to }) {
  return (
    <Link to={to} className={`nt-tile tone-${tone}`}>
      <span className="nt-tile-icon"><Icon size={18} aria-hidden /></span>
      <span className="nt-tile-value"><CountUp value={value} /></span>
      <span className="nt-tile-label">{label}</span>
      {hint && <span className="nt-tile-hint">{hint}</span>}
    </Link>
  );
}

const QUICK = [
  { to: '/hospital/pharmacy', icon: ShoppingCart, label: 'Sell at the counter', hint: 'A new sale' },
  { to: '/hospital/pharmacy/prescriptions', icon: ClipboardList, label: 'Prescriptions', hint: 'Waiting, today and all given' },
  { to: '/hospital/pharmacy/ward', icon: Truck, label: 'Issue to ward', hint: 'Medicines for a patient in hospital' },
  { to: '/hospital/pharmacy/stock', icon: Warehouse, label: 'Stock', hint: 'What is on the shelves' },
  { to: '/hospital/pharmacy/purchases/new', icon: PackagePlus, label: 'New purchase', hint: 'Stock from a supplier' },
  { to: '/hospital/pharmacy/expiring', icon: CalendarX, label: 'Expiring', hint: 'Batches to sell first or return' },
];
const WAITING = { tone: 'pending', icon: Clock, word: 'Waiting' };
const GIVEN = { tone: 'active', icon: CircleCheck, word: 'Given' };

export function PharmacyToday() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [today, setToday] = useState(null);
  const [rx, setRx] = useState(null);
  const [low, setLow] = useState(null);
  const [expiry, setExpiry] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    todayApi.get().then(setToday).catch((err) => setError(err.message));
    pharmacyPrescriptionsApi.queue().then(setRx).catch((err) => setError(err.message));
    stockApi.list({ lowStock: 'true', limit: 8, page: 1 }).then((r) => setLow(r.items ?? [])).catch(() => setLow([]));
    pharmacyReportsApi.expiry().then(setExpiry).catch(() => setExpiry({ expired: [], expiringSoon: [], alertDays: 0 }));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !today) return <Alert type="error">{error}</Alert>;
  if (!today || !rx) return <Loader />;
  const p = today.pharmacy ?? {};
  const firstName = user.name.split(' ')[0];
  const dateText = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const batches = [...(expiry?.expired ?? []), ...(expiry?.expiringSoon ?? [])].slice(0, 8);

  return (
    <div className="nurse-today">
      <section className="card nt-hero">
        <div>
          <p className="muted small nt-date">{dateText} · Pharmacy</p>
          <h1>Good to see you, {firstName}</h1>
          <p className="muted">{rx.waiting.length} prescription{rx.waiting.length === 1 ? '' : 's'} waiting · {p.salesToday ?? 0} sale{p.salesToday === 1 ? '' : 's'} today</p>
        </div>
        <div className="nt-hero-actions">
          <Link to="/hospital/pharmacy" className="btn btn-primary"><ShoppingCart size={16} aria-hidden /> Sell at the counter</Link>
          <Link to="/hospital/pharmacy/prescriptions" className="btn btn-ghost"><ClipboardList size={16} aria-hidden /> Prescriptions</Link>
        </div>
      </section>

      <div className="nt-tiles">
        <Tile icon={Hourglass} label="Prescriptions waiting" value={rx.waiting.length} hint="Sent by the doctors" tone={rx.waiting.length ? 'amber' : 'grey'} to="/hospital/pharmacy/prescriptions" />
        <Tile icon={CircleCheck} label="Given today" value={rx.givenToday.length} hint="Prescriptions" tone="teal" to="/hospital/pharmacy/prescriptions" />
        <Tile icon={IndianRupee} label="Sales today" value={formatMoney(p.soldToday ?? 0)} hint={`${p.salesToday ?? 0} sale${p.salesToday === 1 ? '' : 's'}`} tone="blue" to="/hospital/pharmacy/sales" />
        <Tile icon={PackageMinus} label="Low stock" value={p.lowStock ?? 0} hint="At or below reorder level" tone={p.lowStock ? 'danger' : 'grey'} to="/hospital/pharmacy/stock" />
        <Tile icon={CalendarX} label="Expiring soon" value={p.expiringSoon ?? 0} hint={`Batches, next ${p.expiryAlertDays ?? expiry?.alertDays ?? ''} days`} tone={p.expiringSoon ? 'amber' : 'grey'} to="/hospital/pharmacy/expiring" />
        <Tile icon={CalendarX} label="Expired in stock" value={p.expired ?? 0} hint="Write off or return" tone={p.expired ? 'danger' : 'grey'} to="/hospital/pharmacy/expiring" />
      </div>

      <nav className="lab-quick lab-quick-row pharm-quick" aria-label="Quick actions">
        {QUICK.map(({ to, icon: Icon, label, hint }) => (
          <Link key={to} to={to} className="lab-quick-item">
            <span className="nt-tile-icon"><Icon size={18} aria-hidden /></span>
            <span><strong className="block">{label}</strong><span className="muted small">{hint}</span></span>
          </Link>
        ))}
      </nav>

      <div className="desk-row desk-even">
        <section className="card desk-card">
          <div className="card-head">
            <h2><Hourglass size={18} aria-hidden /> Waiting <span className="muted small">{rx.waiting.length}</span></h2>
            <Link to="/hospital/pharmacy/prescriptions" className="small">All prescriptions <ArrowRight size={12} aria-hidden /></Link>
          </div>
          {rx.waiting.length === 0 ? (
            <p className="muted desk-empty">No prescriptions waiting. When a doctor sends one, it appears here.</p>
          ) : (
            <ul className="plain-list rows desk-scroll">
              {rx.waiting.map((r) => (
                <li key={r.visitId}>
                  <span>
                    <strong>{r.patient.name}</strong> <span className="muted small">{r.patient.patientNumber}</span>
                    <span className="small block">{r.items.map((i) => i.drug).filter(Boolean).join(', ')}</span>
                    <span className="muted small block">From {r.doctor || r.sentByName} · {timeAgo(r.sentAt)}</span>
                  </span>
                  <span className="row-actions">
                    <StateBadge look={WAITING} small />
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate(`/hospital/dispensing/${r.visitId}`)}><ShoppingCart size={14} aria-hidden /> Give</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card desk-card">
          <div className="card-head">
            <h2><CircleCheck size={18} aria-hidden /> Given today <span className="muted small">{rx.givenToday.length}</span></h2>
            <Link to="/hospital/pharmacy/prescriptions" className="small">Earlier ones <ArrowRight size={12} aria-hidden /></Link>
          </div>
          {rx.givenToday.length === 0 ? (
            <p className="muted desk-empty">Nothing given yet today. Earlier prescriptions are under Prescriptions → All given.</p>
          ) : (
            <ul className="plain-list rows desk-scroll">
              {rx.givenToday.map((r) => (
                <li key={r.visitId}>
                  <span>
                    <strong>{r.patient.name}</strong> <span className="muted small">{r.patient.patientNumber}</span>
                    <span className="muted small block">{r.givenByName}, {formatDateTime(r.givenAt)}{r.invoiceNumber ? ` · ${r.invoiceNumber}` : ''}</span>
                  </span>
                  <StateBadge look={GIVEN} small />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="desk-row desk-even">
        <section className="card desk-card">
          <div className="card-head">
            <h2><PackageMinus size={18} aria-hidden /> Running low</h2>
            <Link to="/hospital/pharmacy/stock" className="small">Stock <ArrowRight size={12} aria-hidden /></Link>
          </div>
          {!low ? <Loader /> : low.length === 0 ? (
            <p className="muted desk-empty">No medicine is below its reorder level.</p>
          ) : (
            <ul className="plain-list rows desk-scroll">
              {low.map((m) => (
                <li key={m.id}>
                  <span><strong>{m.name}</strong>{m.strength && <span className="muted small"> {m.strength}</span>}</span>
                  <span className="danger-text small">{m.available ?? m.qty ?? 0} left{m.reorderLevel != null ? ` · reorder at ${m.reorderLevel}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card desk-card">
          <div className="card-head">
            <h2><CalendarX size={18} aria-hidden /> Expiring and expired</h2>
            <Link to="/hospital/pharmacy/expiring" className="small">Expiring <ArrowRight size={12} aria-hidden /></Link>
          </div>
          {!expiry ? <Loader /> : batches.length === 0 ? (
            <p className="muted desk-empty">No batch expires in the next {expiry.alertDays} days.</p>
          ) : (
            <ul className="plain-list rows desk-scroll">
              {batches.map((b) => (
                <li key={b.id}>
                  <span><strong>{b.medicine?.name}</strong> <span className="muted small">batch {b.batch} · {b.qty} in stock</span></span>
                  <span className={b.expired ? 'danger-text small' : 'small'}>{b.expired ? 'Expired' : `${b.daysLeft} days`} · {formatDate(b.expiry)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="muted small"><Pill size={12} aria-hidden /> Numbers update every minute.</p>
    </div>
  );
}
