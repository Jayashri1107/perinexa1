import { BedDouble, CalendarClock, PackageCheck, PackagePlus, PackageSearch, PackageX, Pill, Receipt, ShoppingCart, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../../components/DataTable.jsx';
import { Alert, KpiCard } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { money } from './pharmacyUi.jsx';

/**
 * The pharmacist's Today (owner, 13 Oct 2026): number cards from what the pharmacy already keeps – sold and issued
 * today, patients in the wards, low stock, batches expiring soon, expired batches still on the shelf, and orders
 * waiting for delivery – each opening its list, and the day's quick actions.
 */
export function PharmacyToday() {
  const invoices = useFetch('/pharmacy/invoices');
  const alerts = useFetch('/pharmacy/reports/alerts');
  const wards = useFetch('/pharmacy/inpatients');
  const orders = useFetch('/pharmacy/orders');

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

  return (
    <>
      {error && <Alert type="error">{error}</Alert>}
      <section className="td-group" aria-labelledby="pt-glance">
        <h2 className="td-group-title" id="pt-glance">
          Pharmacy at a glance
        </h2>
        <div className="kpi-grid">
          <KpiCard
            to="/pharmacy/invoices"
            icon={ShoppingCart}
            label="Sold today"
            value={invoices.data ? money(sum(sold)) : '—'}
            textValue
            sub={invoices.data ? plural(sold.length, 'invoice', 'invoices') : undefined}
          />
          <KpiCard
            to="/pharmacy/invoices"
            icon={Pill}
            label="Issued to wards today"
            value={invoices.data ? formatNumber(issued.length) : '—'}
            sub={invoices.data ? (issued.length ? `${money(sum(issued))} on the patients' bills` : 'Nothing issued yet') : undefined}
          />
          <KpiCard
            to="/pharmacy/issue"
            tone={wards.data?.inpatients.length ? 'due' : 'neutral'}
            icon={BedDouble}
            label="Patients in the wards"
            value={wards.data ? formatNumber(wards.data.inpatients.length) : '—'}
            sub="Admitted now – issue their medicines"
          />
          <KpiCard
            to="/pharmacy/reports"
            tone={a?.low.length ? 'watch' : 'neutral'}
            icon={PackageSearch}
            label="Low stock"
            value={a ? formatNumber(a.low.length) : '—'}
            sub={a ? (a.low.length ? 'At or below the reorder level' : 'Every medicine above its reorder level') : undefined}
          />
          <KpiCard
            to="/pharmacy/reports"
            tone={soon.length ? 'watch' : 'neutral'}
            icon={CalendarClock}
            label="Expiring soon"
            value={a ? formatNumber(soon.length) : '—'}
            sub={a ? `${soon.length === 1 ? 'Batch' : 'Batches'} expiring within ${a.days} days` : undefined}
          />
          <KpiCard
            to="/pharmacy/reports"
            tone={expired.length ? 'high' : 'neutral'}
            icon={PackageX}
            label="Expired stock"
            value={a ? formatNumber(expired.length) : '—'}
            sub={a ? (expired.length ? 'Take off the shelf and write off – never sold' : 'No expired batch in stock') : undefined}
          />
          <KpiCard
            to="/pharmacy/orders"
            tone={waiting.length ? 'due' : 'neutral'}
            icon={Truck}
            label="Orders awaiting delivery"
            value={orders.data ? formatNumber(waiting.length) : '—'}
            sub={orders.data ? (waiting.length ? 'Sent or part received' : 'No order waiting') : undefined}
          />
        </div>
      </section>
      <nav className="td-quick" aria-label="Pharmacy quick actions">
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
    </>
  );
}
