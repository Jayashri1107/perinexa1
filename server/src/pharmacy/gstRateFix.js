// Moves medicines still on a GST rate no longer in use (12 %, gone since 22 September 2025) to 5 %, the rate of drugs
// and medicines today. Only the medicine list changes: invoices, purchases and returns already made keep the rate
// they were made with. Each change is in the audit log. Run by the person who runs the server: npm run fix:gst-rates.
import { AuditLog } from '../models/AuditLog.js';
import { Medicine } from '../models/Pharmacy.js';
import { Tenant } from '../models/Tenant.js';
import { DEFAULT_GST_RATE, OLD_GST_RATES } from './pharmacyRules.js';

/** Returns [{ hospital, medicines: [name] }] for every hospital where a medicine was moved. */
export async function fixOldGstRates() {
  const out = [];
  for (const t of await Tenant.find({}, { name: 1 }).lean()) {
    const meds = await Medicine.find({ tenantId: t._id, gstRate: { $in: OLD_GST_RATES } }, { name: 1, gstRate: 1 }).lean();
    if (!meds.length) continue;
    await Medicine.updateMany({ tenantId: t._id, _id: { $in: meds.map((m) => m._id) } }, { $set: { gstRate: DEFAULT_GST_RATE } });
    await AuditLog.insertMany(
      meds.map((m) => ({
        action: 'PHARMACY_MEDICINE_CHANGED',
        tenantId: t._id,
        details: { medicineId: String(m._id), fields: ['gstRate'], from: m.gstRate, to: DEFAULT_GST_RATE, by: 'fix:gst-rates' },
      })),
    );
    out.push({ hospital: t.name, medicines: meds.map((m) => m.name) });
  }
  return out;
}
