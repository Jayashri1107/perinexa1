import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { rateLimitStore } from '../utils/sharedState.js';
import mongoose from 'mongoose';
import { CONFIDENTIAL_NAME, CONFIDENTIAL_TESTS } from '../billing/billingRules.js';
import { LabOrder } from '../models/LabOrder.js';
import { Patient } from '../models/Patient.js';
import { Tenant } from '../models/Tenant.js';
import { audit } from '../utils/audit.js';
import { letterheadFor } from './settings.js';

// Is this lab report genuine? (/api/verify/lab/:code – Lab version 2, docs/LAB_V2_PLAN.md). No login: the QR code on a
// printed report opens it. The code is secret and long (the hospital's id and 24 random hex characters). It shows only
// the hospital, the sample number, when the sample was taken and the report made, whether a doctor reviewed it, the
// tests (a confidential test under its neutral name) and the patient's initials – never a value, a name, a number or
// a phone. Rate-limited; each check is in the hospital's audit log (no person, the order's id only).

export const verifyRouter = Router();
const NOT_FOUND = { error: { message: 'This report could not be found. Ask the hospital that gave it to you.', code: 'NOT_FOUND' } };
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.VERIFY_RATE_LIMIT_MAX, store: rateLimitStore('verify'), standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { message: 'Too many checks. Please wait 15 minutes.', code: 'RATE_LIMITED' } } });
const initials = (name) =>
  String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0].toUpperCase()}.`)
    .join(' ');

verifyRouter.get('/lab/:code', limiter, async (req, res) => {
  const m = String(req.params.code ?? '').match(/^([a-f0-9]{24})\.([a-f0-9]{24})$/);
  if (!m || !mongoose.isValidObjectId(m[1])) return res.status(404).json(NOT_FOUND);
  const tenantId = new mongoose.Types.ObjectId(m[1]);
  const order = await LabOrder.findOne({ tenantId, verifyToken: req.params.code }).lean();
  if (!order || !['reported', 'reviewed'].includes(order.status)) return res.status(404).json(NOT_FOUND);
  const [tenant, patient] = await Promise.all([Tenant.findById(tenantId), Patient.findOne({ tenantId, _id: order.patientId }, { fullName: 1 }).lean()]);
  if (!tenant?.isActive) return res.status(404).json(NOT_FOUND);
  await audit(req, 'LAB_REPORT_VERIFIED', { tenantId, actor: null, details: { orderId: String(order._id) } });
  res.json({
    genuine: true,
    hospital: letterheadFor(tenant).name,
    sampleNo: order.sampleNo ?? null,
    sampleTaken: order.collected?.at ?? null,
    reported: order.reported?.at ?? null,
    reviewedByDoctor: order.status === 'reviewed',
    changedAfterReport: (order.amendments ?? []).length > 0,
    tests: order.tests.map((t) => (CONFIDENTIAL_TESTS.includes(t.key) ? CONFIDENTIAL_NAME : t.name)),
    patientInitials: initials(patient?.fullName),
  });
});
