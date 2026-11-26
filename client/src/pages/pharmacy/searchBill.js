// Search bill (23 Nov 2026, the developer, after the "Browse Sales Bill" window of the pharmacy's earlier software):
// the small pure pieces of SearchBillPage.jsx – the search as it starts, what Show asks the server for, and the words
// and sums of the printed list. The server's part is routes/pharmacyBillSearch.js.

// In the order of the earlier window
export const TYPE_CHOICES = [
  ['opd', 'OPD'],
  ['ipd', 'IPD'],
  ['external', 'External'],
  ['all', 'All'],
];
export const PAY_CHOICES = [
  ['cash', 'Cash'],
  ['credit', 'Credit'],
  ['all', 'All'],
];
// Search sale return (26 Nov 2026, the pharmacy's request): the bills, or the returns – cash return (money given back)
// or credit return (off what she owed, or off her hospital bill)
export const SHOW_CHOICES = [
  ['bills', 'Sales bill'],
  ['returns', 'Sale return'],
];
export const RETURN_PAY_CHOICES = [
  ['cash', 'Cash return'],
  ['credit', 'Credit return'],
  ['all', 'All'],
];
const labelOf = (choices, key) => choices.find(([k]) => k === key)?.[1] ?? '';

const pad2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A moment's day on this computer, "2026-11-21" (the day the pharmacist sees on the clock). */
export const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** "2026-11-21" → "21 Nov 2026". */
export const dayWords = (iso) => {
  const [y, m, d] = String(iso ?? '').split('-').map(Number);
  return y && m >= 1 && m <= 12 && d ? `${d} ${MONTHS[m - 1]} ${y}` : '';
};
/** The day 366 days before (the longest period the server searches at once). */
export const yearBefore = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 366);
  return d.toISOString().slice(0, 10);
};

/** The search as the page opens: every type, today's bills (Date ticked), cash and credit. */
export const newSearch = (today, show = 'bills') => ({ show, type: 'all', byName: false, first: '', last: '', byMrn: false, mrn: '', byNumber: false, number: '', byDate: true, from: today, to: today, item: '', pay: 'all' });

/** Is this a whole search (every box, of the right kind)? What the page kept in its history entry is checked before it is used. */
export const isSearch = (f) => Boolean(f) && typeof f === 'object' && Object.entries(newSearch('')).every(([k, v]) => typeof f[k] === typeof v);

/** What Show asks the server for: only the parts that are ticked and filled in. */
export function searchQuery(f) {
  const q = {};
  if (f.show === 'returns') q.show = 'returns';
  if (f.type !== 'all') q.type = f.type;
  if (f.byName && f.first.trim()) q.first = f.first.trim();
  if (f.byName && f.last.trim()) q.last = f.last.trim();
  if (f.byMrn && f.mrn.trim()) q.mrn = f.mrn.trim();
  if (f.byNumber && f.number.trim()) q.number = f.number.trim();
  if (f.byDate && f.from) q.from = f.from;
  if (f.byDate && f.to) q.to = f.to;
  if (f.item.trim()) q.item = f.item.trim();
  if (f.pay !== 'all') q.pay = f.pay;
  return q;
}

/** Why Show cannot search yet, or null. */
export function searchProblem(f) {
  if (f.byDate && f.from && f.to && f.to < f.from) return 'The To date is before the From date.';
  if (f.byDate && f.from && f.to && f.from < yearBefore(f.to)) return 'Choose dates at most one year apart.';
  return null;
}

/** The search for one admitted patient: her IPD bills from the day she was admitted until today. */
export function admittedSearch(stay, today) {
  const admitted = stay.admittedAt ? isoOf(new Date(stay.admittedAt)) : today;
  const from = admitted > today ? today : admitted < yearBefore(today) ? yearBefore(today) : admitted;
  return { ...newSearch(today), type: 'ipd', byMrn: true, mrn: stay.patient.mrn, from, to: today };
}

/** The dates of a search in words, for the printed list: "21 Nov 2026", "1 Nov 2026 to 21 Nov 2026", "All dates". */
export function periodWords(q) {
  if (q.from && q.to) return q.from === q.to ? dayWords(q.from) : `${dayWords(q.from)} to ${dayWords(q.to)}`;
  if (q.from) return `From ${dayWords(q.from)}`;
  if (q.to) return `Until ${dayWords(q.to)}`;
  return 'All dates';
}

/** The other parts of a search in words, for the printed list ('' when only the dates were chosen). */
export function filterWords(q) {
  return [
    q.type && `${labelOf(TYPE_CHOICES, q.type)} ${q.show === 'returns' ? 'returns' : 'bills'}`,
    q.pay && labelOf(q.show === 'returns' ? RETURN_PAY_CHOICES : PAY_CHOICES, q.pay),
    (q.first || q.last) && `Name: ${[q.first, q.last].filter(Boolean).join(' ')}`,
    q.mrn && `UHID: ${q.mrn}`,
    q.number && `Sales no: ${q.number}`,
    q.item && `Item: ${q.item}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What the list says when no bill fits: what was searched, so a wrong type or date is seen at once. */
export const noBillsWords = (q) =>
  q.show === 'returns'
    ? `No sale returns match: ${[filterWords(q) || 'all returns', periodWords(q)].join(' · ')}. Change the search and press Show.`
    : `No bills match: ${[filterWords(q) || 'all bills', periodWords(q)].join(' · ')}. Change the search and press Show.`;

/** An amount as on the pharmacy's bill: 1,308.61 – no rupee sign, always two decimals. */
export const amount = (paise) => ((paise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The sums of some of the bills listed (those ticked for the printed list): the same figures as under the list. */
export function sumBills(rows) {
  const add = (pick) => rows.reduce((n, r) => n + pick(r), 0);
  return { count: rows.length, salesPaise: add((r) => r.netPaise), receivedPaise: add((r) => r.paidPaise), creditPaise: add((r) => r.balPaise), hospitalPaise: add((r) => (r.onHospitalBill ? r.netPaise : 0)) };
}

/** The listed IPD bills of the same patient as this bill (IP bill summary); none for a bill that is not a patient's IPD
 * bill. Her returns' own rows are left out: the summary lists them under Sales Return from her bills. */
export const ipBills = (rows, bill) => (bill?.type === 'ipd' && bill.mrn ? rows.filter((r) => !r.isReturn && r.type === 'ipd' && r.mrn === bill.mrn) : []);

/** An amount that is credit owed: nothing owed shows no figure (26 Nov 2026, the pharmacy's request). */
export const owed = (paise) => (paise ? amount(paise) : '–');

/**
 * The IP bill summary's Credit Amount: what is still owed on her listed bills – at the counter, each bill's balance now
 * (none once settled); on the hospital bill, the bill less its returns (26 Nov 2026: the bill rows stay as made).
 */
export function ipCreditPaise(bills) {
  return Math.max(0, bills.reduce((n, b) => n + b.balPaise - (b.onHospitalBill ? (b.returns ?? []).reduce((m, r) => m + r.amountPaise, 0) : 0), 0));
}

/**
 * A return's own bill – the Pharmacy Sales Return Bill (ReturnSlip in PatientReturnPage.jsx) – from the invoice it was
 * made against (GET /pharmacy/invoices/:id): its medicines, the money given back (the refund naming it, or one saved
 * with it before refunds named their return) and what came off what she owed. null when the invoice has no such return.
 */
export function returnSlipOf(invoice, number) {
  const ret = (invoice.returns ?? []).find((r) => r.number === number);
  if (!ret) return null;
  const at = new Date(ret.at).getTime();
  const refunds = (invoice.payments ?? []).filter((p) => p.kind === 'refund' && (p.creditNote ? p.creditNote === number : Math.abs(new Date(p.at).getTime() - at) < 2000));
  const refundPaise = invoice.billId ? 0 : refunds.reduce((n, p) => n + p.amountPaise, 0);
  const lineOf = new Map(invoice.lines.map((l) => [l.id, l]));
  const amountPaise = ret.lines.reduce((n, x) => n + x.amountPaise, 0);
  return {
    creditNotes: [{ creditNote: number, number: invoice.number, onHospitalBill: Boolean(invoice.billId), creditPaise: amountPaise - refundPaise }],
    chosen: ret.lines.map((x) => {
      const l = lineOf.get(x.lineId) ?? {};
      return { line: { key: `${number}:${x.lineId}`, name: l.name ?? '', batch: l.batch ?? '', expiry: l.expiry ?? null }, qty: x.qty, amountPaise: x.amountPaise };
    }),
    totals: { amountPaise, refundPaise, creditPaise: amountPaise - refundPaise },
    patient: { fullName: invoice.patient?.fullName ?? invoice.buyer?.name ?? invoice.customer?.name ?? 'Walk-in customer', mrn: invoice.patient?.mrn ?? '' },
    mode: refunds[0]?.mode ?? null,
    at: ret.at,
  };
}

// 25 Nov 2026 (the pharmacy's request): the IP bill summary laid out as the earlier software's – Credit Sales Bill and
// Sales Return as two sections, each with its own total row, and underneath Credit Amount, Advance Amount and Amount.

/** Her day, "21 Nov 2026" (this computer's time zone – paired with timeWords below for a bill's Date and Time columns;
 * dayWords above is for a date typed into a search box, always a plain calendar day with no time of its own). */
export function dateWords(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Her hour and minute, "9:11 AM" (the earlier software's print). */
export function timeWords(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${pad2(d.getMinutes())} ${ampm}`;
}

/** A total amount rounded off to the nearest rupee, the way the earlier software's Net Amount was: 91.84 → 92.00. */
export const roundedPaise = (paise) => Math.round((paise ?? 0) / 100) * 100;

/** Every return (credit note) against this patient's listed bills, newest first – the Sales Return section. */
export const ipReturns = (bills) => bills.flatMap((b) => b.returns ?? []).sort((a, b) => new Date(b.at) - new Date(a.at));

/** The Credit Sales Bill section's total row: count, Total amt, Net amt (rounded), Paid amt, Balance amt. */
export function ipBillSums(bills) {
  const add = (pick) => bills.reduce((n, r) => n + pick(r), 0);
  return { count: bills.length, totalPaise: add((r) => r.totalPaise), netPaise: add((r) => roundedPaise(r.totalPaise)), paidPaise: add((r) => r.paidPaise), balPaise: add((r) => r.balPaise) };
}

/** The Sales Return section's total row: count and the amount credited back. */
export function ipReturnSums(returns) {
  return { count: returns.length, amountPaise: returns.reduce((n, r) => n + r.amountPaise, 0) };
}
