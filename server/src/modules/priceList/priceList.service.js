import { statusMatch, withId } from '../../core/aggregate.js';
import { notFoundError } from '../../core/httpError.js';
import { round2 } from '../../core/money.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { PriceItem } from './priceItem.model.js';

export async function listPrices(hospitalId, q) {
  const match = { hospitalId: toObjectId(hospitalId), ...statusMatch(q.status) };
  if (q.group) match.group = q.group;
  if (q.search) {
    const text = containsText(q.search);
    match.$or = [{ name: text }, { code: text }];
  }
  return paginate(PriceItem, { match, sort: toSort(q.sort), page: q.page, limit: q.limit, pageStages: withId() });
}

// Active items for choosing on a bill.
export async function priceOptions(hospitalId) {
  const rows = await PriceItem.find({ hospitalId, isActive: true }).sort({ group: 1, name: 1 }).select('code name group price').lean();
  return rows.map((r) => ({ id: r._id.toString(), code: r.code, name: r.name, group: r.group, price: r.price }));
}

export async function findActiveItems(hospitalId, ids) {
  const rows = await PriceItem.find({ hospitalId, _id: { $in: ids }, isActive: true }).lean();
  return new Map(rows.map((r) => [r._id.toString(), r]));
}

async function findOr404(hospitalId, id) {
  const item = await PriceItem.findOne({ _id: id, hospitalId });
  if (!item) throw notFoundError('Price list item');
  return item;
}

export async function createPrice(req, data) {
  const item = await PriceItem.create({ ...data, price: round2(data.price), hospitalId: req.hospitalId, updatedBy: req.user._id });
  await recordAudit(req, 'PRICE_ITEM_CREATED', { hospitalId: req.hospitalId, details: { code: item.code, price: item.price } });
  return item;
}

export async function updatePrice(req, id, data) {
  const item = await findOr404(req.hospitalId, id);
  const before = item.price;
  item.set({ ...data, price: round2(data.price), updatedBy: req.user._id });
  await item.save();
  await recordAudit(req, 'PRICE_ITEM_UPDATED', { hospitalId: req.hospitalId, details: { code: item.code, from: before, to: item.price } });
  return item;
}

export async function setPriceStatus(req, id, isActive) {
  const item = await findOr404(req.hospitalId, id);
  if (item.isActive !== isActive) {
    item.isActive = isActive;
    await item.save();
    await recordAudit(req, 'PRICE_ITEM_UPDATED', { hospitalId: req.hospitalId, details: { code: item.code, isActive } });
  }
  return item;
}
