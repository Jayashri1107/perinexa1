import { Router } from 'express';
import { Admission } from '../models/Admission.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { User } from '../models/User.js';
import { planCtx } from '../careplans/plansService.js';
import { SIGNED_BY } from '../inpatient/docSchemas.js';
import { redFlagsForPatients } from '../redflags/redFlagService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { isClosed } from '../patients/deathRules.js';

// The hospital's inpatients today (Version 2): GET /api/inpatients – for doctors, RMOs and nurses, only patients
// whose medical details they may see:
//  - admitted: who is in hospital now (ward, bed, since when, documents still drafts), each with her current red
//    flags – from the nursing chart of the stay, her lab results and her latest visit (worked out when read) – and
//    redFlagsChecked: false when no rule applies to her type of care (her values are then not checked at all);
//    redFlagsWorkupOnly: not checked because her pregnancy-loss record is only for the recurrent-loss work-up;
//  - toConfirm (doctors): delivery, operation and discharge drafts waiting for a doctor – of their own and
//    unassigned patients ("waiting for my confirmation", USE_CASE §3).
// A patient whose record was closed after a death stays on the list while her stay is open (the discharge card ends
// it), marked closed – with her red flags still worked out: a death recorded on the wrong record (a mother and her
// baby in the ward together) must never hide a living patient's flags.
// The list carries recorded values (in the flags), so reading it is audited as INPATIENTS_VIEWED – with counts only
// (how many patients, how many with flags), never a name, a value or a flag, like the worklist.

export const inpatientsRouter = Router();
const ROLES = ['doctor', 'rmo', 'nurse'];
const DOCTOR_KINDS = Object.entries(SIGNED_BY).filter(([, r]) => !r.includes('rmo')).map(([k]) => k);

inpatientsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw new HttpError(403, 'Inpatient lists are for doctors, RMOs and nurses.', 'FORBIDDEN');
  next();
});

inpatientsRouter.get('/', async (req, res) => {
  const data = await inpatientsFor(req);
  await audit(req, 'INPATIENTS_VIEWED', { details: { admitted: data.admitted.length, flagged: data.admitted.filter((s) => s.redFlags.length > 0).length } });
  res.json(data);
});

/**
 * Who is in hospital and the notes waiting for this doctor – also read by the Today page's AI brief
 * (routes/aiBrief.js, which writes its own audit entry). Not audited here.
 */
export async function inpatientsFor(req) {
  const tenantId = req.tenantId;
  const stays = await Admission.find({ tenantId, status: 'admitted' }).sort({ admittedAt: 1 }).limit(500).lean();
  const isDoctor = hasRole(req.membership, 'doctor');
  const drafts = await ClinicalDocument.find({ tenantId, status: 'draft', ...(isDoctor ? {} : { admissionId: { $in: stays.map((s) => s._id) } }) }, { patientId: 1, admissionId: 1, kind: 1, createdAt: 1, createdByName: 1, savedAt: 1, savedByName: 1 })
    .limit(2000)
    .lean();
  const ids = [...new Set([...stays.map((s) => String(s.patientId)), ...drafts.map((d) => String(d.patientId))])];
  const patients = ids.length ? await Patient.find({ tenantId, _id: { $in: ids } }) : [];
  const visible = new Map(patients.filter((p) => patientAccess(req, p).view.has('pregnancy')).map((p) => [String(p._id), p]));
  const doctorIds = [...new Set([...visible.values()].map((p) => p.assignedDoctor && String(p.assignedDoctor)).filter(Boolean))];
  const names = new Map((doctorIds.length ? await User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean() : []).map((u) => [String(u._id), u.name]));
  const who = (p) => ({ id: String(p._id), fullName: p.fullName, mrn: p.mrn, careType: p.careType, assignedDoctorName: p.assignedDoctor ? (names.get(String(p.assignedDoctor)) ?? null) : null, ...(isClosed(p) ? { closed: true } : {}) });

  const shown = stays.filter((s) => visible.has(String(s.patientId)));
  // Red flags of the patients in hospital (only patients whose medical details this person may see are here)
  const flagged = await redFlagsForPatients(planCtx(req), shown.map((s) => visible.get(String(s.patientId))));
  const admitted = shown.map((s) => ({
    patient: who(visible.get(String(s.patientId))),
    admissionId: String(s._id),
    admittedAt: s.admittedAt,
    ward: s.ward ?? '',
    bed: s.bed ?? '',
    drafts: drafts.filter((d) => String(d.admissionId) === String(s._id)).length,
    redFlags: flagged.byPatient.get(String(s.patientId))?.flags ?? [],
    // No rule applies to her type of care: nothing was checked ("no flags" would be read as "nothing wrong")
    redFlagsChecked: !flagged.notChecked.has(String(s.patientId)),
    redFlagsCareType: flagged.careTypes.get(String(s.patientId)) ?? null,
    redFlagsWorkupOnly: flagged.workupOnly.has(String(s.patientId)),
  }));
  const mine = (p) => !p.assignedDoctor || String(p.assignedDoctor) === String(req.user._id);
  const toConfirm = isDoctor
    ? drafts
        .filter((d) => DOCTOR_KINDS.includes(d.kind) && visible.has(String(d.patientId)) && mine(visible.get(String(d.patientId))) && patientAccess(req, visible.get(String(d.patientId))).editClinical)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((d) => ({ patient: who(visible.get(String(d.patientId))), admissionId: String(d.admissionId), documentId: String(d._id), kind: d.kind, writtenBy: d.savedByName ?? d.createdByName, at: d.savedAt ?? d.createdAt }))
    : null;
  return { admitted, toConfirm, rules: flagged.rules };
}
