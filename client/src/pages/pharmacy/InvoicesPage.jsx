import { useEffect, useRef, useState } from 'react';
import { BedDouble, ChevronLeft, ChevronRight, FileJson, Printer, ReceiptText, RotateCcw, Stethoscope, UserPlus, Users } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, apiFile } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, formatDateTime, useDebounced } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { savedNote } from '../../platform/androidApp.js';
import { addDaysIso } from '../appointments/appointmentFormat.js';
import { TallyMarks } from '../billing/TallyPage.jsx';
import { amountInWords } from '../billing/amountWords.js';
import { MODE_LABELS, expiryLabel, soldItems } from './pharmacyFormat.js';
import { Modal, PharmacyHeader, PharmacyLetterhead, ScheduleMark, money, useSend } from './pharmacyUi.jsx';
import { TypePill } from './RegisterPage.jsx';

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
const typeOf = (v) => (v.kind === 'issue' ? 'ipd' : v.patient ? 'opd' : 'external');
/** A bill fits an amount by its first digits (12 finds 12, 120 and 1,200), and "hospital" means a patient's bill. */
export const billFits = (v, { type = 'all', doctor = '', amount = '', paidBy = '' }) =>
  (type === 'all' || typeOf(v) === type) &&
  (!doctor || v.doctor?.name === doctor) &&
  (!amount || String(v.netPaise / 100).startsWith(amount)) &&
  (!paidBy || (paidBy === 'hospital' ? Boolean(v.patient) : (v.payments ?? []).some((p) => p.mode === paidBy)));

export function InvoicesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { activeMembership } = useAuth();
  const desk = activeMembership.roles.includes('pharmacist');
  const start = useLocation().state?.find; // a double click on a patient elsewhere: their patient number
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 300);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : undefined;
  const res = useFetch('/pharmacy/invoices', search.length >= 2 ? { search } : { date });
  const day = date ?? res.data?.today;

  // The pharmacist's filters, in a panel at the side like the store's earlier software (5 Nov 2026), with no button to
  // press: every change narrows the list beside them at once. Type, doctor and day narrow the bills; typing a patient's
  // name or number lists the people found from the first letter, with their bills of every date, old and new.
  const [type, setType] = useState('all');
  const [doctor, setDoctor] = useState('');
  const [nameText, setNameText] = useState('');
  const [mrnText, setMrnText] = useState(start ?? '');
  const [amountText, setAmountText] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [person, setPerson] = useState(null);
  const go = (d) => {
    setParams({ date: d }, { replace: true });
    setPerson(null);
  };
  const name = useDebounced(nameText.trim(), 300);
  const mrn = useDebounced(mrnText.trim(), 300);
  const amount = useDebounced(amountText.replace(/[^\d.]/g, ''), 300).replace(/^\./, '');
  const looking = desk && Boolean(name || mrn);
  const doctors = useFetch(desk ? '/pharmacy/invoices/doctors' : null);
  const found = useFetch(
    looking ? '/pharmacy/invoices/people' : null,
    looking ? { ...(name ? { search: name } : {}), ...(mrn ? { mrn } : {}), ...(type !== 'all' ? { type } : {}), ...(doctor ? { doctor } : {}), ...(amount ? { amount } : {}), ...(paidBy ? { paidBy } : {}) } : undefined,
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
  const typed = (set) => (e) => {
    set(e.target.value);
    setPerson(null);
  };
  const closePerson = () => {
    setPerson(null);
    setNameText('');
    setMrnText('');
  };

  // Phones, as in the app design (2 Nov 2026): how many bills and their total above the list
  const onPhone = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 719px)').matches);
  const bills = res.data?.invoices?.filter((v) => !desk || billFits(v, { type, doctor, amount, paidBy }));
  const filtering = desk && (type !== 'all' || doctor || amountText || paidBy || nameText || mrnText || text);
  const billSearch = <input type="search" className="bill-search-plain" aria-label="Find a bill" placeholder="Bill number or a medicine" value={text} onChange={(e) => setText(e.target.value)} />;
  const dayNav = day && (
    <div className="appt-daynav" role="group" aria-label="Day">
      <button type="button" className="icon-btn" onClick={() => go(addDaysIso(day, -1))} aria-label="Previous day">
        <ChevronLeft aria-hidden="true" />
      </button>
      <input type="date" aria-label="Day" value={day} onChange={(e) => e.target.value && go(e.target.value)} />
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
          { key: 'items', header: 'Medicines sold', render: (v) => soldItems(v.lines) },
          { key: 'net', header: 'Amount', align: 'right', render: (v) => <span className="tabular">{money(v.netPaise)}</span> },
        ]}
      />
    </>
  );
  return (
    <>
      <PharmacyHeader
        className="ph-fab"
        title="Sold"
        crumb="Sold"
        actions={
          desk && (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/pharmacy')}>
              <ReceiptText aria-hidden="true" /> New bill
            </button>
          )
        }
      />
      <div className="pf-content bill-page ph-sold">
        {desk ? (
          <div className="ph-sold-split">
            <section className="card ph-filters" aria-label="Find bills">
              <div className="segmented" role="group" aria-label="Type of patient">
                {TYPE_CHOICES.map(([k, label, Icon]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={type === k}
                    onClick={() => {
                      setType(k);
                      setPerson(null);
                    }}
                  >
                    <Icon aria-hidden="true" /> {label}
                  </button>
                ))}
              </div>
              <div className="ph-filter-row">
                <div className="ph-filter">
                  <span>Date</span>
                  {dayNav}
                </div>
                <label className="ph-filter">
                  <span>Patient number</span>
                  <input type="search" value={mrnText} maxLength={40} placeholder="UHID" onChange={typed(setMrnText)} />
                </label>
                <label className="ph-filter">
                  <span>Patient name</span>
                  <input type="search" value={nameText} maxLength={100} placeholder="Name or phone" onChange={typed(setNameText)} />
                </label>
                <label className="ph-filter">
                  <span>Doctor name</span>
                  <select value={doctor} onChange={typed(setDoctor)}>
                    <option value="">All doctors</option>
                    {(doctors.data?.doctors ?? []).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ph-filter">
                  <span>Amount ₹</span>
                  <input inputMode="decimal" value={amountText} maxLength={12} placeholder="e.g. 1200" onChange={typed(setAmountText)} />
                </label>
                <label className="ph-filter">
                  <span>Paid by</span>
                  <select value={paidBy} onChange={typed(setPaidBy)}>
                    <option value="">All</option>
                    <option value="hospital">On the hospital bill</option>
                    {Object.entries(MODE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ph-filter">
                  <span>Bill or medicine</span>
                  {billSearch}
                </label>
              </div>
            </section>
            <div className="ph-sold-results">
              {person ? (
                <PersonBills key={person.key} person={person} onClose={closePerson} />
              ) : looking ? (
                <PeopleFound found={found} people={people} onPick={setPerson} />
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

/** The people a search found: nothing is listed until something is typed. */
function PeopleFound({ found, people, onPick }) {
  const navigate = useNavigate();
  return (
    <section className="card ph-found" aria-label="People found">
      {found.error && <Alert type="error">{found.error}</Alert>}
      {found.data && !people.length && <p className="muted">Nobody with a pharmacy bill matches.</p>}
      {people.length > 0 && <p className="hint">Everyone with a pharmacy bill who matches, old and new. Click a name to see their bills.</p>}
      <ul>
        {people.map((x) => (
          <li key={x.key}>
            <button type="button" title="Double-click to open the full bill" onClick={() => onPick(x)} onDoubleClick={() => navigate(`/pharmacy/invoices/${x.bills[0].id}`)}>
              <strong>{x.name}</strong>
              <span className="tabular">{x.mrn}</span>
              <TypePill type={x.type} />
              <span>
                {x.billCount} bill{x.billCount === 1 ? '' : 's'}
              </span>
              <span className="tabular">{slipDate(x.lastAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      {found.data?.more && <p className="hint">The latest {people.length} are listed. Type more of the name to find anyone else.</p>}
    </section>
  );
}

/** One person's bills: the newest shown as it prints, across the page, the others a click away. */
function PersonBills({ person, onClose }) {
  const [billId, setBillId] = useState(person.bills[0].id);
  const [printing, setPrinting] = useState(false);
  const res = useFetch(`/pharmacy/invoices/${billId}`);
  const v = res.data?.invoice;
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
          <Link className="btn btn-secondary" to={`/pharmacy/invoices/${billId}`}>
            Open the bill
          </Link>
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
            <th scope="col">Batch No</th>
            <th scope="col">Expiry</th>
            <th scope="col" className="num">Disc Amt</th>
            <th scope="col" className="num">Qty</th>
            <th scope="col" className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {v.lines.map((l, i) => (
            <tr key={l.id}>
              <td>{i + 1}</td>
              <td>{lineName(l)}</td>
              <td>{l.batch}</td>
              <td className="nowrap">{expiryLabel(l.expiry).replace(' ', '-')}</td>
              <td className="num">{plain(Math.max(0, l.qty * l.mrpPaise - l.amountPaise))}</td>
              <td className="num">{l.qty.toFixed(2)}</td>
              <td className="num">{plain(l.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ph-slip-sums">
        <div>
          <span>Gross</span>
          <span>{plain(v.totalPaise)}</span>
        </div>
        {v.returnedPaise > 0 && (
          <div>
            <span>Returned</span>
            <span>−{plain(v.returnedPaise)}</span>
          </div>
        )}
        {v.patient ? (
          <div>Payable at the billing desk with the hospital bill</div>
        ) : (
          <div>
            <span>Paid Amount</span>
            <span>{plain(v.paidPaise ?? 0)}</span>
          </div>
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
              {creditNote ? 'Credited against the bill above.' : v.patient ? 'Payable at the billing desk with the hospital bill.' : v.payments.map((p) => `${p.kind === 'refund' ? 'Refunded' : 'Paid'} ${paper(p.amountPaise)} by ${MODE_LABELS[p.mode]}`).join('; ')}
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
        {!v.patient && (
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
        <button type="button" className="btn btn-primary" disabled={!ok || s.busy} onClick={() => s.send(`/pharmacy/invoices/${v.id}/returns`, { items: chosen.map((x) => ({ lineId: x.l.id, qty: x.n })), reason: reason.trim(), ...(v.patient ? {} : { refund: { mode } }) })}>
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

export function InvoicePage() {
  const { id } = useParams();
  const location = useLocation();
  const { activeMembership } = useAuth();
  const res = useFetch(`/pharmacy/invoices/${id}`);
  const [invoice, setInvoice] = useState(null);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [returning, setReturning] = useState(false);
  const [printing, setPrinting] = useState(null); // { creditNote? }
  const v = invoice ?? res.data?.invoice;
  if (res.error && !v) return <div className="pf-content"><Alert type="error">{res.error}</Alert></div>;
  if (!v) return <div className="pf-content"><p className="muted" aria-busy="true">Loading the invoice…</p></div>;
  const desk = activeMembership.roles.includes('pharmacist');
  const printItems = [{ label: 'Bill', icon: Printer, onSelect: () => setPrinting({ bill: true }) }, { label: 'Tax invoice', icon: Printer, onSelect: () => setPrinting({}) }, ...v.returns.map((r) => ({ label: `Credit note ${r.number}`, icon: Printer, onSelect: () => setPrinting({ creditNote: r.number }) }))];
  return (
    <>
      <PharmacyHeader
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
      <div className="pf-content bill-page">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        {v.billId && (
          <p className="hint">
            On her hospital bill: <Link to={`/billing/bills/${v.billId}`}>open the bill</Link> (reception takes the payment).
          </p>
        )}
        {activeMembership.roles.includes('admin') && <TallyMarks model="invoice" id={v.id} />}
        <section className="card bill-section">
          <dl className="ph-inv-facts">
            {[
              ['Type', v.kind === 'issue' ? 'IPD – issue to an admitted patient' : v.patient ? 'OPD – counter sale' : 'External – counter sale'],
              [v.patient ? 'Patient' : 'Customer', v.patient ? v.patient.fullName : whoOf(v)],
              ...(v.patient ? [['Patient number', v.patient.mrn]] : []),
              ['Date and time', formatDateTime(v.date)],
              ['Doctor', v.doctor?.name || '–'],
              ['Billed by', v.byName],
            ].map(([k, val]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{val}</dd>
              </div>
            ))}
          </dl>
          <table className="bill-lines">
            <thead>
              <tr>
                <th scope="col" className="num">Sr.</th>
                <th scope="col">Medicine</th>
                <th scope="col">Batch</th>
                <th scope="col">Expiry</th>
                <th scope="col" className="num">Qty</th>
                <th scope="col" className="num">MRP</th>
                <th scope="col" className="num">GST</th>
                <th scope="col" className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {v.lines.map((l, i) => (
                <tr key={l.id}>
                  <td data-label="Sr." className="num">{i + 1}</td>
                  <td data-label="Medicine">
                    {l.name} <ScheduleMark schedule={l.schedule} />
                    {l.returnedQty > 0 && <span className="muted"> · {l.returnedQty} returned</span>}
                  </td>
                  <td data-label="Batch">{l.batch}</td>
                  <td data-label="Expiry">{expiryLabel(l.expiry)}</td>
                  <td data-label="Qty" className="num">{l.qty}</td>
                  <td data-label="MRP" className="num">{paper(l.mrpPaise)}</td>
                  <td data-label="GST" className="num">{l.gstRate}%</td>
                  <td data-label="Amount" className="num">{paper(l.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="bill-sums">
            <tbody>
              {v.discountPercent > 0 && (
                <tr>
                  <th scope="row">Discount</th>
                  <td>
                    {v.discountPercent}% – {v.discountReason}
                  </td>
                </tr>
              )}
              {v.returnedPaise > 0 && (
                <tr>
                  <th scope="row">Returned</th>
                  <td>−{paper(v.returnedPaise)}</td>
                </tr>
              )}
              <tr>
                <th scope="row">Taxable value</th>
                <td>{paper(v.taxablePaise)}</td>
              </tr>
              <tr>
                <th scope="row">CGST + SGST</th>
                <td>
                  {paper(v.cgstPaise)} + {paper(v.sgstPaise)}
                </td>
              </tr>
              <tr className="bill-balance">
                <th scope="row">Total</th>
                <td>{paper(v.netPaise)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        {v.buyer && <BusinessBuyer invoice={v} einvoice={res.data?.einvoice} />}
        {(v.payments.length > 0 || v.returns.length > 0) && (
          <section className="card bill-section">
            <h2>Payments and returns</h2>
            <ul className="appt-lines">
              {v.payments.map((p, i) => (
                <li key={`p${i}`}>
                  {p.kind === 'refund' ? 'Refund' : 'Paid'} {money(p.amountPaise)} · {MODE_LABELS[p.mode]}
                  {p.reference ? ` · ${p.reference}` : ''} <span className="muted">· {formatDateTime(p.at)} · {p.byName}</span>
                </li>
              ))}
              {v.returns.map((r) => (
                <li key={r.number}>
                  Credit note {r.number}: {money(r.amountPaise)} – {r.reason} <span className="muted">· {formatDateTime(r.at)} · {r.byName}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {v.doctor && (
          <p className="hint">
            Prescribed by {v.doctor.name}
            {v.doctor.reg ? ` (Reg. ${v.doctor.reg})` : ''}
            {v.fromPrescription ? ' – Perinexa prescription' : v.rxSeen ? ' – outside prescription seen' : ''}.
          </p>
        )}
      </div>
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
