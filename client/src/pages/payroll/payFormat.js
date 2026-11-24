// Payroll, Stages C and D (docs/PAYROLL_BUILD_NOTE.md section 5 C and D): the words and the small sums of the Rates,
// Advances and Run payroll screens and of the payslip. PURE – no React, no requests.
// Nothing here works a deduction out: the server does (server/src/payroll/payrollDeductions.js).
import { rupees, toPaise } from '../billing/billingFormat.js';
import { monthLabel } from './runFormat.js';

export const RATE_GROUPS = ['pf', 'esi', 'pt'];
export const RATE_WORDS = { pf: 'PF', esi: 'ESI', pt: 'Professional tax' };
export const SLAB_KEYS = ['men', 'women'];
export const SLAB_WORDS = { '': 'Not chosen', men: 'Men’s slabs', women: 'Women’s slabs' };
export const LISTS = ['register', 'pf', 'esi', 'pt'];
export const LIST_WORDS = { register: 'Salary register', pf: 'PF list', esi: 'ESI list', pt: 'Professional tax list', bank: 'Bank payment list' };
export const LINE_KIND_WORDS = { addition: 'Addition', deduction: 'Deduction' };

/** What stands between a month and its lock, in plain words (the keys the server sends as lockBlockers). */
export const LOCK_BLOCKER_WORDS = {
  sheet: 'The salary sheet is not made yet',
  rules: 'The rules for a day’s pay are DRAFT – the hospital admin writes the accountant’s confirmation in Payroll → Settings',
  'rate-pf': 'The PF rates are DRAFT – the hospital admin confirms them in Payroll → Rates',
  'rate-esi': 'The ESI rates are DRAFT – the hospital admin confirms them in Payroll → Rates',
  'rate-pt': 'The professional tax slabs are DRAFT – the hospital admin confirms them in Payroll → Rates',
  noPay: 'A person has no pay entered – Payroll → Staff',
  ptSlab: 'Professional tax is taken from a person whose slab is not chosen – Payroll → Staff',
  overDeducted: 'A person’s deductions are more than their pay – check the TDS and the one-off deductions',
};

/** Notes on one person's deductions (the keys the server sends in pay.notes). */
export const PAY_NOTE_WORDS = {
  ptSlabMissing: 'Professional tax slab not chosen',
  esiAboveLimit: 'Monthly pay is above the ESI pay limit – ask the accountant whether ESI applies',
  overDeducted: 'Deductions are more than the pay',
  advanceShort: 'Not enough pay left for the whole advance instalment',
};

// ---------- Amounts typed ----------
/** Paise as the text of an input box: 1500000 → "15000", 1050 → "10.50", null → "". */
export const amountText = (paise) => (paise == null ? '' : paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));
/** The text of an amount box as paise; '' → null (nothing typed); not an amount → undefined. */
export function typedPaise(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const paise = toPaise(t);
  return paise == null ? undefined : paise;
}
/** A percentage as typed: "0.75" → 0.75; '' or not a number between 0 and 100 with at most two decimals → null. */
export function typedPercent(text) {
  const t = String(text ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n <= 100 ? n : null;
}
export const percentText = (n) => `${n}%`;

// ---------- The rate table ----------
/** Is a group of rates DRAFT? (not confirmed with a name and a date) */
export const rateDraft = (group) => group?.status !== 'confirmed';

/** One group as the boxes of its form (amounts as text). */
export function rateForm(key, group) {
  const by = { confirmed: !rateDraft(group), confirmedBy: group.confirmedBy ?? '', confirmedOn: group.confirmedOn ?? '', from: group.from ?? '' };
  if (key === 'pt') {
    const rows = (list) => list.map((s) => ({ upTo: amountText(s.upToPaise), amount: amountText(s.amountPaise) }));
    return { slabs: { men: rows(group.slabs.men), women: rows(group.slabs.women) }, february: amountText(group.februaryPaise), ...by };
  }
  return { staffPercent: String(group.staffPercent), employerPercent: String(group.employerPercent), limit: amountText(group.limitPaise), ...(key === 'pf' ? { capAtLimit: group.capAtLimit !== false } : {}), ...by };
}

/** The form as sent to the server: { body, errors } – errors under the names the server uses. */
export function rateBody(key, form) {
  const errors = {};
  const by = { confirmed: Boolean(form.confirmed), confirmedBy: form.confirmedBy.trim(), confirmedOn: form.confirmedOn || null, from: form.from || null };
  if (key === 'pt') {
    const slabs = {};
    for (const k of SLAB_KEYS) {
      slabs[k] = form.slabs[k].map((row, i, all) => ({ upToPaise: i === all.length - 1 ? null : typedPaise(row.upTo), amountPaise: typedPaise(row.amount) }));
      if (slabs[k].some((s, i, all) => s.amountPaise == null || (i < all.length - 1 && s.upToPaise == null))) errors[`slabs.${k}`] = 'Write every amount, like 7500 or 175';
    }
    const februaryPaise = typedPaise(form.february);
    if (februaryPaise == null) errors.februaryPaise = 'Write the amount for February';
    return { body: { slabs, februaryPaise, ...by }, errors };
  }
  const staffPercent = typedPercent(form.staffPercent);
  const employerPercent = typedPercent(form.employerPercent);
  const limitPaise = typedPaise(form.limit);
  if (staffPercent == null) errors.staffPercent = 'Write a percentage like 12 or 0.75';
  if (employerPercent == null) errors.employerPercent = 'Write a percentage like 12 or 3.25';
  if (limitPaise == null) errors.limitPaise = 'Write the pay limit, like 15000';
  return { body: { staffPercent, employerPercent, limitPaise, ...(key === 'pf' ? { capAtLimit: Boolean(form.capAtLimit) } : {}), ...by }, errors };
}

/** A table of slabs in words: ["Up to ₹7,500: nil", "Up to ₹10,000: ₹175", "Above ₹10,000: ₹200"]. */
export function slabLines(slabs) {
  return (slabs ?? []).map((s, i) => {
    const amount = s.amountPaise ? rupees(s.amountPaise) : 'nil';
    if (s.upToPaise != null) return `Up to ${rupees(s.upToPaise)}: ${amount}`;
    return i > 0 ? `Above ${rupees(slabs[i - 1].upToPaise)}: ${amount}` : `Any pay: ${amount}`;
  });
}

/** The figures of a group in one or two plain sentences (read by the accounts login, who can't change them). */
export function rateLines(key, group) {
  if (key === 'pf') return [`Staff share ${percentText(group.staffPercent)}, hospital’s share ${percentText(group.employerPercent)} – of the pay that counts for PF.`, group.capAtLimit !== false ? `Worked out on no more than ${rupees(group.limitPaise)} a month.` : `Worked out on the whole pay that counts for PF (the limit of ${rupees(group.limitPaise)} is not applied).`];
  if (key === 'esi') return [`Staff share ${percentText(group.staffPercent)}, hospital’s share ${percentText(group.employerPercent)} – of the pay that counts for ESI.`, `A person whose monthly pay is above ${rupees(group.limitPaise)} is marked on the sheet.`];
  return [`Men: ${slabLines(group.slabs.men).join('; ')}.`, `Women: ${slabLines(group.slabs.women).join('; ')}.`, `In February the top slab pays ${rupees(group.februaryPaise)}.`];
}

/** A set of figures confirmed earlier, in one line: "From 1 Apr 2026 (Sample Accountant, 20 Nov 2026): …". */
export const earlierLine = (key, set, formatDate) => `From ${formatDate(set.from)} (${set.confirmedBy}, ${formatDate(set.confirmedOn)}): ${rateLines(key, set).join(' ')}`;

// ---------- Advances ----------
/** 'stopped' | 'done' (all taken back) | 'open'. */
export const advanceStatus = (a) => (a.stopped ? 'stopped' : a.balancePaise === 0 ? 'done' : 'open');
export const ADVANCE_STATUS_WORDS = { open: 'Being taken back', done: 'All taken back', stopped: 'Stopped' };
/** How many more months at the usual instalment, or null when the instalment is 0. */
export const monthsLeft = (a) => (a.instalmentPaise > 0 ? Math.ceil(a.balancePaise / a.instalmentPaise) : null);

// ---------- One person's month ----------
/** The boxes of "this month" for a row of the sheet. */
export function monthForm(row) {
  return {
    tds: row.month?.tds ? amountText(row.month.tds.tdsPaise) : '',
    lines: (row.month?.lines ?? []).map((l) => ({ kind: l.kind, label: l.label, amount: amountText(l.amountPaise) })),
    instalments: Object.fromEntries((row.month?.advances ?? []).map((a) => [a.id, { amount: a.thisMonth ? amountText(a.thisMonth.amountPaise) : '', reason: a.thisMonth?.reason ?? '' }])),
  };
}

/** The boxes as sent to the server: { body, errors }. An empty TDS box: the figure on the pay entry. */
export function monthBody(form, row) {
  const errors = {};
  const tdsPaise = typedPaise(form.tds);
  if (tdsPaise === undefined) errors.tdsPaise = 'Write the TDS as an amount, like 500 – or leave the box empty';
  const lines = [];
  form.lines.forEach((l, i) => {
    const label = l.label.trim();
    const amountPaise = typedPaise(l.amount);
    if (!label && amountPaise === null) return; // an empty line is not a line
    if (label.length < 2) errors[`lines.${i}.label`] = 'Write what it is for';
    if (!amountPaise) errors[`lines.${i}.amountPaise`] = 'Write an amount above 0';
    lines.push({ kind: l.kind, label, amountPaise: amountPaise ?? 0 });
  });
  const instalments = [];
  (row.month?.advances ?? []).forEach((a, i) => {
    const typed = form.instalments[a.id] ?? { amount: '', reason: '' };
    const amountPaise = typedPaise(typed.amount);
    if (amountPaise === null) return; // empty: the usual instalment
    if (amountPaise === undefined) errors[`instalments.${i}.amountPaise`] = 'Write an amount, like 1000 – or leave the box empty for the usual instalment';
    else if (amountPaise > a.balancePaise) errors[`instalments.${i}.amountPaise`] = `Only ${rupees(a.balancePaise)} is left of this advance`;
    if (typed.reason.trim().length < 3) errors[`instalments.${i}.reason`] = 'Say why the instalment is changed for this month';
    instalments.push({ advanceId: a.id, amountPaise: amountPaise ?? 0, reason: typed.reason.trim() });
  });
  return { body: { tdsPaise: tdsPaise ?? null, lines, instalments }, errors };
}

/** Has this person anything typed for this month alone? (shown as a mark on their row) */
export const hasMonthChanges = (row) => Boolean(row.month?.tds || row.month?.lines?.length || row.month?.advances?.some((a) => a.thisMonth));

// ---------- The payslip ----------
/** Earnings and deductions of a person as [label, paise] lines, with the totals: what the payslip and the dialog show. */
export function payLines(row) {
  const p = row.pay;
  if (!p) return null;
  const earnings = [...p.earned.map((e) => [e.name, e.amountPaise]), ...p.lines.filter((l) => l.kind === 'addition').map((l) => [l.label, l.amountPaise])];
  const deductions = [
    ...(row.applies?.pf ? [['PF', p.pfPaise]] : []),
    ...(row.applies?.esi ? [['ESI', p.esiPaise]] : []),
    ...(row.applies?.pt ? [['Professional tax', p.ptPaise]] : []),
    ...(p.tdsPaise ? [['Income tax (TDS)', p.tdsPaise]] : []),
    ...p.lines.filter((l) => l.kind === 'deduction').map((l) => [l.label, l.amountPaise]),
    ...(p.advancePaise ? [['Advance taken back', p.advancePaise]] : []),
  ];
  return { earnings, earningsPaise: p.grossPaise + p.additionsPaise, deductions, deductionsPaise: p.deductionsPaise, takeHomePaise: p.takeHomePaise };
}

/** A number kept by its last four characters, as the payslip prints it: "•••• 0400", or "—" when none is kept. */
export const lastFour = (four) => (four ? `•••• ${four}` : '—');

/** The band across a payslip, or null: DRAFT while the month is open; replaced / revised for a locked version. */
export function payslipBand(slips, formatDate) {
  if (slips.draft) return 'DRAFT – not for payment';
  if (slips.replacedOn) return `Replaced on ${formatDate(slips.replacedOn)} – a revised payslip was made`;
  if (slips.revised) return `Revised – version ${slips.version}`;
  return null;
}

/** The title of a month's state for the page: "October 2026 – locked, version 2". */
export const lockTitle = (state) => (state.locked ? `${monthLabel(state.month)} – locked${state.locked.version > 1 ? `, version ${state.locked.version}` : ''}` : monthLabel(state.month));
