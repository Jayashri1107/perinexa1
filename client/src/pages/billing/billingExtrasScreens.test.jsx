// The billing extras screens – the insurance card and dialog on a bill, the UPI payment link, the claim form and the
// PM-JAY claim sheet, and Billing → Settings. The website has no browser test setup, so each screen is rendered to
// HTML (react-dom/server) from fake answers. Made-up names and numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answers = {};
let roles = ['receptionist'];
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles }, user: { name: 'Sample Reception' } }) }));

const { BillPage } = await import('./BillPage.jsx');
const { claimNumberHint } = await import('./billingFormat.js');
const { BillingSettingsPage, ClaimDocument, InsuranceForm, InsuranceSection, UpiHistory, UpiLinkForm, UpiLinkResult, upiNotRecorded } = await import('./BillingExtras.jsx');
const { UnpaidPage } = await import('./BillingReports.jsx');

const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const at = (path, route, node) =>
  words(
    renderToStaticMarkup(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={node} />
        </Routes>
      </MemoryRouter>,
    ),
  );
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const primaries = (html) => (html.match(/class="btn btn-primary"/g) ?? []).length;
// Brand rules every screen keeps: one primary button at most, no exclamation marks
const brand = (html) => {
  expect(primaries(html)).toBeLessThanOrEqual(1);
  expect(text(html)).not.toMatch(/!/);
};

const BID = 'a'.repeat(24);
const INSURANCE = { insurer: 'Sample Health Insurance', policyNumber: 'POL-778899', tpa: 'Sample TPA Services', preAuthNumber: 'PA-2026-0042', claimNumber: 'CLM-9001', pmjayId: '', packageCode: '', packageName: '', byName: 'Sample Reception', at: '2026-10-05T06:00:00.000Z' };
const bill = (extra = {}) => ({
  id: BID,
  number: 'B-000007',
  kind: 'opd',
  date: '2026-10-05',
  patient: { id: 'p'.repeat(24), fullName: 'Sample Mother', mrn: 'P-000004', phone: '+91 00000 11111' },
  stay: null,
  subtotal: 115000,
  discount: 0,
  total: 115000,
  paid: 0,
  balance: 115000,
  status: 'unpaid',
  items: 2,
  priceNotSet: false,
  discountInfo: null,
  cancelled: null,
  insurer: '',
  insurance: null,
  lines: [
    { id: 'l1', name: 'Consultation – new patient', group: 'consultation', qty: 1, ratePaise: 50000, amountPaise: 50000, source: 'auto', from: 'visit', priceNotSet: false, addedByName: '', addedAt: '2026-10-05T06:00:00.000Z', removed: null },
    { id: 'l2', name: 'Lab test (confidential)', group: 'lab', qty: 1, ratePaise: 65000, amountPaise: 65000, source: 'auto', from: 'lab', priceNotSet: false, addedByName: '', addedAt: '2026-10-05T06:00:00.000Z', removed: null },
  ],
  payments: [],
  ...extra,
});
const form = (extra = {}) => ({
  hospital: { name: 'Sample Maternity Home', tagline: '', address: '12 Sample Street, Pune', phone: '020 0000 0000', email: '', registrationNumber: 'MH/SAMPLE/2026/001' },
  patient: { fullName: 'Sample Mother', mrn: 'P-000004', phone: '+91 00000 11111', age: 29, bornOn: null, address: '4 Sample Lane', baby: false },
  doctor: { name: 'Dr Sample Doctor', qualification: 'MBBS, MS (OBGY)', registrationNumber: 'MMC-12345', council: 'Sample Medical Council' },
  dates: { kind: 'visit', on: '2026-10-05' },
  bill: { number: 'B-000007', kind: 'opd', date: '2026-10-05' },
  groups: [
    { group: 'consultation', label: 'Consultation', items: 1, amountPaise: 50000 },
    { group: 'lab', label: 'Lab test', items: 2, amountPaise: 65000 },
  ],
  sums: { subtotal: 115000, discount: 5000, total: 110000, paid: 70000, paidByInsurance: 60000, balance: 40000 },
  insurance: INSURANCE,
  ...extra,
});
const doc = (f, layout) => words(renderToStaticMarkup(<ClaimDocument form={f} layout={layout} printedAt="2026-10-05T06:00:00.000Z" printedBy="Sample Reception" />));
const blanks = (html) => (html.match(/class="pdoc-line"/g) ?? []).length;

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  roles = ['receptionist'];
});

describe('a bill with the billing extras', () => {
  it('offers the UPI payment link beside Take payment, the insurance card, and the two claim printouts', () => {
    answers[`/billing/bills/${BID}`] = { bill: bill(), upiReady: true, earlierInsurance: null };
    const html = at(`/billing/bills/${BID}`, '/billing/bills/:id', <BillPage />);
    const shown = text(html);
    expect(shown).toContain('UPI payment link');
    expect(shown).toContain('Take payment');
    expect(shown).toContain('Insurance or scheme');
    expect(shown).toContain('None recorded. Add them when an insurer or a scheme such as PM-JAY pays for this bill.');
    expect(shown).toContain('Add details');
    expect(shown).toContain('Perinexa is not connected to any insurer or to the PM-JAY portal. The claim is made outside Perinexa.');
    brand(html); // Take payment stays the one primary button
  });

  it('a paid bill offers no UPI link; a cancelled bill takes no insurance details', () => {
    answers[`/billing/bills/${BID}`] = { bill: bill({ paid: 115000, balance: 0, status: 'paid' }), upiReady: true, earlierInsurance: null };
    expect(text(at(`/billing/bills/${BID}`, '/billing/bills/:id', <BillPage />))).not.toContain('UPI payment link');
    answers[`/billing/bills/${BID}`] = { bill: bill({ status: 'cancelled', cancelled: { reason: 'Wrong patient', byName: 'Sample Reception', at: '2026-10-05T06:00:00.000Z' } }), upiReady: true, earlierInsurance: null };
    const cancelled = text(at(`/billing/bills/${BID}`, '/billing/bills/:id', <BillPage />));
    expect(cancelled).not.toContain('UPI payment link');
    expect(cancelled).not.toContain('Add details');
  });

  it('the insurance card lists what is recorded and who changed it last', () => {
    const html = words(renderToStaticMarkup(<InsuranceSection bill={bill({ insurer: INSURANCE.insurer, insurance: INSURANCE })} open onEdit={() => {}} />));
    const shown = text(html);
    for (const part of ['Insurance company or scheme', 'Sample Health Insurance', 'Policy or member number', 'POL-778899', 'TPA', 'Sample TPA Services', 'Pre-authorisation number', 'PA-2026-0042', 'Claim number', 'CLM-9001']) expect(shown).toContain(part);
    expect(shown).not.toContain('PM-JAY ID'); // not recorded: not listed
    expect(shown).toContain('Change the details');
    expect(shown).toContain('Last changed by Sample Reception');
    expect(shown).toContain('The claim form and the PM-JAY claim sheet are under Print.');
    brand(html);
  });

  it('the insurance dialog has every field, the PM-JAY part, and offers what an earlier bill has', () => {
    const earlier = { number: 'B-000003', insurer: 'Sample Health Insurance', policyNumber: 'POL-778899', tpa: '', pmjayId: '' };
    const html = words(renderToStaticMarkup(<InsuranceForm bill={bill()} earlier={earlier} onClose={() => {}} onDone={() => {}} />));
    const shown = text(html);
    for (const label of ['Insurance company or scheme', 'Policy or member number', 'TPA (if any)', 'Pre-authorisation number', 'Claim number', 'For the PM-JAY claim sheet', 'PM-JAY ID', 'Package code', 'Package name']) expect(shown).toContain(label);
    expect(shown).toContain('Her bill B-000003 has: Sample Health Insurance · POL-778899');
    expect(shown).toContain('Use these details');
    expect(shown).toContain('Write no diagnosis here');
    expect(shown).toContain('Perinexa is not connected to any insurer or to the PM-JAY portal.');
    expect(html).not.toMatch(/id="bill-ins-(diagnosis|procedure)"/); // no clinical field
    brand(html);
    // A bill that has its own details is not offered another bill's
    expect(text(words(renderToStaticMarkup(<InsuranceForm bill={bill({ insurance: INSURANCE })} earlier={earlier} onClose={() => {}} onDone={() => {}} />)))).not.toContain('Use these details');
  });
});

describe('a payment by insurance', () => {
  it('says what happens to the claim number typed with it', () => {
    // No details yet, or the bill's own insurer pays and it has no claim number: the number is kept on the bill too
    expect(claimNumberHint(null, 'Sample Health Insurance')).toMatch(/also kept as this bill’s claim number, and printed on the claim form/);
    expect(claimNumberHint({ insurer: 'Sample Health Insurance', claimNumber: '' }, ' Sample Health Insurance ')).toMatch(/also kept as this bill’s claim number/);
    expect(claimNumberHint(null, '')).toMatch(/A pre-authorisation number goes in the insurance details instead/);
    // Another payer than the bill's insurer: on the payment only
    expect(claimNumberHint({ insurer: 'Sample Health Insurance', claimNumber: '' }, 'Sample State Scheme')).toMatch(/Kept on this payment only, because the payer is not the insurer/);
    // The bill already has its claim number: it is filled in from there and never overwritten
    expect(claimNumberHint(INSURANCE, 'Sample Health Insurance')).toMatch(/From this bill’s insurance details\. Another number typed here stays on this payment only/);
  });
});

describe('the UPI payment link', () => {
  const inRouter = (node) => words(renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>));

  it('says that it records nothing and that the payment is recorded with Take payment', () => {
    const html = inRouter(<UpiLinkForm bill={bill()} upiReady onClose={() => {}} />);
    const shown = text(html);
    expect(shown).toContain('This only makes a link to copy. It records nothing on the bill.');
    expect(shown).toContain('record it with Take payment (paid by UPI)');
    expect(shown).toContain('The balance is ₹1,150. For a part payment, enter less.');
    expect(shown).toContain('the amount and the bill number B-000007. Nothing about the patient is in it.');
    expect(html).toContain('value="1150"');
    expect(shown).toContain('Make the link');
    expect(shown).not.toContain('Sample Mother');
    brand(html);
  });

  it('names the button the bill really has: "Take a deposit" while she is in hospital', () => {
    const inHospital = bill({ kind: 'ipd', stay: { ward: 'General ward', bed: '4', admittedAt: '2026-10-04T06:00:00.000Z', dischargedAt: null, inHospital: true } });
    answers[`/billing/bills/${BID}`] = { bill: inHospital, upiReady: true, earlierInsurance: null };
    const page = text(at(`/billing/bills/${BID}`, '/billing/bills/:id', <BillPage />));
    expect(page).toContain('Take a deposit');
    expect(page).not.toContain('Take payment');
    const shown = text(inRouter(<UpiLinkForm bill={inHospital} upiReady onClose={() => {}} />));
    expect(shown).toContain('record it with Take a deposit (paid by UPI)');
    expect(shown).not.toContain('Take payment');
    // After discharge the same bill takes a payment again
    expect(upiNotRecorded({ ...inHospital, stay: { ...inHospital.stay, inHospital: false } })).toContain('record it with Take payment (paid by UPI)');
  });

  it('above the usual limit of UPI apps it says the amount may have to be paid in parts', () => {
    const shown = text(inRouter(<UpiLinkForm bill={bill({ balance: 25_000_000 })} upiReady onClose={() => {}} />));
    expect(shown).toContain('Many UPI apps take at most ₹1,00,000 in one payment.');
  });

  it('without the hospital’s UPI ID it says who sets it', () => {
    const desk = text(inRouter(<UpiLinkForm bill={bill()} upiReady={false} onClose={() => {}} />));
    expect(desk).toContain('The hospital’s UPI ID is not set yet, so no link can be made.');
    expect(desk).toContain('Ask the hospital admin to enter it under Billing → Settings.');
    expect(desk).not.toContain('Make the link');
    roles = ['admin'];
    const admin = inRouter(<UpiLinkForm bill={bill()} upiReady={false} onClose={() => {}} />);
    expect(admin).toContain('href="/billing/settings"');
  });

  it('shows who is paid, the message and the link to copy – sent by hand, never by Perinexa', () => {
    const link = 'upi://pay?pa=samplehospital@okbank&pn=Sample%20Maternity&am=1150.00&cu=INR&tn=B-000007';
    const made = { link, message: `Sample Maternity: bill B-000007. Amount to pay: ₹1,150.\nTo pay by UPI, open this link on your phone:\n${link}`, amountPaise: 115000, upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity', number: 'B-000007' };
    const html = words(renderToStaticMarkup(<UpiLinkResult made={made} copied={{ what: 'message', ok: true }} onCopy={() => {}} onClose={() => {}} />));
    const shown = text(html);
    expect(shown).toContain('Asks for ₹1,150 for bill B-000007, paid to Sample Maternity ( samplehospital@okbank ).');
    expect(shown).toContain('Check that this is the hospital’s UPI ID before you send it.');
    expect(shown).toContain('Copy it and send it to the patient yourself, for example by SMS or WhatsApp. Perinexa does not send it.');
    expect(html).toContain(`value="${link}"`);
    expect(shown).toContain('The message was copied.');
    expect(shown).toContain('Copy the message');
    expect(shown).toContain('Copy the link only');
    brand(html);
    expect(text(words(renderToStaticMarkup(<UpiLinkResult made={made} copied={{ what: 'link', ok: false }} onCopy={() => {}} onClose={() => {}} />)))).toContain('Could not copy. Select the text and copy it by hand.');
  });
});

describe('the claim form', () => {
  it('prints the letterhead and registration number, identity, dates, the doctor, the bill by group and the insurance details', () => {
    const html = doc(form(), 'claim');
    const shown = text(html);
    for (const part of [
      'Sample Maternity Home',
      'Reg. No. MH/SAMPLE/2026/001',
      'Claim form',
      'It is not the insurer’s own form, and Perinexa is not connected to any insurer.',
      'Hospital registration no. MH/SAMPLE/2026/001',
      'Bill no. B-000007',
      'Bill date 5 Oct 2026',
      'Name Sample Mother',
      'Patient no. P-000004',
      'Age 29 years',
      'Address 4 Sample Lane',
      'Date of visit 5 Oct 2026',
      'Treating doctor Dr Sample Doctor, MBBS, MS (OBGY)',
      'Doctor’s registration no. MMC-12345 (Sample Medical Council)',
      'Insurance company or scheme Sample Health Insurance',
      'Policy or member number POL-778899',
      'TPA Sample TPA Services',
      'Pre-authorisation number PA-2026-0042',
      'Claim number CLM-9001',
      'Consultation 1 item ₹500',
      'Lab test 2 items ₹650',
      'Subtotal ₹1,150',
      'Discount −₹50',
      'Total ₹1,100',
      'Paid ₹700',
      'Of this, paid by insurance or a scheme ₹600',
      'Due ₹400',
      'Sample Mother · P-000004 · bill B-000007',
      'by Sample Reception',
    ]) {
      expect(shown, part).toContain(part);
    }
    expect(text(html)).not.toMatch(/!/);
  });

  it('leaves "Diagnosis and procedure" empty, clearly marked for the treating doctor', () => {
    const html = doc(form(), 'claim');
    const box = html.slice(html.indexOf('claim-doctor'), html.indexOf('pdoc-sigs'));
    const shown = text(box);
    expect(shown).toContain('Diagnosis and procedure – to be filled in and signed by the treating doctor');
    expect(shown).toContain('Left empty on purpose: the billing desk has no clinical details.');
    for (const label of ['Diagnosis', 'Procedure or treatment', 'Doctor’s signature', 'Date', 'Name and registration no.']) expect(shown).toContain(label);
    // Only labels and empty lines: seven lines to write on, and no value from the record
    expect((box.match(/class="pdoc-sig-fill"/g) ?? []).length).toBe(7);
    expect(box).not.toContain('<dd>');
    // No item or test name anywhere on the form – the bill is shown by group
    expect(text(html)).not.toMatch(/confidential|Consultation – new patient/);
  });

  it('prints an empty line for what is not recorded or not for this reader', () => {
    expect(blanks(doc(form(), 'claim'))).toBe(0);
    const admin = form({ patient: { fullName: 'Sample Mother', mrn: 'P-000004', phone: '', age: null, bornOn: null, address: null, baby: false }, doctor: null, insurance: null, hospital: { name: 'Sample Maternity Home', tagline: '', address: '', phone: '', email: '', registrationNumber: '' } });
    // hospital registration, age, phone, address, doctor, doctor's registration, and the five insurance details
    expect(blanks(doc(admin, 'claim'))).toBe(11);
    const baby = doc(form({ patient: { fullName: 'Baby of Sample Mother', mrn: 'P-000009', phone: '', age: null, bornOn: '2026-10-04', address: '4 Sample Lane', baby: true } }), 'claim');
    expect(text(baby)).toContain('Date of birth 4 Oct 2026');
    expect(text(baby)).not.toContain('Age');
    // A reader who may not see whether she is a baby (the hospital admin) gets one neutral line – the same for a
    // mother and for a baby, so the form tells the admin nothing
    const unknown = (name) => doc(form({ patient: { fullName: name, mrn: 'P-000004', phone: '', age: null, bornOn: null, address: null, baby: null }, doctor: null }), 'claim');
    expect(text(unknown('Sample Mother'))).toContain('Age or date of birth');
    expect(text(unknown('Sample Mother'))).not.toMatch(/ Age (?!or)| Date of birth/);
    expect(unknown('Sample Mother').replaceAll('Sample Mother', 'X')).toBe(unknown('Baby of Sample Mother').replaceAll('Baby of Sample Mother', 'X'));
  });

  it('a stay shows the dates of admission and discharge', () => {
    const stay = text(doc(form({ dates: { kind: 'stay', admittedAt: '2026-10-01T06:00:00.000Z', dischargedAt: null }, bill: { number: 'B-000007', kind: 'ipd', date: '2026-10-01' } }), 'claim'));
    expect(stay).toContain('Stay in hospital');
    expect(stay).toMatch(/Admitted 1 Oct 2026, \d\d:\d\d/);
    expect(stay).toContain('Discharged Still in hospital');
  });
});

describe('the PM-JAY claim sheet', () => {
  it('has the PM-JAY ID, the package and the pre-authorisation number, and says it is copied into the portal by hand', () => {
    const html = doc(form({ insurance: { ...INSURANCE, insurer: 'PM-JAY', pmjayId: 'PMJ-000-111', packageCode: 'SG-01', packageName: 'Sample package' } }), 'pmjay');
    const shown = text(html);
    for (const part of [
      'PM-JAY claim sheet',
      'For copying into the PM-JAY portal by hand. Perinexa is not connected to the PM-JAY portal.',
      'PM-JAY details',
      'PM-JAY ID PMJ-000-111',
      'Pre-authorisation number PA-2026-0042',
      'Package code SG-01',
      'Package name Sample package',
      'Scheme PM-JAY',
      'Diagnosis and procedure – to be filled in and signed by the treating doctor',
    ]) {
      expect(shown, part).toContain(part);
    }
    expect(shown).not.toContain('Policy or member number');
    expect(blanks(html)).toBe(0);
    // Nothing typed yet: the six PM-JAY lines are empty, to fill in by hand
    expect(blanks(doc(form({ insurance: null }), 'pmjay'))).toBe(6);
  });
});

describe('Billing → Settings', () => {
  it('the hospital admin enters the UPI ID and payee name, with the warnings', () => {
    roles = ['admin'];
    answers['/billing/settings'] = { settings: { upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity', updatedByName: 'Sample Admin', updatedAt: '2026-10-05T06:00:00.000Z', upiReady: true }, canEdit: true };
    const html = at('/billing/settings', '/billing/settings', <BillingSettingsPage />);
    const shown = text(html);
    for (const part of [
      'Billing settings',
      'UPI payment link',
      'Hospital’s UPI ID',
      'Payee name',
      'Money paid with the link goes to this UPI ID. Check every letter.',
      'Perinexa is not connected to a bank or a payment service. It never knows whether a link was paid',
      'reception records each payment with Take payment (or Take a deposit, for a patient in hospital) when the money has arrived',
      'Last changed by Sample Admin',
      'Settings',
    ]) {
      expect(shown, part).toContain(part);
    }
    expect(html).toContain('value="samplehospital@okbank"');
    expect(shown).not.toContain('Type the UPI ID again'); // asked only once the UPI ID is changed
    expect(shown).not.toContain('Changes to the UPI ID'); // nothing changed yet: no empty list
    brand(html);
  });

  it('the hospital admin sees every change of the UPI ID: what it was set to, by whom and when', () => {
    roles = ['admin'];
    const history = [
      { upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity', byName: 'Sample Admin', at: '2026-10-05T08:00:00.000Z' },
      { upiId: 'someoneelse@okbank', payeeName: 'Sample Maternity', byName: 'Second Admin', at: '2026-10-05T07:00:00.000Z' },
      { upiId: '', payeeName: '', byName: '', at: null },
    ];
    answers['/billing/settings'] = { settings: { upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity', updatedByName: 'Sample Admin', updatedAt: '2026-10-05T08:00:00.000Z', upiReady: true }, canEdit: true, history };
    const html = at('/billing/settings', '/billing/settings', <BillingSettingsPage />);
    const shown = text(html);
    expect(shown).toContain('Changes to the UPI ID');
    expect(shown).toMatch(/5 Oct 2026, \d\d:\d\d Sample Admin samplehospital@okbank Sample Maternity/);
    expect(shown).toMatch(/5 Oct 2026, \d\d:\d\d Second Admin someoneelse@okbank Sample Maternity/);
    expect(shown).toContain('Not recorded Not recorded None – links switched off');
    expect(shown).toContain('so you can see which UPI ID the links of any day pointed to');
    brand(html);
    // Reception never gets the list (the server sends it to the admin only; the page shows none without it)
    roles = ['receptionist'];
    answers['/billing/settings'] = { settings: { upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity', updatedByName: '', updatedAt: null, upiReady: true }, canEdit: false };
    expect(text(at('/billing/settings', '/billing/settings', <BillingSettingsPage />))).not.toContain('Changes to the UPI ID');
    expect(renderToStaticMarkup(<UpiHistory history={[]} />)).toBe('');
  });

  it('reception can read them but not change them', () => {
    answers['/billing/settings'] = { settings: { upiId: 'samplehospital@okbank', payeeName: 'Sample Maternity', updatedByName: '', updatedAt: null, upiReady: true }, canEdit: false };
    const html = at('/billing/settings', '/billing/settings', <BillingSettingsPage />);
    expect(text(html)).toContain('Only the hospital admin can change these settings.');
    expect(primaries(html)).toBe(0);
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });
});

describe('unpaid bills', () => {
  it('name the insurer or scheme a claim is with', () => {
    answers['/billing/reports/unpaid'] = { bills: [{ ...bill({ insurer: 'Sample Health Insurance' }), days: 3 }], owed: 115000, dueBack: 0 };
    const shown = text(at('/billing/unpaid', '/billing/unpaid', <UnpaidPage />));
    expect(shown).toContain('Insurance or scheme');
    expect(shown).toContain('Sample Health Insurance');
  });
});
