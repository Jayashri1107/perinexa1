// The starting price list of every hospital (billing): consultations, every lab test the app can order, bed charges
// and common procedures and scans – all at ₹0 for the hospital admin to fill in. `key` links an item to the work
// that adds it automatically (consult_new, consult_follow, lab:<test key>, bed). Items the admin adds have no key.

import { LAB_TESTS, OTHER_TEST } from '../lab/labTests.js';
import { STUDIES } from '../imaging/templates.js';

const item = (key, name, group, extra = {}) => ({ key, name, group, ...extra });

export const BUILT_IN_PRICES = [
  item('consult_new', 'Consultation – new patient', 'consultation'),
  item('consult_follow', 'Consultation – follow-up', 'consultation'),
  // Charges as in a hospital system (owner, 17 Oct 2026 – docs/RECEPTION_V2_PLAN.md). Keyed ones go on the bill by
  // themselves once the hospital admin sets their price (₹0 = not charged): the registration of a new patient, an
  // admission, nursing per day of a stay, a doctor's ward round, each scan ordered.
  item('registration', 'Registration fee (new patient)', 'consultation'),
  item(null, 'Emergency consultation', 'consultation'),
  item('admission', 'Admission charge', 'inpatient'),
  item('nursing', 'Nursing charge per day', 'inpatient'),
  item('ipd_round', 'Doctor visit (ward round)', 'inpatient'),
  item(null, 'Labour room charges', 'inpatient'),
  item(null, 'Operation theatre charges', 'inpatient'),
  item(null, 'Surgeon fee', 'inpatient'),
  item(null, 'Anaesthesia charges', 'inpatient'),
  item(null, 'Baby care / NICU per day', 'inpatient'),
  item(null, 'Oxygen (per hour)', 'inpatient'),
  item(null, 'Diet charges per day', 'inpatient'),
  item(null, 'CTG / foetal monitoring', 'procedure'),
  item(null, 'Consumables', 'other'),
  item(null, 'Ambulance', 'other'),
  item(null, 'Medical certificate', 'other'),
  ...STUDIES.map((s) => item(`scan:${s.key}`, s.name, 'scan')),
  ...LAB_TESTS.map((t) => item(`lab:${t.key}`, t.name, 'lab')),
  item(`lab:${OTHER_TEST}`, 'Other lab test', 'lab'),
  // Bed charges per day: `ward` is matched (ignoring capitals) against the ward written at admission; the general
  // ward's charge is used for any other ward.
  item('bed', 'Bed charge per day – general ward', 'inpatient', { ward: '' }),
  item(null, 'Bed charge per day – private room', 'inpatient', { ward: 'Private' }),
  item(null, 'Normal delivery', 'inpatient'),
  item(null, 'Caesarean section', 'inpatient'),
  item(null, 'Ultrasound – obstetric', 'scan'),
  item(null, 'Ultrasound – pelvis', 'scan'),
  item(null, 'NST (non-stress test)', 'procedure'),
  item(null, 'Dressing', 'procedure'),
  item(null, 'Injection', 'procedure'),
  item(null, 'IUCD insertion', 'procedure'),
  item(null, 'Pap smear collection', 'procedure'),
  item(null, 'Medicines', 'medicine'),
  item(null, 'Other charge', 'other'),
];
