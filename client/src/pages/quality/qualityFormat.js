// Clinical audit (Clinical Requirements Group A): who sees which page, and the module's tabs. The same role lists as
// the server's routes (server/src/routes/clinicalAudit.js and the Group A routes after it).

/** The Robson table and the caesarean audit: numbers for these roles; each caesarean for doctors and RMOs. */
export const CLINICAL_AUDIT_ROLES = ['doctor', 'rmo', 'quality', 'admin'];

export const QUALITY_TABS = [
  { label: 'Deliveries', to: '/clinical-audit', end: true },
  // Monthly dashboards with targets and the lead's sign-off (Group B item 17)
  { label: 'Monthly dashboards', to: '/clinical-audit/dashboards', end: true },
];
