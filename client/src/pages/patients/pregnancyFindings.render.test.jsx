// Findings in this pregnancy on the screens (rendered to HTML, no browser): the Overview's Pregnancy card, the tick
// boxes on the edit form, the risk card's "not measured yet" line and the visit page's offer. Fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FindingOffers } from '../visits/FindingOffers.jsx';
import { PlanAlerts } from './CarePlanTab.jsx';
import { PregnancyFindings } from './PatientDetailPage.jsx';
import { PatientForm } from './PatientForm.jsx';
import { RiskCard } from './RiskCard.jsx';

const html = (node) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const entry = (key, over = {}) => ({ key, byName: 'Dr Sample', at: '2026-09-28T06:00:00.000Z', via: 'record', endedAt: null, endedByName: null, current: true, ...over });
const FULL = { canEditIdentity: true, canEditNewborn: true, canEditClinical: true };

const patient = (over = {}) => ({
  id: 'p1',
  careType: 'antenatal',
  fullName: 'Asha Sample',
  mrn: 'P-000001',
  currentAge: 28,
  pregnancy: {
    lmp: null,
    scanEdd: '2027-03-01T00:00:00.000Z',
    effectiveEdd: '2027-03-01T00:00:00.000Z',
    findings: [entry('gdm'), entry('hypertension', { via: 'visit', byName: 'RMO Sample' }), entry('multiple', { current: false, endedAt: '2026-10-01T06:00:00.000Z', endedByName: 'RMO Sample' })],
    readings: { lowestHb: { value: 9.8, on: '2026-09-12T00:00:00.000Z', source: 'lab' }, latestBp: { systolic: 150, diastolic: 96, on: '2026-09-28T00:00:00.000Z' } },
  },
  obstetric: { gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0, pastComplications: [], complicationsReviewed: false },
  medical: { bloodGroup: 'B+', heightCm: 160, weightKg: 60, allergies: 'None known', conditions: [], conditionsReviewed: true, otherConditions: '' },
  notes: '',
  access: FULL,
  ...over,
});

describe('the Overview shows the findings of this pregnancy', () => {
  it('each ticked finding with who recorded it and when, the readings, and the earlier entries', () => {
    const out = html(<PregnancyFindings patient={patient()} />);
    expect(out).toContain('Findings in this pregnancy');
    expect(out).toMatch(/Gestational diabetes \(GDM\)<\/span><span class="muted"> – Dr Sample, /);
    expect(out).toMatch(/High blood pressure in this pregnancy<\/span><span class="muted"> – RMO Sample, [^<]*\(confirmed at a visit\)/);
    expect(out).toContain('Lowest Hb');
    expect(out).toMatch(/9\.8 g\/dL · [^<]* \(lab result\)/);
    expect(out).toMatch(/150\/96 · /);
    expect(out).toContain('Earlier entries (1)');
    expect(out).toMatch(/Twins or more<\/span> <span class="muted">– recorded by Dr Sample on [^<]*, removed by RMO Sample on /);
    expect(out).toContain('href="/patients/p1/edit"'); // those who may change it get the link
    expect(out).not.toMatch(/!/);
    // the hint promises only what the hospital's rules and template do – never "raises the level" for every finding
    expect(out).toContain("Each one counts for the risk level and the care plan as the hospital's risk rules and care-plan template say – the Risk card shows the reason.");
    expect(out).not.toMatch(/raises the risk level|switches on its care-plan items/);
    expect(out).not.toContain('older version of the template');
  });

  it('says so when her care plan has no items for a ticked finding, with the way to the plan update', () => {
    const behind = { exists: true, findingsWithoutItems: ['gdm', 'multiple'] };
    const out = html(<PregnancyFindings patient={patient({ carePlanSummary: behind })} />);
    expect(out).toContain('Her care plan has no items yet for: Gestational diabetes (GDM), Twins or more. It was built from an older version of the template.');
    expect(out).toMatch(/<a href="\/patients\/p1\/care-plan"[^>]*>Update the plan on the Care plan tab<\/a> to add them\./);
    // someone who cannot change her plan is told who does
    const nurse = html(<PregnancyFindings patient={patient({ carePlanSummary: behind, access: { ...FULL, canEditClinical: false } })} />);
    expect(nurse).toMatch(/The treating doctor or an RMO updates it on the <a href="\/patients\/p1\/care-plan"[^>]*>Care plan tab<\/a>\./);
    expect(nurse).not.toContain('Update the plan on the Care plan tab');
    // the summary the page holds after a plan change wins over the one loaded with the record
    expect(html(<PregnancyFindings patient={patient({ carePlanSummary: behind })} carePlanSummary={{ exists: true, findingsWithoutItems: [] }} />)).not.toContain('no items yet');
    expect(out).not.toMatch(/!/);
  });

  it('says "None recorded" when nothing is ticked, and gives no edit link to someone who cannot change it', () => {
    const out = html(<PregnancyFindings patient={patient({ pregnancy: { findings: [], readings: null }, access: { ...FULL, canEditClinical: false } })} />);
    expect(out).toContain('None recorded.');
    expect(out).toContain('The doctor or an RMO ticks a finding in Edit details.');
    expect(out).not.toContain('href=');
    expect(out).not.toContain('Earlier entries');
    expect(out).not.toContain('Lowest Hb');
  });
});

describe('the edit form has the tick boxes', () => {
  const boxes = (out) => [...out.matchAll(/<label class="check pf-finding-check"><input type="checkbox"( checked="")?[^>]*\/><span>([^<]*)/g)].map((m) => [m[2], Boolean(m[1])]);

  it('ticked as on the record, with who recorded each; an ended finding is not ticked', () => {
    const out = html(<PatientForm patient={patient()} access={FULL} onSubmit={() => {}} submitLabel="Save changes" />);
    expect(boxes(out)).toEqual([
      ['Gestational diabetes (GDM)', true],
      ['High blood pressure in this pregnancy', true],
      ['Twins or more', false],
      ['Low-lying placenta / placenta praevia', false],
      ['Bleeding in this pregnancy', false],
    ]);
    expect(out).toMatch(/Recorded by Dr Sample, /);
    expect(out).toMatch(/Recorded by RMO Sample, /);
    expect(out).toMatch(/a tick from voice entry is marked and is saved only when you save\./);
    expect(out).toMatch(/switches on the items her care plan has for it/);
    expect(out).not.toMatch(/switches on its care-plan items/);
    expect(out).toContain('not blood pressure that was high before the pregnancy');
    // one primary button on the form
    expect(out.match(/btn btn-primary/g)).toHaveLength(1);
  });

  it('only on an antenatal record, and only for those who may edit the clinical details', () => {
    expect(html(<PatientForm patient={patient({ careType: 'gynaecology' })} access={FULL} onSubmit={() => {}} />)).not.toContain('Findings in this pregnancy');
    expect(html(<PatientForm patient={patient()} access={{ canEditIdentity: true, canEditNewborn: true, canEditClinical: false }} onSubmit={() => {}} />)).not.toContain('Findings in this pregnancy');
    // registering: nothing ticked yet
    const fresh = html(<PatientForm careType="antenatal" part="clinical" access={FULL} onSubmit={() => {}} />);
    expect(boxes(fresh).map((b) => b[1])).toEqual([false, false, false, false, false]);
  });
});

describe('the risk card', () => {
  const risk = (over = {}) => ({
    level: 'low',
    computedLevel: 'low',
    reasons: [],
    missing: [],
    notMeasured: [],
    mayBeHigher: false,
    freeTextNotChecked: false,
    overrideNeedsReview: false,
    templateApproved: false,
    templateName: 'Standard antenatal care – DRAFT',
    templateVersion: 2,
    templateId: 't1',
    rulesChecked: 47,
    computedAt: '2026-09-28T06:00:00.000Z',
    override: null,
    ...over,
  });
  const card = (r) => html(<RiskCard patient={patient({ risk: r, riskOverrideHistory: [], access: { ...FULL, canOverrideRisk: true } })} onChanged={() => {}} />);

  it('lists the readings not measured yet next to the level, without calling the level incomplete', () => {
    const out = card(risk({ notMeasured: ['Haemoglobin (Hb)', 'Blood pressure'] }));
    expect(out).toContain('Low-risk');
    expect(out).toContain('<strong>Not measured yet in this pregnancy:</strong> Haemoglobin (Hb) · Blood pressure.');
    expect(out).not.toContain('Still to record');
    expect(card(risk())).not.toContain('Not measured yet');
    expect(card(risk({ notMeasured: undefined }))).not.toContain('Not measured yet'); // a result from before this existed
  });

  it("says so when a ticked finding has no rule in the hospital's rules (it was not counted)", () => {
    const out = card(risk({ findingsNotChecked: ['gdm'] }));
    expect(out).toContain("<strong>Doctor to assess:</strong> Gestational diabetes (GDM) – ticked for this pregnancy, but the hospital's risk rules have no rule for it");
    expect(out).toContain('href="/care-plans/templates/t1#risk-rules"');
    expect(card(risk())).not.toContain('Doctor to assess');
  });

  it("says so when a recorded haemoglobin or blood pressure has no rule in the hospital's rules – and does not say nothing was found", () => {
    // her record: lowest Hb 9.8, latest BP 150/96 – shown on the Pregnancy card next to this one
    const out = card(risk({ readingsNotChecked: ['lowestHb', 'latestBp'] }));
    expect(out).toContain('Low-risk');
    expect(out).toContain("<strong>Doctor to assess:</strong> Lowest Hb 9.8 g/dL, Latest BP 150/96 – recorded in this pregnancy, but the hospital's risk rules have no rule for them, so the level does not count them.");
    expect(out).toContain('href="/care-plans/templates/t1#risk-rules"');
    expect(out).toContain('No risk rule applies – but not everything recorded was counted. See “Doctor to assess” below.');
    expect(out).not.toContain('No risk factor found in the recorded information.');
    // the same for a ticked finding the rules do not know
    expect(card(risk({ findingsNotChecked: ['gdm'] }))).not.toContain('No risk factor found in the recorded information.');
    // everything counted: the usual sentence, and nothing for a result from before this existed
    expect(card(risk())).toContain('No risk factor found in the recorded information.');
    expect(card(risk({ readingsNotChecked: undefined }))).not.toContain('recorded in this pregnancy, but');
  });

  it('shows a reason from a finding and from a reading with its detail, and says the rules are a draft', () => {
    const out = card(
      risk({
        level: 'high',
        computedLevel: 'high',
        reasons: [
          { key: 'preg_multiple', label: 'Twins or more', level: 'high', detail: 'Recorded by Dr Sample on 28 Sep 2026' },
          { key: 'hb_under_7', label: 'Severe anaemia: lowest Hb in this pregnancy under 7 g/dL', level: 'high', detail: 'Lowest Hb 6.5 g/dL on 28 Sep 2026 (visit) (rule: under 7)' },
        ],
      }),
    );
    expect(out).toContain('High-risk');
    expect(out).toContain('Twins or more');
    expect(out).toContain('Recorded by Dr Sample on 28 Sep 2026');
    expect(out).toContain('Lowest Hb 6.5 g/dL on 28 Sep 2026 (visit) (rule: under 7)');
    expect(out).toContain('Draft rules');
    expect(out).toContain('draft rules that no doctor has approved yet');
  });
});

describe('the Care plan tab', () => {
  const plan = (over = {}) => ({
    id: 'c1',
    careType: 'antenatal',
    status: 'active',
    canEdit: true,
    canChangePlan: true,
    readOnly: false,
    missingFacts: [],
    recentChanges: [],
    findingsWithoutItems: [],
    template: { id: 't1', name: 'Standard antenatal care', version: 3, approved: false, draftReason: 'content', updateAvailable: false, updateApproved: false, currentVersion: 3 },
    ...over,
  });
  const alerts = (pl, p = patient()) => html(<PlanAlerts plan={pl} patient={p} viewingEarlier={false} canSeeTemplates onOpen={() => {}} />);

  it('no longer says that findings are not detected: items for a finding apply once it is ticked in Edit details', () => {
    const out = alerts(plan());
    expect(out).not.toMatch(/not detected automatically/);
    expect(out).toContain('Items for a finding in this pregnancy (GDM, high blood pressure, twins, low-lying placenta, bleeding) apply once the finding is ticked on her record');
    expect(out).toMatch(/<a href="\/patients\/p1\/edit"[^>]*>tick it in Edit details<\/a>/);
    expect(out).toContain('Use Include anyway or Add item only for what the template has no item for.');
    // someone who cannot edit her details gets no link; a baby's or a gynaecology plan has no such note
    expect(alerts(plan(), patient({ access: { ...FULL, canEditClinical: false } }))).not.toContain('href="/patients/p1/edit"');
    expect(alerts(plan({ careType: 'newborn' }))).not.toContain('Items for a finding');
    expect(alerts(plan({ canEdit: false, canChangePlan: false, readOnly: true }))).not.toContain('Items for a finding');
    expect(out).not.toMatch(/!/);
  });

  it('a ticked finding the plan has no items for: says why and offers the plan update to those who may change the plan', () => {
    const behind = plan({ findingsWithoutItems: ['multiple'], template: { id: 't1', name: 'Standard antenatal care', version: 3, approved: false, draftReason: 'content', updateAvailable: true, updateApproved: false, currentVersion: 4 } });
    const out = alerts(behind);
    expect(out).toContain('<strong>Ticked on her record: Twins or more.</strong> This plan was built from an older version of “Standard antenatal care” (version 3), which had no items for it');
    expect(out).toMatch(/<button type="button" class="btn btn-link plan-inline-link">Review the update<\/button>/);
    // the folded note "can be updated once it is approved" would contradict the offer: it is left out here
    expect(out).not.toContain('The plan can be updated once it is approved.');
    expect(alerts(plan({ template: { ...behind.template } }))).toContain('The plan can be updated once it is approved.');
    // a nurse, or the plan of another doctor's patient: told who updates it, no button
    const viewOnly = alerts({ ...behind, canEdit: false, canChangePlan: false, readOnly: true });
    expect(viewOnly).toContain('The treating doctor or an RMO updates the plan.');
    expect(viewOnly).not.toContain('Review the update');
    expect(alerts(plan())).not.toContain('Ticked on her record');
    expect(out).not.toMatch(/!/);
  });
});

describe('the visit page offer', () => {
  const page = (findingOffers) => ({ visit: { id: 'v1' }, findingOffers });

  it('says the reading and offers one button; nothing when the server offers nothing', () => {
    const out = html(<FindingOffers patient={patient()} page={page([{ key: 'hypertension', bp: '150/96', beforeWeek20: false }])} onAdded={() => {}} />);
    expect(out).toContain('Suggested for her record');
    expect(out).toContain('Blood pressure 150/96 at this visit – 140/90 or higher.');
    expect(out).toContain('You decide – nothing is added by itself.');
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toContain('Add to her record: high blood pressure in this pregnancy');
    expect(out).toContain('btn btn-secondary'); // the page's primary button stays Save
    expect(out).not.toMatch(/!/);
    // what adding it does is said as it is: it depends on the hospital's rules and template
    expect(out).toContain("it counts for the risk level and the care plan as the hospital's risk rules and care-plan template say");
    expect(out).not.toMatch(/raises the risk level|switches on its care-plan items/);
    // the 140/90 suggestion is built in: the screen says it is a draft and names the guideline
    expect(out).toContain('Draft suggestion built into the software, not reviewed by your hospital’s doctors. Source: MoHFW SBA guidelines and PMSMA high-risk list');
    expect(html(<FindingOffers patient={patient()} page={page([])} onAdded={() => {}} />)).toBe('');
    expect(html(<FindingOffers patient={patient()} page={{ visit: { id: 'v1' } }} onAdded={() => {}} />)).toBe(''); // an older answer without the field
  });
});
