import { useState } from 'react';
import { BedDouble, ChevronLeft, ChevronRight, CircleAlert, Clock, Download, Phone, RotateCcw, Save, Search, Stethoscope, Wallet } from 'lucide-react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api, apiFile } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { Alert, Field, StatusPill } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { billColumns } from './BillsPage.jsx';
import { GROUP_LABELS, billingTabs, rupees, takeMoneyLabel, toInput, toPaise } from './billingFormat.js';
import { Tile } from './billingUi.jsx';
import { FoldCards } from '../../components/FoldCards.jsx';

// Billing reports (docs/BILLING_PLAN.md): unpaid bills (the daily collection is DailyCollectionPage.jsx),
// monthly income with the export for the accountant (hospital admin), and the price list.

function Header({ title, crumb, actions }) {
  const { activeMembership } = useAuth();
  return <PageHeader breadcrumbs={[{ label: 'Billing', to: '/billing' }, { label: crumb ?? title }]} title={title} tabs={billingTabs(activeMembership.roles)} actions={actions} />;
}

// ---------- Unpaid ----------

// The page as the IPD list (11 Nov 2026): number tiles that filter the list – to collect, OPD, IPD, owing over 30
// days, to give back – a search, and one row per bill: the patient, how long it has been owing, the money, her phone,
// and Take payment / Give back.
const UNPAID_VIEWS = {
  owed: { title: 'Still to collect', empty: 'Every bill is paid.' },
  opd: { title: 'OPD bills to collect', empty: 'No OPD bill is unpaid.' },
  ipd: { title: 'IPD bills to collect', empty: 'No IPD bill is unpaid.' },
  old: { title: 'Owing over 30 days', empty: 'No bill has been owing over 30 days.' },
  back: { title: 'Money to give back', empty: 'No money is due back.' },
};

/** "11 Nov 2026" from "2026-11-11". */
const shortDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

/** How long a bill has been owing: colour, icon and words. */
function DaysPill({ days }) {
  if (days >= 30)
    return (
      <StatusPill tone="high" icon={CircleAlert}>
        {days} days
      </StatusPill>
    );
  if (days >= 7)
    return (
      <StatusPill tone="watch" icon={Clock}>
        {days} days
      </StatusPill>
    );
  return (
    <StatusPill tone="neutral" icon={Clock}>
      {days === 0 ? 'Today' : `${days} day${days > 1 ? 's' : ''}`}
    </StatusPill>
  );
}

export function UnpaidPage() {
  const res = useFetch('/billing/reports/unpaid');
  const [view, setView] = useState('owed');
  const [q, setQ] = useState('');
  const bills = res.data?.bills ?? [];
  const owing = bills.filter((b) => b.balance > 0);
  const lists = {
    owed: owing,
    opd: owing.filter((b) => b.kind === 'opd'),
    ipd: owing.filter((b) => b.kind === 'ipd'),
    old: owing.filter((b) => b.days >= 30),
    back: bills.filter((b) => b.balance < 0),
  };
  const sum = (list) => list.reduce((s, b) => s + Math.abs(b.balance), 0);
  const words = q.trim().toLowerCase();
  const rows = lists[view].filter((b) => !words || [b.number, b.patient?.fullName, b.patient?.mrn, b.patient?.phone].some((t) => String(t ?? '').toLowerCase().includes(words)));
  const tile = (key, label, tone, icon) => (
    <Tile label={`${label} · ${lists[key].length}`} value={rupees(sum(lists[key]))} tone={lists[key].length ? tone : 'neutral'} icon={icon} pressed={view === key} onClick={() => setView(key)} />
  );
  return (
    <>
      <Header title="Unpaid bills" crumb="Unpaid" />
      <div className="pf-content ipd-list-page">
        <Alert type="error">{res.error}</Alert>
        <div className="ipd-tiles" aria-label="Unpaid bills by kind">
          {tile('owed', 'Still to collect', 'watch', Wallet)}
          {tile('opd', 'OPD', 'neutral', Stethoscope)}
          {tile('ipd', 'IPD', 'neutral', BedDouble)}
          {tile('old', 'Over 30 days', 'watch', CircleAlert)}
          {tile('back', 'To give back', 'due', RotateCcw)}
        </div>
        <section className="card ipd-list-card" aria-labelledby="unpaid-title">
          <div className="ipd-list-head">
            <h2 id="unpaid-title">{UNPAID_VIEWS[view].title}</h2>
            <div className="ipd-search" role="search">
              <label htmlFor="unpaid-q" className="sr-only">
                Find a bill by name, UHID, phone or bill number
              </label>
              <span className="ipd-search-box">
                <Search aria-hidden="true" />
                <input id="unpaid-q" type="search" placeholder="Name, UHID, phone or bill no." value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} />
              </span>
            </div>
          </div>
          {res.loading && !res.data ? (
            <p className="muted" aria-busy="true">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="muted ipd-empty">{words ? 'No bill matches this search.' : UNPAID_VIEWS[view].empty}</p>
          ) : (
            <div className="table-scroll">
              <table className="bill-report ipd-table unpaid-table">
                <thead>
                  <tr>
                    <th scope="col">Patient</th>
                    <th scope="col">Bill</th>
                    <th scope="col">Owing for</th>
                    <th scope="col">Insurance or scheme</th>
                    <th scope="col" className="num">
                      Total
                    </th>
                    <th scope="col" className="num">
                      Paid
                    </th>
                    <th scope="col" className="num">
                      {view === 'back' ? 'Due back' : 'Balance'}
                    </th>
                    <th scope="col" className="ipd-act-col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td className="ipd-who">
                        <Link className="ipd-name" to={`/billing/bills/${b.id}`}>
                          {b.patient?.fullName ?? '–'}
                        </Link>
                        <span className="ipd-sub tabular">
                          {b.patient?.mrn}
                          {b.patient?.phone && (
                            <>
                              {' · '}
                              <a href={`tel:${b.patient.phone.replace(/\s+/g, '')}`} className="unpaid-phone">
                                <Phone aria-hidden="true" /> {b.patient.phone}
                              </a>
                            </>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className="tabular">{b.number}</span>
                        <span className="ipd-sub">
                          {b.kind === 'ipd' ? (b.stay?.inHospital ? 'IPD, in hospital' : 'IPD') : 'OPD'} · {shortDay(b.date)}
                        </span>
                      </td>
                      <td>
                        <DaysPill days={b.days} />
                      </td>
                      <td className="unpaid-wrap">{b.insurer || <span className="muted">–</span>}</td>
                      <td className="num tabular">{rupees(b.total)}</td>
                      <td className="num tabular">{rupees(b.paid)}</td>
                      <td className="num tabular">
                        <strong>{rupees(Math.abs(b.balance))}</strong>
                      </td>
                      <td className="ipd-act-col">
                        {b.balance > 0 ? (
                          <Link to={`/billing/bills/${b.id}?pay=1`} className="btn btn-secondary btn-sm">
                            <Wallet aria-hidden="true" /> {takeMoneyLabel(b)}
                            <span className="sr-only"> for bill {b.number}</span>
                          </Link>
                        ) : (
                          <Link to={`/billing/bills/${b.id}`} className="btn btn-secondary btn-sm">
                            <RotateCcw aria-hidden="true" /> Give back
                            <span className="sr-only"> for bill {b.number}</span>
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// ---------- Monthly income and the export (hospital admin) ----------

export function MonthlyPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const res = useFetch('/billing/reports/monthly', { year });
  const d = res.data;
  const pad = (n) => String(n).padStart(2, '0');
  const [from, setFrom] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);
  const [to, setTo] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  const [exportError, setExportError] = useState(null);
  const [busy, setBusy] = useState(null);
  const download = async (what) => {
    setBusy(what);
    setExportError(null);
    try {
      const { blob, name } = await apiFile('/billing/export', { query: { from, to, what } });
      downloadFile(blob, name);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const sum = (key) => (d?.months ?? []).reduce((s, m) => s + m[key], 0);
  return (
    <>
      <Header title="Monthly income" crumb="Monthly" />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <div className="card appt-toolbar">
          <div className="appt-daynav" role="group" aria-label="Year">
            <button type="button" className="icon-btn" onClick={() => setYear(year - 1)} aria-label="Previous year">
              <ChevronLeft aria-hidden="true" />
            </button>
            <strong className="tabular">{year}</strong>
            <button type="button" className="icon-btn" onClick={() => setYear(year + 1)} aria-label="Next year">
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <span className="hint">Charged: what was put on bills (after cancellations). Collected: money taken less refunds.</span>
        </div>
        {d && (
          <section className="card bill-section bill-wide">
            <table className="bill-report">
              <caption>Month by month</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  {d.groups.map((g) => (
                    <th key={g.key} scope="col" className="num">
                      {g.label}
                    </th>
                  ))}
                  <th scope="col" className="num">
                    Discounts
                  </th>
                  <th scope="col" className="num">
                    Charged
                  </th>
                  <th scope="col" className="num">
                    Collected
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.months.map((m) => (
                  <tr key={m.month}>
                    <th scope="row">{monthName(m.month)}</th>
                    {d.groups.map((g) => (
                      <td key={g.key} className="num">
                        {m.groups[g.key] ? rupees(m.groups[g.key]) : '–'}
                      </td>
                    ))}
                    <td className="num">{m.discount ? `−${rupees(m.discount)}` : '–'}</td>
                    <td className="num">{rupees(m.charged - m.discount)}</td>
                    <td className="num">{rupees(m.collected)}</td>
                  </tr>
                ))}
                <tr className="bill-report-total">
                  <th scope="row">Year</th>
                  {d.groups.map((g) => (
                    <td key={g.key} className="num">
                      {rupees(d.months.reduce((s, m) => s + m.groups[g.key], 0))}
                    </td>
                  ))}
                  <td className="num">−{rupees(sum('discount'))}</td>
                  <td className="num">{rupees(sum('charged') - sum('discount'))}</td>
                  <td className="num">{rupees(sum('collected'))}</td>
                </tr>
              </tbody>
            </table>
            <table className="bill-report">
              <caption>Charged by doctor (consultations by the visit's doctor, tests by the doctor who ordered)</caption>
              <tbody>
                {d.byDoctor.map((x) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td className="num">{rupees(x.chargedPaise)}</td>
                  </tr>
                ))}
                {!d.byDoctor.length && (
                  <tr>
                    <td className="muted">Nothing charged this year.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}
        <section className="card bill-section" aria-labelledby="bill-export">
          <h2 id="bill-export">Export for the accountant</h2>
          <p className="hint">A file that opens in Excel. It holds patient names and numbers: keep it safe and delete it from shared computers.</p>
          <Alert type="error">{exportError}</Alert>
          <div className="form-grid">
            <Field label="From" id="bill-exp-from">
              <input id="bill-exp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" id="bill-exp-to">
              <input id="bill-exp-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => download('items')} disabled={Boolean(busy)}>
              <Download aria-hidden="true" /> {busy === 'items' ? 'Preparing…' : 'Bill items'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => download('payments')} disabled={Boolean(busy)}>
              <Download aria-hidden="true" /> {busy === 'payments' ? 'Preparing…' : 'Payments'}
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

// ---------- The price list ----------

function PriceRow({ item, canEdit, onSaved }) {
  const [price, setPrice] = useState(toInput(item.pricePaise));
  const [name, setName] = useState(item.name);
  const [ward, setWard] = useState(item.ward ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const paise = toPaise(price || '0');
  const dirty = paise !== item.pricePaise || name.trim() !== item.name || (item.ward != null && ward.trim() !== item.ward);
  const save = async (patch) => {
    setBusy(true);
    setError(null);
    try {
      const { item: saved } = await api(`/billing/prices/${item.id}`, { method: 'PATCH', body: patch });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (!canEdit) {
    return (
      <tr className={item.active ? '' : 'bill-row-cancelled'}>
        <td>{item.name}</td>
        <td>{item.ward != null ? item.ward || 'Any other ward' : ''}</td>
        <td className="num">{item.pricePaise ? rupees(item.pricePaise) : 'Not set'}</td>
        <td>{item.active ? '' : 'Stopped'}</td>
      </tr>
    );
  }
  return (
    <tr className={item.active ? '' : 'bill-row-cancelled'}>
      <td>
        <input aria-label={`Name of ${item.name}`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} disabled={Boolean(item.key)} />
        {error && <span className="field-error">{error}</span>}
      </td>
      <td>{item.ward != null ? <input aria-label={`Ward for ${item.name}`} value={ward} placeholder="Any other ward" maxLength={60} onChange={(e) => setWard(e.target.value)} disabled={item.key === 'bed'} /> : ''}</td>
      <td className="num">
        <input className="bill-price-input" aria-label={`Price of ${item.name} in rupees`} inputMode="decimal" value={price} placeholder="0" onChange={(e) => setPrice(e.target.value)} />
      </td>
      <td className="bill-price-actions">
        {dirty && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || paise == null || name.trim().length < 2} onClick={() => save({ pricePaise: paise, ...(item.key ? {} : { name: name.trim() }), ...(item.ward != null && item.key !== 'bed' ? { ward: ward.trim() } : {}) })}>
            <Save aria-hidden="true" /> Save
          </button>
        )}
        <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={() => save({ active: !item.active })}>
          {item.active ? 'Stop using' : 'Use again'}
        </button>
      </td>
    </tr>
  );
}

function NewPriceForm({ groups, onAdded }) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('procedure');
  const [price, setPrice] = useState('');
  const [ward, setWard] = useState('');
  const [error, setError] = useState(null);
  const paise = toPaise(price || '0');
  const add = async () => {
    setError(null);
    try {
      const { item } = await api('/billing/prices', { method: 'POST', body: { name: name.trim(), group, pricePaise: paise, ...(group === 'inpatient' && ward.trim() ? { ward: ward.trim() } : {}) } });
      setName('');
      setPrice('');
      setWard('');
      onAdded(item);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <section className="card bill-section" aria-labelledby="price-new">
      <h2 id="price-new">Add an item</h2>
      <Alert type="error">{error}</Alert>
      <div className="form-grid">
        <Field label="Name" id="price-new-name">
          <input id="price-new-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Group" id="price-new-group">
          <select id="price-new-group" value={group} onChange={(e) => setGroup(e.target.value)}>
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price (₹)" id="price-new-price" hint="0 = typed on each bill">
          <input id="price-new-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        {group === 'inpatient' && (
          <Field label="Bed charge for ward (optional)" id="price-new-ward" hint="The ward name as written at admission">
            <input id="price-new-ward" value={ward} maxLength={60} onChange={(e) => setWard(e.target.value)} />
          </Field>
        )}
      </div>
      <button type="button" className="btn btn-secondary" disabled={name.trim().length < 2 || paise == null} onClick={add}>
        Add to the price list
      </button>
    </section>
  );
}

export function PriceListPage() {
  const res = useFetch('/billing/prices');
  const [items, setItems] = useState(null);
  const list = items ?? res.data?.items ?? [];
  const canEdit = Boolean(res.data?.canEdit);
  const replace = (saved) => setItems(list.map((i) => (i.id === saved.id ? saved : i)));
  const unset = list.filter((i) => i.active && !i.pricePaise && i.key).length;
  return (
    <>
      <Header title="Price list" />
      <FoldCards className="pf-content bill-page" openFirst>
        {res.error && <Alert type="error">{res.error}</Alert>}
        {!canEdit && res.data && <Alert type="info">Only the hospital admin can change the prices.</Alert>}
        {canEdit && unset > 0 && (
          <Alert type="warning">
            {unset} item{unset > 1 ? 's' : ''} charged automatically still {unset > 1 ? 'have' : 'has'} no price (₹0). Bills show "price not set" until you enter it.
          </Alert>
        )}
        {(res.data?.groups ?? []).map((g) => {
          const rows = list.filter((i) => i.group === g.key);
          if (!rows.length) return null;
          return (
            <section key={g.key} className="card bill-section" aria-labelledby={`price-${g.key}`}>
              <h2 id={`price-${g.key}`}>{GROUP_LABELS[g.key]}</h2>
              <table className="bill-prices">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">{g.key === 'inpatient' ? 'Ward' : ''}</th>
                    <th scope="col" className="num">
                      Price (₹)
                    </th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <PriceRow key={`${i.id}-${i.pricePaise}-${i.active}-${i.name}`} item={i} canEdit={canEdit} onSaved={replace} />
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
        {canEdit && res.data && <NewPriceForm groups={res.data.groups} onAdded={(item) => setItems([...list, item])} />}
      </FoldCards>
    </>
  );
}

// ---------- A patient's bills (her record's Bills tab) ----------

export function PatientBillsList({ patientId }) {
  const navigate = useNavigate();
  const res = useFetch(`/billing/patient/${patientId}`);
  return (
    <div className="bill-page">
      {res.error && <Alert type="error">{res.error}</Alert>}
      {/* A record marked as a duplicate: its bills stay here to be settled; new charges go on the main record */}
      {res.data?.duplicateOf && (
        <Alert type="info">
          This record is marked as a duplicate of <Link to={`/patients/${res.data.duplicateOf.id}/bills`}>{res.data.duplicateOf.mrn}</Link>. The bills below stay on
          this record: take payments for them here. New bills are made on {res.data.duplicateOf.mrn}.
        </Alert>
      )}
      {res.data && res.data.owed > 0 && (
        <Alert type="warning">
          She owes <strong>{rupees(res.data.owed)}</strong>.
        </Alert>
      )}
      {/* Money still owed on a record marked as a duplicate of this one: its bills stay there, so it is said here */}
      {(res.data?.earlierOwed ?? []).map((e) => (
        <Alert type="warning" key={e.id}>
          She also owes <strong>{rupees(e.owed)}</strong> on her earlier record <Link to={`/patients/${e.id}/bills`}>{e.mrn}</Link> ({e.bills} {e.bills === 1 ? 'bill' : 'bills'}). Take the
          payment on that record's bills: they stay there.
        </Alert>
      ))}
      <DataTable
        caption="Her bills"
        columns={billColumns({ showPatient: false })}
        rows={res.data?.bills}
        loading={res.loading}
        onRowClick={(b) => navigate(`/billing/bills/${b.id}`)}
        rowClassName={(b) => (b.status === 'cancelled' ? 'bill-row-cancelled' : '')}
        emptyText="No bills yet."
      />
    </div>
  );
}

/** The patient record's Bills tab (reception). */
export function PatientBillsTab() {
  const { patient } = useOutletContext();
  return <PatientBillsList patientId={patient.id} />;
}
