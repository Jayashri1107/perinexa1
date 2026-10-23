// The pathology rate list (23 Oct 2026): npm run load:lab-rates puts it into every hospital's price list. Fake
// hospitals only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadLabRates } from '../src/billing/loadLabRates.js';
import { EXTRA_RATES, KEYED_RATES } from '../src/billing/pathologyRates.js';
import { ensurePriceList } from '../src/billing/billingService.js';
import { LAB_TESTS } from '../src/lab/labTests.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PriceItem } from '../src/models/PriceItem.js';
import { connectTestDb, createTenant, disconnectTestDb, resetTestDb } from './helpers.js';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(resetTestDb);

const price = async (tenantId, filter) => (await PriceItem.findOne({ tenantId, ...filter }).lean())?.pricePaise;

describe('the rate list itself', () => {
  it('prices only tests the app has, names each extra item once, and never names HIV', () => {
    const keys = new Set(LAB_TESTS.map((t) => t.key));
    for (const k of Object.keys(KEYED_RATES)) expect(keys.has(k), k).toBe(true);
    const names = EXTRA_RATES.map((r) => r.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const r of EXTRA_RATES) {
      expect(r.name, r.name).not.toMatch(/hiv|aids/i);
      expect(Number.isInteger(r.rupees) && r.rupees > 0, r.name).toBe(true);
    }
    expect(KEYED_RATES.hormones).toBe(4200); // FSH + LH + AMH + prolactin
  });
});

describe('npm run load:lab-rates', () => {
  it('prices every hospital, adds the other tests once, keeps what the admin added, and logs each change', async () => {
    const a = await createTenant('Rates Hospital A');
    const b = await createTenant('Rates Hospital B');
    await ensurePriceList(a._id);
    // Hospital A's admin already added SGOT at ₹100 and set the CBC at ₹250
    await PriceItem.create({ tenantId: a._id, key: null, name: 'SGOT', group: 'lab', pricePaise: 10000 });
    await PriceItem.updateOne({ tenantId: a._id, key: 'lab:cbc' }, { $set: { pricePaise: 25000 } });

    const first = await loadLabRates();
    expect(first.map((h) => h.hospital).sort()).toEqual(['Rates Hospital A', 'Rates Hospital B']);
    for (const t of [a, b]) {
      expect(await price(t._id, { key: 'lab:cbc' })).toBe(30000);
      expect(await price(t._id, { key: 'lab:hiv' })).toBe(35000);
      expect(await price(t._id, { key: 'lab:hbsag' })).toBe(25000);
      expect(await price(t._id, { key: 'lab:nb_tsh' })).toBe(80000);
      expect(await price(t._id, { key: 'lab:antiTpo' })).toBe(0); // not on the list: unchanged
      expect(await price(t._id, { key: null, name: 'Vitamin D (total 25-OH)' })).toBe(150000);
      expect(await price(t._id, { key: null, name: 'Lab test (confidential) – Chemi' })).toBe(80000);
    }
    // the admin's SGOT got the new price, and no second SGOT was added
    expect(await PriceItem.countDocuments({ tenantId: a._id, name: 'SGOT' })).toBe(1);
    expect(await price(a._id, { name: 'SGOT' })).toBe(15000);
    const hA = first.find((h) => h.hospital === 'Rates Hospital A');
    expect(hA.added).toBe(EXTRA_RATES.length - 1);
    expect(await AuditLog.countDocuments({ tenantId: a._id, action: 'PRICE_LIST_CHANGED', 'details.by': 'load:lab-rates' })).toBe(hA.changed + hA.added);
    expect((await AuditLog.findOne({ tenantId: a._id, 'details.from': 25000 }).lean()).details).toMatchObject({ pricePaise: 30000, by: 'load:lab-rates' });

    // again: nothing changes
    const again = await loadLabRates();
    for (const h of again) expect(h).toMatchObject({ changed: 0, added: 0 });
  });
});
