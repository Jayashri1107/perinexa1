import { Router } from 'express';
import { Patient } from '../models/Patient.js';
import { Visit } from '../models/Visit.js';
import { VisitDraft } from '../models/VisitDraft.js';
import { patientAccess } from '../utils/patientAccess.js';

// "Continue Mrs ___'s visit" on Today (doctor ideas #4, 16 Oct 2026): the signed-in person's own unsaved visit typing
// in this hospital, newest first – only for visits that can still be written, and only patients they may see.

export const visitDraftsRouter = Router(); // /api/visit-drafts

visitDraftsRouter.get('/', async (req, res) => {
  const drafts = await VisitDraft.find({ tenantId: req.tenantId, userId: req.user._id }).sort({ updatedAt: -1 }).limit(10).lean();
  const [visits, patients] = await Promise.all([
    Visit.find({ tenantId: req.tenantId, _id: { $in: drafts.map((d) => d.visitId) } }, { status: 1, signed: 1, visitOn: 1 }).lean(),
    Patient.find({ tenantId: req.tenantId, _id: { $in: drafts.map((d) => d.patientId) } }),
  ]);
  const visitOf = new Map(visits.map((v) => [String(v._id), v]));
  const patientOf = new Map(patients.map((p) => [String(p._id), p]));
  const out = [];
  for (const d of drafts) {
    const v = visitOf.get(String(d.visitId));
    const p = patientOf.get(String(d.patientId));
    if (!v || v.status !== 'active' || v.signed || !p || !patientAccess(req, p).view.has('fullName')) continue;
    out.push({ visitId: String(v._id), visitOn: v.visitOn, patient: { id: String(p._id), fullName: p.fullName, mrn: p.mrn }, parts: ['details', 'rx'].filter((k) => d[k]), savedAt: d.updatedAt });
  }
  res.json({ drafts: out });
});
