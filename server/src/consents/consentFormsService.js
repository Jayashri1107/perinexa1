// A hospital's consent-form library: its own copy of the built-in DRAFT forms, and what the website receives
// about a form. Used by the library routes (routes/consentForms.js) and by printing for a patient
// (routes/patientConsents.js).

import { AuditLog } from '../models/AuditLog.js';
import { ConsentForm } from '../models/ConsentForm.js';
import { BUILT_IN_FORMS, BUILT_IN_FORMS_VERSION } from './builtInForms.js';
import { formBlanks, languagesOf } from './consentText.js';

const CONTENT = ['kind', 'title', 'description', 'careTypes', 'suggestWhen', 'clauses', 'order'];
const content = (f) => Object.fromEntries(CONTENT.map((k) => [k, f[k]]));

/**
 * Makes sure the hospital has every built-in form (a unique index stops duplicates if two requests arrive at
 * once), and refreshes built-in drafts that nobody has edited or approved when the built-in wording changes.
 * Forms the hospital edited, approved or made inactive are left alone (an inactive one is only refreshed while
 * still unedited, so it is current if it is made active again).
 */
export async function ensureConsentForms(tenantId) {
  // Forms saved before there were information forms are consent forms.
  await ConsentForm.updateMany({ tenantId, kind: { $exists: false } }, { $set: { kind: 'consent' } }, { timestamps: false });
  const have = await ConsentForm.find({ tenantId, origin: 'built_in' }, { key: 1, builtInVersion: 1, status: 1 }).lean();
  const byKey = new Map(have.map((f) => [f.key, f]));
  for (const f of BUILT_IN_FORMS) {
    const existing = byKey.get(f.key);
    if (!existing) {
      await ConsentForm.updateOne(
        { tenantId, key: f.key },
        {
          $setOnInsert: {
            ...content(f),
            origin: 'built_in',
            builtInVersion: BUILT_IN_FORMS_VERSION,
            status: 'draft',
            version: 1,
            isActive: true,
            updatedByName: 'Built-in draft',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true, timestamps: false },
      ).catch((e) => {
        if (e?.code !== 11000) throw e; // created by another request at the same moment
      });
    } else if (existing.status === 'draft' && existing.builtInVersion != null && existing.builtInVersion < BUILT_IN_FORMS_VERSION) {
      const form = await ConsentForm.findOne({ _id: existing._id, tenantId });
      Object.assign(form, content(f), { builtInVersion: BUILT_IN_FORMS_VERSION, version: form.version + 1, updatedByName: 'Built-in draft updated' });
      try {
        await form.save();
        await AuditLog.create({
          action: 'CONSENT_FORM_UPDATED',
          tenantId,
          actorEmail: 'system (built-in forms)',
          details: { formId: String(form._id), title: form.title.en, version: form.version },
        });
      } catch (e) {
        if (e?.name !== 'VersionError') throw e; // someone saved it at the same moment: theirs wins
      }
    }
  }
}

/** A form as the lists show it (no clauses), with the languages it can be printed in. */
export function formSummary(form) {
  const f = form.toJSON ? form.toJSON() : form;
  return {
    id: f.id ?? String(f._id),
    key: f.key,
    origin: f.origin,
    kind: f.kind ?? 'consent',
    title: f.title,
    careTypes: f.careTypes ?? [],
    suggestWhen: f.suggestWhen,
    order: f.order,
    isActive: f.isActive,
    status: f.status,
    version: f.version,
    approvedByName: f.approvedByName ?? null,
    approvedAt: f.approvedAt ?? null,
    approvedVersion: f.approvedVersion ?? null,
    updatedByName: f.updatedByName ?? null,
    updatedAt: f.updatedAt ?? null,
    clauseCount: (f.clauses ?? []).length,
    languages: languagesOf(f),
    blanks: [...formBlanks(f)],
  };
}

/** The whole form, for its page, the editor and printing. */
export function formJSON(form) {
  const f = form.toJSON ? form.toJSON() : form;
  return { ...formSummary(f), description: f.description ?? '', clauses: (f.clauses ?? []).map((c) => ({ en: c.en, mr: c.mr ?? '', hi: c.hi ?? '' })) };
}

/** Active forms first, in the order of care, then by title. */
export const byListOrder = (a, b) => Number(b.isActive) - Number(a.isActive) || a.order - b.order || a.title.en.localeCompare(b.title.en);
