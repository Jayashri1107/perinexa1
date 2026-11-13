import { BedDouble, CalendarClock, PackageCheck, PackagePlus, PackageSearch, PackageX, Pill, Receipt, ShoppingCart, Siren, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../../components/DataTable.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { money } from './pharmacyUi.jsx';

/**
 * The pharmacist's Today (owner, 13 Oct 2026; made compact 26 Oct 2026: "not too much space"): the pharmacy's numbers
 * from what it already keeps – sold and issued today, patients in the wards, low stock, batches expiring soon,
 * expired batches still on the shelf, orders waiting for delivery – as one row of small cards, each opening its
 * list (what it means shows on pointing at it).
 */
export function PharmacyToday() {
  const invoices = useFetch('/pharmacy/invoices');
  const alerts = useFetch('/pharmacy/reports/alerts');
  const wards = useFetch('/pharmacy/inpatients');
  const orders = useFetch('/pharmacy/orders');
  const asked = useFetch('/pharmacy/ward-requests', { open: '1' }); // PH12

  const today = invoices.data?.invoices ?? [];
  const sold = today.filter((i) => i.kind !== 'issue');
  const issued = today.filter((i) => i.kind === 'issue');
  const sum = (list) => list.reduce((s, i) => s + (i.netPaise ?? 0), 0);
  const a = alerts.data;
  const expired = a ? a.expiring.filter((b) => b.expired) : [];
  const soon = a ? a.expiring.filter((b) => !b.expired) : [];
  const waiting = (orders.data?.orders ?? []).filter((o) => o.status === 'sent' || o.status === 'part_received');
  const error = invoices.error || alerts.error || wards.error || orders.error;
  const plural = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`;
  const count = (ready, n) => (ready ? formatNumber(n) : '—');

  const stats = [
    { to: '/pharmacy/invoices', icon: ShoppingCart, label: 'Sold today', value: invoices.data ? money(sum(sold)) : '—', why: invoices.data ? plural(sold.length, 'invoice', 'invoices') : '' },
    { to: '/pharmacy/invoices', icon: Pill, label: 'Issued to wards', value: count(invoices.data, issued.length), why: issued.length ? `${money(sum(issued))} on the patients' bills` : 'Nothing issued yet today' },
    { to: '/pharmacy/issue', icon: BedDouble, tone: wards.data?.inpatients.length ? 'due' : null, label: 'In the wards', value: count(wards.data, wards.data?.inpatients.length ?? 0), why: 'Admitted now – issue their medicines' },
    { to: '/pharmacy/reports', icon: PackageSearch, tone: a?.low.length ? 'watch' : null, label: 'Low stock', value: count(a, a?.low.length ?? 0), why: a?.low.length ? 'At or below the reorder level' : 'Every medicine above its reorder level' },
    { to: '/pharmacy/reports', icon: CalendarClock, tone: soon.length ? 'watch' : null, label: 'Expiring soon', value: count(a, soon.length), why: a ? `Batches expiring within ${a.days} days` : '' },
    { to: '/pharmacy/reports', icon: PackageX, tone: expired.length ? 'high' : null, label: 'Expired', value: count(a, expired.length), why: expired.length ? 'Take off the shelf and write off – never sold' : 'No expired batch in stock' },
    { to: '/pharmacy/orders', icon: Truck, tone: waiting.length ? 'due' : null, label: 'Orders due', value: count(orders.data, waiting.length), why: waiting.length ? 'Sent or part received, awaiting delivery' : 'No order waiting for delivery' },
  ];

  return (
    <>
      {error && <Alert type="error">{error}</Alert>}
      {/* PH12: the wards' open requests, urgent ones named */}
      {asked.data?.requests.length > 0 && (
        <Alert type={asked.data.requests.some((r) => r.urgent) ? 'warning' : 'info'} icon={Siren}>
          {plural(asked.data.requests.length, 'ward request is', 'ward requests are')} open
          {asked.data.requests.some((r) => r.urgent) ? `, ${asked.data.requests.filter((r) => r.urgent).length} urgent` : ''}. <Link to="/pharmacy/ward-requests">Open the ward requests</Link>
        </Alert>
      )}
      <nav className="ph-stats ph-today-stats" aria-label="Pharmacy at a glance">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className={`ph-stat${s.tone ? ` is-${s.tone}` : ''}`} title={s.why}>
            <span className="ph-stat-icon" aria-hidden="true">
              <s.icon />
            </span>
            <span className="ph-stat-text">
              <strong className="tabular">{s.value}</strong>
              <span>{s.label}</span>
              {s.why && <small className="ph-stat-why">{s.why}</small>}
            </span>
          </Link>
        ))}
      </nav>
    </>
  );
}

/** The pharmacist's quick actions, beside the search for someone from another day. */
export function PharmacyActions() {
  return (
    <nav className="ph-actions" aria-label="Pharmacy quick actions">
      <Link to="/pharmacy" className="btn btn-secondary btn-sm">
        <Receipt aria-hidden="true" /> Sell at the counter
      </Link>
      <Link to="/pharmacy/issue" className="btn btn-secondary btn-sm">
        <BedDouble aria-hidden="true" /> Issue to ward
      </Link>
      <Link to="/pharmacy/purchases/new" className="btn btn-secondary btn-sm">
        <PackagePlus aria-hidden="true" /> Receive a delivery
      </Link>
      <Link to="/pharmacy/stock" className="btn btn-secondary btn-sm">
        <PackageCheck aria-hidden="true" /> Stock
      </Link>
    </nav>
  );
}
