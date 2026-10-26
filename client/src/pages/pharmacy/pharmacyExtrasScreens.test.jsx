// The pharmacy extras screens – purchase orders, returns to a supplier, the barcode box, the business buyer and the
// e-invoice card. The website has no browser test setup, so each screen is rendered to HTML (react-dom/server) from
// fake answers. Made-up names and numbers only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answers = {};
let roles = ['pharmacist'];
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles }, user: { name: 'Sample Pharmacist' } }) }));

const { OrderDocument, OrderFormPage, OrderPage, OrdersPage } = await import('./OrdersPage.jsx');
const { CancelReturnForm, DebitNoteDocument, NewSupplierReturnPage, SupplierReturnPage, SupplierReturnsPage } = await import('./SupplierReturnsPage.jsx');
const { BarcodesField, MedicinesPage, NewPurchasePage, PurchasesPage, SuppliersPage } = await import('./PurchasesPage.jsx');
const { InvoicePage } = await import('./InvoicesPage.jsx');
const { BusinessBuyerFields, SellPage, ShortHsnWarning, buyerComplete } = await import('./SellPage.jsx');
const { StockPage } = await import('./StockPage.jsx');
const { PharmacySettingsPage, ReportsPage } = await import('./ReportsPage.jsx');
const { BarcodeBox, FindMedicine } = await import('./pharmacyUi.jsx');

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

const OID = 'a'.repeat(24);
const SID = 'b'.repeat(24);
const med = (id, name, extra = {}) => ({ id, name, generic: 'Sampleol', form: 'tablet', strength: '10 mg', unit: 'tablet', hsn: '3004', gstRate: 12, schedule: '', scheduleLabel: 'None', controlled: false, reorderLevel: 20, barcodes: [], active: true, inStock: 5, ...extra });
const SUPPLIER = { id: SID, name: 'Sample Distributors', gstin: '27AAPFU0939F1ZV', drugLicence: 'DL-1', phone: '020 0000 0000', address: '9 Sample Market', active: true };
const SETTINGS = { name: 'Sample Pharmacy', gstin: '27AAPFU0939F1ZV', licence20: 'MH-20-1', licence21: 'MH-21-1', rmi: '', pharmacistName: 'Sample Pharmacist', state: 'Maharashtra', place: 'Pune', pin: '411001', address: '1 Sample Road', phone: '020 1111 1111' };
const order = (extra = {}) => ({
  id: OID,
  number: 'PO-000001',
  status: 'sent',
  statusLabel: 'Sent',
  closed: null,
  supplier: SUPPLIER,
  note: 'Deliver before noon',
  date: '2026-10-04T05:00:00.000Z',
  byName: 'Sample Pharmacist',
  sent: { at: '2026-10-04T06:00:00.000Z', byName: 'Sample Pharmacist' },
  cancelled: null,
  items: 2,
  units: 120,
  lines: [
    { id: 'l1', medicineId: 'm1', name: 'Order Tab A', qty: 100, receivedQty: 60, outstanding: 40, medicine: med('m1', 'Order Tab A') },
    { id: 'l2', medicineId: 'm2', name: 'Order Tab B', qty: 20, receivedQty: 20, outstanding: 0, medicine: med('m2', 'Order Tab B', { schedule: 'narcotic', scheduleLabel: 'Narcotic (NDPS)', controlled: true }) },
  ],
  purchases: [],
  can: { edit: false, send: false, receive: true, cancel: true, close: false },
  ...extra,
});

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  roles = ['pharmacist'];
});

describe('purchase orders', () => {
  it('the list shows each order with its status as colour, icon and word', () => {
    answers['/pharmacy/orders'] = { orders: [order(), order({ id: 'c'.repeat(24), number: 'PO-000002', status: 'part_received', closed: { at: '2026-10-04T07:00:00.000Z', byName: 'Sample Pharmacist', reason: 'No more' } })] };
    const html = at('/pharmacy/orders', '/pharmacy/orders', <OrdersPage />);
    const shown = text(html);
    expect(shown).toContain('PO-000001');
    expect(shown).toContain('Sample Distributors');
    expect(shown).toContain('Part received – closed');
    expect(html).toMatch(/class="pill pill-due[^"]*"><svg/); // the Sent pill has its icon
    expect(shown).toContain('New order');
    expect(shown).toContain('Returns to supplier'); // the Purchases tab's sections
    brand(html);
  });

  it('a new order: supplier, "Suggest from low stock", and one primary button', () => {
    answers['/pharmacy/suppliers'] = { suppliers: [SUPPLIER, { ...SUPPLIER, id: 'x', name: 'Stopped Supplier', active: false }] };
    const html = at('/pharmacy/orders/new', '/pharmacy/orders/new', <OrderFormPage />);
    const shown = text(html);
    expect(shown).toContain('New purchase order');
    expect(shown).toContain('Suggest from low stock');
    expect(shown).toContain('Save the draft');
    expect(shown).toContain('Sample Distributors');
    expect(shown).not.toContain('Stopped Supplier');
    expect(shown).toContain('adds every medicine at or below its reorder level');
    brand(html);
  });

  it('a draft opens for changing with its lines; an order that was sent cannot be changed', () => {
    answers['/pharmacy/suppliers'] = { suppliers: [SUPPLIER] };
    answers[`/pharmacy/orders/${OID}`] = { order: order({ status: 'draft', sent: null, can: { edit: true, send: true, receive: false, cancel: true, close: false } }), settings: SETTINGS };
    let html = at(`/pharmacy/orders/${OID}/edit`, '/pharmacy/orders/:id/edit', <OrderFormPage />);
    expect(text(html)).toContain('Change order PO-000001');
    expect(html).toContain('value="100"');
    expect(html).toContain('value="Deliver before noon"');
    expect(html).toContain('aria-label="Quantity of Order Tab A (tablets)"');
    brand(html);
    answers[`/pharmacy/orders/${OID}`] = { order: order(), settings: SETTINGS };
    html = at(`/pharmacy/orders/${OID}/edit`, '/pharmacy/orders/:id/edit', <OrderFormPage />);
    expect(text(html)).toContain('Order PO-000001 is no longer a draft, so it cannot be changed.');
    expect(text(html)).not.toContain('Save the draft');
  });

  it('one order: what was ordered, received and is still to come; the next step is the one primary button', () => {
    answers[`/pharmacy/orders/${OID}`] = { order: order({ status: 'part_received', can: { edit: false, send: false, receive: true, cancel: false, close: true }, purchases: [{ id: 'p1', number: 'PU-000003', invoiceNo: 'S-1', invoiceDate: '2026-10-03', status: 'active' }] }), settings: SETTINGS };
    let html = at(`/pharmacy/orders/${OID}`, '/pharmacy/orders/:id', <OrderPage />);
    let shown = text(html);
    expect(shown).toContain('Order PO-000001');
    expect(shown).toContain('Part received');
    expect(shown).toContain('Receive the rest');
    expect(shown).toContain('Nothing more will come');
    expect(shown).not.toContain('Cancel the order');
    expect(shown).toContain('Purchase PU-000003 · invoice S-1');
    expect(shown).toMatch(/Order Tab A[^|]*100 60 40/);
    expect(shown).toContain('Narcotic (NDPS)');
    expect(html).toMatch(/class="btn btn-secondary"[^>]*><svg[^>]*>.*?<\/svg> Print/);
    brand(html);

    // A draft: "Mark as sent" is the primary; the admin of a sent order has no Receive (Print is then the primary)
    answers[`/pharmacy/orders/${OID}`] = { order: order({ status: 'draft', sent: null, can: { edit: true, send: true, receive: false, cancel: true, close: false } }), settings: SETTINGS };
    html = at(`/pharmacy/orders/${OID}`, '/pharmacy/orders/:id', <OrderPage />);
    shown = text(html);
    expect(shown).toContain('Mark as sent');
    expect(shown).toContain('Change');
    expect(shown).toContain('Perinexa itself sends nothing to the supplier');
    brand(html);
    roles = ['admin'];
    answers[`/pharmacy/orders/${OID}`] = { order: order({ can: { edit: false, send: false, receive: false, cancel: true, close: false } }), settings: SETTINGS };
    html = at(`/pharmacy/orders/${OID}`, '/pharmacy/orders/:id', <OrderPage />);
    expect(html).not.toMatch(/<button[^>]*>(<svg[^>]*>.*?<\/svg>)? ?Receive/); // no Receive button for the admin
    expect(html).toMatch(/class="btn btn-primary"[^>]*><svg[^>]*>.*?<\/svg> Print/);
    expect(text(html)).toContain('Cancel the order');
    brand(html);
  });

  it('"Receive" opens the New purchase form filled in from the order, with its supplier fixed', () => {
    answers['/pharmacy/suppliers'] = { suppliers: [SUPPLIER] };
    answers[`/pharmacy/orders/${OID}`] = { order: order(), settings: SETTINGS };
    const html = at(`/pharmacy/purchases/new?order=${OID}`, '/pharmacy/purchases/new', <NewPurchasePage />);
    const shown = text(html);
    expect(shown).toContain('Receive order PO-000001');
    expect(shown).toContain('Receiving against order PO-000001');
    expect(shown).toContain('Order Tab A'); // still to come: 40
    expect(html).toContain('aria-label="Quantity" inputMode="numeric" value="40"');
    expect(shown).not.toContain('Order Tab B'); // all of it has arrived
    expect(html).toMatch(/<select id="pu-sup"[^>]*disabled/);
    expect(shown).toContain('Scan or type a barcode');
    brand(html);

    // An order that can take no more: said, and the purchase is entered without it
    answers[`/pharmacy/orders/${OID}`] = { order: order({ status: 'received', can: { edit: false, send: false, receive: false, cancel: false, close: false } }), settings: SETTINGS };
    const closed = text(at(`/pharmacy/purchases/new?order=${OID}`, '/pharmacy/purchases/new', <NewPurchasePage />));
    expect(closed).toContain('Nothing can be received against order PO-000001 (received)');
    expect(closed).toContain('Add a purchase bill');
    // Without an order the form is as before
    const plain = at('/pharmacy/purchases/new', '/pharmacy/purchases/new', <NewPurchasePage />);
    expect(text(plain)).toContain('Add a purchase bill');
    expect(plain).not.toMatch(/<select id="pu-sup"[^>]*disabled/);
    // "Add bill" on a supplier's page: that supplier is chosen (and can still be changed)
    const fromSupplier = at(`/pharmacy/purchases/new?supplier=${SUPPLIER.id}`, '/pharmacy/purchases/new', <NewPurchasePage />);
    expect(fromSupplier).toMatch(new RegExp(`<option value="${SUPPLIER.id}" selected`));
    expect(fromSupplier).not.toMatch(/<select id="pu-sup"[^>]*disabled/);
  });

  it('the printout carries the pharmacy’s details, the supplier and each medicine with its quantity', () => {
    const shown = text(words(renderToStaticMarkup(<OrderDocument order={order()} settings={SETTINGS} />)));
    expect(shown).toContain('Sample Pharmacy 1 Sample Road Phone 020 1111 1111 · GSTIN 27AAPFU0939F1ZV · DL 20: MH-20-1 · DL 21: MH-21-1');
    expect(shown).toContain('Purchase order Order no. PO-000001 Date 4 Oct 2026');
    expect(shown).toContain('To Sample Distributors GSTIN 27AAPFU0939F1ZV Address 9 Sample Market Drug licence DL-1');
    expect(shown).toContain('1 Order Tab A · Sampleol 10 mg Tablet 100 tablets');
    expect(shown).toContain('Note: Deliver before noon');
    expect(shown).toContain('For Sample Pharmacy: ____________________ (Sample Pharmacist)');
    expect(shown).not.toMatch(/!/);
    // A draft or a cancelled order says so on the paper
    expect(text(renderToStaticMarkup(<OrderDocument order={order({ status: 'draft', sent: null })} settings={SETTINGS} />))).toContain('Purchase order – draft, not sent');
    expect(text(renderToStaticMarkup(<OrderDocument order={order({ status: 'cancelled' })} settings={SETTINGS} />))).toContain('Purchase order – cancelled');
  });

  it('the purchases list names the order a purchase was received against', () => {
    answers['/pharmacy/purchases'] = { purchases: [{ id: 'p1', number: 'PU-000003', supplier: 'Sample Distributors', order: { id: OID, number: 'PO-000001' }, invoiceNo: 'S-1', invoiceDate: '2026-10-03', totalPaise: 50000, status: 'active', cancelled: null, byName: 'Sample Pharmacist', lines: [] }] };
    const html = at('/pharmacy/purchases', '/pharmacy/purchases', <PurchasesPage />);
    expect(text(html)).toContain('received against order PO-000001');
    expect(html).toContain(`href="/pharmacy/orders/${OID}"`);
    brand(html);
  });
});

describe('returns to a supplier', () => {
  const RET = {
    id: 'r'.repeat(24),
    number: 'SR-000001',
    date: '2026-10-04T05:00:00.000Z',
    byName: 'Sample Pharmacist',
    supplier: SUPPLIER,
    reason: 'expired',
    reasonLabel: 'Expired',
    note: 'Collected by the van',
    witness: 'Sister Sample',
    interState: false,
    controlled: true,
    lines: [{ id: 'x1', medicineId: 'm1', name: 'Return Tab', generic: 'Sampleol', hsn: '3004', gstRate: 12, schedule: 'narcotic', batch: 'RA1', expiry: '2026-09-30', qty: 40, ratePaise: 500, taxablePaise: 20000, gstPaise: 2400, cgstPaise: 1200, sgstPaise: 1200, igstPaise: 0, amountPaise: 22400, purchaseNumber: 'PU-000001', invoiceNo: 'SUP-77', invoiceDate: '2026-09-01' }],
    totals: { qty: 40, taxablePaise: 20000, gstPaise: 2400, cgstPaise: 1200, sgstPaise: 1200, igstPaise: 0, amountPaise: 22400 },
  };

  it('the list, for the pharmacist (who returns stock) and the admin (who only sees it)', () => {
    answers['/pharmacy/supplier-returns'] = { returns: [RET], reasons: [] };
    let html = at('/pharmacy/supplier-returns', '/pharmacy/supplier-returns', <SupplierReturnsPage />);
    expect(text(html)).toContain('SR-000001');
    expect(text(html)).toContain('₹224');
    expect(text(html)).toContain('Return stock to a supplier');
    brand(html);
    roles = ['admin'];
    html = at('/pharmacy/supplier-returns', '/pharmacy/supplier-returns', <SupplierReturnsPage />);
    expect(text(html)).not.toContain('Return stock to a supplier');
  });

  it('a new return lists the supplier’s batches – expired ones marked – with the rate and GST of the purchase', () => {
    answers['/pharmacy/suppliers'] = { suppliers: [SUPPLIER] };
    answers['/pharmacy/supplier-returns/batches'] = {
      supplier: SUPPLIER,
      interState: true,
      batches: [
        { id: 'b1', medicineId: 'm1', name: 'Return Tab', generic: 'Sampleol', strength: '10 mg', unit: 'tablet', schedule: '', controlled: false, batch: 'RA1', expiry: '2026-09-30', expired: true, daysLeft: -4, qtyLeft: 60, hsn: '3004', gstRate: 12, ratePaise: 500, purchaseNumber: 'PU-000001', invoiceNo: 'SUP-77', invoiceDate: '2026-09-01' },
        { id: 'b2', medicineId: 'm2', name: 'Fresh Tab', generic: '', strength: '', unit: 'tablet', schedule: 'X', controlled: true, batch: 'RB1', expiry: '2027-12-31', expired: false, daysLeft: 400, qtyLeft: 10, hsn: '3004', gstRate: 5, ratePaise: 900, purchaseNumber: 'PU-000001', invoiceNo: 'SUP-77', invoiceDate: '2026-09-01' },
      ],
    };
    const html = at(`/pharmacy/supplier-returns/new?supplier=${SID}`, '/pharmacy/supplier-returns/new', <NewSupplierReturnPage />);
    const shown = text(html);
    expect(shown).toContain('Batches bought from this supplier');
    expect(shown).toMatch(/Return Tab · Sampleol 10 mg Invoice SUP-77 · [^R]*RA1 · Sep 2026 Expired 60 ₹5 12%/);
    expect(shown).toContain('Schedule X');
    expect(shown).toContain('Expired stock may be returned.');
    expect(shown).toContain('Show only expired batches');
    expect(shown).toContain('This supplier is in another state: the debit note shows IGST.');
    for (const reason of ['Expired', 'Damaged', 'Recalled', 'Excess stock', 'Wrong item']) expect(html).toContain(`>${reason}</option>`);
    expect(html).toContain('aria-label="Return how many of Return Tab, batch RA1"');
    brand(html);
    // Before a supplier is chosen: no batches yet
    expect(text(at('/pharmacy/supplier-returns/new', '/pharmacy/supplier-returns/new', <NewSupplierReturnPage />))).not.toContain('Batches bought from this supplier');
  });

  it('one return: its lines and sums, and the debit note to print', () => {
    answers[`/pharmacy/supplier-returns/${RET.id}`] = { return: RET, settings: SETTINGS };
    const html = at(`/pharmacy/supplier-returns/${RET.id}`, '/pharmacy/supplier-returns/:id', <SupplierReturnPage />);
    const shown = text(html);
    expect(shown).toContain('Return SR-000001');
    expect(shown).toContain('Print the debit note');
    expect(shown).toContain('Bought on invoice SUP-77');
    expect(shown).toContain('CGST + SGST ₹12 + ₹12');
    expect(shown).toContain('Total debit ₹224');
    expect(shown).toContain('Witness: Sister Sample');
    brand(html);
  });

  it('a return entered by mistake can be cancelled by the pharmacist; a cancelled one says so everywhere', () => {
    // The pharmacist's page of a return that counts: "Cancel this return" below, Print is the one primary button
    answers[`/pharmacy/supplier-returns/${RET.id}`] = { return: { ...RET, status: 'active', cancelled: null, canCancel: true }, settings: SETTINGS };
    let html = at(`/pharmacy/supplier-returns/${RET.id}`, '/pharmacy/supplier-returns/:id', <SupplierReturnPage />);
    expect(text(html)).toContain('Cancel this return');
    expect(html).toMatch(/class="btn btn-primary"[^>]*><svg[^>]*>.*?<\/svg> Print the debit note/);
    brand(html);
    // The admin only sees it
    answers[`/pharmacy/supplier-returns/${RET.id}`] = { return: { ...RET, status: 'active', cancelled: null, canCancel: false }, settings: SETTINGS };
    expect(text(at(`/pharmacy/supplier-returns/${RET.id}`, '/pharmacy/supplier-returns/:id', <SupplierReturnPage />))).not.toContain('Cancel this return');

    // The dialog: a reason, and – for a narcotic or Schedule X medicine coming back – a witness
    const form = words(renderToStaticMarkup(<CancelReturnForm ret={{ ...RET, canCancel: true }} onClose={() => {}} onDone={() => {}} />));
    expect(text(form)).toContain('For a return entered by mistake');
    expect(text(form)).toContain('Its 40 units go back on the batch they left, and the return no longer counts in the reports.');
    expect(text(form)).toContain('Why is it cancelled');
    expect(text(form)).toContain('Witness (staff who saw it put back in stock)');
    expect(form).toMatch(/<button type="button" class="btn btn-danger" disabled="">Cancel the return<\/button>/); // waits for the reason
    expect(text(form)).toContain('Keep it');
    expect(text(renderToStaticMarkup(<CancelReturnForm ret={{ ...RET, controlled: false }} onClose={() => {}} onDone={() => {}} />))).not.toContain('Witness');
    expect(text(form)).not.toMatch(/!/);

    // A cancelled return: status as colour, icon and word; who, when and why; no cancel link; the paper says cancelled
    const gone = { ...RET, status: 'cancelled', canCancel: false, cancelled: { at: '2026-10-05T05:00:00.000Z', byName: 'Sample Pharmacist', reason: 'Typed 40 for 4', witness: 'Sister Second' } };
    answers[`/pharmacy/supplier-returns/${RET.id}`] = { return: gone, settings: SETTINGS };
    html = at(`/pharmacy/supplier-returns/${RET.id}`, '/pharmacy/supplier-returns/:id', <SupplierReturnPage />);
    const shown = text(html);
    expect(html).toMatch(/class="pill pill-inactive[^"]*"><svg[^>]*>.*?<\/svg>Cancelled/);
    expect(shown).toMatch(/Cancelled by Sample Pharmacist on [^:]+:\d\d[^:]*: Typed 40 for 4\. The stock was put back on its batch \(witness: Sister Second\)\./);
    expect(shown).not.toContain('Cancel this return');
    expect(primaries(html)).toBe(0); // printing a cancelled debit note is no longer the main thing to do
    brand(html);
    const paper = text(words(renderToStaticMarkup(<DebitNoteDocument ret={gone} settings={SETTINGS} />)));
    expect(paper).toContain('Debit note – cancelled');
    expect(paper).toContain('This debit note was cancelled on 5 Oct 2026: the goods below did not go back to the supplier.');
    expect(paper).not.toContain('goods returned');
    answers['/pharmacy/supplier-returns'] = { returns: [gone], reasons: [] };
    expect(at('/pharmacy/supplier-returns', '/pharmacy/supplier-returns', <SupplierReturnsPage />)).toMatch(/SR-000001<\/span> <span class="pill pill-inactive[^"]*"><svg[^>]*>.*?<\/svg>Cancelled/);
  });

  it('the debit note shows HSN, batch, expiry, rate and GST as on the purchase, and the witness', () => {
    const shown = text(words(renderToStaticMarkup(<DebitNoteDocument ret={RET} settings={SETTINGS} />)));
    expect(shown).toContain('Debit note – goods returned Debit note no. SR-000001 Date 4 Oct 2026');
    expect(shown).toContain('To Sample Distributors GSTIN 27AAPFU0939F1ZV');
    expect(shown).toContain('Reason Expired – Collected by the van Witness Sister Sample');
    expect(shown).toContain('Return Tab (NDPS) 3004 RA1 Sep 2026 SUP-77 1 Sep 2026 40 ₹5 ₹200 12% ₹24 ₹224');
    expect(shown).toContain('Taxable value ₹200 CGST ₹12 SGST ₹12 Total debit ₹224');
    expect(shown).toContain('Received by the supplier: ____________________');
    expect(shown).not.toMatch(/!/);
    // A supplier in another state: IGST
    const far = { ...RET, interState: true, totals: { ...RET.totals, cgstPaise: 0, sgstPaise: 0, igstPaise: 2400 } };
    const farShown = text(renderToStaticMarkup(<DebitNoteDocument ret={far} settings={SETTINGS} />));
    expect(farShown).toContain('IGST ₹24');
    expect(farShown).not.toContain('CGST');
  });

  it('a supplier’s row offers "Return stock" to the pharmacist', () => {
    answers['/pharmacy/suppliers'] = { suppliers: [SUPPLIER] };
    answers['/pharmacy/settings'] = { settings: SETTINGS, canEdit: true, lists: {} };
    const html = at('/pharmacy/suppliers', '/pharmacy/suppliers', <SuppliersPage />);
    expect(html).toContain(`href="/pharmacy/supplier-returns/new?supplier=${SID}"`);
    roles = ['admin'];
    expect(at('/pharmacy/suppliers', '/pharmacy/suppliers', <SuppliersPage />)).not.toContain('supplier-returns/new');
  });

  it('Reports: purchases by supplier net of returns, and the returns export for the admin', () => {
    roles = ['admin'];
    answers['/pharmacy/reports/alerts'] = { low: [], expiring: [], days: 90 };
    answers['/pharmacy/reports/sales'] = { byDay: [], gst: [], totals: { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, amountPaise: 0 } };
    answers['/pharmacy/reports/purchases'] = { bySupplier: [{ supplier: 'Sample Distributors', invoices: 1, totalPaise: 5000000, returns: 2, returnedPaise: 1500000, netPaise: 3500000 }], totalPaise: 5000000, returnedPaise: 1500000, netPaise: 3500000 };
    answers['/pharmacy/reports/register'] = {
      type: 'H1',
      label: 'Schedule H1',
      from: '2026-10-01',
      to: '2026-10-04',
      settings: SETTINGS,
      pages: [{ medicine: med('m1', 'H1 Tab', { schedule: 'H1' }), opening: 0, closing: 15, rows: [{ date: '2026-10-04', time: '11:30', kind: 'supplier_return', ref: 'SR-000001', batch: 'H1B', in: 0, out: 5, balance: 15, patient: '', doctor: '', supplier: 'Sample Distributors', reason: 'Recalled', witness: '', byName: 'Sample Pharmacist' }] }],
    };
    const html = at('/pharmacy/reports', '/pharmacy/reports', <ReportsPage />);
    const shown = text(html);
    expect(shown).toContain('Purchases by supplier, net of returns');
    expect(shown).toContain('Sample Distributors 1 ₹50,000 −₹15,000 (2 returns) ₹35,000');
    expect(shown).toContain('Returned to supplier SR-000001');
    expect(shown).toContain('Recalled · balance 15 · Sample Pharmacist');
    expect(shown).toContain('Returns to suppliers'); // the export
    brand(html);
  });
});

describe('barcodes', () => {
  // What a scan DOES (one pack after another, a pack not found, a medicine no longer in use, one already on the list)
  // is tested on its plain functions in pharmacyExtras.test.js: scanQueue, scannedForList, scannedForPurchase.
  it('New purchase and Stock show the "Scan or type a barcode" box, and so does the "find a medicine" row that Sell and Issue to ward use', () => {
    answers['/pharmacy/stock'] = { medicines: [], totals: { costValuePaise: 0, mrpValuePaise: 0, low: 0 } };
    answers['/pharmacy/suppliers'] = { suppliers: [SUPPLIER] };
    const box = 'placeholder="Scan or type a barcode"';
    expect(at('/pharmacy/stock', '/pharmacy/stock', <StockPage />)).toContain(box);
    expect(at('/pharmacy/purchases/new', '/pharmacy/purchases/new', <NewPurchasePage />)).toContain(box);
    // On Sell and Issue to ward the medicines card appears only once it is known who it is for (a click, which a
    // screen rendered to HTML cannot make), so the box itself is NOT seen on those two pages here. Their medicines
    // card uses this same row (FindMedicine), rendered on its own:
    const find = at('/pharmacy', '/pharmacy', <FindMedicine onPick={() => {}} onScan={() => {}} />);
    expect(find).toContain(box);
    expect(find).toContain('placeholder="Add a medicine: brand or generic name"');
    const stock = at('/pharmacy/stock', '/pharmacy/stock', <StockPage />);
    expect(text(stock)).toContain('Only the exact barcode is found.');
    brand(stock);
    for (const kind of ['sale', 'issue']) {
      const page = at('/pharmacy', '/pharmacy', <SellPage kind={kind} />);
      expect(text(page)).toContain(kind === 'sale' ? 'Who is it for' : 'Admitted patient');
      expect(page).not.toContain(box); // nobody chosen yet: no medicines card
      brand(page);
    }
  });

  it('the Find button never waits for a lookup: the next pack can be scanned at once', () => {
    const html = words(renderToStaticMarkup(<BarcodeBox onPick={() => {}} />));
    expect(html).toContain('placeholder="Scan or type a barcode"');
    expect(html).toMatch(/<button type="button" class="btn btn-secondary" disabled="">Find<\/button>/); // only because the box is empty
    expect(text(html)).toContain('Click in the box and scan the pack, or type the number under the bars and press Enter.');
  });

  it('a medicine’s barcodes are typed or scanned in its dialog, each with its own Remove button', () => {
    const html = words(renderToStaticMarkup(<BarcodesField barcodes={['8901234567890', 'ABC-123']} onChange={() => {}} typed="" setTyped={() => {}} />));
    expect(text(html)).toContain('Barcodes on the pack (optional)');
    expect(text(html)).toContain('A barcode belongs to one medicine only.');
    expect(html).toContain('aria-label="Remove barcode 8901234567890"');
    expect(html).toContain('aria-label="Remove barcode ABC-123"');
    expect(text(renderToStaticMarkup(<BarcodesField barcodes={[]} onChange={() => {}} typed="" setTyped={() => {}} error="Barcode 123456 is already on Other Tab." />))).toContain('Barcode 123456 is already on Other Tab.');
  });

  it('the medicines list names the medicines whose details are all empty, for the pharmacist or admin to check', () => {
    answers['/pharmacy/medicines'] = { medicines: [med('m1', 'Full Tab'), med('m2', 'Emptied Tab', { generic: '', strength: '', hsn: '', schedule: '', reorderLevel: 0 })] };
    answers['/pharmacy/settings'] = { settings: SETTINGS, canEdit: true, lists: {} };
    let html = at('/pharmacy/medicines', '/pharmacy/medicines', <MedicinesPage />);
    expect(text(html)).toContain('Please check this medicine: Emptied Tab. Its generic name, strength, HSN code, schedule and reorder level are all empty.');
    expect(text(html)).toContain('If one is a prescription medicine (Schedule H, H1 or X) or a narcotic, choose Change and set its schedule');
    brand(html);
    // Nothing to check: no notice. Someone who cannot change medicines is not asked to.
    answers['/pharmacy/medicines'] = { medicines: [med('m1', 'Full Tab')] };
    expect(text(at('/pharmacy/medicines', '/pharmacy/medicines', <MedicinesPage />))).not.toContain('Please check');
    answers['/pharmacy/medicines'] = { medicines: [med('m2', 'Emptied Tab', { generic: '', strength: '', hsn: '', schedule: '', reorderLevel: 0 })] };
    answers['/pharmacy/settings'] = { settings: SETTINGS, canEdit: false, lists: {} };
    html = at('/pharmacy/medicines', '/pharmacy/medicines', <MedicinesPage />);
    expect(text(html)).not.toContain('Please check');
  });

  it('the medicines list shows a medicine’s barcodes', () => {
    answers['/pharmacy/medicines'] = { medicines: [med('m1', 'Scan Tab', { barcodes: ['8901234567890'] }), med('m2', 'Two Packs Tab', { barcodes: ['8900000000017', '8900000000024'] }), med('m3', 'Plain Tab')] };
    answers['/pharmacy/settings'] = { settings: SETTINGS, canEdit: true, lists: {} };
    const shown = text(at('/pharmacy/medicines', '/pharmacy/medicines', <MedicinesPage />));
    expect(shown).toContain('Barcode 8901234567890');
    expect(shown).toContain('2 barcodes');
  });
});

describe('a sale to a business, and its e-invoice file', () => {
  const invoice = (extra = {}) => ({
    id: 'i'.repeat(24),
    number: 'PH-000007',
    kind: 'sale',
    date: '2026-10-04T05:00:00.000Z',
    patient: null,
    customer: { name: 'Sample Buyer', phone: '' },
    buyer: { name: 'Sample Clinic LLP', gstin: '29AAICA3918J1ZE', address: '2 Sample Lane', place: 'Bengaluru', pin: '560001', state: 'Karnataka', stateCode: '29' },
    doctor: null,
    fromPrescription: false,
    rxSeen: false,
    discountPercent: 0,
    discountReason: '',
    billId: null,
    lines: [{ id: 'l1', medicineId: 'm1', name: 'Rate Twelve', generic: '', hsn: '3004', gstRate: 12, schedule: '', batch: 'B12', expiry: '2027-12-31', qty: 10, returnedQty: 4, canReturn: true, mrpPaise: 11200, amountPaise: 112000, taxablePaise: 100000, cgstPaise: 6000, sgstPaise: 6000 }],
    returns: [{ number: 'CN-000001', at: '2026-10-04T06:00:00.000Z', byName: 'Sample Pharmacist', reason: 'Not needed', amountPaise: 44800, lines: [{ lineId: 'l1', qty: 4, amountPaise: 44800 }] }],
    payments: [{ kind: 'payment', mode: 'upi', amountPaise: 112000, reference: 'U1', at: '2026-10-04T05:00:00.000Z', byName: 'Sample Pharmacist' }],
    grossPaise: 112000,
    totalPaise: 112000,
    returnedPaise: 44800,
    netPaise: 67200,
    taxablePaise: 60000,
    cgstPaise: 3600,
    sgstPaise: 3600,
    paidPaise: 112000,
    balancePaise: -44800,
    byName: 'Sample Pharmacist',
    ...extra,
  });
  const path = `/pharmacy/invoices/${'i'.repeat(24)}`;

  it('the admin sees the buyer, the three plain statements and the download buttons', () => {
    roles = ['admin'];
    answers[path] = { invoice: invoice(), settings: SETTINGS, stay: null, einvoice: { canDownload: true, problems: [], sellerStateCode: '27' } };
    const html = at(path, '/pharmacy/invoices/:id', <InvoicePage />);
    const shown = text(html);
    expect(shown).toContain('Sample Clinic LLP (business)');
    expect(shown).toContain('Sample Clinic LLP · GSTIN 29AAICA3918J1ZE · 2 Sample Lane, Bengaluru 560001, Karnataka (29)');
    expect(shown).toContain('Sales to patients need no e-invoice.');
    expect(shown).toContain('Perinexa does not connect to the e-invoice portal.');
    expect(shown).toContain('Your accountant must check the file before it is uploaded');
    expect(shown).toContain('This buyer is registered in another state.');
    expect(shown).toContain('Download the e-invoice file');
    expect(shown).toContain('File for credit note CN-000001');
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>(<svg[^>]*>.*?<\/svg>)? ?Download the e-invoice file/);
    brand(html);
  });

  it('what is missing is listed and the download waits; the pharmacist is told the admin downloads it', () => {
    roles = ['admin'];
    answers[path] = { invoice: invoice({ returns: [], returnedPaise: 0 }), settings: SETTINGS, stay: null, einvoice: { canDownload: true, problems: ['The pharmacy’s PIN code is missing (Pharmacy → Settings).'], sellerStateCode: null } };
    let html = at(path, '/pharmacy/invoices/:id', <InvoicePage />);
    expect(text(html)).toContain('The file cannot be made yet: The pharmacy’s PIN code is missing (Pharmacy → Settings).');
    expect(html).toMatch(/<button type="button" class="btn btn-secondary" disabled="">/);
    roles = ['pharmacist'];
    answers[path] = { invoice: invoice(), settings: SETTINGS, stay: null, einvoice: { canDownload: false, problems: [], sellerStateCode: '27' } };
    html = at(path, '/pharmacy/invoices/:id', <InvoicePage />);
    expect(text(html)).toContain('The hospital admin downloads the e-invoice file from this page.');
    expect(text(html)).not.toContain('Download the e-invoice file');
    brand(html);
  });

  it('an ordinary invoice – a patient’s or a walk-in’s – has no e-invoice card at all', () => {
    roles = ['admin'];
    answers[path] = { invoice: invoice({ buyer: null }), settings: SETTINGS, stay: null };
    const shown = text(at(path, '/pharmacy/invoices/:id', <InvoicePage />));
    expect(shown).toContain('Sample Buyer (walk-in)');
    expect(shown).not.toContain('e-invoice');
  });

  it('the Sell screen’s business buyer: a tick box, then name, GSTIN (its state read from it), address, town and PIN', () => {
    const empty = { name: '', gstin: '', address: '', place: '', pin: '' };
    const off = text(words(renderToStaticMarkup(<BusinessBuyerFields business={false} setBusiness={() => {}} buyer={empty} setBuyer={() => {}} />)));
    expect(off).toContain('The buyer is a business that gives its GSTIN');
    expect(off).toContain('Never for a patient: sales to patients need no GSTIN and no e-invoice.');
    expect(off).not.toContain('Business name');
    const good = { name: 'Sample Clinic LLP', gstin: '27AAPFU0939F1ZV', address: '2 Sample Lane', place: 'Nashik', pin: '422001' };
    const on = text(words(renderToStaticMarkup(<BusinessBuyerFields business setBusiness={() => {}} buyer={good} setBuyer={() => {}} />)));
    for (const label of ['Business name (as on its GST certificate)', 'GSTIN', 'Address', 'City or town', 'PIN code']) expect(on).toContain(label);
    expect(on).toContain('State: Maharashtra (27) – read from the GSTIN.');
    const typo = text(words(renderToStaticMarkup(<BusinessBuyerFields business setBusiness={() => {}} buyer={{ ...good, gstin: '27AAPFU0939F1ZX' }} setBuyer={() => {}} />)));
    expect(typo).toContain('This GSTIN has a typing mistake');
    expect(text(words(renderToStaticMarkup(<BusinessBuyerFields business setBusiness={() => {}} buyer={good} setBuyer={() => {}} errors={{ 'buyer.pin': 'A PIN code has 6 digits.' }} />)))).toContain('A PIN code has 6 digits.');
    expect(buyerComplete(good)).toBe(true);
    expect([{ ...good, gstin: '27AAPFU0939F1ZX' }, { ...good, pin: '4220' }, { ...good, name: 'Sa' }, { ...good, place: '' }, empty].map(buyerComplete)).toEqual([false, false, false, false, false]);
  });

  it('a sale to a business warns before the invoice is made when a medicine’s HSN code is too short for the e-invoice portal', () => {
    const warn = (medicines) => text(words(renderToStaticMarkup(<ShortHsnWarning medicines={medicines} />)));
    expect(warn([med('m1', 'Long Code Tab', { hsn: '300490' }), med('m2', 'Eight Code Tab', { hsn: '30049099' })])).toBe('');
    const one = warn([med('m1', 'Short Code Tab'), med('m2', 'Long Code Tab', { hsn: '300490' })]); // 3004: as a new medicine starts
    expect(one).toContain('The e-invoice portal takes an HSN code of 6 or 8 digits. Short Code Tab has a shorter code or none.');
    expect(one).toContain('The invoice can be made now and the code changed afterwards.');
    expect(one).not.toContain('Long Code Tab');
    expect(warn([med('m1', 'Short Code Tab'), med('m3', 'No Code Tab', { hsn: '' }), med('m1', 'Short Code Tab')])).toContain('Short Code Tab, No Code Tab have a shorter code or none.');
    // The hint under the example GSTIN shows one that passes the check
    const empty = { name: '', gstin: '', address: '', place: '', pin: '' };
    expect(text(renderToStaticMarkup(<BusinessBuyerFields business setBusiness={() => {}} buyer={empty} setBuyer={() => {}} />))).toContain('for example 27ABCDE1234F1Z0');
  });

  it('Settings ask for the city and PIN code, and warn about a GSTIN that does not look right', () => {
    answers['/pharmacy/settings'] = { settings: { ...SETTINGS, gstin: '27AAPFU0939F1ZX' }, canEdit: true, lists: {} };
    const html = at('/pharmacy/settings', '/pharmacy/settings', <PharmacySettingsPage />);
    const shown = text(html);
    expect(shown).toContain('City or town');
    expect(shown).toContain('PIN code');
    expect(shown).toContain('Please check: This GSTIN has a typing mistake');
    expect(shown).toContain('needed only for the e-invoice file of a sale to a business');
    brand(html);
  });
});
