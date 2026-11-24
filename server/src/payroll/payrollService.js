// The hospital's payroll settings (Tenant.payroll), read and saved like the Tally link's: they leave only through
// the payroll routes – never in the hospital's JSON, never to the platform.
import { Tenant } from '../models/Tenant.js';
import { ratesWithDefaults } from './payrollDeductions.js';
import { withDefaults } from './payrollRules.js';

export async function payrollSettings(tenantId) {
  const t = await Tenant.findById(tenantId, { payroll: 1 }).lean();
  return withDefaults(t?.payroll);
}

const SECTIONS = ['parts', 'dayBasis', 'weeklyOffsPaid', 'holidaysPaid', 'rounding', 'confirmedBy', 'confirmedOn', 'bankList', 'fullNumbers'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const MAX_LAYOUTS = 10;
/** The hospital's saved attendance layouts: [{ name, layout, savedByName, savedAt }]. */
export async function attendanceLayouts(tenantId) {
  const t = await Tenant.findById(tenantId, { 'payroll.layouts': 1 }).lean();
  return (t?.payroll?.layouts ?? []).map((l) => ({ name: l.name, layout: l.layout, savedByName: l.savedByName ?? '', savedAt: l.savedAt ?? null }));
}

/** Keeps a layout under a name (the same name again replaces it). false when there are already MAX_LAYOUTS others. */
export async function saveAttendanceLayout(req, name, layout) {
  const kept = (await attendanceLayouts(req.tenantId)).filter((l) => l.name.toLowerCase() !== name.toLowerCase());
  if (kept.length >= MAX_LAYOUTS) return false;
  const layouts = [...kept, { name, layout, savedByName: req.user?.name ?? '', savedAt: req.now ?? new Date() }].sort((a, b) => a.name.localeCompare(b.name));
  await Tenant.updateOne({ _id: req.tenantId }, { $set: { 'payroll.layouts': layouts } });
  return true;
}

/** Saves the settings; returns the names of what changed (for the audit log – never the values). */
export async function savePayrollSettings(req, next) {
  const before = await payrollSettings(req.tenantId);
  const after = withDefaults(next);
  const changed = SECTIONS.filter((k) => !same(before[k], after[k]));
  if (!changed.length) return [];
  await Tenant.updateOne(
    { _id: req.tenantId },
    {
      $set: {
        'payroll.parts': after.parts,
        'payroll.dayBasis': after.dayBasis,
        'payroll.weeklyOffsPaid': after.weeklyOffsPaid,
        'payroll.holidaysPaid': after.holidaysPaid,
        'payroll.rounding': after.rounding,
        'payroll.confirmedBy': after.confirmedBy,
        'payroll.confirmedOn': after.confirmedOn ? new Date(`${after.confirmedOn}T00:00:00Z`) : null,
        'payroll.bankList': after.bankList,
        'payroll.fullNumbers': after.fullNumbers,
        'payroll.updatedByName': req.user?.name ?? '',
        'payroll.updatedAt': req.now ?? new Date(),
      },
    },
  );
  return changed;
}

// ---------- Stage C: the rate table ----------
/** The hospital's rate table (PF, ESI, professional tax) with the earlier confirmed sets – ratesFor picks a month's. */
export async function payrollRates(tenantId) {
  const t = await Tenant.findById(tenantId, { 'payroll.rates': 1 }).lean();
  return ratesWithDefaults(t?.payroll?.rates);
}

/** Keeps one group of rates as typed (already checked by the route), with who saved it. */
export async function saveRateGroup(req, group, value) {
  await Tenant.updateOne({ _id: req.tenantId }, { $set: { [`payroll.rates.${group}`]: { ...value, updatedByName: req.user?.name ?? '', updatedAt: req.now ?? new Date() } } });
}
