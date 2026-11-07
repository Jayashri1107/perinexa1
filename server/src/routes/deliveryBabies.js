import { Router } from 'express';
import { z } from 'zod';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { objectId, parse } from '../utils/validate.js';
import { registerPatient } from './patients.js';

// The baby's record made from the delivery (Clinical Requirements Group C – PX-X-14): /api/delivery-babies.
//  - GET /?documentId=: the babies on a signed delivery note, each with its record if one was made from it, and the
//    babies already linked to the mother by hand (so a baby is not registered twice);
//  - POST /: make the record of one live-born baby on the note – registered as reception would (patient number, checks,
//    audit, registration fee), linked to the mother, with the time of birth, weight and sex from the note (written after
//    the birth – PC-PNDT allows the sex then). Once per baby on the note. Records that may be the same baby are shown
//    first (POSSIBLE_MATCHES), as when registering by hand; registerAnyway: true makes it after they were seen.
// Who: those who may see the mother's pregnancy details see it; doctors and RMOs make the records.

export const deliveryBabiesRouter = Router();
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const ORDINAL = ['First', 'Second', 'Third', 'Fourth'];

async function load(req, documentId) {
  const doc = await ClinicalDocument.findOne({ _id: documentId, tenantId: req.tenantId, kind: 'delivery' });
  if (!doc) throw new HttpError(404, 'This delivery note was not found.', 'NOT_FOUND');
  const mother = await findPatientById(req.tenantId, doc.patientId);
  const access = patientAccess(req, mother);
  if (!access.view.has('pregnancy')) throw forbidden("You can't see this patient's delivery.");
  return { doc, mother };
}
const babyRef = (p) => ({ id: String(p._id), mrn: p.mrn, fullName: p.fullName });

deliveryBabiesRouter.get('/', async (req, res) => {
  const { documentId } = parse(z.object({ documentId: objectId }).strict(), req.query);
  const { doc, mother } = await load(req, documentId);
  const made = await Patient.find({ tenantId: req.tenantId, 'newborn.fromDelivery.documentId': doc._id }, { mrn: 1, fullName: 1, 'newborn.fromDelivery': 1 }).lean();
  const byHand = await Patient.find({ tenantId: req.tenantId, 'newborn.mother': mother._id, 'newborn.fromDelivery': null }, { mrn: 1, fullName: 1, 'newborn.birthAt': 1 }).lean();
  const babies = (doc.content?.babies ?? []).map((b, index) => {
    const rec = made.find((p) => p.newborn?.fromDelivery?.index === index);
    return { index, outcome: b.outcome || '', sex: b.sex || '', weightGrams: b.weightGrams ?? null, record: rec ? babyRef(rec) : null };
  });
  res.json({
    signed: doc.status === 'signed',
    babies,
    linkedByHand: byHand.map((p) => ({ ...babyRef(p), birthAt: p.newborn?.birthAt ?? null })),
    access: { create: doc.status === 'signed' && hasRole(req.membership, 'doctor', 'rmo') },
  });
});

deliveryBabiesRouter.post('/', async (req, res) => {
  const b = parse(z.object({ documentId: objectId, index: z.coerce.number().int().min(0).max(3), registerAnyway: z.boolean().default(false) }).strict(), req.body);
  if (!hasRole(req.membership, 'doctor', 'rmo')) throw forbidden("Doctors and RMOs make the baby's record from the delivery note.");
  const { doc, mother } = await load(req, b.documentId);
  if (doc.status !== 'signed') throw conflict('Sign the delivery note first.');
  const babies = doc.content?.babies ?? [];
  const baby = babies[b.index];
  if (!baby) throw new HttpError(404, 'This baby is not on the delivery note.', 'NOT_FOUND');
  if (baby.outcome !== 'live') throw conflict('A record is made only for a baby born alive.');
  if (await Patient.exists({ tenantId: req.tenantId, 'newborn.fromDelivery.documentId': doc._id, 'newborn.fromDelivery.index': b.index })) {
    throw conflict("This baby's record was already made from the delivery note.");
  }
  const birthAt = doc.content?.deliveredAt ? new Date(doc.content.deliveredAt).toISOString() : null;
  const name = babies.length > 1 ? `${ORDINAL[b.index]} baby of ${mother.fullName}` : `Baby of ${mother.fullName}`;
  const body = {
    careType: 'newborn',
    fullName: name,
    phone: mother.phone,
    address: mother.address ?? '',
    ...(mother.assignedDoctor ? { assignedDoctor: String(mother.assignedDoctor) } : {}),
    newborn: { birthAt, birthWeightGrams: baby.weightGrams ?? null, sex: baby.sex || '', mother: String(mother._id) },
  };
  let out = await registerPatient(req, { ...body, registerAnyway: b.registerAnyway });
  // "This baby may already be registered": the same check as registering by hand – nothing saved until they say so.
  // A twin made from this same note is not a match for the other twin.
  if (out.matches) {
    const sameNote = new Set((await Patient.find({ tenantId: req.tenantId, 'newborn.fromDelivery.documentId': doc._id }, { _id: 1 }).lean()).map((p) => String(p._id)));
    const others = out.matches.matches.filter((m) => !sameNote.has(m.id));
    if (others.length) return res.status(409).json({ error: { ...out.matches, matches: others, total: others.length } });
    out = await registerPatient(req, { ...body, registerAnyway: true });
  }
  const patient = out.patient;
  patient.newborn.fromDelivery = { documentId: doc._id, index: b.index };
  await patient.save();
  await audit(req, 'BABY_RECORD_FROM_DELIVERY', { details: { patientId: String(patient._id), mrn: patient.mrn, motherId: String(mother._id), documentId: String(doc._id), index: b.index } });
  res.status(201).json({ baby: babyRef(patient) });
});
