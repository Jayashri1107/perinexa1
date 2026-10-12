// The medicine safety screens with the new kinds of entry – dose limits, breastfeeding and newborn entries – and the
// prescription form's warnings. The website has no browser test setup, so each screen is rendered to HTML
// (react-dom/server) from fake answers. All fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answers = {};
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles: ['doctor'], tenantName: 'Sample Hospital' }, user: { name: 'Dr Sample' } }) }));

const { MedicineSafetyPage } = await import('./MedicineSafetyPage.jsx');
const { MedicineSafetyEditPage } = await import('./MedicineSafetyEditPage.jsx');
const { PrescriptionForm } = await import('../visits/PrescriptionForm.jsx');
const { MedicineRows } = await import('../visits/MedicineRows.jsx');
const { SafetyStrip } = await import('../patients/SafetyStrip.jsx');
const { ApprovalsPage } = await import('../library/ApprovalsPage.jsx');

const entry = (e) => ({ otherTerms: [], level: 'caution', fromWeek: null, toWeek: null, maxAgeDays: null, doseUnit: '', maxSingle: null, maxDaily: null, perKg: false, message: '', source: 'Sample source', ...e });
const ENTRIES = [
  entry({ key: 'arbs', kind: 'medicine', label: 'Angiotensin receptor blockers', terms: ['losartan'], level: 'avoid', message: 'Stop.' }),
  entry({ key: 'iron_calcium', kind: 'combination', label: 'Iron and calcium together', terms: ['iron'], otherTerms: ['calcium'], message: '2 hours apart.' }),
  entry({ key: 'bf_codeine', kind: 'breastfeeding', label: 'Codeine', terms: ['codeine'], level: 'avoid', message: 'Use paracetamol.' }),
  entry({ key: 'nb_ceftriaxone', kind: 'newborn', label: 'Ceftriaxone in the first 28 days', terms: ['ceftriaxone'], maxAgeDays: 28, message: 'Not in a jaundiced baby.' }),
  entry({ key: 'dose_paracetamol', kind: 'dose', label: 'Paracetamol', terms: ['paracetamol'], doseUnit: 'mg', maxSingle: 1000, maxDaily: 4000 }),
  entry({ key: 'dosekg_gentamicin', kind: 'dose', label: 'Gentamicin (baby)', terms: ['gentamicin'], doseUnit: 'mg', maxSingle: 7.5, maxDaily: 7.5, perKg: true }),
];
const list = (extra = {}) => ({ id: 'l1', entries: ENTRIES, status: 'draft', version: 3, builtInVersion: 3, updatedAt: '2026-10-04T05:00:00.000Z', updatedByName: 'Built-in draft', canEdit: true, canApprove: true, newBuiltIn: 0, ...extra });
const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const at = (path, node) => words(renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>));

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
});

describe('the medicine safety list page', () => {
  it('shows every group with who it applies to, the limits of a dose entry, and that the list is a draft', () => {
    answers['/medicine-safety'] = { list: list() };
    const html = at('/medicine-safety', <MedicineSafetyPage />);
    for (const title of ['Pregnancy: avoid', 'Pregnancy: use with caution', 'Pregnancy: combinations to space out or watch', 'While breastfeeding', 'Newborn babies', 'Usual maximum doses']) expect(html, title).toContain(title);
    expect(html).toContain('Draft – not approved for clinical use.');
    expect(html).toContain('up to 28 days old');
    expect(html).toContain('Maximum for one dose');
    expect(html).toMatch(/<td data-label="Maximum for one dose"[^>]*>1 g<\/td><td data-label="Maximum for a day"[^>]*>4 g<\/td>/);
    expect(html).toMatch(/<td data-label="Maximum for one dose"[^>]*>7\.5 mg\/kg<\/td>/);
    expect(html).toContain('Babies in newborn care, per kg of body weight');
    expect(html).not.toContain('Babies in newborn care, up to');
    expect(html).toContain('The dose check is limited.');
    expect(html).not.toContain('not in this list');
    expect(html).not.toMatch(/!/); // no exclamation marks
  });

  it('offers a doctor the new built-in entries of a list that was approved or changed – never to others', () => {
    answers['/medicine-safety'] = { list: list({ status: 'approved', approvedByName: 'Dr Sample', approvedAt: '2026-10-01T05:00:00.000Z', builtInVersion: null, newBuiltIn: 73 }) };
    const html = at('/medicine-safety', <MedicineSafetyPage />);
    expect(html).toContain('73 new built-in draft entries are not in this list');
    expect(html).toContain('Add them as a draft');
    expect(html).toContain('never changed by itself');
    answers['/medicine-safety'] = { list: list({ status: 'approved', approvedByName: 'Dr Sample', canEdit: false, canApprove: false, newBuiltIn: 0 }) };
    expect(at('/medicine-safety', <MedicineSafetyPage />)).not.toContain('Add them as a draft');
  });
});

describe('a baby’s dose limit for the first days of life', () => {
  const week1 = entry({ key: 'dosekg_gentamicin_week1', kind: 'dose', label: 'Gentamicin (baby, first week of life)', terms: ['gentamicin'], doseUnit: 'mg', maxSingle: 5, maxDaily: 5, perKg: true, maxAgeDays: 7 });

  it('the list says up to what age it is used, and the editor has the age for a per-kg limit only', () => {
    answers['/medicine-safety'] = { list: list({ entries: [...ENTRIES, week1] }) };
    expect(at('/medicine-safety', <MedicineSafetyPage />)).toContain('Babies in newborn care, up to 7 days old, per kg of body weight');
    const html = at('/medicine-safety/edit', <MedicineSafetyEditPage />);
    expect(html).toMatch(/id="mda-6"[^>]*value="7"/); // the first-week entry
    expect(html).toMatch(/id="mda-5"[^>]*value=""/); // the general per-kg entry: any age
    expect(html).not.toContain('id="mda-4"'); // an adult limit has no age
  });
});

describe('the list editor', () => {
  it('shows each type of entry with its own fields', () => {
    answers['/medicine-safety'] = { list: list() };
    const html = at('/medicine-safety/edit', <MedicineSafetyEditPage />);
    const options = [...html.match(/<select id="mk-0"[^>]*>(.*?)<\/select>/s)[1].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
    expect(options).toEqual([['medicine', 'Pregnancy – medicine'], ['combination', 'Pregnancy – combination'], ['breastfeeding', 'While breastfeeding'], ['newborn', 'Newborn baby'], ['dose', 'Dose limit']]);
    // 0 pregnancy medicine: weeks; 1 combination: second medicine; 2 breastfeeding: level only; 3 newborn: age; 4, 5 dose: unit and limits
    expect(html).toContain('id="mfw-0"');
    expect(html).toContain('id="mo-1"');
    for (const id of ['mfw-2', 'mad-2', 'mds-2', 'mo-2']) expect(html, id).not.toContain(`id="${id}"`);
    expect(html).toContain('id="mv-2"');
    expect(html).toMatch(/id="mad-3"[^>]*value="28"/);
    expect(html).not.toContain('id="mfw-3"');
    expect(html).toMatch(/id="mds-4"[^>]*value="1000"/);
    expect(html).toMatch(/id="mdd-4"[^>]*value="4000"/);
    expect(html).not.toContain('id="mv-4"'); // a dose limit has no Avoid / Caution level
    expect(html).toContain('>mg/kg</span>'); // the per-kg entry shows its unit
    expect(html).toContain('Check dose');
  });
});

// ---------- The prescription form ----------

const item = (drug, extra = {}) => ({ id: `i-${drug}`, drug, form: 'tab', strength: '', dose: '', frequency: '1-0-1', frequencyText: '', timing: '', route: '', durationValue: null, durationUnit: '', instructions: '', ...extra });
const page = (items, vitals = {}) => ({
  visit: { id: 'v1', status: 'active', visitOn: '2026-10-04T00:00:00.000Z', vitals: { weightKg: null, ...vitals }, prescription: { items, notes: '', rev: 1, byName: 'Dr Sample', at: '2026-10-04T05:00:00.000Z', warningReasons: [] } },
  access: { canEdit: true },
  previousPrescription: null,
});
const form = (patient, items, vitals) =>
  at('/patients/p1/visits/v1', <PrescriptionForm patient={{ id: 'p1', medical: { allergies: 'None known' }, ...patient }} page={page(items, vitals)} recent={[]} onSaved={() => {}} onConflict={() => {}} onDirty={() => {}} onAppendDetails={() => {}} canAddSets />);

describe('the prescription form', () => {
  beforeEach(() => {
    answers['/medicine-safety'] = { list: list() };
  });

  it('a postnatal patient, breastfeeding not recorded: the warning says "if she is breastfeeding" and links to her details', () => {
    const html = form({ careType: 'postnatal', postnatal: { breastfeeding: '' } }, [item('Codeine', { strength: '30 mg', dose: '1' })]);
    expect(html).toContain('Medicine safety · breastfeeding not recorded');
    expect(html).toContain('Codeine – if she is breastfeeding');
    expect(html).toContain('Whether she is breastfeeding is not recorded.');
    expect(html).toContain('href="/patients/p1/edit"');
    expect(html).toContain('Record it in her details (opens in a new tab)');
    expect(html).not.toContain('Check again'); // only where the form can read her record again
    expect(html).toContain('Reason for going ahead (required to save)'); // Avoid: as for the pregnancy entries
    expect(html).toContain('The medicine safety list is a draft that no doctor has approved yet.');
  });

  it('recorded as breastfeeding: the warning without "if"; recorded as not breastfeeding: no warning', () => {
    const yes = form({ careType: 'postnatal', postnatal: { breastfeeding: 'yes' } }, [item('Codeine')]);
    expect(yes).toContain('Medicine safety · breastfeeding');
    expect(yes).toContain('Codeine – breastfeeding');
    expect(yes).not.toContain('if she is breastfeeding');
    const no = form({ careType: 'postnatal', postnatal: { breastfeeding: 'no' } }, [item('Codeine')]);
    expect(no).not.toContain('Codeine –');
    expect(no).not.toContain('Reason for going ahead');
  });

  it('recording breastfeeding from the warning’s link: the open prescription follows her record, and keeps what was typed', () => {
    const typed = [item('Codeine', { strength: '30 mg', dose: '1' })];
    const withReload = (patient) =>
      at(
        '/patients/p1/visits/v1',
        <PrescriptionForm patient={{ id: 'p1', medical: { allergies: 'None known' }, ...patient }} page={page(typed)} recent={[]} onSaved={() => {}} onConflict={() => {}} onDirty={() => {}} onAppendDetails={() => {}} canAddSets onRecheckPatient={() => {}} />,
      );
    // Before: the warning, the link and "Check again"
    const before = withReload({ careType: 'postnatal', postnatal: { breastfeeding: '' } });
    expect(before).toContain('this warning follows her record when you come back');
    expect(before).toMatch(/<button type="button" class="btn btn-link plan-inline-link">Check again<\/button>/);
    expect(before).toContain('Reason for going ahead (required to save)');
    // After she is recorded as not breastfeeding and her record is read again (the same form, the same medicines):
    const after = withReload({ careType: 'postnatal', postnatal: { breastfeeding: 'no' } });
    expect(after).toContain('value="Codeine"'); // what was typed stays
    expect(after).not.toContain('if she is breastfeeding');
    expect(after).not.toContain('Reason for going ahead');
    expect(after).not.toContain('Check again');
    // Recorded as breastfeeding: the warning stays, without "if" and without the link
    const yes = withReload({ careType: 'postnatal', postnatal: { breastfeeding: 'yes' } });
    expect(yes).toContain('Codeine – breastfeeding');
    expect(yes).not.toContain('Record it in her details');
  });

  it('a list with no entries for this patient never reads as "no warnings": it says what was not checked', () => {
    // A list a doctor approved before the breastfeeding, newborn and dose entries existed: pregnancy entries only
    const old = list({ entries: ENTRIES.filter((e) => e.kind === 'medicine' || e.kind === 'combination'), status: 'approved', approvedByName: 'Dr Sample', builtInVersion: null, newBuiltIn: 76 });
    answers['/medicine-safety'] = { list: old };
    const postnatal = form({ careType: 'postnatal', postnatal: { breastfeeding: '' } }, [item('Codeine', { strength: '30 mg', dose: '1' })]);
    expect(postnatal).not.toContain('No warnings from the medicine safety list');
    expect(postnatal).toContain('Not checked: this hospital’s medicine safety list has no entries for breastfeeding and no dose limits yet.');
    expect(postnatal).toContain('A doctor can add them on the Medicine safety page.');
    expect(postnatal).not.toContain('Dose check:'); // nothing is said about a check that does not happen
    const baby = form({ careType: 'newborn', medical: undefined, newborn: { birthAt: new Date(2026, 8, 29, 9).toISOString(), birthWeightGrams: 3000 } }, [item('Ceftriaxone', { form: 'inj' })]);
    expect(baby).not.toContain('No warnings from the medicine safety list');
    expect(baby).toContain('has no entries for newborn babies and no dose limits for babies yet');
    // An antenatal patient is covered by the old list – only the doses are not
    const antenatal = form({ careType: 'antenatal', pregnancy: { effectiveEdd: '2027-03-01T00:00:00.000Z' } }, [item('Paracetamol', { strength: '1 g', dose: '2', frequency: '1-1-1-1' })]);
    expect(antenatal).toContain('No warnings from the medicine safety list (18 weeks pregnant).');
    expect(antenatal).toContain('Not checked: this hospital’s medicine safety list has no dose limits yet.');
    // With a warning on screen the line is still there
    const both = form({ careType: 'antenatal', pregnancy: { effectiveEdd: '2027-03-01T00:00:00.000Z' } }, [item('Losartan')]);
    expect(both).toContain('Angiotensin receptor blockers');
    expect(both).toContain('has no dose limits yet');
    // Nothing typed yet: nothing is said
    expect(form({ careType: 'postnatal', postnatal: { breastfeeding: '' } }, [])).not.toContain('Not checked');
    // The full list: "No warnings" is said, and nothing is missing
    answers['/medicine-safety'] = { list: list() };
    const full = form({ careType: 'postnatal', postnatal: { breastfeeding: 'yes' } }, [item('Paracetamol', { strength: '500 mg', dose: '1' })]);
    expect(full).toContain('No warnings from the medicine safety list (breastfeeding).');
    expect(full).not.toContain('Not checked');
  });

  it('a dose above the usual maximum is a caution the doctor can keep: no reason is asked, and the limits of the check are said', () => {
    const html = form({ careType: 'gynaecology' }, [item('Paracetamol', { strength: '650 mg', dose: '2', frequency: '1-1-1-1' })]);
    expect(html).toContain('Check dose');
    expect(html).toContain('Paracetamol: above the usual maximum of 1 g a dose and 4 g a day');
    expect(html).toContain('As written: 1.3 g a dose, 5.2 g a day. Usual maximum: 1 g a dose, 4 g a day.');
    expect(html).not.toContain('Reason for going ahead');
    expect(html).toContain('It is limited: it stays silent when it cannot work the dose out');
    expect(html).toContain('an injection with no dose written');
    expect(html).toContain('with “SOS” or “Other – write it” (for example “every 8 hours”) only the single dose is checked');
    expect(html).toContain('No warning does not mean the dose is right.');
    expect(html).toContain('The limits are a draft until a doctor approves the list.');
    // The usual dose: no warning, but the note about the check stays
    const fine = form({ careType: 'gynaecology' }, [item('Paracetamol', { strength: '500 mg', dose: '1', frequency: '1-1-1' })]);
    expect(fine).not.toContain('Check dose');
    expect(fine).toContain('It is limited');
  });

  it('a baby: newborn entries by age, and the dose per kg of the weight recorded at the visit', () => {
    // Born at 08:30 on 24 Sep (this computer's clock), seen on 4 Oct: 10 days old, as the patient's header says
    const baby = { careType: 'newborn', medical: undefined, newborn: { birthAt: new Date(2026, 8, 24, 8, 30).toISOString(), birthWeightGrams: 3000 } };
    const html = form(baby, [item('Ceftriaxone', { form: 'inj' }), item('Gentamicin', { form: 'inj', dose: '30 mg', frequency: '1-0-0' })], { weightKg: 3.2 });
    expect(html).toContain('Medicine safety · baby, 10 days old');
    expect(html).toContain('Ceftriaxone in the first 28 days');
    expect(html).toContain('Gentamicin (baby): above the usual maximum of 7.5 mg/kg a dose and 7.5 mg/kg a day');
    expect(html).toContain('for a weight of 3.2 kg (recorded at this visit)');
    expect(html).toContain('per kg of the baby’s weight');
    expect(html).not.toContain('No weight is recorded for this baby');
    // No weight at the visit: the birth weight is used, and said
    expect(form(baby, [item('Gentamicin', { form: 'inj', dose: '30 mg', frequency: '1-0-0' })])).toContain('for a weight of 3 kg (the birth weight');
    // No weight at all: nothing can be checked per kg, and the form says so for this baby
    const unweighed = form({ ...baby, newborn: { birthAt: baby.newborn.birthAt } }, [item('Gentamicin', { form: 'inj', dose: '30 mg', frequency: '1-0-0' })]);
    expect(unweighed).not.toContain('Check dose');
    expect(unweighed).toContain('No weight is recorded for this baby, so the doses are not checked. Record the weight in Visit details');
  });

  it('an antenatal patient still gets the pregnancy warnings, with her weeks', () => {
    const html = form({ careType: 'antenatal', pregnancy: { effectiveEdd: '2027-03-01T00:00:00.000Z' } }, [item('Losartan'), item('Codeine')]);
    expect(html).toContain('Medicine safety · 18 weeks pregnant');
    expect(html).toContain('Angiotensin receptor blockers');
    expect(html).not.toContain('breastfeeding');
  });
});

describe('stock beside each medicine', () => {
  const rows = [
    { key: 'a', ...item('Dolo 650') },
    { key: 'b', ...item('Orofer XT') },
    { key: 'c', ...item('Labetalol') },
    { key: 'd', ...item('Something else') },
  ];
  const status = { a: 'in', b: 'low', c: 'out', d: null };
  const render = (stockOf) => words(renderToStaticMarkup(<MedicineRows rows={rows.map((r) => ({ ...r, durationValue: '' }))} setRows={() => {}} fieldError={() => undefined} names={[]} stockOf={stockOf} />));

  it('says "In the pharmacy" or "Not in stock" as a status pill, and nothing without a confident match', () => {
    const html = render((r) => status[r.key]);
    expect(html.match(/pill pill-stable[^>]*>.*?In the pharmacy</s)).toBeTruthy();
    expect(html).toContain('In the pharmacy – low stock');
    expect(html.match(/pill pill-inactive[^>]*>.*?Not in stock</s)).toBeTruthy();
    expect(html.match(/class="pill /g)).toHaveLength(3); // nothing beside the fourth medicine
  });

  it('shows nothing at all without the stock check (a prescription set, or a hospital with no pharmacy list)', () => {
    expect(render(null)).not.toContain('class="pill ');
    expect(render(() => null)).not.toContain('class="pill ');
  });
});

describe('To approve: new built-in entries that a doctor has not added yet', () => {
  it('lists them for a list a doctor approved or changed, so the missing checks are not only on the Medicine safety page', () => {
    // The other libraries have loaded, with nothing waiting
    Object.assign(answers, { '/care-plans/templates': { templates: [] }, '/red-flag-rules': {}, '/consent-forms': { forms: [] }, '/prescription-sets': { sets: [] }, '/lab-packages': { packages: [] } });
    answers['/medicine-safety'] = { list: list({ status: 'approved', approvedByName: 'Dr Sample', builtInVersion: null, newBuiltIn: 76 }) };
    const html = at('/library/approvals', <ApprovalsPage />);
    expect(html).toContain('Medicine safety list – 76 new built-in draft entries to add and review');
    expect(html).toContain('href="/medicine-safety"');
    expect(html).not.toContain('All approved');
    // Nothing new to add, and approved: nothing is waiting
    answers['/medicine-safety'] = { list: list({ status: 'approved', approvedByName: 'Dr Sample', builtInVersion: null, newBuiltIn: 0 }) };
    expect(at('/library/approvals', <ApprovalsPage />)).toContain('All approved');
  });
});

describe('breastfeeding in the safety strip', () => {
  const strip = (patient) => words(renderToStaticMarkup(<SafetyStrip patient={{ medical: { allergies: 'None known', bloodGroup: 'O+' }, ...patient }} />));
  it('postnatal patients only: yes, no, or a prompt to ask', () => {
    expect(strip({ careType: 'postnatal', postnatal: { breastfeeding: 'yes' } })).toContain('>Breastfeeding<');
    expect(strip({ careType: 'postnatal', postnatal: { breastfeeding: 'no' } })).toContain('Not breastfeeding');
    expect(strip({ careType: 'postnatal', postnatal: { breastfeeding: '' } })).toContain('Breastfeeding not recorded – ask');
    expect(strip({ careType: 'gynaecology', postnatal: { breastfeeding: 'yes' } })).not.toContain('reastfeeding');
    expect(strip({ careType: 'postnatal' })).not.toContain('reastfeeding'); // someone who may not see it
    // The strip says what is recorded; it does not promise that her medicines were checked
    expect(strip({ careType: 'postnatal', postnatal: { breastfeeding: 'yes' } })).not.toContain('are checked');
  });
});
