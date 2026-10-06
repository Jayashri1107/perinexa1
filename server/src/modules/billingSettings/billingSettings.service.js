// Billing → Settings: the hospital's UPI ID and payee name for payment links. Every change is kept with who and when
// (the last config.billing.upiHistoryLimit), because it decides where patients' money goes.
import { config } from '../../config/index.js';
import { notFoundError } from '../../core/httpError.js';
import { recordAudit } from '../audit/audit.service.js';
import { Hospital } from '../hospitals/hospital.model.js';

const view = (h) => ({
  upiId: h.billing?.upiId ?? '',
  payeeName: h.billing?.payeeName ?? '',
  updatedByName: h.billing?.updatedByName ?? '',
  updatedAt: h.billing?.updatedAt ?? null,
  history: [...(h.billing?.history ?? [])].reverse(),
});

export async function getBillingSettings(hospitalId) {
  const hospital = await Hospital.findById(hospitalId).select('billing').lean();
  if (!hospital) throw notFoundError('Hospital');
  return view(hospital);
}

// Only what is needed to make a UPI link (reception sees this on a bill).
export async function getUpiPayee(hospitalId) {
  const hospital = await Hospital.findById(hospitalId).select('billing.upiId billing.payeeName name').lean();
  return hospital?.billing?.upiId ? { upiId: hospital.billing.upiId, payeeName: hospital.billing.payeeName || hospital.name } : null;
}

export async function updateBillingSettings(req, { upiId, payeeName }) {
  const hospital = await Hospital.findById(req.hospitalId);
  if (!hospital) throw notFoundError('Hospital');
  const now = new Date();
  hospital.billing.upiId = upiId;
  hospital.billing.payeeName = payeeName;
  hospital.billing.updatedByName = req.user.name;
  hospital.billing.updatedAt = now;
  hospital.billing.history.push({ upiId, payeeName, byName: req.user.name, at: now });
  const limit = config.billing.upiHistoryLimit;
  if (hospital.billing.history.length > limit) hospital.billing.history.splice(0, hospital.billing.history.length - limit);
  await hospital.save();
  await recordAudit(req, 'BILLING_SETTINGS_UPDATED', { hospitalId: req.hospitalId, details: { changed: ['upiId', 'payeeName'] } });
  return view(hospital.toObject());
}
