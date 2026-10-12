// A hospital's library of ready-made prescription sets (Feature 8b): its own copy of the built-in DRAFT sets,
// and what the website receives about a set. Used by routes/prescriptionSets.js.

import { AuditLog } from '../models/AuditLog.js';
import { CARE_TYPES } from '../models/Patient.js';
import { PrescriptionSet } from '../models/PrescriptionSet.js';
import { BUILT_IN_SETS, BUILT_IN_SETS_VERSION } from './builtInSets.js';
import { rxItemView } from './visitView.js';

const CONTENT = ['name', 'about', 'careTypes', 'items', 'notes', 'investigations', 'advice', 'order'];
// The built-in content, with the types of care in the usual order (as a doctor's save stores them).
const content = (s) => ({ ...Object.fromEntries(CONTENT.map((k) => [k, s[k]])), careTypes: CARE_TYPES.filter((t) => s.careTypes.includes(t)) });

/**
 * Makes sure the hospital has every built-in set (a unique index stops duplicates if two requests arrive at
 * once), and refreshes built-in drafts that nobody has edited or approved when the built-in content changes.
 * Sets the hospital edited, approved or made inactive are left alone (an inactive one is only refreshed while
 * still unedited, so it is current if it is used again).
 */
export async function ensurePrescriptionSets(tenantId) {
  const have = await PrescriptionSet.find({ tenantId, origin: 'built_in' }, { key: 1, builtInVersion: 1, status: 1 }).lean();
  const byKey = new Map(have.map((s) => [s.key, s]));
  for (const s of BUILT_IN_SETS) {
    const existing = byKey.get(s.key);
    if (!existing) {
      await PrescriptionSet.updateOne(
        { tenantId, key: s.key },
        {
          $setOnInsert: {
            ...content(s),
            origin: 'built_in',
            builtInVersion: BUILT_IN_SETS_VERSION,
            status: 'draft',
            version: 1,
            isActive: true,
            createdByName: 'Built-in draft',
            updatedByName: 'Built-in draft',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true, timestamps: false },
      ).catch((e) => {
        if (e?.code !== 11000) throw e; // created by another request at the same moment
      });
    } else if (existing.status === 'draft' && existing.builtInVersion != null && existing.builtInVersion < BUILT_IN_SETS_VERSION) {
      const set = await PrescriptionSet.findOne({ _id: existing._id, tenantId });
      Object.assign(set, content(s), { builtInVersion: BUILT_IN_SETS_VERSION, version: set.version + 1, updatedByName: 'Built-in draft updated' });
      try {
        await set.save();
        await AuditLog.create({
          action: 'PRESCRIPTION_SET_UPDATED',
          tenantId,
          actorEmail: 'system (built-in sets)',
          details: { setId: String(set._id), name: set.name, version: set.version },
        });
      } catch (e) {
        if (e?.name !== 'VersionError') throw e; // someone saved it at the same moment: theirs wins
      }
    }
  }
}

/** A set as the website receives it: everything, including its medicines as the Prescription tab writes them. */
export function setJSON(set) {
  const s = set.toObject ? set.toObject() : set;
  return {
    id: String(s._id),
    key: s.key,
    origin: s.origin,
    name: s.name,
    about: s.about ?? '',
    careTypes: s.careTypes ?? [],
    items: (s.items ?? []).map(rxItemView),
    notes: s.notes ?? '',
    investigations: s.investigations ?? '',
    advice: s.advice ?? '',
    order: s.order,
    isActive: s.isActive,
    status: s.status,
    version: s.version,
    approvedByName: s.approvedByName ?? null,
    approvedAt: s.approvedAt ?? null,
    approvedVersion: s.approvedVersion ?? null,
    createdByName: s.createdByName ?? null,
    updatedByName: s.updatedByName ?? null,
    createdAt: s.createdAt ?? null,
    updatedAt: s.updatedAt ?? null,
  };
}

/** Sets in use first, in the order of care, then by name. */
export const byListOrder = (a, b) => Number(b.isActive) - Number(a.isActive) || a.order - b.order || a.name.localeCompare(b.name);
