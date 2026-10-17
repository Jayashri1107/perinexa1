import { BadgeCheck, CircleDollarSign, CircleSlash, FileX2, RotateCcw, Wallet } from 'lucide-react';

// Billing (docs/BILLING_PLAN.md): words, amounts and status looks shared by the billing pages. Amounts come from the
// server in paise (₹1 = 100 paise). Same role lists as server/src/billing/billingRules.js.

export const BILLING_ROLES = ['receptionist', 'billing', 'admin'];
// The monthly report and the export: the hospital admin and the billing department.
export const REPORT_ROLES = ['admin', 'billing'];
export const ADMIN_ROLES = ['admin'];

/** 125050 → "₹1,250.50" (Indian grouping; ".00" left out). */
export function rupees(paise) {
  if (paise == null) return '';
  const sign = paise < 0 ? '−' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100).toLocaleString('en-IN');
  const part = abs % 100;
  return `${sign}₹${whole}${part ? `.${String(part).padStart(2, '0')}` : ''}`;
}

/** "1,250.50" or "1250" → paise, or null when it is not an amount. */
export function toPaise(text) {
  const t = String(text ?? '').replace(/[,₹\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
/** Paise → "1250.50" for an input box ('' for 0). */
export const toInput = (paise) => (paise ? (paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100)) : '');

export const STATUS_LOOK = {
  unpaid: { tone: 'watch', icon: Wallet, label: 'Unpaid' },
  part_paid: { tone: 'due', icon: CircleDollarSign, label: 'Part paid' },
  paid: { tone: 'stable', icon: BadgeCheck, label: 'Paid' },
  refund_due: { tone: 'high', icon: RotateCcw, label: 'Money to give back' },
  no_charges: { tone: 'neutral', icon: CircleSlash, label: 'No charges' },
  cancelled: { tone: 'inactive', icon: FileX2, label: 'Cancelled' },
};

export const KIND_LABELS = { opd: 'Outpatient', ipd: 'Inpatient stay' };
export const PAYMENT_KIND_LABELS = { payment: 'Payment', deposit: 'Deposit', refund: 'Refund' };
export const MODE_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card', insurance: 'Insurance / scheme' };
export const GROUP_LABELS = { consultation: 'Consultation', procedure: 'Procedure', scan: 'Scan', lab: 'Lab test', inpatient: 'Inpatient', medicine: 'Medicine', other: 'Other' };

/** The billing pages' tabs: Monthly for the admin and the billing department, Settings for the admin only. */
export const billingTabs = (roles = []) => [
  { label: 'Bills', to: '/billing', end: false, activeFor: '/billing/bills' },
  { label: 'Unpaid', to: '/billing/unpaid', end: true },
  { label: 'Daily summary', to: '/billing/daily', end: true },
  { label: 'Cash handover', to: '/cash-handover', end: true },
  ...(roles.some((r) => REPORT_ROLES.includes(r)) ? [{ label: 'Monthly', to: '/billing/monthly', end: true }] : []),
  { label: 'Price list', to: '/billing/prices', end: true },
  ...(roles.includes('admin') ? [{ label: 'Settings', to: '/billing/settings', end: true }] : []),
];

// ---------- Billing extras (4 Oct 2026): insurance details, the claim forms, the UPI payment link ----------

// Insurance or scheme details on a bill: [key, label, longest length, hint]. Same keys, labels and lengths as
// server/src/billing/billingRules.js. All optional; the claim itself is made outside Perinexa.
export const INSURANCE_FIELDS = [
  ['insurer', 'Insurance company or scheme', 80, 'For example the insurer’s name, PM-JAY or a state scheme'],
  ['policyNumber', 'Policy or member number', 60],
  ['tpa', 'TPA (if any)', 80, 'The third-party administrator that handles the claim for the insurer'],
  ['preAuthNumber', 'Pre-authorisation number', 60],
  ['claimNumber', 'Claim number', 80],
];
// Typed by reception for the PM-JAY claim sheet (with the pre-authorisation number above).
export const PMJAY_FIELDS = [
  ['pmjayId', 'PM-JAY ID', 40, 'As printed on her PM-JAY (Ayushman) card'],
  ['packageCode', 'Package code', 40],
  ['packageName', 'Package name', 150, 'As given in the pre-authorisation'],
];
const INSURANCE_KEYS = [...INSURANCE_FIELDS, ...PMJAY_FIELDS].map(([k]) => k);
const INSURANCE_LABEL = { ...Object.fromEntries([...INSURANCE_FIELDS, ...PMJAY_FIELDS].map(([k, label]) => [k, label])), tpa: 'TPA' };

/** A bill's insurance details (or nothing) → every field as text, for the form. */
export const insuranceForm = (insurance) => Object.fromEntries(INSURANCE_KEYS.map((k) => [k, insurance?.[k] ?? '']));
/** The details that are recorded, as [label, value] rows for the screen. */
export const insuranceRows = (insurance) => INSURANCE_KEYS.filter((k) => insurance?.[k]).map((k) => [INSURANCE_LABEL[k], insurance[k]]);

// The two printed claim forms. Each lists the details it needs; one that is not recorded prints as an empty line.
export const CLAIM_LAYOUTS = {
  claim: { title: 'Claim form', menu: 'Print claim form', needs: ['insurer', 'policyNumber'] },
  pmjay: { title: 'PM-JAY claim sheet', menu: 'Print PM-JAY claim sheet', needs: ['pmjayId', 'preAuthNumber', 'packageCode', 'packageName'] },
};
/** The labels of the details this printout needs that are not recorded yet. */
export const claimMissing = (insurance, layout) => (CLAIM_LAYOUTS[layout]?.needs ?? []).filter((k) => !insurance?.[k]).map((k) => INSURANCE_LABEL[k]);

// Text typed on a bill is checked on the server for words about a baby's sex (PC-PNDT): the hint under a reason or
// reference box says so before anything is refused.
export const NO_SEX_WORDS_HINT = 'Leave out words such as son, daughter, boy, girl, male or female.';

/** The button that records money on this bill: a deposit while she is in hospital, else a payment. */
export const takeMoneyLabel = (bill) => (bill?.stay?.inHospital ? 'Take a deposit' : 'Take payment');

/**
 * What happens to the claim number typed with a payment by insurance (the server decides –
 * server/src/billing/billingService.js noteInsurer): it becomes the bill's claim number when the bill has none and the payer is the bill's insurer.
 */
export function claimNumberHint(insurance, payer) {
  if (insurance?.claimNumber) return 'From this bill’s insurance details. Another number typed here stays on this payment only.';
  if (insurance?.insurer && payer.trim() !== insurance.insurer) return 'Kept on this payment only, because the payer is not the insurer in this bill’s insurance details.';
  return 'It is also kept as this bill’s claim number, and printed on the claim form. A pre-authorisation number goes in the insurance details instead.';
}

/** "3 items" / "1 item". */
export const itemsWord = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;

// A UPI ID (VPA): name@handle. Same check as server/src/billing/upi.js (the server decides; this one answers at once).
const UPI_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}@[A-Za-z][A-Za-z0-9]{1,31}$/;
/** What is wrong with this UPI ID, in plain words, or null when its format is right. */
export function upiIdProblem(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Enter the UPI ID.';
  if (/\s/.test(text)) return 'A UPI ID has no spaces.';
  if (!text.includes('@')) return 'A UPI ID looks like name@bank – the @ is missing.';
  if (text.split('@').length !== 2) return 'A UPI ID has one @ only.';
  if (text.length > 100 || !UPI_ID.test(text)) return 'This does not look like a UPI ID. It looks like name@bank: letters, digits, dots and hyphens, then @ and the bank or app.';
  return null;
}

/**
 * What stops the billing settings from being saved, by field, or {} when they can be. Both empty is allowed (no UPI
 * links). again: the UPI ID typed a second time – asked for whenever it changed, because a mistyped UPI ID sends
 * patients' money to someone else.
 */
export function upiSettingsProblems({ upiId, payeeName, again }, saved = {}) {
  const [id, name] = [String(upiId ?? '').trim(), String(payeeName ?? '').trim()];
  const out = {};
  if (id && upiIdProblem(id)) out.upiId = upiIdProblem(id);
  if (id && name.length < 2) out.payeeName = 'Enter the name the UPI ID is registered under.';
  if (id && !out.upiId && id !== (saved.upiId ?? '') && String(again ?? '').trim() !== id) out.again = 'Type the same UPI ID again.';
  return out;
}

// Many UPI apps take at most ₹1,00,000 in one payment (banks set their own limits): above it the screen says so.
export const UPI_USUAL_LIMIT_PAISE = 10_000_000;
