// Pharmacy Stage D (docs/PHARMACY_BUILD_NOTE.md section 6): the hospital side. PH14 kits and consumables.
// All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { User } from '../src/models/User.js';
import { PASSWORD, addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-11T06:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', pharm: 'pharmacist', admin: 'admin' };
let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Pharmacy D Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await User.updateOne({ _id: people.drA._id }, { $set: { 'professional.registrationNumber': 'MMC-12345' } });
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const ph = async (method, path, body, who = 'pharm') => (await as(who))[method](`/api/pharmacy${path}`).send(body);
const kits = async (method, path, body, who = 'drA') => (await as(who))[method](`/api/pharmacy-kits${path}`).send(body);
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const medicine = async (fields) => ok(await ph('post', '/medicines', { form: 'tablet', unit: 'tablet', gstRate: 5, ...fields }), 201).medicine;
async function stock(m, qty) {
  const sup = ok(await ph('post', '/suppliers', { name: `Sample Supplier ${randomUUID().slice(0, 4)}` }), 201).supplier;
  ok(await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: `INV-${randomUUID().slice(0, 6)}`, invoiceDate: '2026-11-10', lines: [{ medicineId: m.id, batch: `B-${randomUUID().slice(0, 4)}`, expiry: '2028-06', qty, ratePaise: 700, mrpPaise: 1000 }] }), 201);
}
async function admitted(name) {
  const p = ok(await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: name, assignedDoctor: people.drA._id.toString() })), 201).patient;
  ok(await (await as('drA')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'anc', ward: 'Labour room', reason: 'In labour' }), 201);
  return p;
}

describe('PH14 – kits and consumables', () => {
  it('a consumable has no schedule, is never in the doctor’s "in stock" answer, and keeps its GST', async () => {
    const gloves = await medicine({ name: 'Sample Gloves 7', generic: 'Surgical gloves', form: 'other', unit: 'pair', kind: 'consumable', gstRate: 18 });
    expect(gloves).toMatchObject({ kind: 'consumable', schedule: '', gstRate: 18 });
    expect((await ph('post', '/medicines', { name: 'Sample Bad Item', form: 'other', unit: 'piece', gstRate: 5, kind: 'consumable', schedule: 'H' })).status).toBe(400);
    expect((await ph('patch', `/medicines/${gloves.id}`, { schedule: 'H1' })).status).toBe(400);
    await stock(gloves, 50);
    const para = await medicine({ name: 'Sample Para 500', generic: 'Paracetamol', strength: '500 mg' });
    await stock(para, 50);
    const check = ok(await (await as('drA')).post('/api/pharmacy-stock/check').send({ medicines: [{ drug: 'Surgical gloves' }, { drug: 'Paracetamol', strength: '500 mg', form: 'tab' }] }));
    expect(check.stock[0]).toBeNull();
    expect(check.stock[1]).not.toBeNull();
  });

  it('a doctor or the admin makes a kit; the pharmacist reads it with what is short; an issue keeps the kit’s name', async () => {
    const oxy = await medicine({ name: 'Sample Oxytocin 5 IU', form: 'injection', unit: 'ampoule' });
    const pad = await medicine({ name: 'Sample Maternity Pad', form: 'other', unit: 'piece', kind: 'consumable' });
    await stock(oxy, 1);
    await stock(pad, 20);
    // Not the pharmacist, not the nurse, not reception
    for (const who of ['pharm', 'nurse']) expect((await kits('post', '', { name: 'X kit', lines: [{ medicineId: oxy.id, qty: 1 }] }, who)).status, who).toBe(403);
    expect((await kits('get', '', undefined, 'reception')).status).toBe(403);
    expect((await kits('post', '', { name: 'Twice kit', lines: [{ medicineId: oxy.id, qty: 1 }, { medicineId: oxy.id, qty: 2 }] })).status).toBe(400);
    const kit = ok(await kits('post', '', { name: 'Sample delivery kit', lines: [{ medicineId: oxy.id, qty: 2 }, { medicineId: pad.id, qty: 4 }] }), 201).kit;
    ok(await kits('put', `/${kit.id}`, { name: 'Sample delivery kit', note: 'For a normal delivery', lines: [{ medicineId: oxy.id, qty: 2 }, { medicineId: pad.id, qty: 5 }] }, 'admin'));
    // The doctor sees no stock figure; the pharmacist sees what is short
    expect(ok(await kits('get', '')).kits[0].lines[0].inStock).toBeUndefined();
    const read = ok(await kits('get', '?active=1', undefined, 'pharm'));
    expect(read.canEdit).toBe(false);
    expect(read.kits[0].lines.map((l) => [l.medicine.name, l.qty, l.inStock])).toEqual([
      ['Sample Oxytocin 5 IU', 2, 1],
      ['Sample Maternity Pad', 5, 20],
    ]);
    // The pharmacist issues what there is, with the kit's name kept
    const p = await admitted('Sample Kit Mother');
    const inv = ok(await ph('post', '/invoices', { kind: 'issue', patientId: p.id, kitId: kit.id, lines: [{ medicineId: oxy.id, qty: 1 }, { medicineId: pad.id, qty: 5 }] }), 201).invoice;
    expect(inv.kitName).toBe('Sample delivery kit');
    expect((await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Sample Walk In' }, kitId: kit.id, lines: [{ medicineId: pad.id, qty: 1 }], payment: { mode: 'cash' } })).status).toBe(400);
    // A stopped medicine cannot go into a kit; a stopped kit is left out of the counter's list
    ok(await ph('patch', `/medicines/${oxy.id}`, { active: false }));
    expect((await kits('put', `/${kit.id}`, { name: 'Sample delivery kit', lines: [{ medicineId: oxy.id, qty: 2 }] })).status).toBe(400);
    ok(await kits('put', `/${kit.id}`, { name: 'Sample delivery kit', active: false, lines: [{ medicineId: oxy.id, qty: 2 }, { medicineId: pad.id, qty: 5 }] }));
    expect(ok(await kits('get', '?active=1', undefined, 'pharm')).kits).toEqual([]);
    expect(await AuditLog.countDocuments({ action: 'PHARMACY_KIT_CHANGED' })).toBe(3);
  });

  it('a consumable never appears in a register', async () => {
    const swab = await medicine({ name: 'Sample Swab', form: 'other', unit: 'piece', kind: 'consumable' });
    await stock(swab, 10);
    for (const type of ['H1', 'X', 'narcotic']) {
      const res = ok(await ph('get', `/reports/register?type=${type}&from=2026-11-01&to=2026-11-30`));
      expect(JSON.stringify(res)).not.toContain('Sample Swab');
    }
  });

  it('kits of one hospital are never seen in another', async () => {
    const m = await medicine({ name: 'Sample Own Tab' });
    ok(await kits('post', '', { name: 'Sample own kit', lines: [{ medicineId: m.id, qty: 1 }] }), 201);
    const other = await createTenant('Pharmacy D Other');
    const theirDoc = await createUser({ name: 'Sample their doctor' });
    await addMember(theirDoc, other, 'doctor');
    const theirs = await loginAs(theirDoc, { app });
    expect(ok(await theirs.get('/api/pharmacy-kits')).kits).toEqual([]);
    expect((await theirs.post('/api/pharmacy-kits').send({ name: 'Stolen', lines: [{ medicineId: m.id, qty: 1 }] })).status).toBe(400);
  });
});

describe('PH12 – the ward asks on screen', () => {
  const wr = async (p, method, path, body, who = 'nurse') => (await as(who))[method](`/api/patients/${p.id}/ward-requests${path}`).send(body);

  it('a nurse asks for an admitted patient naming the doctor; the stock list shows words only; the pharmacist issues part, the rest stays open', async () => {
    const oxy = await medicine({ name: 'Sample Oxytocin 5 IU', form: 'injection', unit: 'ampoule', schedule: 'H', reorderLevel: 2 });
    const pad = await medicine({ name: 'Sample Maternity Pad', form: 'other', unit: 'piece', kind: 'consumable', reorderLevel: 5 });
    await stock(oxy, 10);
    await stock(pad, 3);
    const notIn = ok(await (await as('reception')).post('/api/patients').send(samplePatient({ fullName: 'Sample Home Mother', assignedDoctor: people.drA._id.toString() })), 201).patient;
    expect((await wr(notIn, 'post', '', { lines: [{ medicineId: oxy.id, qty: 1 }], orderedById: String(people.drA._id) })).status).toBe(409);
    const p = await admitted('Sample Ward Mother');
    const found = ok(await wr(p, 'get', '/medicines?q=Sample'));
    expect(found.medicines.map((m) => [m.name, m.stock])).toEqual([
      ['Sample Maternity Pad', 'low'],
      ['Sample Oxytocin 5 IU', 'in'],
    ]);
    expect(JSON.stringify(found)).not.toMatch(/Paise|qtyLeft|"qty"/);
    // A nurse must name the doctor who ordered; the receptionist and the pharmacist cannot ask
    expect((await wr(p, 'post', '', { lines: [{ medicineId: oxy.id, qty: 2 }] })).status).toBe(400);
    for (const who of ['reception', 'pharm']) expect((await wr(p, 'post', '', { lines: [{ medicineId: oxy.id, qty: 2 }], orderedById: String(people.drA._id) }, who)).status, who).toBe(403);
    const asked = ok(await wr(p, 'post', '', { lines: [{ medicineId: oxy.id, qty: 2 }, { medicineId: pad.id, qty: 5 }], urgent: true, orderedById: String(people.drA._id) }), 201).request;
    expect(asked).toMatchObject({ number: 'WR-000001', status: 'requested', urgent: true, orderedBy: { name: people.drA.name, reg: 'MMC-12345' } });
    // The pharmacist's list: urgent and open first, with ward and bed
    const list = ok(await ph('get', '/ward-requests?open=1')).requests;
    expect(list.map((r) => [r.number, r.patient.fullName])).toEqual([['WR-000001', 'Sample Ward Mother']]);
    // Issue the oxytocin (Schedule H – the request's doctor is the prescriber) and 3 pads; 2 pads stay open
    const inv = ok(await ph('post', '/invoices', { kind: 'issue', patientId: p.id, wardRequestId: asked.id, lines: [{ medicineId: oxy.id, qty: 2 }, { medicineId: pad.id, qty: 3 }] }), 201).invoice;
    expect(inv.doctor).toMatchObject({ name: people.drA.name, reg: 'MMC-12345' });
    let mine = ok(await wr(p, 'get', '')).requests[0];
    expect(mine.status).toBe('part_issued');
    expect(mine.lines.map((l) => [l.name, l.qty, l.issuedQty])).toEqual([
      ['Sample Oxytocin 5 IU', 2, 2],
      ['Sample Maternity Pad', 5, 3],
    ]);
    // The rest is refused with a reason the ward sees; the request is then closed
    expect((await ph('post', `/ward-requests/${asked.id}/refuse`, { medicineId: oxy.id, reason: 'Already given' })).status).toBe(409);
    ok(await ph('post', `/ward-requests/${asked.id}/refuse`, { medicineId: pad.id, reason: 'Out of stock – the ward store has some' }));
    mine = ok(await wr(p, 'get', '')).requests[0];
    expect(mine.status).toBe('issued');
    expect(mine.lines[1].refused).toMatchObject({ reason: 'Out of stock – the ward store has some' });
    expect((await ph('post', '/invoices', { kind: 'issue', patientId: p.id, wardRequestId: asked.id, lines: [{ medicineId: pad.id, qty: 1 }] })).status).toBe(409);
    expect((await wr(p, 'post', `/${asked.id}/cancel`, { reason: 'Not needed' })).status).toBe(409);
    expect(await AuditLog.countDocuments({ action: { $in: ['WARD_REQUEST_MADE', 'WARD_REQUEST_REFUSED'] } })).toBe(2);
  });

  it('a narcotic still needs the ordering doctor’s registration number; a request is cancelled before the pharmacy answers', async () => {
    const morph = await medicine({ name: 'Sample Morphine 10 mg', form: 'injection', unit: 'ampoule', schedule: 'narcotic' });
    await stock(morph, 5);
    const p = await admitted('Sample Pain Mother');
    // drB has no registration number
    const asked = ok(await wr(p, 'post', '', { lines: [{ medicineId: morph.id, qty: 1 }], orderedById: String(people.drB._id) }), 201).request;
    const res = await ph('post', '/invoices', { kind: 'issue', patientId: p.id, wardRequestId: asked.id, lines: [{ medicineId: morph.id, qty: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/registration number/);
    ok(await wr(p, 'post', `/${asked.id}/cancel`, { reason: 'Ordered by mistake' }));
    // An RMO asking is the one who ordered
    const own = ok(await wr(p, 'post', '', { lines: [{ medicineId: morph.id, qty: 1 }] }, 'rmo'), 201).request;
    expect(own.orderedBy.name).toBe(people.rmo.name);
  });
});

describe('Opening stock of narcotic and Schedule X medicines', () => {
  it('needs a second person who signs in; the stock move keeps the witness', async () => {
    const lines = [
      { row: 2, name: 'Sample Morphine 10 mg', batch: 'MO1', expiry: '2028-06', qty: 5, mrpPaise: 2000, ratePaise: 1500, schedule: 'narcotic', form: 'injection', unit: 'ampoule' },
      { row: 3, name: 'Sample Para Tab', batch: 'PA1', expiry: '2028-06', qty: 50, mrpPaise: 200, ratePaise: 100 },
    ];
    const refused = await ph('post', '/opening-stock', { lines });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/narcotic or Schedule X/);
    expect((await ph('post', '/opening-stock', { lines, witness: { email: people.nurse.email, password: 'wrong-password' } })).status).toBe(400);
    const done = ok(await ph('post', '/opening-stock', { lines, witness: { email: people.nurse.email, password: PASSWORD } }), 201).imported;
    expect(done).toMatchObject({ batches: 2, controlled: 1, witness: `${people.nurse.name} (Nurse)` });
    const { StockMove } = await import('../src/models/Pharmacy.js');
    const moves = await StockMove.find({ tenantId: hospital._id, kind: 'opening' }).lean();
    expect(moves.map((m) => m.witness ?? '').sort()).toEqual(['', `${people.nurse.name} (Nurse)`]);
  });
});

describe('PH13 – stock kept outside the pharmacy', () => {
  const places = async (method, path, body, who = 'drA') => (await as(who))[method](`/api/stock-places${path}`).send(body);
  const pharmacyBatch = async (m) => {
    const { StockBatch } = await import('../src/models/Pharmacy.js');
    return StockBatch.findOne({ tenantId: hospital._id, medicineId: m.id, locationId: null }).lean();
  };

  it('a doctor makes a place with its staff; the pharmacist moves stock there (total unchanged); the counter takes only from the pharmacy', async () => {
    const pad = await medicine({ name: 'Sample Delivery Pad', form: 'other', unit: 'piece', kind: 'consumable' });
    await stock(pad, 30);
    expect((await places('post', '', { name: 'X room', staffIds: [] }, 'pharm')).status).toBe(403);
    expect((await places('post', '', { name: 'Bad room', staffIds: [String(people.reception._id)] })).status).toBe(400);
    const room = ok(await places('post', '', { name: 'Sample Labour Room', kind: 'labour_room', checkEveryDays: 7, staffIds: [String(people.nurse._id)] }), 201).place;
    const b = await pharmacyBatch(pad);
    // Only the pharmacist moves stock
    expect((await places('post', `/${room.id}/move-in`, { batchId: String(b._id), qty: 10 }, 'nurse')).status).toBe(403);
    expect(ok(await places('post', `/${room.id}/move-in`, { batchId: String(b._id), qty: 20 }, 'pharm'), 201).moved).toMatchObject({ qty: 20, from: 'Pharmacy', to: 'Sample Labour Room' });
    const detail = ok(await places('get', `/${room.id}`, undefined, 'nurse'));
    expect(detail.stock).toEqual([expect.objectContaining({ name: 'Sample Delivery Pad', batch: b.batch, qty: 20 })]);
    expect(JSON.stringify(detail.stock)).not.toMatch(/Paise/);
    expect(detail.place.checkOverdue).toBe(true); // never checked
    // The medicine's total stays 30; the counter has only the pharmacy's 10
    const { StockMove } = await import('../src/models/Pharmacy.js');
    const moves = await StockMove.find({ tenantId: hospital._id, medicineId: pad.id, kind: { $in: ['transfer_out', 'transfer_in'] } }).sort({ _id: 1 }).lean();
    expect(moves.map((x) => [x.kind, x.qty, x.place, x.otherPlace])).toEqual([
      ['transfer_out', -20, '', 'Sample Labour Room'],
      ['transfer_in', 20, 'Sample Labour Room', 'Pharmacy'],
    ]);
    expect(moves[1].balanceAfter).toBe(30);
    const sale = await ph('post', '/invoices', { kind: 'sale', customer: { name: 'Sample Walk In' }, lines: [{ medicineId: pad.id, qty: 15 }], payment: { mode: 'cash' } });
    expect(sale.status).toBe(409);
    // Back to the pharmacy: merged into its batch
    ok(await places('post', `/${room.id}/move-out`, { batchId: detail.stock[0].batchId, qty: 5 }, 'pharm'), 201);
    expect((await pharmacyBatch(pad)).qtyLeft).toBe(15);
    // A place with stock cannot be stopped
    expect((await places('put', `/${room.id}`, { name: 'Sample Labour Room', staffIds: [String(people.nurse._id)], active: false })).status).toBe(409);
  });

  it('a nurse of the place uses its stock for a patient she charts for – names only; a hold reaches the place; a check corrects the count', async () => {
    const oxy = await medicine({ name: 'Sample Oxytocin 5 IU', form: 'injection', unit: 'ampoule', schedule: 'H' });
    await stock(oxy, 20);
    const room = ok(await places('post', '', { name: 'Sample Theatre', kind: 'theatre', staffIds: [String(people.nurse._id)] }), 201).place;
    const b = await pharmacyBatch(oxy);
    ok(await places('post', `/${room.id}/move-in`, { batchId: String(b._id), qty: 6 }, 'pharm'), 201);
    const p = await admitted('Sample Theatre Mother');
    // Not on the staff: refused; on the staff: an issue on her bill, the doctor who ordered as prescriber
    expect((await places('post', `/${room.id}/use`, { patientId: p.id, orderedById: String(people.drA._id), lines: [{ medicineId: oxy.id, qty: 1 }] }, 'reception')).status).toBe(403);
    const pts = ok(await places('get', `/${room.id}/patients`, undefined, 'nurse')).patients;
    expect(pts.map((x) => x.fullName)).toContain('Sample Theatre Mother');
    expect((await places('post', `/${room.id}/use`, { patientId: p.id, lines: [{ medicineId: oxy.id, qty: 1 }] }, 'nurse')).status).toBe(400); // no doctor named
    const used = ok(await places('post', `/${room.id}/use`, { patientId: p.id, orderedById: String(people.drA._id), lines: [{ medicineId: oxy.id, qty: 2 }] }, 'nurse'), 201).used;
    expect(used).toMatchObject({ place: 'Sample Theatre', lines: [{ name: 'Sample Oxytocin 5 IU', qty: 2 }] });
    expect(JSON.stringify(used)).not.toMatch(/Paise|amount/i);
    const inv = ok(await ph('get', '/invoices')).invoices.find((x) => x.number === used.number);
    expect(inv).toBeTruthy();
    // A hold on the batch number holds the place's copy too
    ok(await ph('post', '/batches/hold', { medicineId: oxy.id, batch: b.batch, reason: 'recalled' }));
    expect((await places('post', `/${room.id}/use`, { patientId: p.id, orderedById: String(people.drA._id), lines: [{ medicineId: oxy.id, qty: 1 }] }, 'nurse')).status).toBe(409);
    // A check: every batch counted; a difference corrects the stock
    const stockNow = ok(await places('get', `/${room.id}`, undefined, 'nurse')).stock;
    expect((await places('post', `/${room.id}/checks`, { lines: [] }, 'nurse')).status).toBe(400);
    const check = ok(await places('post', `/${room.id}/checks`, { lines: [{ batchId: stockNow[0].batchId, found: 3 }], note: 'One broken' }, 'nurse'), 201).check;
    expect(check).toMatchObject({ differences: 1, expiredOut: 0 });
    const after = ok(await places('get', `/${room.id}`, undefined, 'nurse'));
    expect(after.stock[0].qty).toBe(3);
    expect(after.place.checkOverdue).toBe(false);
  });

  it('a narcotic move needs a witness; the doctor’s stock check counts the pharmacy only; another hospital sees nothing', async () => {
    const morph = await medicine({ name: 'Sample Morphine 10 mg', generic: 'Morphine', strength: '10 mg', form: 'injection', unit: 'ampoule', schedule: 'narcotic', reorderLevel: 0 });
    await stock(morph, 4);
    const room = ok(await places('post', '', { name: 'Sample Emergency Tray', kind: 'tray', staffIds: [String(people.nurse._id)] }), 201).place;
    const b = await pharmacyBatch(morph);
    expect((await places('post', `/${room.id}/move-in`, { batchId: String(b._id), qty: 4 }, 'pharm')).status).toBe(400);
    ok(await places('post', `/${room.id}/move-in`, { batchId: String(b._id), qty: 4, witness: { email: people.nurse.email, password: PASSWORD } }, 'pharm'), 201);
    const check = ok(await (await as('drA')).post('/api/pharmacy-stock/check').send({ medicines: [{ drug: 'Morphine', strength: '10 mg', form: 'inj' }] }));
    expect(check.stock[0]).not.toBe('in');
    const other = await createTenant('Pharmacy D Places Other');
    const theirDoc = await createUser({ name: 'Sample their doctor' });
    await addMember(theirDoc, other, 'doctor');
    const theirs = await loginAs(theirDoc, { app });
    expect(ok(await theirs.get('/api/stock-places')).places).toEqual([]);
    expect((await theirs.get(`/api/stock-places/${room.id}`)).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: 'STOCK_TRANSFERRED', 'details.witness': { $exists: true } })).toBe(1);
  });
});
