// Small pieces shared by the pharmacy's routes (routes/pharmacy.js, pharmacyOrders.js, pharmacySupplierReturns.js):
// who may do what, the checks on what is sent, the pharmacy's details, and what the website gets for a medicine and
// a batch.

import { z } from 'zod';
import { hospitalToday, isoDay } from '../careplans/dates.js';
import { hasRole } from '../models/Membership.js';
import { Tenant } from '../models/Tenant.js';
import { HttpError } from '../utils/httpError.js';
import { objectId, parse } from '../utils/validate.js';
import { CONTROLLED, MAX_PAISE, MAX_QTY, MIN_REASON, PHARMACY_DESK_ROLES, PHARMACY_REPORT_ROLES, SCHEDULE_LABELS } from './pharmacyRules.js';
import { daysLeft, isExpired } from './pharmacyService.js';

export const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
export const notFound = (what) => new HttpError(404, `${what} not found.`, 'NOT_FOUND');

/** The pharmacist's own work: selling, issuing, receiving, returning, writing off, counting. */
export const desk = (req) => {
  if (!hasRole(req.membership, ...PHARMACY_DESK_ROLES)) throw forbidden('Only the pharmacist does this.');
};
/** The medicine list, the suppliers, the settings and purchase orders: the pharmacist or the hospital admin. */
export const editor = (req) => {
  if (!hasRole(req.membership, 'pharmacist', 'admin')) throw forbidden('Only the pharmacist or the hospital admin changes this.');
};
export const canEdit = (req) => hasRole(req.membership, 'pharmacist', 'admin');
export const reports = (req) => {
  if (!hasRole(req.membership, ...PHARMACY_REPORT_ROLES)) throw forbidden('Pharmacy reports are for the pharmacist and the hospital admin.');
};

export const qty = z.number().int().min(1, 'Enter the quantity.').max(MAX_QTY);
export const paise = z.number().int().min(0).max(MAX_PAISE);
export const reason = (label) => z.string().trim().min(MIN_REASON, `${label}: please write a reason.`).max(200);
export const idParam = (req) => parse(z.object({ id: objectId }), req.params).id;
export const today = (req) => hospitalToday(req.now);

/** The pharmacy's details as printed on its papers (its own address and phone, else the hospital letterhead's). */
export async function settingsOf(tenantId) {
  const t = await Tenant.findById(tenantId, { name: 1, letterhead: 1, pharmacy: 1 }).lean();
  const p = t?.pharmacy ?? {};
  return {
    name: p.name || t?.letterhead?.name || t?.name || '',
    gstin: p.gstin ?? '',
    licence20: p.licence20 ?? '',
    licence21: p.licence21 ?? '',
    rmi: p.rmi ?? '',
    pharmacistName: p.pharmacistName ?? '',
    state: p.state ?? '',
    place: p.place ?? '',
    pin: p.pin ?? '',
    address: p.address || t?.letterhead?.address || '',
    phone: p.phone || t?.letterhead?.phone || '',
  };
}

export const medicineView = (m, stock = null) => ({
  id: String(m._id),
  name: m.name,
  generic: m.generic ?? '',
  form: m.form,
  strength: m.strength ?? '',
  unit: m.unit,
  hsn: m.hsn ?? '',
  gstRate: m.gstRate,
  schedule: m.schedule ?? '',
  scheduleLabel: SCHEDULE_LABELS[m.schedule ?? ''],
  controlled: CONTROLLED.includes(m.schedule),
  reorderLevel: m.reorderLevel ?? 0,
  barcodes: m.barcodes ?? [],
  active: m.active,
  ...(stock != null ? { inStock: stock, low: m.active && stock <= (m.reorderLevel ?? 0) } : {}),
});

export const batchView = (b, t) => ({ id: String(b._id), batch: b.batch, expiry: isoDay(b.expiry), daysLeft: daysLeft(b.expiry, t), expired: isExpired(b, t), mrpPaise: b.mrpPaise, costPaise: b.costPaise, qtyLeft: b.qtyLeft, qtyIn: b.qtyIn });

/** A supplier as the website gets it. */
export const supplierView = (s) => ({ id: String(s._id), name: s.name, gstin: s.gstin ?? '', drugLicence: s.drugLicence ?? '', phone: s.phone ?? '', address: s.address ?? '', active: s.active });
