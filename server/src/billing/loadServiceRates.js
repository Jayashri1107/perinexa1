// Puts the service rate list (serviceRates.js) into every hospital's price list. Run by the person who runs the
// server: npm run load:service-rates. Safe to run again. Only a price still at ₹0 is filled in – a price the hospital
// admin has set is never changed. A missing item (a named service or a ward's room charge) is added. Each change is in
// the audit log, as when the hospital admin changes a price. Bills already made keep their prices.
import { AuditLog } from '../models/AuditLog.js';
import { PriceItem } from '../models/PriceItem.js';
import { Tenant } from '../models/Tenant.js';
import { ensurePriceList } from './billingService.js';
import { KEYED_SERVICE_RATES, NAMED_SERVICE_RATES, ROOM_RATES, SERVICE_RATE_LIST_NAME } from './serviceRates.js';

const BY = 'load:service-rates';
const same = (s) => String(s ?? '').trim().toLowerCase();

/** Returns [{ hospital, priced, added, kept }] for every hospital. kept: already priced by the hospital, left alone. */
export async function loadServiceRates() {
  const out = [];
  for (const t of await Tenant.find({}, { name: 1 }).lean()) {
    const tenantId = t._id;
    await ensurePriceList(tenantId);
    const audits = [];
    const count = { priced: 0, added: 0, kept: 0 };
    const price = async (item, rupees) => {
      if (item.pricePaise > 0) {
        count.kept += 1;
        return;
      }
      const pricePaise = rupees * 100;
      await PriceItem.updateOne({ tenantId, _id: item._id, pricePaise: 0 }, { $set: { pricePaise, updatedByName: SERVICE_RATE_LIST_NAME } });
      audits.push({ action: 'PRICE_LIST_CHANGED', tenantId, details: { priceItemId: String(item._id), from: 0, pricePaise, by: BY } });
      count.priced += 1;
    };
    let order = Math.max(6000, ...(await PriceItem.find({ tenantId }, { order: 1 }).lean()).map((i) => i.order ?? 0));
    const add = async (fields, rupees) => {
      order += 10;
      const item = await PriceItem.create({ tenantId, key: null, ...fields, pricePaise: rupees * 100, builtIn: false, order, updatedByName: SERVICE_RATE_LIST_NAME });
      audits.push({ action: 'PRICE_LIST_CHANGED', tenantId, details: { priceItemId: String(item._id), pricePaise: item.pricePaise, added: true, by: BY } });
      count.added += 1;
    };

    for (const item of await PriceItem.find({ tenantId, key: { $in: Object.keys(KEYED_SERVICE_RATES) } }).lean()) await price(item, KEYED_SERVICE_RATES[item.key]);

    const inpatient = await PriceItem.find({ tenantId, group: 'inpatient' }).lean();
    for (const { name, rupees } of NAMED_SERVICE_RATES) {
      const have = inpatient.find((i) => !i.ward && same(i.name) === same(name));
      if (have) await price(have, rupees);
      else await add({ name, group: 'inpatient' }, rupees);
    }
    for (const { ward, name, rupees } of ROOM_RATES) {
      const have = inpatient.find((i) => i.ward && same(i.ward) === same(ward));
      if (have) await price(have, rupees);
      else await add({ name, group: 'inpatient', ward }, rupees);
    }
    if (audits.length) await AuditLog.insertMany(audits);
    out.push({ hospital: t.name, ...count });
  }
  return out;
}
