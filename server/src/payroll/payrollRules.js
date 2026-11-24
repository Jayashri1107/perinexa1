// Payroll (owner's choice of 23 Nov 2026 – docs/PAYROLL_BUILD_NOTE.md), Stage A: who may open it, and the plain
// rules of the staff list and the settings. No database, no requests: every function here is PURE.
//
// Who (decision 3): the accounts login and the hospital admin only – a nurse, a doctor or reception never see a
// colleague's pay. Perinexa's own staff (a super admin or platform admin who opened the hospital) never, also while
// the hospital allows support access: routes/payroll.js refuses them before anything else (section 0 of the note).

export const PAYROLL_ROLES = ['accounts', 'admin'];
// The payroll settings: the hospital admin only, as prices and the Tally account names are.
export const PAYROLL_SETTINGS_ROLES = ['admin'];

// ---------- Settings (Tenant.payroll) ----------
// How one day's pay is counted (decision 5): the accountant decides – '' until then. Nothing is worked out from it
// before Stage B. 'calendar': the days of that month; 'thirty': 30; 'twentySix': 26.
export const DAY_BASES = ['calendar', 'thirty', 'twentySix'];
// Rounding of a month's pay: to the rupee (nearest, up, down) or kept in paise.
export const ROUNDINGS = ['nearest', 'up', 'down', 'paise'];
export const MAX_PARTS = 12;

// The salary parts a hospital starts with. Which parts count for PF and for ESI is legal content: DRAFT until the
// hospital's accountant confirms it (their name and the date are kept with the settings).
export const DEFAULT_PARTS = [
  { key: 'basic', name: 'Basic pay', countsForPf: true, countsForEsi: true },
  { key: 'hra', name: 'House rent allowance', countsForPf: false, countsForEsi: true },
  { key: 'other', name: 'Other allowances', countsForPf: false, countsForEsi: true },
];

const date10 = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** The hospital's payroll settings with the starting values where the admin never saved them. */
export function withDefaults(payroll) {
  const p = payroll ?? {};
  const parts = Array.isArray(p.parts) && p.parts.length ? p.parts : DEFAULT_PARTS;
  return {
    parts: parts.map((x) => ({ key: x.key, name: x.name, countsForPf: Boolean(x.countsForPf), countsForEsi: Boolean(x.countsForEsi) })),
    dayBasis: DAY_BASES.includes(p.dayBasis) ? p.dayBasis : '',
    weeklyOffsPaid: p.weeklyOffsPaid !== false,
    holidaysPaid: p.holidaysPaid !== false,
    rounding: ROUNDINGS.includes(p.rounding) ? p.rounding : 'nearest',
    confirmedBy: p.confirmedBy ?? '',
    confirmedOn: date10(p.confirmedOn),
    // Files that carry numbers in full (section 8 of the note: the owner's yes or no) – off unless switched on
    bankList: p.bankList === true,
    fullNumbers: p.fullNumbers === true,
    updatedByName: p.updatedByName ?? '',
    updatedAt: p.updatedAt ?? null,
  };
}

/** The rules are DRAFT until the accountant's name and the date they confirmed them are written. */
export const rulesAreDraft = (settings) => !(settings?.confirmedBy && settings?.confirmedOn && settings?.dayBasis);

/** "Night duty allowance" → "night-duty-allowance": the key a new salary part is kept under (never changed later). */
export function partKey(name, taken = []) {
  const base = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'part';
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}-${n}`;
  return key;
}

// ---------- The staff list ----------
// The four numbers kept sealed (decision 7; section 6): shown as their last four characters; reading one in full is
// its own audited action. Aadhaar is never kept.
export const NUMBER_FIELDS = ['uan', 'esiNumber', 'pan', 'accountNumber'];
export const MAX_MONTHLY_PAISE = 5_00_00_000_00; // Rs 5 crore a month: a typing slip, not a salary

/** A typed number without spaces or dashes, in capitals: "abcde 1234 f" → "ABCDE1234F". */
export const cleanNumber = (value) => String(value ?? '').replace(/[\s-]+/g, '').toUpperCase();

/** The last four characters shown on screen and, later, on the payslip. */
export const lastFour = (value) => cleanNumber(value).slice(-4);

// What each number looks like – the shape only, no outside lookup; nothing here says a number belongs to the person.
const SHAPES = {
  uan: [/^\d{12}$/, 'The PF number (UAN) has 12 digits'],
  esiNumber: [/^\d{10}$|^\d{17}$/, 'The ESI number has 10 digits (17 with the employer code)'],
  pan: [/^[A-Z]{5}\d{4}[A-Z]$/, 'A PAN is 5 letters, 4 digits and a letter'],
  accountNumber: [/^\d{6,18}$/, 'A bank account number has 6 to 18 digits'],
};
/** null when the cleaned number has the right shape, or the sentence to show (never the number itself). */
export function numberProblem(field, value) {
  const shape = SHAPES[field];
  if (!shape) return 'Unknown number';
  return shape[0].test(cleanNumber(value)) ? null : shape[1];
}
export const IFSC_SHAPE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// Aadhaar is never asked for and has no field (section 6): a free-text box that holds 12 digits in a row (with or
// without spaces or dashes between the fours) is refused, so one is not kept by accident.
const AADHAAR_LIKE = /(^|\D)\d{4}[\s-]?\d{4}[\s-]?\d{4}(\D|$)/;
export const looksLikeAadhaar = (text) => AADHAAR_LIKE.test(String(text ?? ''));
export const NO_AADHAAR = 'This looks like an Aadhaar number. Aadhaar is never kept in Perinexa – please remove it.';

/** "A-12, 0045 ; 0045" → ['A-12', '0045']: the codes a person carries in the attendance file, each once. */
export function cleanCodes(codes) {
  const list = Array.isArray(codes) ? codes : String(codes ?? '').split(/[,;\n]+/);
  return [...new Set(list.map((c) => String(c ?? '').trim()).filter(Boolean))];
}

/** One pay entry's parts with an amount, as whole paise: [{ key, amountPaise }]. */
export const cleanParts = (parts) =>
  (parts ?? [])
    .map((p) => ({ key: String(p?.key ?? ''), amountPaise: Math.round(Number(p?.amountPaise ?? 0)) }))
    .filter((p) => p.key && p.amountPaise > 0);

/** A pay entry's monthly pay before deductions: its parts added up. Paise, whole numbers. */
export const monthlyGross = (entry) => cleanParts(entry?.parts).reduce((sum, p) => sum + p.amountPaise, 0);

const dayOf = (d) => new Date(d).toISOString().slice(0, 10);

/** The pay entry in force on a day (the latest that started on or before it), or null. */
export function payOn(pay, on = new Date()) {
  const day = dayOf(on);
  const started = (pay ?? []).filter((e) => e?.from && dayOf(e.from) <= day);
  if (!started.length) return null;
  return started.reduce((best, e) => (dayOf(e.from) >= dayOf(best.from) ? e : best));
}

/** The latest pay entry, in force or not yet (a rise entered ahead of its date), or null. */
export function latestPay(pay) {
  const list = (pay ?? []).filter((e) => e?.from);
  if (!list.length) return null;
  return list.reduce((best, e) => (dayOf(e.from) >= dayOf(best.from) ? e : best));
}

/**
 * Where a new pay entry goes (a change of pay adds an entry – section 4). null: it is added; a number: the entry at
 * that place has the same first day and is corrected; a string: the reason it is refused.
 */
export function placeForPay(pay, from) {
  const list = Array.from(pay ?? []);
  let at = -1;
  list.forEach((e, i) => {
    if (e?.from && (at < 0 || dayOf(e.from) >= dayOf(list[at].from))) at = i;
  });
  if (at < 0) return null;
  const day = dayOf(from);
  if (day < dayOf(list[at].from)) return `The new pay can't start before the pay already entered (from ${dayOf(list[at].from)}).`;
  return day === dayOf(list[at].from) ? at : null;
}

/** On the payroll and working on this day? (left = taken off the list, or the last working day has passed) */
export function isWorking(staff, today = new Date()) {
  if (staff?.isActive === false) return false;
  if (!staff?.leftOn) return true;
  return dayOf(staff.leftOn) >= dayOf(today);
}

/** The next staff number after the ones in use: 'S014' after 'S013', '8' after '7'; '001' on an empty list. */
export function nextStaffNumber(used) {
  let best = null;
  for (const n of used ?? []) {
    const m = /^(.*?)(\d+)$/.exec(String(n ?? '').trim());
    if (m && (!best || Number(m[2]) > Number(best[2]))) best = m;
  }
  if (!best) return '001';
  return `${best[1]}${String(Number(best[2]) + 1).padStart(best[2].length, '0')}`;
}
