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
export const newSearch = (today) => ({ type: 'all', byName: false, first: '', last: '', byMrn: false, mrn: '', byNumber: false, number: '', byDate: true, from: today, to: today, item: '', pay: 'all' });

/** Is this a whole search (every box, of the right kind)? What the page kept in its history entry is checked before it is used. */
export const isSearch = (f) => Boolean(f) && typeof f === 'object' && Object.entries(newSearch('')).every(([k, v]) => typeof f[k] === typeof v);

/** What Show asks the server for: only the parts that are ticked and filled in. */
export function searchQuery(f) {
  const q = {};
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
    q.type && `${labelOf(TYPE_CHOICES, q.type)} bills`,
    q.pay && labelOf(PAY_CHOICES, q.pay),
    (q.first || q.last) && `Name: ${[q.first, q.last].filter(Boolean).join(' ')}`,
    q.mrn && `UHID: ${q.mrn}`,
    q.number && `Sales no: ${q.number}`,
    q.item && `Item: ${q.item}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What the list says when no bill fits: what was searched, so a wrong type or date is seen at once. */
export const noBillsWords = (q) => `No bills match: ${[filterWords(q) || 'all bills', periodWords(q)].join(' · ')}. Change the search and press Show.`;

/** An amount as on the pharmacy's bill: 1,308.61 – no rupee sign, always two decimals. */
export const amount = (paise) => ((paise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The sums of some of the bills listed (those ticked for the printed list): the same figures as under the list. */
export function sumBills(rows) {
  const add = (pick) => rows.reduce((n, r) => n + pick(r), 0);
  return { count: rows.length, salesPaise: add((r) => r.netPaise), receivedPaise: add((r) => r.paidPaise), creditPaise: add((r) => r.balPaise), hospitalPaise: add((r) => (r.onHospitalBill ? r.netPaise : 0)) };
}

/** The listed IPD bills of the same patient as this bill (IP bill summary); none for a bill that is not a patient's IPD bill. */
export const ipBills = (rows, bill) => (bill?.type === 'ipd' && bill.mrn ? rows.filter((r) => r.type === 'ipd' && r.mrn === bill.mrn) : []);
