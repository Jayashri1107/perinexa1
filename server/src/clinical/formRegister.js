// Form versions and the document register (Clinical Requirements Group C – PX-X-02), and printing as the manual's
// page (PX-X-03). The screens of Perinexa that stand in for a controlled form of the hospital's quality manual. Each
// hospital records the manual's code, title and version for each screen in its register; a doctor approves a version.
// A printout carries the code, title and version that were in force on the record's day.
// DRAFT – the codes shown are only the ones named in the requirements document; the rest are given by the hospital.

export const FORM_REGISTER_SOURCE = 'DRAFT – Perinexa screens that stand in for the manual’s forms (PX-X-02); codes from the hospital’s quality manual';

export const FORM_SCREENS = {
  who_checklist: { label: 'WHO Surgical Safety Checklist (theatre case)', code: 'OBG-F-16' },
  meows: { label: 'MEOWS chart', code: 'OBG-F-05' },
  pph_chart: { label: 'PPH chart', code: '' },
  discharge_checklist: { label: 'Postnatal discharge checklist', code: '' },
  pac: { label: 'Pre-anaesthetic check', code: '' },
  pain_chart: { label: 'Pain chart', code: '' },
  newborn_birth: { label: 'Newborn – record at birth', code: '' },
  newborn_exam: { label: 'Newborn examination', code: '' },
  nicu_register: { label: 'NICU / SNCU register', code: 'NEO-L-05' },
  nicu_admission: { label: 'NICU admission', code: 'NEO-F-03' }, // Build 13
  case_review: { label: 'Maternal death and near-miss review', code: '' },
  incident: { label: 'Incident report', code: '' },
  specimen: { label: 'Specimen log', code: '' },
};
export const FORM_SCREEN_KEYS = Object.keys(FORM_SCREENS);
