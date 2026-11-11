// Pharmacy Stage D (docs/PHARMACY_BUILD_NOTE.md section 6): the hospital side. PH14 kits and consumables.
// All fake sample data.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-11T06:00:00Z');
const ROLES = { drA: 'doctor', nurse: 'nurse', reception: 'receptionist', pharm: 'pharmacist', admin: 'admin' };
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
