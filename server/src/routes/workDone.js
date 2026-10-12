import { Router } from 'express';
import { z } from 'zod';
import { billWorkCancelled, billWorkDone } from '../billing/hooks.js';
import { ensurePriceList } from '../billing/billingService.js';
import { hospitalToday, isoDay, utcDay } from '../careplans/dates.js';
import { hasRole } from '../models/Membership.js';
import { PriceItem } from '../models/PriceItem.js';
import { WorkDone } from '../models/WorkDone.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { isDuplicate, refuseNewOnDuplicate } from '../patients/duplicateRules.js';
import { isClosed, refuseNewOnClosed } from '../patients/deathRules.js';
import { findPatient } from '../utils/patientLookup.js';
import { objectId, parse } from '../utils/validate.js';

// Scans and procedures done (/api/patients/:id/work-done): the doctor, RMO or nurse who did a scan or procedure
// records it from the hospital's price list, and its charge goes on the patient's bill by itself (billing/hooks.js)
// – reception no longer adds it by hand. Who may do what:
//  - see the list: those who may see the patient's medical details;
//  - record: those who may record at her visits (her doctor, RMOs, nurses);
//  - cancel (entered in error, with a reason): the same people.
// Clinical staff get the names of the price list's scans and procedures, never the prices.
// The audit log gets ids only.

export const workDoneRouter = Router({ mergeParams: true });

const WORK_GROUPS = ['scan', 'procedure'];
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const stampOf = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });

function accessOf(req, patient) {
  const a = patientAccess(req, patient);
  const view = a.view.has('pregnancy');
  return { view, record: view && Boolean(a.editClinical || a.recordVitals) };
}

const view = (w) => ({
  id: String(w._id),
  name: w.name,
  group: w.group,
  on: isoDay(w.on),
  doneByName: w.done?.byName ?? '',
  doneAt: w.done?.at ?? null,
  cancelled: w.cancelled ? { byName: w.cancelled.byName ?? '', at: w.cancelled.at ?? null, reason: w.cancelled.reason ?? '' } : null,
});

// The same view for the copy of the whole record (patients/recordCopy.js)
export { view as workDoneView };

workDoneRouter.get('/', async (req, res) => {
  const patient = await findPatient(req);
  const access = accessOf(req, patient);
  if (!access.view) throw forbidden("You can't see this patient's scans and procedures.");
  await ensurePriceList(req.tenantId);
  const [done, items] = await Promise.all([
    WorkDone.find({ tenantId: req.tenantId, patientId: patient._id }).sort({ on: -1, createdAt: -1 }).limit(200).lean(),
    access.record ? PriceItem.find({ tenantId: req.tenantId, group: { $in: WORK_GROUPS }, active: true }, { name: 1, group: 1 }).sort({ group: 1, order: 1, name: 1 }).lean() : [],
  ]);
  await audit(req, 'WORK_DONE_VIEWED', { details: { patientId: String(patient._id), mrn: patient.mrn } });
  res.json({ done: done.map(view), items: items.map((i) => ({ id: String(i._id), name: i.name, group: i.group })), canRecord: access.record && !isDuplicate(patient) && !isClosed(patient) });
});

const recordSchema = z.object({ clientRequestId: z.string().min(8).max(64), priceItemId: objectId }).strict();

workDoneRouter.post('/', async (req, res) => {
  const patient = await findPatient(req);
  const access = accessOf(req, patient);
  if (!access.record) throw forbidden("Only the patient's doctor, an RMO or a nurse records a scan or procedure.");
  const body = parse(recordSchema, req.body);
  const repeat = await WorkDone.findOne({ tenantId: req.tenantId, clientRequestId: body.clientRequestId }).lean();
  if (repeat) {
    if (String(repeat.patientId) !== String(patient._id)) throw new HttpError(409, 'This request was already used.', 'CONFLICT');
    return res.status(201).json({ work: view(repeat) });
  }
  refuseNewOnDuplicate(patient, 'work'); // a record marked as a duplicate takes no new scan or procedure
  refuseNewOnClosed(patient, 'work'); // nor a record closed after a death
  const item = await PriceItem.findOne({ tenantId: req.tenantId, _id: body.priceItemId, group: { $in: WORK_GROUPS }, active: true }).lean();
  if (!item) throw new HttpError(400, 'This scan or procedure is not on the price list any more. Reload the page and choose again.', 'VALIDATION');
  // The doctor it counts for on the monthly income report: the doctor who did it, else the patient's doctor.
  const doctorId = hasRole(req.membership, 'doctor') ? req.user._id : (patient.assignedDoctor ?? null);
  const work = await WorkDone.create({
    tenantId: req.tenantId,
    patientId: patient._id,
    priceItemId: item._id,
    name: item.name,
    group: item.group,
    on: utcDay(hospitalToday(req.now)),
    doctorId,
    clientRequestId: body.clientRequestId,
    done: stampOf(req),
  });
  await billWorkDone(req, patient, work, item);
  await audit(req, 'WORK_DONE_RECORDED', { details: { patientId: String(patient._id), mrn: patient.mrn, workId: String(work._id), priceItemId: String(item._id) } });
  return res.status(201).json({ work: view(work) });
});

const cancelSchema = z.object({ reason: z.string().trim().min(3, 'Write why it is cancelled (at least 3 letters).').max(200) }).strict();

workDoneRouter.post('/:workId/cancel', async (req, res) => {
  const patient = await findPatient(req);
  const access = accessOf(req, patient);
  if (!access.record) throw forbidden("Only the patient's doctor, an RMO or a nurse cancels a scan or procedure.");
  const workId = parse(objectId, req.params.workId);
  const { reason } = parse(cancelSchema, req.body);
  const work = await WorkDone.findOneAndUpdate(
    { tenantId: req.tenantId, _id: workId, patientId: patient._id, cancelled: null },
    { $set: { cancelled: { ...stampOf(req), reason } } },
    { returnDocument: 'after' },
  ).lean();
  if (!work) {
    const there = await WorkDone.findOne({ tenantId: req.tenantId, _id: workId, patientId: patient._id }).lean();
    if (!there) throw new HttpError(404, 'This scan or procedure was not found.', 'NOT_FOUND');
    return res.json({ work: view(there) }); // already cancelled
  }
  await billWorkCancelled(req, work);
  await audit(req, 'WORK_DONE_CANCELLED', { details: { patientId: String(patient._id), mrn: patient.mrn, workId: String(work._id) } });
  return res.json({ work: view(work) });
});
