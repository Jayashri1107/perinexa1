// PH10 (docs/PHARMACY_BUILD_NOTE.md, owner's decision 3): another brand of the same medicine only with a doctor's yes
// – the pharmacist asks and writes which doctor agreed – and never for a medicine on the doctors' "never substitute"
// list. "The same medicine" is the strict matcher's (stockMatch.js): same generic name, every amount the same, the
// same kind of form, no extra ingredient. A medicine without a generic name is never offered and never substituted for.
// PURE.

import { amountsIn, nameKey } from './stockMatch.js';

const FORM_GROUP = { tablet: 'oral-solid', capsule: 'oral-solid', syrup: 'oral-liquid', suspension: 'oral-liquid', injection: 'injection', infusion: 'injection', cream: 'topical', ointment: 'topical', gel: 'topical' };
const formGroup = (f) => FORM_GROUP[f] ?? f;
const amountsKey = (m) => {
  const list = String(m.strength ?? '').trim() ? amountsIn(m.strength) : amountsIn(m.name);
  return list.map((a) => `${a.kind}:${Math.round(a.base * 1e6)}`).sort().join('|');
};

/** Whether two stock medicines are the same medicine (generic, strength, form) – both must have a generic name. */
export function sameMedicine(a, b) {
  if (!String(a?.generic ?? '').trim() || !String(b?.generic ?? '').trim()) return false;
  return nameKey(a.generic) === nameKey(b.generic) && amountsKey(a) === amountsKey(b) && formGroup(a.form) === formGroup(b.form);
}

/**
 * Is selling `chosen` for the prescription line `item` ({ drug, strength, form }) a substitute? Only when it is sure:
 * the doctor named a brand on the stock list (not a generic name) and the chosen medicine is ANOTHER brand of the same
 * medicine. A generic prescription takes any brand of it without a question. Returns { substitute, prescribed } –
 * prescribed: the stock medicine the doctor named, when found.
 */
export function substituteFor(item, chosen, medicines) {
  const asked = nameKey(item.drug);
  if (!asked) return { substitute: false, prescribed: null };
  if (asked === nameKey(chosen.name)) return { substitute: false, prescribed: chosen }; // the brand itself
  if (String(chosen.generic ?? '').trim() && asked === nameKey(chosen.generic)) return { substitute: false, prescribed: null }; // a generic prescription
  const named = medicines.find((m) => String(m._id ?? m.id) !== String(chosen._id ?? chosen.id) && nameKey(m.name) === asked);
  if (named && sameMedicine(named, chosen)) return { substitute: true, prescribed: named };
  return { substitute: false, prescribed: null };
}

/** Is a prescription line or a medicine on the never-substitute list (keys: nameKey of each entry)? */
export function neverSubstitute(keys, item, medicines = []) {
  if (!keys.size) return false;
  const asked = nameKey(item.drug);
  if (keys.has(asked)) return true;
  return medicines.some((m) => m && String(m.generic ?? '').trim() && keys.has(nameKey(m.generic)));
}
