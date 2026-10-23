// Puts the pathology rate list (pathologyRates.js) into every hospital's price list. Run by the person who runs the
// server: npm run load:lab-rates. Safe to run again: a price already right is left alone. Each change is in the
// audit log, as when the hospital admin changes a price. Bills already made keep their prices.
//  - The app's own lab tests get their price by key.
//  - The other tests on the list: an item of the Lab group with the same name (an earlier load, or one the admin or the
//    lab added) gets the price; otherwise a new Lab item is added. A stopped item stays stopped.
import { AuditLog } from '../models/AuditLog.js';
import { PriceItem } from '../models/PriceItem.js';
import { Tenant } from '../models/Tenant.js';
import { ensurePriceList } from './billingService.js';
import { EXTRA_RATES, KEYED_RATES, RATE_LIST_NAME } from './pathologyRates.js';

const BY = 'load:lab-rates';
// Names compared without capitals, punctuation or spacing ("Iron & TIBC" is "iron tibc")
const sameName = (s) => String(s ?? '').toLowerCase().replace(/\band\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Returns [{ hospital, changed, added, unchanged }] for every hospital. */
export async function loadLabRates() {
  const out = [];
  for (const t of await Tenant.find({}, { name: 1 }).lean()) {
    const tenantId = t._id;
    await ensurePriceList(tenantId); // the app's own items exist before they are priced
    const audits = [];
    const count = { changed: 0, added: 0, unchanged: 0 };
    const reprice = async (item, pricePaise) => {
      if (item.pricePaise === pricePaise) {
        count.unchanged += 1;
        return;
      }
      await PriceItem.updateOne({ tenantId, _id: item._id }, { $set: { pricePaise, updatedByName: RATE_LIST_NAME } });
      audits.push({ action: 'PRICE_LIST_CHANGED', tenantId, details: { priceItemId: String(item._id), from: item.pricePaise, pricePaise, by: BY } });
      count.changed += 1;
    };

    const keys = Object.keys(KEYED_RATES).map((k) => `lab:${k}`);
    for (const item of await PriceItem.find({ tenantId, key: { $in: keys } }).lean()) await reprice(item, KEYED_RATES[item.key.slice(4)] * 100);

    const lab = await PriceItem.find({ tenantId, group: 'lab' }).lean();
    const byName = new Map(lab.map((i) => [sameName(i.name), i]));
    let order = Math.max(5000, ...lab.map((i) => i.order ?? 0));
    for (const { name, rupees } of EXTRA_RATES) {
      const have = byName.get(sameName(name));
      if (have) {
        await reprice(have, rupees * 100);
        continue;
      }
      order += 10;
      const item = await PriceItem.create({ tenantId, key: null, name, group: 'lab', pricePaise: rupees * 100, builtIn: false, order, updatedByName: RATE_LIST_NAME });
      byName.set(sameName(name), item);
      audits.push({ action: 'PRICE_LIST_CHANGED', tenantId, details: { priceItemId: String(item._id), pricePaise: item.pricePaise, added: true, by: BY } });
      count.added += 1;
    }
    if (audits.length) await AuditLog.insertMany(audits);
    out.push({ hospital: t.name, ...count });
  }
  return out;
}
