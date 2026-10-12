// Delivery and newborn outcomes on the delivery note (5 Oct 2026): the words and the postpartum haemorrhage
// SUGGESTION. Pure (no screen, no request), so the server's tests can check it against its own copy
// (server/src/inpatient/docSchemas.js – the same numbers, source and lists).
//
// Postpartum haemorrhage is always the doctor's answer. The note only suggests it from the blood loss: 500 mL or more
// after a vaginal birth (normal, vacuum or forceps), 1000 mL or more after a caesarean; nothing for "other" (it may
// have been an operation). DRAFT clinical content, for a doctor to check.

export const PPH_ML_VAGINAL = 500;
export const PPH_ML_CAESAREAN = 1000;
export const PPH_SOURCE = 'WHO recommendations on postpartum haemorrhage (2012): 500 mL or more within 24 hours after birth; after a caesarean, 1000 mL or more (the older ACOG definition, Practice Bulletin 76, 2006)';
const VAGINAL_MODES = ['normal', 'vacuum', 'forceps'];

/** The blood loss from which postpartum haemorrhage is suggested for this mode of delivery (null: no mode chosen yet, or "other"). */
export const pphThresholdMl = (mode) => (mode === 'lscs' ? PPH_ML_CAESAREAN : VAGINAL_MODES.includes(mode) ? PPH_ML_VAGINAL : null);

/** Does the blood loss suggest postpartum haemorrhage? true, false, or null when it cannot be said. Never an answer. */
export function pphSuggested(mode, bloodLossMl) {
  const threshold = pphThresholdMl(mode);
  if (threshold == null || bloodLossMl == null || String(bloodLossMl).trim() === '' || !Number.isFinite(Number(bloodLossMl))) return null;
  return Number(bloodLossMl) >= threshold;
}

const ml = (n) => `${n.toLocaleString('en-IN')} mL`;

/**
 * The hint under the doctor's answer: what the blood loss suggests (or that nothing can be suggested yet), and that the
 * doctor decides. Always says the amounts are a draft, with the source.
 */
export function pphHint(mode, bloodLossMl) {
  const threshold = pphThresholdMl(mode);
  const suggested = pphSuggested(mode, bloodLossMl);
  const after = mode === 'lscs' ? 'after a caesarean' : 'after a vaginal birth';
  let lead;
  if (!mode) lead = 'Choose the mode of delivery and enter the blood loss to see what it suggests.';
  else if (threshold == null) lead = 'No suggestion for "Other": decide from the blood loss and her condition.';
  else if (suggested == null) lead = `Enter the blood loss to see what it suggests (${ml(threshold)} or more ${after}).`;
  else if (suggested) lead = `A blood loss of ${ml(Number(bloodLossMl))} ${after} suggests postpartum haemorrhage (${ml(threshold)} or more).`;
  else lead = `A blood loss of ${ml(Number(bloodLossMl))} ${after} is below ${ml(threshold)}.`;
  return `${lead} You decide – nothing is ticked by itself. The amounts are a DRAFT for a doctor to check. Source: ${PPH_SOURCE}.`;
}

// The answers, as the delivery note shows and prints them. '' is "not recorded" (every note from before 5 Oct 2026).
export const PPH_LABELS = { yes: 'Yes – heavy bleeding (PPH)', no: 'No' };
export const STILLBIRTH_TYPES = ['fresh', 'macerated'];
export const STILLBIRTH_TYPE_LABELS = { fresh: 'Fresh (died during labour)', macerated: 'Macerated (died before labour)' };
export const BREASTFED_WITHIN_HOUR = ['yes', 'no', 'not_applicable'];
export const BREASTFED_LABELS = { yes: 'Yes', no: 'No', not_applicable: 'Not applicable' };
export const NICU_LABELS = { yes: 'Yes', no: 'No' };

/**
 * One baby's outcome answers in words, for the read-only note and its printout: "Fresh stillbirth", "Breastfed
 * within one hour: no", "Admitted to the NICU or SNCU: yes". Only what was answered.
 */
export function babyOutcomeWords(b) {
  return [
    b.outcome === 'stillbirth' && b.stillbirthType ? `${b.stillbirthType === 'fresh' ? 'Fresh' : 'Macerated'} stillbirth` : null,
    b.breastfedWithinHour ? `Breastfed within one hour: ${BREASTFED_LABELS[b.breastfedWithinHour]?.toLowerCase() ?? b.breastfedWithinHour}` : null,
    b.nicu ? `Admitted to the NICU or SNCU: ${NICU_LABELS[b.nicu]?.toLowerCase() ?? b.nicu}` : null,
  ].filter(Boolean);
}

/** A baby's answers that do not fit its outcome are cleared (the server drops them too). */
export function tidyBaby(b) {
  const out = { ...b };
  if (out.outcome !== 'stillbirth') out.stillbirthType = '';
  if (out.outcome === 'stillbirth') Object.assign(out, { breastfedWithinHour: '', nicu: '' });
  return out;
}
