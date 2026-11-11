// Cashless insurance on a bill (11 Nov 2026): the approved amount comes off what the patient pays. Made-up numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClaimDialog, claimRows, hasClaim } from './InsuranceClaim.jsx';
import { InlineForms } from './billingUi.jsx';

const text = (html) => html.replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
// Net 86,000; insurer approved 60,000; the patient paid 10,000
const bill = (extra = {}) => ({ id: 'b'.repeat(24), total: 8600000, claimApproved: 6000000, insuranceShare: 6000000, insurancePaid: 0, insuranceDue: 6000000, patientPaid: 1000000, patientBalance: 1600000, insurance: { insurer: 'Sample Health Insurance', tpa: 'Sample TPA' }, ...extra });

describe('cashless insurance', () => {
  it('splits the sums after Net pay: insurance, paid by patient, patient to pay, due from insurance', () => {
    expect(claimRows(bill()).map(([, label, value]) => [label, value])).toEqual([
      ['Insurance (approved)', 6000000],
      ['Paid by patient', 1000000],
      ['Patient to pay', 1600000],
      ['Due from insurance', 6000000],
    ]);
    // The insurer paid part
    expect(claimRows(bill({ insurancePaid: 4000000, insuranceDue: 2000000 })).map(([key]) => key)).toEqual(['insurance', 'patientPaid', 'patientBalance', 'insurancePaid', 'insuranceDue']);
  });

  it('shows nothing extra on a bill without insurance', () => {
    const plain = bill({ claimApproved: 0, insurancePaid: 0, insuranceShare: 0, insuranceDue: 0 });
    expect(hasClaim(plain)).toBe(false);
    expect(claimRows(plain)).toEqual([]);
  });

  it('the form asks for the insurer, TPA, pre-authorisation number and the approved amount, with one primary button', () => {
    const html = renderToStaticMarkup(
      // As on the bill pages: the form opens in the page
      <InlineForms.Provider value>
        <ClaimDialog bill={bill()} onClose={() => {}} onDone={() => {}} />
      </InlineForms.Provider>,
    );
    for (const label of ['Insurance company or scheme', 'TPA (optional)', 'Pre-authorisation number (optional)', 'Approved amount (₹)', 'Enter 0 to take it off.']) expect(text(html)).toContain(label);
    expect(html).toContain('value="Sample Health Insurance"');
    expect(html).toContain('value="60000"');
    expect((html.match(/btn-primary/g) ?? []).length).toBe(1);
    expect(text(html)).not.toMatch(/!/);
  });
});
