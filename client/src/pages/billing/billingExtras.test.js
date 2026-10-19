// Billing extras: the words and checks the screens share – insurance details, what a claim printout still needs,
// the UPI ID's format and the billing settings. Made-up names and numbers only.
import { describe, expect, it } from 'vitest';
import { CLAIM_LAYOUTS, INSURANCE_FIELDS, NO_SEX_WORDS_HINT, PMJAY_FIELDS, billingTabs, claimMissing, insuranceForm, insuranceRows, itemsWord, takeMoneyLabel, upiIdProblem, upiSettingsProblems } from './billingFormat.js';

describe('insurance or scheme details', () => {
  it('has the same fields and lengths as the server (billing/billingRules.js)', () => {
    expect(Object.fromEntries([...INSURANCE_FIELDS, ...PMJAY_FIELDS].map(([k, , max]) => [k, max]))).toEqual({ insurer: 80, policyNumber: 60, tpa: 80, preAuthNumber: 60, claimNumber: 80, pmjayId: 40, packageCode: 40, packageName: 150 });
  });

  it('fills the form from a bill, and lists only what is recorded', () => {
    expect(insuranceForm(null)).toEqual({ insurer: '', policyNumber: '', tpa: '', preAuthNumber: '', claimNumber: '', pmjayId: '', packageCode: '', packageName: '' });
    const insurance = { insurer: 'Sample Health Insurance', policyNumber: 'POL-1', tpa: '', preAuthNumber: '', claimNumber: 'CLM-1', pmjayId: '', packageCode: '', packageName: '', byName: 'Sample Reception', at: '2026-10-05T06:00:00.000Z' };
    expect(insuranceForm(insurance)).toMatchObject({ insurer: 'Sample Health Insurance', claimNumber: 'CLM-1', tpa: '' });
    expect(insuranceForm(insurance)).not.toHaveProperty('byName');
    expect(insuranceRows(insurance)).toEqual([
      ['Insurance company or scheme', 'Sample Health Insurance'],
      ['Policy or member number', 'POL-1'],
      ['Claim number', 'CLM-1'],
    ]);
    expect(insuranceRows(null)).toEqual([]);
    expect(insuranceRows({ ...insurance, tpa: 'Sample TPA', pmjayId: 'PMJ-1' }).map(([label]) => label)).toEqual(['Insurance company or scheme', 'Policy or member number', 'TPA', 'Claim number', 'PM-JAY ID']);
  });

  it('says which details a printout still needs', () => {
    expect(Object.keys(CLAIM_LAYOUTS)).toEqual(['claim', 'pmjay']);
    expect(claimMissing(null, 'claim')).toEqual(['Insurance company or scheme', 'Policy or member number']);
    expect(claimMissing({ insurer: 'Sample Health Insurance', policyNumber: 'POL-1' }, 'claim')).toEqual([]);
    expect(claimMissing({ insurer: 'PM-JAY', pmjayId: 'PMJ-1', packageCode: 'SG-01' }, 'pmjay')).toEqual(['Pre-authorisation number', 'Package name']);
    expect(claimMissing(null, 'pmjay')).toEqual(['PM-JAY ID', 'Pre-authorisation number', 'Package code', 'Package name']);
    expect(itemsWord(1)).toBe('1 item');
    expect(itemsWord(3)).toBe('3 items');
  });
});

describe('words on the bill', () => {
  it('names the button that takes money: a deposit while she is in hospital, a payment otherwise', () => {
    expect(takeMoneyLabel({ stay: { inHospital: true } })).toBe('Take a deposit');
    expect(takeMoneyLabel({ stay: { inHospital: false } })).toBe('Take payment');
    expect(takeMoneyLabel({ stay: null })).toBe('Take payment');
    expect(takeMoneyLabel(undefined)).toBe('Take payment');
  });
  it('the hint under a reason says which words the bill does not take – with no exclamation mark', () => {
    expect(NO_SEX_WORDS_HINT).toBe('Leave out words such as son, daughter, boy, girl, male or female.');
  });
});

describe('the UPI ID and the billing settings', () => {
  it('checks the format of a UPI ID the way the server does', () => {
    for (const ok of ['samplehospital@okbank', 'sample.hospital-1@okhdfcbank', '9876500000@ybl', 'ab@upi', ' samplehospital@okbank ']) expect(upiIdProblem(ok), ok).toBeNull();
    expect(upiIdProblem('')).toMatch(/Enter the UPI ID/);
    expect(upiIdProblem('sample hospital@okbank')).toMatch(/no spaces/);
    expect(upiIdProblem('samplehospital')).toMatch(/@ is missing/);
    expect(upiIdProblem('sample@hospital@okbank')).toMatch(/one @ only/);
    for (const bad of ['x@y', 'sample@1bank', 'sam!ple@okbank', '@okbank', 'sample@', 'sample@ok-bank', `${'a'.repeat(95)}@okbank`]) expect(upiIdProblem(bad), bad).toMatch(/does not look like a UPI ID/);
  });

  it('asks for the payee name, and for a changed UPI ID to be typed twice', () => {
    expect(upiSettingsProblems({ upiId: '', payeeName: '', again: '' })).toEqual({}); // both empty: the links are off
    expect(upiSettingsProblems({ upiId: 'samplehospital', payeeName: 'Sample Maternity', again: '' })).toEqual({ upiId: expect.stringMatching(/@ is missing/) });
    expect(upiSettingsProblems({ upiId: 'samplehospital@okbank', payeeName: '', again: 'samplehospital@okbank' })).toEqual({ payeeName: expect.stringMatching(/registered under/) });
    expect(upiSettingsProblems({ upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity', again: '' })).toEqual({ again: 'Type the same UPI ID again.' });
    expect(upiSettingsProblems({ upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity', again: 'samplehospitel@okbank' })).toEqual({ again: 'Type the same UPI ID again.' });
    expect(upiSettingsProblems({ upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity', again: 'samplehospital@okbank' })).toEqual({});
    // Only the payee name changed: the saved UPI ID need not be typed again
    expect(upiSettingsProblems({ upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity Home', again: '' }, { upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity' })).toEqual({});
  });

  it('shows the Settings tab to the hospital admin only', () => {
    expect(billingTabs(['receptionist']).map((t) => t.label)).toEqual(['Bills', 'Unpaid', 'Daily summary', 'Cash handover', 'Price list']);
    expect(billingTabs(['admin']).map((t) => t.label)).toEqual(['Bills', 'Unpaid', 'Daily summary', 'Cash handover', 'Monthly', 'Price list', 'Settings', 'Accounts']);
    expect(billingTabs(['billing']).map((t) => t.label)).toEqual(['Bills', 'Unpaid', 'Daily summary', 'Cash handover', 'Monthly', 'Price list', 'Accounts']); // the accounts staff download the Tally file (19 Oct 2026)
  });
});
