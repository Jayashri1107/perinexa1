// Wards and beds: the hospital admin keeps them; whoever admits patients sees which beds are free (owner, 8 Oct 2026).
// A hospital with no wards gets the starting wards of config.wards.starting (sample bed counts) the first time.
import { config } from '../../config/index.js';
import { HttpError, fieldError, notFoundError } from '../../core/httpError.js';
import { toObjectId } from '../../core/validate.js';
import { Admission } from '../admissions/admission.model.js';
import { recordAudit } from '../audit/audit.service.js';
import { Patient } from '../patients/patient.model.js';
import { Ward } from './ward.model.js';

const bedsOf = (prefix, count) => Array.from({ length: count }, (_, i) => ({ label: `${prefix}${i + 1}`, isActive: true }));

async function ensureStartingWards(hospitalId) {
  if (await Ward.exists({ hospitalId })) return;
  const rows = config.wards.starting.map((w, i) => ({ hospitalId, name: w.name, kind: w.kind, beds: bedsOf(w.bedPrefix, w.beds), sortOrder: i }));
  await Ward.insertMany(rows, { ordered: false }).catch((err) => {
    if (err.code !== 11000 && !err.writeErrors?.every((e) => e.code === 11000)) throw err;
  });
}

const wardView = (w) => ({ id: String(w._id), name: w.name, kind: w.kind, beds: w.beds.map((b) => ({ label: b.label, isActive: b.isActive })), isActive: w.isActive });

/** Every ward (for the hospital admin), active or not. */
export async function listWards(hospitalId) {
  await ensureStartingWards(hospitalId);
  const wards = await Ward.find({ hospitalId }).sort({ sortOrder: 1, name: 1 }).lean();
  return { items: wards.map(wardView), kinds: config.wards.kinds };
}

/**
 * The active wards with each bed free or booked, for admitting a patient or moving her. Booked beds name the patient
 * (name and number only) for those who admit. exceptStayId: her own stay (when moving her, her bed counts as free).
 */
export async function availability(req, { exceptStayId = null } = {}) {
  const hospitalId = toObjectId(req.hospitalId);
  await ensureStartingWards(hospitalId);
  const [wards, stays] = await Promise.all([
    Ward.find({ hospitalId, isActive: true }).sort({ sortOrder: 1, name: 1 }).lean(),
    Admission.find({ hospitalId, status: 'admitted', wardId: { $ne: null } }).select('wardId bed patientId').lean(),
  ]);
  const others = stays.filter((s) => String(s._id) !== String(exceptStayId));
  const patients = await Patient.find({ hospitalId, _id: { $in: others.map((s) => s.patientId) } }).select('name patientNumber').lean();
  const pById = new Map(patients.map((p) => [String(p._id), p]));
  const booked = new Map(others.map((s) => [`${s.wardId}|${s.bed}`, pById.get(String(s.patientId))]));
  return {
    items: wards.map((w) => {
      const beds = w.beds
        .filter((b) => b.isActive)
        .map((b) => {
          const p = booked.get(`${w._id}|${b.label}`);
          return { label: b.label, booked: booked.has(`${w._id}|${b.label}`), patient: p ? { id: String(p._id), name: p.name, patientNumber: p.patientNumber } : null };
        });
      return { id: String(w._id), name: w.name, kind: w.kind, beds, total: beds.length, free: beds.filter((b) => !b.booked).length };
    }),
    kinds: config.wards.kinds,
  };
}

/** Checks a ward and bed for a stay: the ward is active, the bed is one of its beds in use, and nobody else is in it. */
export async function assertFreeBed(hospitalId, wardId, bed, exceptStayId = null) {
  const ward = await Ward.findOne({ hospitalId, _id: wardId, isActive: true }).lean();
  if (!ward) throw fieldError('wardId', 'Choose a ward of this hospital.');
  if (!ward.beds.some((b) => b.isActive && b.label === bed)) throw fieldError('bed', `Choose a bed of ${ward.name}.`);
  const taken = await Admission.findOne({ hospitalId, status: 'admitted', wardId, bed, ...(exceptStayId && { _id: { $ne: exceptStayId } }) }).lean();
  if (taken) throw new HttpError(409, `Bed ${bed} of ${ward.name} is already booked. Choose a free bed.`, 'BED_TAKEN', { bed: 'This bed is booked.' });
  return ward;
}

// ---------- The hospital admin keeps the wards ----------

function cleanBeds(beds) {
  const seen = new Set();
  for (const b of beds) {
    if (seen.has(b.label)) throw fieldError('beds', `Bed ${b.label} is listed twice.`);
    seen.add(b.label);
  }
  return beds;
}

export async function createWard(req, { name, kind, bedCount, bedPrefix }) {
  const count = await Ward.countDocuments({ hospitalId: req.hospitalId });
  const ward = await Ward.create({ hospitalId: req.hospitalId, name, kind, beds: bedsOf(bedPrefix, bedCount), sortOrder: count }).catch((err) => {
    if (err.code === 11000) throw fieldError('name', 'There is already a ward with this name.');
    throw err;
  });
  await recordAudit(req, 'WARD_CREATED', { hospitalId: req.hospitalId, details: { wardId: String(ward._id), beds: bedCount } });
  return { ward: wardView(ward) };
}

export async function updateWard(req, id, { name, kind, beds, isActive }) {
  const ward = await Ward.findOne({ hospitalId: req.hospitalId, _id: id });
  if (!ward) throw notFoundError('Ward');
  // A bed (or the ward) with a patient in it stays in use.
  const occupied = new Set((await Admission.find({ hospitalId: req.hospitalId, status: 'admitted', wardId: ward._id }).select('bed').lean()).map((s) => s.bed));
  if (isActive === false && occupied.size) throw new HttpError(409, 'Patients are in this ward. Move them before taking it out of use.', 'WARD_IN_USE');
  if (beds) {
    for (const label of occupied) {
      if (!beds.some((b) => b.label === label && b.isActive)) throw fieldError('beds', `Bed ${label} has a patient in it: keep it in use.`);
    }
    // a bed is never removed: one left out is kept, taken out of use
    const kept = ward.beds.filter((b) => !beds.some((x) => x.label === b.label)).map((b) => ({ label: b.label, isActive: false }));
    ward.beds = cleanBeds([...beds, ...kept]);
  }
  ward.set({ ...(name !== undefined && { name }), ...(kind !== undefined && { kind }), ...(isActive !== undefined && { isActive }) });
  await ward.save().catch((err) => {
    if (err.code === 11000) throw fieldError('name', 'There is already a ward with this name.');
    throw err;
  });
  await recordAudit(req, 'WARD_UPDATED', { hospitalId: req.hospitalId, details: { wardId: id, beds: ward.beds.filter((b) => b.isActive).length, isActive: ward.isActive } });
  return { ward: wardView(ward) };
}
