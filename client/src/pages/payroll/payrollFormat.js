import { toInput, toPaise } from '../billing/billingFormat.js';
import { monthLabel } from './runFormat.js';

// Payroll, Stage A (docs/PAYROLL_BUILD_NOTE.md): the words and the form's arithmetic shared by the payroll pages.
// Amounts come from the server in paise (₹1 = 100 paise). No requests here: every function is PURE.

// The four numbers kept sealed on the server: the pages show their last four characters only.
export const NUMBER_FIELDS = ['uan', 'esiNumber', 'pan', 'accountNumber'];
export const NUMBER_LABELS = { uan: 'PF number (UAN)', esiNumber: 'ESI number', pan: 'PAN', accountNumber: 'Bank account number' };
export const NUMBER_HINTS = { uan: '12 digits', esiNumber: '10 digits (17 with the employer code)', pan: '5 letters, 4 digits and a letter', accountNumber: '6 to 18 digits' };
/** { kept, last4 } → "•••• 234F", or "Not kept". */
export const maskedNumber = (n) => (n?.kept ? `•••• ${n.last4}` : 'Not kept');

export const DAY_BASIS_WORDS = { '': 'Not decided yet', calendar: 'The days of that month (28 to 31)', thirty: '30 days, every month', twentySix: '26 days, every month' };
export const ROUNDING_WORDS = { nearest: 'To the nearest rupee', up: 'Up to the next rupee', down: 'Down to the rupee', paise: 'Not rounded (paise kept)' };
export const SHOW_OPTIONS = [
  ['working', 'Working'],
  ['left', 'Left'],
  ['all', 'All'],
];

/** 'working' | 'left' (the last working day has passed) | 'off' (taken off the payroll). */
export const staffStatus = (s) => (s.isActive === false ? 'off' : s.working ? 'working' : 'left');

/** The rows whose name, staff number, designation or department holds every word typed. */
export function searchStaff(list, text) {
  const words = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((s) => {
    const hay = `${s.name} ${s.staffNumber} ${s.designation} ${s.department}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** "A-12, 0045 ; 0045" → ['A-12', '0045'] */
export const codesFrom = (text) => [...new Set(String(text ?? '').split(/[,;\n]+/).map((c) => c.trim()).filter(Boolean))];

const noNumbers = () => Object.fromEntries(NUMBER_FIELDS.map((f) => [f, '']));
const noClears = () => Object.fromEntries(NUMBER_FIELDS.map((f) => [f, false]));

/** The form of a new staff member. */
export const emptyForm = (staffNumber = '') => ({
  staffNumber,
  name: '',
  designation: '',
  department: '',
  joinedOn: '',
  leftOn: '',
  isActive: true,
  userId: '',
  codes: '',
  ifsc: '',
  bankName: '',
  numbers: noNumbers(),
  clear: noClears(),
  payFrom: '',
  parts: {},
  pf: false,
  esi: false,
  pt: false,
  ptSlab: '', // which table of professional tax slabs is this person's (Stage C)
  tds: '',
});

/** The form of a staff member as the server sent them; the pay boxes start from the latest pay entry. */
export function formFrom(staff) {
  const latest = staff.pay?.[0] ?? null; // newest first
  return {
    staffNumber: staff.staffNumber,
    name: staff.name,
    designation: staff.designation ?? '',
    department: staff.department ?? '',
    joinedOn: staff.joinedOn ?? '',
    leftOn: staff.leftOn ?? '',
    isActive: staff.isActive !== false,
    userId: staff.userId ?? '',
    codes: (staff.attendanceCodes ?? []).join(', '),
    ifsc: staff.bank?.ifsc ?? '',
    bankName: staff.bank?.bankName ?? '',
    numbers: noNumbers(),
    clear: noClears(),
    payFrom: latest?.from ?? '',
    parts: Object.fromEntries((latest?.parts ?? []).map((p) => [p.key, toInput(p.amountPaise)])),
    pf: Boolean(latest?.pf),
    esi: Boolean(latest?.esi),
    pt: Boolean(latest?.pt),
    ptSlab: staff.ptSlab ?? '',
    tds: latest ? toInput(latest.tdsPaise) : '',
  };
}

/** The monthly pay typed so far, in paise (boxes that are not an amount count as nothing). */
export const partsTotal = (form, partsList) => partsList.reduce((sum, p) => sum + (toPaise(form.parts[p.key] || '0') ?? 0), 0);

/**
 * The pay as typed: { pay, errors }. pay is null when nothing was typed (a person may be added before their pay is
 * known). errors: { 'pay.parts' | 'pay.from' | 'pay.tdsPaise': sentence } – the same names the server uses.
 */
export function readPay(form, partsList) {
  const errors = {};
  const parts = [];
  for (const p of partsList) {
    const text = String(form.parts[p.key] ?? '').trim();
    if (!text) continue;
    const paise = toPaise(text);
    if (paise == null) errors['pay.parts'] = `${p.name}: write an amount like 12000 or 12000.50`;
    else if (paise > 0) parts.push({ key: p.key, amountPaise: paise });
  }
  const tdsText = String(form.tds ?? '').trim();
  const tdsPaise = tdsText ? toPaise(tdsText) : 0;
  if (tdsPaise == null) errors['pay.tdsPaise'] = 'Write the TDS as an amount, like 500';
  const typed = parts.length > 0 || Boolean(tdsText) || form.pf || form.esi || form.pt;
  if (!typed && !Object.keys(errors).length) return { pay: null, errors };
  if (!parts.length && !errors['pay.parts']) errors['pay.parts'] = 'Write at least one amount';
  if (!form.payFrom) errors['pay.from'] = 'Choose the day this pay starts';
  if (Object.keys(errors).length) return { pay: null, errors };
  return { pay: { from: form.payFrom, parts, pf: Boolean(form.pf), esi: Boolean(form.esi), pt: Boolean(form.pt), tdsPaise }, errors };
}

const payKey = (p) => JSON.stringify([p.from, [...p.parts].map((x) => [x.key, x.amountPaise]).sort(), Boolean(p.pf), Boolean(p.esi), Boolean(p.pt), p.tdsPaise ?? 0]);
/** Is the pay typed the same as a pay entry the server sent? (then it is not sent again) */
export const samePay = (typed, entry) => Boolean(typed && entry) && payKey(typed) === payKey(entry);

/**
 * What is sent to the server for a staff member. latest: their newest pay entry (null for a new person) – the pay is
 * sent only when it differs from it. Returns { body, errors }.
 */
export function staffBody(form, partsList, latest = null) {
  const { pay, errors } = readPay(form, partsList);
  const body = {
    staffNumber: form.staffNumber.trim(),
    name: form.name.trim(),
    designation: form.designation.trim(),
    department: form.department.trim(),
    joinedOn: form.joinedOn || null,
    leftOn: form.leftOn || null,
    isActive: Boolean(form.isActive),
    userId: form.userId || null,
    attendanceCodes: codesFrom(form.codes),
    ptSlab: form.ptSlab ?? '',
    bank: { ifsc: form.ifsc.trim().toUpperCase(), bankName: form.bankName.trim() },
    pay: pay && !samePay(pay, latest) ? pay : null,
    // A typed number replaces the kept one; an empty box leaves it alone; a ticked "Remove" takes it away
    numbers: Object.fromEntries(NUMBER_FIELDS.map((f) => [f, form.clear[f] ? '' : form.numbers[f].trim()])),
    clearNumbers: NUMBER_FIELDS.filter((f) => form.clear[f]),
  };
  if (!body.staffNumber) errors.staffNumber = 'Write the staff number';
  if (body.name.length < 2) errors.name = 'Write the name';
  // Professional tax is looked up in a table of slabs: a person it is taken from needs their table chosen
  if (form.pt && !body.ptSlab) errors.ptSlab = 'Choose which professional tax slab is this person’s';
  return { body, errors };
}

/** What a new entry would do, for the note under the pay boxes: 'none' | 'first' | 'correct' | 'add' | 'early'. */
export function payAction(form, partsList, latest) {
  const { pay } = readPay(form, partsList);
  if (!pay) return 'none';
  if (!latest) return 'first';
  if (samePay(pay, latest)) return 'none';
  if (pay.from === latest.from) return 'correct';
  return pay.from > latest.from ? 'add' : 'early';
}

/** The settings form as sent to the server. */
export const settingsBody = (v) => ({
  parts: v.parts.map((p) => ({ key: p.key ?? '', name: String(p.name ?? '').trim(), countsForPf: Boolean(p.countsForPf), countsForEsi: Boolean(p.countsForEsi) })),
  dayBasis: v.dayBasis,
  weeklyOffsPaid: Boolean(v.weeklyOffsPaid),
  holidaysPaid: Boolean(v.holidaysPaid),
  rounding: v.rounding,
  confirmedBy: String(v.confirmedBy ?? '').trim(),
  confirmedOn: v.confirmedOn || null,
  // files that carry numbers in full: off unless the hospital admin ticks them
  bankList: v.bankList === true,
  fullNumbers: v.fullNumbers === true,
});

// ---------- The accounts login's Today ----------
const people = (n) => `${n} staff member${n === 1 ? '' : 's'}`;

/**
 * What is waiting in the payroll, from the server's counts (GET /payroll/overview): [{ key, tone, text, to, link }].
 * tone 'watch': something to do; 'stable': done. No name and no amount – Today is a page anyone may glance at.
 */
export function payrollToDo(o) {
  if (!o) return [];
  const items = [];
  const run = `/payroll/run?month=${o.month}`;
  const month = monthLabel(o.month);
  if (o.staff.working === 0) items.push({ key: 'nobody', tone: 'watch', text: 'Nobody is on the payroll yet.', to: '/payroll/staff/new', link: 'Add the first staff member' });
  if (o.staff.withoutPay > 0) items.push({ key: 'pay', tone: 'watch', text: `${people(o.staff.withoutPay)} ${o.staff.withoutPay === 1 ? 'has' : 'have'} no pay entered.`, to: '/payroll', link: 'Open the staff list' });
  if (o.staff.withoutSlab > 0) items.push({ key: 'slab', tone: 'watch', text: `Professional tax is taken from ${people(o.staff.withoutSlab)} whose slab is not chosen.`, to: '/payroll', link: 'Open the staff list' });
  if (!o.rules.basisChosen) {
    items.push({ key: 'basis', tone: 'watch', text: `How one day’s pay is counted is not chosen yet.${o.canChangeSettings ? '' : ' Ask the hospital admin to choose it.'}`, to: '/payroll/settings', link: o.canChangeSettings ? 'Choose it in the settings' : 'See the settings' });
  } else if (o.rules.draft) {
    items.push({ key: 'draft', tone: 'watch', text: 'The pay rules are DRAFT: the accountant’s name and date are not written yet.', to: '/payroll/settings', link: 'Open the settings' });
  }
  if (!o.canKeepNumbers) items.push({ key: 'key', tone: 'watch', text: 'PF, ESI, PAN and bank account numbers can’t be kept yet: the key is not set on this server. Tell the developer.', to: '/payroll/settings', link: 'See the settings' });
  const r = o.run;
  if (r && o.staff.working > 0) {
    if (r.files === 0 && !r.sheetReady) items.push({ key: 'file', tone: 'watch', text: `The attendance file for ${month} is not read yet.`, to: run, link: 'Run payroll' });
    if (r.codesToAnswer > 0) items.push({ key: 'codes', tone: 'watch', text: `${r.codesToAnswer} code${r.codesToAnswer === 1 ? '' : 's'} in the ${month} file belong${r.codesToAnswer === 1 ? 's' : ''} to nobody on the payroll.`, to: run, link: 'Answer them' });
    if (r.files > 0 && r.peopleToAnswer > 0) items.push({ key: 'noRow', tone: 'watch', text: `${people(r.peopleToAnswer)} ${r.peopleToAnswer === 1 ? 'has' : 'have'} no row in the ${month} file.`, to: run, link: 'Write their paid days' });
    if (r.twoRows > 0) items.push({ key: 'twoRows', tone: 'watch', text: `${people(r.twoRows)} ${r.twoRows === 1 ? 'has' : 'have'} two rows in the ${month} files.`, to: run, link: 'Open Run payroll' });
    // Stages C and D: a locked month is done; an open one says whether it can be locked
    if (r.locked) items.push({ key: 'locked', tone: 'stable', text: `${month} is locked. Payslips and the monthly lists are made from it.`, to: run, link: 'Open the month' });
    else if (r.sheetReady) {
      items.push({ key: 'sheet', tone: 'stable', text: `The salary sheet for ${month} is made (${people(r.expected)})${r.withoutSum ? `, ${r.withoutSum} without a sum` : ''}.`, to: run, link: 'Open the sheet' });
      if (r.lockBlockers > 0) items.push({ key: 'lock', tone: 'watch', text: `${month} can’t be locked yet: ${r.lockBlockers} thing${r.lockBlockers === 1 ? ' is' : 's are'} still waiting.`, to: run, link: 'See what is waiting' });
      else if (r.lockBlockers === 0) items.push({ key: 'lock', tone: 'watch', text: `${month} is ready to be locked.`, to: run, link: 'Lock the month' });
    }
  }
  return items;
}
