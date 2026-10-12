// Findings of a pregnancy loss (5 Oct 2026): the fields of the form, the words on the record and what is sent to
// the server – and the care plan's words for pregnancy-loss care. Rendered to HTML, no browser. Fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AbortionSection, abortionEmpty, abortionFindingErrors, abortionPayload, abortionValues } from './AbortionSection.jsx';
import { LossFindingFields, LossFindingsList } from './LossFindings.jsx';
import {
  ANOTHER_LOSS_HINT,
  KEPT_RUPTURE_HINT,
  LOSS_FINDINGS_HINT,
  LOSS_FINDING_KEYS,
  RECURRENT_WORKUP_FROM_LOSSES,
  UNKNOWN_LOCATION_HINT,
  anotherLoss,
  anyLossFinding,
  blankLossFindings,
  currentLossFindings,
  dateSeenHint,
  locationFlagsText,
  lossFlagsText,
  lossRulesOn,
  lossFindingByText,
  lossFindingValues,
  lossFindingsChanged,
  lossFindingsPayload,
  pastLossFindings,
  recurrentWorkupOrdinal,
  showsKeptRupture,
  shownLossFindings,
  validMm,
} from './abortionFormat.js';
import { MISSING_FACT_TEXT, NO_LOSS_DETAILS, PLAN_TITLES, WHY_TEXT, basisText, planTitle, sinceText, statusNote } from './carePlanFormat.js';
import { PATIENT_FALLBACK_LOSS, patientCopyTitle, patientWhat } from './carePlanPrintFormat.js';
import { RECORDED_ON_RECORD } from './carePlanFormat.js';
import { reminderMessage } from '../reminders/reminderText.js';
import { notCheckedCareText } from '../redflags/redFlagFormat.js';
import { APPLIES_LABELS, CARE_TYPE_TEMPLATE_LABELS, groupByStage } from '../careplans/templateFormat.js';
import { LossFindingsCard, showsLossFindings } from '../visits/LossFindingsCard.jsx';

const date = (d) => String(d).slice(0, 10);
const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
// The record as the server sends it: every value with who recorded it and when
const entry = (key, value, extra = {}) => ({ key, value, byName: 'Dr Sample', at: '2026-10-05T06:00:00.000Z', via: 'record', endedAt: null, endedByName: null, current: true, ...extra });
const STORED = {
  lossType: 'ectopic',
  presentedOn: '2026-10-05T00:00:00.000Z',
  findings: [
    entry('bleeding', 'light', { current: false, endedAt: '2026-10-06T06:00:00.000Z', endedByName: 'Dr Second' }),
    entry('os', 'closed'),
    entry('crlMm', 7.5),
    entry('ruptureSigns', 'no', { via: 'visit' }),
    entry('bleeding', 'heavy', { byName: 'Dr Second', at: '2026-10-06T06:00:00.000Z' }),
  ],
};

describe('the findings as the form holds them', () => {
  it('the values recorded now, as text – in the order of the form, every finding with a value or ""', () => {
    expect(currentLossFindings(STORED).map((f) => [f.key, f.value])).toEqual([['os', 'closed'], ['bleeding', 'heavy'], ['crlMm', 7.5], ['ruptureSigns', 'no']]);
    const values = lossFindingValues(STORED);
    expect(Object.keys(values)).toEqual(LOSS_FINDING_KEYS);
    expect(values).toMatchObject({ os: 'closed', bleeding: 'heavy', crlMm: '7.5', ruptureSigns: 'no', sacSeen: '', heartbeat: '' });
    expect(Object.values(lossFindingValues(null)).every((v) => v === '')).toBe(true);
    expect(anyLossFinding(values)).toBe(true);
    expect(anyLossFinding(lossFindingValues(null))).toBe(false);
  });

  it('shows only what fits the type of loss: signs of rupture for an ectopic or a pregnancy not yet located; nothing for a work-up', () => {
    const keys = (lossType, values = {}) => shownLossFindings(lossType, values).map((f) => f.key);
    expect(keys('missed')).toEqual(LOSS_FINDING_KEYS.filter((k) => k !== 'ruptureSigns'));
    expect(keys('ectopic')).toEqual(LOSS_FINDING_KEYS);
    expect(keys('complete', { sacSeen: 'no' })).toContain('ruptureSigns');
    expect(keys('complete', { sacSeen: 'yes' })).not.toContain('ruptureSigns');
    expect(keys('molar', { sacSeen: 'no' })).not.toContain('ruptureSigns');
    expect(keys('recurrent')).toEqual([]);
    expect(keys('')).toEqual([]);
  });

  it('sends the findings shown, and the values the form opened with – so only what was changed is written', () => {
    const v = abortionValues(STORED);
    expect(v.findings).toEqual(v.findingsSeen);
    const payload = abortionPayload({ ...v, findings: { ...v.findings, bleeding: 'moderate', sacDiameterMm: ' 25 ' } });
    expect(payload.findings).toMatchObject({ os: 'closed', bleeding: 'moderate', sacDiameterMm: '25', ruptureSigns: 'no', heartbeat: '' });
    expect(payload.findingsSeen).toMatchObject({ bleeding: 'heavy', sacDiameterMm: '' });
    // A finding that does not fit the type of loss chosen now is not sent (the server ends it on the record)
    expect(Object.keys(lossFindingsPayload(v.findings, 'missed'))).not.toContain('ruptureSigns');
    expect(lossFindingsPayload(v.findings, 'recurrent')).toEqual({});
    expect(lossFindingsChanged(v.findings, v.findingsSeen)).toBe(false);
    expect(lossFindingsChanged({ ...v.findings, os: 'open' }, v.findingsSeen)).toBe(true);
    // A section with only a finding entered counts as filled in; an untouched one is still empty
    expect(abortionEmpty(abortionValues(null))).toBe(true);
    expect(abortionEmpty({ ...abortionValues(null), findings: { ...abortionValues(null).findings, os: 'open' } })).toBe(false);
  });

  it('a scan measurement is a number of millimetres, with at most one decimal', () => {
    for (const ok of ['', '7', '7.5', '7,5', '120', ' 25 ']) expect(validMm(ok), ok).toBe(true);
    for (const bad of ['about 7', '7.55', '-3', '1e2', '7 mm', '1234']) expect(validMm(bad), bad).toBe(false);
    const v = abortionValues(STORED);
    expect(abortionFindingErrors(v)).toEqual({});
    expect(abortionFindingErrors({ ...v, findings: { ...v.findings, crlMm: 'about 7' } })).toEqual({ 'abortion.findings.crlMm': 'Crown–rump length must be a number of mm, for example 7 or 7.5' });
  });

  it('says who recorded a finding and when, and keeps the earlier values in words', () => {
    // The hospital's day the server sends (on), not the UTC date of the moment: 01:00 in India on 6 Oct is 6 Oct
    expect(lossFindingByText({ ...STORED.findings[1], at: '2026-10-05T19:30:00.000Z', on: '2026-10-06T00:00:00.000Z' }, date)).toBe('Dr Sample, 2026-10-06');
    expect(pastLossFindings({ findings: [entry('os', 'open', { current: false, at: '2026-10-05T19:30:00.000Z', on: '2026-10-06T00:00:00.000Z', endedAt: '2026-10-06T20:00:00.000Z', endedOn: '2026-10-07T00:00:00.000Z', endedByName: 'Dr Second' })] }, date)[0].text).toBe(
      'recorded by Dr Sample on 2026-10-06, changed by Dr Second on 2026-10-07',
    );
    expect(lossFindingByText(STORED.findings[1], date)).toBe('Dr Sample, 2026-10-05');
    expect(lossFindingByText(STORED.findings[3], date)).toBe('Dr Sample, 2026-10-05 (at a visit)');
    expect(pastLossFindings(STORED, date)).toEqual([{ key: 'bleeding', label: 'Bleeding: Light', text: 'recorded by Dr Sample on 2026-10-05, changed by Dr Second on 2026-10-06' }]);
    expect(pastLossFindings({ findings: [] })).toEqual([]);
  });
});

describe('the findings on the screens', () => {
  const section = (stored, values = abortionValues(stored)) =>
    words(renderToStaticMarkup(<AbortionSection values={values} set={() => {}} bloodGroup="A+" fe={(path) => (path === 'abortion.findings.crlMm' ? 'Crown–rump length is too high' : undefined)} vc={() => undefined} vm={() => null} fromAntenatal={false} storedSeen="" storedFindings={currentLossFindings(stored)} />));

  it('the Pregnancy loss section has the findings as fields with fixed answers, grouped, each with who recorded it', () => {
    const html = section(STORED);
    expect(html).toContain('<h3>Findings</h3>');
    expect(html).toContain(LOSS_FINDINGS_HINT);
    expect([...html.matchAll(/<legend>([^<]*)<\/legend>/g)].map((m) => m[1])).toEqual(['Examination', 'Scan', 'Ectopic or not yet located']);
    const options = (id) => [...html.match(new RegExp(`<select id="${id}"[^>]*>(.*?)</select>`, 's'))[1].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);
    expect(options('ab-f-os')).toEqual([['', 'Not recorded'], ['open', 'Open'], ['closed', 'Closed'], ['not_examined', 'Not examined']]);
    expect(options('ab-f-bleeding')).toEqual([['', 'Not recorded'], ['light', 'Light'], ['moderate', 'Moderate'], ['heavy', 'Heavy']]);
    for (const id of ['productsSeen', 'feverDischarge', 'heartbeat', 'adnexalMass', 'freeFluid', 'ruptureSigns']) expect(options(`ab-f-${id}`), id).toEqual([['', 'Not recorded'], ['yes', 'Yes'], ['no', 'No']]);
    // The sac: also "not now – an earlier scan showed it" (then the pregnancy was in the uterus, not "not yet located")
    expect(options('ab-f-sacSeen')).toEqual([['', 'Not recorded'], ['yes', 'Yes'], ['no', 'No'], ['earlier', 'Not now – an earlier scan showed it']]);
    expect(html).toMatch(/<label for="ab-f-sacDiameterMm">Mean sac diameter \(mm\)<\/label>/);
    expect(html).toMatch(/<input id="ab-f-crlMm"[^>]*value="7.5"/);
    expect(html).toContain('Recorded by Dr Second, 6 Oct 2026'); // the bleeding, changed the next day
    expect(html).toContain('Recorded by Dr Sample, 5 Oct 2026 (at a visit)');
    expect(html).toContain('Crown–rump length is too high'); // the server's message under its field
    expect(html).not.toMatch(/!/);
    expect(html.match(/<textarea/g)).toHaveLength(1); // the note only
    // The findings themselves: no field about the baby, and nothing to type but the two measurements
    const fields = renderToStaticMarkup(<LossFindingFields values={lossFindingValues(STORED)} onChange={() => {}} lossType="ectopic" entries={currentLossFindings(STORED)} />);
    expect(fields).not.toMatch(/\bsex\b|gender|\bboy\b|\bgirl\b|\bmale\b|\bfemale\b/i);
    expect([...fields.matchAll(/<input id="([^"]*)"/g)].map((m) => m[1])).toEqual(['lf-sacDiameterMm', 'lf-crlMm']);
    expect(fields).not.toContain('<textarea');
  });

  it('another loss (a date seen more than 8 weeks from the one on her record): the findings start empty, and the form says why', () => {
    const stored = { ...STORED, lossType: 'missed', presentedOn: '2026-06-01T00:00:00.000Z' };
    const values = { ...abortionValues(stored), presentedOn: '2026-10-05' };
    const html = words(renderToStaticMarkup(<AbortionSection values={{ ...values, findings: blankLossFindings(), findingsSeen: blankLossFindings() }} set={() => {}} bloodGroup="A+" fe={() => undefined} vc={() => undefined} vm={() => null} fromAntenatal={false} storedSeen="2026-06-01" storedFindings={currentLossFindings(stored)} />));
    expect(html).toContain(ANOTHER_LOSS_HINT);
    expect(html).not.toContain('Recorded by'); // the earlier loss's findings are not shown as this one's
    expect(anotherLoss('2026-06-01', '2026-10-05')).toBe(true);
    expect(anotherLoss('2026-10-01', '2026-10-05')).toBe(false); // a corrected date: the same loss
    expect(anotherLoss('', '2026-10-05')).toBe(false);
    // The same date: no warning, the findings with who recorded them
    const same = section(STORED);
    expect(same).not.toContain(ANOTHER_LOSS_HINT);
    expect(same).toContain('Recorded by');
    expect(ANOTHER_LOSS_HINT).not.toMatch(/!/);
  });

  it('"Signs of rupture: Yes" stays shown (with why) while her record has it, even when the scan or the type of loss no longer fits it', () => {
    const seen = { ...blankLossFindings(), sacSeen: 'no', ruptureSigns: 'yes' };
    const keys = (lossType, values) => shownLossFindings(lossType, values, seen).map((f) => f.key);
    expect(keys('complete', { ...seen, sacSeen: 'yes' })).toContain('ruptureSigns');
    expect(keys('incomplete', seen)).toContain('ruptureSigns');
    expect(keys('recurrent', seen)).toEqual([]);
    expect(shownLossFindings('complete', { ...seen, sacSeen: 'yes' }).map((f) => f.key)).not.toContain('ruptureSigns'); // never recorded: not offered
    expect(Object.keys(lossFindingsPayload({ ...seen, sacSeen: 'yes' }, 'complete', seen))).toContain('ruptureSigns');
    const html = words(renderToStaticMarkup(<LossFindingFields values={{ ...seen, sacSeen: 'yes' }} onChange={() => {}} lossType="complete" seen={seen} />));
    expect(html).toContain('lf-ruptureSigns');
    expect(html).toContain(KEPT_RUPTURE_HINT);
    expect(showsKeptRupture('ectopic', seen, seen)).toBe(false); // it fits: nothing to explain
  });

  it('says that a finding raises a red flag only where the hospital\'s rules check pregnancy-loss care', () => {
    expect(lossRulesOn({ careTypes: ['antenatal', 'abortion'] })).toBe(true);
    expect(lossRulesOn({ careTypes: ['antenatal'] })).toBe(false);
    expect(lossRulesOn(undefined)).toBeNull();
    expect(lossFlagsText(true)).toMatch(/^Signs of rupture, heavy bleeding, and fever with foul-smelling discharge raise a red flag/);
    expect(lossFlagsText(false)).toMatch(/do not check pregnancy-loss care yet, so these findings raise no red flag\. A doctor can add the pregnancy-loss rules in Clinic library → Clinical rules → Red-flag rules\./);
    expect(lossFlagsText(null)).toMatch(/^If the hospital's red-flag rules include the pregnancy-loss rules/);
    expect(locationFlagsText(true)).toBe('A pulse over 110 or a systolic BP under 90 at a visit then raises a red flag.');
    expect(locationFlagsText(false)).toBe('');
    const notLocated = { lossType: 'complete', findings: [entry('sacSeen', 'no')] };
    const withRules = words(renderToStaticMarkup(<AbortionSection values={abortionValues(notLocated)} set={() => {}} bloodGroup="A+" fe={() => undefined} vc={() => undefined} vm={() => null} fromAntenatal={false} storedSeen="" storedFindings={currentLossFindings(notLocated)} rulesOn />));
    expect(withRules).toContain(lossFlagsText(true));
    expect(withRules).toContain(locationFlagsText(true));
    const without = section(notLocated);
    expect(without).toContain(lossFlagsText(null));
    expect(without).not.toContain(locationFlagsText(true));
    for (const on of [true, false, null]) expect(lossFlagsText(on), String(on)).not.toMatch(/!/);
  });

  it('no findings for a recurrent-loss work-up or before the type of loss is chosen; the hint when the pregnancy is not located', () => {
    expect(section({ lossType: 'recurrent', findings: [] })).not.toContain('<h3>Findings</h3>');
    expect(section(null)).not.toContain('<h3>Findings</h3>');
    const missed = section({ lossType: 'missed', findings: [] });
    expect(missed).toContain('<h3>Findings</h3>');
    expect(missed).not.toContain('ab-f-ruptureSigns');
    expect(missed).not.toContain(UNKNOWN_LOCATION_HINT);
    const notLocated = section({ lossType: 'complete', findings: [entry('sacSeen', 'no')] });
    expect(notLocated).toContain('ab-f-ruptureSigns');
    expect(notLocated).toContain(UNKNOWN_LOCATION_HINT);
    // An old threatened miscarriage must be moved first: no findings to enter
    expect(section({ lossType: 'threatened', findings: [] })).not.toContain('<h3>Findings</h3>');
  });

  it('says under "Date seen" that her care plan counts from that day – the day of the diagnosis, or of the work-up visit', () => {
    expect(dateSeenHint('missed')).toBe('The day the loss was diagnosed. Her care plan counts from this day.');
    expect(dateSeenHint('ectopic')).toBe(dateSeenHint('missed'));
    expect(dateSeenHint('')).toBe(dateSeenHint('missed')); // before the type of loss is chosen
    expect(dateSeenHint('recurrent')).toBe('The day she was seen for the work-up. Her care plan counts from this day.');
    const html = section(STORED);
    expect(html).toMatch(/<label for="ab-presentedOn">Date seen<\/label>/);
    expect(html).toContain('5 Oct 2026. The day the loss was diagnosed. Her care plan counts from this day.');
    expect(section({ lossType: 'recurrent', presentedOn: '2026-10-05T00:00:00.000Z', findings: [] })).toContain('The day she was seen for the work-up. Her care plan counts from this day.');
  });

  it('the record lists each finding with its value, who recorded it and when, and the earlier values', () => {
    const html = words(renderToStaticMarkup(<LossFindingsList abortion={STORED} />));
    expect([...html.matchAll(/<span class="reason-label">([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(['Cervical os: Closed', 'Bleeding: Heavy', 'Crown–rump length: 7.5 mm', 'Signs of rupture: No', 'Bleeding: Light']);
    expect(html).toContain('Dr Sample, 5 Oct 2026 (at a visit)');
    expect(html).toContain('Earlier entries (1)');
    expect(html).toContain('recorded by Dr Sample on 5 Oct 2026, changed by Dr Second on 6 Oct 2026');
    expect(renderToStaticMarkup(<LossFindingsList abortion={{ lossType: 'missed', findings: [] }} />)).toBe('');
    // The fields alone (the visit page uses them with its own ids)
    const fields = renderToStaticMarkup(<LossFindingFields values={lossFindingValues(STORED)} onChange={() => {}} lossType="ectopic" entries={currentLossFindings(STORED)} idPrefix="vs-lf" disabled />);
    expect(fields).toMatch(/<select id="vs-lf-os"[^>]*disabled=""/);
  });

  it('the visit page: the treating doctor or an RMO can record them; others see them read-only; only in pregnancy-loss care', () => {
    const patient = (access, abortion = STORED, careType = 'abortion') => ({ id: 'p1', careType, abortion, access });
    const page = (visit = {}, access = { canEdit: true }) => ({ visit: { id: 'v1', careType: 'abortion', status: 'active', ...visit }, access });
    const card = (p, pg = page()) => words(renderToStaticMarkup(<MemoryRouter><LossFindingsCard patient={p} page={pg} onSaved={() => {}} /></MemoryRouter>));
    const doctor = card(patient({ canEditClinical: true }));
    expect(doctor).toContain('Findings of this pregnancy loss');
    expect(doctor).toContain('Change findings');
    expect(doctor).toContain('Bleeding: Heavy');
    expect(doctor.match(/btn-primary/g)).toBeNull(); // the visit's own Save stays the one primary button
    expect(card(patient({ canEditClinical: true }, { lossType: 'missed', findings: [] }))).toContain('Record findings');
    const nurse = card(patient({ canEditClinical: false }));
    expect(nurse).toContain('Bleeding: Heavy');
    expect(nurse).not.toContain('Change findings');
    expect(card(patient({ canEditClinical: false }, { lossType: 'missed', findings: [] }))).toBe(''); // nothing to show
    // A visit marked "entered in error": read-only for everyone
    expect(card(patient({ canEditClinical: true }), page({ status: 'cancelled' }))).not.toContain('Change findings');
    // A signed visit, or a record marked as a duplicate: the visit page cannot be changed, nor can the findings from it
    expect(card(patient({ canEditClinical: true }), page({}, { canEdit: false }))).not.toContain('Change findings');
    expect(card(patient({ canEditClinical: true }), page({}, { canEdit: false }))).toContain('Bleeding: Heavy');
    // Not for a recurrent-loss work-up, an old threatened miscarriage, a record without a type of loss, or another type of care
    expect(showsLossFindings(patient({}), page().visit)).toBe(true);
    expect(showsLossFindings(patient({}, { lossType: 'recurrent' }), page().visit)).toBe(false);
    expect(showsLossFindings(patient({}, { lossType: 'threatened' }), page().visit)).toBe(false);
    expect(showsLossFindings(patient({}, null), page().visit)).toBe(false);
    expect(showsLossFindings(patient({}, STORED, 'antenatal'), page().visit)).toBe(false);
    expect(showsLossFindings(patient({}), page({ careType: 'antenatal' }).visit)).toBe(false); // a visit from before the loss
    expect(card(patient({ canEditClinical: true }, { lossType: 'recurrent', findings: [] }))).toBe('');
  });
});

describe('the care plan for pregnancy-loss care, in words', () => {
  const plan = { careType: 'abortion', startWord: 'loss', startOn: '2026-10-05T00:00:00.000Z', dayZero: '2026-10-05T00:00:00.000Z', today: '2026-10-20T00:00:00.000Z' };

  it('has its title; counts from the day she was seen – words that never name the loss on the patient copy', () => {
    expect(PLAN_TITLES.abortion).toBe('Pregnancy-loss care plan');
    expect(planTitle(plan)).toBe('Pregnancy-loss care plan');
    expect(basisText(plan)).toBe('Seen 5 Oct 2026');
    expect(sinceText(plan, { weeks: 2, days: 1 })).toBe('2 w 1 d since she was seen');
    expect(patientCopyTitle({}, 'abortion')).toBe('Follow-up care plan');
    expect(NO_LOSS_DETAILS).toMatch(/built automatically, counted from the date seen/);
    expect(CARE_TYPE_TEMPLATE_LABELS.abortion).toBe('Abortion');
  });

  it('says why an item does not apply or needs a check, with the ONE number for the recurrent-loss work-up', () => {
    expect(RECURRENT_WORKUP_FROM_LOSSES).toBe(3);
    expect(recurrentWorkupOrdinal()).toBe('third');
    expect(statusNote({ status: 'not_applicable', why: 'only_loss_molar' }, plan)).toBe('Only after a molar pregnancy');
    expect(statusNote({ status: 'not_applicable', why: 'only_loss_anti_d_due' }, plan)).toBe('Only for an Rh-negative woman whose anti-D is not yet recorded as given or not needed');
    expect(statusNote({ status: 'not_applicable', why: 'only_loss_recurrent' }, plan)).toBe('Only from the third loss in Abortions (A), or for a recurrent-loss work-up');
    expect(statusNote({ status: 'check_needed', why: 'loss_management_unknown' }, plan)).toBe('Management of the ectopic pregnancy not recorded');
    expect(statusNote({ status: 'check_needed', why: 'loss_count_check' }, plan)).toMatch(/if this loss is not counted yet, it is the third: the doctor decides/);
    for (const why of ['only_loss_molar', 'only_loss_ectopic_expectant', 'only_loss_ectopic_hcg', 'only_loss_recurrent', 'only_loss_anti_d_due', 'only_loss_now', 'loss_management_unknown', 'loss_count_unknown', 'loss_count_check']) expect(WHY_TEXT[why], why).toBeTruthy();
    // A record that is only for the recurrent-loss work-up: no "after the loss" check-up, haemoglobin or contraception item
    expect(statusNote({ status: 'not_applicable', why: 'only_loss_now' }, plan)).toBe('Only after a loss cared for now – not for a record that is only for the recurrent-loss work-up');
    // The alert on the Care plan tab for facts the plan is waiting for (the server's labels)
    for (const fact of ['Management of the ectopic pregnancy', 'Abortions (A) in the obstetric history', 'Whether this loss is counted in Abortions (A)']) expect(MISSING_FACT_TEXT[fact], fact).toBeTruthy();
    for (const when of ['loss_molar', 'loss_ectopic_expectant', 'loss_ectopic_hcg', 'loss_recurrent', 'loss_anti_d_due', 'loss_now']) expect(APPLIES_LABELS[when], when).toMatch(/^Pregnancy loss: /);
    expect(APPLIES_LABELS.loss_now).toBe('Pregnancy loss: a loss cared for now (not a recurrent-loss work-up only)');
    expect(APPLIES_LABELS.loss_recurrent).toBe('Pregnancy loss: recurrent-loss work-up (from the third loss)');
  });

  it('what the patient reads never names the loss: an item a doctor added without words for her is "Check-up or test – your doctor will explain"', () => {
    const added = { name: 'Repeat scan for retained products after miscarriage', patientText: '', kind: 'investigation' };
    expect(patientWhat(added, 'abortion')).toBe(PATIENT_FALLBACK_LOSS);
    expect(PATIENT_FALLBACK_LOSS).toBe('Check-up or test – your doctor will explain');
    expect(patientWhat({ ...added, patientText: ' Blood test (beta hCG) ' }, 'abortion')).toBe('Blood test (beta hCG)');
    expect(patientWhat(added, 'gynaecology')).toBe(added.name); // other care: as before
    expect(patientWhat(added)).toBe(added.name);
    const data = { patient: { fullName: 'Asha Sample', careType: 'abortion' }, hospital: { name: 'Sample Hospital', phone: '' }, appointment: null, plan: { nextVisit: null, overdue: [{ ...added, dueBy: '2026-10-20T00:00:00.000Z' }], due: [] } };
    for (const lang of ['en', 'mr', 'hi']) {
      const text = reminderMessage(data, lang);
      expect(text, lang).toContain(PATIENT_FALLBACK_LOSS);
      expect(text, lang).not.toMatch(/miscarriage|retained/);
    }
    // The anti-D item is answered on her record (the plan says where; it has no "Mark done")
    expect(RECORDED_ON_RECORD.loss_antid).toBe('Recorded on her record: Edit details → Pregnancy loss → Anti-D.');
    // A work-up-only record in hospital: why its vital signs are not checked
    expect(notCheckedCareText('abortion', true)).toBe('Her record is only for the recurrent-loss work-up, and the pregnancy-loss red-flag rules are about a loss cared for now – the vital signs on the nursing chart are not checked.');
    expect(notCheckedCareText('abortion')).toBe('No red-flag rule applies to Abortion (pregnancy loss) – the vital signs on the nursing chart are not checked.');
  });

  it("the template's page groups the items by weeks since she was seen – never by trimester", () => {
    const items = [{ key: 'a', fromWeek: 0, toWeek: 2 }, { key: 'b', fromWeek: 17, toWeek: 18 }, { key: 'c', fromWeek: 1, toWeek: 2 }];
    expect(groupByStage(items, 'abortion').map((g) => [g.title, g.items.map((i) => i.key)])).toEqual([['In the first 13 weeks', ['a', 'c']], ['Weeks 14 to 27', ['b']]]);
    expect(groupByStage(items).map((g) => g.title)).toEqual(['First trimester (up to 13 w)', 'Second trimester (14–27 w)']);
    expect(groupByStage(items, 'postnatal').map((g) => g.title)).toEqual(['First trimester (up to 13 w)', 'Second trimester (14–27 w)']); // as before
  });
});
