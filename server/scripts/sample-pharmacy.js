// Sample pharmacy stock for trying the pharmacy (owner, 13 Oct 2026) – FAKE SAMPLE DATA ONLY, never in a real hospital.
//
//   npm run sample:pharmacy -w server -- "Anandi Hospital"
//
// For the hospital named: a sample supplier, a few common sample medicines (only those it does not have yet, by name),
// and one delivery from that supplier for every medicine in use there – through the same code as Pharmacy → Purchases →
// "Enter a purchase", so the batches, the stock history and the audit log are as if the pharmacist had entered it. One
// batch expires within two months, so the "Expiring soon" card has something to show. Running it again adds another
// delivery (more stock); it never deletes anything.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Membership } from '../src/models/Membership.js';
import { Medicine, Supplier } from '../src/models/Pharmacy.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { createPurchase } from '../src/pharmacy/pharmacyService.js';
import { audit } from '../src/utils/audit.js';

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Give the hospital\'s name, e.g.: npm run sample:pharmacy -w server -- "Anandi Hospital"');
  process.exit(1);
}

const SUPPLIER = 'Sample Pharma Distributors (sample data)';
// Common sample medicines (prices per unit of sale, in paise). GST 5%: the usual rate for medicines since 22 Sep 2025 –
// the hospital's CA confirms the rate of each real medicine.
const SAMPLES = [
  { name: 'Paracetamol 500 (sample)', generic: 'Paracetamol', strength: '500 mg', form: 'tablet', unit: 'tablet', schedule: '', reorderLevel: 50, rate: 100, mrp: 200 },
  { name: 'Ferrous + Folic acid (sample)', generic: 'Ferrous fumarate + folic acid', strength: '100 mg + 1.5 mg', form: 'tablet', unit: 'tablet', schedule: '', reorderLevel: 60, rate: 150, mrp: 300 },
  { name: 'Calcium + Vitamin D3 (sample)', generic: 'Calcium carbonate + cholecalciferol', strength: '500 mg + 250 IU', form: 'tablet', unit: 'tablet', schedule: '', reorderLevel: 60, rate: 250, mrp: 500 },
  { name: 'Amoxicillin 500 (sample)', generic: 'Amoxicillin', strength: '500 mg', form: 'capsule', unit: 'capsule', schedule: 'H', reorderLevel: 30, rate: 400, mrp: 800 },
  { name: 'ORS sachet (sample)', generic: 'Oral rehydration salts', strength: '21 g', form: 'sachet', unit: 'sachet', schedule: '', reorderLevel: 20, rate: 1200, mrp: 2200 },
];

await mongoose.connect(config.MONGO_URI);
const tenant = await Tenant.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
if (!tenant) {
  console.error(`No hospital is called "${name}".`);
  await mongoose.disconnect();
  process.exit(1);
}
// Entered as the hospital's pharmacist (or its admin), so "by" on the purchase and the audit log name a real account
const member = (await Membership.findOne({ tenantId: tenant._id, isActive: true, roles: 'pharmacist' }).lean()) ?? (await Membership.findOne({ tenantId: tenant._id, isActive: true, roles: 'admin' }).lean());
const user = member ? await User.findById(member.userId).lean() : null;
if (!user) {
  console.error(`${tenant.name} has no active pharmacist or hospital admin to enter the delivery as. Add one first.`);
  await mongoose.disconnect();
  process.exit(1);
}
const req = { tenantId: tenant._id, user, now: new Date(), ip: null, get: () => 'sample-pharmacy script' };

let supplier = await Supplier.findOne({ tenantId: tenant._id, name: SUPPLIER });
if (!supplier) supplier = await Supplier.create({ tenantId: tenant._id, name: SUPPLIER, phone: '0000000000', address: 'Sample address' });
if (!supplier.active) await Supplier.updateOne({ _id: supplier._id }, { $set: { active: true } });

let added = 0;
for (const s of SAMPLES) {
  if (await Medicine.exists({ tenantId: tenant._id, name: s.name })) continue;
  await Medicine.create({ tenantId: tenant._id, name: s.name, generic: s.generic, strength: s.strength, form: s.form, unit: s.unit, schedule: s.schedule, reorderLevel: s.reorderLevel, gstRate: 5, updatedByName: user.name });
  added += 1;
}

const prices = new Map(SAMPLES.map((s) => [s.name, s]));
const meds = await Medicine.find({ tenantId: tenant._id, active: true }).sort({ name: 1 }).lean();
const month = (monthsAhead) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + monthsAhead);
  return d.toISOString().slice(0, 7);
};
const stamp = new Date().toISOString().slice(0, 10);
const lines = meds.map((m, i) => {
  const p = prices.get(m.name) ?? { rate: 500, mrp: 1000 }; // the hospital's own medicines: a sample price
  return {
    medicineId: m._id,
    batch: `SMP${String(i + 1).padStart(3, '0')}`,
    expiry: i === 0 ? month(2) : month(18 + (i % 6)), // the first one expires soon
    qty: 100 + 20 * (i % 5),
    freeQty: 0,
    ratePaise: p.rate,
    mrpPaise: p.mrp,
  };
});
if (!lines.length) {
  console.error('No medicine in use to add stock for.');
  await mongoose.disconnect();
  process.exit(1);
}

const purchase = await createPurchase(req, { supplierId: supplier._id, invoiceNo: `SAMPLE-${stamp}-${Date.now() % 10000}`, invoiceDate: new Date(`${stamp}T00:00:00Z`), lines });
await audit(req, 'PHARMACY_PURCHASE_ENTERED', { details: { purchaseId: String(purchase._id), number: purchase.number, lines: purchase.lines.length, totalPaise: purchase.totalPaise, sample: true } });

console.log(`${tenant.name}: ${added} sample medicine(s) added; delivery ${purchase.number} from "${SUPPLIER}" with stock for ${lines.length} medicine(s):`);
for (const l of purchase.lines) console.log(`  ${l.name} – batch ${l.batch}, ${l.qty} units, expires ${l.expiry.toISOString().slice(0, 7)}`);
await mongoose.disconnect();
