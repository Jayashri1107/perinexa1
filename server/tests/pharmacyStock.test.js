// Pharmacy stock while prescribing: POST /api/pharmacy-stock/check – for doctors and RMOs, in stock / low / out only,
// matched conservatively by brand or generic name and strength. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { amountsIn, matchLine, matchesMedicine, matchingMedicines, nameKey, readLine, statusFor, stockIndex } from '../src/pharmacy/stockMatch.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const NOW = new Date('2026-09-28T06:00:00Z'); // Monday 28 Sep 2026, 11:30 in the hospital
const ROLES = { drA: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', pharm: 'pharmacist', admin: 'admin' };

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
  app = createApp();
  hospital = await createTenant('Stock Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
});
afterEach(() => vi.useRealTimers());

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const later = (iso) => {
  vi.setSystemTime(new Date(iso));
  sessions = {};
};
const ph = async (method, path, body, who = 'pharm') => (await as(who))[method](`/api/pharmacy${path}`).send(body);
const check = async (medicines, who = 'drA') => (await as(who)).post('/api/pharmacy-stock/check').send({ medicines });

async function medicine(fields, who = 'pharm') {
  const res = await ph('post', '/medicines', { form: 'tablet', unit: 'tablet', gstRate: 5, ...fields }, who);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.medicine;
}
// Stock in: one batch of a medicine (expiry month YYYY-MM).
async function stock(med, qty, expiry = '2027-06', who = 'pharm') {
  const sup = (await ph('post', '/suppliers', { name: `Sample Distributors ${randomUUID().slice(0, 4)}` }, who)).body.supplier;
  const res = await ph('post', '/purchases', { supplierId: sup.id, invoiceNo: `INV-${randomUUID().slice(0, 6)}`, invoiceDate: '2026-09-27', lines: [{ medicineId: med.id, batch: 'B1', expiry, qty, ratePaise: 500, mrpPaise: 1000 }] }, who);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

describe('matching a prescription line to the stock list (pure)', () => {
  const dolo = { name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg', form: 'tablet' };
  const crocin = { name: 'Crocin 500', generic: 'Paracetamol', strength: '', form: 'tablet' };
  const shelcal = { name: 'Shelcal 500', generic: 'Calcium carbonate + Vitamin D3', strength: '500 mg + 250 IU', form: 'tablet' };
  const calpol = { name: 'Calpol', generic: 'Paracetamol', strength: '250 mg/5 ml', form: 'syrup' };
  const rx = (drug, strength = '', form = 'tab') => ({ drug, strength, form });

  it('reads names without form words, brackets and amounts', () => {
    expect(nameKey('Tab. Shelcal-500')).toBe('shelcal');
    expect(nameKey('Paracetamol Tablets IP 500 mg')).toBe('paracetamol');
    expect(nameKey('Nifedipine (extended release)')).toBe('nifedipine');
    expect(nameKey('Calcium carbonate + Vitamin D3')).toBe('calcium carbonate d3 vitamin');
    expect(amountsIn('1,00,000 IU')).toEqual([{ value: 100000, kind: 'iu', base: 100000 }]);
    expect(amountsIn('100 mg/ml').map((a) => `${a.value} ${a.kind}`)).toEqual(['100 mass', '1 ml']);
    expect(amountsIn('Vitamin D3 and B12')).toEqual([]); // letters and figures of a name are not amounts
  });

  it('matches by brand or by generic name, when the strength agrees', () => {
    expect(matchesMedicine(rx('Paracetamol', '650 mg'), dolo)).toBe(true);
    expect(matchesMedicine(rx('Paracetamol', '0.65 g'), dolo)).toBe(true);
    expect(matchesMedicine(rx('Tab. Dolo', '650mg'), dolo)).toBe(true);
    expect(matchesMedicine(rx('Dolo 650'), dolo)).toBe(true);
    expect(matchesMedicine(rx('Paracetamol', '500 mg'), crocin)).toBe(true); // the figure in the brand name
    expect(matchesMedicine(rx('Shelcal 500'), shelcal)).toBe(true);
    expect(matchesMedicine(rx('Calcium carbonate + vitamin D3', '500 mg + 250 IU'), shelcal)).toBe(true);
    expect(matchesMedicine(rx('Paracetamol', '250 mg/5 ml', 'syrup'), calpol)).toBe(true);
  });

  it('is conservative: another strength, another form, another medicine or no strength for a generic do not match', () => {
    expect(matchesMedicine(rx('Paracetamol', '500 mg'), dolo)).toBe(false);
    expect(matchesMedicine(rx('Paracetamol'), dolo)).toBe(false); // which strength?
    expect(matchesMedicine(rx('Paracetamol + caffeine', '650 mg'), dolo)).toBe(false);
    expect(matchesMedicine(rx('Paracetamol', '250 mg/5 ml', 'tab'), calpol)).toBe(false);
    expect(matchesMedicine(rx('Paracetamol', '250 mg', 'syrup'), calpol)).toBe(false); // in how many ml?
    expect(matchesMedicine(rx('Paracetamol', '250 mg/ml', 'syrup'), calpol)).toBe(false);
    expect(matchesMedicine(rx('Calpol', '', 'syrup'), calpol)).toBe(true); // the brand itself was named
    expect(matchesMedicine(rx('Calcium', '500 mg'), shelcal)).toBe(false);
    expect(matchesMedicine(rx('Dolopar', '650 mg'), dolo)).toBe(false);
    expect(matchesMedicine(rx('', '650 mg'), dolo)).toBe(false);
    // A strength in words says which medicine is meant: "DS" is not the single-strength tablet
    const septran = { name: 'Septran', generic: 'Co-trimoxazole', strength: '480 mg', form: 'tablet' };
    expect(matchesMedicine(rx('Septran', 'DS'), septran)).toBe(false);
    expect(matchesMedicine(rx('Septran', 'forte'), septran)).toBe(false);
    expect(matchesMedicine(rx('Septran', '480 mg'), septran)).toBe(true);
    expect(matchesMedicine(rx('Septran'), septran)).toBe(true); // the brand itself, no strength written
    expect(matchesMedicine(rx('Septran', 'ds'), { ...septran, strength: 'DS' })).toBe(true); // the pharmacy says the same words
    // By generic name the pharmacy's medicine must be that medicine alone: one more amount is one more ingredient
    const augmentin = { name: 'Augmentin 625', generic: 'Amoxicillin', strength: '500 mg + 125 mg', form: 'tablet' };
    expect(matchesMedicine(rx('Amoxicillin', '500 mg'), augmentin)).toBe(false);
    expect(matchesMedicine(rx('Amoxicillin 500'), augmentin)).toBe(false);
    expect(matchesMedicine(rx('Amoxicillin', '500 mg + 125 mg'), augmentin)).toBe(true);
    expect(matchesMedicine(rx('Augmentin 625', '500 mg'), augmentin)).toBe(true); // the brand itself was named
  });

  // The stock list as the route reads it: each medicine with an id and a reorder level; `left` = usable units.
  let nextId = 0;
  const med = (fields, left = 0) => ({ _id: `m${(nextId += 1)}`, form: 'tablet', generic: '', strength: '', reorderLevel: 10, left, ...fields });
  const answer = (line, list) => statusFor(matchingMedicines(line, list), new Map(list.map((m) => [m._id, m.left])));

  it('gives in stock, low or out from the usable stock and the reorder level', () => {
    const p650 = (left, extra = {}) => med({ name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg', ...extra }, left);
    const asked = rx('Paracetamol', '650 mg');
    expect(answer(rx('Labetalol', '100 mg'), [p650(50)])).toBeNull(); // nothing matched
    expect(answer(asked, [p650(0)])).toBe('out');
    expect(answer(asked, [p650(10)])).toBe('low');
    expect(answer(asked, [p650(11)])).toBe('in');
    // Another brand of the same medicine in the same strength has enough
    expect(answer(asked, [p650(3), p650(1, { name: 'Crocin 650', reorderLevel: 0 })])).toBe('in');
  });

  it('a brand written without a strength, kept in several strengths: an answer only when they all say the same', () => {
    const thyronorm = (mcg, left) => med({ name: 'Thyronorm', generic: 'Levothyroxine', strength: `${mcg} mcg` }, left);
    expect(answer(rx('Thyronorm'), [thyronorm(25, 100), thyronorm(50, 100), thyronorm(100, 100)])).toBe('in');
    expect(answer(rx('Thyronorm'), [thyronorm(25, 0), thyronorm(50, 0)])).toBe('out');
    expect(answer(rx('Thyronorm'), [thyronorm(25, 100), thyronorm(50, 0)])).toBeNull(); // which strength is meant?
    expect(answer(rx('Thyronorm'), [thyronorm(25, 100), thyronorm(50, 5)])).toBeNull();
    // With the strength written there is no doubt
    expect(answer(rx('Thyronorm', '50 mcg'), [thyronorm(25, 100), thyronorm(50, 0)])).toBe('out');
    expect(answer(rx('Thyronorm', '25 mcg'), [thyronorm(25, 100), thyronorm(50, 0)])).toBe('in');
    expect(answer(rx('Thyronorm'), [thyronorm(50, 100)])).toBe('in'); // one strength kept
  });

  it('"not in stock" by generic name is not said while a medicine with no generic name recorded could be the same medicine', () => {
    const crocin = (left) => med({ name: 'Crocin 500', generic: 'Paracetamol', strength: '500 mg' }, left);
    const dolo500 = med({ name: 'Dolo 500', strength: '500 mg' }, 200); // generic name left blank
    const asked = rx('Paracetamol', '500 mg');
    expect(answer(asked, [crocin(0)])).toBe('out');
    expect(answer(asked, [crocin(0), dolo500])).toBeNull(); // the pharmacy's list cannot rule paracetamol 500 mg out
    expect(answer(asked, [crocin(0), med({ name: 'Unnamed tablets' }, 5)])).toBeNull(); // no strength recorded either: it could be anything
    // What is on the shelf is still said
    expect(answer(asked, [crocin(40), dolo500])).toBe('in');
    expect(answer(asked, [crocin(4), dolo500])).toBe('low');
    // A medicine with no generic name that cannot be it – another strength, another form – does not stop the answer
    expect(answer(asked, [crocin(0), med({ name: 'Orofer XT', strength: '100 mg + 1.5 mg' }, 50)])).toBe('out');
    expect(answer(asked, [crocin(0), med({ name: 'Calpol', strength: '250 mg/5 ml', form: 'syrup' }, 50)])).toBe('out');
    expect(answer(asked, [crocin(0), med({ name: 'Dolo 650', strength: '650 mg' }, 50)])).toBe('out');
    // The brand itself was named: it is out, whatever else is on the shelf
    expect(answer(rx('Crocin 500'), [crocin(0), dolo500])).toBe('out');
  });

  it('reads the stock list once for all the lines asked about, and gives the same answers as line by line', () => {
    const list = [
      med({ name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg' }, 100),
      med({ name: 'Crocin 650', generic: 'Paracetamol', strength: '650 mg' }, 0),
      med({ name: 'Shelcal 500', generic: 'Calcium carbonate + Vitamin D3', strength: '500 mg + 250 IU' }, 3),
      med({ name: 'Paracetamol', generic: 'Paracetamol', strength: '500 mg' }, 0),
      ...Array.from({ length: 500 }, (_, i) => med({ name: `Sample brand ${i}`, generic: `Samplegeneric${i}`, strength: `${i + 1} mg` }, i)),
    ];
    const asked = [rx('Paracetamol', '650 mg'), rx('Tab. Dolo', '650mg'), rx('Shelcal 500'), rx('Paracetamol', '500 mg'), rx('Sample brand 7', '8 mg'), rx('Samplegeneric9', '10 mg'), rx('Nothing like it', '5 mg'), rx('', '650 mg')];
    const lines = asked.map(readLine);
    const index = stockIndex(list, lines);
    const usable = new Map(list.map((m) => [m._id, m.left]));
    const together = lines.map((l) => statusFor(matchLine(l, index), usable));
    expect(together).toEqual(['in', 'in', 'low', 'out', 'low', 'low', null, null]);
    expect(asked.map((l) => answer(l, list))).toEqual(together);
    // Only the medicines that can match are read in full: the two paracetamol brands by generic, one "Paracetamol" by brand
    expect([...index.byGeneric.keys()].sort()).toEqual(['paracetamol', 'samplegeneric9']);
    expect(index.byGeneric.get('paracetamol')).toHaveLength(2);
    expect(index.byBrand.get('paracetamol')).toHaveLength(1);
    // The same medicines, whichever way a line found them
    expect(matchingMedicines(asked[0], list).medicines.map((m) => m.name)).toEqual(['Dolo 650', 'Crocin 650']);
  });

  it('a full prescription against a long stock list stays quick', () => {
    const list = Array.from({ length: 3000 }, (_, i) => med({ name: `Samplebrand${i} ${(i % 9) * 50 + 50}`, generic: `Samplegeneric${i % 700} hydrochloride`, strength: `${(i % 9) * 50 + 50} mg` }, i % 40));
    const asked = Array.from({ length: 40 }, (_, i) => rx(`Tab. Samplegeneric${i * 13} hydrochloride sustained release ${'x'.repeat(60)}`.slice(0, 120), `${(i % 9) * 50 + 50} mg`));
    const started = performance.now();
    const lines = asked.map(readLine);
    const index = stockIndex(list, lines);
    const found = lines.map((l) => matchLine(l, index));
    const took = performance.now() - started;
    expect(found).toHaveLength(40);
    // Line by medicine this was about half a second; reading each side once is a few milliseconds. A wide margin for a slow machine.
    expect(took).toBeLessThan(250);
  });
});

describe('POST /api/pharmacy-stock/check', () => {
  it('is for those who write prescriptions: doctors and RMOs', async () => {
    await medicine({ name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg' });
    const asked = [{ drug: 'Paracetamol', strength: '650 mg', form: 'tab' }];
    for (const who of ['drA', 'rmo']) expect((await check(asked, who)).status, who).toBe(200);
    for (const who of ['nurse', 'reception', 'lab', 'pharm', 'admin']) {
      const res = await check(asked, who);
      expect(res.status, who).toBe(403);
      expect(res.body.stock).toBeUndefined();
    }
    const { default: request } = await import('supertest');
    expect((await request(app).post('/api/pharmacy-stock/check').send({ medicines: asked })).status).toBe(401);
  });

  it('says there is nothing to show while the hospital keeps no medicines in the pharmacy', async () => {
    const res = await check([{ drug: 'Paracetamol', strength: '500 mg', form: 'tab' }]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pharmacy: false, stock: [null] });
  });

  it('answers in stock, low or out for each medicine, in the order asked – and nothing else', async () => {
    const dolo = await medicine({ name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg', reorderLevel: 20 });
    const orofer = await medicine({ name: 'Orofer XT', generic: 'Ferrous ascorbate + folic acid', strength: '100 mg + 1.5 mg', reorderLevel: 50 });
    await medicine({ name: 'Mox 500', generic: 'Amoxicillin', strength: '500 mg', form: 'capsule', unit: 'capsule' });
    await stock(dolo, 100);
    await stock(orofer, 30);
    const res = await check([
      { drug: 'Paracetamol', strength: '650 mg', form: 'tab' },
      { drug: 'Orofer XT', strength: '', form: 'tab' },
      { drug: 'Amoxicillin', strength: '500 mg', form: 'cap' },
      { drug: 'Labetalol', strength: '100 mg', form: 'tab' },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Exactly this: no names, quantities, prices, batches, expiry dates or suppliers
    expect(res.body).toEqual({ pharmacy: true, stock: ['in', 'low', 'out', null] });
    expect(JSON.stringify(res.body)).not.toMatch(/Dolo|Orofer|qty|paise|batch|expiry|Sample Distributors/i);
  });

  it('stays silent without a confident match', async () => {
    const dolo = await medicine({ name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg' });
    await stock(dolo, 100);
    const res = await check([
      { drug: 'Paracetamol', strength: '500 mg', form: 'tab' }, // another strength
      { drug: 'Paracetamol', strength: '', form: 'tab' }, // no strength: which one?
      { drug: 'Paracetamol', strength: '650 mg', form: 'inj' }, // another form
      { drug: 'Paracetamol + caffeine', strength: '650 mg', form: 'tab' }, // another medicine
      { drug: 'Dolo', strength: '650 mg' }, // the brand, the same strength, no form sent
    ]);
    expect(res.body.stock).toEqual([null, null, null, null, 'in']);
  });

  it('does not count expired stock or a medicine that was stopped', async () => {
    const dolo = await medicine({ name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg' });
    const old = await medicine({ name: 'Crocin 650', generic: 'Paracetamol', strength: '650 mg' });
    await stock(dolo, 40, '2026-10'); // expires at the end of October 2026
    await stock(old, 40);
    const asked = [{ drug: 'Paracetamol', strength: '650 mg', form: 'tab' }];
    expect((await check(asked)).body.stock).toEqual(['in']);
    expect((await ph('patch', `/medicines/${old.id}`, { active: false })).status).toBe(200);
    expect((await check(asked)).body.stock).toEqual(['in']); // Dolo, not yet expired
    later('2026-11-05T06:00:00Z');
    expect((await check(asked)).body.stock).toEqual(['out']); // Dolo expired; the stopped medicine is not sold
  });

  it("never sees another hospital's stock", async () => {
    const other = await createTenant('Other Stock Hospital');
    people.otherPharm = await createUser({ name: 'Sample otherPharm' });
    await addMember(people.otherPharm, other, 'pharmacist');
    people.otherDr = await createUser({ name: 'Sample otherDr' });
    await addMember(people.otherDr, other, 'doctor');
    const theirs = await medicine({ name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg' }, 'otherPharm');
    await stock(theirs, 100, '2027-06', 'otherPharm');
    const asked = [{ drug: 'Dolo 650', form: 'tab' }];
    expect((await check(asked, 'otherDr')).body).toEqual({ pharmacy: true, stock: ['in'] });
    // This hospital has no pharmacy list at all, then one without that medicine
    expect((await check(asked)).body).toEqual({ pharmacy: false, stock: [null] });
    await medicine({ name: 'Shelcal 500', generic: 'Calcium carbonate + Vitamin D3', strength: '500 mg + 250 IU' });
    expect((await check(asked)).body).toEqual({ pharmacy: true, stock: [null] });
  });

  it('accepts only a list of medicines, changes nothing and leaves no audit entry', async () => {
    const dolo = await medicine({ name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg' });
    await stock(dolo, 100);
    expect((await check([])).status).toBe(400);
    expect((await check([{ drug: '' }])).status).toBe(400);
    expect((await check([{ drug: 'Dolo 650', price: true }])).status).toBe(400);
    expect((await check([{ drug: 'Dolo 650', form: 'tablet' }])).status).toBe(400); // not a prescription form
    expect((await check(Array.from({ length: 41 }, () => ({ drug: 'Dolo 650' })))).status).toBe(400);
    expect((await (await as('drA')).post('/api/pharmacy-stock/check').send({ medicines: [{ drug: 'Dolo 650' }], tenantId: 'x' })).status).toBe(400);
    expect((await (await as('drA')).get('/api/pharmacy-stock/check')).status).toBe(404);
    const before = await AuditLog.countDocuments({ tenantId: hospital._id });
    expect((await check([{ drug: 'Dolo 650' }])).body.stock).toEqual(['in']);
    expect(await AuditLog.countDocuments({ tenantId: hospital._id })).toBe(before);
    // The pharmacy's own stock page still shows the same quantity
    const row = (await ph('get', '/stock')).body.medicines.find((m) => m.id === dolo.id);
    expect(row.qty).toBe(100);
  });
});
