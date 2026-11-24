import { describe, expect, it } from 'vitest';
import { LIST_WORDS, earlierLine, advanceStatus, amountText, hasMonthChanges, lastFour, lockTitle, monthBody, monthForm, monthsLeft, payLines, payslipBand, rateBody, rateDraft, rateForm, rateLines, slabLines, typedPaise, typedPercent } from './payFormat.js';

// Fake sample figures only (the DRAFT table of docs/PAYROLL_BUILD_NOTE.md – never a statement that they are right).
const PF = { staffPercent: 12, employerPercent: 12, limitPaise: 1500000, capAtLimit: true, status: 'draft', confirmedBy: '', confirmedOn: null, from: null };
const ESI = { staffPercent: 0.75, employerPercent: 3.25, limitPaise: 2100000, status: 'confirmed', confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20', from: '2026-04-01' };
const PT = { slabs: { men: [{ upToPaise: 750000, amountPaise: 0 }, { upToPaise: 1000000, amountPaise: 17500 }, { upToPaise: null, amountPaise: 20000 }], women: [{ upToPaise: 2500000, amountPaise: 0 }, { upToPaise: null, amountPaise: 20000 }] }, februaryPaise: 30000, status: 'draft', confirmedBy: '', confirmedOn: null, from: null };

describe('payroll: amounts and percentages as typed', () => {
  it('reads an amount box: empty is nothing typed, a word is not an amount', () => {
    expect(typedPaise('')).toBeNull();
    expect(typedPaise('  ')).toBeNull();
    expect(typedPaise('500')).toBe(50000);
    expect(typedPaise('10.50')).toBe(1050);
    expect(typedPaise('0')).toBe(0);
    expect(typedPaise('five')).toBeUndefined();
    expect(amountText(1500000)).toBe('15000');
    expect(amountText(1050)).toBe('10.50');
    expect(amountText(null)).toBe('');
  });

  it('reads a percentage with at most two decimals', () => {
    expect(typedPercent('12')).toBe(12);
    expect(typedPercent('0.75')).toBe(0.75);
    expect(typedPercent('100')).toBe(100);
    for (const bad of ['', '101', '12.345', '-1', 'twelve', '12%']) expect(typedPercent(bad), bad).toBeNull();
  });
});

describe('payroll: the rate table', () => {
  it('a group is DRAFT until it is confirmed', () => {
    expect(rateDraft(PF)).toBe(true);
    expect(rateDraft(ESI)).toBe(false);
    expect(rateDraft(undefined)).toBe(true);
  });

  it('turns a group into the boxes of its form and back', () => {
    expect(rateForm('pf', PF)).toEqual({ staffPercent: '12', employerPercent: '12', limit: '15000', capAtLimit: true, confirmed: false, confirmedBy: '', confirmedOn: '', from: '' });
    expect(rateBody('pf', rateForm('pf', PF))).toEqual({ body: { staffPercent: 12, employerPercent: 12, limitPaise: 1500000, capAtLimit: true, confirmed: false, confirmedBy: '', confirmedOn: null, from: null }, errors: {} });
    expect(rateBody('esi', rateForm('esi', ESI)).body).toEqual({ staffPercent: 0.75, employerPercent: 3.25, limitPaise: 2100000, confirmed: true, confirmedBy: 'Sample Accountant', confirmedOn: '2026-11-20', from: '2026-04-01' });
    const pt = rateBody('pt', rateForm('pt', PT));
    expect(pt.errors).toEqual({});
    expect(pt.body.slabs).toEqual(PT.slabs);
    expect(pt.body.februaryPaise).toBe(30000);
  });

  it('says which box is wrong before anything is sent', () => {
    expect(rateBody('pf', { ...rateForm('pf', PF), staffPercent: 'twelve', limit: '' }).errors).toEqual({ staffPercent: 'Write a percentage like 12 or 0.75', limitPaise: 'Write the pay limit, like 15000' });
    const form = rateForm('pt', PT);
    form.slabs.men[1].amount = '';
    form.february = 'x';
    expect(Object.keys(rateBody('pt', form).errors).sort()).toEqual(['februaryPaise', 'slabs.men']);
    // the last row is "everything above": whatever stands in its "up to" box is not sent
    const odd = rateForm('pt', PT);
    odd.slabs.women[1].upTo = '99999';
    expect(rateBody('pt', odd).body.slabs.women[1].upToPaise).toBeNull();
  });

  it('puts the figures in plain words', () => {
    expect(slabLines(PT.slabs.men)).toEqual(['Up to ₹7,500: nil', 'Up to ₹10,000: ₹175', 'Above ₹10,000: ₹200']);
    expect(slabLines([{ upToPaise: null, amountPaise: 20000 }])).toEqual(['Any pay: ₹200']);
    expect(rateLines('pf', PF)).toEqual(['Staff share 12%, hospital’s share 12% – of the pay that counts for PF.', 'Worked out on no more than ₹15,000 a month.']);
    expect(rateLines('pf', { ...PF, capAtLimit: false })[1]).toMatch(/limit of ₹15,000 is not applied/);
    expect(rateLines('esi', ESI)[0]).toBe('Staff share 0.75%, hospital’s share 3.25% – of the pay that counts for ESI.');
    expect(rateLines('pt', PT)).toHaveLength(3);
    expect(earlierLine('esi', ESI, (d) => d)).toBe('From 2026-04-01 (Sample Accountant, 2026-11-20): Staff share 0.75%, hospital’s share 3.25% – of the pay that counts for ESI. A person whose monthly pay is above ₹21,000 is marked on the sheet.');
    expect(LIST_WORDS.bank).toBe('Bank payment list');
  });
});

describe('payroll: advances', () => {
  it('says where an advance stands', () => {
    expect(advanceStatus({ stopped: null, balancePaise: 500000 })).toBe('open');
    expect(advanceStatus({ stopped: null, balancePaise: 0 })).toBe('done');
    expect(advanceStatus({ stopped: { reason: 'Entered twice' }, balancePaise: 500000 })).toBe('stopped');
    expect(monthsLeft({ balancePaise: 900000, instalmentPaise: 200000 })).toBe(5);
    expect(monthsLeft({ balancePaise: 900000, instalmentPaise: 0 })).toBeNull();
  });
});

describe('payroll: one person’s month', () => {
  const advance = { id: 'a1', balancePaise: 900000, instalmentPaise: 200000, thisMonth: null };
  const row = { month: { tds: null, entryTdsPaise: 50000, lines: [], advances: [advance] } };

  it('starts empty, and an empty form sends nothing for the month', () => {
    const form = monthForm(row);
    expect(form).toEqual({ tds: '', lines: [], instalments: { a1: { amount: '', reason: '' } } });
    expect(monthBody(form, row)).toEqual({ body: { tdsPaise: null, lines: [], instalments: [] }, errors: {} });
    expect(hasMonthChanges(row)).toBe(false);
  });

  it('sends what was typed: TDS for the month, lines, a changed instalment', () => {
    const form = { tds: '0', lines: [{ kind: 'addition', label: ' Arrear for September ', amount: '1000' }, { kind: 'deduction', label: '', amount: '' }], instalments: { a1: { amount: '1000', reason: 'Asked for less this month' } } };
    expect(monthBody(form, row)).toEqual({ body: { tdsPaise: 0, lines: [{ kind: 'addition', label: 'Arrear for September', amountPaise: 100000 }], instalments: [{ advanceId: 'a1', amountPaise: 100000, reason: 'Asked for less this month' }] }, errors: {} });
  });

  it('says which box is wrong', () => {
    const form = { tds: 'x', lines: [{ kind: 'addition', label: 'A', amount: '0' }], instalments: { a1: { amount: '10000', reason: '' } } };
    expect(monthBody(form, row).errors).toEqual({
      tdsPaise: 'Write the TDS as an amount, like 500 – or leave the box empty',
      'lines.0.label': 'Write what it is for',
      'lines.0.amountPaise': 'Write an amount above 0',
      'instalments.0.amountPaise': 'Only ₹9,000 is left of this advance',
      'instalments.0.reason': 'Say why the instalment is changed for this month',
    });
  });

  it('shows what was saved, and marks the row', () => {
    const saved = { month: { tds: { tdsPaise: 50000 }, lines: [{ kind: 'deduction', label: 'Uniform', amountPaise: 30000 }], advances: [{ ...advance, thisMonth: { amountPaise: 100000, reason: 'Asked for less' } }] } };
    expect(monthForm(saved)).toEqual({ tds: '500', lines: [{ kind: 'deduction', label: 'Uniform', amount: '300' }], instalments: { a1: { amount: '1000', reason: 'Asked for less' } } });
    expect(hasMonthChanges(saved)).toBe(true);
  });
});

describe('payroll: the payslip', () => {
  const pay = { earned: [{ key: 'basic', name: 'Basic pay', amountPaise: 1141920 }, { key: 'hra', name: 'HRA', amountPaise: 285480 }], lines: [{ kind: 'addition', label: 'Arrear for September', amountPaise: 100000 }, { kind: 'deduction', label: 'Uniform', amountPaise: 30000 }], grossPaise: 1427400, additionsPaise: 100000, pfPaise: 137000, esiPaise: 10700, ptPaise: 20000, tdsPaise: 0, advancePaise: 100000, deductionsPaise: 297700, takeHomePaise: 1229700 };

  it('lists earnings and deductions, each only where it applies', () => {
    expect(payLines({ applies: { pf: true, esi: true, pt: true }, pay })).toEqual({
      earnings: [['Basic pay', 1141920], ['HRA', 285480], ['Arrear for September', 100000]],
      earningsPaise: 1527400,
      deductions: [['PF', 137000], ['ESI', 10700], ['Professional tax', 20000], ['Uniform', 30000], ['Advance taken back', 100000]],
      deductionsPaise: 297700,
      takeHomePaise: 1229700,
    });
    expect(payLines({ applies: { pf: false, esi: false, pt: false }, pay: { ...pay, lines: [], advancePaise: 0, tdsPaise: 50000 } }).deductions).toEqual([['Income tax (TDS)', 50000]]);
    expect(payLines({ pay: null })).toBeNull();
  });

  it('prints a number by its last four only, and says what kind of payslip it is', () => {
    expect(lastFour('0400')).toBe('•••• 0400');
    expect(lastFour('')).toBe('—');
    const date = (d) => `on ${d}`;
    expect(payslipBand({ draft: true }, date)).toBe('DRAFT – not for payment');
    expect(payslipBand({ draft: false, version: 1, revised: false, replacedOn: '2026-11-24' }, date)).toBe('Replaced on on 2026-11-24 – a revised payslip was made');
    expect(payslipBand({ draft: false, version: 2, revised: true, replacedOn: null }, date)).toBe('Revised – version 2');
    expect(payslipBand({ draft: false, version: 1, revised: false, replacedOn: null }, date)).toBeNull();
    expect(lockTitle({ month: '2026-10', locked: null })).toBe('October 2026');
    expect(lockTitle({ month: '2026-10', locked: { version: 1 } })).toBe('October 2026 – locked');
    expect(lockTitle({ month: '2026-10', locked: { version: 2 } })).toBe('October 2026 – locked, version 2');
  });
});
