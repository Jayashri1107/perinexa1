// A hospital's library of test packages: its own copy of the built-in DRAFT packages, and what the website
// receives about a package. Used by routes/labPackages.js and when ordering tests (routes/lab.js).

import { AuditLog } from '../models/AuditLog.js';
import { LabPackage } from '../models/LabPackage.js';
import { BUILT_IN_PACKAGES, BUILT_IN_PACKAGES_VERSION } from './builtInPackages.js';

const CONTENT = ['who', 'name', 'forWhom', 'about', 'fromDay', 'toDay', 'tests', 'order'];
const content = (p) => Object.fromEntries(CONTENT.map((k) => [k, p[k]]));

/**
 * Makes sure the hospital has every built-in package (a unique index stops duplicates if two requests arrive at once),
 * and refreshes built-in drafts nobody has edited or approved when the built-in packages change.
 */
export async function ensureLabPackages(tenantId) {
  const have = await LabPackage.find({ tenantId, origin: 'built_in' }, { key: 1, builtInVersion: 1, status: 1 }).lean();
  const byKey = new Map(have.map((p) => [p.key, p]));
  for (const p of BUILT_IN_PACKAGES) {
    const existing = byKey.get(p.key);
    if (!existing) {
      await LabPackage.updateOne(
        { tenantId, key: p.key },
        {
          $setOnInsert: {
            ...content(p),
            origin: 'built_in',
            builtInVersion: BUILT_IN_PACKAGES_VERSION,
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
    } else if (existing.status === 'draft' && existing.builtInVersion != null && existing.builtInVersion < BUILT_IN_PACKAGES_VERSION) {
      const doc = await LabPackage.findOne({ _id: existing._id, tenantId });
      Object.assign(doc, content(p), { builtInVersion: BUILT_IN_PACKAGES_VERSION, version: doc.version + 1, updatedByName: 'Built-in draft updated' });
      try {
        await doc.save();
        await AuditLog.create({ action: 'LAB_PACKAGE_UPDATED', tenantId, actorEmail: 'system (built-in packages)', details: { packageId: String(doc._id), name: doc.name, version: doc.version } });
      } catch (e) {
        if (e?.name !== 'VersionError') throw e; // someone saved it at the same moment: theirs wins
      }
    }
  }
}

/** A package as the website receives it. */
export function packageJSON(pkg) {
  const p = pkg.toObject ? pkg.toObject() : pkg;
  return {
    id: String(p._id),
    key: p.key,
    origin: p.origin,
    who: p.who,
    name: p.name,
    forWhom: p.forWhom ?? '',
    about: p.about ?? '',
    fromDay: p.fromDay ?? null,
    toDay: p.toDay ?? null,
    tests: p.tests ?? [],
    order: p.order,
    isActive: p.isActive,
    status: p.status,
    version: p.version,
    approvedByName: p.approvedByName ?? null,
    approvedAt: p.approvedAt ?? null,
    approvedVersion: p.approvedVersion ?? null,
    createdByName: p.createdByName ?? null,
    updatedByName: p.updatedByName ?? null,
    updatedAt: p.updatedAt ?? null,
  };
}

/** In use first; baby packages before adult ones; then in their order and by name. */
export const byListOrder = (a, b) =>
  Number(b.isActive) - Number(a.isActive) || Number(a.who !== 'newborn') - Number(b.who !== 'newborn') || a.order - b.order || a.name.localeCompare(b.name);
