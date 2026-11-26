import { useEffect, useState } from 'react';
import { BedDouble, Printer, Search } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { DateText } from '../../components/DateText.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDateTime, useDebounced } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { BillPaper } from './InvoicesPage.jsx';
import { ReturnSlip } from './PatientReturnPage.jsx';
import { expiryLabel } from './pharmacyFormat.js';
import { Modal, PharmacyHeader, PharmacyLetterhead } from './pharmacyUi.jsx';
import {
  PAY_CHOICES,
  TYPE_CHOICES,
  admittedSearch,
  amount,
  dateWords,
  filterWords,
  ipBillSums,
  ipBills,
  ipCreditPaise,
  ipReturnSums,
  ipReturns,
  isSearch,
  isoOf,
  newSearch,
  noBillsWords,
  owed,
  periodWords,
  returnSlipOf,
  roundedPaise,
  searchProblem,
  searchQuery,
  sumBills,
  timeWords,
} from './searchBill.js';

// Pharmacy → Search bill (23 Nov 2026, the developer, after the "Browse Sales Bill" window of the pharmacy's earlier
// software), the menu item after Sales bill. On the left what to search for, with the same boxes: patient type, and –
// each used only while it is ticked – patient name (first, last), UHID, sales no and the dates (today's when the page
// opens); an item; cash or credit; Show and the count. Beside it the bills found, each ticked for the printed list,
// with Total sales amt, Received amt and Credit amount under them; a bill clicked shows its medicines below, and a
// double click prints the bill again (straight to the printer's window with Direct print). Under them: Current
// admitted list (choose a patient to list the bills of the stay), IP bill summary (the listed IPD bills of the chosen
// bill's patient, on one paper), Print list and Close.
// The search is made on the server (routes/pharmacyBillSearch.js); what was typed stays on this page – never in the
// address bar. Back from a bill opened here, the same search and bill are shown again: kept in this page's own browser
// history entry (as on Sales bill), never in stored data.

/** Writes the search shown into this page's browser history entry, so Back finds it again. */
function keepInHistory(shown) {
  try {
    const h = window.history.state ?? {};
    window.history.replaceState({ ...h, usr: { ...(h.usr ?? {}), billSearch: shown } }, '');
  } catch {
    // no history to write to (a test page): nothing is kept
  }
}

/** The medicines of the bill clicked: Sr no, Item name, Batch no, Expiry date, Rate, Qty, Total amt (the headings
 * stay in view before a bill is clicked, as on the earlier window). */
export function BillItems({ bill }) {
  return (
    <div className="table-scroll">
      <table className="bill-report ph-sb-lines">
        <thead>
          <tr>
            <th scope="col" className="num">Sr no</th>
            <th scope="col">Item name</th>
            <th scope="col">Batch no</th>
            <th scope="col">Expiry date</th>
            <th scope="col" className="num">Rate</th>
            <th scope="col" className="num">Qty</th>
            <th scope="col" className="num">Total amt</th>
          </tr>
        </thead>
        <tbody>
          {!bill && (
            <tr>
              <td colSpan={7} className="ph-sb-none">
                Click a bill to see its medicines. Double-click it to print the bill again.
              </td>
            </tr>
          )}
          {bill?.lines.map((l, i) => (
            <tr key={l.id}>
              <td className="num">{i + 1}</td>
              <td>{l.name}</td>
              <td>{l.batch}</td>
              <td className="nowrap">{expiryLabel(l.expiry)}</td>
              <td className="num">{amount(l.mrpPaise)}</td>
              {/* the bill as it was made (26 Nov 2026): a return is listed as a bill of its own */}
              <td className="num">{l.qty}</td>
              <td className="num">{amount(l.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The printed list of bills (Print list, IP bill summary): the store's heading, what was searched, the bills, the sums. */
export function BillListDocument({ title, facts = [], rows, settings }) {
  const t = sumBills(rows);
  return (
    <PrintDocument className="bill-doc ph-doc ph-mis-doc">
      <PharmacyLetterhead settings={settings} />
      <h1 className="pdoc-title">{title}</h1>
      {facts.filter(Boolean).map((line, i) => (
        <p key={i} className="pdoc-small">
          {line}
        </p>
      ))}
      <table className="bill-report ph-mis-table">
        <thead>
          <tr>
            <th scope="col">Sales date</th>
            <th scope="col">Sales no</th>
            <th scope="col">UHID</th>
            <th scope="col">Patient name</th>
            <th scope="col" className="num">Disc amt</th>
            <th scope="col" className="num">Net amt</th>
            <th scope="col" className="num">Received amt</th>
            <th scope="col" className="num">Bal amt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDateTime(r.date)}</td>
              <td>
                {r.number}
                {r.isReturn ? ` (return of ${r.returnOf})` : ''}
              </td>
              <td>{r.mrn}</td>
              <td>{r.name}</td>
              <td className="num">{amount(r.discPaise)}</td>
              <td className="num">{amount(r.netPaise)}</td>
              <td className="num">{amount(r.paidPaise)}</td>
              <td className="num">{owed(r.balPaise)}</td>
            </tr>
          ))}
          <tr className="bill-report-total">
            <td colSpan={4}>
              {t.count} {t.count === 1 ? 'bill' : 'bills'}
            </td>
            <td className="num">{amount(rows.reduce((n, r) => n + r.discPaise, 0))}</td>
            <td className="num">{amount(t.salesPaise)}</td>
            <td className="num">{amount(t.receivedPaise)}</td>
            <td className="num">{owed(t.creditPaise)}</td>
          </tr>
        </tbody>
      </table>
      {t.hospitalPaise > 0 && <p className="pdoc-small">Of the balance, {amount(t.hospitalPaise)} is on hospital bills, paid at the billing desk.</p>}
      <p className="bill-sign">Prepared by: ____________________ &nbsp; Checked by: ____________________</p>
    </PrintDocument>
  );
}

/** IP bill summary, laid out as the earlier software's print: Credit Sales Bill and Sales Return as two sections, each
 * with its own total row, Date and Time apart, Total amt next to Net amt (rounded to the rupee), then a small box –
 * Credit Amount, Advance Amount, Amount – under everything. who: the patient { name, mrn }; doctorName: the bill's
 * doctor; advancePaise: her pharmacy advance available now, or null while it is still loading. */
export function IpSummaryDocument({ who, doctorName, advancePaise, bills, settings }) {
  const billSums = ipBillSums(bills);
  const returns = ipReturns(bills);
  const returnSums = ipReturnSums(returns);
  const creditPaise = ipCreditPaise(bills); // 0.00 once she has settled everything
  const amountPaise = Math.max(0, creditPaise - (advancePaise ?? 0));
  return (
    <PrintDocument className="bill-doc ph-doc ph-mis-doc ph-ip-doc">
      <PharmacyLetterhead settings={settings} />
      <h1 className="pdoc-title">IP bill summary</h1>
      <table className="ph-ip-facts">
        <tbody>
          <tr>
            <td>
              <b>UHID:</b> {who.mrn}
            </td>
            <td>
              <b>Patient name:</b> {who.name}
            </td>
          </tr>
          <tr>
            <td>
              <b>Doctor name:</b> {doctorName || '—'}
            </td>
            <td>
              <b>Print date:</b> {dateWords(new Date().toISOString())}
            </td>
          </tr>
        </tbody>
      </table>

      <h2 className="pdoc-small ph-ip-section">Credit Sales Bill</h2>
      <table className="bill-report ph-mis-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Time</th>
            <th scope="col">Sales no</th>
            <th scope="col" className="num">
              Total amt
            </th>
            <th scope="col" className="num">
              Net amt
            </th>
            <th scope="col" className="num">
              Paid amt
            </th>
            <th scope="col" className="num">
              Balance amt
            </th>
          </tr>
        </thead>
        <tbody>
          {bills.map((r) => (
            <tr key={r.id}>
              <td>{dateWords(r.date)}</td>
              <td>{timeWords(r.date)}</td>
              <td>{r.number}</td>
              <td className="num">{amount(r.totalPaise)}</td>
              <td className="num">{amount(roundedPaise(r.totalPaise))}</td>
              <td className="num">{amount(r.paidPaise)}</td>
              <td className="num">{owed(r.balPaise)}</td>
            </tr>
          ))}
          <tr className="bill-report-total">
            <td colSpan={3}>
              {billSums.count} {billSums.count === 1 ? 'bill' : 'bills'}
            </td>
            <td className="num">{amount(billSums.totalPaise)}</td>
            <td className="num">{amount(billSums.netPaise)}</td>
            <td className="num">{amount(billSums.paidPaise)}</td>
            <td className="num">{owed(billSums.balPaise)}</td>
          </tr>
        </tbody>
      </table>

      {returns.length > 0 && (
        <>
          <h2 className="pdoc-small ph-ip-section">Sales Return</h2>
          <table className="bill-report ph-mis-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Time</th>
                <th scope="col">Credit no</th>
                <th scope="col" className="num">
                  Total amt
                </th>
                <th scope="col" className="num">
                  Net amt
                </th>
                <th scope="col" className="num">
                  Paid amt
                </th>
                <th scope="col" className="num">
                  Credit Sales Return
                </th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.number}>
                  <td>{dateWords(r.at)}</td>
                  <td>{timeWords(r.at)}</td>
                  <td>{r.number}</td>
                  <td className="num">{amount(r.amountPaise)}</td>
                  <td className="num">{amount(r.amountPaise)}</td>
                  <td className="num">{amount(0)}</td>
                  <td className="num">{amount(r.amountPaise)}</td>
                </tr>
              ))}
              <tr className="bill-report-total">
                <td colSpan={6}>
                  {returnSums.count} {returnSums.count === 1 ? 'return' : 'returns'}
                </td>
                <td className="num">{amount(returnSums.amountPaise)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <table className="ph-ip-box">
        <tbody>
          <tr>
            <th scope="row">Credit Amount</th>
            <td className="num">{amount(creditPaise)}</td>
          </tr>
          <tr>
            <th scope="row">Advance Amount</th>
            <td className="num">{advancePaise == null ? '…' : amount(advancePaise)}</td>
          </tr>
          <tr className="bill-report-total">
            <th scope="row">Amount</th>
            <td className="num">{advancePaise == null ? '…' : amount(amountPaise)}</td>
          </tr>
        </tbody>
      </table>
      <p className="bill-sign">Prepared by: ____________________ &nbsp; Checked by: ____________________</p>
    </PrintDocument>
  );
}

/** Current admitted list: those in the hospital now; one chosen lists the pharmacy bills of the stay. */
function AdmittedList({ onPick, onClose }) {
  const res = useFetch('/pharmacy/inpatients');
  const stays = res.data?.inpatients ?? [];
  return (
    <Modal id="sb-admitted" title="Current admitted list" onClose={onClose} wide>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {!res.data && !res.error && <p className="muted">Loading…</p>}
      {res.data && !stays.length && <p className="muted">No one is admitted now.</p>}
      {stays.length > 0 && (
        <>
          <p className="hint">Choose a patient to list the pharmacy bills of the stay.</p>
          <div className="table-scroll ph-sb-admitted">
            <table className="bill-report">
              <thead>
                <tr>
                  <th scope="col">UHID</th>
                  <th scope="col">Patient name</th>
                  <th scope="col">Ward · bed</th>
                  <th scope="col">Admitted</th>
                  <th scope="col">
                    <span className="sr-only">Bills</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {stays.map((s, i) => (
                  <tr key={`${s.patient.id}-${i}`}>
                    <td className="tabular nowrap">{s.patient.mrn}</td>
                    <td>
                      <strong>{s.patient.fullName}</strong>
                    </td>
                    <td>{[s.ward, s.bed].filter(Boolean).join(' · ')}</td>
                    <td className="nowrap">{formatDateTime(s.admittedAt)}</td>
                    <td className="num">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPick(s)}>
                        Show bills
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="row">
        <button type="button" className="btn btn-link" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function SearchBillPage() {
  const navigate = useNavigate();
  // Back from a bill opened here: the search and the bill as they were (only when what was kept is a whole search)
  const routed = useLocation().state?.billSearch;
  const kept = isSearch(routed?.form) ? routed : null;
  const [today] = useState(() => isoOf(new Date()));
  // What is in the boxes, and what was last searched for (Show): the list changes only when Show is pressed
  const [form, setForm] = useState(() => kept?.form ?? newSearch(today));
  const [shown, setShown] = useState(() => kept?.form ?? newSearch(today)); // as last searched
  const query = searchQuery(shown);
  const res = useFetch('/pharmacy/bill-search', query);
  const rows = res.data?.bills ?? null;
  const totals = res.data?.totals ?? null;

  const [picked, setPicked] = useState(typeof kept?.picked === 'string' ? kept.picked : null); // the bill whose medicines show below
  useEffect(() => {
    keepInHistory({ form: shown, picked });
  }, [shown, picked]);
  const [skipped, setSkipped] = useState(() => new Set()); // bills unticked: left off the printed list
  const [direct, setDirect] = useState(false);
  const [printing, setPrinting] = useState(null); // { what: 'bill', invoice, settings } | { what: 'list' } | { what: 'ip', rows, who }
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState(null);
  const [admitted, setAdmitted] = useState(false);

  // Item name: the stock list's names that match what is typed, as a drop-down under the box
  const itemText = useDebounced(form.item.trim(), 250);
  const meds = useFetch(itemText.length >= 2 ? '/pharmacy/medicines' : null, itemText.length >= 2 ? { search: itemText } : undefined);
  const itemNames = [...new Set((meds.data?.medicines ?? []).map((m) => m.name))].slice(0, 50);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  // Typing in a part ticks it: filling it in means it is wanted
  const typed = (key, tickKey) => (e) => set({ [key]: e.target.value, ...(e.target.value.trim() ? { [tickKey]: true } : {}) });
  const problem = searchProblem(form);
  const apply = (f) => {
    const next = searchQuery(f);
    setPicked(null);
    setSkipped(new Set());
    setError(null);
    if (JSON.stringify(next) === JSON.stringify(query)) res.reload();
    setShown(f);
  };
  const show = (e) => {
    e.preventDefault();
    if (!problem) apply(form);
  };

  const bill = rows?.find((r) => r.id === picked) ?? null;
  const chosen = (rows ?? []).filter((r) => !skipped.has(r.id));
  const ip = ipBills(rows ?? [], bill);
  // Her advance (Advance Amount, on the IP bill summary): only once there is an IPD bill picked worth summarising
  const advanceRes = useFetch(ip.length && bill?.patientId ? '/pharmacy/settlement' : null, bill?.patientId ? { patientId: bill.patientId } : undefined);
  const advancePaise = advanceRes.data?.advance?.balancePaise ?? null;
  const tick = (id, on) =>
    setSkipped((was) => {
      const next = new Set(was);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  const tickAll = (on) => setSkipped(on ? new Set() : new Set((rows ?? []).map((r) => r.id)));

  // Re-print: the whole bill is read again (its payments and the patient's earlier credit print on it), then its
  // preview opens – as on Sales bill. Opening it is in the audit log, like every bill opened. A return's row (26 Nov
  // 2026) prints its own bill, the Pharmacy Sales Return Bill, read from the bill it was made against.
  const reprint = async (row) => {
    if (opening) return;
    setPicked(row.id);
    setError(null);
    setOpening(row.id);
    try {
      const { invoice, settings } = await api(`/pharmacy/invoices/${row.isReturn ? row.invoiceId : row.id}`);
      const slip = row.isReturn ? returnSlipOf(invoice, row.number) : null;
      if (row.isReturn && !slip) throw new Error(`Return ${row.number} was not found on bill ${invoice.number}.`);
      setPrinting(slip ? { what: 'return', invoice, done: slip, settings } : { what: 'bill', invoice, settings });
    } catch (err) {
      setError(err.message);
    } finally {
      setOpening(null);
    }
  };
  const pickAdmitted = (stay) => {
    const next = admittedSearch(stay, today);
    setForm(next);
    apply(next);
    setAdmitted(false);
  };

  const columns = [
    {
      key: 'tick',
      width: '44px',
      header: <input type="checkbox" aria-label="Every bill on the printed list" checked={Boolean(rows?.length) && chosen.length === rows.length} onChange={(e) => tickAll(e.target.checked)} />,
      render: (r) => <input type="checkbox" aria-label={`Bill ${r.number} on the printed list`} checked={!skipped.has(r.id)} onChange={(e) => tick(r.id, e.target.checked)} />,
    },
    { key: 'date', header: 'Sales date', render: (r) => formatDateTime(r.date) },
    {
      key: 'number',
      header: 'Sales no',
      render: (r) => (
        <>
          <span className="tabular">{r.number}</span>
          {r.isReturn && <span className="ph-sb-where"> return of {r.returnOf}</span>}
        </>
      ),
    },
    { key: 'mrn', header: 'UHID', render: (r) => (r.mrn ? <span className="tabular">{r.mrn}</span> : <span className="muted">–</span>) },
    {
      key: 'name',
      header: 'Patient name',
      render: (r) => (
        <span className="ph-sb-name" title={r.name}>
          {r.name || '–'}
        </span>
      ),
    },
    { key: 'disc', header: 'Disc amt', align: 'right', render: (r) => amount(r.discPaise) },
    { key: 'net', header: 'Net amt', align: 'right', render: (r) => amount(r.netPaise) },
    {
      key: 'bal',
      header: 'Bal amt',
      align: 'right',
      render: (r) => (
        <>
          {owed(r.balPaise)}
          {r.onHospitalBill && <span className="ph-sb-where"> on hospital bill</span>}
        </>
      ),
    },
  ];

  return (
    <>
      <PharmacyHeader className="ph-counter-head" title="Search bill" />
      <div className="pf-content bill-page ph-sb">
        <div className="ph-sb-split">
          <form className="card ph-sb-panel" aria-label="What to search for" onSubmit={show}>
            <fieldset className="ph-sb-set">
              <legend>Patient type</legend>
              <div className="ph-sb-choices">
                {TYPE_CHOICES.map(([k, label]) => (
                  <label key={k} className="check">
                    <input type="radio" name="sb-type" value={k} checked={form.type === k} onChange={() => set({ type: k })} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="ph-sb-set">
              <label className="check ph-sb-tick">
                <input type="checkbox" checked={form.byName} onChange={(e) => set({ byName: e.target.checked })} /> Patient name
              </label>
              <label className="ph-sb-field">
                <span>First name</span>
                <input type="search" value={form.first} maxLength={50} onChange={typed('first', 'byName')} />
              </label>
              <label className="ph-sb-field">
                <span>Last name</span>
                <input type="search" value={form.last} maxLength={50} onChange={typed('last', 'byName')} />
              </label>
            </div>

            <div className="ph-sb-field">
              <label className="check ph-sb-tick">
                <input type="checkbox" checked={form.byMrn} onChange={(e) => set({ byMrn: e.target.checked })} /> UHID
              </label>
              <input type="search" aria-label="UHID" value={form.mrn} maxLength={40} onChange={typed('mrn', 'byMrn')} />
            </div>
            <div className="ph-sb-field">
              <label className="check ph-sb-tick">
                <input type="checkbox" checked={form.byNumber} onChange={(e) => set({ byNumber: e.target.checked })} /> Sales no
              </label>
              <input type="search" aria-label="Sales no" value={form.number} maxLength={40} onChange={typed('number', 'byNumber')} />
            </div>

            <div className="ph-sb-set">
              <label className="check ph-sb-tick">
                <input type="checkbox" checked={form.byDate} onChange={(e) => set({ byDate: e.target.checked })} /> Date
              </label>
              <div className="ph-sb-field">
                <span>From date</span>
                <DateText aria-label="From date" value={form.from} onChange={(v) => set({ from: v, byDate: true })} />
              </div>
              <div className="ph-sb-field">
                <span>To date</span>
                <DateText aria-label="To date" value={form.to} onChange={(v) => set({ to: v, byDate: true })} />
              </div>
            </div>

            <label className="ph-sb-field">
              <span>Item name</span>
              <input type="search" list="sb-items" value={form.item} maxLength={100} placeholder="Any item" autoComplete="off" onChange={(e) => set({ item: e.target.value })} />
            </label>
            <datalist id="sb-items">
              {itemNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>

            <fieldset className="ph-sb-set">
              <legend>Cash or credit</legend>
              <div className="ph-sb-choices">
                {PAY_CHOICES.map(([k, label]) => (
                  <label key={k} className="check">
                    <input type="radio" name="sb-pay" value={k} checked={form.pay === k} onChange={() => set({ pay: k })} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {problem && <p className="field-error">{problem}</p>}
            <button type="submit" className="btn btn-primary ph-sb-show" disabled={Boolean(problem)}>
              <Search aria-hidden="true" /> Show
            </button>
            <p className="ph-sb-count">
              <span>Total count</span> <strong className="tabular">{totals ? totals.count : '…'}</strong>
            </p>
            <p className="hint ph-sb-tip">Double-click a bill to print it again.</p>
          </form>

          <div className="ph-sb-results">
            <Alert type="error" onClose={() => setError(null)}>
              {error}
            </Alert>
            {res.error && <Alert type="error">{res.error}</Alert>}
            <div className="ph-sb-bills">
              <DataTable
                caption="Sales bills"
                rows={rows ?? undefined}
                loading={res.loading}
                columns={columns}
                pageSize={0}
                emptyText={noBillsWords(query)}
                onRowClick={(r) => setPicked(r.id)}
                onRowDoubleClick={reprint}
                rowClassName={(r) => (r.id === picked ? 'is-picked' : undefined)}
              />
            </div>
            {res.data?.more && <p className="hint">The newest {res.data.limit.toLocaleString('en-IN')} bills are listed and added up. Choose fewer days, or add another part to the search, to see the rest.</p>}
            {totals && (
              <dl className="ph-sb-sums">
                <div>
                  <dt>Total sales amt</dt>
                  <dd>{amount(totals.salesPaise)}</dd>
                </div>
                <div>
                  <dt>Received amt</dt>
                  <dd>{amount(totals.receivedPaise)}</dd>
                </div>
                <div>
                  <dt>Credit amount</dt>
                  <dd>{owed(totals.creditPaise)}</dd>
                </div>
                {totals.hospitalPaise > 0 && (
                  <div>
                    <dt>Credit on hospital bills</dt>
                    <dd>{amount(totals.hospitalPaise)}</dd>
                  </div>
                )}
              </dl>
            )}

            <section className="card ph-sb-items" aria-label="Medicines on the bill">
              <div className="ph-sb-items-head">
                <h2>
                  {bill ? (bill.isReturn ? `Return ${bill.number} (bill ${bill.returnOf})` : `Bill ${bill.number}`) : 'Medicines on the bill'}
                  {bill?.name && <span className="muted"> · {bill.name}</span>}
                </h2>
                {bill && (
                  <div className="ph-sb-items-acts">
                    <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(opening)} onClick={() => reprint(bill)}>
                      <Printer aria-hidden="true" /> {opening === bill.id ? 'Opening…' : bill.isReturn ? 'Re-print return bill' : 'Re-print bill'}
                    </button>
                    <Link className="btn btn-link btn-sm" to={`/pharmacy/invoices/${bill.isReturn ? bill.invoiceId : bill.id}`}>
                      {bill.isReturn ? `Open bill ${bill.returnOf}` : 'Open the bill'}
                    </Link>
                  </div>
                )}
              </div>
              <BillItems bill={bill} />
            </section>

            <div className="ph-sb-actions">
              <label className="check ph-sb-direct">
                <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} /> Direct print
              </label>
              <button type="button" className="btn btn-secondary" onClick={() => setAdmitted(true)}>
                <BedDouble aria-hidden="true" /> Current admitted list
              </button>
              <button type="button" className="btn btn-secondary" disabled={!ip.length} onClick={() => setPrinting({ what: 'ip', rows: ip, who: bill })}>
                IP bill summary
              </button>
              <button type="button" className="btn btn-secondary" disabled={!chosen.length} onClick={() => setPrinting({ what: 'list' })}>
                <Printer aria-hidden="true" /> Print list
              </button>
              <button type="button" className="btn btn-link" onClick={() => navigate('/pharmacy')}>
                Close
              </button>
            </div>
            {!ip.length && <p className="hint ph-sb-tip">IP bill summary: click an IPD patient’s bill first – Current admitted list finds the patient.</p>}
          </div>
        </div>
      </div>

      {admitted && <AdmittedList onPick={pickAdmitted} onClose={() => setAdmitted(false)} />}
      {printing?.what === 'bill' && (
        <PrintPreview
          title="Bill – print preview"
          hint="Check it, then print on A5 paper."
          page={{ size: 'A5', margin: '8mm' }}
          autoPrint={direct}
          onPrint={() => api(`/pharmacy/invoices/${printing.invoice.id}/printed`, { method: 'POST', body: { what: 'invoice' } })}
          onClose={() => setPrinting(null)}
        >
          <PrintDocument className="bill-doc ph-doc">
            <BillPaper invoice={printing.invoice} settings={printing.settings} />
          </PrintDocument>
        </PrintPreview>
      )}
      {printing?.what === 'return' && (
        <PrintPreview
          title="Sales return bill – print preview"
          hint="Check it, then print on A5 paper."
          page={{ size: 'A5', margin: '8mm' }}
          autoPrint={direct}
          onPrint={() => api(`/pharmacy/invoices/${printing.invoice.id}/printed`, { method: 'POST', body: { what: 'credit_note' } })}
          onClose={() => setPrinting(null)}
        >
          <ReturnSlip done={printing.done} settings={printing.settings} />
        </PrintPreview>
      )}
      {printing?.what === 'list' && res.data && (
        <PrintPreview title="Sales bills – print preview" hint="Print on A4 paper, landscape." page={{ size: 'A4 landscape', margin: '10mm' }} onClose={() => setPrinting(null)}>
          <BillListDocument title="Sales bills" facts={[periodWords(query), filterWords(query)]} rows={chosen} settings={res.data.settings} />
        </PrintPreview>
      )}
      {printing?.what === 'ip' && res.data && (
        <PrintPreview title="IP bill summary – print preview" hint="Print on A4 paper, landscape." page={{ size: 'A4 landscape', margin: '10mm' }} onClose={() => setPrinting(null)}>
          <IpSummaryDocument who={printing.who} doctorName={printing.who.doctorName} advancePaise={advancePaise} bills={printing.rows} settings={res.data.settings} />
        </PrintPreview>
      )}
    </>
  );
}
