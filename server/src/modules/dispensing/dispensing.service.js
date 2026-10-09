// Giving a prescription (owner, 8 Oct 2026) – at the pharmacy or the front desk (config.access.dispense):
//   the prescription to give: her details, the doctor's medicines (read-only), each matched to the pharmacy's stock
//   with a quantity worked out from the dose and the days, and the price list for other charges;
//   give it: the medicines are sold from stock (earliest expiry first) onto ONE new bill that also holds the other
//   charges (consultation, registration …), a discount, and the payment – the prescription is marked given;
//   the bill to print: the bill with each medicine line of the sale.
// It builds on the pharmacy sale and the bill (their own checks, numbers and audit entries). The doctor's prescription
// itself never changes here.
import { config } from '../../config/index.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { round2 } from '../../core/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { cancelBill, createBill, getBill, setDiscount, takePayment } from '../bills/bill.service.js';
import { Hospital } from '../hospitals/hospital.model.js';
import { medicineOptions } from '../medicines/medicine.service.js';
import { Patient } from '../patients/patient.model.js';
import { priceOptions } from '../priceList/priceList.service.js';
import { Sale } from '../sales/sale.model.js';
import { sell } from '../sales/sale.service.js';
import { Visit } from '../visits/visit.model.js';
import { pharmacyQueue } from '../visits/visit.service.js';

export { pharmacyQueue };

// "Tab Folic acid 5 mg" → "folic acid": the words to look for on the stock list.
const nameOf = (drug) => drug.toLowerCase().replace(/^(tab|cap|syp|syrup|inj|tablet|capsule)\.?\s+/i, '').replace(/\d.*$/, '').trim();
const perDay = (f) => (/^\d(-\d){2,3}$/.test(f) ? f.split('-').reduce((n, x) => n + Number(x), 0) : null);
// How many to give: dose × times a day × days, for tablets and capsules when that can be told; otherwise 1.
function quantityOf(i) {
  const times = perDay(i.frequency);
  const dose = Number(String(i.dose ?? '1').replace('½', '0.5').replace(/[^\d.]/g, '')) || 1;
  const days = i.durationUnit === 'days' ? i.durationValue : i.durationUnit === 'weeks' ? (i.durationValue ?? 0) * 7 : null;
  return times && days && ['tab', 'cap'].includes(i.form) ? Math.ceil(dose * times * days) : 1;
}
const dayIso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

async function loadPrescription(req, visitId) {
  const visit = await Visit.findOne({ hospitalId: req.hospitalId, _id: visitId, status: 'active' }).lean();
  if (!visit || !visit.prescription?.items?.length) throw notFoundError('Prescription');
  const patient = await Patient.findOne({ hospitalId: req.hospitalId, _id: visit.patientId }).lean();
  if (!patient) throw notFoundError('Patient');
  return { visit, patient };
}

const patientView = (p) => ({ id: String(p._id), name: p.name, patientNumber: p.patientNumber, birthDate: p.birthDate, birthDateApprox: p.birthDateApprox, sex: p.sex });

export async function prescriptionToGive(req, visitId) {
  const { visit, patient } = await loadPrescription(req, visitId);
  const items = await Promise.all(
    visit.prescription.items.map(async (i) => {
      const options = await medicineOptions(req.hospitalId, nameOf(i.drug));
      const m = options.find((o) => o.available > 0) ?? null;
      const want = quantityOf(i);
      return {
        rx: { drug: i.drug, form: i.form, strength: i.strength, dose: i.dose, frequency: i.frequency, frequencyText: i.frequencyText, timing: i.timing, durationValue: i.durationValue, durationUnit: i.durationUnit, instructions: i.instructions },
        medicine: m ? { id: m.id, name: m.name, strength: m.strength, schedule: m.schedule, mrp: m.mrp, available: m.available } : null,
        qty: m ? Math.min(want, m.available) : want,
        short: m ? want > m.available : true,
      };
    }),
  );
  return {
    prescription: { visitId: String(visit._id), visitOn: dayIso(visit.visitOn), doctor: visit.prescription.byName ?? '', notes: visit.prescription.notes ?? '', status: visit.pharmacy?.status ?? 'none', invoiceNumber: visit.pharmacy?.invoiceNumber ?? null },
    patient: patientView(patient),
    items,
    charges: await priceOptions(req.hospitalId),
    modes: config.billing.paymentModes,
  };
}

// Medicines on the stock list, to add to what is given.
export const searchMedicines = (req, search) => medicineOptions(req.hospitalId, search);

export async function give(req, visitId, body) {
  const { visit, patient } = await loadPrescription(req, visitId);
  if (visit.pharmacy?.status === 'given') throw new HttpError(409, 'This prescription was already given.', 'ALREADY_GIVEN');
  if (!body.medicines.length && !body.charges.length) throw fieldError('medicines', 'Give at least one medicine or add a charge.');

  // 1. One new bill with the other charges (the medicines come onto it from the sale)
  const { bill } = await createBill(req, { patientId: patient._id, lines: body.charges });
  const billId = bill._id;
  // the discount: on the charges first, the rest on the medicines
  const onCharges = round2(Math.min(body.discount.amount, bill.subtotal));
  const onMedicines = round2(body.discount.amount - onCharges);

  // 2. The medicines, sold from stock onto that bill
  let invoiceNumber = null;
  if (body.medicines.length) {
    try {
      const sale = await sell(req, {
        patientId: String(patient._id),
        customerName: '',
        doctorName: visit.prescription.byName ?? '',
        lines: body.medicines.map((m) => ({ medicineId: m.medicineId, qty: m.qty })),
        discount: { amount: onMedicines, reason: body.discount.reason },
        payTo: 'bill',
        reference: '',
        billId,
      });
      invoiceNumber = sale.invoiceNumber;
    } catch (err) {
      await cancelBill(req, billId, 'Prescription not given – the medicines could not be sold').catch(() => {});
      throw err;
    }
  }

  // 3. The discount on the charges, then the payment
  if (onCharges > 0) await setDiscount(req, billId, { mode: 'amount', value: onCharges, reason: body.discount.reason });
  const { bill: now } = await getBill(req.hospitalId, billId);
  if (body.payment.amount > 0) {
    if (round2(body.payment.amount) > now.balance) throw fieldError('payment.amount', `At most the total (${now.balance}).`);
    await takePayment(req, billId, body.payment);
  }

  // 4. The prescription is given
  await Visit.updateOne(
    { hospitalId: req.hospitalId, _id: visit._id },
    { $set: { 'pharmacy.status': 'given', 'pharmacy.givenAt': new Date(), 'pharmacy.givenByName': req.user.name, 'pharmacy.invoiceNumber': invoiceNumber, 'pharmacy.billId': billId } },
  );
  await recordAudit(req, 'PRESCRIPTION_GIVEN', { hospitalId: req.hospitalId, details: { patientId: String(patient._id), visitId: String(visit._id), billNumber: now.billNumber, ...(invoiceNumber && { invoiceNumber }) } });
  return { billId: String(billId), billNumber: now.billNumber };
}

// The bill of a given prescription, to print: the bill, each medicine line of its pharmacy sales, the prescription
// (date and doctor), the hospital's letterhead.
export async function billToPrint(req, billId) {
  const { bill, payments } = await getBill(req.hospitalId, billId);
  const invoices = bill.lines.filter((l) => l.source === 'pharmacy').map((l) => l.sourceRef);
  const [sales, visit, hospital, patient] = await Promise.all([
    invoices.length ? Sale.find({ hospitalId: req.hospitalId, invoiceNumber: { $in: invoices } }).lean() : [],
    Visit.findOne({ hospitalId: req.hospitalId, 'pharmacy.billId': bill._id }).select('visitOn prescription.byName').lean(),
    Hospital.findById(req.hospitalId).select('name letterhead logoVersion').lean(),
    Patient.findOne({ hospitalId: req.hospitalId, _id: bill.patientId }).lean(),
  ]);
  return {
    hospital: { name: hospital?.name ?? '', letterhead: { ...(hospital?.letterhead ?? {}), logoVersion: hospital?.logoVersion ?? 0 } },
    patient: patient ? patientView(patient) : { name: bill.patient?.name, patientNumber: bill.patient?.patientNumber },
    prescription: visit ? { visitId: String(visit._id), visitOn: dayIso(visit.visitOn), doctor: visit.prescription?.byName ?? '' } : null,
    bill: {
      id: String(bill._id),
      billNumber: bill.billNumber,
      createdAt: bill.createdAt,
      status: bill.status,
      charges: bill.lines.filter((l) => l.source !== 'pharmacy' && l.group !== config.billing.pharmacyGroup).map((l) => ({ name: l.name, group: l.group, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount })),
      subtotal: bill.subtotal,
      discount: bill.discount?.amount ?? 0,
      total: bill.total,
      paid: round2(bill.paid - bill.refunded),
      balance: bill.balance,
    },
    medicines: [
      ...sales.flatMap((s) => s.lines.map((l) => ({ name: l.name, batch: l.batch, expiry: l.expiry, qty: l.qty, mrp: l.mrp, amount: l.amount }))),
      // medicines not on the stock list, priced at the desk
      ...bill.lines.filter((l) => l.source !== 'pharmacy' && l.group === config.billing.pharmacyGroup).map((l) => ({ name: l.name, batch: '', expiry: null, qty: l.qty, mrp: l.unitPrice, amount: l.amount })),
    ],
    medicineDiscount: round2(sales.reduce((n, s) => n + (s.discount?.amount ?? 0), 0)),
    medicineTotal: round2(sales.reduce((n, s) => n + s.total, 0)),
    payments: payments.filter((p) => p.kind === 'payment').map((p) => ({ receiptNumber: p.receiptNumber, mode: p.mode, amount: p.amount, at: p.createdAt })),
    modes: config.billing.paymentModes,
  };
}
