// Pharmacy extras (purchase orders, returns to a supplier, barcodes, the business buyer's GSTIN): the pure helpers
// behind the screens. Made-up names and numbers only.
import { describe, expect, it, vi } from 'vitest';
import { cleanGstin, gstinCheckChar, gstinProblem, gstinState, isGstin } from './gstin.js';
import {
  BUYING_PATHS,
  MOVE_LABELS,
  SUPPLIER_RETURN_REASONS,
  buyingSections,
  cleanBarcode,
  debitSums,
  einvoiceHsnOk,
  isBarcode,
  linesFromSuggestions,
  medicinesToCheck,
  momentDay,
  orderLook,
  pharmacyTabs,
  receiveLines,
  prescribedLines,
  receivedFlash,
  returnBatchesShown,
  returnChosen,
  scanQueue,
  scannedForList,
  scannedForPurchase,
  suggestionNote,
  suggestionSummary,
  unitsLabel,
} from './pharmacyFormat.js';

const gstin = (first14) => `${first14}${gstinCheckChar(first14)}`;

describe('GSTIN (the same rules as the server)', () => {
  it('accepts a well-formed GSTIN however it is typed, and reads its state', () => {
    expect(isGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(cleanGstin(' 27aapfu 0939f1zv ')).toBe('27AAPFU0939F1ZV');
    expect(gstinState('27aapfu0939f1zv')).toEqual({ code: '27', name: 'Maharashtra' });
    expect(gstinState(gstin('07BBBBB1111B1Z'))).toEqual({ code: '07', name: 'Delhi' });
    expect(gstinState('not one')).toBeNull();
  });
  it('says what is wrong in plain words', () => {
    expect(gstinProblem('')).toBe('Enter the GSTIN.');
    expect(gstinProblem('27AAPFU0939F1Z')).toBe('A GSTIN has 15 characters.');
    expect(gstinProblem('27AAPFU0939F1ZX')).toMatch(/typing mistake/);
    expect(gstinProblem('2XAAPFU0939F1ZV')).toMatch(/does not look like a GSTIN/);
    expect(gstinProblem(gstin('98AAPFU0939F1Z'))).toMatch(/not a state/);
    expect(gstinProblem('27AAPFU0939F1ZV')).toBeNull();
  });
  it('the example it shows passes its own check', () => {
    const example = gstinProblem('2XAAPFU0939F1ZV').match(/for example (\w{15})/)[1];
    expect(example).toBe('27ABCDE1234F1Z0');
    expect(gstinProblem(example)).toBeNull();
  });
});

describe('barcodes', () => {
  it('are kept without spaces, in capitals; 4 to 32 digits or letters', () => {
    expect(cleanBarcode(' 8901 2345 67890 ')).toBe('8901234567890');
    expect(cleanBarcode('abc-123')).toBe('ABC-123');
    expect(cleanBarcode(undefined)).toBe('');
    expect(['8901234567890', 'abc-123', '1234', ' 12 34 '].map(isBarcode)).toEqual([true, true, true, true]);
    expect(['', '123', '-1234', '12$34', '1'.repeat(33)].map(isBarcode)).toEqual([false, false, false, false, false]);
  });
});

describe('scanning packs one after another', () => {
  // A lookup that answers only when the test lets it, like a slow connection
  function slowLookups() {
    const asked = [];
    const lookup = vi.fn((code) => new Promise((resolve, reject) => asked.push({ code, resolve, reject })));
    return { asked, lookup };
  }
  const tab = (name, extra = {}) => ({ id: name, name, generic: '', strength: '', active: true, ...extra });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('a pack scanned while the last one is still being looked up waits its turn: it is not dropped and not joined to the next', async () => {
    const { asked, lookup } = slowLookups();
    const picked = [];
    const said = [];
    const busy = [];
    const scans = scanQueue({ lookup, onPick: (m) => { picked.push(m.name); return `${m.name} added.`; }, onSaid: (x) => said.push(x), onBusy: (b) => busy.push(b) });

    scans.add('8900000000017'); // pack 1: its lookup starts
    scans.add('8900000000024'); // pack 2, scanned before pack 1 was found
    const done = scans.add('8900000000031'); // pack 3
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(scans.waiting()).toBe(2);
    expect(busy).toEqual([true]);

    asked[0].resolve(tab('Pack One'));
    await settle();
    expect(lookup.mock.calls.map(([code]) => code)).toEqual(['8900000000017', '8900000000024']); // each code on its own
    asked[1].resolve(tab('Pack Two'));
    await settle();
    asked[2].resolve(tab('Pack Three'));
    await done;
    expect(lookup.mock.calls.map(([code]) => code)).toEqual(['8900000000017', '8900000000024', '8900000000031']);
    expect(picked).toEqual(['Pack One', 'Pack Two', 'Pack Three']);
    expect(said.at(-1)).toEqual({ ok: true, text: 'Pack Three added.' });
    expect(busy).toEqual([true, false]);
    expect(scans.waiting()).toBe(0);

    // The box works again afterwards (a new run of scans)
    const again = scans.add('8900000000048');
    asked[3].resolve(tab('Pack Four'));
    await again;
    expect(picked).toEqual(['Pack One', 'Pack Two', 'Pack Three', 'Pack Four']);
    expect(busy).toEqual([true, false, true, false]);
  });

  it('a scan that found nothing stays on the screen when the next pack is added', async () => {
    const { asked, lookup } = slowLookups();
    const said = [];
    const scans = scanQueue({ lookup, onPick: (m) => (m.active ? `${m.name} added.` : { error: `${m.name} is no longer in use.` }), onSaid: (x) => said.push(x) });
    scans.add('1111');
    scans.add('2222');
    const done = scans.add('3333');
    asked[0].reject(new Error('No medicine has the barcode 1111.'));
    await settle();
    expect(said.at(-1)).toEqual({ ok: false, text: 'No medicine has the barcode 1111.' });
    asked[1].resolve(tab('Pack Two'));
    await settle();
    expect(said.at(-1)).toEqual({ ok: false, text: 'No medicine has the barcode 1111. After that: Pack Two added.' });
    asked[2].resolve(tab('Old Pack', { active: false }));
    await done;
    expect(said.at(-1)).toEqual({ ok: false, text: 'No medicine has the barcode 1111. Old Pack is no longer in use.' });
    // A medicine the page gives no sentence for is named as found
    const plain = [];
    const one = scanQueue({ lookup: async () => tab('Found Tab', { generic: 'Sampleol', strength: '10 mg' }), onPick: () => undefined, onSaid: (x) => plain.push(x) });
    await one.add('4444');
    expect(plain).toEqual([{ ok: true, text: 'Found Tab · Sampleol 10 mg found.' }]);
  });

  it('a scanned medicine goes on the list – unless it is no longer in use, or already there', () => {
    const m = tab('Scan Tab', { generic: 'Sampleol', strength: '10 mg' });
    expect(scannedForList(m, false)).toEqual({ add: true, said: 'Scan Tab · Sampleol 10 mg added.' });
    expect(scannedForList(m, true)).toEqual({ add: false, said: 'Scan Tab is already on the list: change its quantity there.' });
    expect(scannedForList({ ...m, active: false }, false)).toEqual({ add: false, said: { error: 'Scan Tab is no longer in use (Medicines → Use again).' } });
    // A purchase may hold a medicine twice (one line for each batch)
    expect(scannedForPurchase(m)).toEqual({ add: true, said: 'Scan Tab · Sampleol 10 mg added: fill in its batch, expiry, quantity and prices.' });
    expect(scannedForPurchase({ ...m, active: false })).toEqual({ add: false, said: { error: 'Scan Tab is no longer in use (Medicines → Use again).' } });
  });
});

describe('medicines to check after the old "Stop using" fault', () => {
  it('lists the medicines whose generic name, strength, HSN code, schedule and reorder level are all empty', () => {
    const full = { name: 'Full Tab', generic: 'Sampleol', strength: '10 mg', hsn: '3004', schedule: 'H', reorderLevel: 20 };
    const emptied = { name: 'Emptied Tab', generic: '', strength: '', hsn: '', schedule: '', reorderLevel: 0 };
    expect(medicinesToCheck([full, emptied, { ...emptied, name: 'Has HSN', hsn: '3004' }, { ...emptied, name: 'Has Level', reorderLevel: 5 }, { ...emptied, name: 'Has Schedule', schedule: 'narcotic' }]).map((m) => m.name)).toEqual(['Emptied Tab']);
    expect(medicinesToCheck(undefined)).toEqual([]);
  });
});

describe('the e-invoice file and HSN codes', () => {
  it('takes 6 or 8 digits (the same rule as the server)', () => {
    expect(['300490', '30049099', ' 300490 '].map(einvoiceHsnOk)).toEqual([true, true, true]);
    expect(['3004', '', '30049', undefined, 'ABCDEF'].map(einvoiceHsnOk)).toEqual([false, false, false, false, false]);
  });
});

describe('purchase orders', () => {
  it('after a purchase against an order: the order’s new status, or that the order could not count it', () => {
    const purchase = { number: 'PU-000004' };
    expect(receivedFlash({ purchase, order: { number: 'PO-000001', status: 'part_received', closed: false, counted: true } })).toEqual({ text: 'Purchase PU-000004 saved and added to stock. Order PO-000001 is now: part received.', warning: false });
    expect(receivedFlash({ purchase, order: { number: 'PO-000001', status: 'received', closed: false, counted: true } }).text).toMatch(/is now: received\.$/);
    const cancelled = receivedFlash({ purchase, order: { number: 'PO-000001', status: 'cancelled', closed: false, counted: false, notCounted: 'cancelled' } });
    expect(cancelled).toEqual({ text: 'Purchase PU-000004 saved and added to stock. Order PO-000001 was cancelled at the same moment, so this purchase is not counted against it: it is in the Purchases list without an order.', warning: true });
    expect(receivedFlash({ purchase, order: { number: 'PO-000002', status: 'part_received', closed: true, counted: false, notCounted: 'closed' } }).text).toMatch(/Order PO-000002 was closed at the same moment/);
    expect(receivedFlash({ purchase, order: { number: 'PO-000003', status: 'sent', closed: false, counted: false, notCounted: 'busy' } }).text).toMatch(/was being changed by someone else/);
  });

  it('each status has its colour, icon and word; a closed part-received order says so', () => {
    expect(orderLook({ status: 'draft' })).toMatchObject({ tone: 'neutral', label: 'Draft' });
    expect(orderLook({ status: 'sent' })).toMatchObject({ tone: 'due', label: 'Sent' });
    expect(orderLook({ status: 'part_received' })).toMatchObject({ tone: 'watch', label: 'Part received' });
    expect(orderLook({ status: 'part_received', closed: { reason: 'No more' } })).toMatchObject({ tone: 'inactive', label: 'Part received – closed' });
    expect(orderLook({ status: 'received' })).toMatchObject({ tone: 'stable', label: 'Received' });
    expect(orderLook({ status: 'cancelled' })).toMatchObject({ tone: 'inactive', label: 'Cancelled' });
    for (const status of ['draft', 'sent', 'part_received', 'received']) expect(orderLook({ status }).icon).toBeTruthy();
  });

  it('"Suggest from low stock" adds what is not on the order yet and has something to order', () => {
    const s = (id, suggestedQty, extra = {}) => ({ medicine: { id, name: `Tab ${id}` }, inStock: 2, reorderLevel: 10, onOrder: 0, onOrders: [], suggestedQty, lastSupplier: null, ...extra });
    const suggestions = [s('a', 18), s('b', 5), s('c', 0, { onOrder: 30, onOrders: ['PO-000002'] })];
    const out = linesFromSuggestions(suggestions, [{ medicine: { id: 'b' }, qty: '40' }]);
    expect(out.add.map((x) => [x.medicine.id, x.qty])).toEqual([['a', 18]]);
    expect(out).toMatchObject({ onList: 1, onOrder: 1 });
    expect(suggestionSummary(out, suggestions.length)).toBe('1 medicine added · 1 already on this order · 1 left out: enough is already on an order that was sent.');
    expect(suggestionSummary(linesFromSuggestions([], []), 0)).toBe('Nothing is at or below its reorder level.');
    expect(suggestionSummary(linesFromSuggestions([s('a', 1), s('b', 2)], []), 2)).toBe('2 medicines added.');
    expect(suggestionNote(s('c', 0, { onOrder: 30, onOrders: ['PO-000002'], lastSupplier: { id: 's', name: 'Sample Distributors' } }))).toBe('2 in stock · reorder at 10 · 30 on order (PO-000002) · last bought from Sample Distributors');
    expect(suggestionNote(s('a', 18))).toBe('2 in stock · reorder at 10');
  });

  it('"Receive" fills the purchase with what is still to come (never a medicine no longer in use)', () => {
    const order = {
      lines: [
        { medicineId: 'a', name: 'Tab A', qty: 100, outstanding: 40, medicine: { id: 'a', name: 'Tab A', active: true } },
        { medicineId: 'b', name: 'Tab B', qty: 20, outstanding: 0, medicine: { id: 'b', name: 'Tab B', active: true } },
        { medicineId: 'c', name: 'Tab C', qty: 5, outstanding: 5, medicine: { id: 'c', name: 'Tab C', active: false } },
      ],
    };
    expect(receiveLines(order)).toEqual([{ medicine: { id: 'a', name: 'Tab A', active: true }, qty: 40 }]);
  });
});

describe('returns to a supplier', () => {
  it('"Show only expired batches" never hides a batch with a quantity typed: what is sent is what is on the screen', () => {
    const batches = [
      { id: 'old', name: 'Old Tab', expired: true, qtyLeft: 60 },
      { id: 'fresh', name: 'Fresh Tab', expired: false, qtyLeft: 30 },
      { id: 'other', name: 'Other Tab', expired: false, qtyLeft: 10 },
    ];
    // 20 typed beside the batch that has not expired, then the box is ticked and the expired batch filled in
    const typed = { fresh: '20', old: ' 60 ', other: '  ' };
    expect(returnBatchesShown(batches, typed, false).map((b) => b.id)).toEqual(['old', 'fresh', 'other']);
    expect(returnBatchesShown(batches, typed, true).map((b) => b.id)).toEqual(['old', 'fresh']); // "fresh" stays in sight
    expect(returnBatchesShown(batches, {}, true).map((b) => b.id)).toEqual(['old']);
    const chosen = returnChosen(batches, typed);
    expect(chosen.map((x) => [x.b.id, x.qty])).toEqual([['old', 60], ['fresh', 20]]);
    // Every chosen batch is among those shown, whatever the tick box says
    for (const onlyExpired of [false, true]) {
      const shown = new Set(returnBatchesShown(batches, typed, onlyExpired).map((b) => b.id));
      expect(chosen.every((x) => shown.has(x.b.id))).toBe(true);
    }
    // A quantity that cannot be right is kept (and shown) with no number: the button waits
    expect(returnChosen(batches, { old: '61', fresh: '0', other: 'ten' }).map((x) => [x.b.id, x.qty])).toEqual([['old', null], ['fresh', null], ['other', null]]);
    expect(returnChosen(batches, { old: '1.5' })[0].qty).toBeNull();
  });

  it('the debit note’s sums: purchase value, GST on top, total', () => {
    expect(debitSums([{ qty: 40, ratePaise: 500, gstRate: 12 }, { qty: 10, ratePaise: 900, gstRate: 5 }])).toEqual({ taxablePaise: 29000, gstPaise: 2850, amountPaise: 31850 });
    expect(debitSums([])).toEqual({ taxablePaise: 0, gstPaise: 0, amountPaise: 0 });
  });
  it('has its words: the reasons, and the stock move', () => {
    expect(Object.keys(SUPPLIER_RETURN_REASONS)).toEqual(['expired', 'damaged', 'recalled', 'excess', 'wrong_item']);
    expect(MOVE_LABELS.supplier_return).toBe('Returned to supplier');
    expect(MOVE_LABELS.supplier_return_cancelled).toBe('Return to supplier cancelled');
    expect([unitsLabel(1, 'tablet'), unitsLabel(12, 'bottle')]).toEqual(['1 tablet', '12 bottles']);
    // The day something was done is this computer's day, not the UTC one (01:30 at night in India is still "today")
    const late = new Date(2026, 9, 5, 1, 30);
    expect(momentDay(late.toISOString())).toBe('5 Oct 2026');
    expect(momentDay('not a date')).toBe('—');
  });
});

describe('the pharmacy’s tabs', () => {
  it('purchases, orders and returns to a supplier share the Purchases tab and its sections', () => {
    const tab = pharmacyTabs(['pharmacist']).find((t) => t.label === 'Purchases');
    expect(tab.activeFor).toEqual(BUYING_PATHS);
    expect(buyingSections().map((x) => [x.label, x.to])).toEqual([
      ['Purchase bills', '/pharmacy/purchases'],
      ['Orders', '/pharmacy/orders'],
      ['Returns to supplier', '/pharmacy/supplier-returns'],
    ]);
    expect(pharmacyTabs(['admin']).map((t) => t.label)).toEqual(['Invoices', 'Stock', 'Purchases', 'Medicines', 'Suppliers', 'Reports', 'Settings']);
    expect(pharmacyTabs(['pharmacist']).map((t) => t.label).slice(0, 2)).toEqual(['Sell', 'Issue to ward']);
  });
});

describe("a doctor's prescription on the bill", () => {
  const med = (id, name, inStock) => ({ id, name, inStock });
  const rx = (visitId, items) => ({ visitId, items });
  const item = (matches, suggestedQty) => ({ matches, suggestedQty });
  const own = { key: "own-1", medicine: med("m3", "Own Syrup", 9), qty: "1", batchId: null };
  it("puts each prescribed medicine on with its quantity, one in stock first, marked prescribed", () => {
    const out = prescribedLines([own], rx("v1", [item([med("m1", "Out Tab", 0), med("m2", "In Tab", 5)], 6), item([], 10)]));
    expect(out.map((l) => [l.medicine.name, l.qty, Boolean(l.prescribed)])).toEqual([
      ["Own Syrup", "1", false], // the pharmacist's own: stays, and can be taken off
      ["In Tab", "6", true], // not on the stock list: left out
    ]);
  });
  it("marks a medicine already on the bill as prescribed instead of adding it twice", () => {
    const out = prescribedLines([own], rx("v1", [item([med("m3", "Own Syrup", 9)], 2)]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "own-1", qty: "1", prescribed: true });
  });
  it("replaces the medicines of a prescription chosen before", () => {
    const first = prescribedLines([own], rx("v1", [item([med("m1", "First Tab", 5)], 3)]));
    const second = prescribedLines(first, rx("v2", [item([med("m2", "Second Tab", 5)], 4)]));
    expect(second.map((l) => l.medicine.name)).toEqual(["Own Syrup", "Second Tab"]);
  });
});
