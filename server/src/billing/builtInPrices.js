// The starting price list of every hospital (billing): consultations, every lab test the app can order, bed charges
// and common procedures and scans – all at ₹0 for the hospital admin to fill in. `key` links an item to the work
// that adds it automatically (consult_new, consult_follow, lab:<test key>, bed). Items the admin adds have no key.

import { LAB_TESTS, OTHER_TEST } from '../lab/labTests.js';

const item = (key, name, group, extra = {}) => ({ key, name, group, ...extra });

export const BUILT_IN_PRICES = [
  item('consult_new', 'Consultation – new patient', 'consultation'),
  item('consult_follow', 'Consultation – follow-up', 'consultation'),
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
