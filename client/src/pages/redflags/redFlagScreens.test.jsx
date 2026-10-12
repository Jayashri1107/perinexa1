// The red-flag screens after 4 Oct 2026: rules listed by type of care, the offer of new built-in rules, the edit
// page's "Applies to", lab checks and baby's age, and a flag shown with its value, where and when it was recorded
// and its rule. The website has no browser test setup, so each screen is rendered to HTML (react-dom/server) from
// fake answers. All fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answers = {};
let roles = ['doctor'];
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles, tenantName: 'Sample Hospital' }, user: { name: 'Dr Sample' } }) }));

const { RedFlagRulesPage } = await import('./RedFlagRulesPage.jsx');
const { RedFlagRulesEditPage } = await import('./RedFlagRulesEditPage.jsx');
const { RedFlagCard, RedFlagItems } = await import('./RedFlagList.jsx');
const { FlagCountPill, RedFlagsScopeNote, RedFlagsSection, redFlagsEmptyText } = await import('../worklist/WorklistSections.jsx');
const { draftsFrom } = await import('../library/ApprovalsPage.jsx');
const { describeAudit } = await import('../../components/auditFormat.js');

const rule = (r) => ({ level: 'watch', message: '', source: 'Sample source', fromWeek: null, toWeek: null, fromDay: null, toDay: null, ...r });
const RULES = [
  rule({ key: 'pe_sys', label: 'Possible pre-eclampsia', level: 'urgent', appliesTo: ['antenatal'], conditions: [{ factor: 'bpSystolic', op: 'gte', value: 140 }, { factor: 'urineAlbumin', grade: '1+' }], fromWeek: 20 }),
  rule({ key: 'old_rule', label: 'A rule from before', conditions: [{ factor: 'hb', op: 'lt', value: 7 }] }), // saved before rules had "applies to"
  rule({ key: 'lab_platelets_low', label: 'Low platelets', level: 'urgent', appliesTo: ['antenatal', 'postnatal'], conditions: [{ factor: 'labPlatelets', op: 'lt', value: 1 }] }),
  rule({ key: 'pn_fever', label: 'Fever after delivery', level: 'urgent', appliesTo: ['postnatal'], conditions: [{ factor: 'temperatureF', op: 'gte', value: 100.4 }] }),
  rule({ key: 'nb_bili_day1', label: "High bilirubin for the baby's age", level: 'urgent', appliesTo: ['newborn'], conditions: [{ factor: 'labBilirubinTotal', op: 'gt', value: 11.7 }], fromDay: 1, toDay: 1 }),
];
const ruleSet = (extra = {}) => ({ id: 'rs1', rules: RULES, status: 'draft', version: 2, builtInVersion: 2, updatedAt: '2026-10-04T05:00:00.000Z', updatedByName: 'Built-in draft', canEdit: true, canApprove: true, newBuiltIn: 0, ...extra });
const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const at = (path, node) => words(renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>));

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  roles = ['doctor'];
});

describe('the red-flag rules page', () => {
  it('lists the rules by type of care, says where the values come from and what is not checked, and that they are a draft', () => {
    answers['/red-flag-rules'] = { ruleSet: ruleSet() };
    const html = at('/care-plans/red-flags', <RedFlagRulesPage />);
    const headings = [...html.matchAll(/<h2 id="rf-rules-(\w+)"[^>]*>([^<]*)<\/h2><span[^>]*>([^<]*)<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
    expect(headings).toEqual([
      ['antenatal', 'Pregnancy (antenatal)', '3 rules'],
      ['postnatal', 'After delivery (postnatal)', '2 rules'],
      ['newborn', 'Newborn', '1 rule'],
    ]);
    expect(html).toContain('Draft – not approved for clinical use.');
    expect(html).toContain('each rule names its source');
    expect(html).toContain("Baby's total bilirubin (lab) over 11.7 mg/dL, baby 1 day old");
    expect(html).toContain('BP systolic at least 140 mmHg and Urine albumin 1+ or more, from 20 weeks');
    expect(html).toContain('Applies to: Pregnancy (antenatal), After delivery (postnatal)'); // the rule for two types says so
    expect(html).toContain('from the lab results reported in this pregnancy or episode of care');
    expect(html).toContain('from the nursing chart');
    expect(html).toContain('Not checked automatically: symptoms written as text');
    expect(html).toContain('No rule applies to: Gynaecology, Infertility, Abortion (pregnancy loss).');
    expect(html).not.toContain('New built-in rules are available');
    // What an episode of care is, which reading counts, and how close the values of one rule must be
    expect(html).toContain('after delivery, since the delivery (the last 6 weeks when no delivery date is on the record)');
    expect(html).toContain('only the newer reading raises a flag');
    expect(html).toContain('within 7 days of each other');
    expect(html).not.toContain('New built-in draft');
    expect(html).not.toMatch(/!/); // no exclamation marks
  });

  it('built-in rules a doctor added stay marked as an unreviewed built-in draft until the rules are approved', () => {
    answers['/red-flag-rules'] = { ruleSet: ruleSet({ builtInVersion: null, updatedByName: 'Dr Other', builtInAdded: ['pn_fever', 'nb_bili_day1'] }) };
    const html = at('/care-plans/red-flags', <RedFlagRulesPage />);
    expect(html).toContain('2 rules below are marked "New built-in draft": added from the built-in rules, not written or reviewed by a doctor of this hospital.');
    expect(html).toContain('They were prepared from published guidance');
    expect(html).toContain('are not a clinical review');
    expect(html).not.toContain('The rules have changed. A doctor must review and approve them.');
    expect((html.match(/New built-in draft<\/span>/g) ?? []).length).toBe(2);
    expect(html).toMatch(/Fever after delivery<\/span> <span class="pill pill-watch[^"]*">.*?New built-in draft<\/span>/s);
    // A draft a doctor changed without adding built-in rules says only that it changed
    answers['/red-flag-rules'] = { ruleSet: ruleSet({ builtInVersion: null, updatedByName: 'Dr Other', builtInAdded: [] }) };
    const own = at('/care-plans/red-flags', <RedFlagRulesPage />);
    expect(own).toContain('The rules have changed. A doctor must review and approve them.');
    expect(own).not.toContain('New built-in draft');
    // Approved rules carry no such mark
    answers['/red-flag-rules'] = { ruleSet: ruleSet({ status: 'approved', approvedByName: 'Dr Sample', approvedAt: '2026-10-04T06:00:00.000Z', builtInVersion: null, builtInAdded: [] }) };
    expect(at('/care-plans/red-flags', <RedFlagRulesPage />)).not.toContain('New built-in draft');
  });

  it('offers a doctor the new built-in rules of rules that were approved or changed – never to others', () => {
    answers['/red-flag-rules'] = {
      ruleSet: ruleSet({ status: 'approved', approvedByName: 'Dr Sample', approvedAt: '2026-10-01T05:00:00.000Z', builtInVersion: 1, newBuiltIn: 42, newBuiltInCareTypes: ['antenatal', 'postnatal', 'newborn', 'abortion'] }),
    };
    const html = at('/care-plans/red-flags', <RedFlagRulesPage />);
    expect(html).toContain('New built-in rules are available:');
    // The offer names the types of care the new rules are for (the server says which)
    expect(html).toContain('42 draft rules, for: Pregnancy (antenatal), After delivery (postnatal), Newborn, Abortion (pregnancy loss). Rules that a doctor approved or changed are never');
    expect(html).toContain('never changed by themselves');
    expect(html).toContain('Add them as a draft');
    expect(html).toContain('Approved by');
    roles = ['nurse'];
    answers['/red-flag-rules'] = { ruleSet: ruleSet({ status: 'approved', approvedByName: 'Dr Sample', canEdit: false, canApprove: false, newBuiltIn: 0 }) };
    const forNurse = at('/care-plans/red-flags', <RedFlagRulesPage />);
    expect(forNurse).not.toContain('Add them as a draft');
    expect(forNurse).not.toContain('Edit rules');
  });

  it('an empty rule set says that no flags will be raised', () => {
    answers['/red-flag-rules'] = { ruleSet: ruleSet({ rules: [] }) };
    expect(at('/care-plans/red-flags', <RedFlagRulesPage />)).toContain('No rules – no red flags will be raised.');
  });

  it('the To approve list names the new built-in rules to add, and the audit log says how many were added', () => {
    const names = (rs) => draftsFrom({ redFlags: { ruleSet: rs } }).map((d) => [d.key, d.name, d.to]);
    expect(names({ status: 'approved', canApprove: true, newBuiltIn: 34 })).toEqual([['redflags-new', 'Red-flag rules – 34 new built-in draft rules to add and review', '/care-plans/red-flags']]);
    expect(names({ status: 'approved', canApprove: true, newBuiltIn: 1 })[0][1]).toBe('Red-flag rules – 1 new built-in draft rule to add and review');
    expect(names({ status: 'draft', canApprove: true, newBuiltIn: 3, updatedAt: '2026-10-04T05:00:00.000Z' }).map((r) => r[0])).toEqual(['redflags', 'redflags-new']);
    expect(names({ status: 'approved', canApprove: true, newBuiltIn: 0 })).toEqual([]);
    expect(names({ status: 'approved', canApprove: false, newBuiltIn: 34 })).toEqual([]);
    expect(describeAudit({ action: 'RED_FLAG_RULES_UPDATED', details: { version: 2, rules: 55, added: 34 } })).toBe('Version 2 (55 rules) – 34 built-in rules added');
    expect(describeAudit({ action: 'RED_FLAG_RULES_UPDATED', details: { version: 3, rules: 55 } })).toBe('Version 3 (55 rules)');
  });
});

describe('the rule editor', () => {
  it('has "Applies to" for every rule, weeks only on pregnancy rules and the baby\'s age only on newborn rules', () => {
    answers['/red-flag-rules'] = { ruleSet: ruleSet() };
    const html = at('/care-plans/red-flags/edit', <RedFlagRulesEditPage />);
    expect((html.match(/Applies to \(types of care\)/g) ?? []).length).toBe(RULES.length);
    // Rule 1 (pregnancy): weeks, no days. Rule 2 (saved before "applies to"): shown as a pregnancy rule
    expect(html).toMatch(/id="rfw-0"[^>]*value="20"/);
    expect(html).not.toContain('id="rfd-0"');
    expect(html).toContain('id="rfw-1"');
    // Rule 3 (pregnancy and postnatal): weeks. Rule 4 (postnatal): neither. Rule 5 (newborn): days, no weeks
    expect(html).toContain('id="rfw-2"');
    expect(html).not.toContain('id="rfw-3"');
    expect(html).not.toContain('id="rfd-3"');
    expect(html).not.toContain('id="rfw-4"');
    expect(html).toMatch(/id="rfd-4"[^>]*value="1"/);
    expect(html).toMatch(/id="rtd-4"[^>]*value="1"/);
    expect(html).toContain('0 is the first 24 hours.');
    // The unit of both age fields is in their labels (the "days" beside the box is hidden from screen readers)
    expect(html).toMatch(/<label for="rfd-4">From baby's age \(days\)<\/label>/);
    expect(html).toMatch(/<label for="rtd-4">To baby's age \(days\)<\/label>/);
    expect(html).toContain('Leave empty for no upper age.');
    expect(html).toContain('for a baby, since birth');
    expect(html).toContain('within 7 days of each other');
    // The list of rules can be narrowed to one type of care, with how many rules each has
    expect(html).toMatch(/After delivery \(postnatal\) <span class="tabular">\(2\)<\/span>/);
    expect(html).toMatch(/Gynaecology <span class="tabular">\(0\)<\/span>/);
    expect(html).not.toMatch(/!/);
  });

  it('lists the checks in groups, with the lab results as their own group', () => {
    answers['/red-flag-rules'] = { ruleSet: ruleSet() };
    const html = at('/care-plans/red-flags/edit', <RedFlagRulesEditPage />);
    const select = html.match(/<select id="rc-0-0-f"[^>]*>(.*?)<\/select>/s)[1];
    expect([...select.matchAll(/<optgroup label="([^"]*)"/g)].map((m) => m[1])).toEqual([
      'Vital signs – a visit, or the nursing chart in hospital',
      'Recorded at a visit',
      'Worked out',
      'Lab results',
      'On her record – pregnancy-loss care',
    ]);
    const record = select.match(/<optgroup label="On her record – pregnancy-loss care">(.*?)<\/optgroup>/s)[1];
    expect([...record.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]])).toEqual([
      ['lossLocation', 'Pregnancy location'],
      ['lossRuptureSigns', 'Signs of rupture'],
      ['lossBleeding', 'Bleeding'],
      ['lossFeverDischarge', 'Fever with foul-smelling discharge'],
    ]);
    const lab = select.match(/<optgroup label="Lab results">(.*?)<\/optgroup>/s)[1];
    expect([...lab.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toContain('labBilirubinTotal');
    expect(lab).toContain('Haemoglobin (lab)');
    // The check chosen in a rule is selected in its own list
    expect(html).toMatch(/<select id="rc-4-0-f"[^>]*>.*?<option value="labBilirubinTotal" selected="">/s);
  });

  it('says at once when a check does not exist for a ticked type of care', () => {
    const wrong = rule({ key: 'wrong', label: 'Wrong rule', appliesTo: ['postnatal'], conditions: [{ factor: 'fetalHeartRate', op: 'lt', value: 110 }] });
    answers['/red-flag-rules'] = { ruleSet: ruleSet({ rules: [wrong] }) };
    const html = at('/care-plans/red-flags/edit', <RedFlagRulesEditPage />);
    expect(html).toContain('Fetal heart rate is not checked for postnatal patients – untick that type of care or choose another check');
    // A rule that comes without any type of care (saved before rules had this) opens as a pregnancy rule
    answers['/red-flag-rules'] = { ruleSet: ruleSet({ rules: [{ ...wrong, appliesTo: [] }] }) };
    const legacy = at('/care-plans/red-flags/edit', <RedFlagRulesEditPage />);
    expect(legacy).toMatch(/<input type="checkbox" checked=""\/><span>Pregnancy \(antenatal\)<\/span>/);
    expect(legacy).not.toContain('is not checked for');
  });

  it('is for doctors only', () => {
    answers['/red-flag-rules'] = { ruleSet: ruleSet({ canEdit: false }) };
    expect(at('/care-plans/red-flags/edit', <RedFlagRulesEditPage />)).toContain('Only doctors can change the red-flag rules.');
  });
});

describe("Today's red-flag list", () => {
  const rules = { status: 'draft', version: 2, approvedByName: null, careTypes: ['antenatal', 'postnatal', 'newborn'] };

  it('names the types of care that are checked and those that are not – never "every patient in hospital"', () => {
    const html = at('/', <RedFlagsScopeNote rules={rules} />);
    expect(html).toContain('Checked – the types of care that have a rule: Pregnancy (antenatal), After delivery (postnatal), Newborn.');
    expect(html).toContain('Not checked – no rule applies: Gynaecology, Infertility, Abortion (pregnancy loss).');
    expect(html).toContain('from a lab result alone, or of a patient who is not in pregnancy care – are listed for 6 weeks after the value was recorded');
    expect(html).not.toMatch(/every patient in hospital is checked/i);
    // Rules approved before the new built-in rules were added: only pregnancy care is checked, and the page says so
    const old = at('/', <RedFlagsScopeNote rules={{ status: 'approved', version: 1, approvedByName: 'Dr Sample', careTypes: ['antenatal'] }} />);
    expect(old).toContain('Checked – the types of care that have a rule: Pregnancy (antenatal). Not checked – no rule applies: After delivery (postnatal), Newborn,');
    expect(old).not.toMatch(/!/);
  });

  it('an empty list says who was checked, so it is not read as "nobody has a red flag"', () => {
    expect(redFlagsEmptyText(rules)).toBe(
      'No red flags from the latest visits, lab results or nursing charts. Checked – the types of care that have a rule: Pregnancy (antenatal), After delivery (postnatal), Newborn. Not checked – no rule applies: Gynaecology, Infertility, Abortion (pregnancy loss).',
    );
    expect(redFlagsEmptyText(undefined)).toBe('No red flags from the latest visits, lab results or nursing charts.');
    // The box shows its heading and count; it is closed until clicked, like every list on Today
    const html = at('/', <RedFlagsSection data={{ redFlags: [], rules }} />);
    expect(html).toContain('Red flags');
    expect(html).toContain('aria-label="0 items"');
  });
});

describe('a red flag on a page', () => {
  const flags = [
    {
      key: 'lab_hb_severe',
      label: 'Severe anaemia',
      level: 'urgent',
      message: 'Hb below 7 g/dL. Needs urgent assessment.',
      detail: 'Haemoglobin (lab) 6.4 g/dL',
      rule: 'Haemoglobin (lab) under 7 g/dL',
      sources: [{ source: 'lab', on: '2026-10-03T00:00:00.000Z', orderId: 'o1' }],
    },
    {
      key: 'pe_lab_sys',
      label: 'Possible pre-eclampsia',
      level: 'urgent',
      message: 'Assess the same day.',
      detail: 'BP 146/94 mmHg, Urine albumin (lab) 1+',
      rule: 'BP systolic at least 140 mmHg and Urine albumin (lab) 1+ or more, from 20 weeks',
      sources: [
        { source: 'visit', on: '2026-10-04T00:00:00.000Z', visitId: 'v1' },
        { source: 'lab', on: '2026-10-01T00:00:00.000Z', orderId: 'o2' },
      ],
    },
    { key: 'postdates', label: '41 weeks or more', level: 'urgent', message: 'Plan delivery.', detail: 'Weeks of pregnancy today 41 weeks', rule: 'Weeks of pregnancy today at least 41 weeks', sources: [] },
  ];

  it('always shows the value, where and when it was recorded (a link to it) and the rule', () => {
    const html = at('/patients/p1', <RedFlagCard redFlags={{ flags, rules: { status: 'draft', version: 2, approvedByName: null } }} patientId="p1" />);
    expect(html).toContain('Haemoglobin (lab) 6.4 g/dL');
    expect(html).toMatch(/ · from <a href="\/patients\/p1\/lab\/o1"[^>]*>the lab result of 3 Oct 2026<\/a>/);
    expect(html).toMatch(/from <a href="\/patients\/p1\/visits\/v1"[^>]*>the visit on 4 Oct 2026<\/a> and <a href="\/patients\/p1\/lab\/o2"[^>]*>the lab result of 1 Oct 2026<\/a>/);
    expect(html).toContain('Rule: Haemoglobin (lab) under 7 g/dL');
    expect(html).toContain('Rule: Weeks of pregnancy today at least 41 weeks');
    expect(html).toContain('Hb below 7 g/dL. Needs urgent assessment.');
    expect(html).toContain('Based on draft rules that no doctor has approved yet – use as a reminder only.');
    expect(html).toContain('What is not checked');
    expect(html).toContain('symptoms written as text');
    // Level: colour, icon and word
    expect((html.match(/>Urgent</g) ?? []).length).toBe(3);
    expect(html).not.toMatch(/!/);
  });

  it('in a short list the advice is left out; the value, its date and the rule stay', () => {
    const html = at('/', <RedFlagItems flags={flags} brief patientId="p1" />);
    expect(html).not.toContain('Needs urgent assessment');
    expect(html).toContain('the lab result of 3 Oct 2026');
    expect(html).toContain('Rule: Haemoglobin (lab) under 7 g/dL');
    // Without the patient's id the place is plain words (no link)
    const plain = at('/', <RedFlagItems flags={flags.slice(0, 1)} brief />);
    expect(plain).toContain(' · from the lab result of 3 Oct 2026');
    expect(plain).not.toContain('<a ');
  });

  it('nothing is shown without flags; approved rules name the doctor; the card says which values it looked at', () => {
    expect(at('/', <RedFlagCard redFlags={{ flags: [], rules: { status: 'draft' } }} />)).toBe('');
    expect(at('/', <RedFlagCard redFlags={undefined} />)).toBe('');
    const html = at('/', <RedFlagCard redFlags={{ flags: flags.slice(0, 1), rules: { status: 'approved', approvedByName: 'Dr Sample' } }} about="From the values saved at this visit" />);
    expect(html).toContain('Rules approved by Dr Sample.');
    expect(html).toContain('From the values saved at this visit');
    // A second card on the same page has its own title and heading id (the visit page's other flags of the record)
    const other = at('/', <RedFlagCard redFlags={{ flags: flags.slice(0, 1), rules: { status: 'draft' } }} title="Other red flags on the record" titleId="rf-other-title" />);
    expect(other).toMatch(/aria-labelledby="rf-other-title"/);
    expect(other).toMatch(/<h2 id="rf-other-title">.*Other red flags on the record<\/h2>/s);
    // The same rule raised by two readings (the visit's and the nursing chart's) is two lines
    const twice = [flags[0], { ...flags[0], detail: 'Haemoglobin (lab) 6.6 g/dL' }];
    expect((at('/', <RedFlagItems flags={twice} brief />).match(/<li>/g) ?? []).length).toBe(2);
    expect(at('/', <FlagCountPill flags={[]} />)).toBe('');
    expect(at('/', <FlagCountPill flags={flags} />)).toMatch(/Red flags 3/);
    expect(at('/', <FlagCountPill flags={flags.slice(0, 1)} />)).toMatch(/Red flag</);
  });
});
