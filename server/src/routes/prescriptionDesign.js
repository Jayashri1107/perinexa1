import { Router } from 'express';
import { z } from 'zod';
import { hasRole } from '../models/Membership.js';
import { PrescriptionDesign } from '../models/PrescriptionDesign.js';
import { Visit } from '../models/Visit.js';
import { HttpError } from '../utils/httpError.js';
import { parse } from '../utils/validate.js';
import { DESIGN_FIELDS, designFor, designView } from '../visits/designs.js';
import { RX_ACCENTS, RX_DESIGNS, RX_FONTS, RX_LINE_SPACINGS, RX_SHOW, RX_TITLES } from '../visits/rxCodes.js';

// /api/prescription-design: the logged-in doctor's (or RMO's) own print design at this hospital, and the
// medicines they prescribed most (for quick entry). Only people who write prescriptions.

const PRESCRIBERS = ['doctor', 'rmo'];
const words = (label, max) => z.string().trim().max(max, `${label} is too long (at most ${max} characters)`).default('');

// A size or margin left empty (null) prints as the design does.
const optional = (label, min, max, unit) =>
  z.number('Enter a number').min(min, `${label}: at least ${min} ${unit}`).max(max, `${label}: at most ${max} ${unit}`).nullable().default(null);

const designSchema = z
  .object({
    design: z.enum(RX_DESIGNS, 'Choose a design'),
    accent: z.enum(RX_ACCENTS, 'Choose a colour'),
    textSize: z.enum(['standard', 'large'], 'Choose a text size'),
    paper: z.enum(['A4', 'A5'], 'Choose the paper size'),
    language: z.enum(['en', 'mr', 'hi'], 'Choose the language of the instructions'),
    capitals: z.boolean(),
    show: z.object(Object.fromEntries(RX_SHOW.map((k) => [k, z.boolean()]))).strict(),
    specialities: words('Specialities', 200),
    timings: words('Timings', 200),
    footerNote: words('Footer note', 200),
    marginTopMm: z.number('Enter a number').int('Whole millimetres only').min(0, 'At least 0').max(120, 'At most 120 mm'),
    marginBottomMm: z.number('Enter a number').int('Whole millimetres only').min(0, 'At least 0').max(80, 'At most 80 mm'),
    font: z.enum(RX_FONTS, 'Choose a font').default('standard'),
    bodyPt: optional('Text size', 8, 16, 'pt'),
    medicinePt: optional('Medicine name size', 8, 20, 'pt'),
    doctorPt: optional("Doctor's name size", 10, 30, 'pt'),
    lineSpacing: z.enum(RX_LINE_SPACINGS, 'Choose the line spacing').default('standard'),
    marginSideMm: optional('Side margins', 0, 40, 'mm').refine((v) => v === null || Number.isInteger(v), 'Whole millimetres only'),
    titles: z
      .object(Object.fromEntries(RX_TITLES.map((k) => [k, words('A section title', 40)])))
      .strict()
      .default(() => Object.fromEntries(RX_TITLES.map((k) => [k, '']))),
  })
  .strict();

export const prescriptionDesignRouter = Router();

prescriptionDesignRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...PRESCRIBERS)) throw new HttpError(403, 'Prescription designs are for doctors and RMOs.', 'FORBIDDEN');
  next();
});

prescriptionDesignRouter.get('/', async (req, res) => {
  res.json({ design: await designFor(req.tenant, req.user._id) });
});

prescriptionDesignRouter.put('/', async (req, res) => {
  const data = parse(designSchema, req.body);
  // The half-page design is always A5.
  if (data.design === 'half_page') data.paper = 'A5';
  const save = () =>
    PrescriptionDesign.findOneAndUpdate(
      { tenantId: req.tenantId, userId: req.user._id },
      { $set: Object.fromEntries([...DESIGN_FIELDS, 'show', 'titles'].map((k) => [k, data[k]])) },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true, lean: true },
    );
  // Two first saves at the same moment: the second one finds the first and updates it.
  const saved = await save().catch((e) => (e?.code === 11000 ? save() : Promise.reject(e)));
  res.json({ design: designView(saved, req.tenant) });
});

// The medicines this person prescribed most at this hospital (from their latest 200 prescriptions), each with
// the way they last wrote it – offered first when they type a medicine. Medicine words only: no patients.
prescriptionDesignRouter.get('/recent-medicines', async (req, res) => {
  const rows = await Visit.aggregate([
    { $match: { tenantId: req.tenantId, 'prescription.by': req.user._id, status: 'active' } },
    { $sort: { 'prescription.at': -1, _id: -1 } },
    { $limit: 200 },
    { $unwind: '$prescription.items' },
    { $group: { _id: { $toLower: '$prescription.items.drug' }, last: { $first: '$prescription.items' }, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 100 },
  ]);
  const FIELDS = ['drug', 'form', 'strength', 'dose', 'frequency', 'frequencyText', 'timing', 'route', 'durationValue', 'durationUnit', 'instructions'];
  res.json({ medicines: rows.map((r) => ({ ...Object.fromEntries(FIELDS.map((k) => [k, r.last[k] ?? (k === 'durationValue' ? null : '')])), count: r.count })) });
});
