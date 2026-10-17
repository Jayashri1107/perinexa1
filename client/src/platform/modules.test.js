// The left menu and the Clinic library's tabs, by role (no browser needed).
import { describe, expect, it } from 'vitest';
import { PLATFORM_MODULES, hospitalModules, knowledgeSections, knowledgeTabs, moduleByKey, patientTabs } from './modules.js';

const menu = (roles) => hospitalModules(roles).map((m) => m.label);

describe('the Clinic library', () => {
  it('is one item in the left menu in place of care plans, consent forms and prescription sets', () => {
    for (const roles of [['doctor'], ['rmo'], ['nurse']]) {
      expect(menu(roles)).toContain('Clinic library');
      expect(menu(roles).filter((l) => ['Care plans', 'Consent forms', 'Prescription sets'].includes(l))).toEqual([]);
    }
    for (const roles of [['receptionist'], ['lab'], ['admin']]) expect(menu(roles), roles[0]).not.toContain('Clinic library');
  });

  it('opens as tabs – To approve for doctors, prescription sets only for those who prescribe', () => {
    expect(knowledgeTabs(['doctor']).map((t) => t.label)).toEqual(['To approve', 'Care plans', 'Clinical rules', 'Consent forms', 'Information forms', 'Test packages', 'Prescription sets', 'Pregnancy wheel']);
    expect(knowledgeTabs(['rmo']).map((t) => t.label)).toEqual(['Care plans', 'Clinical rules', 'Consent forms', 'Information forms', 'Test packages', 'Prescription sets', 'Pregnancy wheel']); // RMOs don't approve
    expect(knowledgeTabs(['nurse']).map((t) => t.label)).toEqual(['Care plans', 'Clinical rules', 'Consent forms', 'Information forms', 'Test packages', 'Pregnancy wheel']);
    expect(knowledgeTabs(['nurse', 'doctor'])).toHaveLength(8); // a person with several roles gets everything any role allows
  });

  it('keeps each tab current on all its pages, with its own sections underneath', () => {
    const [, carePlans, rules, consents, information, packages, sets] = knowledgeTabs(['doctor']);
    expect(carePlans.activeFor).toBe('/care-plans/templates');
    expect(rules.activeFor).toEqual(['/care-plans/red-flags', '/medicine-safety', '/clinical-rules']);
    expect(consents.activeFor).toBe('/consent-forms');
    expect(information.activeFor).toBe('/information-forms');
    expect(packages.activeFor).toBe('/test-packages');
    expect(sets.activeFor).toBe('/prescription-sets');
    expect(knowledgeSections('clinical-rules').map((s) => s.label)).toEqual(['Red-flag rules', 'Medicine safety', 'Risk rules']);
    expect(knowledgeSections('care-plans')).toEqual([]);
    expect(knowledgeSections('consent-forms')).toEqual([]);
  });
});

describe('Beds', () => {
  it('the bed board is in the menu for reception, RMOs and nurses (not doctors); the admin sets up beds under Hospital admin', () => {
    for (const roles of [['receptionist'], ['rmo'], ['nurse'], ['doctor', 'nurse']]) expect(menu(roles), roles.join('+')).toContain('Beds');
    for (const roles of [['doctor'], ['lab'], ['pharmacist'], ['admin'], ['billing']]) expect(menu(roles), roles[0]).not.toContain('Beds');
    expect(moduleByKey('hospital-admin').tabs.map((t) => t.label)).toContain('Beds');
  });
});

describe('My settings and Hospital admin', () => {
  it('My settings shows Prescription design to prescribers and Voice words to those who dictate', async () => {
    const { accountTabs, isPrescriber } = await import('./modules.js');
    const tabs = (...roleSets) => accountTabs(roleSets.map((roles) => ({ roles }))).map((t) => t.label);
    expect(tabs(['doctor'])).toEqual(['Profile', 'Prescription design', 'Voice words', 'Typing shortcuts']);
    expect(tabs(['nurse'])).toEqual(['Profile', 'Voice words', 'Typing shortcuts']);
    expect(tabs(['receptionist'])).toEqual(['Profile', 'Voice words', 'Typing shortcuts']);
    expect(tabs(['lab'])).toEqual(['Profile', 'Typing shortcuts']);
    expect(tabs()).toEqual(['Profile']); // super admin
    expect(tabs(['nurse'], ['rmo'])).toContain('Prescription design'); // an RMO in another hospital
    expect(isPrescriber([{ roles: ['admin'] }])).toBe(false);
  });
  it('Hospital admin holds Staff, Audit log and Print letterhead', () => {
    expect(moduleByKey('hospital-admin').tabs.map((t) => t.label)).toEqual(['Staff', 'Audit log', 'Print letterhead', 'Patient messages', 'OPD timings', 'Beds', 'ABDM']);
    expect(moduleByKey('appointments').tabs.map((t) => t.label)).toEqual(['Schedule', 'Month', 'Needs a time', 'OPD settings']);
    expect(moduleByKey('registers')).toBeUndefined(); // the registers were removed on 2 Oct 2026
    expect(moduleByKey('analytics').tabs.map((t) => t.label)).not.toContain('Monthly report'); // a doctors-only tab, added on the page itself
    expect(moduleByKey('lab').label).toBe('Lab');
  });
});

describe('the left menu by role', () => {
  it('Analytics for doctors and hospital admins only; Appointments for reception, doctors, RMOs and nurses; Calendar for doctors, RMOs and reception; Billing for reception and admins; Pharmacy for pharmacists and admins (exact lists pin the order too)', () => {
    expect(menu(['doctor'])).toEqual(['Today', 'Patients', 'Appointments', 'Calendar', 'Lab', 'Scans', 'Analytics', 'Clinic library']);
    expect(menu(['admin'])).toEqual(['Today', 'Billing', 'Pharmacy', 'Analytics', 'Hospital admin']);
    expect(menu(['doctor', 'admin'])).toEqual(['Today', 'Patients', 'Appointments', 'Calendar', 'Lab', 'Scans', 'Billing', 'Pharmacy', 'Analytics', 'Clinic library', 'Hospital admin']); // once, not twice
    expect(menu(['rmo'])).toEqual(['Today', 'Patients', 'Appointments', 'Beds', 'Lab', 'Scans', 'Analytics', 'Clinic library']); // Analytics: only Ask your records; no Calendar for an RMO alone (owner, 13 Oct 2026)
    expect(menu(['rmo', 'doctor'])).toContain('Calendar');
    expect(menu(['nurse'])).toEqual(['Today', 'Patients', 'Appointments', 'Beds', 'Lab', 'Scans', 'Analytics', 'Clinic library']);
    expect(menu(['receptionist'])).toEqual(['Today', 'Patients', 'Appointments', 'Calendar', 'Beds', 'Scans', 'Billing']);
    expect(menu(['lab'])).toEqual(['Today', 'Patients', 'Lab']);
    expect(menu(['pharmacist'])).toEqual(['Today', 'Patients', 'Pharmacy']);
    expect(hospitalModules(['admin']).find((m) => m.label === 'Pharmacy').to).toBe('/pharmacy/stock'); // the counter is for pharmacists
    expect(menu(['receptionist', 'lab'])).not.toContain('Analytics');
    expect(hospitalModules(['nurse', 'rmo']).find((m) => m.label === 'Analytics').tabs.map((t) => t.label)).toEqual(['Ask your records']);
    expect(patientTabs(['doctor']).map((t) => t.label)).not.toContain('Ask your records');
    expect(menu(['rmo', 'admin'])).toContain('Analytics'); // any role that allows it is enough
    expect(menu(['nurse', 'admin'])).toContain('Analytics');
    expect(menu([])).toEqual([]);
    expect(hospitalModules(['doctor']).find((m) => m.label === 'Analytics').to).toBe('/analytics');
  });

  it('the super admin has the platform Analytics as the second item', () => {
    expect(PLATFORM_MODULES.map((m) => m.label)).toEqual(['Overview', 'Analytics', 'Hospitals', 'Users & access', 'Staff', 'Audit & compliance']);
    expect(moduleByKey('platform-analytics').to).toBe('/platform/analytics');
    expect(moduleByKey('analytics').to).toBe('/analytics');
  });
});
