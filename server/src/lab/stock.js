// The lab's stock (Lab version 2 – docs/LAB_V2_PLAN.md): taking what a reported order's tests use, earliest expiry
// first, and the reagent cost of one test.
import { LabBatch } from '../models/LabBatch.js';
import { LabItem } from '../models/LabItem.js';
import { LabStockMove } from '../models/LabStockMove.js';

/**
 * Takes the stock a reported order uses (once per order): for each test, each item's quantity per test, from its
 * batches with stock, earliest expiry first (expired batches are skipped). What could not be taken (not enough stock)
 * is returned so the lab sees it – the report is never stopped by the stock. Returns { taken, short: [item names] }.
 */
export async function takeStock(req, order) {
  const tenantId = req.tenantId;
  const keys = [...new Set(order.tests.map((t) => t.key))];
  const items = await LabItem.find({ tenantId, active: true, 'perTest.testKey': { $in: keys } }).lean();
  const now = req.now ?? new Date();
  const short = [];
  let taken = 0;
  for (const item of items) {
    for (const use of item.perTest.filter((u) => keys.includes(u.testKey) && u.qty > 0)) {
      let need = use.qty;
      const batches = await LabBatch.find({ tenantId, itemId: item._id, qty: { $gt: 0 }, $or: [{ expiresOn: null }, { expiresOn: { $gte: now } }] }).sort({ expiresOn: 1, receivedAt: 1 });
      for (const b of batches) {
        if (need <= 0) break;
        const qty = Math.min(need, b.qty);
        // Taken only if the batch still has it (two reports at the same moment never take the same stock twice)
        const r = await LabBatch.updateOne({ _id: b._id, tenantId, qty: { $gte: qty } }, { $inc: { qty: -qty } });
        if (!r.modifiedCount) continue;
        need -= qty;
        taken += 1;
        await LabStockMove.create({ tenantId, itemId: item._id, batchId: b._id, kind: 'used', qty: -qty, costPaise: Math.round(qty * b.unitCostPaise), orderId: order._id, testKey: use.testKey, by: req.user._id, byName: req.user.name, at: now });
      }
      if (need > 0) short.push(item.name);
    }
  }
  return { taken, short: [...new Set(short)] };
}

/** The reagent cost of one test, by test key (paise): each item's quantity × the average unit cost of its batches. */
export async function costPerTest(tenantId) {
  const items = await LabItem.find({ tenantId, active: true, 'perTest.0': { $exists: true } }).lean();
  const batches = items.length ? await LabBatch.find({ tenantId, itemId: { $in: items.map((i) => i._id) } }).lean() : [];
  const avg = new Map();
  for (const i of items) {
    const mine = batches.filter((b) => String(b.itemId) === String(i._id) && b.unitCostPaise > 0);
    avg.set(String(i._id), mine.length ? mine.reduce((s, b) => s + b.unitCostPaise, 0) / mine.length : 0);
  }
  const cost = {};
  for (const i of items) for (const u of i.perTest) cost[u.testKey] = (cost[u.testKey] ?? 0) + u.qty * avg.get(String(i._id));
  return Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, Math.round(v)]));
}
