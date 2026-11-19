import { useEffect, useRef, useState } from 'react';
import { BedDouble, Building2, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, FileJson, History, Plus, Printer, RotateCcw, Search, Stethoscope, UserPlus, Users, Wallet } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, apiFile } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDateTime, useDebounced } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { savedNote } from '../../platform/androidApp.js';
import { addDaysIso } from '../appointments/appointmentFormat.js';
import { TallyMarks } from '../billing/TallyPage.jsx';
import { amountInWords } from '../billing/amountWords.js';
import { MODE_LABELS, expiryLabel, soldItems } from './pharmacyFormat.js';
import { BarcodeBox, Modal, PharmacyHeader, PharmacyLetterhead, money, useSend } from './pharmacyUi.jsx';
import { TypePill, billsPlace } from './RegisterPage.jsx';
import { DateText } from '../../components/DateText.jsx';

// Pharmacy → Invoices: a day's invoices (or a search), one invoice with its GST tax invoice to print, and returns of
// unopened medicines before their expiry (each a credit note). A walk-in sale to a business with a GSTIN shows the
// buyer, and the hospital admin can download its e-invoice file (to upload on the e-invoice portal by hand).
// The pharmacist has a row of filters; a patient's name or number opens the list of people found, then their bills (3 Nov 2026).

const whoOf = (v) => (v.patient ? `${v.patient.fullName} (${v.patient.mrn})` : v.buyer ? `${v.buyer.name} (business)` : v.customer ? `${v.customer.name} (walk-in)` : '');
// On the printed bill every amount has its paise, so the column lines up: ₹75.00, not ₹75
const paper = (paise) => (paise % 100 ? money(paise) : `${money(paise)}.00`);
// The bill's columns: 1,308.61, without the rupee sign, as on the store's earlier bill
const plain = (paise) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad2 = (n) => String(n).padStart(2, '0');
const slipDate = (value) => {
  const d = new Date(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const lineName = (l) => `${l.name}${l.schedule ? ` (${l.schedule === 'narcotic' ? 'NDPS' : `Sch. ${l.schedule}`})` : ''}`;
const buyerAddress = (b) => [b.address, [b.place, b.pin].filter(Boolean).join(' '), b.state && `${b.state} (${b.stateCode})`].filter(Boolean).join(', ');

const TYPE_CHOICES = [['all', 'All', Users], ['opd', 'OPD', Stethoscope], ['ipd', 'IPD', BedDouble], ['external', 'External', UserPlus]];
// A payment's mode in words – 'advance': paid from the patient's pharmacy advance (18 Nov 2026)
const modeWord = (mode) => (mode === 'advance' ? 'the advance' : MODE_LABELS[mode] ?? mode);
const typeOf = (v) => (v.kind === 'issue' ? 'ipd' : v.patient ? 'opd' : 'external');
/** A bill fits an amount by its first digits (12 finds 12, 120 and 1,200), and "hospital" means a patient's bill. */
export const billFits = (v, { type = 'all', doctor = '', amount = '', paidBy = '' }) =>
  (type === 'all' || typeOf(v) === type) &&
  (!doctor || v.doctor?.name === doctor) &&
  (!amount || String(v.netPaise / 100).startsWith(amount)) &&
  (!paidBy || (paidBy === 'hospital' ? Boolean(v.patient) : (v.payments ?? []).some((p) => p.mode === paidBy)));

/**
 * pick (the New bill tab, 9 Nov 2026): the same panel and people list, to choose who the bill is for – { onPick(person),
 * onWalkIn() }. Nothing of the day's bills is shown then; a person's past bills open on the Bill list tab.
 */
export function InvoicesPage({ pick = null }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { activeMembership } = useAuth();
  const desk = activeMembership.roles.includes('pharmacist');
  const routed = useLocation().state;
  const start = routed?.find; // a double click on a patient elsewhere: their patient number
  // A bill just saved on the New bill tab (9 Nov 2026): that person's bills here, its print preview open, once
  const madeNow = routed?.made ?? null;
  // Read once: a refresh of the page does not open the print preview again
  useEffect(() => {
    if (madeNow) navigate('.', { replace: true, state: null });
  }, []);
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 300);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : undefined;
  const res = useFetch('/pharmacy/invoices', search.length >= 2 ? { search } : { date });
  const day = date ?? res.data?.today;

  // The pharmacist's search, as the store's earlier software's Search patient window (13 Nov 2026): patient type, first,
  // middle and last name, mobile number, UHID, and the bills' dates from–to (ticked to use them); Show lists the people
  // found, with their bills of every date. The day's bills show below when nothing is searched.
  const [type, setType] = useState('all');
  const [firstText, setFirstText] = useState('');
  const [middleText, setMiddleText] = useState('');
  const [lastText, setLastText] = useState('');
  const [phoneText, setPhoneText] = useState('');
  const [mrnText, setMrnText] = useState(start ?? '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [person, setPerson] = useState(() =>
    madeNow ? { key: madeNow.invoice.id, name: madeNow.name, mrn: madeNow.mrn ?? '', type: madeNow.type, billCount: 1, bills: [{ id: madeNow.invoice.id, number: madeNow.invoice.number, at: new Date().toISOString() }], printNow: true } : null,
  );
  const go = (d) => {
    setParams({ date: d }, { replace: true });
    setPerson(null);
    setBlank(false); // a day chosen: that day's bills
  };
  const first = useDebounced(firstText.trim(), 300);
  const middle = useDebounced(middleText.trim(), 300);
  const last = useDebounced(lastText.trim(), 300);
  const phone = useDebounced(phoneText.replace(/[^\d]/g, ''), 300);
  const mrn = useDebounced(mrnText.trim(), 300);
  const name = first || middle || last || (phone.length >= 3 ? phone : '');
  // 18 Nov 2026 (the pharmacy): no "Date" tick – a date chosen filters at once; Clear dates takes them off
  const dated = Boolean(fromDate || toDate);
  const from = dated ? fromDate || toDate : '';
  const to = dated ? toDate || day : '';
  // Search (6 Nov 2026, as the store's earlier software): with a type chosen, that type's people – nothing typed needed
  const [searched, setSearched] = useState(false);
  // The whole list (owner's approval, 9 Nov 2026): how many pages of it are shown – "Show more" adds one
  const [pages, setPages] = useState(1);
  const [kitHint, setKitHint] = useState(false);
  // A type just chosen (All, OPD, IPD or External, 7 Nov 2026): the list stays empty until Search is pressed
  const [blank, setBlank] = useState(false);
  const looking = desk && Boolean(name || mrn || searched);
  const found = useFetch(
    looking ? '/pharmacy/invoices/people' : null,
    looking
      ? { ...(first ? { first } : {}), ...(middle ? { middle } : {}), ...(last ? { last } : {}), ...(phone.length >= 3 ? { phone } : {}), ...(mrn ? { mrn } : {}), ...(type !== 'all' ? { type } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(pages > 1 ? { pages } : {}) }
      : undefined,
  );
  const people = looking ? (found.data?.people ?? []) : [];
  // Came with a patient's number: open their bills as soon as they are found
  const opened = useRef(false);
  useEffect(() => {
    const hit = start && !opened.current && people.find((x) => x.mrn === start);
    if (hit) {
      opened.current = true;
      setPerson(hit);
    }
  }, [start, people]);
  // A name clicked in the list (9 Nov 2026): the New bill tab opens with that person chosen – an issue to the ward for
  // someone admitted now, a walk-in bill with the name and phone for an External customer
  // "Bill saved – on credit", as the earlier software's "Bill generated successfully [Credit]" (13 Nov 2026)
  const [made, setMade] = useState(() => {
    if (!madeNow) return null;
    const how = { credit: `on credit – ${money(madeNow.duePaise ?? 0)} to be paid later`, hospital: 'on the patient’s hospital bill', paid: 'paid' }[madeNow.settled];
    return `Bill ${madeNow.invoice.number} saved${how ? ` – ${how}` : ''}.`;
  });
  const [opening, setOpening] = useState(null);
  // A payment taken in the left panel (credit settled, advance used): the bill shown reloads
  const [paidCount, setPaidCount] = useState(0);
  // The bill shown on the right: "Open the bill" sits beside Take advance in the left panel (19 Nov 2026)
  const [shownBillId, setShownBillId] = useState(null);
  const typed = (set) => (e) => {
    set(e.target.value);
    setPerson(null);
  };
  const openBill = async (x) => {
    if (!x.mrn) return navigate('/pharmacy', { state: { type: 'external', customer: { name: x.name, phone: x.phone ?? '' } } });
    setOpening(x.key);
    try {
      const { inpatients } = await api('/pharmacy/inpatients');
      const patient = { id: x.key, fullName: x.name, mrn: x.mrn, doctor: x.doctor ?? '' };
      navigate(inpatients.some((s) => s.patient.id === x.key) ? '/pharmacy/issue' : '/pharmacy', { state: { patient } });
    } catch {
      setOpening(null);
      navigate('/pharmacy', { state: { patient: { id: x.key, fullName: x.name, mrn: x.mrn } } });
    }
  };
  const clearPerson = () => {
    setFirstText('');
    setMiddleText('');
    setLastText('');
    setPhoneText('');
    setMrnText('');
  };
  // The patient type chosen. 18 Nov 2026 (the pharmacy's request): OPD and IPD show their patient list at once, without Show
  const chooseType = (k) => {
    setType(k);
    setPerson(null);
    setMade(null);
    clearPerson();
    setKitHint(false);
    const listNow = k === 'opd' || k === 'ipd';
    setSearched(listNow);
    setPages(1);
    setBlank(!listNow);
  };
  const closePerson = () => {
    setBlank(false);
    setPerson(null);
    clearPerson();
    setSearched(false);
  };

  // Phones, as in the app design (2 Nov 2026): how many bills and their total above the list
  const onPhone = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 719px)').matches);
  const bills = res.data?.invoices?.filter((v) => !desk || billFits(v, { type }));
  const filtering = desk && (type !== 'all' || text);
  const billSearch = <input type="search" className="bill-search-plain" aria-label="Find a bill" placeholder="Bill or return (CN) number, or a medicine" value={text} onChange={(e) => setText(e.target.value)} />;
  const dayNav = day && (
    <div className="appt-daynav" role="group" aria-label="Day">
      <button type="button" className="icon-btn" onClick={() => go(addDaysIso(day, -1))} aria-label="Previous day">
        <ChevronLeft aria-hidden="true" />
      </button>
      <DateText aria-label="Day" value={day} onChange={(v) => v && go(v)} />
      <button type="button" className="icon-btn" onClick={() => go(addDaysIso(day, 1))} aria-label="Next day">
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
  const dayList = (
    <>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {desk && filtering && res.data && (
        <p className="ph-sold-count">
          Showing {bills.length} of {res.data.invoices.length} bills · {money(bills.reduce((n, v) => n + (v.netPaise ?? 0), 0))}
        </p>
      )}
      {onPhone && bills?.length > 0 && (
        <p className="ph-sold-sum">
          <span>
            {bills.length} bill{bills.length === 1 ? '' : 's'}
          </span>
          <span className="tabular">{money(bills.reduce((n, v) => n + (v.netPaise ?? 0), 0))}</span>
        </p>
      )}
      <DataTable
        caption="Pharmacy invoices"
        rows={bills}
        loading={res.loading}
        onRowClick={(v) => navigate(`/pharmacy/invoices/${v.id}`)}
        emptyText={search.length >= 2 || filtering ? 'No bills match.' : 'Nothing sold on this day.'}
        toolbar={
          desk ? undefined : (
            <div className="bill-toolbar">
              {billSearch}
              {search.length < 2 && dayNav}
            </div>
          )
        }
        columns={[
          { key: 'number', header: 'Invoice', render: (v) => <span className="tabular">{v.number}</span> },
          { key: 'date', header: 'Time', render: (v) => formatDateTime(v.date) },
          { key: 'kind', header: 'Kind', render: (v) => (v.kind === 'issue' ? 'Inpatient issue' : 'Counter sale') },
          { key: 'who', header: 'Patient / customer', render: whoOf },
          { key: 'doctor', header: 'Doctor', render: (v) => v.doctor?.name || '–' }, // 14 Nov 2026
          { key: 'items', header: 'Medicines sold', render: (v) => soldItems(v.lines) },
          { key: 'net', header: 'Amount', align: 'right', render: (v) => <span className="tabular">{paper(v.netPaise)}</span> },
        ]}
      />
    </>
  );
  return (
    <>
      <PharmacyHeader
        className="ph-fab ph-counter-head"
        title={pick ? 'Sales bill' : desk ? 'Bill list' : 'Sold'}
        // 19 Nov 2026 (the developer): the page's name once, in bold – the small path line keeps only "Pharmacy"
        crumb={pick ? undefined : desk ? 'Bill list' : 'Sold'}
        sales
        actions={
          desk && !pick ? (
            <Link className="btn btn-secondary" to="/pharmacy">
              <Plus aria-hidden="true" /> New bill
            </Link>
          ) : pick ? (
            // 18 Nov 2026 (the pharmacy): the way in, on the title's line – so the list starts higher
            <div className="ph-pick-head">
              <span className="muted">Search on the left and click a name to make their bill – or a walk-in customer:</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={pick.onWalkIn}>
                <UserPlus aria-hidden="true" /> New walk-in customer
              </button>
            </div>
          ) : undefined
        }
      />
      <div className="pf-content bill-page ph-sold">
        {desk ? (
          <div className="ph-sold-split">
            <section className="card ph-filters" aria-label="Find bills">
              <div className="ph-filter">
                <span>Patient type</span>
                <div className="segmented" role="group" aria-label="Type of patient">
                  {TYPE_CHOICES.map(([k, label, Icon]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={type === k}
                      onClick={() => chooseType(k)}
                    >
                      <Icon aria-hidden="true" /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary ph-search-btn"
                onClick={() => {
                  setSearched(true);
                  setPages(1);
                  setBlank(false);
                  setPerson(null);
                  setMade(null);
                }}
              >
                <Search aria-hidden="true" /> Show
              </button>
              <div className="ph-filter-row ph-find-form">
                <h3 className="ph-find-head">Patient name</h3>
                <label className="ph-filter">
                  <span>First name</span>
                  <input type="search" value={firstText} maxLength={50} onChange={typed(setFirstText)} />
                </label>
                <label className="ph-filter">
                  <span>Middle name</span>
                  <input type="search" value={middleText} maxLength={50} onChange={typed(setMiddleText)} />
                </label>
                <label className="ph-filter">
                  <span>Last name</span>
                  <input type="search" value={lastText} maxLength={50} onChange={typed(setLastText)} />
                </label>
                <label className="ph-filter">
                  <span>Mob. no.</span>
                  <input type="search" inputMode="tel" value={phoneText} maxLength={20} onChange={typed(setPhoneText)} />
                </label>
                <label className="ph-filter">
                  <span>UHID</span>
                  <input type="search" value={mrnText} maxLength={40} placeholder="Patient number" onChange={typed(setMrnText)} />
                </label>
                <div className="ph-filter">
                  <span>From date</span>
                  <DateText
                    aria-label="From date"
                    value={fromDate || day || ''}
                    max={toDate || day}
                    onChange={(v) => {
                      setFromDate(v);
                      setPerson(null);
                      setSearched(true);
                      setBlank(false);
                    }}
                  />
                </div>
                <div className="ph-filter">
                  <span>To date</span>
                  <DateText
                    aria-label="To date"
                    value={toDate || day || ''}
                    min={fromDate || undefined}
                    onChange={(v) => {
                      setToDate(v);
                      go(v);
                      setSearched(true);
                    }}
                  />
                </div>
                {dated && (
                  <button
                    type="button"
                    className="btn btn-link btn-sm ph-clear-dates"
                    onClick={() => {
                      setFromDate('');
                      setToDate('');
                      setPerson(null);
                    }}
                  >
                    Clear dates
                  </button>
                )}
                {/* 19 Nov 2026 (the pharmacy's request): the patient's credit due and advance under the dates, not in cards */}
                {person?.mrn && <PersonAccount key={person.key} person={person} billId={shownBillId} onPaid={() => setPaidCount((n) => n + 1)} />}
              </div>
            </section>
            <div className="ph-sold-results">
              {made && (
                <Alert type="success" onClose={() => setMade(null)}>
                  {made}
                </Alert>
              )}
              {/* 18 Nov 2026 (the pharmacy's request): Barcode, Select kit and the kits on the first page */}
              {pick && !person && (
                <div className="ph-pick-tools">
                  <div className="ph-pick-scan">
                    <BarcodeBox onPick={pick.onScan} />
                    {pick.scanned.length > 0 && (
                      <p className="hint">
                        For the next bill: {pick.scanned.map((m) => m.name).join(', ')}.{' '}
                        <button type="button" className="btn btn-link btn-sm" onClick={pick.clearScanned}>
                          Clear
                        </button>
                      </p>
                    )}
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { chooseType('ipd'); setKitHint(true); }}>
                    Select kit
                  </button>
                  <Link className="btn btn-link btn-sm" to="/formulary/kits">
                    Kits (add or see)
                  </Link>
                  {kitHint && <p className="hint ph-pick-kit-hint">A kit is issued to an admitted patient: choose her in the IPD list, then pick the kit on the issue.</p>}
                </div>
              )}
              {person ? (
                <PersonBills key={person.key} person={person} paidCount={paidCount} onShown={setShownBillId} onClose={closePerson} />
              ) : looking ? (
                <PeopleFound
                  found={found}
                  people={people}
                  onPick={pick ? pick.onPick : openBill}
                  opening={opening}
                  onBills={setPerson}
                  onMore={found.data?.pages ? () => setPages((n) => n + 1) : null}
                />
              ) : blank ? (
                <section className="card ph-found ph-blank" aria-label="People found">
                  <p className="muted">
                    Press Search to list {type === 'all' ? 'all' : TYPE_CHOICES.find(([k]) => k === type)?.[1]} patients, or type a patient’s name or number.
                  </p>
                </section>
              ) : (
                dayList
              )}
            </div>
          </div>
        ) : (
          dayList
        )}
      </div>
    </>
  );
}

/** The people a search found: nothing is listed until a search. Clicking someone opens a new bill for them. */
export function PeopleFound({ found, people, onPick, onBills = null, onMore = null, opening = null }) {
  return (
    // 19 Nov 2026 (the developer): the list is one card – the table's own – with the tip above it, not a card in a card
    <section className={people.length ? 'ph-found ph-found-list' : 'card ph-found'} aria-label="People found">
      {found.error && <Alert type="error">{found.error}</Alert>}
      {found.data && !people.length && <p className="muted">Nobody matches.</p>}
      {people.length > 0 && <p className="hint ph-found-tip">Click a name to make a new bill for them. Those to bill today and those with bills come first.</p>}
      {/* 14 Nov 2026: a table like the day's bills – the same headings, text and rows, with the doctor */}
      {people.length > 0 && (
        <DataTable
          caption="People found"
          rows={people}
          rowKey="key"
          onRowClick={(x) => !opening && onPick(x)}
          rowClassName={(x) => (opening === x.key ? 'is-opening' : undefined)}
          columns={[
            { key: 'name', header: 'Patient / customer', render: (x) => <strong className="ph-found-name" title={x.name}>{x.name}</strong> },
            { key: 'mrn', header: 'UHID', width: '88px', render: (x) => (x.mrn ? <span className="tabular">{x.mrn}</span> : <span className="muted">–</span>) },
            { key: 'type', header: 'Type', width: '104px', render: (x) => (x.type ? <TypePill type={x.type} /> : <span className="muted">–</span>) },
            { key: 'doctor', header: 'Doctor', width: '22%', render: (x) => (x.doctor ? <span className="ph-found-doctor" title={x.doctor}>{x.doctor}</span> : <span className="muted">–</span>) },
            { key: 'bills', header: 'Bills', width: '80px', render: (x) => (x.billCount > 0 ? `${x.billCount} bill${x.billCount === 1 ? '' : 's'}` : <span className="muted">None yet</span>) },
            { key: 'last', header: 'Last bill', width: '92px', render: (x) => (x.lastAt ? <span className="tabular">{slipDate(x.lastAt)}</span> : <span className="muted">–</span>) },
            {
              key: 'open',
              header: <span className="sr-only">Their bills</span>,
              align: 'right',
              width: '72px',
              render: (x) =>
                x.billCount > 0 && onBills ? (
                  <button
                    type="button"
                    className="btn btn-link btn-sm"
                    aria-label={`Bills of ${x.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onBills(x);
                    }}
                  >
                    <History aria-hidden="true" /> Bills
                  </button>
                ) : null,
            },
          ]}
        />
      )}
      {/* The table's page bar counts the rows; only a list the server cut short says so */}
      {found.data?.more && people.length > 0 && <p className="hint ph-found-count">{people.length} people listed so far.</p>}
      {found.data?.more &&
        (onMore ? (
          <button type="button" className="btn btn-secondary ph-found-more" disabled={found.loading} onClick={onMore}>
            {found.loading ? 'Loading…' : 'Show more'}
          </button>
        ) : (
          <p className="hint">The first {people.length} are listed. Type part of the name or number to find anyone else.</p>
        ))}
    </section>
  );
}

/** One person's bills: the newest shown as it prints, across the page, the others a click away. */
function PersonBills({ person, paidCount = 0, onShown, onClose }) {
  const [billId, setBillId] = useState(person.bills[0].id);
  useEffect(() => {
    onShown?.(billId);
  }, [billId, onShown]);
  const [printing, setPrinting] = useState(false);
  const res = useFetch(`/pharmacy/invoices/${billId}`);
  const v = res.data?.invoice;
  // A payment taken in the left panel: the bill shown here shows it
  const reloadBill = res.reload;
  useEffect(() => {
    if (paidCount) reloadBill();
  }, [paidCount, reloadBill]);
  // A bill just made on Sold: its print preview opens by itself, once
  const printedNow = useRef(false);
  useEffect(() => {
    if (person.printNow && v && !printedNow.current) {
      printedNow.current = true;
      setPrinting(true);
    }
  }, [person.printNow, v]);
  return (
    <>
      <div className="ph-person-head">
        <h2>
          {person.name} {person.mrn && <span className="muted tabular">· {person.mrn}</span>}
        </h2>
        <div className="ph-person-actions">
          <button type="button" className="btn btn-secondary" disabled={!v} onClick={() => setPrinting(true)}>
            <Printer aria-hidden="true" /> Print
          </button>
          {/* A registered patient's "Open the bill" is in the left panel, beside Take advance (19 Nov 2026) */}
          {!person.mrn && (
            <Link className="btn btn-secondary" to={`/pharmacy/invoices/${billId}`}>
              Open the bill
            </Link>
          )}
          <button type="button" className="btn btn-link" onClick={onClose}>
            Back to the day’s bills
          </button>
        </div>
      </div>
      {person.bills.length > 1 && (
        <div className="segmented ph-person-bills" role="group" aria-label={`Bills of ${person.name}`}>
          {person.bills.map((b) => (
            <button key={b.id} type="button" aria-pressed={b.id === billId} onClick={() => setBillId(b.id)}>
              {b.number} · {slipDate(b.at)}
            </button>
          ))}
        </div>
      )}
      {person.billCount > person.bills.length && (
        <p className="hint">
          The latest {person.bills.length} of {person.billCount} bills are listed.
        </p>
      )}
      {res.error && <Alert type="error">{res.error}</Alert>}
      {v && (
        <div className="ph-slip-sheet">
          <BillPaper invoice={v} settings={res.data.settings} />
        </div>
      )}
      {printing && v && <BillPrint invoice={v} settings={res.data.settings} onClose={() => setPrinting(false)} />}
    </>
  );
}

/** The pharmacy bill, in the layout of the store's earlier bill. The tax invoice (GST and HSN set out) stays on the Print menu. */
export function BillPaper({ invoice: v, settings }) {
  const type = v.kind === 'issue' ? 'IPD Patient' : v.patient ? 'OPD Patient' : 'External';
  const name = v.patient ? v.patient.fullName : v.buyer ? v.buyer.name : v.customer?.name || 'Walk-in customer';
  const licences = [settings.licence20, settings.licence21].filter(Boolean).join(' ');
  const signed = settings.pharmacistName || v.byName;
  const doses = v.lines.some((l) => l.dose);
  const gross = v.grossPaise ?? v.lines.reduce((n, l) => n + Math.round(l.qty * l.mrpPaise), 0); // at MRP, before the discount
  return (
    <div className="ph-slip">
      <header className="ph-slip-head">
        <div className="lh-name">{settings.name}</div>
        {settings.address && <div>{settings.address}</div>}
        {(licences || settings.gstin) && (
          <div className="ph-slip-ids">
            {licences && <span>D.L. No. {licences}</span>}
            {settings.gstin && <span>GSTN No. {settings.gstin}</span>}
          </div>
        )}
        {settings.phone && <div className="ph-slip-mobile">Mobile No. {settings.phone}</div>}
      </header>
      <dl className="ph-slip-facts">
        <div>
          <dt>Bill No</dt>
          <dd>{v.number}</dd>
        </div>
        <div>
          <dt>Reg No</dt>
          <dd>{v.patient?.mrn ?? ''}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{slipDate(v.date)}</dd>
        </div>
        <div className="is-long">
          <dt>Patient Name</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{type}</dd>
        </div>
        <div className="is-long">
          <dt>Address</dt>
          <dd>{v.buyer ? buyerAddress(v.buyer) : ''}</dd>
        </div>
        <div>
          <dt>Doctor Name</dt>
          <dd>{v.doctor?.name ?? ''}</dd>
        </div>
      </dl>
      <table className="ptable ph-slip-lines">
        <thead>
          <tr>
            <th scope="col">Sr.</th>
            <th scope="col">Item Name</th>
            {doses && <th scope="col">Dose</th>}
            <th scope="col">Batch No</th>
            <th scope="col">Expiry</th>
            <th scope="col" className="num">MRP</th>
            <th scope="col" className="num">Disc Amt</th>
            <th scope="col" className="num">Qty</th>
            <th scope="col" className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {v.lines.map((l, i) => (
            <tr key={l.id}>
              <td>{i + 1}</td>
              <td>
                {lineName(l)}
                {/* PH10: printed with the line – given in place of the brand prescribed, and who agreed */}
                {l.substitution && <div className="ph-sub-note">Given in place of {l.substitution.prescribed}, agreed by {l.substitution.agreedByName}</div>}
              </td>
              {doses && <td>{l.dose ?? ''}</td>}
              <td>{l.batch}</td>
              <td className="nowrap">{expiryLabel(l.expiry).replace(' ', '-')}</td>
              <td className="num">{plain(l.mrpPaise)}</td>
              <td className="num">{plain(Math.max(0, l.qty * l.mrpPaise - l.amountPaise))}</td>
              <td className="num">{l.qty.toFixed(2)}</td>
              <td className="num">{plain(l.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* 15 Nov 2026, as the earlier bill: Gross (at MRP), Disc, then Paid Amount. 18 Nov 2026 (the pharmacy): no Net line;
          a patient's bill shows its Credit Amt beside Paid Amount, then her earlier credit and the total she owes */}
      <div className="ph-slip-sums">
        <div>
          <span>Gross</span>
          <span>{plain(gross)}</span>
        </div>
        <div>
          <span>Disc</span>
          <span>{plain(Math.max(0, gross - v.totalPaise))}</span>
        </div>
        {v.returnedPaise > 0 && (
          <div>
            <span>Returned</span>
            <span>−{plain(v.returnedPaise)}</span>
          </div>
        )}
        {v.billId ? (
          <div>Payable at the billing desk with the hospital bill</div>
        ) : (
          <>
            <div>
              <span>Paid Amount</span>
              <span>{plain(v.paidPaise ?? 0)}</span>
            </div>
            {/* a walk-in (External) pays the whole bill: never credit */}
            {v.patient && (
              <div className="ph-slip-credit">
                <span>Credit Amt</span>
                <span>{plain(Math.max(0, v.balancePaise ?? 0))}</span>
              </div>
            )}
            {v.patient && v.earlierDuePaise > 0 && (
              <>
                <div>
                  <span>Previous Credit</span>
                  <span>{plain(v.earlierDuePaise)}</span>
                </div>
                <div className="ph-slip-credit">
                  <span>Total Credit</span>
                  <span>{plain(Math.max(0, v.balancePaise ?? 0) + v.earlierDuePaise)}</span>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <div className="ph-slip-foot">
        <div>
          <p>OVERCHARGE IF ANY IS REFUNDABLE, E.&amp;O.E</p>
          <p>* * * GET WELL SOON * * *</p>
          {settings.place && <p>Subject to {settings.place} Jurisdiction</p>}
        </div>
        <div className="ph-slip-sign">
          <div className="ph-slip-sign-line">Pharmacist</div>
          {signed && <div>{signed}</div>}
        </div>
      </div>
    </div>
  );
}

function BillPrint({ invoice: v, settings, onClose }) {
  const record = () => api(`/pharmacy/invoices/${v.id}/printed`, { method: 'POST', body: { what: 'invoice' } });
  return (
    <PrintPreview title="Bill – print preview" hint="Check it, then print on A5 paper." page={{ size: 'A5', margin: '8mm' }} onPrint={record} onClose={onClose}>
      <PrintDocument className="bill-doc ph-doc">
        <BillPaper invoice={v} settings={settings} />
      </PrintDocument>
    </PrintPreview>
  );
}

/** The printed GST tax invoice (or a credit note), A5: the store's letterhead, the bill's details, the medicines, the sums. */
function InvoicePrint({ invoice: v, settings, stay, creditNote = null, onClose }) {
  const ret = creditNote ? v.returns.find((r) => r.number === creditNote) : null;
  const lines = ret ? ret.lines.map((x) => ({ ...v.lines.find((l) => l.id === x.lineId), qty: x.qty, amountPaise: x.amountPaise })) : v.lines;
  const record = () => api(`/pharmacy/invoices/${v.id}/printed`, { method: 'POST', body: { what: creditNote ? 'credit_note' : 'invoice' } });
  const total = lines.reduce((s, l) => s + l.amountPaise, 0);
  const atMrp = lines.reduce((s, l) => s + l.qty * l.mrpPaise, 0);
  const due = creditNote ? total : v.netPaise;
  const who = v.patient ? `${v.patient.fullName} (${v.patient.mrn})` : v.buyer ? v.buyer.name : v.customer?.name || 'Walk-in customer';
  const facts = [
    [creditNote ? 'Credit note no.' : 'Bill no.', creditNote ?? v.number],
    ['Date', formatDateTime(ret ? ret.at : v.date)],
    [v.patient ? 'Patient' : 'Customer', who],
    ['Doctor', v.doctor ? `${v.doctor.name}${v.doctor.reg ? `, Reg. ${v.doctor.reg}` : ''}` : '–'],
    ...(v.kitName ? [['Kit', v.kitName]] : []), // PH14
    ...(v.buyer ? [['GSTIN', v.buyer.gstin], ['Address', buyerAddress(v.buyer)]] : []),
    ...(creditNote ? [['Against bill', v.number]] : stay ? [['Ward', `${stay.ward ?? ''}${stay.bed ? `, bed ${stay.bed}` : ''}`]] : []),
  ];
  return (
    <PrintPreview title={creditNote ? 'Credit note – print preview' : 'Tax invoice – print preview'} hint="Check it, then print on A5 paper." page={{ size: 'A5', margin: '8mm' }} onPrint={record} onClose={onClose}>
      <PrintDocument className="bill-doc ph-doc ph-bill">
        <PharmacyLetterhead settings={settings} />
        <h1 className="pdoc-title ph-bill-title">{creditNote ? 'Credit note' : 'Tax invoice'}</h1>
        <dl className="ph-bill-facts">
          {facts.map(([k, val]) => (
            <div key={k} className={k === 'Address' ? 'is-wide' : undefined}>
              <dt>{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
        <table className="ph-bill-lines">
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Medicine</th>
              <th scope="col">HSN</th>
              <th scope="col">Batch</th>
              <th scope="col">Exp.</th>
              <th scope="col" className="num">Qty</th>
              <th scope="col" className="num">MRP</th>
              <th scope="col" className="num">GST</th>
              <th scope="col" className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td className="num">{i + 1}</td>
                <td>{lineName(l)}</td>
                <td>{l.hsn}</td>
                <td>{l.batch}</td>
                <td className="nowrap">{expiryLabel(l.expiry)}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{paper(l.mrpPaise)}</td>
                <td className="num">{l.gstRate}%</td>
                <td className="num">{paper(l.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ph-bill-foot">
          <div className="ph-bill-words">
            <div className="pdoc-small">
              {lines.length} {lines.length === 1 ? 'item' : 'items'}, {lines.reduce((s, l) => s + l.qty, 0)} units
            </div>
            <div>
              <span className="pdoc-small">Amount in words: </span>
              <strong>{amountInWords(due)}</strong>
            </div>
            <div className="pdoc-small">
              {creditNote ? 'Credited against the bill above.' : v.billId ? 'Payable at the billing desk with the hospital bill.' : v.payments.map((p) => `${p.kind === 'refund' ? 'Refunded' : 'Paid'} ${paper(p.amountPaise)} by ${modeWord(p.mode)}`).join('; ')}
            </div>
          </div>
          <table className="ph-bill-sums">
            <tbody>
              {!creditNote && v.discountPercent > 0 && (
                <>
                  <tr>
                    <th scope="row">Total at MRP</th>
                    <td>{paper(atMrp)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Discount {v.discountPercent}%</th>
                    <td>−{paper(atMrp - total)}</td>
                  </tr>
                </>
              )}
              {!creditNote && (
                <>
                  <tr>
                    <th scope="row">Taxable value</th>
                    <td>{paper(v.taxablePaise)}</td>
                  </tr>
                  <tr>
                    <th scope="row">CGST</th>
                    <td>{paper(v.cgstPaise)}</td>
                  </tr>
                  <tr>
                    <th scope="row">SGST</th>
                    <td>{paper(v.sgstPaise)}</td>
                  </tr>
                  {v.returnedPaise > 0 && (
                    <tr>
                      <th scope="row">Returned</th>
                      <td>−{paper(v.returnedPaise)}</td>
                    </tr>
                  )}
                </>
              )}
              <tr className="ph-bill-net">
                <th scope="row">{creditNote ? 'Credited' : 'Net amount'}</th>
                <td>{paper(due)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="ph-bill-sign">
          <p className="pdoc-small">Prices include GST. This is a computer-generated {creditNote ? 'credit note' : 'invoice'}.</p>
          <div>
            <div>For {settings.name}</div>
            <div className="ph-bill-sign-line">{settings.pharmacistName ? `Pharmacist: ${settings.pharmacistName}` : 'Pharmacist'}</div>
          </div>
        </div>
      </PrintDocument>
    </PrintPreview>
  );
}

function ReturnDialog({ invoice: v, onClose, onDone }) {
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('cash');
  const s = useSend(onDone);
  const items = v.lines.filter((l) => l.canReturn).map((l) => ({ l, n: Number(qty[l.id] ?? 0) }));
  const chosen = items.filter((x) => x.n > 0);
  const ok = chosen.length > 0 && chosen.every((x) => Number.isInteger(x.n) && x.n <= x.l.qty - x.l.returnedQty) && reason.trim().length >= 3;
  return (
    <Modal id="ph-return" title="Take medicines back" onClose={onClose} wide>
      <p>Only unopened medicines, before their expiry. Stock goes back to its batch and a credit note is made.</p>
      <Alert type="error">{s.error}</Alert>
      <table className="bill-lines">
        <thead>
          <tr>
            <th scope="col">Medicine</th>
            <th scope="col" className="num">Sold</th>
            <th scope="col" className="num">Returned</th>
            <th scope="col" className="num">Return now</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ l }) => (
            <tr key={l.id}>
              <td>
                {l.name} <span className="muted">· {l.batch}</span>
              </td>
              <td className="num">{l.qty}</td>
              <td className="num">{l.returnedQty}</td>
              <td className="num">
                <input className="bill-price-input" inputMode="numeric" aria-label={`Return how many ${l.name}`} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-grid">
        <Field label="Reason" id="ph-ret-reason" error={s.fields.reason}>
          <input id="ph-ret-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {!v.billId && (
          <Field label="Money given back by" id="ph-ret-mode">
            <select id="ph-ret-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              {Object.entries(MODE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!ok || s.busy} onClick={() => s.send(`/pharmacy/invoices/${v.id}/returns`, { items: chosen.map((x) => ({ lineId: x.l.id, qty: x.n })), reason: reason.trim(), ...(v.billId ? {} : { refund: { mode } }) })}>
          <RotateCcw aria-hidden="true" /> {s.busy ? 'Saving…' : 'Take back'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/**
 * A sale to a business with a GSTIN: the buyer, and the e-invoice file. The file is the invoice in the Government of
 * India's e-invoice format (schema INV-01, version 1.1); the hospital admin downloads it and uploads it on the
 * e-invoice portal by hand. Perinexa sends nothing to the portal.
 */
function BusinessBuyer({ invoice: v, einvoice }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const download = async (creditNote) => {
    setBusy(creditNote ?? 'invoice');
    setError(null);
    setSaved(null);
    try {
      const { blob, name } = await apiFile(`/pharmacy/invoices/${v.id}/einvoice`, { query: { creditNote } });
      downloadFile(blob, name);
      setSaved(`${savedNote(name)} Give it to your accountant to check before it is uploaded.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const problems = einvoice?.problems ?? [];
  return (
    <section className="card bill-section ph-einvoice" aria-labelledby="ph-einv">
      <h2 id="ph-einv">Business buyer and e-invoice file</h2>
      <p>
        <strong>{v.buyer.name}</strong> · GSTIN {v.buyer.gstin} · {buyerAddress(v.buyer)}
      </p>
      <ul>
        <li>Sales to patients need no e-invoice. This file is only for this sale to a business that gave its GSTIN.</li>
        <li>Perinexa does not connect to the e-invoice portal. The file is downloaded here and uploaded on the portal by hand; the portal then gives the invoice its reference number (IRN) and QR code.</li>
        <li>Your accountant must check the file before it is uploaded – and whether e-invoicing applies to this pharmacy at all (it depends on the yearly turnover).</li>
        {v.buyer.stateCode && einvoice?.sellerStateCode && v.buyer.stateCode !== einvoice.sellerStateCode && (
          <li>This buyer is registered in another state. The invoice charges CGST and SGST because the medicines were handed over at the pharmacy’s counter: ask the accountant whether that is right for this buyer.</li>
        )}
      </ul>
      {problems.length > 0 && (
        <Alert type="warning">
          The file cannot be made yet:
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      <Alert type="success" onClose={() => setSaved(null)}>
        {saved}
      </Alert>
      {einvoice?.canDownload ? (
        <div className="row">
          <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || problems.length > 0} onClick={() => download()}>
            <FileJson aria-hidden="true" /> {busy === 'invoice' ? 'Making the file…' : 'Download the e-invoice file'}
          </button>
          {v.returns.map((r) => (
            <button key={r.number} type="button" className="btn btn-secondary" disabled={Boolean(busy) || problems.length > 0} onClick={() => download(r.number)}>
              <FileJson aria-hidden="true" /> {busy === r.number ? 'Making the file…' : `File for credit note ${r.number}`}
            </button>
          ))}
        </div>
      ) : (
        <p className="hint">The hospital admin downloads the e-invoice file from this page.</p>
      )}
    </section>
  );
}

/**
 * The patient's account with the pharmacy (18 Nov 2026; under the dates in the left panel since 19 Nov 2026): credit
 * due on her bills, settled in one payment, and her advance.
 */
function PersonAccount({ person, billId, onPaid }) {
  const [settling, setSettling] = useState(false);
  const dues = useFetch(`/pharmacy/patients/${person.key}/dues`);
  const due = dues.data?.duePaise ?? 0;
  return (
    <section className="ph-acct" aria-label="Credit and advance">
      <div className="ph-acct-row">
        <span className="ph-acct-label">
          <Wallet aria-hidden="true" /> Credit due
        </span>
        <strong className="ph-acct-amount">{dues.data ? money(due) : '…'}</strong>
        {due > 0 && (
          <button type="button" className="btn btn-link btn-sm ph-acct-act" onClick={() => setSettling(true)}>
            Settle credit
          </button>
        )}
      </div>
      {dues.data && (
        <p className="ph-acct-note">
          {due > 0 ? (
            <>Due on {dues.data.bills.map((b) => b.number).join(', ')}</>
          ) : (
            <>
              <CircleCheck aria-hidden="true" /> Nothing due
            </>
          )}
        </p>
      )}
      <AdvancePanel
        patientId={person.key}
        name={person.name}
        duePaise={due}
        billId={billId}
        onUsed={() => {
          dues.reload();
          onPaid();
        }}
      />
      {settling && (
        <ReceivePayment
          settle={{ patientId: person.key, name: person.name, duePaise: due, count: dues.data.bills.length }}
          onClose={() => setSettling(false)}
          onDone={() => {
            setSettling(false);
            dues.reload();
            onPaid();
          }}
        />
      )}
    </section>
  );
}

/** A bill on credit paid later (13 Nov 2026): how, how much (what is due by default) and the reference. */
/**
 * Pharmacy advance (18 Nov 2026, the pharmacy's request): what the patient has left with the pharmacy; take a deposit,
 * use it on her bills still due (oldest first), or refund what is left.
 */
function AdvancePanel({ patientId, name, duePaise, billId = null, onUsed }) {
  const adv = useFetch(`/pharmacy/patients/${patientId}/advance`);
  const [doing, setDoing] = useState(null); // 'deposit' | 'refund'
  const [note, setNote] = useState(null);
  const use = useSend((r) => {
    setNote(`${money(r.paid.reduce((n, p) => n + p.amountPaise, 0))} of the advance put on ${r.paid.map((p) => p.number).join(', ')}.`);
    adv.reload();
    onUsed();
  });
  const left = adv.data?.balancePaise ?? 0;
  return (
    <div className="ph-acct-adv" aria-label="Pharmacy advance">
      <div className="ph-acct-row">
        <span className="ph-acct-label">
          <Wallet aria-hidden="true" /> Advance left
        </span>
        <strong className="ph-acct-amount">{adv.data ? money(left) : '…'}</strong>
      </div>
      <div className="ph-acct-more">
        <button type="button" className="btn btn-link btn-sm ph-acct-act" onClick={() => setDoing('deposit')}>
          Take advance
        </button>
        {billId && (
          <Link className="btn btn-link btn-sm ph-acct-act" to={`/pharmacy/invoices/${billId}`}>
            Open the bill
          </Link>
        )}
        {left > 0 && duePaise > 0 && (
          <button type="button" className="btn btn-link btn-sm ph-acct-act" disabled={use.busy} onClick={() => use.send(`/pharmacy/patients/${patientId}/advance/use`, {})}>
            Use on bills due
          </button>
        )}
        {left > 0 && (
          <button type="button" className="btn btn-link btn-sm ph-acct-act" onClick={() => setDoing('refund')}>
            Refund
          </button>
        )}
      </div>
      {(use.error || note) && <span className={use.error ? 'field-error' : 'ph-acct-note'}>{use.error || note}</span>}
      {doing && (
        <AdvanceDialog
          refund={doing === 'refund'}
          patientId={patientId}
          name={name}
          leftPaise={left}
          onClose={() => setDoing(null)}
          onDone={(r) => {
            setDoing(null);
            setNote(doing === 'refund' ? `Refunded – receipt ${r.number}.` : `Advance taken – receipt ${r.number}.`);
            adv.reload();
          }}
        />
      )}
    </div>
  );
}

function AdvanceDialog({ refund, patientId, name, leftPaise, onClose, onDone }) {
  const [mode, setMode] = useState('cash');
  const [amount, setAmount] = useState(refund ? (leftPaise / 100).toFixed(2) : '');
  const [extra, setExtra] = useState(''); // a deposit's reference, a refund's reason
  const s = useSend(onDone);
  const paise = /^\d+(\.\d{0,2})?$/.test(amount.trim()) ? Math.round(Number(amount) * 100) : null;
  const cardWrong = !refund && mode === 'card' && extra.trim() !== '' && !/^\d{4}$/.test(extra.trim());
  const ok = paise > 0 && (!refund || (paise <= leftPaise && extra.trim().length >= 3)) && !cardWrong;
  return (
    <Modal id="ph-advance" title={refund ? `Refund advance – ${name}` : `Take advance – ${name}`} onClose={onClose}>
      <Alert type="error">{s.error}</Alert>
      {refund && <p className="hint">Advance left: {money(leftPaise)}.</p>}
      <div className="form-grid">
        <Field label={refund ? 'Given back by' : 'Paid by'} id="adv-mode">
          <select id="adv-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount ₹" id="adv-amount" error={s.fields.amountPaise}>
          <input id="adv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {refund ? (
          <Field label="Reason for the refund" id="adv-reason" error={s.fields.reason}>
            <input id="adv-reason" value={extra} maxLength={200} onChange={(e) => setExtra(e.target.value)} />
          </Field>
        ) : (
          mode !== 'cash' && (
            <Field label={mode === 'card' ? 'Card no (last 4 digits)' : mode === 'cheque' ? 'Cheque no' : 'Transaction id'} id="adv-ref" error={cardWrong ? 'Only the last 4 digits of the card.' : s.fields.reference}>
              <input id="adv-ref" value={extra} maxLength={mode === 'card' ? 4 : 80} autoComplete="off" onChange={(e) => setExtra(mode === 'card' ? e.target.value.replace(/\D/g, '') : e.target.value)} />
            </Field>
          )
        )}
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ok || s.busy}
          onClick={() => s.send(refund ? `/pharmacy/patients/${patientId}/advance/refund` : `/pharmacy/patients/${patientId}/advance`, refund ? { amountPaise: paise, mode, reason: extra.trim() } : { amountPaise: paise, mode, ...(extra.trim() && mode !== 'cash' ? { reference: extra.trim() } : {}) })}
        >
          {s.busy ? 'Saving…' : refund ? 'Save the refund' : 'Save the advance'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function ReceivePayment({ invoice: v = null, settle = null, onClose, onDone }) {
  // One bill's payment, or (settle: { patientId, name, duePaise, count }) a settlement of all a patient owes – 18 Nov 2026
  const due = settle ? settle.duePaise : (v.balancePaise ?? 0);
  const [mode, setMode] = useState('cash');
  const [amount, setAmount] = useState((due / 100).toFixed(2));
  const [reference, setReference] = useState('');
  const s = useSend((res) => onDone(settle ? res : res.invoice));
  const paise = /^\d+(\.\d{0,2})?$/.test(amount.trim()) ? Math.round(Number(amount) * 100) : null;
  const cardWrong = mode === 'card' && reference.trim() !== '' && !/^\d{4}$/.test(reference.trim());
  const ok = paise > 0 && paise <= due && !cardWrong;
  const path = settle ? `/pharmacy/patients/${settle.patientId}/settle` : `/pharmacy/invoices/${v.id}/payments`;
  return (
    <Modal id="ph-receive" title={settle ? `Settle credit – ${settle.name}` : `Receive payment – ${v.number}`} onClose={onClose}>
      <Alert type="error">{s.error}</Alert>
      <p className="hint">{settle ? `Due on ${settle.count} ${settle.count === 1 ? 'bill' : 'bills'}: ${money(due)}. The payment is put on the oldest bill first.` : `Due on this bill: ${money(due)}.`}</p>
      <div className="form-grid">
        <Field label="Paid by" id="rp-mode">
          <select id="rp-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount ₹" id="rp-amount" error={s.fields.payments}>
          <input id="rp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {mode !== 'cash' && (
          <Field label={mode === 'card' ? 'Card no (last 4 digits)' : mode === 'cheque' ? 'Cheque no' : 'Transaction id'} id="rp-ref" error={cardWrong ? 'Only the last 4 digits of the card.' : undefined}>
            <input id="rp-ref" value={reference} maxLength={mode === 'card' ? 4 : 80} autoComplete="off" onChange={(e) => setReference(mode === 'card' ? e.target.value.replace(/\D/g, '') : e.target.value)} />
          </Field>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!ok || s.busy} onClick={() => s.send(path, { payments: [{ mode, amountPaise: paise, ...(reference.trim() ? { reference: reference.trim() } : {}) }] })}>
          {s.busy ? 'Saving…' : 'Save payment'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** The invoice's state as a pill – colour, icon and words: paid here, on the hospital bill, money due, or returned. */
function InvoiceStatus({ invoice: v }) {
  const look = v.billId
    ? { tone: 'due', icon: Building2, text: 'On hospital bill' }
    : (v.balancePaise ?? 0) > 0
      ? { tone: 'watch', icon: CircleAlert, text: 'Payment due' }
      : { tone: 'stable', icon: CircleCheck, text: 'Paid' };
  return (
    <div className="ph-inv-status">
      <StatusPill tone={look.tone} icon={look.icon}>
        {look.text}
      </StatusPill>
      {v.returnedPaise > 0 && (
        <StatusPill tone="watch" icon={RotateCcw}>
          {v.netPaise <= 0 ? 'Returned' : 'Part returned'}
        </StatusPill>
      )}
    </div>
  );
}

export function InvoicePage() {
  const { id } = useParams();
  const location = useLocation();
  const { activeMembership } = useAuth();
  const res = useFetch(`/pharmacy/invoices/${id}`);
  const [invoice, setInvoice] = useState(null);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [returning, setReturning] = useState(false);
  const [printing, setPrinting] = useState(null); // { creditNote? }
  const [receiving, setReceiving] = useState(false); // a bill on credit paid later
  const v = invoice ?? res.data?.invoice;
  if (res.error && !v) return <div className="pf-content"><Alert type="error">{res.error}</Alert></div>;
  if (!v) return <div className="pf-content"><p className="muted" aria-busy="true">Loading the invoice…</p></div>;
  const desk = activeMembership.roles.includes('pharmacist');
  const printItems = [{ label: 'Bill', icon: Printer, onSelect: () => setPrinting({ bill: true }) }, { label: 'Tax invoice', icon: Printer, onSelect: () => setPrinting({}) }, ...v.returns.map((r) => ({ label: `Credit note ${r.number}`, icon: Printer, onSelect: () => setPrinting({ creditNote: r.number }) }))];
  return (
    <>
      <PharmacyHeader
        className="ph-counter-head"
        title={`Invoice ${v.number}`}
        crumb={v.number}
        actions={
          <>
            {desk && v.lines.some((l) => l.canReturn) && (
              <button type="button" className="btn btn-secondary" onClick={() => setReturning(true)}>
                <RotateCcw aria-hidden="true" /> Take back
              </button>
            )}
            <MenuButton className="btn btn-primary" icon={Printer} label="Print" items={printItems} align="end" />
          </>
        }
      />
      {/* One invoice, laid out as an invoice (13 Nov 2026): the bill on the left – number, date and status, who it is
          for, the medicines and the totals; beside it how it was paid, what came back and the prescription. 18 Nov 2026 (the
          pharmacy): compact, as the earlier software – the whole bill on one screen */}
      <div className="pf-content bill-page ph-inv-page">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <div className="ph-inv">
          {/* 19 Nov 2026 (the developer): the bill itself as it prints – the store's letterhead, the bill's details,
              the medicines and the sums – under a slim line with what it is, who it is for, its state and who billed it */}
          <section className="ph-inv-main ph-inv-paper" aria-labelledby="ph-inv-no">
            <div className="ph-inv-strip">
              <span className={`ph-inv-kind is-${v.kind === 'issue' ? 'ipd' : v.patient ? 'opd' : 'ext'}`}>{v.kind === 'issue' ? 'Issue to ward · IPD' : v.patient ? 'Counter sale · OPD' : 'Counter sale · External'}</span>
              <h2 id="ph-inv-no" className="sr-only">Bill no. {v.number}</h2>
              <span className="ph-inv-strip-who">{v.patient ? v.patient.fullName : whoOf(v)}</span>
              <InvoiceStatus invoice={v} />
              <span className="muted">Billed by {v.byName || '–'}</span>
            </div>
            <div className="ph-slip-sheet">
              <BillPaper invoice={v} settings={res.data?.settings ?? {}} />
            </div>
          </section>

          <aside className="ph-inv-side">
            <section className="card ph-inv-card" aria-labelledby="ph-inv-pay">
              <h2 id="ph-inv-pay">Payment</h2>
              {v.billId ? (
                <p className="ph-inv-note">
                  On the patient’s hospital bill – paid at the billing desk. <Link to={`/billing/bills/${v.billId}`}>Open the bill</Link>
                </p>
              ) : (
                <dl className="ph-inv-paid">
                  <div>
                    <dt>Paid</dt>
                    <dd>{money(v.paidPaise ?? 0)}</dd>
                  </div>
                  {/* 18 Nov 2026 (the pharmacy, as the earlier software): this bill's credit, her earlier credit, and
                      all she owes the pharmacy (Outstanding); a walk-in pays in full and has no credit */}
                  <div>
                    <dt>{v.patient ? 'Credit Amt' : 'Balance'}</dt>
                    <dd>{money(Math.max(0, v.balancePaise ?? 0))}</dd>
                  </div>
                  {v.patient && v.earlierDuePaise > 0 && (
                    <div>
                      <dt>Previous credit</dt>
                      <dd>{money(v.earlierDuePaise)}</dd>
                    </div>
                  )}
                  {v.patient && (
                    <div className="is-total">
                      <dt>Outstanding</dt>
                      <dd>{money(Math.max(0, v.balancePaise ?? 0) + (v.earlierDuePaise ?? 0))}</dd>
                    </div>
                  )}
                </dl>
              )}
              {desk && !v.billId && (v.balancePaise ?? 0) > 0 && (
                <button type="button" className="btn btn-secondary btn-sm ph-inv-receive" onClick={() => setReceiving(true)}>
                  Receive payment
                </button>
              )}
              {v.payments.length > 0 && (
                <ul className="ph-inv-list">
                  {v.payments.map((p, i) => (
                    <li key={`p${i}`}>
                      <div className="ph-inv-row">
                        <strong>{p.kind === 'refund' ? `Refund · ${modeWord(p.mode)}` : modeWord(p.mode)}</strong>
                        <span className="tabular">
                          {p.kind === 'refund' ? '−' : ''}
                          {money(p.amountPaise)}
                        </span>
                      </div>
                      <div className="ph-inv-meta">
                        {[p.reference && (p.mode === 'card' ? `card ending ${p.reference}` : p.reference), p.bank, p.authorisedBy && `authorised by ${p.authorisedBy}`, p.narration, formatDateTime(p.at), p.byName].filter(Boolean).join(' · ')}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {v.creditAuthorisedBy && <p className="hint">Credit authorised by: {v.creditAuthorisedBy}</p>}
              {v.paymentRemarks && <p className="hint">Remarks: {v.paymentRemarks}</p>}
            </section>
            {v.returns.length > 0 && (
              <section className="card ph-inv-card" aria-labelledby="ph-inv-ret">
                <h2 id="ph-inv-ret">Returns</h2>
                <ul className="ph-inv-list">
                  {v.returns.map((r) => (
                    <li key={r.number}>
                      <div className="ph-inv-row">
                        <strong>Credit note {r.number}</strong>
                        <span className="tabular">{money(r.amountPaise)}</span>
                      </div>
                      <div className="ph-inv-meta">{[r.reason, formatDateTime(r.at), r.byName].filter(Boolean).join(' · ')}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {v.doctor && (
              <section className="card ph-inv-card" aria-labelledby="ph-inv-rx">
                <h2 id="ph-inv-rx">Prescription</h2>
                <p className="ph-inv-note">
                  {v.doctor.name}
                  {v.doctor.reg ? ` (Reg. ${v.doctor.reg})` : ''}
                  {v.fromPrescription ? ' – Perinexa prescription' : v.rxSeen ? ' – outside prescription seen' : ''}
                </p>
              </section>
            )}
            {v.buyer && <BusinessBuyer invoice={v} einvoice={res.data?.einvoice} />}
            {activeMembership.roles.includes('admin') && <TallyMarks model="invoice" id={v.id} />}
          </aside>
        </div>
      </div>
      {receiving && (
        <ReceivePayment
          invoice={v}
          onClose={() => setReceiving(false)}
          onDone={(next) => {
            setInvoice(next);
            setReceiving(false);
            setFlash('Payment received.');
          }}
        />
      )}
      {returning && (
        <ReturnDialog
          invoice={v}
          onClose={() => setReturning(false)}
          onDone={(out) => {
            setInvoice(out.invoice);
            setReturning(false);
            setFlash(`Taken back – credit note ${out.creditNote}.`);
          }}
        />
      )}
      {printing?.bill && res.data && <BillPrint invoice={v} settings={res.data.settings} onClose={() => setPrinting(null)} />}
      {printing && !printing.bill && res.data && <InvoicePrint invoice={v} settings={res.data.settings} stay={res.data.stay} creditNote={printing.creditNote ?? null} onClose={() => setPrinting(null)} />}
    </>
  );
}
