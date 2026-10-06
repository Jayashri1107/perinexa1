// Master data: the shared lists other modules pick from. Items are deactivated, never deleted,
// so records that already use them stay valid.
import { statusMatch, withId } from '../../core/aggregate.js';
import { notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { MasterData } from './masterData.model.js';

export async function listMasterData(type, q) {
  const match = { type, ...statusMatch(q.status) };
  if (q.search) {
    const text = containsText(q.search);
    match.$or = [{ name: text }, { code: text }];
  }
  return paginate(MasterData, { match, sort: toSort(q.sort), page: q.page, limit: q.limit, pageStages: withId() });
}

// Active items for drop-downs.
export async function masterOptions(type) {
  const rows = await MasterData.find({ type, isActive: true }).sort({ sortOrder: 1, name: 1 }).select('code name').lean();
  return rows.map((r) => ({ id: r._id.toString(), code: r.code, name: r.name }));
}

// The ids that exist, are active and belong to the list – used by other modules before saving a reference.
export async function activeIdsOfType(type, ids) {
  const rows = await MasterData.find({ _id: { $in: ids }, type, isActive: true }).select('_id').lean();
  return new Set(rows.map((r) => r._id.toString()));
}

async function findItemOr404(type, id) {
  const item = await MasterData.findOne({ _id: id, type });
  if (!item) throw notFoundError('Item');
  return item;
}

export async function createMasterData(req, type, data) {
  const item = await MasterData.create({ ...data, type, createdBy: req.user._id });
  await recordAudit(req, 'MASTER_CREATED', { details: { type, code: item.code, name: item.name } });
  return item;
}

export async function updateMasterData(req, type, id, data) {
  const item = await findItemOr404(type, id);
  item.set(data);
  await item.save();
  await recordAudit(req, 'MASTER_UPDATED', { details: { type, code: item.code, name: item.name } });
  return item;
}

export async function setMasterDataStatus(req, type, id, isActive) {
  const item = await findItemOr404(type, id);
  if (item.isActive === isActive) return item;
  item.isActive = isActive;
  await item.save();
  await recordAudit(req, isActive ? 'MASTER_ACTIVATED' : 'MASTER_DEACTIVATED', { details: { type, code: item.code } });
  return item;
}
