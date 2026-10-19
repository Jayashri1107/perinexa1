// The Tally link (docs/TALLY_PLAN.md – the owner's decisions of 16 Oct 2026): the choices the owner or the accountant
// may want to change, each in one place. Step 1 is a file: the hospital admin downloads a Tally XML file for a period
// and the accountant imports it. Nothing connects to Tally over the network.

// Who prepares batches, downloads the files, keeps the account names and clears exceptions (owner's decision 7).
export const TALLY_ROLES = ['admin'];

// Batches are numbered TB-000001 … per hospital.
export const BATCH_PREFIX = 'TB';
// A batch with more entries than this is refused: the admin chooses a shorter period.
export const MAX_BATCH_VOUCHERS = 5000;

// The kinds of Tally entry Perinexa writes, and the Tally voucher type each one is a child of.
export const VOUCHER_KINDS = ['sales', 'receipt', 'payment', 'credit_note', 'debit_note', 'journal'];
export const KIND_TO_TYPE = { sales: 'sales', receipt: 'receipt', payment: 'payment', credit_note: 'creditNote', debit_note: 'debitNote', journal: 'journal' };
export const TALLY_PARENT_TYPES = { sales: 'Sales', receipt: 'Receipt', payment: 'Payment', creditNote: 'Credit Note', debitNote: 'Debit Note', journal: 'Journal' };
export const KIND_LABELS = { sales: 'Sales', receipt: 'Receipt', payment: 'Payment', credit_note: 'Credit note', debit_note: 'Debit note', journal: 'Journal' };

// What became of an entry: exported (in a file, waiting for Tally), imported (the accountant confirmed it), failed
// (Tally refused it – the admin records Tally's words), skipped (left out on purpose, with a reason). An exported entry
// with no batch is waiting to go into the next file (Send again after a failure).
export const VOUCHER_STATUSES = ['exported', 'imported', 'failed', 'skipped'];
export const STATUS_LABELS = { exported: 'Waiting for Tally', imported: 'Imported', failed: 'Refused by Tally', skipped: 'Skipped' };
export const NOTE_MAX = 300;

// Medicines issued to admitted patients: a taxable pharmacy sale (the owner's choice of 3 Oct 2026, as the invoice is
// printed) or part of the exempt treatment (the accountant decides – docs/TALLY_PLAN.md, matter 3).
export const INPATIENT_ISSUES = ['taxable', 'exempt'];

// Account (ledger) names, as the accountant will type them in Perinexa. These are only starting names.
export const LEDGER_NAME_MAX = 100;
export const DEFAULT_LEDGERS = {
  // One income account per group of the price list (hospital services, no GST).
  income: { consultation: 'Consultation income', procedure: 'Procedure income', scan: 'Scan income', lab: 'Lab test income', inpatient: 'Inpatient income', medicine: 'Medicine income (hospital bill)', other: 'Other income' },
  // Where the money lands, by how the patient paid. Insurance: the account used when no scheme has its own.
  modes: { cash: 'Cash', upi: 'Bank (UPI)', card: 'Bank (card)', insurance: 'Insurance receivable' },
  // An insurer or scheme with its own account: [{ scheme: 'PM-JAY', ledger: 'PM-JAY receivable' }].
  schemes: [],
  patients: 'Patients', // one shared account, never one per patient (owner's decision 4)
  counter: 'Pharmacy counter customers', // walk-in customers, without names
  deposits: 'Patient deposits', // money held during a stay, set against the bill at discharge
  discount: 'Discount allowed',
  // Pharmacy sales by GST rate: { '5': 'Pharmacy sales 5%' … }. A rate without a name gets the default below.
  pharmacySales: {},
  exemptIssues: 'Medicines to admitted patients (exempt)',
  outputCgst: 'Output CGST',
  outputSgst: 'Output SGST',
  inputCgst: 'Input CGST',
  inputSgst: 'Input SGST',
  inputIgst: 'Input IGST',
  purchaseReturns: 'Purchase returns',
};
export const defaultPharmacySales = (rate) => (Number(rate) === 0 ? 'Pharmacy sales exempt' : `Pharmacy sales ${rate}%`);

// Perinexa's own voucher types in Tally, so the accountant's own numbering is never touched (manual numbers).
export const DEFAULT_VOUCHER_TYPES = { sales: 'Perinexa Sales', receipt: 'Perinexa Receipt', payment: 'Perinexa Payment', creditNote: 'Perinexa Credit Note', debitNote: 'Perinexa Debit Note', journal: 'Perinexa Journal' };

// The GST duty accounts are never created by Perinexa's file: the accountant creates them in Tally with their GST
// details (the tags for those are not published). Perinexa only names them.
export const GST_ROLES = ['ocgst', 'osgst', 'icgst', 'isgst', 'iigst'];

/** The saved settings filled in with the defaults (a stored Map or object for pharmacySales becomes a plain object). */
const plain = (m) => (m instanceof Map ? Object.fromEntries(m) : { ...(m ?? {}) }); // a stored Map (hydrated document) or an object (lean)
export function withDefaults(raw = {}) {
  const r = raw ?? {};
  return {
    companyName: r.companyName ?? '',
    booksFrom: r.booksFrom ?? null,
    inpatientIssues: INPATIENT_ISSUES.includes(r.inpatientIssues) ? r.inpatientIssues : 'taxable',
    ledgers: {
      ...DEFAULT_LEDGERS,
      ...(r.ledgers ?? {}),
      income: { ...DEFAULT_LEDGERS.income, ...plain(r.ledgers?.income) },
      modes: { ...DEFAULT_LEDGERS.modes, ...plain(r.ledgers?.modes) },
      schemes: (r.ledgers?.schemes ?? []).map((s) => ({ scheme: s.scheme ?? '', ledger: s.ledger ?? '' })).filter((s) => s.scheme && s.ledger),
      pharmacySales: plain(r.ledgers?.pharmacySales),
    },
    voucherTypes: { ...DEFAULT_VOUCHER_TYPES, ...plain(r.voucherTypes) },
    updatedByName: r.updatedByName ?? '',
    updatedAt: r.updatedAt ?? null,
  };
}
