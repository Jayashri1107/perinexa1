import { Router } from 'express';
import { z } from 'zod';
import { INCIDENT_KINDS, INCIDENT_SOURCE, SEVERITIES } from '../incidents/incidentKinds.js';
import { nextNumber } from '../models/Counter.js';
import { Incident } from '../models/Incident.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { departmentListed } from '../utils/patientAccess.js';
import { safeText } from '../utils/pcpndt.js';
import { objectId, parse } from '../utils/validate.js';

// Incident reporting (Clinical Requirements Group A, item 6 – PX-X-10): /api/incidents.
//  - anyone working in the hospital reports an incident and sees the ones they reported (and how far they are);
//  - the quality lead sees every incident, reviews it (findings, causes, the degree of harm), records actions and
//    marks them done, and closes it once every action is done;
//  - the hospital admin sees every incident without the patient it names (an admin sees no patient data).
// Kept out of the patient's record and of the copy of her record: nothing here is shown there (PX-X-12).
// The audit log gets ids, the kind and the step – never the description.

export const incidentsRouter = Router();
const LEAD = 'quality';
const forbidden = (m) => new HttpError(403, m, 'FORBIDDEN');
const conflict = (m) => new HttpError(409, m, 'CONFLICT');
const notFound = () => new HttpError(404, 'This incident was not found.', 'NOT_FOUND');
const invalid = (fields) => Object.assign(new HttpError(400, 'Please check the highlighted fields.', 'VALIDATION'), { fields });
const required = (label, max) => safeText(label, max).refine((v) => v.length > 0, `Write the ${label.toLowerCase()}`);
const isLead = (req) => hasRole(req.membership, LEAD);
const seesAll = (req) => isLead(req) || hasRole(req.membership, 'admin');
const seesPatient = (req) => isLead(req);
// The fields the department rule needs (utils/patientAccess.js) – a lead who is also a doctor sees only the patients
// of her departments named (departments, 9 Nov 2026)
const DEPT = { assignedDoctor: 1, department: 1, departmentReferrals: 1, babyDepartments: 1 };
const named = (req, p) => (p && departmentListed(req, p) ? p : null);
const stamp = (req) => ({ by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });

function view(i, req, patient) {
  const mine = i.reported?.by && String(i.reported.by) === String(req.user._id);
  const lead = seesAll(req);
  return {
    id: String(i._id),
    serial: i.serial,
    occurredAt: i.occurredAt,
    place: i.place,
    kind: i.kind,
    severity: i.review?.severity ?? i.severity,
    reportedSeverity: i.severity,
    description: i.description,
    immediateAction: i.immediateAction,
    automatic: Boolean(i.automatic),
    reported: { byName: i.reported.byName, at: i.reported.at, mine: Boolean(mine) },
    status: i.status,
    ...(seesPatient(req) && patient ? { patient: { id: String(patient._id), fullName: patient.fullName, mrn: patient.mrn } } : {}),
    ...(lead
      ? {
          review: i.review ? { findings: i.review.findings, causes: i.review.causes, severity: i.review.severity, byName: i.review.byName, at: i.review.at } : null,
          actions: i.actions.map((a) => ({ id: String(a._id), text: a.text, owner: a.owner, dueOn: a.dueOn, byName: a.byName, at: a.at, done: a.done ? { note: a.done.note, byName: a.done.byName, at: a.done.at } : null })),
          closure: i.closure ? { summary: i.closure.summary, byName: i.closure.byName, at: i.closure.at } : null,
        }
      : { actionsOpen: i.actions.filter((a) => !a.done).length }),
  };
}

const listQuery = z.object({ show: z.enum(['open', 'closed', 'all', 'mine']).default('open') }).strict();
incidentsRouter.get('/', async (req, res) => {
  let { show } = parse(listQuery, req.query);
  if (!seesAll(req)) show = 'mine';
  const filter = { tenantId: req.tenantId };
  if (show === 'mine') filter['reported.by'] = req.user._id;
  if (show === 'open') filter.status = { $ne: 'closed' };
  if (show === 'closed') filter.status = 'closed';
  const items = await Incident.find(filter).sort({ occurredAt: -1, _id: -1 }).limit(500);
  const patients = seesPatient(req) ? await Patient.find({ tenantId: req.tenantId, _id: { $in: items.map((i) => i.patientId).filter(Boolean) } }, { fullName: 1, mrn: 1, ...DEPT }).lean() : [];
  const byId = new Map(patients.filter((p) => named(req, p)).map((p) => [String(p._id), p]));
  await audit(req, 'INCIDENTS_VIEWED', { details: { show, count: items.length } });
  res.json({ incidents: items.map((i) => view(i, req, byId.get(String(i.patientId)))), lead: isLead(req), kinds: INCIDENT_KINDS, severities: SEVERITIES, source: INCIDENT_SOURCE });
});

const reportBody = z
  .object({
    clientRequestId: z.uuid('Please reload the page and try again'),
    occurredAt: z.iso.datetime('Please enter a valid date and time').transform((v) => new Date(v)),
    place: safeText('Place', 150).default(''),
    kind: z.enum(Object.keys(INCIDENT_KINDS), 'Choose the kind of incident'),
    severity: z.enum(Object.keys(SEVERITIES), 'Choose the degree of harm'),
    description: required('Description', 4000),
    immediateAction: safeText('Immediate action', 2000).default(''),
    patientNo: safeText('Patient number', 30).default(''),
  })
  .strict();
incidentsRouter.post('/', async (req, res) => {
  const b = parse(reportBody, req.body);
  const same = await Incident.findOne({ tenantId: req.tenantId, clientRequestId: b.clientRequestId });
  if (same) return res.status(200).json({ incident: view(same, req) });
  const now = req.now ?? new Date();
  if (b.occurredAt.getTime() > now.getTime() + 5 * 60 * 1000) throw invalid({ occurredAt: "This can't be in the future." });
  // The patient it concerns, by her number (optional): only the number is asked, so no one searches records from here
  let patientId = null;
  if (b.patientNo) {
    const p = named(req, await Patient.findOne({ tenantId: req.tenantId, mrn: b.patientNo.toUpperCase() }, { _id: 1, ...DEPT }).lean()); // departments, 9 Nov 2026
    if (!p) throw invalid({ patientNo: 'No patient with this number in this hospital.' });
    patientId = p._id;
  }
  const { patientNo: _n, ...fields } = b;
  const i = await Incident.create({ ...fields, tenantId: req.tenantId, serial: await nextNumber(req.tenantId, 'incident'), patientId, reported: stamp(req) });
  await audit(req, 'INCIDENT_REPORTED', { details: { incidentId: String(i._id), serial: i.serial, kind: i.kind } });
  res.status(201).json({ incident: view(i, req) });
});

async function loadOne(req) {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const i = await Incident.findOne({ _id: id, tenantId: req.tenantId });
  if (!i) throw notFound();
  const mine = i.reported?.by && String(i.reported.by) === String(req.user._id);
  if (!seesAll(req) && !mine) throw notFound();
  return i;
}
async function answer(req, res, i, action) {
  if (action) await audit(req, action, { details: { incidentId: String(i._id), serial: i.serial, kind: i.kind } });
  const patient = seesPatient(req) && i.patientId ? named(req, await Patient.findOne({ _id: i.patientId, tenantId: req.tenantId }, { fullName: 1, mrn: 1, ...DEPT }).lean()) : null;
  res.json({ incident: view(i, req, patient) });
}
const leadOnly = (req) => {
  if (!isLead(req)) throw forbidden('Incidents are reviewed and closed by the quality lead.');
};

incidentsRouter.get('/:id', async (req, res) => answer(req, res, await loadOne(req), 'INCIDENT_VIEWED'));

// The lead's review: what was found, why it happened, the degree of harm (may differ from the report)
incidentsRouter.post('/:id/review', async (req, res) => {
  leadOnly(req);
  const i = await loadOne(req);
  const b = parse(z.object({ findings: required('Findings', 4000), causes: safeText('Causes', 2000).default(''), severity: z.enum(Object.keys(SEVERITIES), 'Choose the degree of harm') }).strict(), req.body);
  if (i.status === 'closed') throw conflict('This incident is closed.');
  i.review = { ...b, ...stamp(req) };
  i.status = 'reviewed';
  await i.save();
  await answer(req, res, i, 'INCIDENT_REVIEWED');
});

incidentsRouter.post('/:id/actions', async (req, res) => {
  leadOnly(req);
  const i = await loadOne(req);
  const b = parse(z.object({ text: required('Action', 1000), owner: safeText('Who', 150).default(''), dueOn: z.union([z.iso.date().transform((d) => new Date(`${d}T00:00:00Z`)), z.null()]).default(null) }).strict(), req.body);
  if (i.status === 'closed') throw conflict('This incident is closed.');
  i.actions.push({ ...b, ...stamp(req) });
  await i.save();
  await answer(req, res, i, 'INCIDENT_ACTION_ADDED');
});

incidentsRouter.post('/:id/actions/:actionId/done', async (req, res) => {
  leadOnly(req);
  const i = await loadOne(req);
  const { actionId } = parse(z.object({ id: objectId, actionId: objectId }), req.params);
  const b = parse(z.object({ note: safeText('Note', 1000).default('') }).strict(), req.body);
  const a = i.actions.id(actionId);
  if (!a) throw notFound();
  if (a.done) throw conflict(`Already marked done by ${a.done.byName}.`);
  a.done = { ...b, ...stamp(req) };
  await i.save();
  await answer(req, res, i, 'INCIDENT_ACTION_DONE');
});

incidentsRouter.post('/:id/close', async (req, res) => {
  leadOnly(req);
  const i = await loadOne(req);
  const b = parse(z.object({ summary: required('Summary', 2000) }).strict(), req.body);
  if (i.status === 'closed') throw conflict('Already closed.');
  if (!i.review) throw invalid({ summary: 'Review the incident before closing it.' });
  if (i.actions.some((a) => !a.done)) throw invalid({ summary: 'Every action must be done before the incident is closed.' });
  i.closure = { ...b, ...stamp(req) };
  i.status = 'closed';
  await i.save();
  await answer(req, res, i, 'INCIDENT_CLOSED');
});
