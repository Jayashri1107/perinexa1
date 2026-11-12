import { FormularyItem, isVerified } from '../models/FormularyItem.js';

// PH7 (docs/PHARMACY_BUILD_NOTE.md): one "high alert" for one idea. The formulary (Formulary → a dose row) has its own
// high-alert flag, confirmed by a doctor and the pharmacist like the medicine marks. The stock list reads it where a
// medicine's generic name is the formulary row's name, so a medicine is never high alert in one place and not in the
// other. Only rows in use and confirmed for their current version count.

const key = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The generic names (compared without capitals, spaces or punctuation) marked high alert in the formulary. */
export async function formularyHighAlerts(tenantId) {
  const rows = await FormularyItem.find({ tenantId, isActive: true, highAlert: true }, { name: 1, version: 1, confirmations: 1 }).lean();
  return new Set(rows.filter(isVerified).map((r) => key(r.name)).filter(Boolean));
}

/** A medicine's view with the formulary's high alert added (the marks' own flag wins when set). PURE. */
export function withFormularyAlert(view, medicine, alerts) {
  if (!view || view.highAlert || !alerts?.size) return view;
  return alerts.has(key(medicine.generic)) ? { ...view, highAlert: true, highAlertFrom: 'formulary' } : view;
}
