// Opening stock (29 Oct 2026, the owner's exception to the feature freeze): the stock already on the pharmacy's shelves
// when it starts with Perinexa, loaded once from the old pharmacy software's stock list (an Excel file, read in the
// browser – client/src/pages/pharmacy/stockFile.js – so the file itself never reaches the server).
//
// Each line is one batch. Medicines are matched by name (capitals, spaces and a final full stop ignored); a name not
// on the medicine list yet becomes a new medicine. Nothing is saved while any line has a problem: the pharmacist
// corrects the file and checks again. The stock comes in as an 'opening' stock move – not a purchase, so it stays out
// of purchase GST, the accountant's export and Tally – and the X and narcotic registers start from it.

import { z } from 'zod';
import { Medicine, StockBatch, StockMove } from '../models/Pharmacy.js';
import { HttpError } from '../utils/httpError.js';
import { endOfMonth, isExpired, moveStock } from './pharmacyService.js';
import { DEFAULT_GST_RATE, FORMS, GST_RATES, MAX_PAISE, MAX_QTY, OLD_GST_RATES, SCHEDULES } from './pharmacyRules.js';

export const MAX_OPENING_LINES = 5000;

// What the browser sends for a line: the file's values, read but not yet judged (a value it could not read is sent
// as it was, and is reported here).
const cell = z.union([z.string().max(200), z.number(), z.null()]).optional();
export const openingSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            row: z.number().int().min(1), // the line's row in the file, for the problems list
            name: cell,
            batch: cell,
            expiry: cell, // 'YYYY-MM' when the browser could read it
            qty: cell,
            mrpPaise: cell,
            ratePaise: cell,
            gstRate: cell,
            hsn: cell,
            schedule: cell,
            form: cell,
            unit: cell,
          })
          .strict(),
      )
      .min(1, 'The file has no stock lines.')
      .max(MAX_OPENING_LINES, `At most ${MAX_OPENING_LINES} lines at a time: split the file.`),
  })
  .strict();

const str = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
/** A medicine's name as it is compared: capitals, spaces and a final full stop ignored. */
export const nameKey = (name) => str(name).toLowerCase().replace(/\.+$/, '').trim();

// Schedule as old pharmacy software writes it.
const SCHEDULE_WORDS = { '': '', '-': '', none: '', otc: '', nil: '', g: 'G', h: 'H', h1: 'H1', x: 'X', narcotic: 'narcotic', ndps: 'narcotic', n: 'narcotic', nrx: 'narcotic' };
export function readSchedule(v) {
  const k = str(v).toLowerCase().replace(/^sch(edule)?\.?\s*/, '').replace(/\s+/g, '');
  return k in SCHEDULE_WORDS ? SCHEDULE_WORDS[k] : null;
}

// The form from a form column, or else from the medicine's name ("ACILOC 2ML INJ", "ZIFI 200 TAB").
const FORM_WORDS = [
  ['tablet', /\b(tab|tabs|tablet|tablets|dt)\b/],
  ['capsule', /\b(cap|caps|capsule|capsules)\b/],
  ['syrup', /\b(syp|syr|syrup|dry syrup)\b/],
  ['suspension', /\b(susp|suspension)\b/],
  ['drops', /\b(drop|drops|gtt)\b/],
  ['infusion', /\b(iv|infusion)\b/],
  ['injection', /\b(inj|injection|vial|amp|ampoule)\b/],
  ['ointment', /\b(oint|ointment)\b/],
  ['cream', /\bcream\b/],
  ['gel', /\bgel\b/],
  ['sachet', /\b(sachet|sachets|sach)\b/],
  ['inhaler', /\b(inhaler|rotacap|rotacaps)\b/],
  ['pessary', /\b(pessary|vag tab)\b/],
  ['suppository', /\b(supp|suppository)\b/],
];
export function readForm(formText, name) {
  const f = str(formText).toLowerCase();
  if (f && FORMS.includes(f)) return f;
  for (const text of [f, str(name).toLowerCase()]) {
    if (!text) continue;
    const hit = FORM_WORDS.find(([, rx]) => rx.test(text));
    if (hit) return hit[0];
  }
  return 'other';
}
const UNIT_OF = { tablet: 'tablet', capsule: 'capsule', syrup: 'bottle', suspension: 'bottle', drops: 'bottle', injection: 'vial', infusion: 'bottle', cream: 'tube', ointment: 'tube', gel: 'tube', sachet: 'sachet', inhaler: 'inhaler', pessary: 'pessary', suppository: 'suppository', other: 'piece' };

const whole = (v) => (typeof v === 'number' ? v : str(v) === '' ? null : Number(str(v)));

/** One line judged: what it will become, and its problems (nothing is saved while any line has one). */
function judge(raw, medicines, today) {
  const problems = [];
  const notes = [];
  const name = str(raw.name);
  const batch = str(raw.batch);
  const expiry = str(raw.expiry);
  const qty = whole(raw.qty);
  const mrpPaise = whole(raw.mrpPaise);
  const ratePaise = whole(raw.ratePaise);
  // A line with no stock is left out whatever else it lacks (old software lists every item it ever stocked).
  if (qty === 0) return { row: raw.row, name, batch, expiry: '', qty: 0, mrpPaise, ratePaise, expired: false, medicine: { id: null, name, isNew: false }, problems: [], notes: ['No stock: left out.'], skip: true };
  if (name.length < 2 || name.length > 120) problems.push(name ? 'The name is too long (at most 120 letters).' : 'The medicine name is missing.');
  if (!batch) problems.push('The batch number is missing.');
  else if (batch.length > 40) problems.push('The batch number is too long.');
  const goodExpiry = /^\d{4}-(0[1-9]|1[0-2])$/.test(expiry);
  if (!goodExpiry) problems.push(expiry ? `The expiry “${expiry}” could not be read (use 30/06/2029 or 06/2029).` : 'The expiry date is missing.');
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) problems.push(qty == null || Number.isNaN(qty) ? 'The quantity is missing.' : `The quantity ${raw.qty} is not a whole number of units.`);
  if (!Number.isInteger(mrpPaise) || mrpPaise < 1 || mrpPaise > MAX_PAISE) problems.push('The MRP is missing.');
  if (!Number.isInteger(ratePaise) || ratePaise < 0 || ratePaise > MAX_PAISE) problems.push('The purchase rate is missing.');
  else if (Number.isInteger(mrpPaise) && ratePaise > mrpPaise) problems.push('The purchase rate is above the MRP.');

  const existing = name ? medicines.get(nameKey(name)) : null;
  let medicine;
  if (existing) {
    if (!existing.active) problems.push(`${existing.name} is stopped on the medicine list: start using it again first (Pharmacy → Medicines).`);
    medicine = { id: String(existing._id), name: existing.name, form: existing.form, unit: existing.unit, gstRate: existing.gstRate, schedule: existing.schedule, hsn: existing.hsn, isNew: false };
  } else {
    const gst = whole(raw.gstRate);
    let gstRate = DEFAULT_GST_RATE;
    if (gst == null) notes.push(`GST not given: ${DEFAULT_GST_RATE} %.`);
    else if (OLD_GST_RATES.includes(gst)) problems.push(`GST ${gst} % is no longer used since 22 September 2025: medicines are 5 %, other items 18 %.`);
    else if (!GST_RATES.includes(gst)) problems.push(`GST ${raw.gstRate} % is not a GST rate (${GST_RATES.join(', ')} %).`);
    else gstRate = gst;
    const hsn = str(raw.hsn).replace(/\s+/g, '');
    if (hsn && !/^(\d{4}|\d{6}|\d{8})$/.test(hsn)) problems.push(`The HSN code “${hsn}” should have 4, 6 or 8 digits.`);
    const schedule = readSchedule(raw.schedule);
    if (schedule == null) problems.push(`The schedule “${str(raw.schedule)}” is not one of none, G, H, H1, X or narcotic.`);
    else if (!str(raw.schedule)) notes.push('Schedule not given: set it in Pharmacy → Medicines for H, H1, X and narcotic medicines.');
    const form = readForm(raw.form, name);
    const unit = str(raw.unit).slice(0, 30) || UNIT_OF[form];
    medicine = { id: null, name, form, unit, gstRate, schedule: schedule ?? '', hsn: /^(\d{4}|\d{6}|\d{8})$/.test(hsn) ? hsn : '', isNew: true };
  }
  const expired = goodExpiry && isExpired({ expiry: endOfMonth(expiry) }, today);
  if (expired) notes.push('Expired: it comes in as stock to write off or return.');
  return { row: raw.row, name, batch, expiry: goodExpiry ? expiry : '', qty: Number.isInteger(qty) ? qty : null, mrpPaise, ratePaise, expired, medicine, problems, notes, skip: false };
}

/** Every line judged, and the sums: what Check shows, and what Import saves when there are no problems. */
export async function checkOpening(req, lines, today) {
  const list = await Medicine.find({ tenantId: req.tenantId }, { name: 1, form: 1, unit: 1, gstRate: 1, schedule: 1, hsn: 1, active: 1 }).lean();
  const medicines = new Map(list.map((m) => [nameKey(m.name), m]));
  const judged = lines.map((l) => judge(l, medicines, today));
  // A new medicine named on several lines is made once, as its first line describes it.
  const first = new Map();
  for (const l of judged) {
    if (!l.medicine.isNew || !l.name) continue;
    const k = nameKey(l.name);
    if (!first.has(k)) first.set(k, l.medicine);
    else l.medicine = first.get(k);
  }
  const counted = judged.filter((l) => !l.skip && !l.problems.length);
  const before = await StockMove.findOne({ tenantId: req.tenantId, kind: 'opening' }, { at: 1 }).sort({ at: -1 }).lean();
  return {
    lines: judged,
    summary: {
      lines: judged.length,
      problems: judged.filter((l) => l.problems.length).length,
      skipped: judged.filter((l) => l.skip && !l.problems.length).length,
      batches: counted.length,
      newMedicines: new Set(counted.filter((l) => l.medicine.isNew).map((l) => nameKey(l.name))).size,
      units: counted.reduce((s, l) => s + l.qty, 0),
      mrpValuePaise: counted.reduce((s, l) => s + l.qty * l.mrpPaise, 0),
      costValuePaise: counted.reduce((s, l) => s + l.qty * l.ratePaise, 0),
      expired: counted.filter((l) => l.expired).length,
      importedBefore: before?.at ?? null,
    },
  };
}

/** Saves the opening stock: the new medicines, then each batch with its 'opening' stock move. */
export async function saveOpening(req, lines, today) {
  const checked = await checkOpening(req, lines, today);
  if (checked.summary.problems) throw new HttpError(400, `${checked.summary.problems} lines have problems: correct the file and check it again. Nothing was saved.`, 'VALIDATION');
  if (!checked.summary.batches) throw new HttpError(400, 'The file has no stock to bring in.', 'VALIDATION');
  const made = new Map(); // name key → medicine id
  const todo = checked.lines.filter((l) => !l.skip);
  for (const l of todo) {
    if (!l.medicine.isNew || made.has(nameKey(l.name))) continue;
    const { name, form, unit, gstRate, schedule, hsn } = l.medicine;
    const m = await Medicine.create({ tenantId: req.tenantId, name, form, unit, gstRate, schedule, hsn, updatedByName: req.user.name });
    made.set(nameKey(l.name), m._id);
  }
  for (const l of todo) {
    const medicineId = l.medicine.isNew ? made.get(nameKey(l.name)) : l.medicine.id;
    const batch = await StockBatch.create({ tenantId: req.tenantId, medicineId, batch: l.batch, expiry: endOfMonth(l.expiry), mrpPaise: l.mrpPaise, costPaise: l.ratePaise, qtyIn: l.qty, qtyLeft: 0 });
    await moveStock(req, batch, l.qty, { kind: 'opening', reason: 'Opening stock' });
  }
  return { ...checked.summary, medicinesAdded: made.size };
}
