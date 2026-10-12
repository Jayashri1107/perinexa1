// Consent forms that are no longer part of Perinexa. Removed at the owner's request on 2 Oct 2026; copies stay
// stored but are never offered, listed or printed.
//
// The ultrasound consent ("Consent and declaration for ultrasound in pregnancy") belonged to the PC-PNDT Form F
// work, which the owner does not want in the app. The protection itself stays: the app never records or shows
// the baby's sex before birth (utils/pcpndt.js).
//
// A hospital's form counts as retired when (all within the one hospital):
//   (a) its key is a retired built-in key;
//   (b) it was made by copying a retired form – found through the CONSENT_FORM_CREATED audit entries
//       (details.copiedFrom), followed through copies of copies;
//   (c) it is one of the hospital's own forms whose English title or a clause mentions "Form F", as stored before
//       2 Oct 2026 (the removal). A form edited later is the hospital's current wording and is never hidden by (c).
// A hospital's own form that only says the sex of the foetus is not disclosed (PC&PNDT Act) is part of the
// protection we keep, so it stays listed.

import mongoose from 'mongoose';
import { AuditLog } from '../models/AuditLog.js';
import { ConsentForm } from '../models/ConsentForm.js';

export const RETIRED_FORM_KEYS = ['ultrasound_pregnancy'];

const FORM_F = /\bForm F\b/;
// Rule (c) applies only to wording stored before the removal (2 Oct 2026). A form edited later is the hospital's own
// current wording and is never hidden by it, so a later edit can never hide earlier patient printouts. A hidden form
// cannot be edited (the routes answer "not found") and only built-in forms are updated automatically, so a hidden
// form's date never moves past this.
const FORM_F_BEFORE = new Date('2026-10-02T00:00:00+05:30');

const mentionsFormF = (f) => FORM_F.test(f.title?.en ?? '') || (f.clauses ?? []).some((c) => FORM_F.test(c.en ?? ''));

/** The ids (strings) of this hospital's retired forms. Load once per request. */
export async function retiredFormIds(tenantId) {
  const forms = await ConsentForm.find({ tenantId }, { key: 1, origin: 1, updatedAt: 1, 'title.en': 1, 'clauses.en': 1 }).lean();
  const ids = new Set();
  for (const f of forms) {
    const oldFormF = f.origin === 'hospital' && f.updatedAt && f.updatedAt < FORM_F_BEFORE && mentionsFormF(f);
    if (RETIRED_FORM_KEYS.includes(f.key) || oldFormF) ids.add(String(f._id));
  }
  if (!ids.size) return ids;
  // Copies (and copies of copies) of a retired form.
  const formIds = new Set(forms.map((f) => String(f._id)));
  let next = [...ids];
  while (next.length) {
    const asIds = next.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
    const created = await AuditLog.find(
      { tenantId, action: 'CONSENT_FORM_CREATED', 'details.copiedFrom': { $in: [...next, ...asIds] } },
      { 'details.formId': 1 },
    ).lean();
    next = [];
    for (const a of created) {
      const id = a.details?.formId == null ? null : String(a.details.formId);
      if (id && formIds.has(id) && !ids.has(id)) {
        ids.add(id);
        next.push(id);
      }
    }
  }
  return ids;
}

/** Whether a form (document or summary) is one of the retired ones. */
export const isRetired = (form, ids) => ids.has(String(form._id ?? form.id)) || RETIRED_FORM_KEYS.includes(form.key);
