// Payroll, Stage D (docs/PAYROLL_BUILD_NOTE.md section 5 D): what a locked month keeps, and the monthly lists made
// from it. PURE – no database, no requests.
//  - snapshotOf: everything a month's payslips and lists need, kept whole with each lock, so the same payslip can
//    always be made again whatever changes later (pay, rates, the staff list, the settings).
//  - listRows: the salary register and the PF, ESI and professional tax lists as rows for utils/csv.js toCsv.
// The four numbers appear by their LAST FOUR characters only – in the snapshot, on the payslip and in every list –
// with two exceptions the hospital admin must switch on (Payroll → Settings; off until the owner says yes, section 8
// of the note): full PF and ESI numbers in the PF and ESI lists, and the bank payment list with full account numbers.
// The full numbers are never kept in a snapshot: the route reads them at the moment a file is made and passes them in.
import { monthTotals } from './payrollDeductions.js';

export const LISTS = ['register', 'pf', 'esi', 'pt'];
export const ALL_LISTS = [...LISTS, 'bank'];
export const LIST_NAMES = { register: 'Salary register', pf: 'PF list', esi: 'ESI list', pt: 'Professional tax list', bank: 'Bank payment list' };
export const LIST_FILE_WORDS = { register: 'salary-register', pf: 'pf-list', esi: 'esi-list', pt: 'professional-tax-list', bank: 'bank-payment-list' };
/** The lists this hospital may save as files: the four, and the bank payment list only where it is switched on. */
export const listsFor = (settings) => (settings?.bankList ? ALL_LISTS : LISTS);
/** Does this list, for this hospital, carry numbers in full? (then the route reads them and the audit log says so) */
export const listIsFull = (list, settings) => (list === 'bank' ? Boolean(settings?.bankList) : (list === 'pf' || list === 'esi') && Boolean(settings?.fullNumbers));

const date10 = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const last4 = (sealed) => sealed?.last4 ?? '';

/** A row of the month's sheet with what a payslip needs of the person (staff: read with the sealed numbers' last four). */
export function snapshotRow(row, staff) {
  return {
    ...row,
    department: staff?.department ?? '',
    joinedOn: date10(staff?.joinedOn),
    leftOn: date10(staff?.leftOn),
    numbers: { uan: last4(staff?.uan), esiNumber: last4(staff?.esiNumber), pan: last4(staff?.pan), accountNumber: last4(staff?.bank?.accountNumber) },
    bankName: staff?.bank?.bankName ?? '',
  };
}

/** What a lock keeps. rows: the sheet's rows (with pay); staffById: Map of id → staff member read with the numbers. */
export function snapshotOf({ month, version, rows, staffById, settings, rates, basisDays, hospitalName, byName, at }) {
  const kept = rows.map((r) => snapshotRow(r, staffById.get(r.staffId)));
  return {
    month,
    version,
    hospitalName: hospitalName ?? '',
    lockedByName: byName ?? '',
    lockedAt: at ?? null,
    basisDays,
    settings: {
      dayBasis: settings.dayBasis,
      weeklyOffsPaid: settings.weeklyOffsPaid,
      holidaysPaid: settings.holidaysPaid,
      rounding: settings.rounding,
      parts: settings.parts.map((p) => ({ key: p.key, name: p.name, countsForPf: Boolean(p.countsForPf), countsForEsi: Boolean(p.countsForEsi) })),
      confirmedBy: settings.confirmedBy ?? '',
      confirmedOn: date10(settings.confirmedOn),
    },
    rates,
    rows: kept,
    totals: monthTotals(kept),
  };
}

/** What a locked month took back of each advance: [{ advanceId, amountPaise }]. */
export function recoveriesOf(rows) {
  const taken = new Map();
  for (const r of rows) for (const x of r.pay?.recoveries ?? []) taken.set(x.advanceId, (taken.get(x.advanceId) ?? 0) + x.amountPaise);
  return [...taken].map(([advanceId, amountPaise]) => ({ advanceId, amountPaise }));
}

const money = (paise) => ((paise ?? 0) / 100).toFixed(2);
const days = (n) => (n == null ? '' : String(n));
const masked = (four) => (four ? `…${four}` : '');
const SLAB_WORDS = { men: 'Men', women: 'Women' };

/**
 * One monthly list of a snapshot as rows of cells (the first row is the headings, the last the totals).
 * full: Map of staff id → { uan, esiNumber, accountNumber, ifsc, bankName } read in full by the route – given only
 * where the hospital switched it on; without it a number shows its last four characters.
 */
export function listRows(list, snapshot, full = null) {
  const rows = snapshot.rows.filter((r) => r.pay);
  const number = (r, field) => (full ? (full.get(r.staffId)?.[field] ?? '') : masked(r.numbers?.[field]));
  if (list === 'bank') {
    if (!full) return null; // never without the switch
    const paid = rows.filter((r) => r.pay.takeHomePaise > 0);
    return [
      ['Staff number', 'Name', 'Bank', 'IFSC', 'Account number', 'Amount'],
      ...paid.map((r) => [r.staffNumber, r.name, full.get(r.staffId)?.bankName ?? '', full.get(r.staffId)?.ifsc ?? '', full.get(r.staffId)?.accountNumber ?? '', money(r.pay.takeHomePaise)]),
      ['', 'Total', '', '', '', money(paid.reduce((t, r) => t + r.pay.takeHomePaise, 0))],
    ];
  }
  const sum = (pick) => money(rows.reduce((total, r) => total + (pick(r) ?? 0), 0));
  if (list === 'pf') {
    const mine = rows.filter((r) => r.applies?.pf);
    const total = (pick) => money(mine.reduce((t, r) => t + pick(r), 0));
    return [
      ['Staff number', 'Name', full ? 'PF number (UAN)' : 'PF number (UAN), last 4', 'Pay counted for PF', 'PF, staff share', 'PF, hospital’s share'],
      ...mine.map((r) => [r.staffNumber, r.name, number(r, 'uan'), money(r.pay.pfWagesPaise), money(r.pay.pfPaise), money(r.pay.pfEmployerPaise)]),
      ['', 'Total', '', total((r) => r.pay.pfWagesPaise), total((r) => r.pay.pfPaise), total((r) => r.pay.pfEmployerPaise)],
    ];
  }
  if (list === 'esi') {
    const mine = rows.filter((r) => r.applies?.esi);
    const total = (pick) => money(mine.reduce((t, r) => t + pick(r), 0));
    return [
      ['Staff number', 'Name', full ? 'ESI number' : 'ESI number, last 4', 'Paid days', 'Pay counted for ESI', 'ESI, staff share', 'ESI, hospital’s share'],
      ...mine.map((r) => [r.staffNumber, r.name, number(r, 'esiNumber'), days(r.paidDays), money(r.pay.esiWagesPaise), money(r.pay.esiPaise), money(r.pay.esiEmployerPaise)]),
      ['', 'Total', '', '', total((r) => r.pay.esiWagesPaise), total((r) => r.pay.esiPaise), total((r) => r.pay.esiEmployerPaise)],
    ];
  }
  if (list === 'pt') {
    const mine = rows.filter((r) => r.applies?.pt);
    return [
      ['Staff number', 'Name', 'Slab', 'Pay looked up', 'Professional tax'],
      ...mine.map((r) => [r.staffNumber, r.name, SLAB_WORDS[r.ptSlab] ?? '', money(r.pay.grossPaise + r.pay.additionsPaise), money(r.pay.ptPaise)]),
      ['', 'Total', '', '', money(mine.reduce((t, r) => t + r.pay.ptPaise, 0))],
    ];
  }
  if (list !== 'register') return null;
  const parts = snapshot.settings.parts;
  const earned = (r, key) => r.pay.earned.find((p) => p.key === key)?.amountPaise ?? 0;
  return [
    ['Staff number', 'Name', 'Designation', 'Department', 'Paid days', 'Monthly pay', ...parts.map((p) => p.name), 'Pay for the month', 'Additions', 'PF', 'ESI', 'Professional tax', 'TDS', 'Other deductions', 'Advance taken back', 'All deductions', 'Take-home', 'PF, hospital’s share', 'ESI, hospital’s share'],
    ...rows.map((r) => [
      r.staffNumber,
      r.name,
      r.designation ?? '',
      r.department ?? '',
      days(r.paidDays),
      money(r.monthlyPaise),
      ...parts.map((p) => money(earned(r, p.key))),
      ...['grossPaise', 'additionsPaise', 'pfPaise', 'esiPaise', 'ptPaise', 'tdsPaise', 'otherDeductionsPaise', 'advancePaise', 'deductionsPaise', 'takeHomePaise', 'pfEmployerPaise', 'esiEmployerPaise'].map((k) => money(r.pay[k])),
    ]),
    [
      '',
      'Total',
      '',
      '',
      '',
      sum((r) => r.monthlyPaise),
      ...parts.map((p) => sum((r) => earned(r, p.key))),
      ...['grossPaise', 'additionsPaise', 'pfPaise', 'esiPaise', 'ptPaise', 'tdsPaise', 'otherDeductionsPaise', 'advancePaise', 'deductionsPaise', 'takeHomePaise', 'pfEmployerPaise', 'esiEmployerPaise'].map((k) => sum((r) => r.pay[k])),
    ],
  ];
}
