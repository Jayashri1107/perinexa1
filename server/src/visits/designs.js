// A prescriber's print design at a hospital (models/PrescriptionDesign.js): their saved choices, or the
// defaults. Used by the design page (routes/prescriptionDesign.js) and by every visit, so a prescription
// prints in the design of the doctor who wrote it – whoever presses Print.

import { PrescriptionDesign } from '../models/PrescriptionDesign.js';
import { RX_SHOW, RX_TITLES } from './rxCodes.js';

export const DESIGN_FIELDS = ['design', 'accent', 'textSize', 'paper', 'language', 'capitals', 'specialities', 'timings', 'footerNote', 'marginTopMm', 'marginBottomMm', 'font', 'bodyPt', 'medicinePt', 'doctorPt', 'lineSpacing', 'marginSideMm'];

/** The design before a doctor chooses: the classic pad, instructions also in the hospital's second language. */
export const defaultDesign = (tenant) => ({
  design: 'classic',
  accent: 'indigo',
  textSize: 'standard',
  paper: 'A4',
  language: tenant?.letterhead?.consentLanguage ?? 'mr',
  capitals: true,
  show: Object.fromEntries(RX_SHOW.map((k) => [k, true])),
  specialities: '',
  timings: '',
  footerNote: '',
  marginTopMm: 45,
  marginBottomMm: 20,
  font: 'standard',
  bodyPt: null,
  medicinePt: null,
  doctorPt: null,
  lineSpacing: 'standard',
  marginSideMm: null,
  titles: Object.fromEntries(RX_TITLES.map((k) => [k, ''])),
});

/** The design as the website uses it: every field present, and whether the doctor has saved one. */
export function designView(doc, tenant) {
  const base = defaultDesign(tenant);
  if (!doc) return { ...base, saved: false };
  const show = Object.fromEntries(RX_SHOW.map((k) => [k, doc.show?.[k] ?? true]));
  const titles = Object.fromEntries(RX_TITLES.map((k) => [k, doc.titles?.[k] ?? '']));
  return { ...base, ...Object.fromEntries(DESIGN_FIELDS.map((k) => [k, doc[k] ?? base[k]])), show, titles, saved: true };
}

/** The saved design (or the defaults) of one person at this hospital. */
export async function designFor(tenant, userId) {
  if (!userId) return designView(null, tenant);
  return designView(await PrescriptionDesign.findOne({ tenantId: tenant._id, userId }).lean(), tenant);
}
