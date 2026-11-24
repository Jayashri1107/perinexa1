// Pharmacy → Settlement (24 Nov 2026): what the screen asks the server for, and the sums of the Settlement window –
// kept apart from the screen so they can be tested.

import { amount } from './searchBill.js';

export const SETTLE_TYPES = [
  ['opd', 'OP'],
  ['ipd', 'IP'],
  ['external', 'External'],
];

// The ways money is received, as on the Payment window of a bill
export const SETTLE_WAYS = [
  { mode: 'cash', label: 'Cash' },
  { mode: 'cheque', label: 'Cheque', ref: 'Cheque no', bank: 'Bank name' },
  { mode: 'card', label: 'Card', ref: 'Card no (last 4 digits)', bank: 'Bank name' },
  { mode: 'neft', label: 'NEFT / RTGS', ref: 'Transaction id', bank: 'Bank name' },
  { mode: 'upi', label: 'UPI', ref: 'Transaction id', bank: 'App name' },
];

/** Rupees typed (12, 12.5, 12.50) → paise; '' → 0; anything else → null. */
export function toPaise(text) {
  const t = String(text ?? '').trim();
  if (!t) return 0;
  return /^\d+(\.\d{0,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
}

/** Paise → what goes back in a box: 1234.50. */
export const typed = (paise) => (paise / 100).toFixed(2);

/** Why Search can't be pressed yet ('' when it can). Nothing typed: today's bills of the type (24 Nov 2026). */
export function findProblem(form) {
  if (form.type === 'external') return '';
  const text = form.mrn.trim() || form.name.trim();
  return !text || text.length >= 2 ? '' : 'Type the UHID or at least two letters of the patient’s name – or nothing, for today’s bills.';
}

/** What Search asks the server for: the UHID when one is typed, otherwise the name. */
export function findQuery(form) {
  const text = form.mrn.trim() || form.name.trim();
  return { type: form.type, ...(text ? { search: text } : {}) };
}

/** The credit bills chosen and their balance. */
export function selectedOf(creditBills, chosen) {
  const rows = (creditBills ?? []).filter((b) => chosen.has(b.id));
  return { rows, paise: rows.reduce((n, b) => n + b.balancePaise, 0) };
}

/** An empty Settlement window; preset: 'advance' | 'discount' | 'settle' – the button that opened it. */
export function newSettle(preset, { selectedPaise, advancePaise }) {
  const ways = Object.fromEntries(SETTLE_WAYS.map((w) => [w.mode, { on: false, amount: '', reference: '', bank: '' }]));
  const advance = preset === 'advance' ? Math.min(selectedPaise, Math.max(0, advancePaise)) : 0;
  if (preset === 'settle') ways.cash = { ...ways.cash, on: true, amount: typed(selectedPaise) };
  return { advance: advance ? typed(advance) : '', concession: '', reason: '', remarks: '', ways };
}

/**
 * The window's sums and what is wrong with it. Every rupee of the bills chosen is settled exactly once – by the
 * advance, a concession or money received – as the server checks again.
 */
export function settleSums(s, { selectedPaise, advancePaise }) {
  const advance = toPaise(s.advance);
  const concession = toPaise(s.concession);
  const parts = SETTLE_WAYS.filter((w) => s.ways[w.mode].on).map((w) => ({ w, x: s.ways[w.mode], paise: toPaise(s.ways[w.mode].amount) }));
  const received = parts.reduce((n, p) => n + (p.paise ?? 0), 0);
  const accounted = (advance ?? 0) + (concession ?? 0) + received;
  const left = selectedPaise - accounted;
  let problem = '';
  if (advance === null || concession === null || parts.some((p) => p.paise === null)) problem = 'Write amounts in rupees, for example 250 or 250.50.';
  else if (parts.some((p) => !p.paise)) problem = 'Write the amount of each way ticked, or untick it.';
  else if (advance > advancePaise) problem = `Only ₹${amount(advancePaise)} of advance is available.`;
  else if (concession && !s.reason.trim()) problem = 'Write why the discount is given.';
  else if (parts.some((p) => p.w.mode === 'card' && p.x.reference.trim() && !/^\d{4}$/.test(p.x.reference.trim()))) problem = 'Write only the last 4 digits of the card, never the whole number.';
  else if (left > 0) problem = `₹${amount(left)} is still to settle: add it as advance, discount or money received.`;
  else if (left < 0) problem = `₹${amount(-left)} more than the bills chosen: lower an amount.`;
  return { advance: advance ?? 0, concession: concession ?? 0, received, accounted, left, problem, parts };
}

/** What Save sends: the bills chosen, settled in full. */
export function settleBody(s, { patientId, invoiceIds, sums }) {
  return {
    patientId,
    invoiceIds,
    advancePaise: sums.advance,
    concessionPaise: sums.concession,
    ...(sums.concession ? { concessionReason: s.reason.trim() } : {}),
    remarks: s.remarks.trim(),
    payments: sums.parts.map(({ w, x, paise }) => ({
      mode: w.mode,
      amountPaise: paise,
      ...(w.ref && x.reference.trim() ? { reference: x.reference.trim() } : {}),
      ...(w.bank && x.bank.trim() ? { bank: x.bank.trim() } : {}),
    })),
  };
}

/** "₹500.00 received in cash and UPI, ₹200.00 from the advance, ₹50.00 discount" – what a settlement was made of. */
export function settledWords(result, modes = []) {
  const how = modes.length ? ` in ${modes.map((m) => SETTLE_WAYS.find((w) => w.mode === m)?.label ?? m).join(' and ')}` : '';
  return [
    result.receivedPaise ? `₹${amount(result.receivedPaise)} received${how}` : '',
    result.advancePaise ? `₹${amount(result.advancePaise)} from the advance` : '',
    result.concessionPaise ? `₹${amount(result.concessionPaise)} discount` : '',
  ]
    .filter(Boolean)
    .join(', ');
}
