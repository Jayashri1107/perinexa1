import { statusMatch, withId } from '../../core/aggregate.js';
import { notFoundError } from '../../core/httpError.js';
import { paginate, toSort } from '../../core/pagination.js';
import { containsText, toObjectId } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import { Supplier } from './supplier.model.js';

export async function listSuppliers(hospitalId, q) {
  const match = { hospitalId: toObjectId(hospitalId), ...statusMatch(q.status) };
  if (q.search) match.$or = [{ name: containsText(q.search) }, { gstin: containsText(q.search) }];
  return paginate(Supplier, { match, sort: toSort(q.sort), page: q.page, limit: q.limit, pageStages: [{ $project: { nameKey: 0 } }, ...withId()] });
}

export async function supplierOptions(hospitalId) {
  const rows = await Supplier.find({ hospitalId, isActive: true }).sort({ name: 1 }).select('name').lean();
  return rows.map((r) => ({ id: r._id.toString(), name: r.name }));
}

export async function findActiveSupplier(hospitalId, id) {
  const supplier = await Supplier.findOne({ _id: id, hospitalId, isActive: true });
  if (!supplier) throw notFoundError('Supplier');
  return supplier;
}

async function findOr404(hospitalId, id) {
  const supplier = await Supplier.findOne({ _id: id, hospitalId });
  if (!supplier) throw notFoundError('Supplier');
  return supplier;
}

export async function createSupplier(req, data) {
  const supplier = await Supplier.create({ ...data, hospitalId: req.hospitalId });
  await recordAudit(req, 'SUPPLIER_CREATED', { hospitalId: req.hospitalId, details: { name: supplier.name } });
  return supplier;
}

export async function updateSupplier(req, id, data) {
  const supplier = await findOr404(req.hospitalId, id);
  supplier.set(data);
  await supplier.save();
  await recordAudit(req, 'SUPPLIER_UPDATED', { hospitalId: req.hospitalId, details: { name: supplier.name } });
  return supplier;
}

export async function setSupplierStatus(req, id, isActive) {
  const supplier = await findOr404(req.hospitalId, id);
  if (supplier.isActive !== isActive) {
    supplier.isActive = isActive;
    await supplier.save();
    await recordAudit(req, 'SUPPLIER_UPDATED', { hospitalId: req.hospitalId, details: { name: supplier.name, isActive } });
  }
  return supplier;
}
