import { Router } from 'express';
import { z } from 'zod';
import { addDays, hospitalDayStart, hospitalToday } from '../careplans/dates.js';
import { costPerTest } from '../lab/stock.js';
import { labCatalogue } from '../lab/labSetup.js';
import { LabBatch } from '../models/LabBatch.js';
import { LabItem } from '../models/LabItem.js';
import { LabOrder } from '../models/LabOrder.js';
import { LabStockMove } from '../models/LabStockMove.js';
import { hasRole } from '../models/Membership.js';
import { PriceItem } from '../models/PriceItem.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// The lab's stock and the cost per test (/api/lab-stock – Lab version 2, docs/LAB_V2_PLAN.md). The lab keeps its
// reagents and consumables: what each test uses, batches received (expiry, cost), counts and write-offs; the stock a
// test uses is taken when its result is reported (lab/stock.js). Low stock and expiring batches are listed. The cost
// report: by month, the tests done, the price-list income, the reagent cost and write-offs, and the margin. No patient
// data. The audit log gets ids and quantities.

export const labStockRouter = Router();
const ROLES = ['lab', 'doctor', 'rmo', 'admin'];
const EDIT = ['lab', 'admin'];
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const EXPIRING_DAYS = 30;

labStockRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('The lab stock is for the lab, doctors, RMOs and the hospital admin.');
  next();
});
const assertEdit = (req) => {
  if (!hasRole(req.membership, ...EDIT)) throw forbidden('The lab and the hospital admin change the stock.');
};
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

async function itemsView(tenantId, now) {
  const items = await LabItem.find({ tenantId }).sort({ active: -1, name: 1 }).lean();
  const batches = items.length ? await LabBatch.find({ tenantId, itemId: { $in: items.map((i) => i._id) } }).sort({ expiresOn: 1 }).lean() : [];
  const soon = addDays(hospitalToday(now), EXPIRING_DAYS);
  return items.map((i) => {
    const mine = batches.filter((b) => String(b.itemId) === String(i._id));
    const usable = mine.filter((b) => b.qty > 0 && (!b.expiresOn || b.expiresOn >= hospitalToday(now)));
    const stock = usable.reduce((s, b) => s + b.qty, 0);
    return {
      id: String(i._id),
      name: i.name,
      kind: i.kind,
      unit: i.unit,
      reorderLevel: i.reorderLevel,
      perTest: i.perTest.map((u) => ({ testKey: u.testKey, qty: u.qty })),
      active: i.active !== false,
      stock,
      low: i.active !== false && stock <= i.reorderLevel,
      batches: mine.filter((b) => b.qty > 0).map((b) => ({ id: String(b._id), batchNo: b.batchNo, expiresOn: day(b.expiresOn), qty: b.qty, unitCostPaise: b.unitCostPaise, supplier: b.supplier, expired: Boolean(b.expiresOn && b.expiresOn < hospitalToday(now)), expiring: Boolean(b.expiresOn && b.expiresOn >= hospitalToday(now) && b.expiresOn <= soon) })),
    };
  });
}

labStockRouter.get('/', async (req, res) => {
  const items = await itemsView(req.tenantId, req.now ?? new Date());
  const catalogue = await labCatalogue(req.tenantId);
  res.json({ items, tests: catalogue.tests.filter((t) => t.active).map((t) => ({ key: t.key, name: t.name })), canEdit: hasRole(req.membership, ...EDIT), expiringDays: EXPIRING_DAYS });
});

const itemSchema = z
  .object({
    name: safeText('Name', 120).refine((t) => t.trim().length >= 2, 'Write the name'),
    kind: z.enum(['reagent', 'consumable', 'control']).default('reagent'),
    unit: safeText('Unit', 20).refine((t) => t.trim().length > 0, 'Write the unit (mL, test, piece …)'),
    reorderLevel: z.number().min(0).max(1_000_000).default(0),
    perTest: z.array(z.object({ testKey: z.string().max(40), qty: z.number().min(0).max(100_000) }).strict()).max(100).default([]),
    active: z.boolean().default(true),
  })
  .strict();

async function checkTests(req, perTest) {
  const catalogue = await labCatalogue(req.tenantId);
  const wrong = perTest.filter((u) => !catalogue.byKey.has(u.testKey));
  if (wrong.length) throw invalid({ perTest: 'A test chosen is not on the list.' });
  return [...new Map(perTest.filter((u) => u.qty > 0).map((u) => [u.testKey, u])).values()];
}

labStockRouter.post('/items', async (req, res) => {
  assertEdit(req);
  const body = parse(itemSchema, req.body);
  const item = await LabItem.create({ tenantId: req.tenantId, ...body, name: body.name.trim(), unit: body.unit.trim(), perTest: await checkTests(req, body.perTest), updatedByName: req.user.name });
  await audit(req, 'LAB_STOCK_CHANGED', { details: { itemId: String(item._id), added: true } });
  res.status(201).json({ items: await itemsView(req.tenantId, req.now ?? new Date()) });
});

labStockRouter.put('/items/:id', async (req, res) => {
  assertEdit(req);
  const body = parse(itemSchema, req.body);
  const item = await LabItem.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!item) throw new HttpError(404, 'This item was not found.', 'NOT_FOUND');
  Object.assign(item, { ...body, name: body.name.trim(), unit: body.unit.trim(), perTest: await checkTests(req, body.perTest), updatedByName: req.user.name });
  await item.save();
  await audit(req, 'LAB_STOCK_CHANGED', { details: { itemId: String(item._id), changed: true } });
  res.json({ items: await itemsView(req.tenantId, req.now ?? new Date()) });
});

// A batch received (purchase): batch number, expiry, quantity, cost of one unit
labStockRouter.post('/items/:id/batches', async (req, res) => {
  assertEdit(req);
  const body = parse(
    z.object({ batchNo: safeText('Batch number', 60).refine((t) => t.trim().length > 0, 'Write the batch number'), expiresOn: z.iso.date().nullable().default(null), qty: z.number('Enter the quantity').positive().max(1_000_000), unitCostPaise: z.number().int().min(0).max(100_000_000).default(0), supplier: safeText('Supplier', 120).default('') }).strict(),
    req.body,
  );
  const item = await LabItem.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!item) throw new HttpError(404, 'This item was not found.', 'NOT_FOUND');
  const now = req.now ?? new Date();
  if (body.expiresOn && new Date(`${body.expiresOn}T00:00:00Z`) < hospitalToday(now)) throw invalid({ expiresOn: 'This batch has already expired.' });
  const batch = await LabBatch.create({ tenantId: req.tenantId, itemId: item._id, batchNo: body.batchNo.trim(), expiresOn: body.expiresOn ? new Date(`${body.expiresOn}T00:00:00Z`) : null, qty: body.qty, unitCostPaise: body.unitCostPaise, supplier: body.supplier.trim(), receivedAt: now });
  await LabStockMove.create({ tenantId: req.tenantId, itemId: item._id, batchId: batch._id, kind: 'received', qty: body.qty, costPaise: Math.round(body.qty * body.unitCostPaise), by: req.user._id, byName: req.user.name, at: now });
  await audit(req, 'LAB_STOCK_CHANGED', { details: { itemId: String(item._id), batchId: String(batch._id), received: body.qty } });
  res.status(201).json({ items: await itemsView(req.tenantId, now) });
});

// A count (the quantity found) or a write-off (expired, broken, spilt): always with a reason
labStockRouter.post('/batches/:id/adjust', async (req, res) => {
  assertEdit(req);
  const body = parse(z.object({ kind: z.enum(['adjusted', 'written_off']), qty: z.number().min(0).max(1_000_000), reason: safeText('Reason', 200) }).strict(), req.body);
  if (body.reason.trim().length < 3) throw invalid({ reason: 'Write why.' });
  const batch = await LabBatch.findOne({ tenantId: req.tenantId, _id: parse(objectId, req.params.id) });
  if (!batch) throw new HttpError(404, 'This batch was not found.', 'NOT_FOUND');
  // adjusted: qty is what was counted; written_off: qty is what is thrown away
  const change = body.kind === 'adjusted' ? body.qty - batch.qty : -Math.min(body.qty, batch.qty);
  if (body.kind === 'written_off' && body.qty <= 0) throw invalid({ qty: 'Enter the quantity written off.' });
  batch.qty += change;
  await batch.save();
  await LabStockMove.create({ tenantId: req.tenantId, itemId: batch.itemId, batchId: batch._id, kind: body.kind, qty: change, costPaise: Math.round(change * batch.unitCostPaise), reason: body.reason.trim(), by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });
  await audit(req, 'LAB_STOCK_CHANGED', { details: { itemId: String(batch.itemId), batchId: String(batch._id), [body.kind]: change } });
  res.json({ items: await itemsView(req.tenantId, req.now ?? new Date()) });
});

// The cost per test (CPRT) for a month: per test – done, income (price list), reagent cost, margin; and write-offs
labStockRouter.get('/costs', async (req, res) => {
  const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Choose a month') }).strict(), req.query);
  const from = new Date(`${month}-01T00:00:00Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const [catalogue, perTest, orders, prices, moves] = await Promise.all([
    labCatalogue(req.tenantId),
    costPerTest(req.tenantId),
    LabOrder.find({ tenantId: req.tenantId, status: { $in: ['reported', 'reviewed'] }, 'reported.at': { $gte: hospitalDayStart(from), $lt: hospitalDayStart(to) } }, { tests: 1 }).lean(),
    PriceItem.find({ tenantId: req.tenantId, key: /^lab:/ }, { key: 1, pricePaise: 1 }).lean(),
    LabStockMove.find({ tenantId: req.tenantId, at: { $gte: hospitalDayStart(from), $lt: hospitalDayStart(to) }, kind: { $in: ['used', 'written_off'] } }, { kind: 1, costPaise: 1, testKey: 1 }).lean(),
  ]);
  const price = new Map(prices.map((p) => [p.key.slice(4), p.pricePaise]));
  const used = new Map();
  for (const m of moves.filter((x) => x.kind === 'used')) used.set(m.testKey, (used.get(m.testKey) ?? 0) + m.costPaise);
  const done = new Map();
  for (const o of orders) for (const t of o.tests) done.set(t.key, (done.get(t.key) ?? 0) + 1);
  const rows = [...done.entries()]
    .map(([key, count]) => {
      const income = count * (price.get(key) ?? 0);
      const cost = used.get(key) ?? 0;
      return { key, name: catalogue.byKey.get(key)?.name ?? 'Other test', count, pricePaise: price.get(key) ?? 0, costPerTestPaise: perTest[key] ?? 0, incomePaise: income, reagentCostPaise: cost, marginPaise: income - cost };
    })
    .sort((a, b) => b.count - a.count);
  const writtenOff = -moves.filter((m) => m.kind === 'written_off').reduce((s, m) => s + m.costPaise, 0);
  const totals = rows.reduce((t, r) => ({ count: t.count + r.count, incomePaise: t.incomePaise + r.incomePaise, reagentCostPaise: t.reagentCostPaise + r.reagentCostPaise }), { count: 0, incomePaise: 0, reagentCostPaise: 0 });
  res.json({ month, rows, totals: { ...totals, writtenOffPaise: writtenOff, marginPaise: totals.incomePaise - totals.reagentCostPaise - writtenOff } });
});
