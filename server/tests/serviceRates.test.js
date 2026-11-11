// The service rate list (11 Nov 2026): npm run load:service-rates fills in every hospital's ₹0 prices and adds the room
// charges of its wards; a price the hospital admin set is never changed. Fake hospitals only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bedPriceFor, ensurePriceList } from '../src/billing/billingService.js';
import { loadServiceRates } from '../src/billing/loadServiceRates.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PriceItem } from '../src/models/PriceItem.js';
import { connectTestDb, createTenant, disconnectTestDb, resetTestDb } from './helpers.js';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(resetTestDb);

const price = async (tenantId, filter) => (await PriceItem.findOne({ tenantId, ...filter }).lean())?.pricePaise;

describe('npm run load:service-rates', () => {
  it('fills in ₹0 prices in every hospital, leaves the admin’s prices alone, adds the room charges once, and logs each change', async () => {
    const a = await createTenant('Service Hospital A');
    const b = await createTenant('Service Hospital B');
    await ensurePriceList(a._id);
    // Hospital A's admin already set nursing at ₹600 and the surgeon fee at ₹35,000
    await PriceItem.updateOne({ tenantId: a._id, key: 'nursing' }, { $set: { pricePaise: 60000 } });
    await PriceItem.updateOne({ tenantId: a._id, name: 'Surgeon fee' }, { $set: { pricePaise: 3500000 } });

    const first = await loadServiceRates();
    expect(first.map((h) => h.hospital).sort()).toEqual(['Service Hospital A', 'Service Hospital B']);
    for (const t of [a, b]) {
      expect(await price(t._id, { key: 'registration' })).toBe(30000);
      expect(await price(t._id, { key: 'ipd_round' })).toBe(100000);
      expect(await price(t._id, { name: 'Anaesthesia charges' })).toBe(1000000);
      expect(await price(t._id, { name: 'Operation theatre charges' })).toBe(1200000);
      expect((await bedPriceFor(t._id, 'deluxe ac')).pricePaise).toBe(200000);
      expect((await bedPriceFor(t._id, 'Super Deluxe AC')).pricePaise).toBe(300000);
      expect(await price(t._id, { key: 'bed' })).toBe(0); // the general ward is not on the list
    }
    expect(await price(a._id, { key: 'nursing' })).toBe(60000);
    expect(await price(a._id, { name: 'Surgeon fee' })).toBe(3500000);
    expect(await price(b._id, { key: 'nursing' })).toBe(50000);
    expect(await price(b._id, { name: 'Surgeon fee' })).toBe(4000000);
    const hA = first.find((h) => h.hospital === 'Service Hospital A');
    expect(hA).toMatchObject({ kept: 2, added: 2 });
    expect(await AuditLog.countDocuments({ tenantId: a._id, action: 'PRICE_LIST_CHANGED', 'details.by': 'load:service-rates' })).toBe(hA.priced + hA.added);

    // again: nothing changes, nothing added twice
    const again = await loadServiceRates();
    for (const h of again) expect(h).toMatchObject({ priced: 0, added: 0 });
    expect(await PriceItem.countDocuments({ tenantId: a._id, ward: 'Deluxe AC' })).toBe(1);
  });
});
