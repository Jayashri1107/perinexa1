// Analytics (Feature 11) with the shared fake hospitals (tests/analyticsFixture.js). Fake data only.
// T = 15 Oct 2026 (the clock is frozen at 10:00 in India). One `describe` per concern; later steps add theirs.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildContext, computeSections } from '../src/analytics/compute.js';
import { NEEDS, loadHospital } from '../src/analytics/load.js';
import { currentPlansNow } from '../src/analytics/populations.js';
import { parsePeriod } from '../src/analytics/period.js';
import { countOf } from '../src/analytics/publicCards.js';
import { cellByCode, cellsOf, metricById, relations } from '../src/analytics/registry.js';
import { visibleSet } from '../src/analytics/visibility.js';
import { patientOfUnit } from '../src/analytics/facts.js';
import { NO_ACCESS_MESSAGE, PLATFORM_MIN_DENOMINATOR } from '../src/analytics/roles.js';
import { ADMIN_PERIOD_KEYS, MASKING_NOTE, adminGraphFor, resetAdminViewCache } from '../src/analytics/adminView.js';
import { rangeCheck } from '../src/analytics/mask.js';
import { MIN_DENOMINATOR_CARDS, platformSection } from '../src/analytics/platformTotals.js';
import { resetAnalyticsAuditThrottle } from '../src/analytics/auditThrottle.js';
import { platformCacheKey, resetSectionCache } from '../src/analytics/sectionCache.js';
import { createApp } from '../src/app.js';
import { FEW_BIRTHS_NOTE, RATIO_NOTE_BELOW } from '../src/analytics/metrics/sexAtBirth.js';
import { readerPins } from './maskReader.js';
import { hashCode } from '../src/analytics/metrics/util.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { LIST_ROW_KEYS } from '../src/analytics/listService.js';
import { addDays, hospitalToday, isoDay, toHospitalDate } from '../src/careplans/dates.js';
import { planStatuses } from '../src/careplans/planEngine.js';
import { refreshDueRisks } from '../src/careplans/templatesService.js';
import { previewSync, syncPlan } from '../src/careplans/plansService.js';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, AuditLog } from '../src/models/AuditLog.js';
import { CarePlan } from '../src/models/CarePlan.js';
import { ClinicalDocument } from '../src/models/ClinicalDocument.js';
import { monthlyReport } from '../src/reports/monthlyReport.js';
import { CARE_TYPES, CONDITIONS, Patient } from '../src/models/Patient.js';
import { Tenant } from '../src/models/Tenant.js';
import { Visit } from '../src/models/Visit.js';
import { User } from '../src/models/User.js';
import { patientAccess } from '../src/utils/patientAccess.js';
import { mentionsFetalSex } from '../src/utils/pcpndt.js';
import { FIXTURE_EXPECTED, NOW, TODAY, at, buildFixture, day } from './analyticsFixture.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs } from './helpers.js';

// refreshDueRisks is wrapped so a test can see when it runs; by default it is the real one.
vi.mock('../src/careplans/templatesService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, refreshDueRisks: vi.fn(actual.refreshDueRisks) };
});

let fx;

beforeAll(async () => {
  await connectTestDb();
  fx = await buildFixture();
}, 120_000);
afterAll(async () => {
  vi.useRealTimers();
  await disconnectTestDb();
});

// ---------- Helpers ----------

async function section(who, name, query = {}) {
  const qs = new URLSearchParams(query).toString();
  return (await fx.as(who)).get(`/api/analytics/sections/${name}${qs ? `?${qs}` : ''}`);
}
async function payload(who, name, query = {}) {
  const res = await section(who, name, query);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
const card = (p, id) => {
  const c = p.cards.find((x) => x.id === id);
  if (!c) throw new Error(`No card ${id}`);
  return c;
};
/** { key: value } of a card's cells (and its total under 'total' or its own key). */
function values(c) {
  const out = Object.fromEntries(c.cells.map((x) => [x.key, x.value]));
  if (c.total) out[c.total.key] = c.total.value;
  return out;
}
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
// The row whitelist of the build contract (§3.6), written out here on purpose (not the code's own list).
const SPEC_LIST_ROW_KEYS = ['id', 'mrn', 'fullName', 'careType', 'currentAge', 'assignedDoctorName', 'sensitive', 'gestationalAge', 'edd', 'riskLevel', 'bornOn', 'access', 'detail'];
const nonZero = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== 0));

async function list(who, query) {
  return (await fx.as(who)).get(`/api/analytics/list?${new URLSearchParams(query).toString()}`);
}
async function listBody(who, query) {
  const res = await list(who, query);
  expect(res.status, `${JSON.stringify(query)}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body;
}
/** Every key anywhere in a JSON value. */
function keysDeep(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

// A request-like object for the service functions (what patientAccess reads).
const reqFor = (user, roles) => ({ user, membership: { roles } });

const ALL_SECTIONS = ['overview', 'pregnancy', 'risk', 'care', 'newborn', 'deliveries'];

/** Computes sections directly (no HTTP), as the route does for a doctor. */
async function computeFor(user, roles, sections, { scope = 'hospital', period: periodKey = '12m', careType = 'all', hospital = 'h1' } = {}) {
  const req = reqFor(user, roles);
  const today = hospitalToday(NOW);
  const period = parsePeriod({ period: periodKey }, { audience: 'doctor', today });
  const back60 = addDays(today, -60);
  const data = await loadHospital(fx.hospitals[hospital]._id, {
    now: NOW,
    today,
    windowFrom: period.from < back60 ? period.from : back60,
    periodFrom: period.from,
    periodTo: period.to,
    needs: NEEDS,
  });
  const visible = visibleSet(req, data.patients);
  const ctx = buildContext(data, { now: NOW, today, period, scope, careType, audience: 'doctor', userId: user._id, visible });
  const out = computeSections(ctx, sections);
  return { ctx, ...out, data, req };
}

// ---------- The fixture itself ----------

describe('fixture', () => {
  it('produced the records, dates and care plans the tables describe', async () => {
    for (const [key, want] of Object.entries(FIXTURE_EXPECTED)) {
      const tid = fx.hospitals[want.hospital ?? 'h1']._id;
      const p = await Patient.findOne({ tenantId: tid, _id: fx.ids[key] }).lean();
      expect(p, `${key} is in ${want.hospital ?? 'h1'}`).not.toBeNull();
      expect(isoDay(p.pregnancy?.effectiveEdd), `${key} EDD`).toBe(want.edd);
      expect(isoDay(toHospitalDate(p.createdAt)), `${key} registered`).toBe(want.registered);
      // The risk engine ran for every antenatal record with an EDD.
      if (p.careType === 'antenatal' && want.edd) expect(p.risk?.level ?? null, `${key} risk level`).not.toBeNull();
      const plans = await CarePlan.find({ tenantId: tid, patientId: p._id }).lean();
      if (!want.plan) {
        expect(plans, `${key} has no plan`).toHaveLength(0);
        continue;
      }
      expect(plans, `${key} has one plan`).toHaveLength(1);
      expect(pick(plans[0], ['current', 'status']), key).toEqual(pick(want.plan, ['current', 'status']));
      expect(isoDay(plans[0].bookedOn), `${key} booked`).toBe(want.plan.bookedOn);
    }
    // No record goes unchecked: every hospital holds exactly the records listed.
    for (const h of ['h1', 'h2', 'h3', 'h4']) {
      const listed = Object.values(FIXTURE_EXPECTED).filter((w) => (w.hospital ?? 'h1') === h).length;
      expect(await Patient.countDocuments({ tenantId: fx.hospitals[h]._id }), h).toBe(listed);
    }
    const a11 = await CarePlan.findOne({ tenantId: fx.hospitals.h1._id, patientId: fx.ids['A-11'] }).lean();
    expect(a11.closed.reason).toBe('delivered');
    // Only Dr B's records are sensitive.
    const sensitive = await Patient.find({ tenantId: fx.hospitals.h1._id, sensitive: true }).lean();
    expect(sensitive.map((p) => String(p._id)).sort()).toEqual([fx.ids['A-03'], fx.ids['I-01']].sort());
  });
});

// ---------- Numbers (section 6.2) ----------

describe('numbers: Dr B (sees every record), whole hospital, 12 months', () => {
  let overview;
  let pregnancy;
  beforeAll(async () => {
    overview = await payload('drB', 'overview');
    pregnancy = await payload('drB', 'pregnancy');
  });

  it('period and page', () => {
    expect(overview.audience).toBe('doctor');
    expect(overview.scope).toBe('hospital');
    expect(overview.today).toBe(TODAY);
    expect(overview.period.key).toBe('12m');
    expect(overview.period.label).toBe('1 Nov 2025 – 15 Oct 2026');
    expect(overview.period.buckets).toHaveLength(12);
    expect(overview.period.buckets.at(-1)).toMatchObject({ key: 'm:2026-10', label: 'Oct (to date)', partial: true });
    expect(overview.leftOut).toBe(0);
    expect(overview.masking).toBeNull();
    expect(overview.cards.map((c) => c.id)).toEqual(['A1', 'A4', 'V1', 'DQ']);
    expect(pregnancy.cards.map((c) => c.id)).toEqual(['A2', 'A3', 'D9', 'D10', 'B1']);
    expect(pregnancy.tiles).toBeNull();
  });

  it('A1 new registrations', () => {
    expect(pick(values(card(overview, 'A1')), ['antenatal', 'postnatal', 'infertility', 'gynaecology', 'newborn', 'total'])).toEqual({
      antenatal: 10,
      postnatal: 1,
      infertility: 2,
      gynaecology: 0,
      newborn: 6,
      total: 19,
    });
  });

  it('A4 visits', () => {
    const v = values(card(overview, 'A4'));
    expect(pick(v, ['total', 'new', 'followUp'])).toEqual({ total: 19, new: 11, followUp: 8 });
    expect(pick(v, ['v:antenatal', 'v:postnatal', 'v:infertility', 'v:gynaecology', 'v:newborn'])).toEqual({
      'v:antenatal': 14,
      'v:postnatal': 2,
      'v:infertility': 2,
      'v:gynaecology': 1,
      'v:newborn': 0,
    });
  });

  it('V1 other care', () => {
    const v = values(card(overview, 'V1'));
    const row = (t) => [v[`r:${t}|c:registered`], v[`r:${t}|c:visits`], v[`r:${t}|c:seen`]];
    expect(row('postnatal')).toEqual([1, 2, 2]);
    expect(row('gynaecology')).toEqual([0, 1, 1]);
    expect(row('infertility')).toEqual([2, 2, 1]);
  });

  it('DQ records to tidy up', () => {
    const dq = card(overview, 'DQ');
    // "No EDD" is A2.noEdd shown again: it opens a list by DQ's own code (the list page stays on Records to tidy up).
    expect(dq.cells.find((c) => c.key === 'dq2')).toMatchObject({ code: 'c3', value: 1, list: true });
    expect(dq.cells.find((c) => c.key === 'dq4')).toMatchObject({ code: 'c5', value: 1, list: false });
    expect(dq.cells.find((c) => c.key === 'active')).toMatchObject({ value: 9, list: false });
    expect(values(dq).allVisits).toBe(values(card(overview, 'A4')).total + values(dq).dq4); // no filter: A4.total is every visit
    // A-07 and A-12 – the two antenatal records older than 44 weeks – have a death recorded on them: a closed record is
    // never a record to tidy up (nor an active pregnancy), so neither is counted here.
    expect(pick(values(card(overview, 'DQ')), ['antenatalRecords', 'dq1', 'dq5', 'dq2', 'dq3', 'dq4', 'active', 'babies'])).toEqual({
      antenatalRecords: 10,
      dq1: 0,
      dq5: 1,
      dq2: 1,
      dq3: 2,
      dq4: 1,
      active: 9,
      babies: 5,
    });
  });

  it('A2 active pregnancies by trimester', () => {
    expect(values(card(pregnancy, 'A2'))).toEqual({ t1: 1, t2: 2, t3: 5, check: 0, noEdd: 1, total: 9 });
  });

  it('A3 expected deliveries', () => {
    const v = values(card(pregnancy, 'A3'));
    expect(nonZero(pick(v, Array.from({ length: 12 }, (_, i) => `w${i + 1}`)))).toEqual({ w1: 1, w2: 1, w9: 1 });
    expect(pick(v, ['next4', 'total12'])).toEqual({ next4: 2, total12: 3 });
    expect(card(pregnancy, 'A3').cells.find((c) => c.key === 'w1').label).toBe('15 Oct');
    expect(card(pregnancy, 'A3').trend).toEqual({ cells: Array.from({ length: 12 }, (_, i) => `w${i + 1}`), color: 'scheduled' });
  });

  it('D9 past the due date', () => {
    const c = card(pregnancy, 'D9');
    expect(values(c)).toEqual({ p40: 1, p41: 0, p42: 1, total: 2, older44: 0 }); // (A-07 and A-12 died: see DQ)
    // The footnote is the global cell DQ.dq1 (one number, protected once), a line and never a bar or a list.
    expect(c.cells.find((x) => x.key === 'older44')).toMatchObject({ group: 'footnote', list: false, value: values(card(overview, 'DQ')).dq1 });
    expect(c.extras).toEqual({});
  });

  it('D10 not seen recently', () => {
    expect(values(card(pregnancy, 'D10'))).toEqual({ waitingFirst: 2, neverSeen: 0, missedAppt: 2, gap: 1, ok: 4, total: 9 });
  });

  it('B1 when pregnancies were booked', () => {
    const c = card(pregnancy, 'B1');
    expect(values(c)).toEqual({ lt12: 7, w12_19: 2, w20_27: 1, w28p: 2, unknown: 0, known: 12, total: 12 });
    expect(c.shares).toEqual([{ key: 'first', label: 'Booked before 12 weeks', num: 'lt12', den: 'known' }]);
  });

  it('headline tiles are the same cells as the cards', () => {
    const t = Object.fromEntries(overview.tiles.map((x) => [x.ref, x.value]));
    expect(Object.keys(t)).toEqual(['A2.total', 'A3.next4', 'C1.high', 'B1.total', 'A4.all', 'G1.total']);
    expect(pick(t, ['A2.total', 'A3.next4', 'B1.total', 'A4.all', 'G1.total'])).toEqual({ 'A2.total': 9, 'A3.next4': 2, 'B1.total': 12, 'A4.all': 19, 'G1.total': 5 });
    expect(overview.tiles.find((x) => x.ref === 'C1.high')).toMatchObject({ tone: 'high', metric: 'C1' });
    expect(overview.tiles.find((x) => x.ref === 'G1.total')).toMatchObject({ list: true, metric: 'G1', cell: 'c0', sub: 'born in the period' });
    expect(overview.tiles.find((x) => x.ref === 'A2.total')).toMatchObject({ list: true, metric: 'A2', cell: 'c0' });
    expect(overview.tiles.find((x) => x.ref === 'A4.all')).toMatchObject({ list: false, cell: null }); // visits, not patients
  });

  it('this month (1–15 Oct)', async () => {
    const o = await payload('drB', 'overview', { period: 'this_month' });
    expect(nonZero(pick(values(card(o, 'A1')), ['antenatal', 'postnatal', 'infertility', 'gynaecology', 'newborn', 'total']))).toEqual({
      antenatal: 2,
      postnatal: 1,
      newborn: 2,
      total: 5,
    });
    expect(values(card(o, 'A4')).total).toBe(7);
    expect(o.period.buckets.map((b) => b.key)).toEqual(['w:2026-09-28', 'w:2026-10-05', 'w:2026-10-12']);
    // As-of-today cards don't change with the period.
    const p = await payload('drB', 'pregnancy', { period: 'this_month' });
    expect(values(card(p, 'A2')).total).toBe(9);
  });

  it('the type-of-care filter changes only registrations and visits', async () => {
    const o = await payload('drB', 'overview', { careType: 'antenatal' });
    const a1 = card(o, 'A1');
    expect(a1.cells.filter((c) => c.group !== 'trend').map((c) => c.key)).toEqual(['antenatal']);
    expect(a1.total.value).toBe(10);
    const a4 = values(card(o, 'A4'));
    expect(pick(a4, ['total', 'new', 'followUp'])).toEqual({ total: 14, new: 8, followUp: 6 });
    expect(card(o, 'A4').cells.some((c) => c.key.startsWith('v:') || c.key === 'all')).toBe(false);
    expect(values(card(o, 'V1'))).toEqual(values(card(overview, 'V1')));
    expect(values(card(o, 'DQ'))).toEqual(values(card(overview, 'DQ')));
    // The headline tiles are not under the filter (it covers only the Registrations and visits group).
    expect(o.tiles).toEqual(overview.tiles);
    // Another type: the shared V1 cells still resolve, and the tile still counts every visit.
    const pn = await payload('drB', 'overview', { careType: 'postnatal' });
    expect(values(card(pn, 'A4')).total).toBe(2);
    expect(pn.tiles.find((x) => x.ref === 'A4.all').value).toBe(19);
    expect(values(card(pn, 'V1'))).toEqual(values(card(overview, 'V1')));
  });
});

describe('numbers: Dr A (does not see A-03 and I-01), whole hospital', () => {
  let overview;
  let pregnancy;
  beforeAll(async () => {
    overview = await payload('drA', 'overview');
    pregnancy = await payload('drA', 'pregnancy');
  });

  it('says how many records are left out', () => {
    expect(overview.leftOut).toBe(2);
    expect(pregnancy.leftOut).toBe(2);
  });

  it('pregnancy numbers', () => {
    expect(pick(values(card(pregnancy, 'A2')), ['t3', 'total'])).toEqual({ t3: 4, total: 8 });
    expect(pick(values(card(pregnancy, 'A3')), ['w9', 'total12'])).toEqual({ w9: 0, total12: 2 });
    expect(values(card(pregnancy, 'D10')).missedAppt).toBe(1);
    expect(pick(values(card(pregnancy, 'B1')), ['lt12', 'total'])).toEqual({ lt12: 6, total: 11 });
  });

  it('overview numbers', () => {
    expect(pick(values(card(overview, 'A1')), ['antenatal', 'infertility', 'total'])).toEqual({ antenatal: 9, infertility: 1, total: 17 });
    expect(pick(values(card(overview, 'A4')), ['total', 'new', 'followUp'])).toEqual({ total: 14, new: 9, followUp: 5 });
    expect(values(card(overview, 'DQ')).antenatalRecords).toBe(9); // (A-07 and A-12 died: see DQ above)
  });

  it('a doctor who is also admin gets the doctor view, with the same numbers as Dr A', async () => {
    for (const name of ALL_SECTIONS) {
      const mine = await payload('docAdmin', name);
      const drA = await payload('drA', name);
      expect(mine.audience, name).toBe('doctor');
      expect(mine.cards.length, name).toBeGreaterThan(0);
      expect(mine.cards, name).toEqual(drA.cards);
      expect(mine.tiles, name).toEqual(drA.tiles);
      expect(mine.leftOut, name).toBe(2);
    }
  });
});

describe('numbers: Dr A, my patients only', () => {
  it('counts only patients assigned to Dr A', async () => {
    const p = await payload('drA', 'pregnancy', { scope: 'mine' });
    expect(p.scope).toBe('mine');
    expect(p.leftOut).toBeNull();
    expect(values(card(p, 'A2'))).toEqual({ t1: 1, t2: 1, t3: 2, check: 0, noEdd: 1, total: 5 }); // A-05 is unassigned
  });
});

describe('partitions add up on the fixture', () => {
  const cases = [
    ['drB', 'hospital', '12m'],
    ['drA', 'hospital', '12m'],
    ['drA', 'mine', '12m'],
    ['drA', 'hospital', 'this_month'],
    ['drB', 'hospital', '3m'],
  ];
  it.each(cases)('%s, %s, %s', async (who, scope, period) => {
    for (const careType of ['all', 'antenatal', 'newborn']) {
      const { ctx, cards } = await computeFor(fx.users[who], ['doctor'], ALL_SECTIONS, { scope, period, careType });
      const value = (gid) => {
        const [mid, key] = [gid.slice(0, gid.indexOf('.')), gid.slice(gid.indexOf('.') + 1)];
        return countOf(ctx.results.get(mid).cells[key]);
      };
      const rs = relations(ctx, cards);
      expect(rs.length).toBeGreaterThan(60);
      for (const r of rs) {
        if (r.kind === 'subset') {
          expect(value(r.sub), `${r.sub} ≤ ${r.sup} (${careType})`).toBeLessThanOrEqual(value(r.sup));
          continue;
        }
        const sum = r.parts.reduce((s, g) => s + value(g), 0);
        expect(sum, `${r.total} = ${r.parts.join(' + ')} (${careType})`).toBe(value(r.total));
      }
    }
  });
});

describe('payload shape', () => {
  it('extras hold only a median or a ratio, never a bare count (numbers go through cells)', async () => {
    for (const who of ['drA', 'drB']) {
      for (const name of ['overview', 'pregnancy']) {
        for (const careType of ['all', 'postnatal']) {
          const p = await payload(who, name, name === 'overview' ? { careType } : {});
          for (const c of p.cards) {
            for (const [k, v] of Object.entries(c.extras)) {
              expect(['median', 'ratio'], `${name} ${c.id} extras.${k}`).toContain(k);
              expect(typeof v, `${c.id} extras.${k}`).toBe('object');
            }
          }
        }
      }
    }
  });

  it('a listable cell code resolves to the cell that was shown (DQ c3 is A2.noEdd)', async () => {
    const { ctx } = await computeFor(fx.users.drB, ['doctor'], ['overview']);
    expect(cellByCode(metricById('DQ'), 'c3', ctx)?.key).toBe('dq2');
  });
});

// ---------- Numbers, step 1b: risk, care plans and newborn (section 6.2) ----------

describe('numbers: risk, care plans and newborn – Dr B (sees every record), whole hospital, 12 months', () => {
  let risk;
  let care;
  let newborn;
  let overview;
  beforeAll(async () => {
    risk = await payload('drB', 'risk');
    care = await payload('drB', 'care');
    newborn = await payload('drB', 'newborn');
    overview = await payload('drB', 'overview');
  });

  it('cards in page order', async () => {
    expect(risk.cards.map((c) => c.id)).toEqual(['C1', 'C2', 'C9', 'C4', 'D1', 'D3', 'D4', 'D6']);
    expect(care.cards.map((c) => c.id)).toEqual(['E1', 'E4', 'B4']);
    expect(newborn.cards.map((c) => c.id)).toEqual(['G1', 'G2', 'G3', 'G6']);
    const deliveries = await payload('drB', 'deliveries');
    expect(deliveries.cards.map((c) => c.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']);
    for (const p of [risk, care, newborn, deliveries]) {
      expect(p.tiles).toBeNull();
      expect(p.leftOut).toBe(0);
    }
  });

  it('C4 mothers’ profile', () => {
    const v = values(card(risk, 'C4'));
    expect(pick(v, ['age:lt18', 'age:a18_19', 'age:a20_34', 'age:a35p', 'age:unknown'])).toEqual({ 'age:lt18': 1, 'age:a18_19': 0, 'age:a20_34': 6, 'age:a35p': 2, 'age:unknown': 0 });
    expect(pick(v, ['preg:g1', 'preg:multi', 'preg:grand', 'preg:unknown'])).toEqual({ 'preg:g1': 3, 'preg:multi': 4, 'preg:grand': 1, 'preg:unknown': 1 });
    expect(card(risk, 'C4').cells.find((c) => c.key === 'preg:grand').label).toBe('Grand multipara (4 or more births)');
    // The 4 comes from the hospital's own rule (loaded with its template), not the fallback.
    expect(card(risk, 'C4').notes).toContain("Grand multipara uses the number of births in your hospital's risk rules.");
    expect(pick(v, ['cs:none', 'cs:one', 'cs:twoPlus', 'cs:unknown'])).toEqual({ 'cs:none': 6, 'cs:one': 1, 'cs:twoPlus': 1, 'cs:unknown': 1 });
    expect(pick(v, ['blood:rhNeg', 'blood:rhPos', 'blood:unknown'])).toEqual({ 'blood:rhNeg': 2, 'blood:rhPos': 5, 'blood:unknown': 2 });
    expect(v.total).toBe(9);
  });

  it('D1 known conditions', () => {
    const v = values(card(risk, 'D1'));
    expect(pick(v, ['known', 'unknown', 'total'])).toEqual({ known: 6, unknown: 3, total: 9 });
    expect(nonZero(pick(v, CONDITIONS))).toEqual({ hiv: 1, diabetes: 1, hypertension: 1 });
    expect(card(risk, 'D1').cells.find((c) => c.key === 'hiv')).toMatchObject({ code: `c${CONDITIONS.indexOf('hiv') + 1}`, label: 'HIV', list: true });
  });

  it('D3 BP 140/90 or higher', () => {
    expect(values(card(risk, 'D3'))).toEqual({ total: 8, high: 3, normal: 5, severe: 1, twoPlus: 0, withAlbumin: 1 });
  });

  it('D4 anaemia', () => {
    expect(values(card(risk, 'D4'))).toEqual({ seen: 8, total: 6, none: 3, mild: 1, moderate: 1, severe: 1 });
  });

  it('D6 baby not head-down from 36 weeks, and its identity with D9 and A3', async () => {
    expect(values(card(risk, 'D6'))).toEqual({ total: 4, cephalic: 3, notCephalic: 1, notRecorded: 0 });
    const preg = await payload('drB', 'pregnancy');
    expect(values(card(preg, 'D9')).total + values(card(preg, 'A3')).next4 + 0).toBe(4); // + EDD exactly T+28: none
  });

  it('G1 babies registered', async () => {
    const c = card(newborn, 'G1');
    const v = values(c);
    expect(pick(v, ['total', 'linked', 'noMother', 'multiple'])).toEqual({ total: 5, linked: 3, noMother: 2, multiple: 2 });
    expect(nonZero(pick(v, c.trend.cells))).toEqual({ 'b:m:2026-03': 1, 'b:m:2026-06': 2, 'b:m:2026-08': 1, 'b:m:2026-10': 1 });
    expect(values(card(await payload('drB', 'newborn', { period: 'this_month' }), 'G1')).total).toBe(1);
    expect(values(card(await payload('drB', 'newborn', { period: '3m' }), 'G1')).total).toBe(2);
    // Records to tidy up shows the same cells.
    expect(pick(values(card(overview, 'DQ')), ['dq3', 'babies'])).toEqual({ dq3: 2, babies: 5 });
  });

  it('G2 sex at birth: whole hospital, no lists, ratio for information', () => {
    const c = card(newborn, 'G2');
    expect(values(c)).toEqual({ girls: 2, boys: 2, indeterminate: 1, notRecorded: 0, total: 5 });
    expect(c.wholeHospital).toBe(true);
    expect(c.extras).toEqual({ ratio: { value: 1000, basis: 4 } });
    expect(c.notes.some((n) => n.startsWith('Based on 5 babies.'))).toBe(true);
    expect(c.cells.every((x) => x.status === null)).toBe(true);
  });

  it('G3 birth weight', () => {
    const c = card(newborn, 'G3');
    expect(values(c)).toEqual({ elbw: 0, vlbw: 1, lbw: 2, normal: 1, macro: 0, notWeighed: 1, weighed: 4, low: 3, total: 5 });
    expect(c.extras).toEqual({ median: { value: 2000, n: 4 } });
  });

  it('G6 gestation at birth', () => {
    const v = values(card(newborn, 'G6'));
    expect(nonZero(pick(v, ['lt28', 'w28_31', 'w32_33', 'w34_36', 'term', 'post', 'noMother', 'noDates']))).toEqual({ term: 1, w34_36: 2, noMother: 2 });
    expect(pick(v, ['known', 'preterm', 'scan', 'total'])).toEqual({ known: 3, preterm: 2, scan: 0, total: 5 });
  });

  it('C1 is the headline "High-risk pregnancies" tile', () => {
    expect(overview.tiles.find((x) => x.ref === 'C1.high').value).toBe(values(card(risk, 'C1')).high);
    expect(values(card(risk, 'C1')).total).toBe(9);
    expect(card(risk, 'C1').cells.map((x) => x.status)).toEqual(['high', 'moderate', 'low', 'incomplete', null]);
  });
});

describe('numbers: risk and newborn – Dr A (does not see A-03 and I-01)', () => {
  it('whole hospital', async () => {
    const risk = await payload('drA', 'risk');
    expect(risk.leftOut).toBe(2);
    const c4 = values(card(risk, 'C4'));
    expect(pick(c4, ['age:a20_34', 'preg:multi', 'cs:none', 'blood:rhPos'])).toEqual({ 'age:a20_34': 5, 'preg:multi': 3, 'cs:none': 5, 'blood:rhPos': 4 });
    expect(pick(values(card(risk, 'D1')), ['known', 'hiv'])).toEqual({ known: 5, hiv: 0 });
    expect(pick(values(card(risk, 'D3')), ['total', 'high', 'severe', 'withAlbumin'])).toEqual({ total: 7, high: 2, severe: 0, withAlbumin: 0 });
    expect(pick(values(card(risk, 'D4')), ['seen', 'total', 'mild'])).toEqual({ seen: 7, total: 5, mild: 0 });
    // Newborn cards are unchanged (no baby or linked mother is Dr B's sensitive record).
    const a = await payload('drA', 'newborn');
    const b = await payload('drB', 'newborn');
    expect(a.cards).toEqual(b.cards);
  });

  it('my patients only: babies assigned to Dr A or whose mother is; sex at birth stays whole hospital', async () => {
    const p = await payload('drA', 'newborn', { scope: 'mine' });
    expect(values(card(p, 'G1')).total).toBe(2); // B-01 (mother M-01 is Dr A's) and B-05
    const g2 = card(p, 'G2');
    expect(g2.wholeHospital).toBe(true);
    expect(values(g2)).toEqual({ girls: 2, boys: 2, indeterminate: 1, notRecorded: 0, total: 5 });
  });

  it("a baby whose mother's record Dr A may not open has no usable dates", async () => {
    const drB = await fx.as('drB');
    expect((await drB.patch(`/api/patients/${fx.ids['M-02']}/sensitive`).send({ sensitive: true })).status).toBe(200);
    try {
      const v = values(card(await payload('drA', 'newborn'), 'G6'));
      expect(pick(v, ['w34_36', 'noDates', 'known'])).toEqual({ w34_36: 0, noDates: 2, known: 1 });
      expect(values(card(await payload('drB', 'newborn'), 'G6')).w34_36).toBe(2);
    } finally {
      expect((await drB.patch(`/api/patients/${fx.ids['M-02']}/sensitive`).send({ sensitive: false })).status).toBe(200);
    }
  });
});

// ---------- Deliveries tab (5 Oct 2026): confirmed delivery notes and the deaths recorded on records ----------

describe('numbers: deliveries – Dr B (sees every record), whole hospital, 12 months', () => {
  let p;
  beforeAll(async () => {
    p = await payload('drB', 'deliveries');
  });

  it('the fixture: four confirmed notes in H1, one in H2; a note entered in error and a draft; the deaths', async () => {
    const notes = await ClinicalDocument.find({ tenantId: { $in: [fx.hospitals.h1._id, fx.hospitals.h2._id] }, kind: 'delivery' }).lean();
    const byName = Object.fromEntries(Object.entries(fx.docIds).map(([name, docId]) => [name, notes.find((d) => String(d._id) === docId)]));
    expect(Object.fromEntries(Object.entries(byName).map(([name, d]) => [name, d.status]))).toEqual({
      'A-07 delivery': 'signed',
      'A-03 delivery': 'signed',
      'A-11 delivery': 'signed',
      'A-05 delivery': 'signed',
      'A-06 delivery': 'cancelled',
      'A-06 draft': 'draft',
      'H2-1 delivery': 'signed',
    });
    expect(String(byName['H2-1 delivery'].tenantId)).toBe(String(fx.hospitals.h2._id));
    // Fields not answered stay "not recorded", as on a note from before 5 Oct 2026.
    expect(byName['A-11 delivery'].content.pph).toBe('');
    expect(byName['A-11 delivery'].content.babies[0]).toMatchObject({ apgar5: null, breastfedWithinHour: '', nicu: '' });
    const deaths = await Patient.find({ tenantId: fx.hospitals.h1._id, 'death.on': { $ne: null } }).lean();
    const by = Object.fromEntries(deaths.map((d) => [Object.keys(fx.ids).find((k) => fx.ids[k] === String(d._id)), d.death]));
    expect(Object.keys(by).sort()).toEqual(['A-07', 'A-12', 'B-04', 'B-06', 'Y-01']);
    expect(pick(by['B-04'], ['ageDays', 'place'])).toEqual({ ageDays: 1, place: 'here' });
    expect(by['B-06'].ageDays).toBe(300);
    expect([by['A-07'].timing, by['A-12'].timing, by['Y-01'].timing]).toEqual(['delivery', 'pregnancy', 'other']);
    const b05 = await Patient.findOne({ tenantId: fx.hospitals.h1._id, _id: fx.ids['B-05'] }).lean();
    expect(b05.death).toBeNull();
    expect(b05.deathHistory).toHaveLength(1); // recorded in error and undone
  });

  it('only confirmed notes are loaded, with the fields the cards count and nothing typed', async () => {
    const today = hospitalToday(NOW);
    const period = parsePeriod({ period: '12m' }, { audience: 'doctor', today });
    const data = await loadHospital(fx.hospitals.h1._id, { now: NOW, today, windowFrom: period.from, periodFrom: period.from, periodTo: period.to, needs: ['patients', 'deliveries'] });
    expect(data.deliveries.map((d) => String(d._id)).sort()).toEqual(['A-07 delivery', 'A-03 delivery', 'A-11 delivery', 'A-05 delivery'].map((n) => fx.docIds[n]).sort());
    const text = JSON.stringify(data.deliveries);
    for (const k of ['weightGrams', 'sex', 'indication', 'notes', 'bloodLossMl', 'conductedBy', 'apgar1', 'signed', 'createdByName']) expect(text, k).not.toContain(`"${k}"`);
    for (const d of data.deliveries) expect(Object.keys(d).sort()).toEqual(['_id', 'content', 'patientId']);
  });

  it('H1 deliveries and mode of delivery: one per confirmed note, by the date of delivery', () => {
    const c = card(p, 'H1');
    const v = values(c);
    expect(pick(v, ['total', 'normal', 'vacuum', 'forceps', 'lscs', 'other', 'noMode', 'known'])).toEqual({ total: 4, normal: 1, vacuum: 1, forceps: 0, lscs: 2, other: 0, noMode: 0, known: 4 });
    expect(nonZero(pick(v, c.trend.cells))).toEqual({ 'b:m:2026-09': 1, 'b:m:2026-10': 3 });
    expect(c.shares).toEqual([{ key: 'lscs', label: 'Caesarean rate', num: 'lscs', den: 'known' }]);
    expect(c.cells.find((x) => x.key === 'noMode')).toMatchObject({ unknown: true, label: 'Mode not recorded', code: 'c98' });
    expect(c.cells.filter((x) => !x.key.startsWith('b:')).map((x) => x.code)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c98', 'c99']);
    expect(c.total).toMatchObject({ label: 'Deliveries', list: true });
  });

  it('H2 postpartum haemorrhage: the doctor’s answer, with "not recorded" shown', () => {
    expect(values(card(p, 'H2'))).toEqual({ total: 4, yes: 1, no: 2, notRecorded: 1, answered: 3 });
    expect(card(p, 'H2').shares.map((s) => [s.num, s.den])).toEqual([
      ['yes', 'answered'],
      ['answered', 'total'],
    ]);
  });

  it('H3 births and stillbirths: every baby (twins count as two)', () => {
    expect(values(card(p, 'H3'))).toEqual({ total: 5, live: 4, still: 1, noOutcome: 0, fresh: 1, macerated: 0, stillKindNotRecorded: 0 });
  });

  it('H4, H5 and H6: out of the live births, with what is not recorded', () => {
    expect(values(card(p, 'H4'))).toEqual({ total: 4, low: 1, normal: 2, notRecorded: 1, recorded: 3 });
    expect(values(card(p, 'H5'))).toEqual({ total: 4, yes: 1, no: 2, notRecorded: 1, answered: 3 });
    expect(values(card(p, 'H6'))).toEqual({ total: 4, yes: 1, no: 1, na: 1, notRecorded: 1, answered: 3 });
    // Breastfeeding: the rate is out of all live births.
    expect(card(p, 'H6').shares.find((s) => s.key === 'yes')).toMatchObject({ num: 'yes', den: 'total' });
    for (const id of ['H4', 'H5', 'H6']) expect(card(p, id).total.label, id).toBe('Live births');
  });

  it('H7 stillbirths and deaths: newborn deaths in the first 28 days, maternal deaths by when; a death undone is not counted', () => {
    const c = card(p, 'H7');
    expect(c.total).toBeNull();
    expect(values(c)).toEqual({ still: 1, newborn: 1, early: 1, ageUnknown: 0, maternal: 2, 'm:pregnancy': 1, 'm:delivery': 1, 'm:postpartum': 0 });
    // B-06 died at 300 days and Y-01 of something not related to a pregnancy: not counted here.
  });

  it('notes give the sources and say what is a draft; no word about the babies’ sex anywhere', () => {
    expect(card(p, 'H4').notes[0]).toMatch(/Apgar Score.*2015.*draft for a doctor to check/);
    expect(card(p, 'H2').notes[0]).toMatch(/500 mL or more, or 1,000 mL or more after a caesarean.*DRAFT for a doctor to check\. Source: WHO recommendations on postpartum haemorrhage \(2012\)/);
    expect(card(p, 'H2').title).toBe('Heavy bleeding after delivery (postpartum haemorrhage)'); // plain words first: admins see it
    expect(card(p, 'H7').notes.join(' ')).toMatch(/not from an accident.*DRAFT for a doctor to check\. Source: WHO definitions/);
    expect(mentionsFetalSex(JSON.stringify(p))).toBe(false);
  });
});

describe('numbers: deliveries – other doctors, scopes, periods and hospitals', () => {
  it("Dr A does not count Dr B's sensitive record (A-03)", async () => {
    const p = await payload('drA', 'deliveries');
    expect(p.leftOut).toBe(2);
    expect(pick(values(card(p, 'H1')), ['total', 'normal', 'vacuum', 'lscs'])).toEqual({ total: 3, normal: 1, vacuum: 0, lscs: 2 });
    expect(pick(values(card(p, 'H3')), ['total', 'live', 'still'])).toEqual({ total: 4, live: 3, still: 1 });
    expect(values(card(p, 'H6'))).toEqual({ total: 3, yes: 1, no: 0, na: 1, notRecorded: 1, answered: 2 });
    expect(card(p, 'H1').notes).toContain('Deliveries of women whose clinical details you may not see are not counted on this tab.');
    for (const id of ['H2', 'H3', 'H4', 'H5', 'H6']) expect(card(p, id).notes.join(' '), id).not.toMatch(/may not see/); // said once
  });

  it('my patients only: deliveries and deaths on the records assigned to Dr A', async () => {
    const p = await payload('drA', 'deliveries', { scope: 'mine' });
    expect(pick(values(card(p, 'H1')), ['total', 'normal', 'lscs'])).toEqual({ total: 2, normal: 1, lscs: 1 }); // A-07, A-11 (A-05 has no doctor)
    expect(values(card(p, 'H7'))).toEqual({ still: 0, newborn: 0, early: 0, ageUnknown: 0, maternal: 1, 'm:pregnancy': 0, 'm:delivery': 1, 'm:postpartum': 0 });
  });

  it('the period is by the hospital date of delivery and of death', async () => {
    const one = async (from, to) => values(card(await payload('drB', 'deliveries', { period: 'custom', from, to }), 'H1')).total;
    // A-03 at 01:00 in India on 5 Oct (4 Oct in UTC); A-11 at 23:30 in India on 6 Oct (6 Oct in UTC, 18:00).
    expect([await one('2026-10-04', '2026-10-04'), await one('2026-10-05', '2026-10-05'), await one('2026-10-06', '2026-10-06'), await one('2026-10-07', '2026-10-07')]).toEqual([0, 1, 1, 0]);
    const month = await payload('drB', 'deliveries', { period: 'this_month' });
    expect(values(card(month, 'H1')).total).toBe(3);
    expect(pick(values(card(month, 'H7')), ['still', 'maternal', 'newborn'])).toEqual({ still: 1, maternal: 0, newborn: 0 });
    expect(card(month, 'H1').trend.cells.every((k) => k.startsWith('b:w:'))).toBe(true); // weekly columns
  });

  it('the same numbers as the monthly report (Dr B sees every record)', async () => {
    const report = async (month) => Object.fromEntries((await monthlyReport(fx.hospitals.h1._id, month)).sections.flatMap((s) => s.rows).map((r) => [r.key, r.value]));
    for (const [month, from, to] of [
      ['2026-03', '2026-03-01', '2026-03-31'],
      ['2026-09', '2026-09-01', '2026-09-30'],
      ['2026-10', '2026-10-01', '2026-10-15'],
    ]) {
      const r = await report(month);
      const a = await payload('drB', 'deliveries', { period: 'custom', from, to });
      const v = (id) => values(card(a, id));
      expect(
        {
          deliveries: v('H1').total,
          del_normal: v('H1').normal,
          del_assisted: v('H1').vacuum + v('H1').forceps,
          del_caesarean: v('H1').lscs,
          live_births: v('H3').live,
          still_births: v('H3').still,
          still_fresh: v('H3').fresh,
          still_macerated: v('H3').macerated,
          still_kind_not_recorded: v('H3').stillKindNotRecorded,
          newborn_deaths: v('H7').newborn,
          newborn_deaths_early: v('H7').early,
          maternal_deaths: v('H7').maternal,
          maternal_pregnancy: v('H7')['m:pregnancy'],
          maternal_delivery: v('H7')['m:delivery'],
          maternal_postpartum: v('H7')['m:postpartum'],
        },
        month,
      ).toEqual(
        pick(r, [
          'deliveries',
          'del_normal',
          'del_assisted',
          'del_caesarean',
          'live_births',
          'still_births',
          'still_fresh',
          'still_macerated',
          'still_kind_not_recorded',
          'newborn_deaths',
          'newborn_deaths_early',
          'maternal_deaths',
          'maternal_pregnancy',
          'maternal_delivery',
          'maternal_postpartum',
        ]),
      );
    }
    expect((await report('2026-10')).deliveries).toBe(3);
    expect((await report('2026-03')).newborn_deaths).toBe(1);
  });

  it("another hospital's notes are never counted; its own doctor sees them", async () => {
    const h2 = await payload('drH2', 'deliveries');
    expect(values(card(h2, 'H1')).total).toBe(1);
    expect(pick(values(card(h2, 'H3')), ['total', 'live', 'still', 'macerated'])).toEqual({ total: 1, live: 0, still: 1, macerated: 1 });
    expect(values(card(h2, 'H7')).still).toBe(1);
    const h1 = await payload('drB', 'deliveries');
    expect(values(card(h1, 'H3')).macerated).toBe(0);
    // The list of H2's stillbirths holds H2's patient only.
    const list = await listBody('drH2', { metric: 'H3', cell: 'c2' });
    expect(list.patients.map((r) => r.id)).toEqual([fx.ids['H2-1']]);
  });
});

describe('lists: deliveries', () => {
  it('one row per delivery, the latest first, each showing the mother; the detail is the day and the mode', async () => {
    const body = await listBody('drB', { metric: 'H1', cell: 'c0' });
    expect(pick(body, ['metric', 'cell', 'section', 'title', 'cellLabel', 'window', 'detailLabel', 'count', 'total', 'restricted'])).toEqual({
      metric: 'H1',
      cell: 'c0',
      section: 'deliveries',
      title: 'Deliveries and mode of delivery',
      cellLabel: 'Deliveries',
      window: 'period',
      detailLabel: 'Delivery',
      count: 4,
      total: 4,
      restricted: 0,
    });
    expect(body.patients.map((r) => r.id)).toEqual(['A-05', 'A-11', 'A-03', 'A-07'].map((k) => fx.ids[k]));
    expect(body.patients.map((r) => r.detail)).toEqual([
      { type: 'delivery', on: day(-1), mode: 'lscs' },
      { type: 'delivery', on: day(-9), mode: 'lscs' },
      { type: 'delivery', on: day(-10), mode: 'vacuum' },
      { type: 'delivery', on: day(-42), mode: 'normal' },
    ]);
    const lscs = await listBody('drA', { metric: 'H1', cell: 'c4' });
    expect(lscs.patients.map((r) => r.id)).toEqual(['A-05', 'A-11'].map((k) => fx.ids[k]));
  });

  it('one row per baby: a mother of twins is listed twice, told apart by the detail; the audit entry names her once', async () => {
    const body = await listBody('drB', { metric: 'H3', cell: 'c0' });
    expect(body.count).toBe(5);
    expect(body.patients).toHaveLength(5);
    const a05 = body.patients.filter((r) => r.id === fx.ids['A-05']);
    expect(a05.map((r) => r.detail)).toEqual([
      { type: 'birth', on: day(-1), baby: 1, of: 2 },
      { type: 'birth', on: day(-1), baby: 2, of: 2 },
    ]);
    const e = await AuditLog.findOne({ action: 'ANALYTICS_LIST_VIEWED', actor: fx.users.drB._id }).sort({ _id: -1 }).lean();
    expect(e.details).toEqual({ patientIds: ['A-05', 'A-11', 'A-03', 'A-07'].map((k) => fx.ids[k]).sort(), count: 4, page: 1 });
    // The stillbirth: the second baby of A-05. Card H7 shows the same number and opens the same list.
    const still = await listBody('drB', { metric: 'H3', cell: 'c2' });
    expect(still.patients.map((r) => [r.id, r.detail])).toEqual([[fx.ids['A-05'], { type: 'birth', on: day(-1), baby: 2, of: 2 }]]);
    const fromDeaths = await listBody('drB', { metric: 'H7', cell: 'c1' });
    expect(pick(fromDeaths, ['title', 'cellLabel', 'count'])).toEqual({ title: 'Stillbirths and deaths', cellLabel: 'Stillbirths', count: 1 });
    expect(fromDeaths.patients).toEqual(still.patients);
    // Apgar under 7: the baby of A-07, with the score.
    const low = await listBody('drB', { metric: 'H4', cell: 'c1' });
    expect(low.patients.map((r) => [r.id, r.detail])).toEqual([[fx.ids['A-07'], { type: 'birth', on: day(-42), baby: 1, of: 1, apgar5: 6 }]]);
  });

  it('deaths: the record the death is on, the latest death first; pages hold every entry once', async () => {
    const maternal = await listBody('drA', { metric: 'H7', cell: 'c5' });
    expect(maternal.patients.map((r) => [r.id, r.detail])).toEqual([
      [fx.ids['A-12'], { type: 'death', on: day(-30) }],
      [fx.ids['A-07'], { type: 'death', on: day(-42) }],
    ]);
    const newborn = await listBody('drA', { metric: 'H7', cell: 'c2' });
    expect(newborn.patients.map((r) => [r.id, r.bornOn, r.detail])).toEqual([[fx.ids['B-04'], day(-200), { type: 'death', on: day(-199) }]]);
    // Two pages of babies: every entry once, in one order.
    const all = await listBody('drB', { metric: 'H3', cell: 'c0', limit: '100' });
    const seen = [];
    for (const page of [1, 2, 3]) seen.push(...(await listBody('drB', { metric: 'H3', cell: 'c0', limit: '2', page: String(page) })).patients.map((r) => `${r.id} ${JSON.stringify(r.detail)}`));
    expect(seen).toEqual(all.patients.map((r) => `${r.id} ${JSON.stringify(r.detail)}`));
    expect(new Set(seen).size).toBe(5);
  });

  it('a number that opens no list, and doctors only', async () => {
    for (const q of [
      { metric: 'H1', cell: 'c97' },
      { metric: 'H7', cell: 'c0' }, // H7 has no total
      { metric: 'H1', cell: 'bm202605' }, // a month column is not a list here
    ]) {
      const res = await list('drA', q);
      expect(res.status, JSON.stringify(q)).toBe(400);
    }
    expect((await list('admin', { metric: 'H1', cell: 'c0' })).status).toBe(403);
    expect((await list('rmo', { metric: 'H1', cell: 'c0' })).status).toBe(403);
  });
});

describe('reference loops: risk levels, reasons, missing information and care plans (Dr B)', () => {
  let ctx;
  let active;
  let docs;
  beforeAll(async () => {
    ({ ctx } = await computeFor(fx.users.drB, ['doctor'], ['risk', 'care']));
    active = [...ctx.results.get('A2').cells.total];
    docs = new Map((await Patient.find({ tenantId: fx.hospitals.h1._id, _id: { $in: active } }).lean()).map((p) => [String(p._id), p]));
    expect(active).toHaveLength(9);
  });
  const count = (key) => countOf(ctx.results.get(key.split('.')[0]).cells[key.slice(key.indexOf('.') + 1)]);

  it('C1 equals the stored risk levels', () => {
    const want = { high: 0, moderate: 0, low: 0, incomplete: 0, none: 0 };
    for (const id of active) want[docs.get(id).risk?.level ?? 'none'] += 1;
    expect(Object.fromEntries(Object.keys(want).map((k) => [k, count(`C1.${k}`)]))).toEqual(want);
    expect(want.high + want.moderate).toBeGreaterThan(0);
  });

  it('C2 equals the stored risk reasons', () => {
    const byKey = new Map(); // reason key → { label, ids }
    for (const id of active) for (const r of docs.get(id).risk?.reasons ?? []) {
      if (!byKey.has(r.key)) byKey.set(r.key, { key: r.key, label: r.label, ids: new Set() });
      byKey.get(r.key).ids.add(id);
    }
    expect(byKey.size).toBeGreaterThan(0);
    // The card shows the ten most common reasons (then by name) and folds the rest into "Other reasons". Since the
    // rules on readings of this pregnancy (Hb, BP at the fixture's visits) there are more than ten here.
    const rows = [...byKey.values()].sort((a, b) => b.ids.size - a.ids.size || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    const top = rows.slice(0, 10);
    const folded = new Set(rows.slice(10).flatMap((r) => [...r.ids]));
    const cardRows = cellsOf(metricById('C2'), ctx).filter((c) => c.key !== 'other');
    expect(cardRows.map((c) => [c.label, count(`C2.${c.key}`)])).toEqual(top.map((r) => [r.label, r.ids.size]));
    expect(count('C2.other')).toBe(folded.size);
  });

  it('C9 equals the stored missing information', () => {
    const rowOf = (m) =>
      m === 'Age' ? 'age' : m === 'Height' ? 'height' : m === 'Weight' ? 'weight'
        : /^(Gravida|Para|Abortions)/.test(m) ? 'obstetric' : m === 'Number of previous caesareans' ? 'caesareans'
          : m === 'Blood group' ? 'bloodGroup' : m.startsWith('Pre-existing conditions') ? 'conditions'
            : m.startsWith('Problems in previous pregnancies') ? 'pastProblems' : 'other';
    const want = Object.fromEntries(['age', 'height', 'weight', 'obstetric', 'caesareans', 'bloodGroup', 'conditions', 'pastProblems', 'other'].map((k) => [k, new Set()]));
    for (const id of active) for (const m of docs.get(id).risk?.missing ?? []) want[rowOf(m)].add(id);
    const sizes = Object.fromEntries(Object.entries(want).map(([k, v]) => [k, v.size]));
    expect(Object.fromEntries(Object.keys(sizes).map((k) => [k, count(`C9.${k}`)]))).toEqual(sizes);
    expect(sizes.bloodGroup).toBeGreaterThan(0); // A-05 and A-08 have no blood group
  });

  it("E1 equals the patient page's own read of each current plan", async () => {
    const want = { noPlan: 0, onHold: 0, overdue: 0, onTrack: 0, missedVisits: 0 };
    const overdueKeys = new Map();
    for (const id of active) {
      const { plan } = await syncPlan({ tenantId: fx.hospitals.h1._id, now: NOW }, id); // what the patient page reads
      if (!plan) {
        want.noPlan += 1;
        continue;
      }
      const st = planStatuses(plan, hospitalToday(NOW));
      const overdue = plan.items.filter((it) => st.get(it).status === 'overdue');
      if (plan.items.some((it) => st.get(it).status === 'missed')) want.missedVisits += 1;
      if (plan.status === 'paused' || plan.eddReview) want.onHold += 1;
      else if (plan.status === 'active' && overdue.length) {
        want.overdue += 1;
        for (const it of new Set(overdue.filter((x) => x.origin === 'template'))) {
          if (!overdueKeys.has(it.key)) overdueKeys.set(it.key, { name: it.name, ids: new Set() });
          overdueKeys.get(it.key).ids.add(id);
        }
      } else want.onTrack += 1;
    }
    expect(Object.fromEntries(Object.keys(want).map((k) => [k, count(`E1.${k}`)]))).toEqual(want);
    expect(want.noPlan).toBe(1); // A-08 has no dates
    expect(want.overdue).toBeGreaterThan(0);
    const top = [...overdueKeys.entries()].sort((a, b) => b[1].ids.size - a[1].ids.size || a[0].localeCompare(b[0])).slice(0, 8);
    const rows = cellsOf(metricById('E1'), ctx).filter((c) => c.group === 'overdueItems');
    expect(rows.map((c) => [c.label, count(`E1.${c.key}`)])).toEqual(top.map(([, r]) => [r.name, r.ids.size]));
    // Reading through the page changed nothing Analytics shows.
    const again = await computeFor(fx.users.drB, ['doctor'], ['care']);
    for (const k of Object.keys(want)) expect(countOf(again.ctx.results.get('E1').cells[k]), k).toBe(want[k]);
  });
});

describe('E4 done by the due date (hospital H3)', () => {
  it('each booking test lands in its own outcome', async () => {
    const plan = await CarePlan.findOne({ tenantId: fx.hospitals.h3._id, patientId: fx.ids['H3-1'], current: true }).lean();
    const from = parsePeriod({ period: '12m' }, { audience: 'doctor', today: hospitalToday(NOW) }).from;
    for (const k of ['lab_cbc', 'lab_hiv', 'lab_vdrl', 'lab_hbsag']) {
      const it = plan.items.find((x) => x.key === k);
      expect(it.auto.dueBy < hospitalToday(NOW), k).toBe(true);
      expect(it.auto.dueBy >= from, k).toBe(true);
    }
    expect(isoDay(plan.items.find((x) => x.key === 'lab_hiv').done.on)).toBe(day(-127));
    const p = await payload('drH3', 'care');
    const v = values(card(p, 'E4'));
    const row = (k) => nonZero(Object.fromEntries(['onTime', 'late', 'notNeeded', 'notDone'].map((c) => [c, v[`r:${k}|c:${c}`]])));
    expect(row('lab_cbc')).toEqual({ onTime: 1 });
    expect(row('lab_hiv')).toEqual({ late: 1 });
    expect(row('lab_vdrl')).toEqual({ notNeeded: 1 });
    expect(row('lab_hbsag')).toEqual({ notDone: 1 });
    const e4 = card(p, 'E4');
    expect(e4.table.rows.find((r) => r.key === 'lab_hiv').label).toBe('HIV test (with counselling)');
    expect(e4.cells.find((c) => c.key === 'r:lab_hbsag|c:notDone')).toMatchObject({ list: true, value: 1 });
    expect(e4.cells.find((c) => c.key === 'r:lab_cbc|c:onTime').list).toBe(false);
    expect(e4.cells.find((c) => c.key === 'r:visits|c:notDone').list).toBe(false); // visits: the unit is items
    // H3's numbers are its own: Dr B's hospital is unchanged by them, and H3 has one active pregnancy.
    expect(values(card(p, 'E1')).total).toBe(1);
  });
});

describe('E4 on a paused plan (M-01: type of care changed to postnatal on T − 45)', () => {
  it('her open items due between the start of the period and the pause day count as not done; later ones are left out', async () => {
    const tid = fx.hospitals.h1._id;
    const id = fx.ids['M-01'];
    const stored = await CarePlan.findOne({ tenantId: tid, patientId: id, current: true }).lean();
    expect(stored.status).toBe('paused');
    expect(isoDay(toHospitalDate(stored.log.findLast((l) => l.action === 'paused').at))).toBe(day(-45));
    const { ctx } = await computeFor(fx.users.drB, ['doctor'], ['care']);
    const cells = ctx.results.get('E4').cells;
    const single = new Set(cellsOf(metricById('E4'), ctx).filter((c) => c.list).map((c) => c.key.split('|')[0].slice(2)));
    const { plan } = currentPlansNow(ctx).get(id);
    const from = ctx.period.from;
    const pausedOn = new Date(`${day(-45)}T00:00:00Z`);
    let counted = 0;
    for (const it of plan.items) {
      if (!single.has(it.key) || it.state !== 'open' || it.auto?.applies === 'no') continue;
      if (!it.manualDate && ['lapsed', 'covered'].includes(it.auto.lateStart)) continue;
      const dueBy = new Date(`${isoDay(it.auto.dueBy)}T00:00:00Z`);
      if (dueBy < from) continue;
      if (dueBy <= pausedOn) {
        expect(cells[`r:${it.key}|c:notDone`].has(id), it.key).toBe(true);
        counted += 1;
      } else {
        expect(cells[`r:${it.key}|c:total`].has(id), it.key).toBe(false);
      }
    }
    expect(counted).toBeGreaterThan(0); // before this fix every one of these was dropped
  });
});

describe('plans: previewSync', () => {
  it('on a lean copy gives what syncing and reading gives, for paused, EDD-review and re-dated plans; saves and logs nothing', async () => {
    const h = await createTenant('Analytics Sample Hospital Five');
    const doc = await createUser({ name: 'Dr H5 Sample' });
    try {
      await addMember(doc, h, 'doctor');
      const s = await loginAs(doc, { app: fx.app });
      const ids = {};
      for (const k of ['paused', 'review', 'redated']) {
        const res = await s.post('/api/patients').send({ careType: 'antenatal', fullName: `Sample H5 ${k}`, phone: '', address: '', ageYears: 28, assignedDoctor: String(doc._id), pregnancy: { scanEdd: day(90) } });
        expect(res.status).toBe(201);
        ids[k] = res.body.patient.id;
      }
      // Changes saved behind the plan's back (as if the plan had not been read since).
      const tid = h._id;
      await Patient.updateOne({ tenantId: tid, _id: ids.paused }, { $set: { careType: 'postnatal' } });
      const move = (days) => ({ $set: { 'pregnancy.scanEdd': new Date(`${day(90 + days)}T00:00:00Z`), 'pregnancy.effectiveEdd': new Date(`${day(90 + days)}T00:00:00Z`) } });
      await Patient.updateOne({ tenantId: tid, _id: ids.review }, move(70));
      await Patient.updateOne({ tenantId: tid, _id: ids.redated }, move(10));

      const T = hospitalToday(NOW);
      const statusByKey = (plan) => Object.fromEntries(plan.items.map((it) => [it.key, planStatuses(plan, T).get(it).status]));
      for (const [k, id] of Object.entries(ids)) {
        const plan = await CarePlan.findOne({ tenantId: tid, patientId: id, current: true }).select('-log').lean();
        const patient = await Patient.findOne({ tenantId: tid, _id: id }).lean();
        const stored = JSON.stringify(plan);
        const audits = await AuditLog.countDocuments({});
        const preview = previewSync(plan, patient, NOW);
        expect(JSON.stringify(plan), `${k}: the plan passed in is unchanged`).toBe(stored);
        expect(preview.log, k).toBeUndefined();
        const inDb = await CarePlan.findOne({ tenantId: tid, _id: plan._id }).lean();
        expect(inDb.updatedAt.getTime(), `${k}: nothing saved`).toBe(plan.updatedAt.getTime());
        expect(await AuditLog.countDocuments({}), `${k}: nothing logged`).toBe(audits);

        const { plan: synced } = await syncPlan({ tenantId: tid, now: NOW }, id);
        expect(pick(preview, ['status']), k).toEqual(pick(synced.toObject(), ['status']));
        expect(Boolean(preview.eddReview), k).toBe(Boolean(synced.eddReview));
        expect(isoDay(preview.basis.edd), k).toBe(isoDay(synced.basis.edd));
        expect(statusByKey(preview), k).toEqual(statusByKey(synced));
      }
      const after = await CarePlan.findOne({ tenantId: tid, patientId: ids.paused, current: true }).lean();
      expect(after.status).toBe('paused');
      expect((await CarePlan.findOne({ tenantId: tid, patientId: ids.review, current: true }).lean()).eddReview).not.toBeNull();
    } finally {
      // Keep the shared fixture at exactly H1–H4 (section 6.1): Step 2's hospital=all totals (section 6.4) and the
      // hospital picker must not see this hospital. Audit entries are append-only (the model blocks deletes); they
      // hold ids only and no analytics number reads them.
      for (const c of Object.values(mongoose.connection.collections)) {
        if (c.collectionName !== AuditLog.collection.collectionName) await c.deleteMany({ tenantId: h._id });
      }
      await Tenant.deleteOne({ _id: h._id });
      await User.deleteOne({ _id: doc._id });
    }
    expect(await Tenant.countDocuments({ isActive: true })).toBe(3); // H1, H2, H3 of the fixture only
  });
});

// ---------- Access (section 6.3) ----------

describe('access', () => {
  it('doctors and hospital admins get the page; other roles and the super admin do not', async () => {
    expect((await section('drA', 'overview')).status).toBe(200);
    const docAdmin = await payload('docAdmin', 'overview');
    expect(docAdmin.audience).toBe('doctor');
    const admin = await payload('admin', 'overview', { period: 'last_12m' });
    expect(admin.audience).toBe('admin');
    expect(admin.period.label).toBe('1 Oct 2025 – 30 Sep 2026');
    for (const who of ['rmo', 'nurse', 'reception', 'lab']) {
      const res = await section(who, 'overview');
      expect(res.status, who).toBe(403);
      expect(res.body.error).toEqual({ message: NO_ACCESS_MESSAGE, code: 'FORBIDDEN' });
    }
    const sa = await section('superAdmin', 'overview');
    expect(sa.status).toBe(403);
    expect(sa.body.error.code).toBe('NO_TENANT');
  });

  it('unknown page: 404', async () => {
    const res = await section('drA', 'registers');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("This analytics page doesn't exist.");
  });

  it('bad requests', async () => {
    const mine = await section('admin', 'overview', { scope: 'mine' });
    expect(mine.status).toBe(400);
    expect(mine.body.error.message).toBe('“My patients only” is for doctors.');
    for (const period of ['12m', 'this_month', 'custom']) {
      const res = await section('admin', 'overview', { period });
      expect(res.status, period).toBe(400);
      expect(res.body.error).toEqual({ message: 'Hospital admins can choose last month or the last 3, 6 or 12 complete months.', code: 'BAD_PERIOD' });
    }
    const doctorMessage = { message: 'Choose a period of up to 24 months, ending today or earlier.', code: 'BAD_PERIOD' };
    expect((await section('drA', 'overview', { period: 'last_12m' })).body.error).toEqual(doctorMessage);
    expect((await section('drA', 'overview', { period: 'custom', from: '2024-09-15', to: '2026-10-15' })).body.error).toEqual(doctorMessage); // 25 months
    expect((await section('drA', 'overview', { period: 'custom', from: '2026-09-01', to: '2026-10-16' })).body.error).toEqual(doctorMessage); // after T
    const ok = await section('drA', 'overview', { period: 'custom', from: '2026-09-01', to: '2026-10-15' });
    expect(ok.status).toBe(200);
    expect(ok.body.period.buckets[0].key).toBe('w:2026-08-31'); // 45 days: weekly columns
    expect((await section('drA', 'overview', { scope: 'everyone' })).status).toBe(400);
    expect((await section('drA', 'overview', { careType: 'mtp' })).status).toBe(400);
  });

  it('doctors count only patients whose clinical details they may see', async () => {
    for (const [who, scope] of [
      ['drA', 'hospital'],
      ['drA', 'mine'],
      ['docAdmin', 'hospital'],
    ]) {
      const roles = who === 'docAdmin' ? ['doctor', 'admin'] : ['doctor'];
      const { ctx, cards, req } = await computeFor(fx.users[who], roles, ALL_SECTIONS, { scope });
      const full = new Map((await Patient.find({ tenantId: fx.hospitals.h1._id })).map((p) => [String(p._id), p]));
      let checked = 0;
      for (const id of cards) {
        for (const [key, raw] of Object.entries(ctx.results.get(id).cells)) {
          if (!(raw instanceof Set)) continue;
          for (const entry of raw) {
            // A delivery or a baby (Deliveries tab) is its mother's entry: '<mother id>|…' (facts.js unitKey).
            const pid = patientOfUnit(entry);
            expect(patientAccess(req, full.get(pid)).view.has('pregnancy'), `${id}.${key} holds ${entry}`).toBe(true);
            checked += 1;
          }
        }
      }
      expect(checked).toBeGreaterThan(20);
      if (who === 'drA') {
        const all = new Set(cards.flatMap((id) => Object.values(ctx.results.get(id).cells).flatMap((v) => (v instanceof Set ? [...v].map(patientOfUnit) : []))));
        expect(all.has(fx.ids['A-03'])).toBe(false);
        expect(all.has(fx.ids['I-01'])).toBe(false);
      }
    }
  });

  it('tenant isolation', async () => {
    const h2 = await payload('drH2', 'pregnancy');
    expect(values(card(h2, 'A2')).total).toBe(2);
    expect(h2.leftOut).toBe(0);
    const h2o = await payload('drH2', 'overview');
    expect(values(card(h2o, 'A1')).total).toBe(3);
    // Dr A with another hospital's id in the header.
    const s = await fx.as('drA');
    const res = await s.agent.get('/api/analytics/sections/overview').set('X-Tenant-Id', String(fx.hospitals.h2._id));
    expect(res.status).toBe(409);
    // loadHospital refuses a hospital id that is not an ObjectId (an aggregate would silently match nothing).
    await expect(loadHospital(String(fx.hospitals.h1._id), { today: hospitalToday(NOW), needs: ['patients'] })).rejects.toThrow(/ObjectId/);
    expect(fx.hospitals.h1._id).toBeInstanceOf(mongoose.Types.ObjectId);
  });
});

// ---------- Hospital admins: small numbers protected (section 6.5) ----------

describe('admin', () => {
  // Every admin page of H1: the five sections under the four periods, and Overview under each type of care.
  let pages;
  let graph;
  beforeAll(async () => {
    resetAdminViewCache();
    pages = [];
    for (const period of ADMIN_PERIOD_KEYS) {
      for (const name of ALL_SECTIONS) pages.push({ section: name, period, careType: 'all', body: await payload('admin', name, { period }) });
      for (const careType of CARE_TYPES) pages.push({ section: 'overview', period, careType, body: await payload('admin', 'overview', { period, careType }) });
    }
    // The graph the pages were cut from (the 10-minute cache): only used to name each number sent.
    graph = await adminGraphFor(fx.hospitals.h1._id, { now: new Date(), today: hospitalToday(new Date()) });
  });

  /** Every number sent on every page, with the graph's name of it: [{ where, id, value }]. */
  function sentNumbers() {
    const out = [];
    for (const pg of pages) {
      const view = graph.views.get(`${pg.period}|all`);
      const filtered = pg.careType === 'all' ? null : graph.views.get(`${pg.period}|${pg.careType}`);
      const entries = view.cards.filter((c) => c.section === pg.section).map((c) => filtered?.cards.find((f) => f.id === c.id) ?? c);
      expect(pg.body.cards.map((c) => c.id)).toEqual(entries.map((e) => e.id));
      pg.body.cards.forEach((c, i) => {
        const e = entries[i];
        const where = `${pg.section} ${pg.period} ${pg.careType} ${c.id}`;
        if (c.total) out.push({ where: `${where}.${c.total.key}`, id: e.ids.total, value: c.total.value });
        // By key: rows ranked by count (E1) reach admins in another order than the card's own.
        const idOfKey = new Map(e.json.cells.map((y, j) => [y.key, e.ids.cells[j]]));
        expect(c.cells.map((x) => x.key).sort()).toEqual([...idOfKey.keys()].sort());
        c.cells.forEach((x) => out.push({ where: `${where}.${x.key}`, id: idOfKey.get(x.key), value: x.value }));
      });
      (pg.body.tiles ?? []).forEach((t, i) => out.push({ where: `${pg.period} ${pg.careType} tile ${t.ref}`, id: view.tiles[i].id, value: t.value }));
    }
    return out;
  }

  it('every page: whole hospital, whole finished months, no lists, the note about small numbers', () => {
    expect(new Date(pages[0].body.calculatedAt).getTime()).toBe(graph.calculatedAt.getTime());
    for (const { body, period, section } of pages) {
      expect(body.audience).toBe('admin');
      expect(body.scope).toBe('hospital');
      expect(body.section).toBe(section);
      expect(body.period.key).toBe(period);
      expect(body.leftOut).toBeNull();
      expect(body.masking).toEqual({ note: MASKING_NOTE });
      expect(body.period.buckets.every((b) => b.key.startsWith('m:') && !b.partial)).toBe(true);
      expect(body.cards.length).toBeGreaterThan(0);
      for (const c of body.cards) {
        for (const x of [c.total, ...c.cells].filter(Boolean)) expect(x.list, `${c.id}.${x.key}`).toBe(false);
      }
      for (const t of body.tiles ?? []) expect(t.list).toBe(false);
      // Sex words only on the Newborn page, inside card G2 (section 3.7).
      const others = section === 'newborn' ? { ...body, cards: body.cards.filter((c) => c.id !== 'G2') } : body;
      expect(mentionsFetalSex(JSON.stringify(others)), `${section} ${period}`).toBe(false);
    }
    expect(pages.find((p) => p.section === 'overview' && p.period === 'last_12m' && p.careType === 'all').body.period.label).toBe('1 Oct 2025 – 30 Sep 2026');
  });

  it('no number from 1 to 4 is sent', () => {
    const numbers = sentNumbers();
    expect(numbers.length).toBeGreaterThan(500);
    for (const n of numbers) {
      if (typeof n.value === 'number') expect(n.value === 0 || n.value >= 5, `${n.where} = ${n.value}`).toBe(true);
      else expect([null, 'lt5', 'hidden', 'withheld'], n.where).toContain(n.value?.masked ?? null);
    }
    // Small numbers really occur in this small hospital, and some others are hidden to protect them.
    expect(numbers.some((n) => n.value?.masked === 'lt5')).toBe(true);
    expect(numbers.some((n) => n.value?.masked === 'hidden')).toBe(true);
  });

  it('the same number is shown the same way on every page and under every period', () => {
    const seen = new Map();
    for (const n of sentNumbers()) {
      const v = JSON.stringify(n.value);
      if (seen.has(n.id)) expect(v, `${n.id}: ${n.where} vs ${seen.get(n.id).where}`).toBe(seen.get(n.id).v);
      else seen.set(n.id, { v, where: n.where });
    }
    // A month column is one number under every period (September is in all four).
    const sep = new Set(sentNumbers().filter((n) => n.id === 'A1.b:m:2026-09').map((n) => n.where.split(' ')[1]));
    expect([...sep].sort()).toEqual([...ADMIN_PERIOD_KEYS].sort());
  });

  it('no small number can be worked out from what was sent (the range check, run on the pages)', () => {
    const known = new Map();
    for (const n of sentNumbers()) known.set(n.id, n.value);
    const ranges = rangeCheck(known, graph.relations);
    // What a reader works out always holds the true number (the check is sound) …
    for (const [id, c] of graph.cells) {
      const r = ranges.get(id);
      if (r && c.value != null) expect(r.lo <= c.value && c.value <= r.hi, `${id} = ${c.value}, worked out as [${r.lo}, ${r.hi}]`).toBe(true);
    }
    // … and never pins down a number from 1 to 4: shown as "fewer than 5", withheld, or never shown.
    let checked = 0;
    for (const [id, c] of graph.cells) {
      const sent = known.get(id);
      const small = c.value >= 1 && c.value <= 4;
      if (!small || (c.shown && !sent?.masked)) continue;
      const r = ranges.get(id);
      if (!r) continue; // in no sum: nothing can be worked out about it
      expect(r.lo < r.hi, `${id} (${sent?.masked ?? 'never shown'}) can be worked out: ${r.lo}`).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
    // A second, independent reader (the sums solved modulo two primes, then ranges through the solved equations).
    const atLeastOne = new Set([...graph.cells].filter(([, c]) => c.atLeastOne).map(([id]) => id));
    const other = readerPins(graph.cells, graph.relations, known, { sensitive: graph.masking.sensitive, atLeastOne });
    expect(other.wrong).toEqual([]);
    expect(other.pinned).toEqual([]);
  });

  it('the worked example: active pregnancies by trimester (1, 2, 5, 0, 1 of 9)', () => {
    const a2 = card(pages.find((p) => p.section === 'pregnancy' && p.period === 'last_12m').body, 'A2');
    const v = values(a2);
    expect(v.t1).toEqual({ masked: 'lt5' });
    expect(v.t2).toEqual({ masked: 'lt5' });
    expect(v.noEdd).toEqual({ masked: 'lt5' });
    expect(v.check).toBe(0);
    expect(a2.allMasked).toBe(false);
  });

  it('exact numbers are the whole hospital’s (Dr B sees every record; the same 12 months)', async () => {
    let compared = 0;
    for (const name of ALL_SECTIONS) {
      const admin = pages.find((p) => p.section === name && p.period === 'last_12m' && p.careType === 'all').body;
      const drB = await payload('drB', name, { period: 'custom', from: '2025-10-01', to: '2026-09-30' });
      for (const c of admin.cards) {
        const d = values(card(drB, c.id));
        for (const [k, v] of Object.entries(values(c))) {
          if (typeof v !== 'number' || !(k in d)) continue;
          expect(v, `${name} ${c.id}.${k}`).toBe(d[k]);
          compared += 1;
        }
      }
      for (const t of admin.tiles ?? []) {
        if (typeof t.value !== 'number') continue;
        expect(t.value, t.ref).toBe(drB.tiles.find((x) => x.ref === t.ref).value);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('a ratio or a median only from exact numbers', () => {
    for (const { body, section } of pages) {
      if (section !== 'newborn') continue;
      const g2 = values(card(body, 'G2'));
      const ratio = card(body, 'G2').extras.ratio;
      if (typeof g2.girls !== 'number' || typeof g2.boys !== 'number') expect(ratio).toBeUndefined();
      else expect(ratio.value).toBe(g2.boys ? Math.round((g2.girls / g2.boys) * 1000) : null);
      const g3 = card(body, 'G3');
      const weighed = values(g3).weighed;
      if (typeof weighed !== 'number' || weighed < 5) expect(g3.extras.median, body.period.key).toBeUndefined();
      else expect(g3.extras.median.n).toBe(weighed);
      // The number of babies is never written in a note for admins, and the few-births line comes only with a ratio.
      for (const n of card(body, 'G2').notes) expect(n).not.toMatch(/Based on/);
      expect(card(body, 'G2').notes.includes(FEW_BIRTHS_NOTE), body.period.key).toBe(ratio?.value != null && ratio.basis < RATIO_NOTE_BELOW);
    }
  });

  it('rows kept for doctors are not there', async () => {
    const template = await CarePlanTemplate.findOne({ tenantId: fx.hospitals.h1._id, careType: 'antenatal', kind: 'standard' }).lean();
    const conditional = template.items.filter((t) => (t.appliesWhen ?? 'always') !== 'always').map((t) => t.key);
    expect(conditional.length).toBeGreaterThan(3);
    for (const { body, section } of pages) {
      const ids = body.cards.map((c) => c.id);
      if (section === 'risk') {
        expect(ids).toEqual(['C1', 'C4', 'D1', 'D3', 'D4', 'D6']);
        expect(card(body, 'C4').cells.some((c) => c.key.startsWith('blood:'))).toBe(false);
        expect(card(body, 'D1').cells.map((c) => c.key)).toEqual(['known', 'unknown']);
        expect(card(body, 'D1').notes).toContain('Condition-by-condition numbers are only for doctors.');
        expect(card(body, 'D3').cells.map((c) => c.key)).toEqual(['high', 'normal']);
        const d4 = card(body, 'D4').cells.map((c) => c.key);
        expect(d4).toContain('modSevere');
        expect(d4).not.toContain('moderate');
        expect(d4).not.toContain('severe');
      }
      if (section === 'deliveries') {
        // Deliveries and postpartum haemorrhage only: births, stillbirths, Apgar, NICU, breastfeeding and deaths are
        // for doctors (the deliveries minus the live births would give the stillbirths away). The note says so.
        expect(ids).toEqual(['H1', 'H2']);
        expect(card(body, 'H1').notes.join(' ')).toMatch(/only for doctors/);
        const labels = body.cards.flatMap((c) => [c.title, c.total?.label, ...c.cells.map((x) => x.label)]).join(' | ');
        expect(labels).not.toMatch(/[Ss]tillbirth|[Dd]eath|Apgar|NICU|[Bb]reastf|[Bb]irth/);
      }
      if (section === 'care') {
        const rows = card(body, 'E4').table.rows.map((r) => r.key);
        for (const k of ['lab_ict1', 'lab_ict28', 'anti_d', ...conditional]) expect(rows, k).not.toContain(k);
        expect(rows).toContain('lab_hiv');
        const e1 = card(body, 'E1').cells.filter((c) => c.group === 'overdueItems').map((c) => c.code);
        for (const k of conditional) expect(e1, k).not.toContain(hashCode(k));
      }
      // Nothing about sex outside card G2, and no patient anywhere.
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/P-\d{6}|fullName|patientIds?|"mrn"/);
      expect(text).not.toMatch(/"[a-f0-9]{24}"/);
    }
  });

  it('deliveries: whole finished months, small numbers in words (one delivery in the last 12 whole months)', () => {
    const d = pages.find((x) => x.section === 'deliveries' && x.period === 'last_12m').body;
    expect(d.period.label).toBe('1 Oct 2025 – 30 Sep 2026');
    expect(card(d, 'H1').total.value).toEqual({ masked: 'lt5' });
    expect(pick(values(card(d, 'H1')), ['normal', 'lscs', 'noMode'])).toEqual({ normal: { masked: 'lt5' }, lscs: 0, noMode: 0 });
    expect(pick(values(card(d, 'H2')), ['yes', 'no', 'notRecorded'])).toEqual({ yes: { masked: 'lt5' }, no: 0, notRecorded: 0 });
  });

  it('a card with nothing left to show says so', () => {
    for (const { body } of pages) {
      for (const c of body.cards) {
        const shown = [c.total, ...c.cells].filter(Boolean);
        expect(c.allMasked, c.id).toBe(shown.length > 0 && shown.every((x) => x.value !== null && typeof x.value === 'object'));
      }
    }
  });

  it('one graph for the whole day: kept for 10 minutes, numbers only', async () => {
    const again = await adminGraphFor(fx.hospitals.h1._id, { now: new Date(), today: hospitalToday(new Date()) });
    expect(again).toBe(graph);
    // What is kept holds no id of a patient.
    const kept = JSON.stringify({ views: [...graph.views.values()], cells: [...graph.cells], relations: graph.relations });
    for (const key of ['A-01', 'A-03', 'B-02', 'I-01']) expect(kept).not.toContain(String(fx.ids[key]));
    resetAdminViewCache();
    const fresh = await adminGraphFor(fx.hospitals.h1._id, { now: new Date(), today: hospitalToday(new Date()) });
    expect(fresh).not.toBe(graph);
    expect([...fresh.masking.values]).toEqual([...graph.masking.values]);
    graph = fresh; // the graph now in the cache
  });

  it('one graph per hospital and hospital date, kept for 10 minutes; risk levels brought up to date before each rebuild', async () => {
    const h1 = fx.hospitals.h1._id;
    const h2 = fx.hospitals.h2._id;
    const MIN = 60_000;
    // Later instants are passed in; the clock itself stays at NOW.
    const when = (ms) => {
      const now = new Date(NOW.getTime() + ms);
      return { now, today: hospitalToday(now) };
    };
    const { refreshDueRisks: realRefresh } = await vi.importActual('../src/careplans/templatesService.js');
    // No risk level is written for a later time: the rest of the file runs at NOW.
    refreshDueRisks.mockClear();
    refreshDueRisks.mockResolvedValue({ checked: 0, changed: 0, skipped: 0 });
    const reads = vi.spyOn(Patient, 'find');
    try {
      // Same hospital, same day, under 10 minutes: from the cache, no refresh.
      expect(await adminGraphFor(h1, when(0))).toBe(graph);
      expect(await adminGraphFor(h1, when(9 * MIN + 59_000))).toBe(graph);
      expect(refreshDueRisks).not.toHaveBeenCalled();

      // After 10 minutes: worked out again, with one refresh, before anything is read.
      const t10 = when(10 * MIN + 1_000);
      const later = await adminGraphFor(h1, t10);
      expect(later).not.toBe(graph);
      expect(refreshDueRisks).toHaveBeenCalledTimes(1);
      expect(refreshDueRisks).toHaveBeenCalledWith(h1, t10.now);
      expect(reads).toHaveBeenCalled();
      expect(refreshDueRisks.mock.invocationCallOrder[0]).toBeLessThan(Math.min(...reads.mock.invocationCallOrder));
      expect(await adminGraphFor(h1, when(11 * MIN))).toBe(later);
      expect(refreshDueRisks).toHaveBeenCalledTimes(1);

      // Per hospital: H2 gets its own graph, and H1's stays kept.
      const other = await adminGraphFor(h2, when(11 * MIN));
      expect(other).not.toBe(later);
      expect(refreshDueRisks).toHaveBeenLastCalledWith(h2, expect.any(Date));
      expect(await adminGraphFor(h1, when(11 * MIN))).toBe(later);

      // Per hospital date: 23:55 in India on 15 Oct, then 00:02 on 16 Oct (7 minutes later): a new graph.
      const lateEvening = when(13 * 60 * MIN + 55 * MIN); // NOW is 10:00 in India
      expect(isoDay(lateEvening.today)).toBe('2026-10-15');
      const evening = await adminGraphFor(h1, lateEvening);
      expect(await adminGraphFor(h1, when(13 * 60 * MIN + 59 * MIN))).toBe(evening);
      const nextDay = when(14 * 60 * MIN + 2 * MIN);
      expect(isoDay(nextDay.today)).toBe('2026-10-16');
      const calls = refreshDueRisks.mock.calls.length;
      expect(await adminGraphFor(h1, nextDay)).not.toBe(evening);
      expect(refreshDueRisks.mock.calls.length).toBe(calls + 1);
    } finally {
      reads.mockRestore();
      refreshDueRisks.mockImplementation(realRefresh);
      resetAdminViewCache(); // later tests at NOW start clean
    }
  }, 60_000);

  it('doctor pages are never masked', async () => {
    for (const name of ALL_SECTIONS) {
      const p = await payload('drA', name);
      expect(p.masking).toBeNull();
      for (const c of p.cards) {
        expect(c.allMasked).toBe(false);
        for (const x of [c.total, ...c.cells].filter(Boolean)) expect(x.value === null || typeof x.value === 'number', `${c.id}.${x.key}`).toBe(true);
      }
    }
  });
});

// ---------- Patient lists (section 3.6; access and contents in 6.3) ----------

describe('lists', () => {
  const NOT_LISTABLE = { message: "This number can't be opened as a list.", code: 'NOT_LISTABLE' };

  it('only doctors open patient lists', async () => {
    const q = { metric: 'A2', cell: 'c0' };
    expect((await list('drA', q)).status).toBe(200);
    const docAdmin = await listBody('docAdmin', q);
    expect(docAdmin.count).toBe(8); // Dr A's numbers: a doctor who is also admin gets the doctor view
    const admin = await list('admin', q);
    expect(admin.status).toBe(403);
    expect(admin.body.error).toEqual({ message: 'Patient lists are only for doctors.', code: 'FORBIDDEN' });
    for (const who of ['rmo', 'nurse', 'reception', 'lab']) {
      const res = await list(who, q);
      expect(res.status, who).toBe(403);
      expect(res.body.error).toEqual({ message: NO_ACCESS_MESSAGE, code: 'FORBIDDEN' });
    }
    expect((await list('superAdmin', q)).status).toBe(403); // no hospital
  });

  it('the row whitelist in the code is exactly the one in the build contract', () => {
    expect([...LIST_ROW_KEYS].sort()).toEqual([...SPEC_LIST_ROW_KEYS].sort());
  });

  it('a number that opens no list: 400', async () => {
    for (const q of [
      { metric: 'ZZ', cell: 'c0' }, // unknown card
      { metric: 'G2', cell: 'c1' }, // sex at birth: never a list
      { metric: 'A4', cell: 'c0' }, // visits, not patients
      { metric: 'B4', cell: 'c1' },
      { metric: 'A2', cell: 'c99' }, // unknown cell
      { metric: 'D10', cell: 'c2' }, // "first visit not yet": not listable
      { metric: 'DQ', cell: 'c5' }, // entered in error: visits
      { metric: 'D9', cell: 'c4' }, // the footnote under the bars
      { metric: 'E4', cell: 'bm202610' },
      { metric: 'A2' }, // no cell
      { cell: 'c0' }, // no card
      { metric: 'ABCDEFGHIJ', cell: 'c0' }, // a card id that is too long
      { metric: 'A2', cell: 'c'.repeat(30) }, // a cell code that is too long
    ]) {
      const res = await list('drA', q);
      expect(res.status, JSON.stringify(q)).toBe(400);
      expect(res.body.error, JSON.stringify(q)).toEqual(NOT_LISTABLE);
    }
    // A card with fixed cells is checked before anything is read: no patient is loaded for these.
    const reads = vi.spyOn(Patient, 'find');
    try {
      for (const q of [{ metric: 'A2', cell: 'c99' }, { metric: 'D9', cell: 'c4' }, { metric: 'D10', cell: 'c2' }]) {
        expect((await list('drA', q)).body.error, JSON.stringify(q)).toEqual(NOT_LISTABLE);
      }
      expect(reads).not.toHaveBeenCalled();
    } finally {
      reads.mockRestore();
    }
    // A card or cell given twice is not a listable number either.
    const twice = await (await fx.as('drA')).get('/api/analytics/list?metric=A2&cell=c0&cell=c3');
    expect(twice.status).toBe(400);
    expect(twice.body.error).toEqual(NOT_LISTABLE);
    // Under a type-of-care filter the other types are not on the card, so they open nothing.
    expect((await list('drA', { metric: 'A1', cell: 'c1', careType: 'postnatal' })).body.error).toEqual(NOT_LISTABLE);
    expect((await listBody('drA', { metric: 'A1', cell: 'c2', careType: 'postnatal' })).count).toBe(1);
    // The same filter rules as the page.
    expect((await list('drA', { metric: 'A2', cell: 'c0', period: 'last_12m' })).status).toBe(400);
    expect((await list('drA', { metric: 'A2', cell: 'c0', scope: 'everyone' })).status).toBe(400);
    expect((await list('drA', { metric: 'A2', cell: 'c0', limit: '101' })).status).toBe(400);
    // A listable cell with nothing in it: an empty list.
    const empty = await listBody('drA', { metric: 'A2', cell: 'c4' });
    expect(pick(empty, ['count', 'total', 'restricted', 'totalPages'])).toEqual({ count: 0, total: 0, restricted: 0, totalPages: 1 });
    expect(empty.patients).toEqual([]);
  });

  it('every listable number, whole hospital and my patients: the list count is the number, nobody restricted', async () => {
    let checked = 0;
    for (const scope of ['hospital', 'mine']) {
      const { ctx } = await computeFor(fx.users.drA, ['doctor'], ALL_SECTIONS, { scope });
      for (const name of ALL_SECTIONS) {
        const p = await payload('drA', name, { scope });
        const targets = [];
        for (const c of p.cards) {
          const m = metricById(c.id);
          for (const cell of [...(c.total ? [c.total] : []), ...c.cells]) {
            const def = cell.code ? cellByCode(m, cell.code, ctx) : null;
            if (!def) {
              expect(cell.list, `${c.id}.${cell.key} says list but opens none`).toBe(false);
              continue;
            }
            expect(def.key, `${c.id} ${cell.code}`).toBe(cell.key);
            expect(cell.list, `${c.id}.${cell.key}`).toBe(cell.value > 0);
            targets.push({ metric: c.id, cell: cell.code, value: cell.value, where: `${scope} ${c.id}.${cell.key}` });
          }
        }
        for (const t of p.tiles ?? []) if (t.list) targets.push({ metric: t.metric, cell: t.cell, value: t.value, where: `${scope} tile ${t.ref}` });
        for (const t of targets) {
          const body = await listBody('drA', { metric: t.metric, cell: t.cell, scope, limit: '100' });
          expect(body.count, t.where).toBe(t.value);
          expect(body.total + body.restricted, t.where).toBe(body.count);
          expect(body.restricted, t.where).toBe(0);
          expect(body.patients, t.where).toHaveLength(body.total);
          expect(body.scope).toBe(scope);
          // Contents: only the whitelist, never a sex, newborn, override, notes, medical or obstetric key.
          for (const row of body.patients) expect(Object.keys(row).every((k) => SPEC_LIST_ROW_KEYS.includes(k)), t.where).toBe(true);
          const keys = keysDeep(body);
          for (const k of ['newborn', 'sex', 'override', 'notes', 'medical', 'obstetric', 'pregnancy', 'risk']) expect(keys.has(k), `${t.where} has ${k}`).toBe(false);
          if (name !== 'newborn') expect(mentionsFetalSex(JSON.stringify(body)), t.where).toBe(false);
          // Dr A never gets a patient whose clinical details she may not see.
          expect(body.patients.some((r) => [fx.ids['A-03'], fx.ids['I-01']].includes(r.id)), t.where).toBe(false);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  }, 180_000);

  it('named lists (Dr A and Dr B)', async () => {
    const t3 = await listBody('drA', { metric: 'A2', cell: 'c3' });
    expect(pick(t3, ['metric', 'cell', 'section', 'title', 'cellLabel', 'window', 'periodLabel', 'scope', 'detailLabel', 'count', 'total', 'restricted'])).toEqual({
      metric: 'A2',
      cell: 'c3',
      section: 'pregnancy',
      title: 'Active pregnancies by trimester',
      cellLabel: 'Third trimester',
      window: 'now',
      periodLabel: null,
      scope: 'hospital',
      detailLabel: 'Gestation today',
      count: 4,
      total: 4,
      restricted: 0,
    });
    // Furthest along first: A-06 (EDD T−16), A-05 (T−3), A-10 (T+3), A-04 (T+10).
    expect(t3.patients.map((r) => r.id)).toEqual(['A-06', 'A-05', 'A-10', 'A-04'].map((k) => fx.ids[k]));
    expect(t3.patients.every((r) => /^P-\d{6}$/.test(r.mrn))).toBe(true);
    expect(t3.patients[0].detail).toEqual({ type: 'ga', weeks: 42, days: 2 });
    expect(t3.patients[0].gestationalAge).toEqual({ weeks: 42, days: 2 });
    const a04 = t3.patients.find((r) => r.id === fx.ids['A-04']);
    expect(a04).toMatchObject({ fullName: 'Sample A-04', careType: 'antenatal', currentAge: 31, assignedDoctorName: 'Dr B Sample', sensitive: false, edd: day(10) });
    expect(a04.access.level).toBe('read_only'); // Dr B's patient: Dr A may read, not change

    expect((await listBody('drA', { metric: 'D1', cell: `c${CONDITIONS.indexOf('hiv') + 1}` })).count).toBe(0);
    const hiv = await listBody('drB', { metric: 'D1', cell: `c${CONDITIONS.indexOf('hiv') + 1}` });
    expect(hiv.count).toBe(1);
    expect(hiv.patients.map((r) => r.id)).toEqual([fx.ids['A-03']]);
    expect(hiv.patients[0].sensitive).toBe(true);

    const infertility = await listBody('drA', { metric: 'A1', cell: 'c3' });
    expect(infertility.count).toBe(1);
    expect(infertility.patients[0].id).toBe(fx.ids['I-02']);
    expect(infertility.periodLabel).toBe('1 Nov 2025 – 15 Oct 2026');

    // Lowest Hb first, with the reading and its date.
    const hb = await listBody('drB', { metric: 'D4', cell: 'c0' });
    expect(hb.patients.map((r) => r.detail.value)).toEqual([...hb.patients.map((r) => r.detail.value)].sort((a, b) => a - b));
    expect(hb.patients[0]).toMatchObject({ id: fx.ids['A-04'], detail: { type: 'hb', value: 6.8, on: day(-3) } });

    // A shared number lists its source card's patients: "no EDD" on Records to tidy up is A2's.
    const noEdd = await listBody('drA', { metric: 'DQ', cell: 'c3' });
    expect(noEdd).toMatchObject({ section: 'overview', title: 'Records to tidy up', cellLabel: 'Antenatal records with no EDD', count: 1 });
    expect(noEdd.patients.map((r) => r.id)).toEqual([fx.ids['A-08']]);

    // Babies: the date of birth, never anything else from the newborn details.
    const babies = await listBody('drB', { metric: 'G1', cell: 'c0' });
    expect(babies.count).toBe(5);
    expect(babies.patients[0]).toMatchObject({ id: fx.ids['B-05'], careType: 'newborn', bornOn: '2026-10-01' }); // newest first
    expect(babies.patients.every((r) => r.gestationalAge === null && r.edd === null)).toBe(true);
  });

  it('pages: every patient once, in one order', async () => {
    const all = await listBody('drB', { metric: 'A2', cell: 'c0', limit: '100' });
    expect(all.count).toBe(9);
    const seen = [];
    for (const page of [1, 2, 3]) {
      const body = await listBody('drB', { metric: 'A2', cell: 'c0', limit: '4', page: String(page) });
      expect(pick(body, ['count', 'page', 'limit', 'totalPages'])).toEqual({ count: 9, page, limit: 4, totalPages: 3 });
      seen.push(...body.patients.map((r) => r.id));
    }
    expect(seen).toEqual(all.patients.map((r) => r.id));
    expect((await listBody('drB', { metric: 'A2', cell: 'c0', limit: '4', page: '4' })).patients).toEqual([]);
  });

  it('my patients only, and another hospital', async () => {
    const mine = await listBody('drA', { metric: 'A2', cell: 'c0', scope: 'mine' });
    expect(mine.patients.map((r) => r.id).sort()).toEqual(['A-01', 'A-02', 'A-06', 'A-08', 'A-10'].map((k) => fx.ids[k]).sort());
    const h2 = await listBody('drH2', { metric: 'A2', cell: 'c0' });
    expect(h2.count).toBe(2);
    for (const r of h2.patients) expect(await Patient.countDocuments({ tenantId: fx.hospitals.h2._id, _id: r.id }), r.id).toBe(1);
    const s = await fx.as('drA');
    const res = await s.agent.get('/api/analytics/list?metric=A2&cell=c0').set('X-Tenant-Id', String(fx.hospitals.h2._id));
    expect(res.status).toBe(409);
  });
});

// ---------- PCPNDT (section 6.6) ----------

describe('pcpndt', () => {
  it('the server refuses newborn details on a mother, a change to or from newborn, and a future birth time', async () => {
    const s = await fx.as('drA');
    const sex = await s.patch(`/api/patients/${fx.ids['A-01']}`).send({ newborn: { sex: 'male' } });
    expect(sex.status).toBe(400);
    expect(sex.body.error.message).toBe("Newborn details can only be added to a newborn's record.");
    const type = await s.patch(`/api/patients/${fx.ids['A-01']}`).send({ careType: 'newborn' });
    expect(type.status).toBe(400);
    const future = await s.patch(`/api/patients/${fx.ids['B-07']}`).send({ newborn: { birthAt: at(2).toISOString() } });
    expect(future.status).toBe(400);
    expect(future.body.error.fields).toEqual({ 'newborn.birthAt': 'Date of birth cannot be in the future' });
  });

  it('no word about sex on any page except the Newborn page', async () => {
    for (const who of ['drA', 'drB']) {
      for (const name of ALL_SECTIONS.filter((x) => x !== 'newborn')) {
        for (const scope of ['hospital', 'mine']) {
          const p = await payload(who, name, { scope });
          expect(mentionsFetalSex(JSON.stringify(p)), `${who} ${name} ${scope}`).toBe(false);
        }
      }
    }
  });

  it('on the Newborn page, sex words appear only inside card G2', async () => {
    for (const who of ['drA', 'drB']) {
      for (const scope of ['hospital', 'mine']) {
        const p = await payload(who, 'newborn', { scope });
        const g2 = card(p, 'G2');
        expect(mentionsFetalSex(JSON.stringify(g2))).toBe(true);
        expect(mentionsFetalSex(JSON.stringify({ ...p, cards: p.cards.filter((c) => c.id !== 'G2') })), `${who} ${scope}`).toBe(false);
        expect(g2.cells.every((c) => c.list === false)).toBe(true); // never a list
        expect(g2.total.list).toBe(false);
      }
    }
  });

  it("a sex value saved on a mother's record, and a baby with a future birth time, are never counted", async () => {
    const raw = await Patient.findOne({ tenantId: fx.hospitals.h1._id, _id: fx.ids['A-01'] }).lean();
    expect(raw.newborn.sex).toBe('male'); // the legacy value is really there
    const p = await payload('drB', 'newborn');
    expect(pick(values(card(p, 'G2')), ['girls', 'boys', 'indeterminate', 'notRecorded', 'total'])).toEqual({ girls: 2, boys: 2, indeterminate: 1, notRecorded: 0, total: 5 });
  });

  it('only metrics/sexAtBirth.js and load.js may mention sex, and only sexAtBirth.js reads its rows', () => {
    const dir = fileURLToPath(new URL('../src/analytics/', import.meta.url));
    const files = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) => !['metrics/sexAtBirth.js', 'load.js'].includes(f) && /\bsex\b/.test(readFileSync(`${dir}${f}`, 'utf8')));
    expect(offenders).toEqual([]);
    const readers = files.filter((f) => /\bg2Rows\b/.test(readFileSync(`${dir}${f}`, 'utf8')));
    expect(readers.sort()).toEqual(['load.js', 'metrics/sexAtBirth.js']);
  });
});

// ---------- Audit (section 6.7, patient lists) ----------

describe('audit: patient lists', () => {
  it('both actions exist; a list is patient record access', () => {
    expect(AUDIT_ACTIONS).toEqual(expect.arrayContaining(['ANALYTICS_VIEWED', 'ANALYTICS_LIST_VIEWED']));
    expect(AUDIT_CATEGORIES.patients).toContain('ANALYTICS_LIST_VIEWED');
    for (const [name, actions] of Object.entries(AUDIT_CATEGORIES)) expect(actions, name).not.toContain('ANALYTICS_VIEWED');
  });

  it('every page served writes the ids on that page, sorted by id, and nothing about the number', async () => {
    const drB = fx.users.drB;
    const entries = () => AuditLog.find({ action: 'ANALYTICS_LIST_VIEWED', actor: drB._id }).sort({ _id: 1 }).lean();
    const before = (await entries()).length;
    const p1 = await listBody('drB', { metric: 'D4', cell: 'c0', limit: '4' }); // lowest Hb first
    const p2 = await listBody('drB', { metric: 'D4', cell: 'c0', limit: '4', page: '2' });
    const after = await entries();
    expect(after).toHaveLength(before + 2);
    const [e1, e2] = after.slice(-2);
    expect(Object.keys(e1.details).sort()).toEqual(['count', 'page', 'patientIds']);
    expect(e1.details).toEqual({ patientIds: p1.patients.map((r) => r.id).sort(), count: 4, page: 1 });
    expect(e2.details).toEqual({ patientIds: p2.patients.map((r) => r.id).sort(), count: p2.patients.length, page: 2 });
    expect(String(e1.tenantId)).toBe(String(fx.hospitals.h1._id));
    // Nothing revealing in any analytics entry: no card id, cell code, label or period.
    const all = await AuditLog.find({ action: { $in: ['ANALYTICS_VIEWED', 'ANALYTICS_LIST_VIEWED'] } }).lean();
    for (const e of all) expect(JSON.stringify(e.details)).not.toMatch(/\b(A2|D4|c0|c3|hiv|trimester|anaemia|Hb|12m|last_12m)\b/i);
  });

  it('only the patients listed are recorded (Dr A never records Dr B’s sensitive records)', async () => {
    await listBody('drA', { metric: 'A2', cell: 'c0', limit: '100' });
    const e = await AuditLog.findOne({ action: 'ANALYTICS_LIST_VIEWED', actor: fx.users.drA._id }).sort({ _id: -1 }).lean();
    expect(e.details.count).toBe(8);
    expect(e.details.patientIds).not.toContain(fx.ids['A-03']);
  });

  it('the hospital admin sees the ids; the super admin never does', async () => {
    const sa = await fx.as('superAdmin');
    const admin = await fx.as('admin');
    await listBody('drA', { metric: 'A2', cell: 'c3' });
    const tenantLog = await admin.get('/api/tenant/audit-logs?action=ANALYTICS_LIST_VIEWED&limit=5');
    expect(tenantLog.status).toBe(200);
    expect(tenantLog.body.entries[0].details).toEqual({ patientIds: expect.any(Array), count: 4, page: 1 });
    expect(tenantLog.body.entries[0].details.patientIds).toHaveLength(4);

    const platformLog = await sa.get('/api/platform/audit-logs?category=patients&limit=100');
    expect(platformLog.status).toBe(200);
    const stats = await sa.get('/api/platform/stats');
    expect(stats.status).toBe(200);
    const fromLog = platformLog.body.entries.filter((e) => e.action === 'ANALYTICS_LIST_VIEWED');
    const fromRecent = stats.body.recentActivity.filter((e) => e.action === 'ANALYTICS_LIST_VIEWED');
    expect(fromLog.length).toBeGreaterThan(0);
    expect(fromRecent.length).toBeGreaterThan(0);
    for (const e of [...fromLog, ...fromRecent]) {
      expect(Object.keys(e.details).every((k) => ['count', 'page'].includes(k))).toBe(true);
      expect(JSON.stringify(e.details)).not.toMatch(/[0-9a-f]{24}/);
    }
    expect(fromRecent[0].details).toEqual({ count: 4, page: 1 });
    const views = (await sa.get('/api/platform/audit-logs?action=ANALYTICS_VIEWED&limit=5')).body.entries;
    expect(views.length).toBeGreaterThan(0);
    for (const e of views) expect(Object.keys(e.details).every((k) => ['section', 'scope', 'hospital'].includes(k))).toBe(true);
  });

  it('a record that can no longer be opened when the page is read is counted, not listed and not recorded', async () => {
    const original = Patient.find;
    let hidden = null;
    // Only the list's own read of the page (`_id: { $in }`) is changed: its first row becomes Dr B's sensitive
    // record in memory (nothing is saved), as if it had been marked sensitive between the two reads.
    const spy = vi.spyOn(Patient, 'find').mockImplementation(function (filter, ...rest) {
      const q = original.call(Patient, filter, ...rest);
      if (!filter?._id?.$in) return q;
      return {
        select: async (fields) => {
          const rows = await q.select(fields);
          hidden = rows[0];
          hidden.sensitive = true;
          hidden.assignedDoctor = fx.users.drB._id;
          return rows;
        },
      };
    });
    let body;
    try {
      body = await listBody('drA', { metric: 'A2', cell: 'c3' });
    } finally {
      spy.mockRestore();
    }
    expect(hidden).not.toBeNull();
    const hiddenId = String(hidden._id);
    expect(pick(body, ['count', 'restricted', 'total'])).toEqual({ count: 4, restricted: 1, total: 3 });
    expect(body.patients.map((p) => p.id)).not.toContain(hiddenId);
    const e = await AuditLog.findOne({ action: 'ANALYTICS_LIST_VIEWED', actor: fx.users.drA._id }).sort({ _id: -1 }).lean();
    expect(e.details).toEqual({ patientIds: body.patients.map((p) => p.id).sort(), count: 3, page: 1 });
    expect(e.details.patientIds).not.toContain(hiddenId);
  });
});

// ---------- Super admin: totals per hospital, numbers only (section 6.4) ----------

describe('platform', () => {
  // Every platform page: the five sections for all hospitals and for each hospital on its own (H4 is inactive),
  // and Overview under a type of care. Period: last 12 whole months, 1 Oct 2025 – 30 Sep 2026.
  const PLATFORM_KEYS_NEVER = ['fullName', 'mrn', 'patientId', 'patientIds', 'birthAt', 'bornOn', 'phone', 'address', 'assignedDoctor', 'assignedDoctorName', 'ageYears', 'list', 'details'];
  let pages; // [{ where, hospital, section, body }]
  let byHospital; // 'h1' → index in hospitals[] of the "all" payloads
  const platformGet = async (path, query = {}) => {
    const qs = new URLSearchParams(query).toString();
    return (await fx.as('superAdmin')).get(`/api/platform/analytics${path}${qs ? `?${qs}` : ''}`);
  };
  const platformPayload = async (name, query = {}) => {
    const res = await platformGet(`/sections/${name}`, query);
    expect(res.status, `${name} ${JSON.stringify(query)}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body;
  };
  const page = (hospital, name) => pages.find((p) => p.hospital === hospital && p.section === name && p.careType === 'all').body;
  const cellOf = (c, key) => (c.total?.key === key ? c.total : c.cells.find((x) => x.key === key));

  beforeAll(async () => {
    // Doctors' pages first: they bring risk levels up to date (the platform never does).
    for (const who of ['drB', 'drH2', 'drH3']) for (const name of ALL_SECTIONS) await payload(who, name, { period: 'custom', from: '2025-10-01', to: '2026-09-30' });
    pages = [];
    for (const hospital of ['all', 'h1', 'h2', 'h3', 'h4']) {
      const id = hospital === 'all' ? 'all' : String(fx.hospitals[hospital]._id);
      for (const name of ALL_SECTIONS) pages.push({ where: `${hospital} ${name}`, hospital, section: name, careType: 'all', body: await platformPayload(name, { hospital: id }) });
    }
    for (const careType of ['postnatal', 'newborn']) {
      pages.push({ where: `all overview ${careType}`, hospital: 'all', section: 'overview', careType, body: await platformPayload('overview', { careType }) });
    }
    const all = page('all', 'overview');
    byHospital = Object.fromEntries(['h1', 'h2', 'h3'].map((h) => [h, all.hospitals.findIndex((x) => x.id === String(fx.hospitals[h]._id))]));
  }, 60_000);

  it('only the super admin; no patient lists at all', async () => {
    expect((await platformGet('/sections/overview')).status).toBe(200);
    for (const who of ['drA', 'admin', 'docAdmin', 'nurse']) {
      const s = await fx.as(who);
      expect((await s.get('/api/platform/analytics/sections/overview')).status, who).toBe(403);
      expect((await s.get('/api/platform/analytics/list?metric=A2&cell=c3')).status, who).toBe(403);
      expect((await s.get('/api/platform/analytics/hospitals')).status, who).toBe(403);
    }
    const list = await platformGet('/list', { metric: 'A2', cell: 'c3' });
    expect(list.status).toBe(404);
    expect(list.body.patients).toBeUndefined();
    const unknown = await platformGet('/sections/registers');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.message).toBe("This analytics page doesn't exist.");
    for (const hospital of [String(new mongoose.Types.ObjectId()), 'h1', '../tenants', 'a'.repeat(25), String(new mongoose.Types.ObjectId()).repeat(2)]) {
      const res = await platformGet('/sections/overview', { hospital });
      expect(res.status, hospital).toBe(404);
      expect(res.body.error.message).toBe('Hospital not found.');
    }
    expect((await platformGet('/sections/overview', { scope: 'mine' })).status).toBe(400);
  });

  it('the hospital picker: every hospital by name, inactive ones marked', async () => {
    const res = await platformGet('/hospitals');
    expect(res.status).toBe(200);
    expect(res.body.hospitals.map((h) => h.name)).toEqual(['Analytics Sample Hospital Four', 'Analytics Sample Hospital One', 'Analytics Sample Hospital Three', 'Analytics Sample Hospital Two']);
    expect(res.body.hospitals.find((h) => h.id === String(fx.hospitals.h4._id)).isActive).toBe(false);
    for (const h of res.body.hospitals) expect(Object.keys(h).sort()).toEqual(['id', 'isActive', 'name']);
  });

  it('whole finished months only, never weeks', async () => {
    const message = { message: 'Choose whole months, up to 24, ending with last month.', code: 'BAD_PERIOD' };
    for (const query of [
      { period: 'this_month' },
      { period: '12m' },
      { period: 'custom', from: '2025-10-01', to: '2026-09-30' },
      { period: 'custom_months', from: '2024-09', to: '2026-09' }, // 25 months
      { period: 'custom_months', from: '2026-01', to: '2026-10' }, // the current month
      { period: 'last_12m', from: '2025-10', to: '2026-09' },
    ]) {
      const res = await platformGet('/sections/overview', query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.body.error).toEqual(message);
    }
    const custom = await platformPayload('newborn', { period: 'custom_months', from: '2024-10', to: '2026-09' }); // 24 months
    expect(custom.period).toMatchObject({ key: 'custom_months', from: '2024-10-01', to: '2026-09-30' });
    expect(custom.period.buckets).toHaveLength(24);
    for (const p of [...pages.map((x) => x.body), custom]) {
      expect(p.period.buckets.every((b) => b.key.startsWith('m:') && !b.partial), p.section).toBe(true);
      for (const c of p.cards) expect(c.cells.some((x) => x.key.startsWith('b:w:')), `${p.section} ${c.id}`).toBe(false);
    }
    const p = page('all', 'overview');
    expect(p.period).toMatchObject({ key: 'last_12m', from: '2025-10-01', to: '2026-09-30', label: '1 Oct 2025 – 30 Sep 2026' });
    expect(pick(p, ['audience', 'scope', 'leftOut', 'masking'])).toEqual({ audience: 'platform', scope: 'platform', leftOut: null, masking: null });
  });

  it('all hospitals: the active ones combined (H1 + H2 + H3), with the numbers of each', () => {
    const p = page('all', 'pregnancy');
    expect(p.hospitals.map((h) => h.id).sort()).toEqual(['h1', 'h2', 'h3'].map((h) => String(fx.hospitals[h]._id)).sort());
    expect(p.hospitals.every((h) => h.isActive)).toBe(true);
    const a2 = card(p, 'A2');
    expect(values(a2)).toEqual({ t1: 1, t2: 4, t3: 6, check: 0, noEdd: 1, total: 12 });
    const at = (c, key, h) => cellOf(c, key).values[byHospital[h]];
    expect([at(a2, 'total', 'h1'), at(a2, 'total', 'h2'), at(a2, 'total', 'h3')]).toEqual([9, 2, 1]);
    for (const c of [a2.total, ...a2.cells]) expect(c.values.reduce((s, v) => s + v, 0), c.key).toBe(c.value);

    const nb = page('all', 'newborn');
    const g1 = card(nb, 'G1');
    expect(g1.total.value).toBe(5);
    expect([at(g1, 'total', 'h1'), at(g1, 'total', 'h2'), at(g1, 'total', 'h3')]).toEqual([4, 1, 0]); // B-05 is in October
    expect(pick(values(card(nb, 'G2')), ['girls', 'boys', 'indeterminate'])).toEqual({ girls: 3, boys: 2, indeterminate: 0 });
    expect(card(nb, 'G2').extras.ratio).toMatchObject({ value: 1500, basis: 5 });
    expect(card(nb, 'G2').notes).toContain(`Based on 5 babies. ${FEW_BIRTHS_NOTE}`);
    const g3 = card(nb, 'G3');
    expect(g3.extras.median).toEqual({ value: 2400, n: 5, values: [null, null, null] }); // each hospital has fewer than 5
    // The tiles are the cards' numbers, per hospital too.
    const o = page('all', 'overview');
    const tile = (ref) => o.tiles.find((t) => t.ref === ref);
    expect(tile('A2.total')).toMatchObject({ value: 12 });
    expect(tile('A2.total').values[byHospital.h1]).toBe(9);
    expect(tile('G1.total').value).toBe(5);
    // Risk levels are as each hospital last checked them.
    expect(card(page('all', 'risk'), 'C1').notes).toContain('Risk levels as last checked in each hospital.');
  });

  it('deliveries: every card for the super admin, numbers only, per hospital and combined', () => {
    const d = page('all', 'deliveries');
    expect(d.cards.map((c) => c.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']);
    const at = (c, key, h) => cellOf(c, key).values[byHospital[h]];
    const h1 = card(d, 'H1');
    expect(h1.total.value).toBe(2); // A-07 in H1 and H2-1 in H2, both in September 2026
    expect([at(h1, 'total', 'h1'), at(h1, 'total', 'h2'), at(h1, 'total', 'h3')]).toEqual([1, 1, 0]);
    expect(pick(values(card(d, 'H3')), ['total', 'live', 'still', 'macerated'])).toEqual({ total: 2, live: 1, still: 1, macerated: 1 });
    expect(pick(values(card(d, 'H7')), ['still', 'newborn', 'early', 'maternal'])).toEqual({ still: 1, newborn: 1, early: 1, maternal: 2 });
    for (const c of d.cards) for (const x of [c.total, ...c.cells].filter(Boolean)) expect('list' in x, `${c.id}.${x.key}`).toBe(false);
  });

  it('an inactive hospital on its own shows its one patient; one hospital has no per-hospital numbers', () => {
    const h4 = page('h4', 'pregnancy');
    expect(h4.hospitals).toEqual([{ id: String(fx.hospitals.h4._id), name: 'Analytics Sample Hospital Four', isActive: false }]);
    expect(values(card(h4, 'A2')).total).toBe(1);
    for (const c of h4.cards) for (const x of [c.total, ...c.cells].filter(Boolean)) expect(x.values, `${c.id}.${x.key}`).toBeNull();
    expect(values(card(page('h1', 'pregnancy'), 'A2'))).toEqual({ t1: 1, t2: 2, t3: 5, check: 0, noEdd: 1, total: 9 });
  });

  it("each hospital's numbers are those of a doctor who sees every record there, for the same whole months", async () => {
    let compared = 0;
    for (const [h, who] of [
      ['h1', 'drB'],
      ['h2', 'drH2'],
      ['h3', 'drH3'],
    ]) {
      for (const name of ALL_SECTIONS) {
        const doc = await payload(who, name, { period: 'custom', from: '2025-10-01', to: '2026-09-30' });
        const plat = page('all', name);
        const one = page(h, name);
        expect(doc.cards.map((c) => c.id), `${h} ${name}`).toEqual(plat.cards.map((c) => c.id));
        for (const dc of doc.cards) {
          const pc = card(plat, dc.id);
          const oc = card(one, dc.id);
          for (const d of [dc.total, ...dc.cells].filter(Boolean)) {
            if (dc.id === 'C2' && d.key === 'other') continue; // the super admin's card has no Other reasons row
            const pcell = cellOf(pc, d.key);
            expect(pcell, `${h} ${dc.id}.${d.key}`).toBeTruthy();
            expect(pcell.values[byHospital[h]], `${h} ${dc.id}.${d.key}`).toBe(d.value);
            expect(cellOf(oc, d.key).value, `${h} alone ${dc.id}.${d.key}`).toBe(d.value);
            compared += 1;
          }
        }
        for (const t of doc.tiles ?? []) expect(plat.tiles.find((x) => x.ref === t.ref).values[byHospital[h]], `${h} tile ${t.ref}`).toBe(t.value);
        if (name === 'newborn') {
          // The ratio of each hospital is its doctor's; the median follows the super admin's rule (5 babies, 50 g).
          expect(card(plat, 'G2').extras.ratio.values[byHospital[h]], `${h} G2 ratio`).toBe(card(doc, 'G2').extras.ratio?.value ?? null);
          const med = card(doc, 'G3').extras.median;
          const n = med?.n ?? 0;
          expect(card(plat, 'G3').extras.median?.values?.[byHospital[h]] ?? null, `${h} G3 median`).toBe(n >= 5 ? Math.round(med.value / 50) * 50 : null);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(300);
    // H1's ratio (1 Oct 2025 – 30 Sep 2026) is its doctor's.
    expect(card(page('all', 'newborn'), 'G2').extras.ratio.values[byHospital.h1]).toBe(card(await payload('drB', 'newborn', { period: 'custom', from: '2025-10-01', to: '2026-09-30' }), 'G2').extras.ratio.value);
  });

  it("all hospitals: each hospital's number is the one on that hospital's own page (0 for a row it does not have), and the combined number is their sum", () => {
    let absent = 0;
    let checked = 0;
    for (const { section: name, body } of pages.filter((x) => x.hospital === 'all' && x.careType === 'all')) {
      for (const c of body.cards) {
        for (const x of [c.total, ...c.cells].filter(Boolean)) {
          expect(x.value, `${name} ${c.id}.${x.key}`).toBe(x.values.reduce((s, v) => s + (v ?? 0), 0));
          for (const h of ['h1', 'h2', 'h3']) {
            const own = cellOf(card(page(h, name), c.id), x.key);
            if (!own && ['C2', 'E1'].includes(c.id)) absent += 1;
            expect(x.values[byHospital[h]], `${name} ${c.id}.${x.key} ${h}`).toBe(own ? own.value : 0);
            checked += 1;
          }
        }
      }
      for (const t of body.tiles ?? []) {
        expect(t.value, `${name} tile ${t.ref}`).toBe(t.values.reduce((s, v) => s + (v ?? 0), 0));
        for (const h of ['h1', 'h2', 'h3']) expect(t.values[byHospital[h]], `tile ${t.ref} ${h}`).toBe(page(h, name).tiles.find((y) => y.ref === t.ref).value);
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(absent).toBeGreaterThan(0); // at least one reason or overdue row that a hospital does not have
  });

  it('C2 for the super admin: every reason, most common first, and never an "Other reasons" row', async () => {
    const withC2 = pages.filter((x) => x.body.cards.some((c) => c.id === 'C2'));
    expect(withC2.map((x) => x.hospital).sort()).toEqual(['all', 'h1', 'h2', 'h3', 'h4']);
    for (const { where, body } of withC2) {
      const c2 = card(body, 'C2');
      expect(c2.cells.some((c) => c.key === 'other'), where).toBe(false);
      const counts = c2.cells.map((c) => c.value);
      for (let i = 1; i < counts.length; i += 1) expect(counts[i], `${where} row ${i}`).toBeLessThanOrEqual(counts[i - 1]);
      expect(c2.notes).toContain('Every reason is listed.');
    }
    // Doctors keep the top 10 and "Other reasons".
    const doc = card(await payload('drB', 'risk'), 'C2');
    expect(doc.cells.at(-1)).toMatchObject({ key: 'other', label: 'Other reasons' });
    expect(doc.notes).not.toContain('Every reason is listed.');
  });

  it('a grand multipara rule that differs between hospitals: the label and notes say so', async () => {
    const filter = (h) => ({ tenantId: fx.hospitals[h]._id, careType: 'antenatal', kind: 'standard' });
    const saved = {};
    for (const h of ['h2', 'h3']) {
      const t = await CarePlanTemplate.findOne(filter(h)).lean();
      expect(t?.riskRules?.some((r) => r.key === 'grand_multipara'), h).toBe(true);
      saved[h] = t.riskRules;
    }
    try {
      expect((await CarePlanTemplate.updateOne({ ...filter('h2'), 'riskRules.key': 'grand_multipara' }, { $set: { 'riskRules.$.value': 5, 'riskRules.$.op': 'gte' } })).modifiedCount).toBe(1);
      expect((await CarePlanTemplate.updateOne(filter('h3'), { $pull: { riskRules: { key: 'grand_multipara' } } })).modifiedCount).toBe(1);
      const p = await platformSection({ section: 'risk', hospital: 'all', periodQuery: {}, now: NOW });
      const c4 = p.cards.find((c) => c.id === 'C4');
      expect(c4.cells.find((c) => c.key === 'preg:grand').label).toBe('Grand multipara (by each hospital’s own number of births)');
      expect(c4.notes).toContain("Analytics Sample Hospital One, Analytics Sample Hospital Two: Grand multipara uses the number of births in the hospital's risk rules.");
      expect(c4.notes).toContain("Analytics Sample Hospital Three: The hospital's risk rules have no grand multipara rule, so 4 or more births is used.");
      expect(c4.notes.join(' ')).not.toMatch(/[Yy]our hospital/);
      // One hospital on its own: its own label and "This hospital's".
      const h2 = await platformSection({ section: 'risk', hospital: String(fx.hospitals.h2._id), periodQuery: {}, now: NOW });
      const c4h2 = h2.cards.find((c) => c.id === 'C4');
      expect(c4h2.cells.find((c) => c.key === 'preg:grand').label).toBe('Grand multipara (5 or more births)');
      expect(c4h2.notes).toContain("Grand multipara uses the number of births in this hospital's risk rules.");
    } finally {
      for (const h of ['h2', 'h3']) await CarePlanTemplate.updateOne(filter(h), { $set: { riskRules: saved[h] } });
    }
    // The same rule everywhere again: one label, one note for every hospital.
    const back = (await platformSection({ section: 'risk', hospital: 'all', periodQuery: {}, now: NOW })).cards.find((c) => c.id === 'C4');
    expect(back.cells.find((c) => c.key === 'preg:grand').label).toBe('Grand multipara (4 or more births)');
    expect(back.notes).toContain("Grand multipara uses the number of births in each hospital's risk rules.");
  });

  /**
   * §6.4 deep scan of one platform payload: no patient key, no id other than the hospitals', no record number,
   * numbers only in `values`. With the small-hospital switch on, a value (card or tile) may be null, and a left-out
   * hospital is marked only by a `tooFew` array of booleans and a note naming hospitals.
   */
  const deepScan = (where, body) => {
    const hospitalIds = new Set(Object.values(fx.hospitals).map((h) => String(h._id)));
    const walk = (v, path) => {
      if (Array.isArray(v)) {
        if (v.length && v.every((x) => typeof x === 'number' || x === null) && v.some((x) => typeof x === 'number')) {
          expect(path.at(-1), `${where}: numeric array at ${path.join('.')}`).toBe('values');
        }
        if (path.at(-1) === 'tooFew') expect(v.every((x) => typeof x === 'boolean'), `${where}: ${path.join('.')}`).toBe(true);
        v.forEach((x, i) => walk(x, [...path, i]));
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          expect(PLATFORM_KEYS_NEVER, `${where}: key ${[...path, k].join('.')}`).not.toContain(k);
          walk(x, [...path, k]);
        }
      } else if (typeof v === 'string') {
        const hospitalId = path.length === 3 && path[0] === 'hospitals' && path[2] === 'id' && hospitalIds.has(v);
        if (!hospitalId) expect(v, `${where}: id at ${path.join('.')}`).not.toMatch(/[a-f0-9]{24}/);
        expect(v, `${where}: ${path.join('.')}`).not.toMatch(/P-\d{6}/);
      }
    };
    walk(body, []);
    for (const c of body.cards) {
      for (const x of [c.total, ...c.cells].filter(Boolean)) {
        expect(x.value === null || typeof x.value === 'number', `${where} ${c.id}.${x.key}`).toBe(true);
        for (const v of x.values ?? []) expect(v === null || typeof v === 'number').toBe(true);
      }
      for (const [k, v] of Object.entries(c.extras)) {
        expect(['median', 'ratio'], `${where} ${c.id}`).toContain(k);
        expect(Object.keys(v).every((key) => ['value', 'n', 'basis', 'values'].includes(key))).toBe(true);
      }
      expect(c.tooFew === null || Array.isArray(c.tooFew), `${where} ${c.id}`).toBe(true);
    }
    for (const t of body.tiles ?? []) {
      if (t.tooFew?.every(Boolean)) expect(t.value, `${where} ${t.ref}`).toBeNull();
      else expect(typeof t.value, `${where} ${t.ref}`).toBe('number');
      expect(t.note === null || t.note === undefined || typeof t.note === 'string', `${where} ${t.ref}`).toBe(true);
    }
    // No sex words anywhere except the Newborn page's G2 card.
    for (const c of body.cards) if (c.id !== 'G2') expect(mentionsFetalSex(JSON.stringify(c)), `${where} ${c.id}`).toBe(false);
  };

  it('deep scan: no patient, no id other than the hospitals’, no record number, numbers only', () => {
    for (const { where, body } of pages) deepScan(where, body);
  });

  it('no writes in any hospital: risk levels are not brought up to date, nothing is saved', async () => {
    const calls = refreshDueRisks.mock.calls.length;
    const save = vi.spyOn(mongoose.Model.prototype, 'save'); // still saves (calls through); only watched
    const writes = [];
    const models = [Patient, CarePlan, Visit, Tenant];
    const methods = ['updateOne', 'updateMany', 'bulkWrite', 'findOneAndUpdate', 'insertMany', 'deleteMany', 'deleteOne', 'create'];
    const watch = models.flatMap((M) => methods.map((fn) => vi.spyOn(M, fn).mockImplementation((...args) => {
      writes.push(`${M.modelName}.${fn}`);
      throw new Error('no writes on the platform path');
    })));
    try {
      resetAnalyticsAuditThrottle();
      for (const name of ALL_SECTIONS) {
        await platformPayload(name);
        await platformPayload(name, { hospital: String(fx.hospitals.h4._id) });
      }
    } finally {
      for (const s of watch) s.mockRestore();
      save.mockRestore();
    }
    expect(writes).toEqual([]);
    expect(save.mock.contexts.map((doc) => doc.constructor.modelName).filter((n) => n !== 'AuditLog')).toEqual([]);
    expect(refreshDueRisks.mock.calls.length).toBe(calls);
  });

  it('"Analytics opened" on the platform: the page and the hospital choice only, no hospital of its own', async () => {
    const filter = { action: 'ANALYTICS_VIEWED', actor: fx.users.superAdmin._id, 'details.section': 'risk', 'details.hospital': String(fx.hospitals.h2._id) };
    const before = await AuditLog.countDocuments(filter);
    resetAnalyticsAuditThrottle();
    await platformPayload('risk', { hospital: String(fx.hospitals.h2._id) });
    await platformPayload('risk', { hospital: String(fx.hospitals.h2._id) }); // within 10 minutes: not written again
    expect(await AuditLog.countDocuments(filter)).toBe(before + 1);
    const h2 = await AuditLog.find(filter).sort({ _id: -1 }).limit(1).lean();
    expect(Object.keys(h2[0].details).sort()).toEqual(['hospital', 'scope', 'section']);
    expect(h2[0].details).toEqual({ section: 'risk', scope: 'platform', hospital: String(fx.hospitals.h2._id) });
    expect(h2[0].tenantId).toBeNull();
    const all = await AuditLog.findOne({ action: 'ANALYTICS_VIEWED', actor: fx.users.superAdmin._id, 'details.hospital': 'all' }).lean();
    expect(all.details).toMatchObject({ scope: 'platform', hospital: 'all' });
  });

  it('the small-hospital switch (off by default): a clinical card of a hospital below it is left out', async () => {
    expect(PLATFORM_MIN_DENOMINATOR).toBe(0);
    const on = await platformSection({ section: 'risk', hospital: 'all', periodQuery: {}, now: NOW, minDenominator: 3 });
    const ids = on.hospitals.map((h) => h.id);
    const tooFew = ids.map((id) => id !== String(fx.hospitals.h1._id)); // H2 has 2 active pregnancies, H3 has 1
    const c1 = on.cards.find((c) => c.id === 'C1');
    expect(c1.tooFew).toEqual(tooFew);
    expect(c1.total.value).toBe(9); // H1 only
    expect(c1.total.values).toEqual(ids.map((id) => (id === String(fx.hospitals.h1._id) ? 9 : null)));
    expect(c1.notes.at(-1)).toMatch(/^Too few patients in this hospital to show: .*Left out of the numbers for all hospitals\.$/);
    const off = await platformSection({ section: 'risk', hospital: 'all', periodQuery: {}, now: NOW });
    expect(off.cards.every((c) => c.tooFew === null)).toBe(true);
    expect(off.cards.find((c) => c.id === 'C1').total.value).toBe(12);

    // The Overview tile "High-risk pregnancies" is C1's own cell: the same hospitals are left out of it.
    const ov = await platformSection({ section: 'overview', hospital: 'all', periodQuery: {}, now: NOW, minDenominator: 3 });
    const tile = ov.tiles.find((t) => t.ref === 'C1.high');
    const high = c1.cells.find((c) => c.key === 'high');
    expect(tile.tooFew).toEqual(tooFew);
    expect(tile.values).toEqual(high.values);
    expect(tile.values.map((v) => v === null)).toEqual(tooFew);
    expect(tile.value).toBe(high.value);
    expect(tile.note).toBe(c1.notes.at(-1));
    const a2 = ov.tiles.find((t) => t.ref === 'A2.total'); // plain counts stay exact
    expect(pick(a2, ['value', 'tooFew', 'note'])).toEqual({ value: 12, tooFew: null, note: null });
    const offOv = await platformSection({ section: 'overview', hospital: 'all', periodQuery: {}, now: NOW });
    expect(offOv.tiles.every((t) => t.tooFew === null && t.note === null)).toBe(true);
    expect(offOv.tiles.find((t) => t.ref === 'C1.high').values.every((v) => typeof v === 'number')).toBe(true);

    // One small hospital on its own: no number at all, and the note says why.
    const h3 = String(fx.hospitals.h3._id);
    const one = await platformSection({ section: 'risk', hospital: h3, periodQuery: {}, now: NOW, minDenominator: 3 });
    const c1one = one.cards.find((c) => c.id === 'C1');
    expect(c1one.tooFew).toEqual([true]);
    expect(pick(c1one.total, ['value', 'values'])).toEqual({ value: null, values: null });
    for (const x of c1one.cells) expect(pick(x, ['value', 'values']), x.key).toEqual({ value: null, values: null });
    expect(c1one.notes.at(-1)).toBe('Too few patients in this hospital to show.');
    const ovOne = await platformSection({ section: 'overview', hospital: h3, periodQuery: {}, now: NOW, minDenominator: 3 });
    const tileOne = ovOne.tiles.find((t) => t.ref === 'C1.high');
    expect(pick(tileOne, ['value', 'tooFew', 'note'])).toEqual({ value: null, tooFew: [true], note: 'Too few patients in this hospital to show.' });
    expect(tileOne.values).toBeUndefined();
    expect(ovOne.tiles.find((t) => t.ref === 'A2.total').value).toBe(1);

    // Every hospital below the switch: the clinical cards have no numbers, and C2 has no reason rows at all
    // (a reason's name would tell that a hospital left out has a woman with it). Plain counts stay exact.
    const reasons = off.cards.find((c) => c.id === 'C2').cells.map((c) => c.label);
    expect(reasons.length).toBeGreaterThan(0);
    for (const hospital of ['all', String(fx.hospitals.h1._id)]) {
      const none = await platformSection({ section: 'risk', hospital, periodQuery: {}, now: NOW, minDenominator: 1000 });
      const c2none = none.cards.find((c) => c.id === 'C2');
      expect(c2none.cells, hospital).toEqual([]);
      for (const label of reasons) expect(JSON.stringify(c2none), `${hospital}: ${label}`).not.toContain(label);
      for (const c of none.cards) {
        if (!MIN_DENOMINATOR_CARDS.has(c.id)) {
          expect(c.tooFew, `${hospital} ${c.id}`).toBeNull();
          continue;
        }
        expect(c.tooFew.every(Boolean), `${hospital} ${c.id}`).toBe(true);
        for (const x of [c.total, ...c.cells]) expect(x.value, `${hospital} ${c.id}.${x.key}`).toBeNull();
        for (const x of [c.total, ...c.cells]) for (const v of x.values ?? []) expect(v, `${hospital} ${c.id}.${x.key}`).toBeNull();
        expect(c.extras, `${hospital} ${c.id}`).toEqual({});
      }
    }

    // The payloads with the switch on are scanned like every other platform page (§6.4).
    for (const minDenominator of [3, 1000]) {
      for (const hospital of ['all', String(fx.hospitals.h1._id), h3]) {
        for (const section of ['risk', 'overview']) {
          const body = await platformSection({ section, hospital, periodQuery: {}, now: NOW, minDenominator });
          deepScan(`switch ${minDenominator} ${hospital} ${section}`, body);
        }
      }
    }
  });

  it('the small-hospital switch: nothing that only a left-out hospital has reaches the numbers for all hospitals', async () => {
    // H2 gets a risk reason that no other hospital has (stored as the risk check would store it; the platform reads
    // stored levels and never brings them up to date). H1 is the only hospital counted at minDenominator 3.
    const ONLY_H2 = { key: 'sample_only_h2', label: 'Sample reason only in Hospital Two', level: 'moderate' };
    const h2Patient = { tenantId: fx.hospitals.h2._id, _id: fx.ids['H2-1'] };
    await Patient.updateOne(h2Patient, { $push: { 'risk.reasons': ONLY_H2 } });
    try {
      const own = async (h) => platformSection({ section: 'risk', hospital: String(fx.hospitals[h]._id), periodQuery: {}, now: NOW });
      const labelsOf = (body) => new Set(body.cards.find((c) => c.id === 'C2').cells.map((c) => c.label));
      const h1Page = await own('h1');
      const h1Labels = labelsOf(h1Page);
      const leftOutOnly = [];
      for (const h of ['h2', 'h3']) for (const label of labelsOf(await own(h))) if (!h1Labels.has(label)) leftOutOnly.push(label);
      expect(leftOutOnly).toContain(ONLY_H2.label);

      // Switch off: the reason is in the numbers for all hospitals.
      const off = await platformSection({ section: 'risk', hospital: 'all', periodQuery: {}, now: NOW });
      expect(JSON.stringify(off.cards.find((c) => c.id === 'C2'))).toContain(ONLY_H2.label);

      // Switch on: H2 and H3 are left out, and nothing only they have is named.
      const on = await platformSection({ section: 'risk', hospital: 'all', periodQuery: {}, now: NOW, minDenominator: 3 });
      const c2 = on.cards.find((c) => c.id === 'C2');
      expect(c2.tooFew.filter(Boolean)).toHaveLength(2);
      for (const label of leftOutOnly) expect(JSON.stringify(c2), label).not.toContain(label);
      // Every card the switch covers has exactly H1's rows, labels and table rows, in the combined count's order.
      for (const c of on.cards) {
        if (!MIN_DENOMINATOR_CARDS.has(c.id)) continue;
        const mine = h1Page.cards.find((x) => x.id === c.id);
        const rows = (card) => card.cells.map((x) => `${x.key}|${x.label}`);
        expect(rows(c), c.id).toEqual(rows(mine));
        expect(c.cells.map((x) => x.value), c.id).toEqual(mine.cells.map((x) => x.value));
        expect((c.table?.rows ?? []).map((r) => r.key), c.id).toEqual((mine.table?.rows ?? []).map((r) => r.key));
      }
      deepScan('switch 3 all risk, a reason only in H2', on);
    } finally {
      await Patient.updateOne(h2Patient, { $pull: { 'risk.reasons': { key: ONLY_H2.key } } });
    }
  });
});

// ---------- Audit (section 6.7, page views; moves the clock forward, so it runs last) ----------

describe('audit', () => {
  it('"Analytics opened" is written once per person, hospital, section and scope every 10 minutes', async () => {
    const drA = fx.users.drA;
    const count = () => AuditLog.countDocuments({ action: 'ANALYTICS_VIEWED', actor: drA._id, 'details.section': 'overview', 'details.scope': 'mine' });
    const before = await count();
    await payload('drA', 'overview', { scope: 'mine' }); // may be the first view (the pcpndt test viewed it already)
    const afterFirst = await count();
    expect(afterFirst - before).toBeLessThanOrEqual(1);
    await payload('drA', 'overview', { scope: 'mine' });
    expect(await count()).toBe(afterFirst);

    vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000));
    await payload('drA', 'overview', { scope: 'mine' });
    expect(await count()).toBe(afterFirst + 1);

    const entry = await AuditLog.findOne({ action: 'ANALYTICS_VIEWED', actor: drA._id }).sort({ createdAt: -1 }).lean();
    expect(Object.keys(entry.details).sort()).toEqual(['scope', 'section']);
    expect(entry.details).toEqual({ section: 'overview', scope: 'mine' });
    expect(String(entry.tenantId)).toBe(String(fx.hospitals.h1._id));
    // Nothing revealing: no card id, cell code, label or period.
    const all = await AuditLog.find({ action: 'ANALYTICS_VIEWED' }).lean();
    expect(all.length).toBeGreaterThan(3);
    // (A hospital id picked by the super admin is written as it is; its hex digits are not words.)
    for (const e of all) expect(JSON.stringify(e.details).replace(/[0-9a-f]{24}/g, '<id>')).not.toMatch(/A2|c3|trimester|12m|last_12m|antenatal/);
  });

  it('"Analytics opened" on the platform is written again after 10 minutes, once', async () => {
    // Runs after the clock was moved 11 minutes past the platform tests' views.
    const h2 = String(fx.hospitals.h2._id);
    const filter = { action: 'ANALYTICS_VIEWED', actor: fx.users.superAdmin._id, 'details.section': 'risk', 'details.hospital': h2 };
    const before = await AuditLog.countDocuments(filter);
    expect(before).toBeGreaterThan(0);
    const s = await fx.as('superAdmin');
    expect((await s.get(`/api/platform/analytics/sections/risk?hospital=${h2}`)).status).toBe(200);
    expect(await AuditLog.countDocuments(filter)).toBe(before + 1);
    expect((await s.get(`/api/platform/analytics/sections/risk?hospital=${h2}`)).status).toBe(200);
    expect(await AuditLog.countDocuments(filter)).toBe(before + 1);
  });
});

// ---------- Doctors' pages kept for a minute (section 4.8; moves the clock forward, so it runs last) ----------

describe('a doctor\'s page kept for a minute', () => {
  it('the same doctor, page and filters within 60 seconds get the page as it was; lists and others are never kept', async () => {
    resetSectionCache();
    const app = createApp({ apiRateLimitMax: 100000, analyticsCacheMs: 60_000 });
    const drB = await loginAs(fx.users.drB, { app });
    const drA = await loginAs(fx.users.drA, { app });
    const start = Date.now();
    const at = (seconds) => vi.setSystemTime(new Date(start + seconds * 1000));
    const get = async (s, path) => {
      const res = await s.get(path);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body;
    };
    const opened = () => AuditLog.countDocuments({ action: 'ANALYTICS_VIEWED', actor: fx.users.drB._id });
    try {
      at(0);
      const first = await get(drB, '/api/analytics/sections/overview');
      const refreshes = refreshDueRisks.mock.calls.length;
      at(30);
      resetAnalyticsAuditThrottle();
      const views = await opened();
      const again = await get(drB, '/api/analytics/sections/overview');
      expect(again).toEqual(first); // the same page, worked out at the same moment
      expect(again.calculatedAt).toBe(new Date(start).toISOString());
      expect(refreshDueRisks.mock.calls.length).toBe(refreshes); // nothing worked out again
      expect(await opened()).toBe(views + 1); // opening it is still recorded

      // Another doctor, scope, period or type of care is worked out for itself.
      const other = await get(drA, '/api/analytics/sections/overview');
      expect(other.calculatedAt).toBe(new Date(start + 30_000).toISOString());
      expect(other.leftOut).not.toBe(first.leftOut); // Dr A does not see two records Dr B sees
      for (const query of ['scope=mine', 'period=6m', 'careType=antenatal']) {
        expect((await get(drB, `/api/analytics/sections/overview?${query}`)).calculatedAt, query).toBe(new Date(start + 30_000).toISOString());
      }

      // A patient list is never kept: each page served is worked out and recorded.
      const lists = () => AuditLog.countDocuments({ action: 'ANALYTICS_LIST_VIEWED', actor: fx.users.drB._id });
      const before = await lists();
      await get(drB, '/api/analytics/list?metric=A2&cell=c3');
      await get(drB, '/api/analytics/list?metric=A2&cell=c3');
      expect(await lists()).toBe(before + 2);

      // After a minute the page is worked out again.
      at(61);
      const later = await get(drB, '/api/analytics/sections/overview');
      expect(later.calculatedAt).toBe(new Date(start + 61_000).toISOString());
      expect(refreshDueRisks.mock.calls.length).toBeGreaterThan(refreshes);
      expect(later.cards).toEqual(first.cards);

      // Hospital admins are never served from it (their own 10-minute view is separate).
      const admin = await loginAs(fx.users.admin, { app });
      expect((await get(admin, '/api/analytics/sections/overview')).audience).toBe('admin');
    } finally {
      resetSectionCache();
    }
  });
});

// ---------- The super admin's pages kept for 5 minutes (moves the clock forward, so it runs last) ----------

describe('the super admin\'s page kept for 5 minutes', () => {
  it('the same page, hospital choice, period and type of care within 5 minutes are sent as they were', async () => {
    resetSectionCache();
    const app = createApp({ apiRateLimitMax: 100000, platformAnalyticsCacheMs: 5 * 60_000 });
    const s = await loginAs(fx.users.superAdmin, { app });
    const start = Date.now();
    const at = (seconds) => vi.setSystemTime(new Date(start + seconds * 1000));
    const iso = (seconds) => new Date(start + seconds * 1000).toISOString();
    const get = async (path) => {
      const res = await s.get(`/api/platform/analytics${path}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body;
    };
    const opened = () => AuditLog.countDocuments({ action: 'ANALYTICS_VIEWED', actor: fx.users.superAdmin._id });
    const h2 = String(fx.hospitals.h2._id);
    try {
      at(0);
      const first = await get('/sections/overview');
      const one = await get(`/sections/risk?hospital=${h2}`);
      at(240);
      resetAnalyticsAuditThrottle();
      const views = await opened();
      const again = await get('/sections/overview');
      expect(again).toEqual(first); // the same page, worked out at the same moment
      expect(again.calculatedAt).toBe(iso(0));
      expect((await get(`/sections/risk?hospital=${h2}`)).calculatedAt).toBe(one.calculatedAt);
      expect(await opened()).toBe(views + 2); // opening a kept page is still recorded

      // Another page, hospital choice, period or type of care is worked out for itself.
      for (const path of ['/sections/risk', `/sections/overview?hospital=${h2}`, '/sections/overview?period=last_6m', '/sections/overview?careType=antenatal']) {
        expect((await get(path)).calculatedAt, path).toBe(iso(240));
      }

      // After 5 minutes the page is worked out again, with the same numbers.
      at(301);
      const later = await get('/sections/overview');
      expect(later.calculatedAt).toBe(iso(301));
      expect(later.cards).toEqual(first.cards);
      expect(later.tiles).toEqual(first.tiles);

      // 'ALL' is the same choice as 'all': the kept page, and the audit line says 'all' (not a hospital's id).
      resetAnalyticsAuditThrottle();
      const upper = await get('/sections/overview?hospital=ALL');
      expect(upper.calculatedAt).toBe(iso(301));
      expect(upper.cards).toEqual(later.cards);
      const newest = await AuditLog.findOne({ action: 'ANALYTICS_VIEWED', actor: fx.users.superAdmin._id }).sort({ _id: -1 }).lean();
      expect(newest.details.hospital).toBe('all');
      expect(newest.details.section).toBe('overview');

      // Nothing is kept when the time is 0 (the default in tests).
      resetSectionCache();
      const off = await loginAs(fx.users.superAdmin, { app: createApp({ apiRateLimitMax: 100000, platformAnalyticsCacheMs: 0 }) });
      await off.get('/api/platform/analytics/sections/overview');
      at(302);
      expect((await off.get('/api/platform/analytics/sections/overview')).body.calculatedAt).toBe(iso(302));
      // Without a kept page 'All' still means all hospitals (the answer no longer depends on the cache).
      const uncached = await off.get('/api/platform/analytics/sections/overview?hospital=All');
      expect(uncached.status, JSON.stringify(uncached.body)).toBe(200);
      expect(uncached.body.cards).toEqual(first.cards);
      expect(uncached.body.hospitals).toEqual(first.hospitals);
    } finally {
      resetSectionCache();
    }
  });

  it('the key: page, hospital choice, period, type of care and hospital date – never a person or a patient', () => {
    const today = hospitalToday(NOW);
    const period = parsePeriod({ period: 'last_12m' }, { audience: 'platform', today });
    const key = platformCacheKey({ section: 'overview', hospital: 'all', period, careType: 'all', today });
    expect(JSON.parse(key)).toEqual(['platform', 'overview', 'all', 'last_12m', isoDay(period.from), isoDay(period.to), 'all', isoDay(today)]);
    for (const id of [fx.users.superAdmin._id, ...Object.values(fx.ids ?? {})]) expect(key).not.toContain(String(id));
    // A new hospital day is a new key, even for the same period.
    expect(platformCacheKey({ section: 'overview', hospital: 'all', period, careType: 'all', today: addDays(today, 1) })).not.toBe(key);
    // The same hospital, whatever the case of its id.
    const h2 = String(fx.hospitals.h2._id);
    expect(platformCacheKey({ section: 'risk', hospital: h2.toUpperCase(), period, careType: 'all', today })).toBe(
      platformCacheKey({ section: 'risk', hospital: h2, period, careType: 'all', today }),
    );
  });
});

describe('numbers per doctor (doctors only)', () => {
  const byDoctor = async (who, query = {}) => (await fx.as(who)).get(`/api/analytics/doctors?${new URLSearchParams(query)}`);

  it("each doctor's row is what that doctor's “My patients only” shows; the last row is the whole hospital", async () => {
    const res = await byDoctor('drB');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.columns.map((c) => c.ref)).toEqual(['A2.total', 'A3.next4', 'C1.high', 'B1.total', 'A4.all', 'G1.total']);
    const overview = await payload('drB', 'overview');
    expect(res.body.hospital).toEqual(overview.tiles.map((t) => t.value));
    const names = res.body.doctors.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['Dr A Sample', 'Dr B Sample', 'Dr Admin Sample']));
    expect(res.body.doctors.find((d) => d.name === 'Dr B Sample').you).toBe(true);
    const mineA = await payload('drA', 'overview', { scope: 'mine' });
    // Dr B sees every record, so Dr A's row is Dr A's own "My patients only"
    expect(res.body.doctors.find((d) => d.name === 'Dr A Sample').values).toEqual(mineA.tiles.map((t) => t.value));
    expect(res.body.doctors.find((d) => d.name === 'Dr A Sample').values[0]).toBe(5); // active pregnancies
    expect(res.body.leftOut).toBe(0);
    expect(JSON.stringify(res.body)).not.toMatch(/A-0\d|fullName|mrn/); // counts only
  });

  it("another doctor's sensitive records are left out, and said so", async () => {
    const res = await byDoctor('drA', { period: '3m' });
    expect(res.body.leftOut).toBe(2);
    const mineB = await payload('drB', 'overview', { scope: 'mine', period: '3m' });
    const rowB = res.body.doctors.find((d) => d.name === 'Dr B Sample').values;
    expect(rowB[0]).toBeLessThan(mineB.tiles[0].value); // A-03 (sensitive, Dr B's) is not counted for Dr A
  });

  it('hospital admins, RMOs and nurses do not get it; a custom period is refused', async () => {
    expect((await byDoctor('admin')).status).toBe(403);
    expect((await byDoctor('rmo')).status).toBe(403);
    expect((await byDoctor('nurse')).status).toBe(403);
    expect((await byDoctor('drA', { period: 'custom' })).status).toBe(400);
  });
});
