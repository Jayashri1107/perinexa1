// How a stay ended, recorded at the desk after the doctor's discharge card (docs/IPD_DISCHARGE_BILLING_PLAN.md,
// 9 Nov 2026 – the types of the hospital's old HIMS). PURE.
//
// Death is never chosen at the desk: reception and the billing staff may see only that a record is closed, never why
// (patients/deathRules.js). When a doctor has recorded the death, the type is taken from the record, and only the
// roles that may see her medical details see the word "Death".

export const DISCHARGE_TYPES = ['normal', 'dama', 'lama', 'dor', 'transfer', 'death'];
export const DESK_DISCHARGE_TYPES = DISCHARGE_TYPES.filter((t) => t !== 'death');
export const DISCHARGE_TYPE_LABELS = {
  normal: 'Normal',
  dama: 'DAMA (discharge against medical advice)',
  lama: 'LAMA (left against medical advice)',
  dor: 'DOR (discharge on request)',
  transfer: 'Transfer to another hospital',
  death: 'Death',
};
// Who may see "Death" (the others see "Record closed")
export const MEDICAL_ROLES = ['doctor', 'rmo', 'nurse'];
export const CLOSED_LABEL = 'Record closed';

/** The type as this person may see it: { type, label } – a death shows as "Record closed" to the desk. */
export function dischargeTypeFor(type, { medical }) {
  if (!type) return null;
  if (type === 'death' && !medical) return { type: 'closed', label: CLOSED_LABEL };
  return { type, label: DISCHARGE_TYPE_LABELS[type] ?? type };
}
