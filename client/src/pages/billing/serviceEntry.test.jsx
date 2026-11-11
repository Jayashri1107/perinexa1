// Adding and taking off services as on the hospital's old billing screen, and the printed bill under its headings
// (11 Nov 2026). Rendered to HTML from fake answers – made-up names and numbers only.
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
const { HeadedBillLines, ServiceEntryRow, canChangeRate } = await import('./ServiceEntry.jsx');
const { billHeadOf, linesByHead } = await import('./billHeads.js');

const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => words(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const BID = 'b'.repeat(24);
const line = (id, name, group, ratePaise, qty = 1, extra = {}) => ({ id, name, group, ratePaise, qty, amountPaise: ratePaise * qty, source: 'manual', priceNotSet: false, addedByName: 'Sample Billing', addedAt: '2026-11-09T06:00:00.000Z', removed: null, doctorName: '', key: null, ...extra });
// A stay's bill like the old IP final bill: registration, room and nursing, surgeon, visits, anaesthesia, OT, medicines
const STAY_LINES = [
  line('l1', 'Registration fee (new patient)', 'consultation', 30000, 1, { key: 'registration', doctorName: 'Dr Sample Doctor' }),
  line('l2', 'Room charge per day – Deluxe AC (Deluxe AC)', 'inpatient', 200000, 4, { key: null }),
  line('l3', 'Nursing charge per day', 'inpatient', 50000, 4, { key: 'nursing' }),
  line('l4', 'Surgeon fee', 'inpatient', 4000000),
  line('l5', 'Doctor visit (ward round)', 'inpatient', 100000, 4, { key: 'ipd_round' }),
  line('l6', 'Anaesthesia charges', 'inpatient', 1000000),
  line('l7', 'Operation theatre charges', 'inpatient', 1200000),
  line('l8', 'Paracetamol 500 mg tablet', 'medicine', 2000, 10),
];

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  roles = ['receptionist'];
});

describe('the headings of the printed bill', () => {
  it('puts each service under the old bill’s headings, in its order, with their totals', () => {
    expect(STAY_LINES.map(billHeadOf)).toEqual(['registration', 'hospital', 'hospital', 'doctor', 'doctor', 'doctor', 'ot', 'pharmacy']);
    expect(linesByHead(STAY_LINES).map((h) => [h.label, h.amountPaise])).toEqual([
      ['Registration', 30000],
      ['Hospital charges', 1000000],
      ['Doctor charges', 5400000],
      ['OT charges', 1200000],
      ['Pharmacy charges', 20000],
    ]);
  });

  it('prints each heading with its total and the class, and each service as price × qty', () => {
    const html = text(renderToStaticMarkup(<HeadedBillLines lines={STAY_LINES} classLabel="Deluxe AC" />));
    expect(html).toContain('Hospital charges Deluxe AC ₹10,000');
    expect(html).toContain('Nursing charge per day ₹500 × 4 ₹2,000');
    expect(html).toContain('Registration fee (new patient) Dr Sample Doctor ₹300 × 1 ₹300');
    expect(html.indexOf('Registration')).toBeLessThan(html.indexOf('Hospital charges'));
    expect(html.indexOf('Doctor charges')).toBeLessThan(html.indexOf('OT charges'));
  });
});

describe('the one-line service entry', () => {
  it('has Service name, Rate, Qty, Doctor name, Total amount and Add – a secondary button, Add waits for a service', () => {
    answers['/billing/prices'] = { items: [{ id: 'i1', name: 'Surgeon fee', group: 'inpatient', pricePaise: 4000000, active: true }], groups: [{ key: 'inpatient', label: 'Inpatient' }] };
    answers['/tenant/doctors'] = { doctors: [{ id: 'd1', name: 'Dr Sample Doctor' }] };
    const html = words(renderToStaticMarkup(<ServiceEntryRow bill={{ id: BID, doctorName: 'Dr Sample Doctor' }} roles={roles} onDone={() => {}} />));
    for (const label of ['Service name', 'Rate (₹)', 'Qty', 'Doctor name', 'Total amount', 'Add']) expect(text(html)).toContain(label);
    expect(text(html)).not.toContain('Add several'); // one way to add services (11 Nov 2026)
    expect(html).toContain('role="combobox"'); // Service name: a box to type in, the matches drop down under it
    expect(html).toMatch(/<option value="d1" selected="">Dr Sample Doctor<\/option>/); // the bill's own doctor first
    expect(html).not.toContain('btn-primary');
    expect(html).toMatch(/<button type="button" class="btn btn-secondary" disabled="">/);
  });

  it('lets only the billing department and the hospital admin type another listed rate', () => {
    expect(canChangeRate(['receptionist'])).toBe(false);
    expect(canChangeRate(['billing'])).toBe(true);
    expect(canChangeRate(['receptionist', 'admin'])).toBe(true);
  });
});

describe('the OPD bill page', () => {
  const opdBill = (extra = {}) => ({
    id: BID, number: 'B-000021', kind: 'opd', date: '2026-11-11', patient: { id: 'p'.repeat(24), fullName: 'Sample Mother', mrn: 'P-000009' }, stay: null, final: null,
    subtotal: 80000, discount: 0, total: 80000, paid: 0, balance: 80000, status: 'unpaid', items: 2, discountInfo: null, cancelled: null, insurance: null, payments: [],
    lines: [line('l1', 'Consultation – new patient', 'consultation', 50000, 1, { key: 'consult_new', source: 'auto' }), line('l2', 'Dressing', 'procedure', 30000)],
    ...extra,
  });
  const page = () => words(renderToStaticMarkup(<MemoryRouter initialEntries={[`/billing/bills/${BID}`]}><Routes><Route path="/billing/bills/:id" element={<BillPage />} /></Routes></MemoryRouter>));

  it('shows the entry row and a tick box on each item; one primary button', () => {
    answers[`/billing/bills/${BID}`] = { bill: opdBill() };
    const html = page();
    expect(text(html)).toContain('Service name');
    expect(html).toContain('aria-label="Tick all items"');
    expect(html).toContain('aria-label="Tick Dressing"');
    expect((html.match(/class="btn btn-primary"/g) ?? []).length).toBe(1);
    expect(text(html)).not.toMatch(/!/);
  });

  it('a cancelled bill, or a stay’s final bill, has neither the entry row nor tick boxes', () => {
    answers[`/billing/bills/${BID}`] = { bill: opdBill({ status: 'cancelled', cancelled: { byName: 'Sample Reception', at: '2026-11-11T06:00:00.000Z', reason: 'Wrong patient' } }) };
    expect(page()).not.toContain('Tick all items');
    answers[`/billing/bills/${BID}`] = { bill: opdBill({ kind: 'ipd', final: { byName: 'Sample Billing', at: '2026-11-11T06:00:00.000Z' }, stay: { id: 's'.repeat(24), ward: 'Deluxe AC', bed: '204', admittedAt: '2026-11-08T06:00:00.000Z', dischargedAt: '2026-11-11T05:00:00.000Z', inHospital: false } }) };
    const html = page();
    expect(html).not.toContain('Tick all items');
    expect(text(html)).not.toContain('Service name');
  });
});
