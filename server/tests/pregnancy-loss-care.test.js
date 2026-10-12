// Pregnancy-loss care, part 1 (5 Oct 2026) – the Abortion type of care: a miscarriage, an ectopic or a molar
// pregnancy, and the recurrent-loss work-up. Findings as fields (who recorded them and when), the care plan with
// beta hCG follow-up, and the red flags. Fake data only. Time is pinned: 5 Oct 2026, 11:30 in India.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as clientLists from '../../client/src/pages/patients/abortionFormat.js';
import { PATIENT_FALLBACK_LOSS as WEBSITE_FALLBACK_LOSS, patientWhat } from '../../client/src/pages/patients/carePlanPrintFormat.js';
import * as website from '../../client/src/pages/redflags/redFlagFormat.js';
import { sourceLink as websiteSourceLink, sourceText as websiteSourceText } from '../../client/src/pages/redflags/redFlagSources.js';
import { createApp } from '../src/app.js';
import { patientContext } from '../src/ai/context.js';
import { ABORTION_DRAFT } from '../src/careplans/otherDrafts.js';
import { lossStart, planFacts, ruleFor } from '../src/careplans/planEngine.js';
import { SAME_PREGNANCY_DAYS } from '../src/careplans/planRules.js';
import { PATIENT_FALLBACK_LOSS, portalPlanItems, seriesItem } from '../src/careplans/plansService.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import { LAB_TESTS } from '../src/lab/labTests.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { APPLIES_WHEN, CarePlanTemplate, TEMPLATE_CARE_TYPES } from '../src/models/CarePlanTemplate.js';
import { CARE_TYPES, Patient } from '../src/models/Patient.js';
import { Visit } from '../src/models/Visit.js';
import { RedFlagRuleSet } from '../src/models/RedFlagRuleSet.js';
import * as serverLists from '../src/patients/abortionRules.js';
import {
  MAX_LOSS_FINDING_ENTRIES,
  RED_FLAG_LOSS_FINDINGS,
  currentLossFindings,
  endLossFindings,
  lossFindingValues,
  lossFindingsView,
  lossLocationNow,
  lossLocationOn,
  lossRedFlagFacts,
  setLossFindings,
} from '../src/patients/lossFindings.js';
import { BUILT_IN_RED_FLAG_RULES, BUILT_IN_RED_FLAG_VERSION, BUILT_IN_SINCE, LOSS_RECORD_FACTORS, RED_FLAG_FACTORS, evaluateRedFlags, flagFromText, redFlagFacts, ruleText } from '../src/redflags/redFlags.js';
import { careDueKinds } from '../src/reminders/generalReminders.js';
import { mentionsFetalSex } from '../src/utils/pcpndt.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-05T06:00:00Z'); // hospital today: 5 Oct 2026
const TODAY = new Date('2026-10-05T00:00:00Z');
const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab' };
const LOSS_RULES = BUILT_IN_RED_FLAG_RULES.filter((r) => r.appliesTo.includes('abortion'));
const day = (v) => (v instanceof Date ? v.toISOString() : v ? String(v) : v)?.slice(0, 10) ?? v;

// ---------- The lists and the pure parts (no database) ----------

describe('the lists of findings', () => {
  it('the website and the server use the same findings, the same rules for them, and the same number for the recurrent-loss work-up', () => {
    for (const name of ['YES_NO', 'SAC_SEEN', 'LOSS_FINDINGS', 'LOSS_FINDING_KEYS', 'LOSS_FINDING_GROUPS', 'RECURRENT_WORKUP_FROM_LOSSES', 'SAME_LOSS_DAYS']) expect([name, clientLists[name]]).toEqual([name, serverLists[name]]);
    // Another loss on the same record: the same 8 weeks as the care plan's rule for another pregnancy
    expect(serverLists.SAME_LOSS_DAYS).toBe(SAME_PREGNANCY_DAYS);
    for (const [from, to] of [['2026-06-01', '2026-10-05'], ['2026-10-05', '2026-10-03'], ['2026-08-10', '2026-10-05'], ['2026-08-09', '2026-10-05'], [null, '2026-10-05'], ['2026-06-01', null]]) {
      expect([from, to, clientLists.anotherLoss(from, to)]).toEqual([from, to, serverLists.anotherLoss(from, to)]);
    }
    expect(serverLists.LOSS_FINDING_KEYS).toEqual(['os', 'productsSeen', 'bleeding', 'feverDischarge', 'sacSeen', 'sacDiameterMm', 'crlMm', 'heartbeat', 'adnexalMass', 'freeFluid', 'ruptureSigns']);
    for (const type of [...serverLists.STORED_LOSS_TYPE_KEYS, null]) {
      for (const sac of ['yes', 'no', 'earlier', null]) {
        for (const products of ['yes', 'no', null]) {
          expect([type, sac, products, clientLists.lossLocation(type, sac, products)]).toEqual([type, sac, products, serverLists.lossLocation(type, sac, products)]);
          for (const key of serverLists.LOSS_FINDING_KEYS) {
            expect(clientLists.lossFindingApplies(key, type, sac, products), `${key} ${type} ${sac} ${products}`).toBe(serverLists.lossFindingApplies(key, type, sac, products));
          }
        }
      }
    }
    for (const [key, value] of [['os', 'not_examined'], ['crlMm', 7.5], ['bleeding', 'heavy'], ['sacSeen', 'no'], ['os', ''], ['crlMm', null]]) {
      expect(clientLists.lossFindingText(key, value)).toBe(serverLists.lossFindingText(key, value));
    }
    expect(clientLists.recurrentWorkupOrdinal()).toBe(serverLists.recurrentWorkupOrdinal());
    // Fields with fixed answers only: yes / no, a short list, or millimetres – nothing typed, nothing about the baby
    for (const f of serverLists.LOSS_FINDINGS) expect(['choice', 'number'], f.key).toContain(f.type);
    expect(JSON.stringify(serverLists.LOSS_FINDINGS)).not.toMatch(/MTP|terminat|induced|\bsex\b|gender/i);
    expect(serverLists.lossFindingText('os', 'not_examined')).toBe('Not examined');
    expect(serverLists.lossFindingText('crlMm', 7.5)).toBe('7.5 mm');
    expect(serverLists.lossFindingText('crlMm', null)).toBe('');
  });

  it('where the pregnancy is: an ectopic, or not yet located – a complete miscarriage never seen in the uterus (NICE NG126) – never a miscarriage with tissue in the uterus', () => {
    const { lossLocation, lossFindingApplies } = serverLists;
    expect(lossLocation('ectopic', null)).toBe('ectopic');
    expect(lossLocation('ectopic', 'yes')).toBe('ectopic');
    // A complete miscarriage with an empty uterus and no earlier scan showing the pregnancy there: not yet located
    expect(lossLocation('complete', 'no')).toBe('unknown');
    expect(lossLocation('complete', 'no', 'no')).toBe('unknown');
    expect(lossLocation('complete', 'earlier')).toBeNull(); // an earlier scan showed it in the uterus
    expect(lossLocation('complete', 'no', 'yes')).toBeNull(); // products of conception seen: it was in the uterus
    expect(lossLocation('complete', 'yes')).toBeNull();
    expect(lossLocation('complete', null)).toBeNull();
    // Tissue still in the uterus (incomplete, inevitable, septic) or a pregnancy seen there (missed): never "not located",
    // even when the sac itself is no longer seen
    for (const type of ['incomplete', 'inevitable', 'septic', 'missed']) expect([type, lossLocation(type, 'no')]).toEqual([type, null]);
    expect(lossLocation('molar', 'no')).toBeNull();
    expect(lossLocation('recurrent', 'no')).toBeNull();
    expect(lossLocation('threatened', 'no')).toBeNull();
    expect(lossLocation(null, 'no')).toBeNull();
    // "Signs of rupture" is a field only where a rupture can happen; nothing at all for a recurrent-loss work-up
    expect(lossFindingApplies('ruptureSigns', 'ectopic', null)).toBe(true);
    expect(lossFindingApplies('ruptureSigns', 'missed', 'yes')).toBe(false);
    expect(lossFindingApplies('ruptureSigns', 'complete', 'no')).toBe(true);
    expect(lossFindingApplies('ruptureSigns', 'complete', 'no', 'yes')).toBe(false);
    expect(lossFindingApplies('ruptureSigns', 'incomplete', 'no')).toBe(false);
    expect(lossFindingApplies('os', 'missed', null)).toBe(true);
    expect(serverLists.LOSS_FINDING_KEYS.some((k) => lossFindingApplies(k, 'recurrent', 'no'))).toBe(false);
    expect(serverLists.LOSS_FINDING_KEYS.some((k) => lossFindingApplies(k, null, null))).toBe(false);
  });
});

describe('recording findings (who and when)', () => {
  const drA = { by: 'u1', byName: 'Sample drA', at: new Date('2026-10-05T06:00:00Z') };
  const rmo = { by: 'u2', byName: 'Sample rmo', at: new Date('2026-10-06T06:00:00Z'), via: 'visit', visitId: 'v9' };

  it('each value keeps who recorded it and when; an unchanged value keeps its first recorder; a new value ends the one before', () => {
    const a = { lossType: 'missed' };
    expect(setLossFindings(a, { os: 'closed', crlMm: 8, heartbeat: 'no', bleeding: '' }, drA)).toBe(true);
    expect(lossFindingValues(a)).toEqual({ os: 'closed', crlMm: 8, heartbeat: 'no' });
    expect(currentLossFindings(a).map((f) => [f.key, f.byName, f.via])).toEqual([['os', 'Sample drA', 'record'], ['crlMm', 'Sample drA', 'record'], ['heartbeat', 'Sample drA', 'record']]);
    // The same values sent again: nothing changes
    expect(setLossFindings(a, { os: 'closed', crlMm: '8', heartbeat: 'no' }, rmo)).toBe(false);
    expect(a.findings).toHaveLength(3);
    // The os is open the next day: the earlier entry is ended (kept), the new one is the RMO's, from a visit
    expect(setLossFindings(a, { os: 'open' }, rmo)).toBe(true);
    expect(a.findings.map((f) => [f.key, f.value, f.byName, f.endedByName])).toEqual([
      ['os', 'closed', 'Sample drA', 'Sample rmo'],
      ['crlMm', 8, 'Sample drA', null],
      ['heartbeat', 'no', 'Sample drA', null],
      ['os', 'open', 'Sample rmo', null],
    ]);
    expect(a.findings[0].endedAt).toEqual(rmo.at);
    expect(a.findings[3]).toMatchObject({ via: 'visit', visitId: 'v9', at: rmo.at });
    // Cleared: ended, nothing new
    expect(setLossFindings(a, { crlMm: '' }, rmo)).toBe(true);
    expect(lossFindingValues(a)).toEqual({ os: 'open', heartbeat: 'no' });
    expect(a.findings).toHaveLength(4);
    // What the screens get: no staff ids, and which values count now
    const view = lossFindingsView(a);
    expect(view.filter((f) => f.current).map((f) => f.key).sort()).toEqual(['heartbeat', 'os']);
    expect(JSON.stringify(view)).not.toMatch(/u1|u2|v9|visitId|"by"/);
  });

  it('only what the person changed on the form is written: a value a colleague recorded meanwhile is not put back', () => {
    const a = { lossType: 'incomplete' };
    setLossFindings(a, { os: 'closed', bleeding: 'light' }, drA);
    const seen = lossFindingValues(a); // the form opens showing: os closed, bleeding light
    setLossFindings(a, { bleeding: 'heavy' }, rmo); // a colleague records heavy bleeding from a visit
    // The older form is saved with the os changed and the bleeding as it was shown
    expect(setLossFindings(a, { os: 'open', bleeding: 'light' }, { ...drA, at: new Date('2026-10-07T06:00:00Z') }, { seen })).toBe(true);
    expect(lossFindingValues(a)).toEqual({ os: 'open', bleeding: 'heavy' });
    // Without the "seen" values every difference is applied
    setLossFindings(a, { bleeding: 'light' }, drA);
    expect(lossFindingValues(a).bleeding).toBe('light');
  });

  it('a finding that does not fit the type of loss is not recorded, and one on the record is ended when the type changes', () => {
    const missed = { lossType: 'missed' };
    expect(setLossFindings(missed, { ruptureSigns: 'yes', sacSeen: 'yes' }, drA)).toBe(true);
    expect(lossFindingValues(missed)).toEqual({ sacSeen: 'yes' }); // no rupture for a pregnancy seen in the uterus
    const unknown = { lossType: 'complete' };
    setLossFindings(unknown, { sacSeen: 'no', ruptureSigns: 'no' }, drA); // not located: an ectopic is not ruled out
    expect(lossFindingValues(unknown)).toEqual({ sacSeen: 'no', ruptureSigns: 'no' });
    // An earlier scan is found that showed the sac: "signs of rupture: no" no longer fits, and is ended with who changed it
    expect(setLossFindings(unknown, { sacSeen: 'earlier' }, rmo)).toBe(true);
    expect(lossFindingValues(unknown)).toEqual({ sacSeen: 'earlier' });
    expect(unknown.findings.find((f) => f.key === 'ruptureSigns')).toMatchObject({ endedByName: 'Sample rmo', endedAt: rmo.at });
    // The record becomes a recurrent-loss work-up (not pregnant now): every finding is ended, none is recorded
    const ectopic = { lossType: 'ectopic' };
    setLossFindings(ectopic, { ruptureSigns: 'no', freeFluid: 'yes' }, drA);
    ectopic.lossType = 'recurrent';
    expect(setLossFindings(ectopic, { os: 'open' }, rmo)).toBe(true);
    expect(lossFindingValues(ectopic)).toEqual({});
    expect(ectopic.findings).toHaveLength(2);
    expect(ectopic.findings.every((f) => f.endedAt)).toBe(true);
  });

  it('keeps at most 200 entries: the oldest ended ones go first, a current one never', () => {
    const a = { lossType: 'incomplete' };
    setLossFindings(a, { os: 'closed' }, drA);
    for (let i = 0; i < MAX_LOSS_FINDING_ENTRIES + 20; i += 1) setLossFindings(a, { bleeding: i % 2 ? 'light' : 'heavy' }, { ...rmo, at: new Date(NOW.getTime() + i * 1000) });
    expect(a.findings.length).toBe(MAX_LOSS_FINDING_ENTRIES);
    expect(lossFindingValues(a)).toEqual({ os: 'closed', bleeding: 'light' });
  });

  it('what the red-flag rules read: the location as a standing fact, the three findings with their day – only those of this episode', () => {
    expect(RED_FLAG_LOSS_FINDINGS).toEqual(LOSS_RECORD_FACTORS);
    expect(lossRedFlagFacts(null)).toBeNull();
    const a = { lossType: 'complete' };
    setLossFindings(a, { sacSeen: 'no', ruptureSigns: 'yes', bleeding: 'heavy', os: 'open' }, { ...drA, at: new Date('2026-06-01T06:00:00Z') });
    setLossFindings(a, { feverDischarge: 'yes' }, drA);
    expect(lossRedFlagFacts(a)).toEqual({
      location: 'unknown',
      findings: { ruptureSigns: { value: 'yes', on: new Date('2026-06-01T00:00:00Z') }, bleeding: { value: 'heavy', on: new Date('2026-06-01T00:00:00Z') }, feverDischarge: { value: 'yes', on: TODAY } },
    });
    // Only what was recorded in this episode of care (the last three months) – the location stands
    expect(lossRedFlagFacts(a, { since: new Date('2026-07-07T00:00:00Z') })).toEqual({ location: 'unknown', findings: { feverDischarge: { value: 'yes', on: TODAY } } });
    // A record only for the recurrent-loss work-up: none of the pregnancy-loss rules is about her
    expect(lossRedFlagFacts({ lossType: 'recurrent', findings: [] })).toBeNull();
  });

  it('"signs of rupture: yes" is never ended by itself: a change to the scan or the type of miscarriage keeps it until a person changes it', () => {
    const a = { lossType: 'complete' };
    setLossFindings(a, { sacSeen: 'no', ruptureSigns: 'yes' }, drA);
    // A colleague records that the sac is seen: the pregnancy is located in the uterus, the rupture tick stays
    expect(setLossFindings(a, { sacSeen: 'yes' }, rmo)).toBe(true);
    expect(lossFindingValues(a)).toEqual({ sacSeen: 'yes', ruptureSigns: 'yes' });
    expect(lossRedFlagFacts(a).findings.ruptureSigns.value).toBe('yes');
    // Another type of miscarriage: still kept
    a.lossType = 'incomplete';
    setLossFindings(a, { os: 'open' }, rmo);
    expect(lossFindingValues(a).ruptureSigns).toBe('yes');
    // A "Yes" sent again where it does not fit is not recorded anew; cleared by a person, it is ended with their name
    expect(setLossFindings(a, { ruptureSigns: 'yes' }, rmo)).toBe(false);
    expect(setLossFindings(a, { ruptureSigns: '' }, rmo)).toBe(true);
    expect(lossFindingValues(a).ruptureSigns).toBeUndefined();
    expect(a.findings.find((f) => f.key === 'ruptureSigns')).toMatchObject({ endedByName: 'Sample rmo' });
    // A "No" that no longer fits is ended (it warns of nothing)
    const b = { lossType: 'complete' };
    setLossFindings(b, { sacSeen: 'no', ruptureSigns: 'no' }, drA);
    setLossFindings(b, { productsSeen: 'yes' }, rmo);
    expect(lossFindingValues(b)).toEqual({ sacSeen: 'no', productsSeen: 'yes' });
  });

  it('another loss on the same record: every finding of the earlier loss is ended with the name of who recorded the new loss (kept, never deleted)', () => {
    const a = { lossType: 'ectopic' };
    setLossFindings(a, { adnexalMass: 'yes', ruptureSigns: 'yes', bleeding: 'heavy' }, drA);
    const later = { byName: 'Sample rmo', at: new Date('2026-10-20T06:00:00Z') };
    expect(endLossFindings(a, later)).toBe(true);
    expect(lossFindingValues(a)).toEqual({});
    expect(a.findings).toHaveLength(3);
    expect(a.findings.every((f) => f.endedByName === 'Sample rmo' && f.endedAt === later.at)).toBe(true);
    expect(endLossFindings(a, later)).toBe(false); // nothing left to end
    expect(lossRedFlagFacts(a).findings).toEqual({});
    // The screens get the hospital's day of each moment: 01:00 in India on 6 Oct is 6 Oct, not the UTC 5 Oct
    const night = { lossType: 'missed' };
    setLossFindings(night, { os: 'closed' }, { ...drA, at: new Date('2026-10-05T19:30:00Z') });
    endLossFindings(night, { byName: 'Sample rmo', at: new Date('2026-10-06T20:00:00Z') });
    expect(lossFindingsView(night)[0]).toMatchObject({ on: new Date('2026-10-06T00:00:00Z'), endedOn: new Date('2026-10-07T00:00:00Z') });
  });

  it('where the pregnancy is for the red flags: not once it is treated (an operation recorded with its day, or "Treatment complete"); a visit after the operation or of an earlier loss neither', () => {
    const ectopic = (management = {}) => ({ lossType: 'ectopic', presentedOn: new Date('2026-10-05T00:00:00Z'), management, findings: [] });
    const OCT = (d) => new Date(`2026-10-${String(d).padStart(2, '0')}T00:00:00Z`);
    expect(lossLocationNow(ectopic({ method: 'expectant' }), OCT(5))).toBe('ectopic');
    expect(lossLocationNow(ectopic({ method: 'methotrexate', on: OCT(5) }), OCT(9))).toBe('ectopic'); // can still rupture
    const operated = ectopic({ method: 'laparoscopy', on: OCT(6) });
    expect(lossLocationNow(operated, OCT(5))).toBe('ectopic'); // planned for tomorrow
    expect(lossLocationNow(operated, OCT(6))).toBeNull();
    expect(lossLocationNow(ectopic({ method: 'laparoscopy' }), OCT(6))).toBe('ectopic'); // no day recorded yet
    expect(lossLocationNow(ectopic({ method: 'expectant', outcome: 'complete' }), OCT(20))).toBeNull();
    // A visit: the location as it was that day
    expect(lossLocationOn(operated, OCT(6))).toBe('ectopic'); // the day of the operation (before it)
    expect(lossLocationOn(operated, OCT(7))).toBeNull();
    expect(lossLocationOn(ectopic({ method: 'expectant' }), new Date('2026-08-01T00:00:00Z'))).toBeNull(); // more than 8 weeks before the date seen
    expect(lossLocationOn(ectopic({ method: 'expectant' }), new Date('2026-08-20T00:00:00Z'))).toBe('ectopic');
    // A rupture tick from before the operation no longer raises the flag; one recorded after it does
    const ticked = ectopic({ method: 'laparoscopy', on: OCT(5) });
    setLossFindings(ticked, { ruptureSigns: 'yes', bleeding: 'heavy' }, drA);
    expect(lossRedFlagFacts(ticked, { today: OCT(4) }).findings.ruptureSigns).toBeTruthy();
    expect(lossRedFlagFacts(ticked, { today: OCT(6) })).toEqual({ location: null, findings: { bleeding: { value: 'heavy', on: TODAY } } });
    setLossFindings(ticked, { ruptureSigns: '' }, rmo);
    setLossFindings(ticked, { ruptureSigns: 'yes' }, rmo); // recorded on 6 Oct, after the operation
    expect(lossRedFlagFacts(ticked, { today: OCT(7) }).findings.ruptureSigns).toMatchObject({ value: 'yes' });
    const complete = ectopic({ method: 'expectant', outcome: 'complete' });
    setLossFindings(complete, { ruptureSigns: 'yes' }, drA);
    expect(lossRedFlagFacts(complete, { today: OCT(6) }).findings).toEqual({});
  });
});

describe('the care plan follows the type of loss (the plan engine)', () => {
  const patient = (abortion, extra = {}) => ({ careType: 'abortion', abortion: { presentedOn: TODAY, ...abortion }, obstetric: { abortions: 0 }, medical: { bloodGroup: 'B+' }, ...extra });
  const facts = (abortion, extra) => planFacts(patient(abortion, extra), NOW, { careType: 'abortion' });
  const applies = (when, f) => ruleFor(when, f);

  it('counts from the day the loss was diagnosed (the date seen); nothing to count from before the type of loss is entered', () => {
    expect(facts({ lossType: 'missed' }).startOn).toEqual(TODAY);
    expect(lossStart({ abortion: { lossType: 'missed', presentedOn: new Date('2026-09-20T00:00:00Z') } })).toEqual(new Date('2026-09-20T00:00:00Z'));
    expect(lossStart({ abortion: null })).toBeNull();
    expect(lossStart({ abortion: { lossType: null, presentedOn: TODAY } })).toBeNull();
    expect(lossStart({ abortion: { lossType: 'missed', presentedOn: null } })).toBeNull();
    // A threatened miscarriage saved before 3 Oct 2026 is a continuing pregnancy: no plan for a loss
    expect(lossStart({ abortion: { lossType: 'threatened', presentedOn: TODAY } })).toBeNull();
  });

  it('molar; an ectopic managed by waiting or with methotrexate (not known until the management is recorded)', () => {
    expect(applies('loss_molar', facts({ lossType: 'molar' }))).toEqual({ rule: 'yes', why: null });
    expect(applies('loss_molar', facts({ lossType: 'missed' }))).toEqual({ rule: 'no', why: 'only_loss_molar' });
    const waiting = facts({ lossType: 'ectopic', management: { method: 'expectant' } });
    expect([applies('loss_ectopic_expectant', waiting).rule, applies('loss_ectopic_hcg', waiting).rule]).toEqual(['yes', 'yes']);
    const mtx = facts({ lossType: 'ectopic', management: { method: 'methotrexate' } });
    expect([applies('loss_ectopic_expectant', mtx), applies('loss_ectopic_hcg', mtx).rule]).toEqual([{ rule: 'no', why: 'only_loss_ectopic_expectant' }, 'yes']);
    const surgery = facts({ lossType: 'ectopic', management: { method: 'laparoscopy' } });
    expect([applies('loss_ectopic_expectant', surgery).rule, applies('loss_ectopic_hcg', surgery).rule]).toEqual(['no', 'no']);
    const undecided = facts({ lossType: 'ectopic', management: { method: null } });
    expect(applies('loss_ectopic_hcg', undecided)).toEqual({ rule: 'unknown', why: 'loss_management_unknown' });
    expect(applies('loss_ectopic_hcg', facts({ lossType: 'missed', management: { method: 'expectant' } })).rule).toBe('no');
  });

  it('the recurrent-loss work-up from the third loss – ONE number; one loss fewer is for the doctor to decide', () => {
    const N = serverLists.RECURRENT_WORKUP_FROM_LOSSES;
    expect(N).toBe(3);
    expect(serverLists.recurrentWorkupOrdinal()).toBe('third');
    const withLosses = (abortions, lossType = 'missed') => applies('loss_recurrent', facts({ lossType }, { obstetric: { abortions } }));
    expect(withLosses(N)).toEqual({ rule: 'yes', why: null });
    expect(withLosses(N + 2).rule).toBe('yes');
    // The loss being cared for now may not be counted in Abortions (A) yet: the doctor decides
    expect(withLosses(N - 1)).toEqual({ rule: 'unknown', why: 'loss_count_check' });
    expect(withLosses(N - 2)).toEqual({ rule: 'no', why: 'only_loss_recurrent' });
    expect(withLosses(null)).toEqual({ rule: 'unknown', why: 'loss_count_unknown' });
    expect(withLosses(0, 'recurrent').rule).toBe('yes'); // registered for the work-up itself
    // The number is not written into the template's words (stored in each hospital once, they would keep an old
    // number if the setting changed): the screens give it from the setting
    const workup = ABORTION_DRAFT.items.find((i) => i.key === 'loss_rpl_workup');
    expect(`${workup.name} ${workup.source}`).not.toMatch(/\b(second|third|fourth|fifth)\b/);
    expect(workup.source).toMatch(/from the number of losses set in the app/);
    expect(clientLists.recurrentWorkupOrdinal()).toBe('third');
  });

  it('the anti-D item follows the anti-D answer on the record (the same rule as the safety strip)', () => {
    const due = (abortion, bloodGroup) => applies('loss_anti_d_due', facts({ lossType: 'incomplete', ...abortion }, { medical: { bloodGroup } }));
    expect(due({}, 'O-').rule).toBe('yes');
    expect(due({ antiD: { status: 'not_yet' } }, 'O-').rule).toBe('yes');
    expect(due({ antiD: { status: 'declined' } }, 'O-').rule).toBe('yes'); // the doctor marks the item "not needed – declined"
    expect(due({ antiD: { status: 'given' } }, 'O-')).toEqual({ rule: 'no', why: 'only_loss_anti_d_due' });
    expect(due({ antiD: { status: 'not_needed' } }, 'O-').rule).toBe('no');
    expect(due({}, 'O+').rule).toBe('no');
    expect(due({}, '')).toEqual({ rule: 'unknown', why: 'rh_unknown' });
    expect(due({ antiD: { status: 'given' } }, '').rule).toBe('no');
    expect(applies('loss_anti_d_due', facts({ lossType: 'recurrent' }, { medical: { bloodGroup: 'O-' } })).rule).toBe('no'); // not pregnant now
  });

  it('a loss cared for now: every miscarriage, ectopic and molar pregnancy – not a record that is only for the recurrent-loss work-up', () => {
    for (const lossType of serverLists.LOSS_TYPE_KEYS.filter((t) => t !== 'recurrent')) expect([lossType, applies('loss_now', facts({ lossType })).rule]).toEqual([lossType, 'yes']);
    expect(applies('loss_now', facts({ lossType: 'recurrent' }))).toEqual({ rule: 'no', why: 'only_loss_now' });
  });

  it('a plan of another type of care never waits for a pregnancy-loss fact; the plan is worked out again when one changes', () => {
    const postnatal = planFacts({ careType: 'postnatal', lastDelivery: { at: NOW }, medical: { bloodGroup: 'O-' } }, NOW, { careType: 'postnatal' });
    for (const when of ['loss_molar', 'loss_ectopic_expectant', 'loss_ectopic_hcg', 'loss_recurrent', 'loss_anti_d_due', 'loss_now']) {
      expect(APPLIES_WHEN).toContain(when);
      expect(applies(when, postnatal).rule, when).toBe('no');
    }
    expect(postnatal.basisKey).not.toContain('loss:');
    const keys = new Set([
      facts({ lossType: 'ectopic', management: { method: null } }).basisKey,
      facts({ lossType: 'ectopic', management: { method: 'methotrexate' } }).basisKey,
      facts({ lossType: 'molar' }).basisKey,
      facts({ lossType: 'molar', antiD: { status: 'given' } }, { medical: { bloodGroup: 'O-' } }).basisKey,
      facts({ lossType: 'molar' }, { medical: { bloodGroup: 'O-' } }).basisKey,
      facts({ lossType: 'molar' }, { obstetric: { abortions: 3 } }).basisKey,
    ]);
    expect(keys.size).toBe(6);
  });
});

describe('the DRAFT template for care after pregnancy loss', () => {
  const item = (key) => ABORTION_DRAFT.items.find((i) => i.key === key);

  it('is a draft with its sources: a follow-up visit, haemoglobin, anti-D, contraception and next-pregnancy advice, beta hCG follow-up, the work-up', () => {
    expect(TEMPLATE_CARE_TYPES).toContain('abortion');
    expect(ABORTION_DRAFT.name).toMatch(/DRAFT$/);
    expect(ABORTION_DRAFT.description).toContain('Must be reviewed and approved by a doctor before use.');
    expect(ABORTION_DRAFT.items.every((i) => i.source && i.key.startsWith('loss_'))).toBe(true);
    // The follow-up visit in 1–2 weeks, the haemoglobin and contraception: for every loss cared for now
    expect(item('loss_followup')).toMatchObject({ kind: 'visit', fromWeek: 1, toWeek: 2, appliesWhen: 'loss_now' });
    expect(item('loss_hb')).toMatchObject({ kind: 'investigation', appliesWhen: 'loss_now' });
    expect(item('loss_antid')).toMatchObject({ kind: 'vaccination', appliesWhen: 'loss_anti_d_due' });
    expect(item('loss_adv_contraception')).toMatchObject({ kind: 'advice', appliesWhen: 'loss_now' });
    expect(item('loss_adv_next').kind).toBe('advice');
    expect(item('loss_adv_next').appliesWhen ?? 'always').toBe('always'); // also for the work-up
    // Every text fits what a doctor can save on the template page (the same limits as the template model)
    for (const i of ABORTION_DRAFT.items) {
      expect([i.key, i.name.length <= 200, i.patientText.length <= 300, i.source.length <= 400]).toEqual([i.key, true, true, true]);
    }
    expect(item('loss_rpl_workup')).toMatchObject({ kind: 'investigation', appliesWhen: 'loss_recurrent' });
    expect(item('loss_rpl_workup').name).toMatch(/the doctor decides when; ESHRE 2022 advises it after two losses/);
    // Abortions (A) may count losses that were not spontaneous: the doctor confirms (as the risk rules say)
    expect(item('loss_rpl_workup').source).toMatch(/ESHRE.*after two losses.*Abortions \(A\) – which may include losses that were not spontaneous: the doctor confirms, and decides for each woman/);
    // Sources that differ are said to differ (molar contraception: RCOG and WHO MEC); HbA1c is not claimed for ESHRE / RCOG
    expect(item('loss_molar_adv').source).toMatch(/RCOG Green-top Guideline 38.*WHO Medical eligibility criteria.*The two differ – the doctor confirms/);
  });

  it('states the beta hCG schedule and its source in the item text: molar as RCOG GTG 38, ectopic as NICE NG126 (methotrexate: NICE NG126 and RCOG GTG 21)', () => {
    const molar = ABORTION_DRAFT.items.filter((i) => i.appliesWhen === 'loss_molar' && i.kind === 'investigation');
    expect(molar.map((i) => [i.fromWeek, i.toWeek])).toEqual([[2, 2], [4, 4], [6, 6], [8, 8], [13, 14], [17, 18], [21, 22], [26, 27]]);
    for (const i of molar) {
      expect(i.name).toMatch(/^Beta hCG after molar pregnancy – (every 2 weeks until normal|monthly once normal, to 6 months) \(RCOG GTG 38\): /);
      expect(i.source).toMatch(/RCOG Green-top Guideline 38.*56 days.*FOGSI \/ FIGO 2021/);
    }
    expect(item('loss_molar_hcg_8w').name).toContain('56 days');
    const ectopic = ABORTION_DRAFT.items.filter((i) => ['loss_ectopic_expectant', 'loss_ectopic_hcg'].includes(i.appliesWhen));
    expect(ectopic.map((i) => [i.key, i.appliesWhen, i.fromWeek])).toEqual([
      ['loss_ect_hcg_d2', 'loss_ectopic_expectant', 0], // day 2: only when managed by waiting
      ['loss_ect_hcg_d4', 'loss_ectopic_hcg', 0],
      ['loss_ect_hcg_d7', 'loss_ectopic_hcg', 1],
      ['loss_ect_hcg_w2', 'loss_ectopic_hcg', 2],
      ['loss_ect_hcg_w3', 'loss_ectopic_hcg', 3],
      ['loss_ect_hcg_w4', 'loss_ectopic_hcg', 4],
      ['loss_ect_hcg_w5', 'loss_ectopic_hcg', 5],
      ['loss_ect_hcg_w6', 'loss_ectopic_hcg', 6],
    ]);
    for (const i of ectopic) {
      expect(i.name).toContain('NICE NG126');
      // Waiting: NICE NG126's own schedule; methotrexate: NICE NG126's days 4 and 7, the single-dose protocol of RCOG GTG 21;
      // after a salpingotomy the doctor includes them
      expect(i.source).toMatch(/Waiting – NICE NG126.*days 2, 4, 7.*Methotrexate – NICE NG126 and RCOG GTG 21.*days 4 and 7.*weekly until negative.*salpingotomy.*include these items yourself/);
      if (i.appliesWhen === 'loss_ectopic_hcg') expect(i.name, i.key).toContain('RCOG GTG 21');
    }
    // A reviewed beta hCG (or haemoglobin) result ticks the item off; a series one test at a time. Not the ectopic
    // tests of days 2, 4 and 7: the first hCG, on the day she is seen, would count as "day 2".
    const bhcg = LAB_TESTS.find((t) => t.key === 'bhcg');
    expect(bhcg.planSeries).toBe(true);
    const byHand = ['loss_ect_hcg_d2', 'loss_ect_hcg_d4', 'loss_ect_hcg_d7'];
    expect([...bhcg.planKeys].sort()).toEqual([...molar, ...ectopic].map((i) => i.key).filter((k) => !byHand.includes(k)).sort());
    for (const key of ['cbc', 'hb']) expect(LAB_TESTS.find((t) => t.key === key).planKeys).toContain('loss_hb');
  });

  it('never names the loss in the words for the patient, never mentions the baby, and has nothing about ending a pregnancy', () => {
    for (const i of ABORTION_DRAFT.items) {
      expect(i.patientText, i.key).toBeTruthy();
      expect(i.patientText, i.key).not.toMatch(/abortion|miscarriage|ectopic|molar|\bloss\b|pregnancy loss/i);
      for (const text of [i.name, i.patientText, i.source]) expect(mentionsFetalSex(text), `${i.key}: ${text}`).toBe(false);
    }
    expect(JSON.stringify(ABORTION_DRAFT)).not.toMatch(/MTP|terminat|induced|medical abortion|Form F/i);
    expect(JSON.stringify(LOSS_RULES)).not.toMatch(/MTP|terminat|induced|medical abortion|Form F/i);
  });

  it('no automatic "a check-up or test is due" message goes out from a pregnancy-loss care plan', () => {
    expect(careDueKinds('abortion')).toEqual([]);
    expect(careDueKinds('postnatal')).toEqual(['visit', 'investigation', 'scan', 'vaccination']);
  });
});

describe('the DRAFT red-flag rules for pregnancy-loss care (the rules engine)', () => {
  const visit = (vitals = {}) => ({ _id: 'v1', visitOn: TODAY, vitals, details: {} });
  const keysOf = (facts) => evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, facts).map((f) => f.key);
  const facts = (vitals, loss = null, extra = {}) => redFlagFacts({ careType: 'abortion', visit: vitals ? visit(vitals) : null, today: TODAY, loss, ...extra });
  const tick = (finding, value, on = TODAY) => ({ location: null, findings: { [finding]: { value, on } } });

  it('use the "applies to" field, name their source, and say what to consider with the source in the message', () => {
    expect(BUILT_IN_RED_FLAG_VERSION).toBe(3);
    expect(LOSS_RULES.map((r) => r.key)).toEqual(['loss_ectopic_pulse', 'loss_ectopic_bp', 'loss_rupture_signs', 'loss_sepsis_vitals', 'loss_sepsis_signs', 'loss_bleeding_heavy', 'loss_hb_severe', 'loss_lab_hb_severe']);
    for (const r of LOSS_RULES) {
      expect(r.appliesTo).toEqual(['abortion']);
      expect(BUILT_IN_SINCE[r.key]).toBe(3);
      expect(r.level).toBe('urgent');
      expect(r.source.length).toBeGreaterThan(20);
      expect(r.message).toMatch(/\((NICE NG126|WHO MCPC 2017|WHO haemoglobin thresholds)[^)]*\)$/); // ends with its source
      expect(r.message.length).toBeLessThanOrEqual(500);
      expect(r.source.length).toBeLessThanOrEqual(400);
      expect(website.ruleChecksText(r)).toBe(ruleText(r));
    }
    expect(Object.entries(RED_FLAG_FACTORS).filter(([, f]) => f.group === 'record').map(([k, f]) => [k, f.careTypes])).toEqual([
      ['lossLocation', ['abortion']],
      ['lossRuptureSigns', ['abortion']],
      ['lossBleeding', ['abortion']],
      ['lossFeverDischarge', ['abortion']],
    ]);
    expect(website.RED_FLAG_FACTORS).toEqual(RED_FLAG_FACTORS);
    expect(website.FACTOR_GROUPS.map((g) => g.key)).toContain('record');
  });

  it('possible ruptured ectopic: an ectopic or a pregnancy not yet located with pulse over 110 or systolic BP under 90, or signs of rupture', () => {
    const ectopic = { location: 'ectopic', findings: {} };
    const unknown = { location: 'unknown', findings: {} };
    expect(keysOf(facts({ pulse: 124, bpSystolic: 100, bpDiastolic: 60 }, ectopic))).toEqual(['loss_ectopic_pulse']);
    expect(keysOf(facts({ pulse: 96, bpSystolic: 84, bpDiastolic: 50 }, unknown))).toEqual(['loss_ectopic_bp']);
    expect(keysOf(facts({ pulse: 124, bpSystolic: 84, bpDiastolic: 50 }, ectopic))).toEqual(['loss_ectopic_pulse', 'loss_ectopic_bp']);
    expect(keysOf(facts({ pulse: 110, bpSystolic: 90, bpDiastolic: 60 }, ectopic))).toEqual([]); // exactly 110 and 90: not over / under
    expect(keysOf(facts({ pulse: 124, bpSystolic: 84, bpDiastolic: 50 }, { location: null, findings: {} }))).toEqual([]); // a pregnancy seen in the uterus
    expect(keysOf(facts(null, ectopic))).toEqual([]); // the location alone raises nothing
    // The tick on her record needs no vital signs
    const [flag] = evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, facts(null, tick('ruptureSigns', 'yes')));
    expect(flag).toMatchObject({ key: 'loss_rupture_signs', label: 'Possible ruptured ectopic pregnancy', level: 'urgent', detail: 'Signs of rupture yes', rule: 'Signs of rupture: yes', sources: [{ source: 'record', on: TODAY }] });
    expect(flag.message).toMatch(/Consider a ruptured ectopic pregnancy.*\(NICE NG126; RCOG GTG 21\)$/);
    expect(flagFromText(flag)).toBe('from her record, 5 Oct 2026');
    expect(keysOf(facts(null, tick('ruptureSigns', 'no')))).toEqual([]);
    // The location with a visit's pulse: the flag says both, and where the pulse is from
    const [byPulse] = evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, facts({ pulse: 124 }, ectopic));
    expect(byPulse).toMatchObject({ detail: 'Pregnancy location ectopic, Pulse 124 /min', rule: 'Pregnancy location: ectopic or unknown and Pulse over 110 /min', sources: [{ source: 'visit', visitId: 'v1' }] });
  });

  it('possible septic abortion: temperature 100.4 °F or more with pulse over 110, or the fever-and-discharge tick', () => {
    expect(keysOf(facts({ temperatureF: 100.4, pulse: 112 }))).toEqual(['loss_sepsis_vitals']);
    expect(keysOf(facts({ temperatureF: 101.2, pulse: 110 }))).toEqual([]);
    expect(keysOf(facts({ temperatureF: 100.2, pulse: 124 }))).toEqual([]);
    expect(keysOf(facts(null, tick('feverDischarge', 'yes')))).toEqual(['loss_sepsis_signs']);
    const [flag] = evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, facts({ temperatureF: 102, pulse: 124 }));
    expect(flag).toMatchObject({ label: 'Possible septic abortion', level: 'urgent', detail: 'Temperature 102 °F, Pulse 124 /min' });
    expect(flag.message).toMatch(/Consider a septic abortion.*IV antibiotics.*\(WHO MCPC 2017; RCOG GTG 64a\)$/);
  });

  it('heavy bleeding, or Hb under 7 (at a visit or from the lab – the newer reading)', () => {
    expect(keysOf(facts(null, tick('bleeding', 'heavy')))).toEqual(['loss_bleeding_heavy']);
    expect(keysOf(facts(null, tick('bleeding', 'moderate')))).toEqual([]);
    expect(keysOf(facts({ hb: 6.8 }))).toEqual(['loss_hb_severe']);
    expect(keysOf(facts({ hb: 7 }))).toEqual([]);
    const lab = { labHb: { value: 6.5, on: new Date('2026-10-03T00:00:00Z'), at: new Date('2026-10-03T05:00:00Z'), orderId: 'o1' } };
    expect(keysOf(facts(null, null, { lab }))).toEqual(['loss_lab_hb_severe']);
    expect(keysOf(facts({ hb: 9.4 }, null, { lab }))).toEqual([]); // today's visit reading is the newer one
  });

  it('are for pregnancy-loss care only: the same values raise none of them for another type of care', () => {
    const loss = { location: 'ectopic', findings: { ruptureSigns: { value: 'yes', on: TODAY }, bleeding: { value: 'heavy', on: TODAY }, feverDischarge: { value: 'yes', on: TODAY } } };
    for (const careType of CARE_TYPES.filter((t) => t !== 'abortion')) {
      const got = evaluateRedFlags(BUILT_IN_RED_FLAG_RULES, redFlagFacts({ careType, visit: visit({ pulse: 124, bpSystolic: 84, bpDiastolic: 50, temperatureF: 102 }), today: TODAY, loss }));
      expect(got.filter((f) => f.key.startsWith('loss_')), careType).toEqual([]);
    }
  });

  it('the website says where a record finding is from, with a link to her record', () => {
    expect(websiteSourceText({ source: 'record', on: '2026-10-05T00:00:00.000Z' })).toBe('her record, 5 Oct 2026');
    expect(websiteSourceLink('p1', { source: 'record', on: '2026-10-05T00:00:00.000Z' })).toBe('/patients/p1');
  });
});

// ---------- Through the app ----------

let app;
let hospital;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant('Pregnancy Loss Care Hospital');
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
const at = (iso) => {
  vi.setSystemTime(new Date(iso));
  app = createApp();
  sessions = {};
};
const register = async (fields = {}, who = 'drA') => {
  const res = await (await as(who)).post('/api/patients').send(samplePatient({ careType: 'abortion', fullName: 'Loss Sample', assignedDoctor: people.drA._id.toString(), medical: { allergies: 'None known', bloodGroup: 'B+' }, ...fields }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.patient;
};
const edit = async (p, body, who = 'drA') => (await as(who)).patch(`/api/patients/${p.id}`).send(body);
const MISSED = { lossType: 'missed', lmp: '2026-08-02', presentedOn: '2026-10-05', management: { method: 'medical', on: '2026-10-05', outcome: 'in_progress' } };
// Registered in two steps, as the website does: the patient, then the pregnancy-loss section
const lossPatient = async (abortion = MISSED, fields = {}) => {
  const p = await register(fields);
  const res = await edit(p, { abortion });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.patient;
};
const record = async (who, p) => (await (await as(who)).get(`/api/patients/${p.id}`)).body.patient;
const putFindings = async (who, p, body) => (await as(who)).put(`/api/patients/${p.id}/loss-findings`).send(body);
const current = (patient) => Object.fromEntries((patient.abortion?.findings ?? []).filter((f) => f.current).map((f) => [f.key, f.value]));
const plan = async (who, p) => (await (await as(who)).get(`/api/patients/${p.id}/care-plan`)).body;
const item = (view, key) => view.plan.items.find((i) => i.key === key);
const fieldsOf = (res) => res.body.error?.fields ?? {};
const lastAudit = async (p, action = 'PATIENT_UPDATED') => (await AuditLog.find({ action, 'details.patientId': p.id }).sort({ _id: -1 }).limit(1).lean())[0];
async function visitWith(p, vitals, who = 'drA') {
  const res = await (await as(who)).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const saved = await (await as(who)).patch(`/api/patients/${p.id}/visits/${res.body.visit.id}`).send({ vitals: { rev: 0, ...vitals } });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return saved.body;
}
const lab = (path) => `/api/lab/orders/${path}`;
// A lab test ordered, the sample taken, the result reported by the lab and reviewed by her doctor
async function reviewedResult(p, key, values, comment = '') {
  const ordered = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key }] });
  expect(ordered.status, JSON.stringify(ordered.body)).toBe(201);
  const collected = (await (await as('lab')).post(lab(`${ordered.body.order.id}/collect`)).send({ rev: ordered.body.order.rev })).body.order;
  const reported = await (await as('lab')).put(lab(`${collected.id}/results`)).send({ rev: collected.rev, tests: [{ key, values }], report: true });
  expect(reported.status, JSON.stringify(reported.body)).toBe(200);
  const reviewed = await (await as('drA')).post(lab(`${collected.id}/review`)).send({ rev: reported.body.order.rev, comment });
  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
  return reviewed.body;
}

describe('findings on the record', () => {
  it('a doctor records them with the pregnancy-loss section: each with who and when; the section can be saved again without losing them', async () => {
    const p = await lossPatient({ ...MISSED, findings: { os: 'closed', sacSeen: 'yes', sacDiameterMm: '26', crlMm: '7.5', heartbeat: 'no', bleeding: 'light', adnexalMass: '', ruptureSigns: 'yes' } });
    expect(current(p)).toEqual({ os: 'closed', sacSeen: 'yes', sacDiameterMm: 26, crlMm: 7.5, heartbeat: 'no', bleeding: 'light' }); // no "signs of rupture" for a pregnancy seen in the uterus
    for (const f of p.abortion.findings) {
      expect(f).toMatchObject({ byName: 'Sample drA', via: 'record', current: true, endedAt: null });
      expect(day(f.at)).toBe('2026-10-05');
      expect(day(f.on)).toBe('2026-10-05'); // the hospital's day it was recorded
      expect(Object.keys(f).sort()).toEqual(['at', 'byName', 'current', 'endedAt', 'endedByName', 'endedOn', 'key', 'on', 'value', 'via']); // no staff ids
    }
    // The audit entry names the field – never which finding, nor its value
    const entry = await lastAudit(p);
    expect(entry.details.fields).toContain('abortion.findings');
    expect(JSON.stringify(entry.details)).not.toMatch(/crlMm|heartbeat|closed|7\.5|light/);

    // The section saved again without the findings (an older page, or voice entry): they stay as they are
    at('2026-10-06T06:00:00Z');
    const again = await edit(p, { abortion: { ...MISSED, management: { method: 'surgical_evacuation', on: '2026-10-06', outcome: 'complete' } } }, 'rmo');
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(current(again.body.patient)).toEqual(current(p));
    expect(again.body.patient.abortion.findings.every((f) => f.byName === 'Sample drA')).toBe(true);
    expect((await lastAudit(p)).details.fields).not.toContain('abortion.findings');

    // The RMO changes one finding on the form: only that one is written, with the RMO's name and the new day
    const seen = { ...current(p) };
    const changed = await edit(p, { abortion: { ...MISSED, findings: { ...seen, bleeding: 'heavy' }, findingsSeen: seen } }, 'rmo');
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const list = changed.body.patient.abortion.findings;
    expect(list.filter((f) => f.key === 'bleeding').map((f) => [f.value, f.byName, f.current, f.endedByName, day(f.at)])).toEqual([
      ['light', 'Sample drA', false, 'Sample rmo', '2026-10-05'],
      ['heavy', 'Sample rmo', true, null, '2026-10-06'],
    ]);
    expect(list.filter((f) => f.key !== 'bleeding').every((f) => f.byName === 'Sample drA' && f.current)).toBe(true);
    expect((await lastAudit(p)).details.fields).toContain('abortion.findings');
    const stored = await Patient.findOne({ _id: p.id, tenantId: hospital._id }).lean();
    expect(stored.abortion.findings.find((f) => f.value === 'heavy')).toMatchObject({ by: people.rmo._id, visitId: null });
    // The entries kept through the two saves still carry who recorded them (the staff id), not only the name
    const kept = stored.abortion.findings.filter((f) => f.byName === 'Sample drA');
    expect(kept).toHaveLength(6);
    expect(kept.every((f) => String(f.by) === String(people.drA._id) && day(f.at) === '2026-10-05')).toBe(true);
  });

  it('a doctor can send them with the registration; a recurrent-loss work-up keeps none', async () => {
    const res = await (await as('drA')).post('/api/patients').send(
      samplePatient({ careType: 'abortion', fullName: 'Loss Sample', medical: { allergies: 'None known' }, abortion: { lossType: 'ectopic', ectopicSite: 'tube', findings: { adnexalMass: 'yes', freeFluid: 'yes', ruptureSigns: 'no' } } }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(current(res.body.patient)).toEqual({ adnexalMass: 'yes', freeFluid: 'yes', ruptureSigns: 'no' });
    expect(res.body.patient.abortion.findings.every((f) => f.byName === 'Sample drA')).toBe(true);
    const workup = await (await as('drA')).post('/api/patients').send(
      samplePatient({ careType: 'abortion', fullName: 'Workup Sample', medical: { allergies: 'None known' }, abortion: { lossType: 'recurrent', management: { method: 'workup' }, findings: { os: 'open', bleeding: 'heavy' } } }),
    );
    expect(workup.status, JSON.stringify(workup.body)).toBe(201);
    expect(workup.body.patient.abortion.findings).toEqual([]);
    // Reception registers the patient only: no pregnancy-loss section, no findings
    const byReception = await register({ abortion: { lossType: 'missed', findings: { os: 'open' } } }, 'reception');
    expect(byReception.abortion).toBeUndefined();
    expect((await Patient.findOne({ _id: byReception.id, tenantId: hospital._id }).lean()).abortion).toBeNull();
  });

  it('refuses what is not an answer of the list or a sensible number of millimetres, with the reason on the field', async () => {
    const p = await lossPatient();
    const bad = await edit(p, { abortion: { ...MISSED, findings: { os: 'half open', crlMm: 'about 7', sacDiameterMm: '900', heartbeat: true, bleeding: 'heavy' } } });
    expect(bad.status).toBe(400);
    expect(fieldsOf(bad)).toMatchObject({
      'abortion.findings.os': 'Choose an answer for "Cervical os" from the list',
      'abortion.findings.crlMm': 'Crown–rump length must be a number of mm, for example 7 or 7.5',
      'abortion.findings.sacDiameterMm': 'Mean sac diameter is too high',
      'abortion.findings.heartbeat': 'Choose an answer for "Heartbeat seen" from the list',
    });
    expect(current(await record('drA', p))).toEqual({}); // nothing was saved
    // A field that does not exist (there is none about the baby) is refused
    const unknown = await edit(p, { abortion: { ...MISSED, findings: { fetalSex: 'male' } } });
    expect(unknown.status).toBe(400);
    for (const value of ['1e2', '0x10', '7.55', '-3']) expect((await edit(p, { abortion: { ...MISSED, findings: { crlMm: value } } })).status, value).toBe(400);
    const ok = await edit(p, { abortion: { ...MISSED, findings: { crlMm: '7,5', sacDiameterMm: 25 } } });
    expect(current(ok.body.patient)).toEqual({ crlMm: 7.5, sacDiameterMm: 25 });
  });

  it('from the visit page: the treating doctor or an RMO; nurses, reception, other doctors and other hospitals cannot; the visit must be hers and still count', async () => {
    const p = await lossPatient({ lossType: 'ectopic', lmp: '2026-08-24', presentedOn: '2026-10-05', ectopicSite: 'tube', management: { method: 'expectant' } });
    const page = await visitWith(p, { pulse: 88, bpSystolic: 110, bpDiastolic: 70 });
    const saved = await putFindings('drA', p, { findings: { adnexalMass: 'yes', freeFluid: 'no', ruptureSigns: 'no' }, visitId: page.visit.id });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.changed).toBe(true);
    expect(current(saved.body.patient)).toEqual({ adnexalMass: 'yes', freeFluid: 'no', ruptureSigns: 'no' });
    expect(saved.body.patient.abortion.findings.every((f) => f.via === 'visit' && f.byName === 'Sample drA')).toBe(true);
    expect((await Patient.findOne({ _id: p.id, tenantId: hospital._id }).lean()).abortion.findings.every((f) => String(f.visitId) === page.visit.id)).toBe(true);
    const entry = await lastAudit(p);
    expect(entry.details).toEqual({ patientId: p.id, mrn: p.mrn, fields: ['abortion.findings'] });
    // The same values again: nothing changes, nothing is audited
    const before = await AuditLog.countDocuments({ action: 'PATIENT_UPDATED' });
    expect((await putFindings('rmo', p, { findings: { adnexalMass: 'yes' } })).body.changed).toBe(false);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_UPDATED' })).toBe(before);
    // An RMO may; only what was changed on the card is written
    const byRmo = await putFindings('rmo', p, { findings: { adnexalMass: 'yes', freeFluid: 'yes', ruptureSigns: 'no' }, seen: { adnexalMass: 'yes', freeFluid: 'no', ruptureSigns: 'no' } });
    expect(byRmo.status).toBe(200);
    expect(byRmo.body.patient.abortion.findings.filter((f) => f.current).map((f) => [f.key, f.value, f.byName, f.via])).toEqual(
      expect.arrayContaining([['adnexalMass', 'yes', 'Sample drA', 'visit'], ['freeFluid', 'yes', 'Sample rmo', 'record']]),
    );

    // Who may not
    expect((await putFindings('nurse', p, { findings: { bleeding: 'heavy' } })).status).toBe(403);
    expect((await putFindings('reception', p, { findings: { bleeding: 'heavy' } })).status).toBe(403);
    expect((await putFindings('lab', p, { findings: { bleeding: 'heavy' } })).status).toBe(403);
    const other = await putFindings('drB', p, { findings: { bleeding: 'heavy' } });
    expect(other.status).toBe(403);
    expect(other.body.error.message).toBe("This is another doctor's patient: you can view the record, but not change it.");
    const elsewhere = await createTenant('Other Hospital');
    const outsider = await createUser({ name: 'Sample outsider' });
    await addMember(outsider, elsewhere, 'doctor');
    const o = await loginAs(outsider, { app });
    expect((await o.put(`/api/patients/${p.id}/loss-findings`).send({ findings: { bleeding: 'heavy' } })).status).toBe(404);
    expect(current(await record('drA', p)).bleeding).toBeUndefined();

    // The visit must be hers, and not marked "entered in error"
    const someoneElse = await lossPatient(MISSED, { fullName: 'Second Sample' });
    const theirs = await visitWith(someoneElse, { pulse: 80 });
    expect((await putFindings('drA', p, { findings: { bleeding: 'light' }, visitId: theirs.visit.id })).status).toBe(404);
    expect((await (await as('drA')).post(`/api/patients/${p.id}/visits/${page.visit.id}/cancel`).send({ reason: 'Started for the wrong patient' })).status).toBe(200);
    const cancelled = await putFindings('drA', p, { findings: { bleeding: 'light' }, visitId: page.visit.id });
    expect(cancelled.status).toBe(409);
    expect(current(await record('drA', p)).bleeding).toBeUndefined();
    // Unknown fields are refused
    expect((await putFindings('drA', p, { findings: { bleeding: 'light' }, note: 'typed text' })).status).toBe(400);
  });

  it('only for pregnancy-loss care with a type of loss that is a pregnancy now', async () => {
    const gynae = await register({ careType: 'gynaecology', fullName: 'Gynae Sample' });
    const notLoss = await putFindings('drA', gynae, { findings: { bleeding: 'heavy' } });
    expect(notLoss.status).toBe(400);
    expect(notLoss.body.error.message).toBe('Pregnancy loss details are only for the Abortion type of care');
    const noType = await register();
    const early = await putFindings('drA', noType, { findings: { bleeding: 'heavy' } });
    expect(early.status).toBe(400);
    expect(early.body.error.message).toMatch(/not before the type of loss is entered/);
    const workup = await lossPatient({ lossType: 'recurrent', management: { method: 'workup' } });
    expect((await putFindings('drA', workup, { findings: { bleeding: 'heavy' } })).status).toBe(400);
    // An old threatened miscarriage (a continuing pregnancy): the record must be moved first
    const old = await register({ fullName: 'Old Sample' });
    await Patient.collection.updateOne({ _id: (await Patient.findOne({ tenantId: hospital._id, _id: old.id }))._id }, { $set: { abortion: { lossType: 'threatened', presentedOn: new Date('2026-09-21T00:00:00Z') } } });
    const threatened = await putFindings('drA', old, { findings: { bleeding: 'light' } });
    expect(threatened.status).toBe(400);
    expect(threatened.body.error.message).toBe(serverLists.RETIRED_LOSS_MESSAGE);
  });

  it('nurses and RMOs see them; reception and the lab see nothing of them; the Patients list loads only the type of loss', async () => {
    const p = await lossPatient({ ...MISSED, findings: { os: 'closed', bleeding: 'light' } });
    for (const who of ['nurse', 'rmo', 'drB']) expect(current(await record(who, p)), who).toEqual({ os: 'closed', bleeding: 'light' });
    for (const who of ['reception', 'lab']) expect((await record(who, p)).abortion, who).toBeUndefined();
    const row = (await (await as('drA')).get('/api/patients?careType=abortion')).body.patients[0];
    expect(row.abortion).toEqual({ lossType: 'missed' });
    // A sensitive record: only the treating doctor and RMOs
    expect((await (await as('drA')).patch(`/api/patients/${p.id}/sensitive`).send({ sensitive: true })).status).toBe(200);
    expect((await record('nurse', p)).abortion).toBeUndefined();
    expect((await record('drB', p)).abortion).toBeUndefined();
    expect(current(await record('rmo', p))).toEqual({ os: 'closed', bleeding: 'light' });
  });

  it('a record saved before findings existed still opens and saves; the AI summary is told the findings without a name', async () => {
    const p = await lossPatient();
    // As stored before this feature: a pregnancy-loss section with no findings list at all
    await Patient.collection.updateOne({ _id: (await Patient.findOne({ tenantId: hospital._id, _id: p.id }))._id }, { $unset: { 'abortion.findings': '' } });
    const opened = await record('drA', p);
    expect(opened.abortion.findings).toEqual([]);
    expect((await edit(p, { abortion: MISSED, medical: { allergies: 'None known', bloodGroup: 'B+' } })).status).toBe(200);
    expect((await putFindings('drA', p, { findings: { os: 'open', productsSeen: 'yes', bleeding: 'moderate' } })).status).toBe(200);
    const text = await patientContext({ tenantId: hospital._id, user: people.drA, now: new Date() }, await Patient.findOne({ tenantId: hospital._id, _id: p.id }));
    expect(text).toContain('Pregnancy loss findings (on her record): cervical os: open (recorded 2026-10-05); products of conception seen: yes (recorded 2026-10-05); bleeding: moderate (recorded 2026-10-05)');
    expect(text).not.toMatch(/Loss Sample|P-0000/);
  });
});

describe('the care plan for pregnancy-loss care', () => {
  const standard = () => CarePlanTemplate.findOne({ tenantId: hospital._id, careType: 'abortion', kind: 'standard' });

  it('every hospital gets the DRAFT template; a doctor can edit and approve it like the others', async () => {
    const t = await standard();
    expect(t).toMatchObject({ status: 'draft', version: 1, updatedByName: 'Built-in draft' });
    expect(t.items).toHaveLength(ABORTION_DRAFT.items.length);
    // A hospital from before this type of care had a template gets it on its next request
    await CarePlanTemplate.deleteOne({ _id: t._id, tenantId: hospital._id });
    const listed = (await (await as('nurse')).get('/api/care-plans/templates?careType=abortion')).body.templates;
    expect(listed.map((x) => [x.careType, x.kind, x.status, x.itemCount])).toEqual([['abortion', 'standard', 'draft', ABORTION_DRAFT.items.length]]);
    // Saved again as it is (every text passes the checks for templates), then approved by a doctor
    const url = `/api/care-plans/templates/${listed[0].id}`;
    const body = (await (await as('drA')).get(url)).body.template;
    const items = body.items.map(({ key, kind, name, patientText, atBooking, fromWeek, toWeek, after, appliesWhen, source }) => ({ key, kind, name, patientText, atBooking, fromWeek, toWeek, after, appliesWhen, source }));
    expect((await (await as('rmo')).put(url).send({ version: body.version, name: body.name, description: body.description, sources: body.sources, items })).status).toBe(403);
    const saved = await (await as('drA')).put(url).send({ version: body.version, name: body.name, description: body.description, sources: body.sources, items });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.template).toMatchObject({ status: 'draft', version: 2 });
    const approved = await (await as('drA')).post(`${url}/approve`).send({ confirm: true, version: 2 });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.template.status).toBe('approved');
    // The built-in draft is not put back over a doctor's template
    resetApprovalBackfill();
    await ensureStandardTemplates(hospital._id);
    expect(await standard()).toMatchObject({ status: 'approved', version: 2 });
  });

  it('starts by itself, counted from the date seen: the follow-up visit in 1–2 weeks, haemoglobin, advice; a draft until approved', async () => {
    const noType = await register();
    expect(await plan('drA', noType)).toMatchObject({ plan: null, reason: 'no_loss_details' });
    expect((await record('drA', noType)).carePlanSummary).toMatchObject({ exists: false, reason: 'no_loss_details' });
    const started = await (await as('drA')).post(`/api/patients/${noType.id}/care-plan/start`);
    expect(started.status).toBe(400);
    expect(started.body.error.message).toBe('This plan starts by itself from the pregnancy dates, the delivery, the birth or the date a pregnancy loss was seen.');

    const p = await lossPatient();
    const view = await plan('nurse', p);
    expect(view.plan).toMatchObject({ careType: 'abortion', status: 'active', startWord: 'loss', readOnly: true });
    expect(day(view.plan.startOn)).toBe('2026-10-05');
    expect(view.plan.template).toMatchObject({ approved: false, label: 'Draft – not approved for clinical use' });
    expect([day(item(view, 'loss_followup').window.from), day(item(view, 'loss_followup').window.to)]).toEqual(['2026-10-12', '2026-10-25']);
    expect(item(view, 'loss_followup')).toMatchObject({ kind: 'visit', status: 'upcoming', applies: 'yes' });
    expect(item(view, 'loss_hb')).toMatchObject({ status: 'due', applies: 'yes' });
    expect(item(view, 'loss_adv_contraception').status).toBe('due');
    expect(item(view, 'loss_adv_next').status).toBe('upcoming');
    // A missed miscarriage in an Rh-positive woman with no earlier loss: nothing else applies
    const applying = view.plan.items.filter((i) => i.applies === 'yes').map((i) => i.key);
    expect(applying).toEqual(['loss_followup', 'loss_hb', 'loss_adv_contraception', 'loss_adv_next']);
    expect(item(view, 'loss_molar_hcg_2w')).toMatchObject({ status: 'not_applicable', why: 'only_loss_molar' });
    expect(item(view, 'loss_ect_hcg_d4')).toMatchObject({ status: 'not_applicable', why: 'only_loss_ectopic_hcg' });
    expect(item(view, 'loss_antid')).toMatchObject({ status: 'not_applicable', why: 'only_loss_anti_d_due' });
    expect(item(view, 'loss_rpl_workup')).toMatchObject({ status: 'check_needed', why: 'loss_count_unknown' }); // Abortions (A) not recorded
    expect(view.plan.missingFacts).toEqual(['Abortions (A) in the obstetric history']);
    expect((await record('drA', p)).carePlanSummary).toMatchObject({ exists: true, careType: 'abortion', startWord: 'loss' });
    // Building a patient's first plan is audited (ids only)
    const created = await lastAudit(p, 'CARE_PLAN_CREATED');
    expect(Object.keys(created.details).sort()).toEqual(['mrn', 'patientId', 'planId']);

    // Who may see and change it
    expect((await (await as('reception')).get(`/api/patients/${p.id}/care-plan`)).status).toBe(403);
    expect((await (await as('lab')).get(`/api/patients/${p.id}/care-plan`)).status).toBe(403);
    const hb = item(view, 'loss_hb');
    const done = { action: 'done', rev: hb.rev, on: '2026-10-05' };
    expect((await (await as('nurse')).patch(`/api/patients/${p.id}/care-plan/items/${hb.id}`).send(done)).status).toBe(403);
    expect((await (await as('drB')).patch(`/api/patients/${p.id}/care-plan/items/${hb.id}`).send(done)).status).toBe(403);
    expect((await (await as('rmo')).patch(`/api/patients/${p.id}/care-plan/items/${hb.id}`).send(done)).status).toBe(200);
    const elsewhere = await createTenant('Other Hospital');
    const outsider = await createUser({ name: 'Sample outsider' });
    await addMember(outsider, elsewhere, 'doctor');
    expect((await (await loginAs(outsider, { app })).get(`/api/patients/${p.id}/care-plan`)).status).toBe(404);
  });

  it('a patient registered before there was a plan for pregnancy-loss care gets one when her record is next read', async () => {
    const doc = await Patient.create({
      tenantId: hospital._id,
      mrn: 'P-000900',
      careType: 'abortion',
      fullName: 'Earlier Sample',
      ageYears: 30,
      ageRecordedOn: new Date('2026-09-01T00:00:00Z'),
      assignedDoctor: people.drA._id,
      createdBy: people.drA._id,
      medical: { bloodGroup: 'A+', allergies: 'None known' },
      obstetric: { gravida: 2, para: 1, living: 1, abortions: 1 },
      abortion: { lossType: 'incomplete', presentedOn: new Date('2026-09-10T00:00:00Z'), management: { method: 'surgical_evacuation', on: new Date('2026-09-10T00:00:00Z'), outcome: 'complete' } },
    });
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: doc._id })).toBe(0);
    const p = await record('drA', { id: String(doc._id) });
    expect(p.carePlanSummary).toMatchObject({ exists: true, careType: 'abortion', status: 'active' });
    const view = await plan('drA', { id: String(doc._id) });
    expect(day(view.plan.startOn)).toBe('2026-09-10'); // counted from the day the loss was diagnosed
    // What had already passed when the plan was built is not "overdue": the visit is before the start, the test is for the doctor to decide
    expect(item(view, 'loss_followup').status).toBe('lapsed');
    expect(item(view, 'loss_hb').status).toBe('decide');
    expect(item(view, 'loss_rpl_workup')).toMatchObject({ status: 'not_applicable', why: 'only_loss_recurrent' }); // one loss
    expect(view.plan.items.some((i) => i.status === 'overdue')).toBe(false);
  });

  it('a molar pregnancy: beta hCG every 2 weeks, then monthly to 6 months, and the advice; Rh negative: the anti-D item until it is recorded', async () => {
    const p = await lossPatient({ lossType: 'molar', lmp: '2026-07-27', presentedOn: '2026-10-05', moleKind: 'awaiting', management: { method: 'suction_evacuation', on: '2026-10-05', outcome: 'in_progress' } }, { medical: { allergies: 'None known', bloodGroup: 'O-' } });
    let view = await plan('drA', p);
    const hcg = view.plan.items.filter((i) => i.key.startsWith('loss_molar_hcg_'));
    expect(hcg.map((i) => [i.key, i.applies, day(i.window.from)])).toEqual([
      ['loss_molar_hcg_2w', 'yes', '2026-10-19'],
      ['loss_molar_hcg_4w', 'yes', '2026-11-02'],
      ['loss_molar_hcg_6w', 'yes', '2026-11-16'],
      ['loss_molar_hcg_8w', 'yes', '2026-11-30'], // 56 days
      ['loss_molar_hcg_3m', 'yes', '2027-01-04'],
      ['loss_molar_hcg_4m', 'yes', '2027-02-01'],
      ['loss_molar_hcg_5m', 'yes', '2027-03-01'],
      ['loss_molar_hcg_6m', 'yes', '2027-04-05'],
    ]);
    expect(item(view, 'loss_molar_adv')).toMatchObject({ applies: 'yes', kind: 'advice' });
    expect(item(view, 'loss_ect_hcg_d4').applies).toBe('no');
    expect(item(view, 'loss_antid')).toMatchObject({ applies: 'yes', status: 'due' });
    // Anti-D recorded on the record (Pregnancy loss → Anti-D): the item no longer asks – nothing is entered twice
    const given = await edit(p, { abortion: { lossType: 'molar', lmp: '2026-07-27', presentedOn: '2026-10-05', moleKind: 'awaiting', management: { method: 'suction_evacuation', on: '2026-10-05', outcome: 'in_progress' }, antiD: { status: 'given', on: '2026-10-05' } } });
    expect(given.status, JSON.stringify(given.body)).toBe(200);
    view = await plan('drA', p);
    expect(item(view, 'loss_antid')).toMatchObject({ applies: 'no', status: 'not_applicable', why: 'only_loss_anti_d_due' });
    // The patient portal's words never name the loss
    expect(view.plan.items.filter((i) => i.applies === 'yes').map((i) => i.patientText).join(' ')).not.toMatch(/molar|miscarriage|abortion|\bloss\b/i);
  });

  it('an ectopic: "check needed" until the management is recorded; by waiting – days 2, 4 and 7 then weekly; methotrexate – days 4 and 7 then weekly; surgery – none', async () => {
    const ectopic = (management) => ({ lossType: 'ectopic', lmp: '2026-08-24', presentedOn: '2026-10-05', ectopicSite: 'tube', ...(management ? { management } : {}) });
    const p = await lossPatient(ectopic(null));
    const hcgKeys = ['loss_ect_hcg_d2', 'loss_ect_hcg_d4', 'loss_ect_hcg_d7', 'loss_ect_hcg_w2', 'loss_ect_hcg_w3', 'loss_ect_hcg_w4', 'loss_ect_hcg_w5', 'loss_ect_hcg_w6'];
    const state = (view) => hcgKeys.map((k) => item(view, k).applies);
    let view = await plan('drA', p);
    expect(state(view)).toEqual(hcgKeys.map(() => 'unknown'));
    expect(item(view, 'loss_ect_hcg_d4')).toMatchObject({ status: 'check_needed', why: 'loss_management_unknown' });
    expect(view.plan.missingFacts).toContain('Management of the ectopic pregnancy');

    expect((await edit(p, { abortion: ectopic({ method: 'expectant' }) })).status).toBe(200);
    view = await plan('drA', p);
    expect(state(view)).toEqual(hcgKeys.map(() => 'yes'));
    expect(hcgKeys.map((k) => day(item(view, k).window.from))).toEqual(['2026-10-05', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    expect(view.plan.missingFacts).not.toContain('Management of the ectopic pregnancy');

    expect((await edit(p, { abortion: ectopic({ method: 'methotrexate', on: '2026-10-05' }) })).status).toBe(200);
    view = await plan('drA', p);
    expect(state(view)).toEqual(['no', ...hcgKeys.slice(1).map(() => 'yes')]);
    expect(item(view, 'loss_ect_hcg_d2')).toMatchObject({ status: 'not_applicable', why: 'only_loss_ectopic_expectant' });

    expect((await edit(p, { abortion: ectopic({ method: 'laparoscopy', on: '2026-10-05' }) })).status).toBe(200);
    view = await plan('drA', p);
    expect(state(view)).toEqual(hcgKeys.map(() => 'no'));
    expect(item(view, 'loss_followup').applies).toBe('yes');
  });

  it('the recurrent-loss work-up: from the third loss on the record; with two the doctor is asked to decide; always for a work-up record', async () => {
    const withLosses = (abortions) => ({ obstetric: { gravida: abortions + 1, para: 0, living: 0, abortions } });
    const third = await lossPatient(MISSED);
    expect((await edit(third, withLosses(3))).status).toBe(200);
    expect(item(await plan('drA', third), 'loss_rpl_workup')).toMatchObject({ applies: 'yes', status: 'due' });
    expect(item(await plan('drA', third), 'loss_rpl_workup').name).toContain('Recurrent-loss work-up (the doctor decides when; ESHRE 2022 advises it after two losses)');
    const second = await lossPatient(MISSED, { fullName: 'Second Sample' });
    expect((await edit(second, withLosses(2))).status).toBe(200);
    const two = await plan('drA', second);
    expect(item(two, 'loss_rpl_workup')).toMatchObject({ applies: 'unknown', status: 'check_needed', why: 'loss_count_check' });
    expect(two.plan.missingFacts).toEqual(['Whether this loss is counted in Abortions (A)']);
    // The doctor decides: include it anyway
    const it2 = item(two, 'loss_rpl_workup');
    const included = await (await as('drA')).patch(`/api/patients/${second.id}/care-plan/items/${it2.id}`).send({ action: 'include', rev: it2.rev, reason: 'Third loss – not counted in A yet' });
    expect(included.status, JSON.stringify(included.body)).toBe(200);
    expect(included.body.plan.items.find((i) => i.key === 'loss_rpl_workup').status).toBe('due');
    const first = await lossPatient(MISSED, { fullName: 'First Sample' });
    expect((await edit(first, withLosses(1))).status).toBe(200);
    expect(item(await plan('drA', first), 'loss_rpl_workup')).toMatchObject({ applies: 'no', why: 'only_loss_recurrent' });
    const workup = await lossPatient({ lossType: 'recurrent', presentedOn: '2026-10-05', management: { method: 'workup' } }, { fullName: 'Workup Sample' });
    const w = await plan('drA', workup);
    expect(item(w, 'loss_rpl_workup').applies).toBe('yes');
    expect(item(w, 'loss_antid').applies).toBe('no'); // not pregnant now
    // Not pregnant now: no "after the loss" check-up, haemoglobin or contraception item – the next-pregnancy advice stays
    expect(w.plan.items.filter((i) => i.applies === 'yes').map((i) => i.key)).toEqual(['loss_adv_next', 'loss_rpl_workup']);
    for (const key of ['loss_followup', 'loss_hb', 'loss_adv_contraception']) expect(item(w, key)).toMatchObject({ applies: 'no', status: 'not_applicable', why: 'only_loss_now' });
  });

  it('a corrected date seen moves the dates; another loss months later closes the plan by itself and starts a new one', async () => {
    const p = await lossPatient();
    const first = (await plan('drA', p)).plan;
    const hb = first.items.find((i) => i.key === 'loss_hb');
    expect((await (await as('drA')).patch(`/api/patients/${p.id}/care-plan/items/${hb.id}`).send({ action: 'done', rev: hb.rev, on: '2026-10-05' })).status).toBe(200);
    // Seen two days earlier (a correction): the same plan, counted from the new day
    expect((await edit(p, { abortion: { ...MISSED, presentedOn: '2026-10-03' } })).status).toBe(200);
    let view = await plan('drA', p);
    expect(view.plan.id).toBe(first.id);
    expect(day(view.plan.startOn)).toBe('2026-10-03');
    expect(day(item(view, 'loss_followup').window.from)).toBe('2026-10-10');
    expect(item(view, 'loss_hb').status).toBe('done');

    // Four months later she loses another pregnancy, recorded on the same record
    at('2027-02-10T06:00:00Z');
    const again = await edit(p, { abortion: { lossType: 'incomplete', lmp: '2026-12-07', presentedOn: '2027-02-08', management: { method: 'surgical_evacuation', on: '2027-02-08', outcome: 'complete' } } });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    view = await plan('drA', p);
    expect(view.plan.id).not.toBe(first.id);
    expect(view.plan).toMatchObject({ careType: 'abortion', status: 'active', replacesPlanId: first.id });
    expect(day(view.plan.startOn)).toBe('2027-02-08');
    expect(item(view, 'loss_hb').status).toBe('due'); // nothing ticked for the earlier loss counts for this one
    expect(view.earlierPlans.map((e) => [e.id, e.careType, e.status, e.closedReason])).toEqual([[first.id, 'abortion', 'closed', 'new_pregnancy']]);
    const old = (await (await as('drA')).get(`/api/patients/${p.id}/care-plan?planId=${first.id}`)).body.plan;
    expect(old.closed).toMatchObject({ auto: true, reason: 'new_pregnancy', byName: 'Automatic' });
    expect(old.items.find((i) => i.key === 'loss_hb').done).toBeTruthy(); // kept on the earlier plan
    expect(old.log[0].text).toBe(
      'Closed automatically: another pregnancy loss was recorded (seen on 8 Feb 2027), and a new care plan was started for it. If the date seen was only corrected, close the new plan and reopen this one.',
    );
    expect(await CarePlan.countDocuments({ tenantId: hospital._id, patientId: p.id, current: true })).toBe(1);
  });

  it('a plan a doctor closed stays closed for this loss; a new pregnancy pauses the plan and keeps it in view', async () => {
    const p = await lossPatient();
    const first = (await plan('drA', p)).plan;
    expect((await (await as('drA')).post(`/api/patients/${p.id}/care-plan/close`).send({ reason: 'care_elsewhere' })).status).toBe(200);
    expect(await plan('drA', p)).toMatchObject({ plan: null, reason: null });
    expect((await record('nurse', p)).carePlanSummary).toMatchObject({ exists: false, earlierCount: 1, lastClosed: { reason: 'care_elsewhere' } });
    const reopened = await (await as('drA')).post(`/api/patients/${p.id}/care-plan/reopen`).send({ planId: first.id });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(reopened.body.plan).toMatchObject({ id: first.id, status: 'active' });

    // She is pregnant again two months later: her record becomes antenatal; the pregnancy-loss plan is paused, not lost
    at('2026-12-07T06:00:00Z');
    const pregnant = await edit(p, { careType: 'antenatal', pregnancy: { lmp: '2026-11-02' } });
    expect(pregnant.status, JSON.stringify(pregnant.body)).toBe(200);
    const view = await plan('drA', p);
    expect(view.plan.careType).toBe('antenatal');
    expect(view.earlierPlans.map((e) => [e.id, e.careType, e.status])).toEqual([[first.id, 'abortion', 'paused']]);
    const stored = await CarePlan.findOne({ tenantId: hospital._id, _id: first.id }).lean();
    expect(stored).toMatchObject({ current: true, status: 'paused', pausedReason: 'care_type_changed' });
  });

  it('a reviewed beta hCG result ticks one weekly test of the series – the earliest due; the day 2, 4 and 7 tests only the doctor ticks', async () => {
    const p = await lossPatient({ lossType: 'ectopic', lmp: '2026-08-24', presentedOn: '2026-10-05', ectopicSite: 'tube', management: { method: 'expectant' } });
    let view = await plan('drA', p);
    expect(['loss_ect_hcg_d2', 'loss_ect_hcg_d4'].map((k) => item(view, k).status)).toEqual(['due', 'due']); // both fall in the first week
    // The first hCG, taken on the day she is seen, is not the day-2 test: nothing is ticked, the tests stay due
    const first = await reviewedResult(p, 'bhcg', [{ key: 'bhcg', value: '1500' }]);
    expect(first.planChanged).toBe(false);
    view = await plan('drA', p);
    expect(['loss_ect_hcg_d2', 'loss_ect_hcg_d4'].map((k) => item(view, k).status)).toEqual(['due', 'due']);
    // Day 2: the doctor ticks the day-2 test with the result
    at('2026-10-07T06:00:00Z');
    expect((await reviewedResult(p, 'bhcg', [{ key: 'bhcg', value: '1200' }])).planChanged).toBe(false);
    const d2 = item(await plan('drA', p), 'loss_ect_hcg_d2');
    const ticked = await (await as('drA')).patch(`/api/patients/${p.id}/care-plan/items/${d2.id}`).send({ action: 'done', rev: d2.rev, on: '2026-10-07', result: 'Beta hCG 1200 mIU/mL' });
    expect(ticked.status, JSON.stringify(ticked.body)).toBe(200);
    expect(ticked.body.plan.items.find((i) => i.key === 'loss_ect_hcg_d2')).toMatchObject({ status: 'done', done: { via: 'manual', result: 'Beta hCG 1200 mIU/mL' } });

    // Week 2 (from 19 Oct): a reviewed result ticks the week-2 test – one test of the row, never two
    at('2026-10-20T06:00:00Z');
    const weekTwo = await reviewedResult(p, 'bhcg', [{ key: 'bhcg', value: '300' }]);
    expect(weekTwo.planChanged).toBe(true);
    view = await plan('drA', p);
    expect(item(view, 'loss_ect_hcg_w2')).toMatchObject({ status: 'done', done: { via: 'lab', result: 'Beta hCG 300 mIU/mL' } });
    expect(item(view, 'loss_ect_hcg_w3').status).toBe('upcoming');
    expect(['loss_ect_hcg_d4', 'loss_ect_hcg_d7'].map((k) => item(view, k).done ?? null)).toEqual([null, null]); // never ticked by the lab
    // Nothing more due this week: another result ticks nothing
    expect((await reviewedResult(p, 'bhcg', [{ key: 'bhcg', value: '250' }])).planChanged).toBe(false);
  });

  it('after a molar pregnancy a reviewed beta hCG ticks the 2-weekly test that is due; a haemoglobin result the haemoglobin item', async () => {
    const p = await lossPatient({ lossType: 'molar', lmp: '2026-07-27', presentedOn: '2026-10-05', moleKind: 'awaiting', management: { method: 'suction_evacuation', on: '2026-10-05', outcome: 'in_progress' } });
    // The hCG before the evacuation ticks nothing (the first test of the row is at 2 weeks)
    expect((await reviewedResult(p, 'bhcg', [{ key: 'bhcg', value: '85000' }])).planChanged).toBe(false);
    expect((await reviewedResult(p, 'hb', [{ key: 'hb', value: '10.8' }], 'Sample comment: iron started')).planChanged).toBe(true);
    expect(item(await plan('drA', p), 'loss_hb')).toMatchObject({ status: 'done', done: { via: 'lab' } });
    at('2026-10-20T06:00:00Z');
    expect((await reviewedResult(p, 'bhcg', [{ key: 'bhcg', value: '900' }])).planChanged).toBe(true);
    const view = await plan('drA', p);
    expect(item(view, 'loss_molar_hcg_2w')).toMatchObject({ status: 'done', done: { via: 'lab', result: 'Beta hCG 900 mIU/mL' } });
    expect(item(view, 'loss_molar_hcg_4w').status).toBe('upcoming');
  });
});

describe('red flags in pregnancy-loss care (through the app)', () => {
  const ECTOPIC = { lossType: 'ectopic', lmp: '2026-08-24', presentedOn: '2026-10-05', ectopicSite: 'tube', management: { method: 'expectant' } };
  const flagKeys = async (who, p) => (await record(who, p)).redFlags?.flags.map((f) => f.key);

  it('every hospital gets the draft rules; an untouched draft is upgraded by itself, rules a doctor approved are only offered them', async () => {
    const got = (await (await as('drA')).get('/api/red-flag-rules')).body.ruleSet;
    expect(got).toMatchObject({ status: 'draft', version: 1, builtInVersion: 3, newBuiltIn: 0, newBuiltInCareTypes: [] });
    expect(got.rules.filter((r) => r.appliesTo.includes('abortion')).map((r) => r.key)).toEqual(LOSS_RULES.map((r) => r.key));
    // A hospital whose rules are still the untouched draft of the version before
    const before = BUILT_IN_RED_FLAG_RULES.filter((r) => (BUILT_IN_SINCE[r.key] ?? 1) < 3);
    await RedFlagRuleSet.collection.updateOne({ tenantId: hospital._id }, { $set: { rules: before, builtInVersion: 2, builtInSeenVersion: 2, status: 'draft', version: 1 } });
    const upgraded = (await (await as('nurse')).get('/api/red-flag-rules')).body.ruleSet;
    expect(upgraded).toMatchObject({ status: 'draft', version: 2, builtInVersion: 3, updatedByName: 'Built-in draft' });
    expect(upgraded.rules).toHaveLength(BUILT_IN_RED_FLAG_RULES.length);
    // Rules a doctor approved are never changed by themselves: the new rules are offered, naming the type of care
    await RedFlagRuleSet.collection.updateOne({ tenantId: hospital._id }, { $set: { rules: before, builtInVersion: 2, builtInSeenVersion: 2, status: 'approved', approvedByName: 'Sample drB', approvedAt: NOW, version: 5 } });
    const approved = (await (await as('drA')).get('/api/red-flag-rules')).body.ruleSet;
    expect(approved).toMatchObject({ status: 'approved', version: 5, newBuiltIn: LOSS_RULES.length, newBuiltInCareTypes: ['abortion'] });
    expect(approved.rules).toHaveLength(before.length);
    expect((await (await as('nurse')).get('/api/red-flag-rules')).body.ruleSet).toMatchObject({ newBuiltIn: 0, newBuiltInCareTypes: [] });
    const p = await lossPatient(ECTOPIC);
    await visitWith(p, { pulse: 124 });
    expect((await record('drA', p)).redFlags).toMatchObject({ flags: [], checked: false }); // no rule for her type of care yet
    const added = await (await as('drA')).post('/api/red-flag-rules/add-built-in').send({ version: 5 });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body).toMatchObject({ added: LOSS_RULES.length, ruleSet: { status: 'draft', version: 6, newBuiltIn: 0 } });
    expect(added.body.ruleSet.builtInAdded).toEqual(LOSS_RULES.map((r) => r.key));
    expect(await flagKeys('drA', p)).toEqual(['loss_ectopic_pulse']);
  });

  it('a doctor can change a pregnancy-loss rule: a check of her record is saved with its answers, and is refused for another type of care', async () => {
    const set = (await (await as('drA')).get('/api/red-flag-rules')).body.ruleSet;
    const strip = ({ key, label, level, message, appliesTo, conditions, fromWeek, toWeek, fromDay, toDay, source }) => ({ key, label, level, message, appliesTo, conditions, fromWeek, toWeek, fromDay, toDay, source });
    const rules = set.rules.map(strip).map((r) => (r.key === 'loss_bleeding_heavy' ? { ...r, conditions: [{ factor: 'lossBleeding', choices: ['moderate', 'heavy'] }] } : r));
    const saved = await (await as('drA')).put('/api/red-flag-rules').send({ version: set.version, rules });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.ruleSet.rules.find((r) => r.key === 'loss_bleeding_heavy').conditions).toEqual([{ factor: 'lossBleeding', op: null, value: null, grade: null, choices: ['moderate', 'heavy'] }]);
    const wrong = rules.map((r) => (r.key === 'loss_rupture_signs' ? { ...r, appliesTo: ['antenatal', 'abortion'] } : r));
    const refused = await (await as('drA')).put('/api/red-flag-rules').send({ version: saved.body.ruleSet.version, rules: wrong });
    expect(refused.status).toBe(400);
    expect(Object.values(fieldsOf(refused)).join()).toContain('Signs of rupture is not checked for antenatal patients');
    const p = await lossPatient({ ...MISSED, findings: { bleeding: 'moderate' } });
    expect(await flagKeys('drA', p)).toEqual(['loss_bleeding_heavy']);
  });

  it('possible ruptured ectopic: from the pulse of her visit, and from the tick on her record – on her record, the visit page, the Patients list and Today', async () => {
    const p = await lossPatient(ECTOPIC);
    expect((await record('drA', p)).redFlags).toMatchObject({ flags: [], checked: true, careType: 'abortion', rules: { status: 'draft' } });
    const page = await visitWith(p, { pulse: 124, bpSystolic: 100, bpDiastolic: 60 });
    expect(page.redFlags.flags.map((f) => [f.key, f.detail])).toEqual([['loss_ectopic_pulse', 'Pregnancy location ectopic, Pulse 124 /min']]);
    expect(page.redFlags.flags[0].sources).toEqual([{ source: 'visit', on: '2026-10-05T00:00:00.000Z', visitId: page.visit.id }]);
    expect(await flagKeys('nurse', p)).toEqual(['loss_ectopic_pulse']);

    // Signs of rupture ticked from the visit page: a flag of her record (not a value of the visit)
    expect((await putFindings('drA', p, { findings: { ruptureSigns: 'yes' }, visitId: page.visit.id })).status).toBe(200);
    const seen = (await record('nurse', p)).redFlags;
    expect(seen.flags.map((f) => f.key)).toEqual(['loss_ectopic_pulse', 'loss_rupture_signs']);
    expect(seen.flags[1]).toMatchObject({ label: 'Possible ruptured ectopic pregnancy', level: 'urgent', detail: 'Signs of rupture yes', sources: [{ source: 'record', on: '2026-10-05T00:00:00.000Z' }] });
    expect(seen.flags[1].message).toMatch(/Signs of rupture are recorded on her record\. Consider a ruptured ectopic pregnancy/);
    const visitNow = (await (await as('drA')).get(`/api/patients/${p.id}/visits/${page.visit.id}`)).body;
    expect(visitNow.redFlags.flags.map((f) => f.key)).toEqual(['loss_ectopic_pulse']);
    expect(website.flagsElsewhere(seen.flags, visitNow.redFlags.flags).map((f) => f.key)).toEqual(['loss_rupture_signs']);

    // Reception and the lab get no flags
    expect((await record('reception', p)).redFlags).toBeUndefined();
    expect((await record('lab', p)).redFlags).toBeUndefined();
    // The Patients list and Today's worklist
    const row = (await (await as('drA')).get('/api/patients')).body.patients.find((x) => x.id === p.id);
    expect(row.redFlags).toEqual({ count: 2, urgent: 2 });
    expect((await (await as('reception')).get('/api/patients')).body.patients.find((x) => x.id === p.id).redFlags).toBeUndefined();
    const work = (await (await as('drA')).get('/api/worklist')).body;
    expect(work.rules.careTypes).toEqual(['antenatal', 'postnatal', 'newborn', 'abortion']);
    expect(work.redFlags.map((r) => [r.patient.fullName, r.flags.map((f) => f.key)])).toEqual([['Loss Sample', ['loss_ectopic_pulse', 'loss_rupture_signs']]]);

    // Unticked ("No"): the flag of the record goes; the visit's stays until the next visit
    expect((await putFindings('rmo', p, { findings: { ruptureSigns: 'no' } })).status).toBe(200);
    expect(await flagKeys('drA', p)).toEqual(['loss_ectopic_pulse']);
    at('2026-10-06T06:00:00Z');
    await visitWith(p, { pulse: 84, bpSystolic: 110, bpDiastolic: 70 }, 'rmo');
    expect(await flagKeys('drA', p)).toEqual([]);
  });

  it('a tick alone – no visit yet – is on her record and on Today; three months later it no longer raises a flag', async () => {
    const p = await lossPatient({ ...MISSED, lossType: 'complete', management: { method: 'none_needed' }, findings: { bleeding: 'heavy', feverDischarge: 'yes', sacSeen: 'no', ruptureSigns: 'yes' } });
    expect(await flagKeys('drA', p)).toEqual(['loss_rupture_signs', 'loss_sepsis_signs', 'loss_bleeding_heavy']);
    const work = (await (await as('nurse')).get('/api/worklist')).body;
    expect(work.redFlags.map((r) => [r.patient.fullName, r.flags.map((f) => f.key)])).toEqual([['Loss Sample', ['loss_rupture_signs', 'loss_sepsis_signs', 'loss_bleeding_heavy']]]);
    // A complete miscarriage never seen in the uterus with a low BP at a visit: possible ruptured ectopic (not ruled out)
    const page = await visitWith(p, { pulse: 96, bpSystolic: 84, bpDiastolic: 50 });
    expect(page.redFlags.flags.map((f) => [f.key, f.detail])).toEqual([['loss_ectopic_bp', 'Pregnancy location unknown, BP 84/50 mmHg']]);
    // An incomplete miscarriage whose sac has passed (tissue still in the uterus) is NOT a pregnancy of unknown
    // location: no "signs of rupture" field, and a fast pulse from bleeding raises no ectopic flag
    const incomplete = await lossPatient({ ...MISSED, lossType: 'incomplete', management: { method: 'expectant' }, findings: { sacSeen: 'no', productsSeen: 'yes', ruptureSigns: 'yes' } }, { fullName: 'Incomplete Sample' });
    expect(current(incomplete)).toEqual({ sacSeen: 'no', productsSeen: 'yes' });
    expect((await visitWith(incomplete, { pulse: 122, bpSystolic: 86, bpDiastolic: 50 })).redFlags.flags).toEqual([]);
    // Sepsis from the vital signs of a visit
    const septic = await lossPatient({ ...MISSED, lossType: 'septic', management: { method: 'antibiotics_evacuation' } }, { fullName: 'Septic Sample' });
    const fever = await visitWith(septic, { temperatureF: 101.4, pulse: 118, bpSystolic: 104, bpDiastolic: 64 });
    expect(fever.redFlags.flags.map((f) => [f.key, f.label])).toEqual([['loss_sepsis_vitals', 'Possible septic abortion']]);

    at('2027-01-15T06:00:00Z'); // more than three months later
    expect(await flagKeys('drA', p)).toEqual([]);
    expect(current(await record('drA', p)).bleeding).toBe('heavy'); // the finding itself stays on her record
  });

  it('severe anaemia from a lab result; no flag from a record of another hospital', async () => {
    const p = await lossPatient();
    const ordered = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'hb' }] });
    const collected = (await (await as('lab')).post(lab(`${ordered.body.order.id}/collect`)).send({ rev: ordered.body.order.rev })).body.order;
    const reported = await (await as('lab')).put(lab(`${collected.id}/results`)).send({ rev: collected.rev, tests: [{ key: 'hb', values: [{ key: 'hb', value: '6.4' }] }], report: true });
    expect(reported.status, JSON.stringify(reported.body)).toBe(200);
    const flags = (await record('drA', p)).redFlags.flags;
    expect(flags.map((f) => [f.key, f.label, f.detail])).toEqual([['loss_lab_hb_severe', 'Severe anaemia after pregnancy loss', 'Haemoglobin (lab) 6.4 g/dL']]);
    const elsewhere = await createTenant('Other Hospital');
    const outsider = await createUser({ name: 'Sample outsider' });
    await addMember(outsider, elsewhere, 'doctor');
    const o = await loginAs(outsider, { app });
    expect((await o.get(`/api/patients/${p.id}`)).status).toBe(404);
    expect((await o.get('/api/worklist')).body.redFlags).toEqual([]);
  });
});

describe('after review: another loss, a kept rupture tick, treatment, the hCG series and where staff see the plan', () => {
  const ECTOPIC = { lossType: 'ectopic', lmp: '2026-08-24', presentedOn: '2026-10-05', ectopicSite: 'tube', management: { method: 'expectant' } };
  const MOLAR = { lossType: 'molar', lmp: '2026-07-27', presentedOn: '2026-10-05', moleKind: 'awaiting', management: { method: 'suction_evacuation', on: '2026-10-05', outcome: 'in_progress' } };
  const flagKeys = async (who, p) => (await record(who, p)).redFlags?.flags.map((f) => f.key);
  const OLD = { os: 'open', sacSeen: 'no', adnexalMass: 'yes', bleeding: 'heavy', ruptureSigns: 'yes' };

  it('another loss recorded on the same record starts with no findings: those of the earlier loss are ended with who recorded the new one, kept, and raise nothing', async () => {
    at('2026-07-10T06:00:00Z');
    const p = await lossPatient({ ...ECTOPIC, lmp: '2026-05-29', presentedOn: '2026-07-10', findings: OLD });
    expect(current(p)).toEqual(OLD);
    // A correction of the date seen (within 8 weeks) is the same loss: the findings stay
    const corrected = await edit(p, { abortion: { ...ECTOPIC, lmp: '2026-05-29', presentedOn: '2026-07-08' } });
    expect(current(corrected.body.patient)).toEqual(OLD);

    // 87 days later (within the three months the red flags look back): a missed miscarriage on the same record. The
    // form sends the earlier values unchanged (as an older page would) – they are ended all the same
    at('2026-10-05T06:00:00Z');
    const again = await edit(p, { abortion: { ...MISSED, findings: { os: 'open', sacSeen: 'no', adnexalMass: 'yes', bleeding: 'heavy' }, findingsSeen: { os: 'open', sacSeen: 'no', adnexalMass: 'yes', bleeding: 'heavy' } } }, 'rmo');
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(current(again.body.patient)).toEqual({});
    const ended = again.body.patient.abortion.findings;
    expect(ended).toHaveLength(5);
    expect(ended.every((f) => !f.current && f.endedByName === 'Sample rmo' && day(f.endedOn) === '2026-10-05')).toBe(true);
    expect(await flagKeys('drA', p)).toEqual([]);
    // Nor are they told to the AI as findings of this loss
    const text = await patientContext({ tenantId: hospital._id, user: people.drA, now: new Date() }, await Patient.findOne({ tenantId: hospital._id, _id: p.id }));
    expect(text).not.toMatch(/Pregnancy loss findings/);
    // The new loss's own findings are recorded as usual
    const now = await edit(p, { abortion: { ...MISSED, findings: { os: 'closed', crlMm: '8' }, findingsSeen: {} } });
    expect(current(now.body.patient)).toEqual({ os: 'closed', crlMm: 8 });
  });

  it('"signs of rupture: yes" stays (and keeps its flag) when a colleague changes the scan; it goes only when a person clears it', async () => {
    const p = await lossPatient({ ...MISSED, lossType: 'complete', management: { method: 'none_needed' }, findings: { sacSeen: 'no', ruptureSigns: 'yes' } });
    expect(await flagKeys('drA', p)).toEqual(['loss_rupture_signs']);
    const scan = await putFindings('rmo', p, { findings: { sacSeen: 'yes' }, seen: { sacSeen: 'no', ruptureSigns: 'yes' } });
    expect(scan.status, JSON.stringify(scan.body)).toBe(200);
    expect(current(scan.body.patient)).toEqual({ sacSeen: 'yes', ruptureSigns: 'yes' });
    expect(await flagKeys('drA', p)).toEqual(['loss_rupture_signs']);
    const cleared = await putFindings('rmo', p, { findings: { sacSeen: 'yes', ruptureSigns: '' }, seen: { sacSeen: 'yes', ruptureSigns: 'yes' } });
    expect(current(cleared.body.patient)).toEqual({ sacSeen: 'yes' });
    expect(await flagKeys('drA', p)).toEqual([]);
  });

  it('after the operation for an ectopic, a fast pulse and the earlier rupture tick no longer raise "possible ruptured ectopic"; the earlier visit still shows its flag', async () => {
    const p = await lossPatient(ECTOPIC);
    const before = await visitWith(p, { pulse: 124, bpSystolic: 100, bpDiastolic: 60 });
    expect((await putFindings('drA', p, { findings: { ruptureSigns: 'yes' }, visitId: before.visit.id })).status).toBe(200);
    expect(await flagKeys('drA', p)).toEqual(['loss_ectopic_pulse', 'loss_rupture_signs']);
    at('2026-10-06T06:00:00Z');
    expect((await edit(p, { abortion: { ...ECTOPIC, management: { method: 'laparoscopy', on: '2026-10-06', outcome: 'in_progress' } } })).status).toBe(200);
    expect(await flagKeys('drA', p)).toEqual([]);
    at('2026-10-07T06:00:00Z');
    const after = await visitWith(p, { pulse: 116, bpSystolic: 104, bpDiastolic: 64 }, 'rmo');
    expect(after.redFlags.flags).toEqual([]);
    expect(await flagKeys('drA', p)).toEqual([]);
    expect((await (await as('nurse')).get('/api/worklist')).body.redFlags).toEqual([]);
    // The visit before the operation still shows what it showed then
    expect((await (await as('drA')).get(`/api/patients/${p.id}/visits/${before.visit.id}`)).body.redFlags.flags.map((f) => f.key)).toEqual(['loss_ectopic_pulse']);
  });

  it('a beta hCG result ticks the test whose window holds the day of the sample; a re-reviewed order or an extra sample ticks nothing more', async () => {
    const p = await lossPatient(MOLAR);
    // She missed the 2-week test (19–25 Oct) and gives blood on 3 Nov, in the 4-week window (2–8 Nov)
    at('2026-11-03T06:00:00Z');
    const ordered = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'bhcg' }] });
    const collected = (await (await as('lab')).post(lab(`${ordered.body.order.id}/collect`)).send({ rev: ordered.body.order.rev })).body.order;
    const reported = (await (await as('lab')).put(lab(`${collected.id}/results`)).send({ rev: collected.rev, tests: [{ key: 'bhcg', values: [{ key: 'bhcg', value: '400' }] }], report: true })).body.order;
    const reviewed = await (await as('drA')).post(lab(`${reported.id}/review`)).send({ rev: reported.rev });
    expect(reviewed.body.planChanged).toBe(true);
    let view = await plan('drA', p);
    expect(item(view, 'loss_molar_hcg_4w')).toMatchObject({ status: 'done', done: { via: 'lab', result: 'Beta hCG 400 mIU/mL' } });
    expect(day(item(view, 'loss_molar_hcg_4w').done.on)).toBe('2026-11-03');
    expect(item(view, 'loss_molar_hcg_2w').status).toBe('overdue'); // left for the doctor: done elsewhere, or not needed

    // The lab corrects the result; the doctor reviews it again: the same sample never ticks a second test
    at('2026-11-04T06:00:00Z');
    const amended = await (await as('lab')).put(lab(`${reported.id}/results`)).send({ rev: reviewed.body.order.rev, tests: [{ key: 'bhcg', values: [{ key: 'bhcg', value: '410' }] }], reason: 'Typing error corrected' });
    expect(amended.status, JSON.stringify(amended.body)).toBe(200);
    const again = await (await as('drA')).post(lab(`${reported.id}/review`)).send({ rev: amended.body.order.rev });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.planChanged).toBe(false);
    view = await plan('drA', p);
    expect(item(view, 'loss_molar_hcg_2w').status).toBe('overdue');
    expect(item(view, 'loss_molar_hcg_6w').done ?? null).toBeNull();

    // A sample taken on 13 Nov (between the 4- and 6-week tests) and reviewed on 17 Nov, in the 6-week window: an
    // extra test – it ticks neither the 6-week test (not due on the day of the sample) nor the missed 2-week one
    at('2026-11-13T06:00:00Z');
    const extra = await (await as('drA')).post(`/api/patients/${p.id}/lab-orders`).send({ clientRequestId: randomUUID(), tests: [{ key: 'bhcg' }] });
    const taken = (await (await as('lab')).post(lab(`${extra.body.order.id}/collect`)).send({ rev: extra.body.order.rev })).body.order;
    at('2026-11-17T06:00:00Z');
    const late = (await (await as('lab')).put(lab(`${taken.id}/results`)).send({ rev: taken.rev, tests: [{ key: 'bhcg', values: [{ key: 'bhcg', value: '120' }] }], report: true })).body.order;
    expect((await (await as('drA')).post(lab(`${late.id}/review`)).send({ rev: late.rev })).body.planChanged).toBe(false);
    view = await plan('drA', p);
    expect([item(view, 'loss_molar_hcg_2w').status, item(view, 'loss_molar_hcg_6w').status]).toEqual(['overdue', 'due']);
  });

  it('which test a sample stands for (the rule on its own)', () => {
    const d = (iso) => new Date(`${iso}T00:00:00Z`);
    const test = (key, from, by, state = 'open') => ({ key, state, auto: { dueFrom: d(from), dueBy: d(by) } });
    const w2 = test('2w', '2026-10-19', '2026-10-25');
    const w4 = test('4w', '2026-11-02', '2026-11-08');
    const w6 = test('6w', '2026-11-16', '2026-11-22');
    const status = (map) => (it) => map[it.key];
    const today = status({ '2w': 'overdue', '4w': 'due', '6w': 'upcoming' });
    expect(seriesItem([w2, w4, w6], d('2026-11-03'), today)).toBe(w4); // in its window
    expect(seriesItem([w2, w4, w6], d('2026-10-28'), status({ '2w': 'overdue', '4w': 'upcoming', '6w': 'upcoming' }))).toBe(w2); // late for the 2-week test
    expect(seriesItem([w2, w4, w6], d('2026-10-10'), today)).toBeNull(); // before any window
    const done4 = { ...w4, state: 'done' };
    expect(seriesItem([w2, done4, w6], d('2026-11-05'), status({ '2w': 'overdue', '4w': 'done', '6w': 'upcoming' }))).toBeNull(); // a second sample in a done window
    expect(seriesItem([w2, done4, w6], d('2026-11-12'), status({ '2w': 'overdue', '4w': 'done', '6w': 'upcoming' }))).toBeNull(); // between a done test and the next
    // A test of the row that does not apply (another type of loss) takes no part: it neither takes the sample nor stands
    // in the way of the test she came late for
    expect(seriesItem([w2, { ...w4, key: 'x' }], d('2026-11-03'), status({ '2w': 'overdue', x: 'not_applicable' }))).toBe(w2);
    expect(seriesItem([{ ...w4, key: 'x' }], d('2026-11-03'), status({ x: 'not_applicable' }))).toBeNull();
  });

  it('Today lists a pregnancy-loss plan with an overdue test; staff can prepare a reminder whose words never name the loss', async () => {
    const p = await lossPatient(MOLAR, { fullName: 'Asha Sample' });
    at('2026-10-27T06:00:00Z'); // the 2-week hCG (19–25 Oct) is overdue
    const work = (await (await as('nurse')).get('/api/worklist')).body;
    const row = work.carePlan.find((r) => r.patient.id === p.id);
    expect(row).toMatchObject({ patient: { careType: 'abortion', fullName: 'Asha Sample' } });
    expect(row.counts.overdue).toBeGreaterThan(0);
    expect((await (await as('reception')).get('/api/worklist')).status).toBe(403);
    const entry = await AuditLog.findOne({ action: 'WORKLIST_VIEWED' }).sort({ _id: -1 }).lean();
    expect(JSON.stringify(entry.details)).not.toMatch(/Asha Sample|molar/i);
    // The reminder: the items in her words
    const reminder = await (await as('nurse')).get(`/api/patients/${p.id}/reminder`);
    expect(reminder.status, JSON.stringify(reminder.body)).toBe(200);
    expect(reminder.body.plan.overdue.map((i) => i.patientText)).toContain('Blood test (beta hCG)');
    const { reminderMessage } = await import('../../client/src/pages/reminders/reminderText.js');
    const message = reminderMessage(reminder.body);
    expect(message).toContain('Blood test (beta hCG)');
    expect(message.replaceAll('Pregnancy Loss Care Hospital', 'the hospital')).not.toMatch(/molar|miscarriage|abortion|ectopic|\bloss\b|pregnan/i); // (the test hospital's own name aside)
    // A plan whose items were all due long ago is for the doctor to close, not a daily list
    at('2027-06-01T06:00:00Z');
    expect((await (await as('nurse')).get('/api/worklist')).body.carePlan.find((r) => r.patient.id === p.id)).toBeUndefined();
  });

  it('an item a doctor adds without words for the patient: the portal and her printed copy say "Check-up or test – your doctor will explain", never its staff name', async () => {
    const p = await lossPatient();
    const added = await (await as('drA')).post(`/api/patients/${p.id}/care-plan/items`).send({
      clientRequestId: randomUUID(), kind: 'investigation', name: 'Repeat scan for retained products after miscarriage', reason: 'Sample reason for the item', timing: { type: 'weeks', fromWeek: 1, toWeek: 2 },
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const portal = await portalPlanItems(hospital._id, await Patient.findOne({ tenantId: hospital._id, _id: p.id }), NOW);
    expect(portal.items.map((i) => i.text)).toContain(PATIENT_FALLBACK_LOSS);
    expect(JSON.stringify(portal)).not.toMatch(/miscarriage|retained/i);
    const it = added.body.plan.items.find((i) => i.name.startsWith('Repeat scan'));
    expect(patientWhat(it, 'abortion')).toBe(PATIENT_FALLBACK_LOSS);
    expect(WEBSITE_FALLBACK_LOSS).toBe(PATIENT_FALLBACK_LOSS);
    expect(patientWhat(it, 'gynaecology')).toBe('Repeat scan for retained products after miscarriage'); // other care: as before
  });

  it('the anti-D item is answered on her record: "Mark done" on the plan is refused with where to record it, and the visit page does not list it', async () => {
    const p = await lossPatient(MOLAR, { medical: { allergies: 'None known', bloodGroup: 'O-' } });
    const antiD = item(await plan('drA', p), 'loss_antid');
    expect(antiD.status).toBe('due');
    const refused = await (await as('drA')).patch(`/api/patients/${p.id}/care-plan/items/${antiD.id}`).send({ action: 'done', rev: antiD.rev, on: '2026-10-05' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatchObject({ code: 'RECORDED_ON_RECORD' });
    expect(refused.body.error.message).toMatch(/Edit details → Pregnancy loss → Anti-D/);
    const page = await visitWith(p, { pulse: 80 });
    expect(page.carePlan.dueNow.map((i) => i.name).join(' ')).not.toMatch(/Anti-D/);
    // Recorded on her record: the item stops applying – one answer, in one place
    expect((await edit(p, { abortion: { ...MOLAR, antiD: { status: 'given', on: '2026-10-05' } } })).status).toBe(200);
    expect(item(await plan('drA', p), 'loss_antid').status).toBe('not_applicable');
  });

  it('from a visit page findings are not saved on a signed visit, nor on a record marked as a duplicate (from the record itself, as Edit details, they are)', async () => {
    const p = await lossPatient(ECTOPIC);
    const signedVisit = await visitWith(p, { pulse: 84 });
    await Visit.updateOne({ _id: signedVisit.visit.id, tenantId: hospital._id }, { $set: { signed: { by: people.drA._id, byName: 'Sample drA', role: 'doctor', at: NOW, revs: { vitals: 1, details: 0, prescription: 0 } } } });
    const signed = await putFindings('drA', p, { findings: { bleeding: 'light' }, visitId: signedVisit.visit.id });
    expect(signed.status).toBe(409);
    expect(signed.body.error.code).toBe('VISIT_SIGNED');
    // Marked as a duplicate (its visit is signed, so it may be): nothing new from any of its visits
    const main = await lossPatient(ECTOPIC, { fullName: 'Main Sample' });
    const marked = await (await as('drA')).put(`/api/patients/${p.id}/duplicate-of`).send({ mainId: main.id, reason: 'Registered twice at the desk by mistake' });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    const dup = await putFindings('drA', p, { findings: { bleeding: 'light' }, visitId: signedVisit.visit.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_RECORD');
    expect(current(await record('drA', p)).bleeding).toBeUndefined();
    expect((await putFindings('drA', p, { findings: { bleeding: 'light' } })).status).toBe(200);
  });

  it('a record only for the recurrent-loss work-up: no pregnancy-loss red flag (a fever is not a septic abortion), and the record says why it is not checked', async () => {
    const p = await lossPatient({ lossType: 'recurrent', presentedOn: '2026-10-05', management: { method: 'workup' } });
    const page = await visitWith(p, { temperatureF: 101.2, pulse: 118, hb: 6.6 });
    expect(page.redFlags.flags).toEqual([]);
    expect((await record('drA', p)).redFlags).toMatchObject({ flags: [], checked: false, workupOnly: true, careType: 'abortion' });
    expect((await (await as('nurse')).get('/api/worklist')).body.redFlags).toEqual([]);
    // Another pregnancy-loss record is checked as before
    const missed = await lossPatient(MISSED, { fullName: 'Missed Sample' });
    expect((await record('drA', missed)).redFlags).toMatchObject({ checked: true, workupOnly: false });
  });

  it('a date seen mistyped by months: the plan of the loss is closed and a new one started; a doctor can close the new one and reopen the first, which then counts from the date on the record', async () => {
    const p = await lossPatient();
    const first = (await plan('drA', p)).plan;
    const hb = first.items.find((i) => i.key === 'loss_hb');
    expect((await (await as('drA')).patch(`/api/patients/${p.id}/care-plan/items/${hb.id}`).send({ action: 'done', rev: hb.rev, on: '2026-10-05' })).status).toBe(200);
    expect((await edit(p, { abortion: { ...MISSED, lmp: '2026-05-29', presentedOn: '2026-07-10' } })).status).toBe(200);
    const second = (await plan('drA', p)).plan;
    expect(second.id).not.toBe(first.id);
    expect((await (await as('drA')).post(`/api/patients/${p.id}/care-plan/close`).send({ reason: 'care_elsewhere' })).status).toBe(200);
    const reopened = await (await as('drA')).post(`/api/patients/${p.id}/care-plan/reopen`).send({ planId: first.id });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    const view = await plan('drA', p);
    expect(view.plan).toMatchObject({ id: first.id, status: 'active' });
    expect(day(view.plan.startOn)).toBe('2026-07-10');
    expect(item(view, 'loss_hb').status).toBe('done'); // what was done for this loss is kept
    expect(view.plan.log.map((l) => l.text).join(' ')).toContain('It now counts from the date seen on the record, 10 Jul 2026 (was 5 Oct 2026).');
    expect((await plan('drA', p)).plan.id).toBe(first.id); // not closed again by the next read
  });

  it('the plan of an earlier loss is closed as it was: its molar hCG tests are not re-marked "only after a molar pregnancy"', async () => {
    const p = await lossPatient(MOLAR);
    const first = (await plan('drA', p)).plan;
    at('2027-02-10T06:00:00Z');
    const again = await edit(p, { abortion: { ...MISSED, lmp: '2026-12-07', presentedOn: '2027-02-08', management: { method: 'medical', on: '2027-02-08', outcome: 'in_progress' } } });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const old = (await (await as('drA')).get(`/api/patients/${p.id}/care-plan?planId=${first.id}`)).body.plan;
    expect(old.status).toBe('closed');
    for (const it of old.items.filter((i) => i.key.startsWith('loss_molar_hcg_'))) expect([it.key, it.applies, it.why]).toEqual([it.key, 'yes', null]);
  });
});

describe('Analytics and the monthly report keep working', () => {
  it('a pregnancy-loss record with findings, a care plan and items done is counted as before', async () => {
    const p = await lossPatient({ lossType: 'incomplete', lmp: '2026-08-02', presentedOn: '2026-10-05', management: { method: 'surgical_evacuation', on: '2026-10-05', outcome: 'complete' }, findings: { os: 'open', bleeding: 'heavy', productsSeen: 'yes' } });
    const view = await plan('drA', p);
    const hb = item(view, 'loss_hb');
    expect((await (await as('drA')).patch(`/api/patients/${p.id}/care-plan/items/${hb.id}`).send({ action: 'done', rev: hb.rev, on: '2026-10-05' })).status).toBe(200);
    await visitWith(p, { pulse: 96, bpSystolic: 104, bpDiastolic: 66 });

    const report = await (await as('drA')).get('/api/analytics/report/monthly?month=2026-10');
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    const value = (key) => report.body.sections.flatMap((s) => s.rows).find((r) => r.key === key)?.value;
    expect([value('loss_total'), value('loss_miscarriage'), value('loss_surgical'), value('loss_to_tidy'), value('registered_abortion')]).toEqual([1, 1, 1, 0, 1]);
    expect(value('scans_done')).toBe(0); // items of a pregnancy-loss plan are not pregnancy scans
    expect(JSON.stringify(report.body)).not.toMatch(/MTP|terminat|induced/i);

    const overview = await (await as('drA')).get('/api/analytics/sections/overview');
    expect(overview.status, JSON.stringify(overview.body)).toBe(200);
    expect(overview.body.cards.map((c) => c.id)).toEqual(expect.arrayContaining(['A1', 'A4', 'V1']));
    // The care-plan cards of Analytics are about antenatal plans: a pregnancy-loss plan changes nothing there
    const care = await (await as('drA')).get('/api/analytics/sections/care');
    expect(care.status, JSON.stringify(care.body)).toBe(200);
  });
});
