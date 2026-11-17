// Perinexa's own staff and a hospital's patients (health check H3; owner's decision of 17 Nov 2026, replacing the
// decisions of 12 and 24 Oct 2026): a super admin or platform admin reaches a hospital's patient records only while that
// hospital's own admin has allowed it – for a stated reason and a limited time (support access). Without it they see the
// hospital's setup and staff only, and never its patients, bills, pharmacy or lab. Every record opened during support
// access is in the hospital's audit log as before, and the grant and its end are there too.

/** How long a hospital admin may allow support access at a time (hours). */
export const SUPPORT_HOURS = [2, 8, 24, 72];

/** Is support access open in this hospital now? tenant: a Tenant document or a lean one with platformAccess. */
export const supportAccessOpen = (tenant, now = new Date()) => Boolean(tenant?.platformAccess?.until && new Date(tenant.platformAccess.until) > now);

/** What the hospital admin and the platform user see about it (never who granted it by id). */
export function supportAccessView(tenant, now = new Date()) {
  const a = tenant?.platformAccess;
  if (!a?.until) return { open: false, until: null };
  return {
    open: supportAccessOpen(tenant, now),
    until: a.until,
    reason: a.reason ?? '',
    grantedByName: a.grantedByName ?? '',
    grantedAt: a.grantedAt ?? null,
  };
}

export const NO_SUPPORT_ACCESS =
  "Patient records in this hospital open for Perinexa staff only while the hospital's admin allows it (Hospital admin → Support access).";
