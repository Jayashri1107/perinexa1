// Analytics (Feature 11): pure tests – periods, dates, facts, the card registry. No database.
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import * as websiteRoles from '../../client/src/pages/analytics/analyticsRoles.js';
import * as websitePatientFormat from '../../client/src/pages/patients/patientFormat.js';
import { resetAnalyticsAuditThrottle, shouldLogView } from '../src/analytics/auditThrottle.js';
import { buildContext, computeSections, rawValue } from '../src/analytics/compute.js';
import { babyEdd, bookingOf, d10Cell, dayCache, grandThreshold, hbBand, isActivePregnancy, olderThan44, patientOfUnit, unitKey, visitInPregnancy } from '../src/analytics/facts.js';
import { CONDITION_LABELS } from '../src/analytics/metrics/risk.js';
import { LIST_ORDERS, LIST_ROW_KEYS, LIST_TIE_FIELDS, listPage, sortIds } from '../src/analytics/listService.js';
import { PATIENT_FIELDS, underMainRecord } from '../src/analytics/load.js';
import { ADMIN_PERIOD_KEYS, adminPayload, buildAdminGraph, collectAdminViews, maskedCard } from '../src/analytics/adminView.js';
import { HIDDEN, LT5, WITHHELD, maskForAdmin, rangeCheck } from '../src/analytics/mask.js';
import { MOD, echelon, readerPins } from './maskReader.js';
import { FEW_BIRTHS_NOTE, RATIO_NOTE_BELOW } from '../src/analytics/metrics/sexAtBirth.js';

// The row whitelist of the build contract (§3.6), written out here on purpose: the tests check the code against
// this list, never against the code's own LIST_ROW_KEYS alone.
const SPEC_LIST_ROW_KEYS = ['id', 'mrn', 'fullName', 'careType', 'currentAge', 'assignedDoctorName', 'sensitive', 'gestationalAge', 'edd', 'riskLevel', 'bornOn', 'access', 'detail'];
import { currentPlansNow } from '../src/analytics/populations.js';
import { bucketKeyOfDate, parsePeriod } from '../src/analytics/period.js';
import { countOf } from '../src/analytics/publicCards.js';
import { CARE_TYPE_KEYS } from '../src/analytics/metrics/overview.js';
import { METRICS, SECTIONS, allCellDefs, cellByCode, cellDef, cellWindow, globalCellId, globalCellWindow, metricById, metricsOfSection, relations, shownCellsOf, splitGlobal, tableOf } from '../src/analytics/registry.js';
import * as roles from '../src/analytics/roles.js';
import { addDays, hospitalDayStart, isoDay } from '../src/careplans/dates.js';
import { ANTENATAL_DRAFT } from '../src/careplans/antenatalDraft.js';
import { derivePlan, newItem, planFacts } from '../src/careplans/planEngine.js';
import { closedForPregnancy } from '../src/careplans/plansService.js';
import { CONDITIONS } from '../src/models/Patient.js';

const d = (iso) => new Date(`${iso}T00:00:00Z`);
const T = d('2026-10-15');
const NOW = new Date('2026-10-15T04:30:00Z');
const oid = () => new mongoose.Types.ObjectId();
const utcDayOf = (x) => d(new Date(x).toISOString().slice(0, 10));

// ---------- Periods (section 2.2) ----------

describe('periods', () => {
  const doctor = (period, today, extra = {}) => parsePeriod({ period, ...extra }, { audience: 'doctor', today: d(today) });
  const admin = (period, today) => parsePeriod({ period }, { audience: 'admin', today: d(today) });
  const platform = (q, today) => parsePeriod(q, { audience: 'platform', today: d(today) });
  const span = (p) => [isoDay(p.from), isoDay(p.to)];

  it('doctor presets on 15 Oct 2026', () => {
    expect(span(doctor('this_month', '2026-10-15'))).toEqual(['2026-10-01', '2026-10-15']);
    expect(span(doctor('3m', '2026-10-15'))).toEqual(['2026-08-01', '2026-10-15']);
    expect(span(doctor('6m', '2026-10-15'))).toEqual(['2026-05-01', '2026-10-15']);
    const y = doctor('12m', '2026-10-15');
    expect(span(y)).toEqual(['2025-11-01', '2026-10-15']);
    expect(y.label).toBe('1 Nov 2025 – 15 Oct 2026');
    expect(y.kind).toBe('month');
    expect(doctor(undefined, '2026-10-15').key).toBe('12m'); // the default
    expect(doctor('this_month', '2026-10-15').kind).toBe('week');
  });

  it('month arithmetic on 31 Jan and 1 Mar', () => {
    expect(span(doctor('3m', '2027-01-31'))).toEqual(['2026-11-01', '2027-01-31']);
    expect(span(doctor('12m', '2027-01-31'))).toEqual(['2026-02-01', '2027-01-31']);
    const m = doctor('3m', '2027-03-01');
    expect(span(m)).toEqual(['2027-01-01', '2027-03-01']);
    expect(m.kind).toBe('month'); // chosen by the key, never by the dates
    expect(m.buckets.map((b) => [b.key, b.label, b.partial])).toEqual([
      ['m:2027-01', 'Jan 2027', false],
      ['m:2027-02', 'Feb 2027', false],
      ['m:2027-03', 'Mar (to date)', true],
    ]);
    expect(span(doctor('this_month', '2027-03-01'))).toEqual(['2027-03-01', '2027-03-01']);
  });

  it('admin and platform periods: whole finished months, on 1 Jan and 31 Dec', () => {
    expect(span(admin('last_month', '2027-01-01'))).toEqual(['2026-12-01', '2026-12-31']);
    expect(span(admin('last_3m', '2027-01-01'))).toEqual(['2026-10-01', '2026-12-31']);
    expect(span(admin('last_12m', '2027-01-01'))).toEqual(['2026-01-01', '2026-12-31']);
    expect(span(admin('last_month', '2026-12-31'))).toEqual(['2026-11-01', '2026-11-30']);
    const six = admin('last_6m', '2026-12-31');
    expect(span(six)).toEqual(['2026-06-01', '2026-11-30']);
    expect(six.buckets.every((b) => !b.partial && b.key.startsWith('m:'))).toBe(true);
    expect(admin(undefined, '2026-10-15').label).toBe('1 Oct 2025 – 30 Sep 2026');
    expect(span(platform({ period: 'custom_months', from: '2025-01', to: '2026-09' }, '2026-10-15'))).toEqual(['2025-01-01', '2026-09-30']);
    // The platform on 1 Jan and 31 Dec.
    expect(span(platform({ period: 'last_month' }, '2027-01-01'))).toEqual(['2026-12-01', '2026-12-31']);
    const py = platform({ period: 'last_12m' }, '2027-01-01');
    expect(span(py)).toEqual(['2026-01-01', '2026-12-31']);
    expect(py.buckets.map((b) => b.key)).toEqual(Array.from({ length: 12 }, (_, i) => `m:2026-${String(i + 1).padStart(2, '0')}`));
    expect(py.buckets.every((b) => !b.partial)).toBe(true);
    expect(span(platform({ period: 'custom_months', from: '2025-01', to: '2026-12' }, '2027-01-01'))).toEqual(['2025-01-01', '2026-12-31']); // 24 months, ends with last month
    expect(() => platform({ period: 'custom_months', from: '2026-06', to: '2027-01' }, '2027-01-01')).toThrow(); // this month is not finished
    expect(span(platform({ period: 'last_month' }, '2026-12-31'))).toEqual(['2026-11-01', '2026-11-30']);
    expect(span(platform({ period: 'last_12m' }, '2026-12-31'))).toEqual(['2025-12-01', '2026-11-30']);
    expect(span(platform({ period: 'custom_months', from: '2026-01', to: '2026-11' }, '2026-12-31'))).toEqual(['2026-01-01', '2026-11-30']);
    expect(() => platform({ period: 'custom_months', from: '2026-01', to: '2026-12' }, '2026-12-31')).toThrow(); // December not finished on 31 Dec
  });

  it('refuses what an audience may not use', () => {
    const code = (fn) => {
      try {
        fn();
        return null;
      } catch (e) {
        return [e.status, e.code, e.message];
      }
    };
    expect(code(() => admin('12m', '2026-10-15'))).toEqual([400, 'BAD_PERIOD', 'Hospital admins can choose last month or the last 3, 6 or 12 complete months.']);
    expect(code(() => admin('custom_months', '2026-10-15'))?.[0]).toBe(400);
    expect(code(() => doctor('last_12m', '2026-10-15'))).toEqual([400, 'BAD_PERIOD', 'Choose a period of up to 24 months, ending today or earlier.']);
    expect(code(() => platform({ period: 'this_month' }, '2026-10-15'))).toEqual([400, 'BAD_PERIOD', 'Choose whole months, up to 24, ending with last month.']);
    expect(code(() => platform({ period: 'custom_months', from: '2024-09', to: '2026-09' }, '2026-10-15'))?.[0]).toBe(400); // 25 months
    expect(code(() => platform({ period: 'custom_months', from: '2026-01', to: '2026-10' }, '2026-10-15'))?.[0]).toBe(400); // this month
    expect(code(() => platform({ period: 'custom_months', from: '2019-12', to: '2020-06' }, '2026-10-15'))?.[0]).toBe(400);
    expect(code(() => doctor('12m', '2026-10-15', { from: '2026-01-01' }))?.[0]).toBe(400); // dates only with custom
  });

  it('custom periods for doctors', () => {
    const ok = doctor('custom', '2026-10-15', { from: '2024-10-16', to: '2026-10-15' }); // 730 days
    expect(ok.kind).toBe('month');
    expect(doctor('custom', '2026-10-15', { from: '2024-10-15', to: '2026-10-15' }).key).toBe('custom'); // exactly 731 days
    expect(() => doctor('custom', '2026-10-15', { from: '2024-10-14', to: '2026-10-15' })).toThrow(); // 732 days
    expect(() => doctor('custom', '2026-10-15', { from: '2026-10-10', to: '2026-10-16' })).toThrow(); // after today
    expect(() => doctor('custom', '2026-10-15', { from: '2026-10-10', to: '2026-10-01' })).toThrow(); // backwards
    expect(() => doctor('custom', '2026-10-15', { from: '2019-12-31', to: '2020-01-10' })).toThrow();
    expect(() => doctor('custom', '2026-10-15', { from: '2026-02-30', to: '2026-03-10' })).toThrow(); // no such day
    expect(() => doctor('custom', '2026-10-15', { from: '2026-10-01' })).toThrow();
    expect(doctor('custom', '2026-10-15', { from: '2026-08-15', to: '2026-10-15' }).kind).toBe('week'); // 62 days
    expect(doctor('custom', '2026-10-15', { from: '2026-08-14', to: '2026-10-15' }).kind).toBe('month'); // 63 days
  });

  it('week buckets start on Monday, across a year boundary, cut at both ends', () => {
    expect(bucketKeyOfDate(d('2027-01-02'), 'week')).toBe('w:2026-12-28');
    expect(bucketKeyOfDate(d('2026-12-28'), 'week')).toBe('w:2026-12-28');
    expect(bucketKeyOfDate(d('2026-10-18'), 'week')).toBe('w:2026-10-12'); // a Sunday
    expect(bucketKeyOfDate(d('2026-10-18'), 'month')).toBe('m:2026-10');
    const p = doctor('custom', '2027-01-20', { from: '2026-12-30', to: '2027-01-06' });
    expect(p.buckets.map((b) => [b.key, b.label, b.partial])).toEqual([
      ['w:2026-12-28', 'from 30 Dec', true],
      ['w:2027-01-04', '4 Jan (to 6 Jan)', true],
    ]);
    const m = doctor('custom', '2027-01-20', { from: '2026-10-10', to: '2027-01-20' });
    expect(m.buckets[0]).toMatchObject({ key: 'm:2026-10', label: 'from 10 Oct', partial: true, from: '2026-10-10', to: '2026-10-31' });
    expect(m.buckets.at(-1)).toMatchObject({ key: 'm:2027-01', label: 'Jan (to date)', partial: true });
  });

  it('instants near midnight in India fall on the hospital date', () => {
    const hday = dayCache('Asia/Kolkata');
    expect(isoDay(hday(new Date('2026-09-30T18:29:59Z')))).toBe('2026-09-30');
    expect(isoDay(hday(new Date('2026-09-30T18:30:00Z')))).toBe('2026-10-01');
    expect(isoDay(hday(new Date('2026-09-30T18:45:00Z')))).toBe('2026-10-01'); // N-01 of the fixture
  });
});

describe('dates', () => {
  it('hospitalDayStart: 00:00 in India is 18:30 UTC the day before', () => {
    expect(hospitalDayStart(d('2026-10-01')).toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(hospitalDayStart(d('2027-01-01')).toISOString()).toBe('2026-12-31T18:30:00.000Z');
    expect(hospitalDayStart(d('2026-10-01'), 'UTC').toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(hospitalDayStart(d('2026-07-01'), 'Europe/London').toISOString()).toBe('2026-06-30T23:00:00.000Z');
  });
});

// ---------- Facts (section 6.8) ----------

const plan = (o) => ({ _id: oid(), current: false, status: 'closed', closed: null, bookedOn: null, basis: { edd: null }, eddReview: null, ...o });

/**
 * What load.js returns, over synthetic rows. patients: rows; plans; visits (active, all history); cancelled;
 * deliveries: confirmed delivery notes ({ _id, patientId, content }) – the cards keep those of the period.
 */
function dataOf({ patients, plans = [], fullPlans = [], template = null, visits = [], cancelled = [], deliveries = [], period = parsePeriod({ period: '12m' }, { audience: 'doctor', today: T }) }) {
  const active = visits.filter((v) => v.status !== 'cancelled');
  const byPatient = new Map();
  for (const v of [...active].sort((a, b) => a.visitOn - b.visitOn || a.createdAt - b.createdAt)) {
    const k = String(v.patientId);
    if (!byPatient.has(k)) byPatient.set(k, []);
    byPatient.get(k).push(v);
  }
  const visitSummary = [...byPatient.entries()].map(([k, vs]) => {
    const first = vs[0];
    const last = vs.at(-1);
    const ante = vs.filter((v) => v.careType === 'antenatal');
    return {
      _id: new mongoose.Types.ObjectId(k),
      firstId: first._id,
      firstOn: first.visitOn,
      firstCareType: first.careType,
      lastOn: last.visitOn,
      lastNextVisitOn: last.details?.nextVisitOn ?? null,
      firstAntenatalOn: ante[0]?.visitOn ?? null,
      antenatalVisits: ante.length,
    };
  });
  const windowFrom = period.from < addDays(T, -60) ? period.from : addDays(T, -60);
  return {
    patients,
    plans,
    visitSummary,
    windowVisits: active.filter((v) => v.visitOn >= windowFrom && v.visitOn <= T),
    cancelledVisits: [...visits.filter((v) => v.status === 'cancelled'), ...cancelled].filter((v) => v.visitOn >= period.from && v.visitOn <= period.to),
    fullPlans,
    template,
    deliveries,
    // What load.js's own query of born babies returns (card G2 only).
    g2Rows: patients
      .filter((p) => p.careType === 'newborn' && p.newborn?.birthAt && p.newborn.birthAt <= NOW)
      .map((p) => ({ _id: p._id, newborn: { sex: p.newborn.sex ?? '', birthAt: p.newborn.birthAt, mother: p.newborn.mother }, assignedDoctor: p.assignedDoctor, sensitive: p.sensitive })),
  };
}

/** A context over synthetic rows (see dataOf). */
function ctxOf({ period = parsePeriod({ period: '12m' }, { audience: 'doctor', today: T }), scope = 'hospital', userId = null, visible = null, careType = 'all', audience = 'doctor', ...rows }) {
  return buildContext(dataOf({ ...rows, period }), { now: NOW, today: T, period, scope, careType, audience, userId, visible });
}

const pt = (o = {}) => ({
  _id: oid(),
  careType: 'antenatal',
  createdAt: new Date('2026-06-01T04:30:00Z'),
  assignedDoctor: null,
  sensitive: false,
  pregnancy: { effectiveEdd: null },
  newborn: { birthAt: null, mother: null },
  ...o,
});
const visitOf = (p, on, o = {}) => ({ _id: oid(), patientId: p._id, visitOn: d(on), careType: 'antenatal', createdAt: new Date(`${on}T05:00:00Z`), status: 'active', details: {}, vitals: {}, ...o });

describe('facts', () => {
  it('active, older than 44 weeks, and closed for this pregnancy', () => {
    const edge = pt({ pregnancy: { effectiveEdd: d('2026-09-17') } }); // T−28: still active
    const old = pt({ pregnancy: { effectiveEdd: d('2026-09-16') } }); // T−29
    const newNoEdd = pt({ createdAt: new Date('2025-12-11T04:30:00Z') }); // T−308
    const oldNoEdd = pt({ createdAt: new Date('2025-12-10T04:30:00Z') }); // T−309
    const delivered = pt({ pregnancy: { effectiveEdd: d('2026-10-10') } });
    const deliveredFar = pt({ pregnancy: { effectiveEdd: d('2027-03-01') } }); // closed plan of an earlier pregnancy
    const newPregnancyClose = pt({ pregnancy: { effectiveEdd: d('2026-10-10') } });
    const reopened = pt({ pregnancy: { effectiveEdd: d('2026-10-10') } });
    const postnatal = pt({ careType: 'postnatal', pregnancy: { effectiveEdd: d('2026-10-10') } });
    const plans = [
      plan({ patientId: delivered._id, closed: { reason: 'delivered', at: NOW }, basis: { edd: d('2026-10-01') } }),
      plan({ patientId: deliveredFar._id, closed: { reason: 'delivered', at: NOW }, basis: { edd: d('2026-10-01') } }),
      plan({ patientId: newPregnancyClose._id, closed: { reason: 'new_pregnancy', at: NOW }, basis: { edd: d('2026-10-01') } }),
      plan({ patientId: reopened._id, closed: { reason: 'delivered', at: NOW }, basis: { edd: d('2026-10-01') } }),
      plan({ patientId: reopened._id, current: true, status: 'active', basis: { edd: d('2026-10-10') } }),
    ];
    const ctx = ctxOf({ patients: [edge, old, newNoEdd, oldNoEdd, delivered, deliveredFar, newPregnancyClose, reopened, postnatal], plans });
    const state = (p) => (isActivePregnancy(p, ctx) ? 'active' : olderThan44(p, ctx) ? 'older' : 'other');
    expect([edge, old, newNoEdd, oldNoEdd].map(state)).toEqual(['active', 'older', 'active', 'older']);
    expect(state(delivered)).toBe('other'); // closed for this pregnancy (dq5)
    expect(state(deliveredFar)).toBe('active'); // the closed plan was for another EDD
    expect(state(newPregnancyClose)).toBe('active'); // "new pregnancy" does not end this one
    expect(state(reopened)).toBe('active'); // a current plan exists
    expect(state(postnatal)).toBe('other');
  });

  it('a death recorded on her record ends the pregnancy for the follow-up counts (A2, A3, D9, D10, E1 and the tidy-up list)', () => {
    const plans = (p) => [plan({ patientId: p._id, current: true, status: 'active', basis: { edd: d('2026-12-01') } })];
    const died = pt({ pregnancy: { effectiveEdd: d('2026-12-01') }, death: { on: d('2026-10-01'), timing: 'pregnancy' } });
    const diedLongAgo = pt({ pregnancy: { effectiveEdd: d('2026-01-01') }, death: { on: d('2025-12-01'), timing: 'pregnancy' } }); // would be "older than 44 weeks"
    const undone = pt({ pregnancy: { effectiveEdd: d('2026-12-01') }, death: null, deathHistory: [{ on: d('2026-10-01') }] }); // recorded in error and undone
    const ctx = ctxOf({ patients: [died, diedLongAgo, undone], plans: [...plans(died), ...plans(undone)] });
    expect([died, diedLongAgo, undone].map((p) => [isActivePregnancy(p, ctx), olderThan44(p, ctx)])).toEqual([
      [false, false],
      [false, false],
      [true, false],
    ]);
  });

  it('closedForPregnancy keeps the care plans rule', () => {
    const edd = d('2026-10-10');
    expect(closedForPregnancy([{ basis: { edd: d('2026-08-15') }, closed: { reason: 'delivered' } }], edd)).toBe(true); // 56 days
    expect(closedForPregnancy([{ basis: { edd: d('2026-08-14') }, closed: { reason: 'delivered' } }], edd)).toBe(false); // 57 days
    expect(closedForPregnancy([{ basis: { edd: d('2026-01-01') }, closed: { reason: 'other' }, eddReview: { toEdd: d('2026-10-01') } }], edd)).toBe(true);
    expect(closedForPregnancy([{ basis: { edd: d('2026-01-01') }, closed: { reason: 'new_pregnancy' }, eddReview: { toEdd: d('2026-10-01') } }], edd)).toBe(false);
    expect(closedForPregnancy([], edd)).toBe(false);
  });

  it('D10 boundaries', () => {
    const cell = (gaToday, { lastDaysAgo = null, nextDaysAgo = null, recordDays = 100 } = {}) => {
      const edd = addDays(T, 280 - gaToday);
      const p = pt({ pregnancy: { effectiveEdd: edd }, createdAt: new Date(addDays(T, -recordDays).getTime() + 5 * 3600_000) });
      const visits = lastDaysAgo == null ? [] : [visitOf(p, isoDay(addDays(T, -lastDaysAgo)), { details: { nextVisitOn: nextDaysAgo == null ? null : addDays(T, -nextDaysAgo) } })];
      return d10Cell(p, ctxOf({ patients: [p], visits }));
    };
    expect(cell(100, { recordDays: 14 })).toBe('neverSeen');
    expect(cell(100, { recordDays: 13 })).toBe('waitingFirst');
    expect(cell(100, { lastDaysAgo: 35 })).toBe('ok');
    expect(cell(100, { lastDaysAgo: 36 })).toBe('gap');
    expect(cell(195, { lastDaysAgo: 36 })).toBe('gap');
    expect(cell(196, { lastDaysAgo: 21 })).toBe('ok');
    expect(cell(196, { lastDaysAgo: 22 })).toBe('gap');
    expect(cell(252, { lastDaysAgo: 10 })).toBe('ok');
    expect(cell(252, { lastDaysAgo: 11 })).toBe('gap');
    // Missed the next visit date: grace 7 days, 3 days from 36 weeks.
    expect(cell(200, { lastDaysAgo: 15, nextDaysAgo: 7 })).toBe('ok');
    expect(cell(200, { lastDaysAgo: 16, nextDaysAgo: 8 })).toBe('missedAppt');
    expect(cell(251, { lastDaysAgo: 5, nextDaysAgo: 4 })).toBe('ok');
    expect(cell(252, { lastDaysAgo: 5, nextDaysAgo: 3 })).toBe('ok');
    expect(cell(252, { lastDaysAgo: 5, nextDaysAgo: 4 })).toBe('missedAppt');
    // Missed comes before "too long".
    expect(cell(100, { lastDaysAgo: 50, nextDaysAgo: 20 })).toBe('missedAppt');
  });

  it('visits outside 0–45 weeks of the current EDD belong to another pregnancy', () => {
    const p = pt({ pregnancy: { effectiveEdd: d('2026-12-01') } }); // day 0 = 24 Feb 2026
    expect(visitInPregnancy(p, d('2026-02-24'))).toBe(true);
    expect(visitInPregnancy(p, d('2026-02-23'))).toBe(false);
    expect(visitInPregnancy(p, addDays(d('2026-02-24'), 315))).toBe(true);
    expect(visitInPregnancy(p, addDays(d('2026-02-24'), 316))).toBe(false);
    expect(visitInPregnancy(pt(), d('2026-06-01'))).toBe(false); // no EDD
  });

  it('bookings: the care plan first, the first antenatal visit only without any plan', () => {
    const withPlans = pt({ pregnancy: { effectiveEdd: d('2027-03-01') } });
    const noPlan = pt({ pregnancy: { effectiveEdd: d('2027-03-01') } });
    const noPlanNoEdd = pt();
    const planOutside = pt({ pregnancy: { effectiveEdd: d('2027-03-01') } });
    const plans = [
      plan({ patientId: withPlans._id, current: true, status: 'active', bookedOn: d('2026-09-01'), basis: { edd: d('2027-03-01') } }),
      plan({ patientId: withPlans._id, bookedOn: d('2026-01-10'), basis: { edd: d('2026-08-01') }, closed: { reason: 'delivered' } }),
      plan({ patientId: planOutside._id, current: true, status: 'active', bookedOn: d('2025-06-01'), basis: { edd: d('2026-03-01') } }),
    ];
    const visits = [visitOf(noPlan, '2026-06-10'), visitOf(noPlanNoEdd, '2026-06-10'), visitOf(planOutside, '2026-06-10')];
    const ctx = ctxOf({ patients: [withPlans, noPlan, noPlanNoEdd, planOutside], plans, visits });
    const { from, to } = ctx.period;
    const b = bookingOf(withPlans, ctx, from, to);
    expect(isoDay(b.on)).toBe('2026-01-10'); // her earliest booking in the period
    expect(b.ga.totalDays).toBe(280 - 203);
    const f = bookingOf(noPlan, ctx, from, to);
    expect(isoDay(f.on)).toBe('2026-06-10');
    expect(f.ga.totalDays).toBe(280 - 264);
    expect(bookingOf(noPlanNoEdd, ctx, from, to)).toEqual({ on: d('2026-06-10'), ga: null }); // gestation not known
    expect(bookingOf(planOutside, ctx, from, to)).toBeNull(); // has a plan: the visit is not a booking
  });
});

describe('facts: risk, care plans and newborn', () => {
  it('grand multipara threshold from the hospital rule, and the fallback', () => {
    const rule = (o) => ({ riskRules: [{ key: 'grand_multipara', factor: 'para', op: 'gte', value: 5, ...o }] });
    expect(grandThreshold(rule())).toEqual({ n: 5, source: 'rule' });
    expect(grandThreshold(rule({ op: 'gt', value: 4 }))).toEqual({ n: 5, source: 'rule' });
    expect(grandThreshold({ riskRules: ANTENATAL_DRAFT.riskRules })).toEqual({ n: 4, source: 'rule' });
    expect(grandThreshold({ riskRules: [] })).toEqual({ n: 4, source: 'none' });
    expect(grandThreshold(null)).toEqual({ n: 4, source: 'none' });
    // A rule that does not say "at least n births" is not read (the risk engine reads 'eq' as exactly n).
    expect(grandThreshold(rule({ op: 'eq', value: 5 }))).toEqual({ n: 4, source: 'unreadable' });
    expect(grandThreshold(rule({ op: 'lt', value: 4 }))).toEqual({ n: 4, source: 'unreadable' });
    expect(grandThreshold(rule({ op: 'lte', value: 4 }))).toEqual({ n: 4, source: 'unreadable' });
    expect(grandThreshold(rule({ factor: 'gravida', value: 4 }))).toEqual({ n: 4, source: 'unreadable' });
    expect(grandThreshold(rule({ value: null }))).toEqual({ n: 4, source: 'unreadable' });
    expect(grandThreshold(rule({ value: 4.5 }))).toEqual({ n: 4, source: 'unreadable' });
    const notes = (template) => metricById('C4').notes(ctxOf({ patients: [], template }));
    expect(notes(rule())).toContain("Grand multipara uses the number of births in your hospital's risk rules.");
    expect(notes({ riskRules: [] })).toContain("Your hospital's risk rules have no grand multipara rule, so 4 or more births is used.");
    expect(notes(rule({ op: 'eq' }))).toContain(
      "Your hospital's grand multipara rule is not written as 'at least a number of births', so 4 or more births is used. A doctor can check the rule in the care plan settings.",
    );
    // The label follows the rule.
    const ctx = ctxOf({ patients: [], template: { riskRules: [{ key: 'grand_multipara', factor: 'para', op: 'gte', value: 5 }] } });
    expect(allCellDefs(metricById('C4'), ctx).find((c) => c.key === 'preg:grand').label).toBe('Grand multipara (5 or more births)');
  });

  it('anaemia bands', () => {
    expect([11.0, 10.9, 10.0, 9.9, 7.0, 6.9].map(hbBand)).toEqual(['none', 'mild', 'mild', 'moderate', 'moderate', 'severe']);
  });

  it('the EDD for gestation at birth: candidates in range, agreeing within 14 days, the plan first', () => {
    const birth = d('2026-06-17');
    const mother = (edd, scan = null) => ({ pregnancy: { effectiveEdd: edd ? d(edd) : null, scanEdd: scan ? d(scan) : null } });
    const pl = (edd, eddSource = 'lmp') => ({ basis: { edd: d(edd), eddSource } });
    expect(babyEdd(mother(null), [], birth)).toBeNull(); // nothing
    expect(babyEdd(mother('2027-06-01'), [], birth)).toBeNull(); // not in 20–45 weeks
    expect(babyEdd(mother('2026-07-20'), [pl('2026-07-01')], birth)).toBeNull(); // two in range, 19 days apart
    const e = babyEdd(mother('2026-07-20'), [pl('2026-07-10', 'scan')], birth); // 10 days apart: the plan's
    expect(isoDay(e.edd)).toBe('2026-07-10');
    expect(e.source).toBe('scan');
    const own = babyEdd(mother('2026-07-20', '2026-07-20'), [pl('2025-01-01')], birth); // the plan is of another pregnancy
    expect(isoDay(own.edd)).toBe('2026-07-20');
    expect(own.source).toBe('scan');
  });

  it('E4: a plan closed at 00:10 in India on the first day of the period is counted', () => {
    const period = parsePeriod({ period: '12m' }, { audience: 'doctor', today: T }); // from 1 Nov 2025
    const mum = pt({ pregnancy: { effectiveEdd: d('2026-03-01') } });
    const item = (key, o) => ({ ...newItem(ANTENATAL_DRAFT.items.find((t) => t.key === key)), _id: oid(), ...o });
    const closedPlan = (at) =>
      plan({
        patientId: mum._id,
        closed: { reason: 'delivered', at },
        bookedOn: d('2025-10-01'),
        basis: { edd: d('2026-03-01') },
        items: [item('lab_cbc', { state: 'done', done: { on: d('2025-10-30') }, auto: { applies: 'yes', phase: 'done', dueFrom: d('2025-10-20'), dueBy: d('2025-11-01') } })],
      });
    const count = (at) => {
      const ctx = ctxOf({ patients: [mum], fullPlans: [closedPlan(at)], period });
      computeSections(ctx, ['care']);
      return countOf(rawValue(ctx, 'E4.r:lab_cbc|c:onTime'));
    };
    expect(hospitalDayStart(d('2025-11-01')).toISOString()).toBe('2025-10-31T18:30:00.000Z');
    expect(count(new Date('2025-10-31T18:40:00Z'))).toBe(1); // 00:10 on 1 Nov in India
    expect(count(new Date('2025-10-31T18:20:00Z'))).toBe(0); // 23:50 on 31 Oct in India
  });

  // A plan built by the engine from the standard items for a mother booked on `bookedOn` with this EDD (as
  // antenatal), then saved in the given state with her type of care now `careType`. CBC is done on its first
  // due day; HIV stays open.
  function storedPlan({ bookedOn, edd, careType = 'antenatal', status = 'active', log = [], cbcDone = true }) {
    const mum = pt({ careType, createdAt: bookedOn, ageYears: 28, ageRecordedOn: bookedOn, obstetric: { gravida: 1, para: 0, abortions: 0, previousCaesareans: 0 }, medical: { allergies: 'None known', bloodGroup: 'O+', conditions: [], conditionsReviewed: true }, pregnancy: { effectiveEdd: edd, scanEdd: null } });
    const pl = { _id: oid(), patientId: mum._id, careType: 'antenatal', current: true, status: 'active', closed: null, bookedOn, basis: { edd, eddSource: 'lmp' }, eddReview: null, items: ANTENATAL_DRAFT.items.map((t) => ({ ...newItem(t), _id: oid() })), log: [] };
    derivePlan(pl, planFacts({ ...mum, careType: 'antenatal' }, NOW), { at: NOW, newIds: new Set(pl.items.map((i) => String(i._id))) });
    const cbc = pl.items.find((i) => i.key === 'lab_cbc');
    if (cbcDone) {
      cbc.state = 'done';
      cbc.done = { on: cbc.auto.dueFrom };
    }
    pl.status = status;
    pl.log = log;
    derivePlan(pl, planFacts(mum, NOW), { at: NOW });
    return { mum, pl, cbc, hiv: pl.items.find((i) => i.key === 'lab_hiv') };
  }
  const e4Of = (patients, fullPlans) => {
    const ctx = ctxOf({ patients, fullPlans, template: STANDARD_TEMPLATE });
    computeSections(ctx, ['care']);
    const v = (k) => countOf(rawValue(ctx, `E4.${k}`));
    return { ctx, v, e4: ctx.results.get('E4') };
  };

  describe('E4 on a paused current plan (type of care changed to postnatal)', () => {
    const bookedOn = addDays(T, -300);
    const edd = addDays(T, -50);
    const pausedAt = new Date(NOW.getTime() - 45 * 86_400_000); // T − 45, 10:00 in India

    it('(a) items due before the pause day count, done and open alike', () => {
      const { mum, pl, cbc, hiv } = storedPlan({ bookedOn, edd, careType: 'postnatal', status: 'paused', log: [{ action: 'paused', at: pausedAt }] });
      expect(utcDayOf(cbc.auto.dueBy) < addDays(T, -45) && utcDayOf(hiv.auto.dueBy) < addDays(T, -45)).toBe(true);
      const { ctx, v } = e4Of([mum], [pl]);
      expect(currentPlansNow(ctx).get(String(mum._id)).plan.status).toBe('paused');
      expect(isoDay(currentPlansNow(ctx).get(String(mum._id)).pausedOn)).toBe(isoDay(addDays(T, -45)));
      expect(v('r:lab_cbc|c:onTime')).toBe(1);
      expect(v('r:lab_hiv|c:notDone')).toBe(1);
      expect(v('r:lab_hiv|c:total')).toBe(1);
      expect(v('r:visits|c:notDone')).toBeGreaterThan(0); // her missed planned visits before the pause stay
    });

    it('(b) items due after the pause day are left out, done and open alike', () => {
      const probe = storedPlan({ bookedOn, edd });
      const first = [probe.cbc, probe.hiv].map((i) => utcDayOf(i.auto.dueBy)).sort((a, b) => a - b)[0];
      const at = new Date(addDays(first, -2).getTime() + 4.5 * 3600_000); // two days before either is due
      const { mum, pl } = storedPlan({ bookedOn, edd, careType: 'postnatal', status: 'paused', log: [{ action: 'paused', at }] });
      const { v } = e4Of([mum], [pl]);
      expect(v('r:lab_cbc|c:total')).toBe(0);
      expect(v('r:lab_hiv|c:total')).toBe(0);
    });

    it('(c) paused with no pause entry in the log: the whole plan is left out', () => {
      const { mum, pl } = storedPlan({ bookedOn, edd, careType: 'postnatal', status: 'paused', log: [] });
      const { v } = e4Of([mum], [pl]);
      expect(v('r:lab_cbc|c:total')).toBe(0);
      expect(v('r:lab_hiv|c:total')).toBe(0);
      expect(v('r:visits|c:total')).toBe(0);
    });

    it('(d) a saved active plan that the preview pauses: open items due up to yesterday count as not done', () => {
      const { mum, pl } = storedPlan({ bookedOn, edd, careType: 'postnatal', status: 'active' });
      const { ctx, v } = e4Of([mum], [pl]);
      expect(currentPlansNow(ctx).get(String(mum._id)).plan.status).toBe('paused');
      expect(isoDay(currentPlansNow(ctx).get(String(mum._id)).pausedOn)).toBe(isoDay(T));
      expect(v('r:lab_cbc|c:onTime')).toBe(1);
      expect(v('r:lab_hiv|c:notDone')).toBe(1);
      // The same plan while she is still antenatal gives the same row.
      const same = storedPlan({ bookedOn, edd });
      expect(e4Of([same.mum], [same.pl]).v('r:lab_hiv|c:notDone')).toBe(1);
    });
  });

  it('E4 lists: each not-done and late cell carries every woman’s due date, earliest first', () => {
    const early = storedPlan({ bookedOn: addDays(T, -200), edd: addDays(T, 60), cbcDone: false });
    const later = storedPlan({ bookedOn: addDays(T, -150), edd: addDays(T, 110), cbcDone: false });
    const dueOf = (x) => isoDay(x.pl.items.find((i) => i.key === 'lab_hbsag').auto.dueBy);
    expect(dueOf(early) < dueOf(later)).toBe(true);
    const { v, e4 } = e4Of([later.mum, early.mum], [later.pl, early.pl]);
    expect(v('r:lab_hbsag|c:notDone')).toBe(2);
    const due = e4.order.get('r:lab_hbsag|c:notDone');
    expect([...due.keys()].sort((a, b) => due.get(a).localeCompare(due.get(b)))).toEqual([String(early.mum._id), String(later.mum._id)]);
    expect(due.get(String(early.mum._id))).toBe(dueOf(early));
  });

  it('E4: a woman with the same item on a closed plan and on her current plan counts once, from the current plan', () => {
    const cur = storedPlan({ bookedOn: addDays(T, -100), edd: addDays(T, 100), cbcDone: false });
    const period = parsePeriod({ period: '12m' }, { audience: 'doctor', today: T });
    const old = plan({
      patientId: cur.mum._id,
      closed: { reason: 'pregnancy_ended', at: d('2025-12-01') },
      bookedOn: d('2025-10-01'),
      basis: { edd: d('2026-05-01') },
      items: [{ ...newItem(ANTENATAL_DRAFT.items.find((t) => t.key === 'lab_cbc')), _id: oid(), state: 'done', done: { on: d('2025-11-10') }, auto: { applies: 'yes', phase: 'done', dueFrom: d('2025-11-05'), dueBy: d('2025-11-15') } }],
    });
    expect(utcDayOf(cur.cbc.auto.dueBy) >= period.from && utcDayOf(cur.cbc.auto.dueBy) < T).toBe(true);
    const { ctx, v } = e4Of([cur.mum], [cur.pl, old]);
    expect(v('r:lab_cbc|c:total')).toBe(1);
    expect(v('r:lab_cbc|c:notDone')).toBe(1); // the current plan's, not the closed plan's on-time CBC
    expect(v('r:lab_cbc|c:onTime')).toBe(0);
    expect(metricById('E4').notes(ctx)).toContain('In the rows for one test, scan, vaccine or medicine, each woman counts once, from her newest care plan.');
  });
});

// ---------- Registry (section 6.8) ----------

// A small random hospital in memory (seeded), to check that every card's partitions add up.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Template items whose timing a doctor-added item copies in the random hospitals.
const CUSTOM_LIKE = ANTENATAL_DRAFT.items.filter((t) => ['scan_anomaly', 'lab_ogtt2', 'vacc_flu', 'lab_hb28'].includes(t.key));
const STANDARD_TEMPLATE = { items: ANTENATAL_DRAFT.items.map((t) => ({ key: t.key, name: t.name, appliesWhen: t.appliesWhen ?? 'always' })), riskRules: ANTENATAL_DRAFT.riskRules };

function randomHospital(seed) {
  const r = mulberry32(seed);
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (xs) => xs[int(0, xs.length - 1)];
  const maybe = (p, v) => (r() < p ? v : null);
  const doctors = [oid(), oid(), oid()];
  const patients = [];
  const plans = [];
  const fullPlans = [];
  const visits = [];
  const types = ['antenatal', 'antenatal', 'antenatal', 'postnatal', 'infertility', 'gynaecology', 'newborn'];
  const reasons = ['age_35', 'grand_multipara', 'prev_cs', 'rh_neg', 'diabetes', 'hypertension', 'short', 'bmi_high', 'hiv', 'teen', 'thyroid', 'epilepsy'];
  const missing = ['Age', 'Height', 'Weight', 'Gravida (G) – number of pregnancies', 'Blood group', 'Something else'];
  for (let i = 0; i < 70; i += 1) {
    const drawn = pick(types);
    // Every other gynaecology draw is an abortion patient (no extra random numbers: the other patients stay the same)
    const careType = drawn === 'gynaecology' && i % 2 === 1 ? 'abortion' : drawn;
    const created = new Date(NOW.getTime() - int(0, 520) * 86_400_000 - int(0, 23) * 3600_000);
    const createdDay = d(isoDay(new Date(created.getTime() + 330 * 60_000)));
    const p = pt({ careType, createdAt: created, assignedDoctor: pick([null, ...doctors]), sensitive: careType === 'infertility' || r() < 0.15 });
    p.ageYears = maybe(0.9, int(15, 44));
    p.ageRecordedOn = created;
    p.obstetric = { gravida: maybe(0.85, int(1, 6)), para: int(0, 5), abortions: 0, previousCaesareans: maybe(0.8, int(0, 3)) };
    p.medical = { bloodGroup: pick(['', 'O+', 'O-', 'A+', 'B-']), conditions: r() < 0.3 ? [pick(['diabetes', 'hiv', 'thyroid'])] : [], conditionsReviewed: r() < 0.5 };
    p.risk = {
      level: pick([null, 'high', 'moderate', 'low', 'incomplete']),
      reasons: Array.from({ length: int(0, 3) }, () => {
        const key = pick(reasons);
        return { key, label: `Reason ${key}` };
      }),
      missing: Array.from({ length: int(0, 2) }, () => pick(missing)),
    };
    if (['antenatal', 'postnatal'].includes(careType) && r() < 0.85) {
      p.pregnancy = { effectiveEdd: addDays(T, int(-380, 300)), scanEdd: null };
      if (r() < 0.75) {
        const bookedOn = addDays(createdDay, int(0, 40));
        if (bookedOn <= T) {
          const closed = r() < 0.3;
          const pl = plan({
            patientId: p._id,
            current: !closed,
            status: closed ? 'closed' : pick(['active', 'active', 'paused']),
            closed: closed ? { reason: pick(['delivered', 'pregnancy_ended', 'transferred_out', 'care_elsewhere', 'new_pregnancy', 'other']), at: new Date(NOW.getTime() - int(0, 400) * 86_400_000) } : null,
            bookedOn,
            basis: { edd: addDays(p.pregnancy.effectiveEdd, int(-70, 10)), eddSource: pick(['scan', 'lmp']) },
            eddReview: r() < 0.1 ? { toEdd: p.pregnancy.effectiveEdd } : null,
          });
          plans.push(pl);
          // The same plan in full: the standard items worked out by the engine, some marked by staff.
          const full = { ...pl, careType: 'antenatal', items: ANTENATAL_DRAFT.items.map((t) => ({ ...newItem(t), _id: oid() })) };
          // Sometimes an item a doctor added (it counts under "Other items"), timed like a template item.
          if (r() < 0.3) full.items.push({ ...newItem(pick(CUSTOM_LIKE)), key: `custom_${int(1, 999)}`, origin: 'custom', _id: oid() });
          // Sometimes an item is not on her plan (a plan made from an older template), so every item's numbers
          // vary on their own.
          full.items = full.items.filter(() => r() >= 0.08);
          derivePlan(full, planFacts(p, NOW), { at: NOW, newIds: new Set(full.items.map((it) => String(it._id))) });
          // Staff mark items in two rounds, so that items timed after another (Td-2 after Td-1) get marked too;
          // done anywhere from well before to well after the due date (on time and late).
          for (let round = 0; round < 2; round += 1) {
            for (const it of full.items) {
              if (it.state !== 'open' || !it.auto?.dueFrom) continue;
              const x = r();
              if (x < 0.35) {
                const on = addDays(it.auto.dueBy ?? it.auto.dueFrom, int(-45, 30));
                it.state = 'done';
                it.done = { on: on > T ? T : on, elsewhere: r() < 0.2 };
              } else if (x < 0.45) {
                it.state = 'not_needed';
                it.notNeeded = { reasonCode: 'declined' };
              }
            }
            derivePlan(full, planFacts(p, NOW), { at: NOW });
          }
          fullPlans.push(full);
        }
      }
    }
    if (careType === 'newborn') {
      p.newborn = {
        birthAt: new Date(NOW.getTime() - int(-3, 420) * 86_400_000 - int(0, 23) * 3600_000),
        mother: null,
        sex: pick(['', 'female', 'male', 'indeterminate']),
        birthWeightGrams: maybe(0.85, int(800, 4500)),
      };
      const mothers = patients.filter((m) => m.careType !== 'newborn');
      if (mothers.length && r() < 0.6) {
        const mother = pick(mothers);
        p.newborn.mother = mother._id;
        // Mostly born around her dates (term or preterm), as a linked baby usually is.
        const edd = mother.pregnancy?.effectiveEdd;
        const born = edd ? new Date(addDays(edd, -int(-14, 130)).getTime() + int(0, 23) * 3600_000) : null;
        if (born && r() < 0.8 && born <= new Date(NOW.getTime() + 3 * 86_400_000)) p.newborn.birthAt = born;
      }
      // Sometimes a twin: the next baby of the same mother, a few minutes later.
      if (p.newborn.mother && r() < 0.2) {
        patients.push(p);
        const twin = pt({ careType, createdAt: created, assignedDoctor: p.assignedDoctor, sensitive: false });
        twin.newborn = { ...p.newborn, birthAt: new Date(p.newborn.birthAt.getTime() + int(1, 60) * 60_000), sex: pick(['female', 'male']) };
        patients.push(twin);
        continue;
      }
    }
    patients.push(p);
    for (let k = int(0, 5); k > 0; k -= 1) {
      const on = addDays(createdDay, int(0, 400));
      if (on > T) continue;
      visits.push(
        visitOf(p, isoDay(on), {
          careType: r() < 0.85 ? careType : pick(types),
          status: r() < 0.1 ? 'cancelled' : 'active',
          createdAt: new Date(on.getTime() + int(1, 20) * 3600_000),
          vitals: {
            bpSystolic: maybe(0.8, int(95, 170)),
            bpDiastolic: maybe(0.8, int(55, 115)),
            hb: maybe(0.6, int(60, 130) / 10),
            weightKg: maybe(0.7, int(45, 90)),
            urineAlbumin: pick(['', 'nil', 'trace', '1+', '2+']),
          },
          details: { nextVisitOn: r() < 0.5 ? addDays(on, int(3, 40)) : null, presentation: pick(['', '', 'cephalic', 'breech']), fetalHeartRate: maybe(0.5, 140), fundalHeightCm: maybe(0.5, 28) },
        }),
      );
    }
  }
  // Deliveries tab: confirmed delivery notes of some mothers (one or two each, sometimes twins or triplets, every
  // answer and every "not recorded"), and deaths recorded on some records – drawn from a random stream of their own,
  // so that every patient and visit above stays the same for a given seed.
  const r2 = mulberry32(seed * 7919 + 17);
  const int2 = (a, b) => a + Math.floor(r2() * (b - a + 1));
  const pick2 = (xs) => xs[int2(0, xs.length - 1)];
  const deliveries = [];
  for (const p of patients) {
    if (p.careType !== 'newborn' && r2() < 0.35) {
      for (let k = r2() < 0.15 ? 2 : 1; k > 0; k -= 1) {
        const babies = r2() < 0.12 ? (r2() < 0.2 ? 3 : 2) : 1;
        deliveries.push({
          _id: oid(),
          patientId: p._id,
          content: {
            deliveredAt: new Date(NOW.getTime() - int2(0, 430) * 86_400_000 - int2(0, 23) * 3_600_000).toISOString(),
            mode: pick2(['normal', 'normal', 'normal', 'lscs', 'lscs', 'vacuum', 'forceps', 'other', '']),
            pph: pick2(['yes', 'no', 'no', 'no', '']),
            babies: Array.from({ length: babies }, () => ({
              outcome: pick2(['live', 'live', 'live', 'live', 'live', 'stillbirth', 'stillbirth', '']),
              stillbirthType: pick2(['fresh', 'macerated', '']),
              apgar5: pick2([null, 2, 5, 6, 7, 8, 9, 10]),
              breastfedWithinHour: pick2(['yes', 'yes', 'no', 'not_applicable', '']),
              nicu: pick2(['yes', 'no', 'no', '']),
            })),
          },
        });
      }
    }
    if (r2() < 0.1) {
      const on = addDays(T, -int2(0, 430));
      p.death = p.careType === 'newborn' ? { on, ageDays: pick2([0, 3, 6, 7, 20, 27, 28, 60, null]) } : { on, timing: pick2(['pregnancy', 'delivery', 'postpartum', 'other']) };
    }
  }
  return { patients, plans, fullPlans, visits, doctors, template: STANDARD_TEMPLATE, deliveries };
}

describe('registry', () => {
  const sampleCtx = (o = {}) => ctxOf({ patients: [], ...o });

  it('the website has the same role lists', () => {
    expect(websiteRoles.ANALYTICS_ROLES).toEqual(roles.ANALYTICS_ROLES);
    expect(websiteRoles.DRILLDOWN_ROLES).toEqual(roles.DRILLDOWN_ROLES);
    expect(websiteRoles.EXACT_ROLES).toEqual(roles.EXACT_ROLES);
    expect(roles.ANALYTICS_ROLES).toEqual(['doctor', 'admin']);
    expect(roles.PLATFORM_MIN_DENOMINATOR).toBe(0);
  });

  it('audiences: doctor wins over admin; other roles have none', () => {
    const req = (r, sa = false) => ({ user: { isSuperAdmin: sa }, membership: r ? { roles: r } : null });
    expect(roles.audienceOf(req(null, true))).toBe('platform');
    expect(roles.audienceOf(req(['doctor', 'admin']))).toBe('doctor');
    expect(roles.audienceOf(req(['admin']))).toBe('admin');
    for (const r of ['rmo', 'nurse', 'receptionist', 'lab']) expect(roles.audienceOf(req([r]))).toBeNull();
  });

  it('every section is known and every card sits in one', () => {
    for (const m of METRICS) expect(SECTIONS).toContain(m.section);
    expect(metricsOfSection('overview').map((m) => m.id)).toEqual(['A1', 'A4', 'V1', 'DQ']);
    expect(metricsOfSection('pregnancy').map((m) => m.id)).toEqual(['A2', 'A3', 'D9', 'D10', 'B1']);
    expect(metricsOfSection('risk').map((m) => m.id)).toEqual(['C1', 'C2', 'C9', 'C4', 'D1', 'D3', 'D4', 'D6']);
    expect(metricsOfSection('care').map((m) => m.id)).toEqual(['E1', 'E4', 'B4']);
    expect(metricsOfSection('newborn').map((m) => m.id)).toEqual(['G1', 'G2', 'G3', 'G6']);
    expect(metricsOfSection('deliveries').map((m) => m.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']);
    // Hospital admins never get the reasons or the missing-information rows.
    expect(metricsOfSection('risk', 'admin').map((m) => m.id)).toEqual(['C1', 'C4', 'D1', 'D3', 'D4', 'D6']);
    // … nor births, stillbirths, Apgar, NICU, breastfeeding or deaths (roles.js ADMIN_HIDDEN).
    expect(metricsOfSection('deliveries', 'admin').map((m) => m.id)).toEqual(['H1', 'H2']);
    for (const id of ['H3', 'H4', 'H5', 'H6', 'H7']) expect(roles.ADMIN_HIDDEN, id).toContain(id);
    expect(metricsOfSection('deliveries', 'platform').map((m) => m.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']);
    // A new tab is worked out last (the protection of the numbers before it stays as it was).
    expect(SECTIONS.at(-1)).toBe('deliveries');
  });

  it('the website has the same tabs (Deliveries before Newborn on the page)', () => {
    // Read as text: the website's file also imports its screens' components.
    const text = readFileSync(new URL('../../client/src/pages/analytics/analyticsFormat.js', import.meta.url), 'utf8');
    const website = JSON.parse(text.match(/export const SECTIONS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
    expect([...website].sort()).toEqual([...SECTIONS].sort());
    expect(website.slice(-2)).toEqual(['deliveries', 'newborn']);
    expect(text).toMatch(/deliveries: 'Deliveries'/);
  });

  it('the website has the same condition labels', () => {
    expect(CONDITION_LABELS).toEqual(websitePatientFormat.CONDITION_LABELS);
    expect(Object.keys(CONDITION_LABELS).sort()).toEqual([...CONDITIONS].sort());
  });

  it('rows kept from hospital admins are not computed for them', () => {
    const h = randomHospital(7);
    const period = parsePeriod({ period: 'last_12m' }, { audience: 'admin', today: T });
    const ctx = ctxOf({ ...h, period, audience: 'admin' });
    const { cards } = computeSections(ctx, ['risk', 'care', 'newborn', 'deliveries']);
    expect(cards).not.toContain('C2');
    expect(cards).not.toContain('C9');
    for (const id of ['H3', 'H4', 'H5', 'H6', 'H7']) expect([...ctx.results.keys()], id).not.toContain(id);
    expect(cards).toEqual(expect.arrayContaining(['H1', 'H2']));
    const keys = (id) => Object.keys(ctx.results.get(id).cells);
    expect(keys('C4').some((k) => k.startsWith('blood:'))).toBe(false);
    expect(keys('D1').filter((k) => CONDITIONS.includes(k))).toEqual([]);
    expect(keys('D3').sort()).toEqual(['high', 'normal', 'total']);
    expect(keys('D4')).toContain('modSevere');
    expect(keys('D4')).not.toContain('moderate');
    expect(keys('D4')).not.toContain('severe');
    const rows = tableOf(metricById('E4'), ctx).rows.map((r) => r.key);
    for (const k of ['lab_ict1', 'lab_ict28', 'anti_d', 'scan_doppler']) expect(rows).not.toContain(k);
    expect(rows).toContain('lab_hiv');
  });

  it('codes are unique per card and never contain a word', () => {
    for (const careType of ['all', ...CARE_TYPE_KEYS]) {
      for (const period of ['12m', 'this_month']) {
        const ctx = sampleCtx({ careType, period: parsePeriod({ period }, { audience: 'doctor', today: T }) });
        for (const m of METRICS) {
          const codes = allCellDefs(m, ctx)
            .filter((c) => !c.virtual)
            .map((c) => c.code);
          expect(new Set(codes).size, m.id).toBe(codes.length);
          for (const c of codes) expect(c, `${m.id} ${c}`).toMatch(/^(c\d{1,2}|b[mw]\d{6,8}|k[0-9a-f]{8})$/);
        }
      }
    }
  });

  it('D1 condition codes stay clear of the reserved known/unknown codes (c98, c99)', () => {
    expect(CONDITIONS.length, 'CONDITIONS would reach the reserved codes c98/c99: give known/unknown new codes first').toBeLessThan(98);
    const ctx = sampleCtx();
    const D1 = metricById('D1');
    expect(cellByCode(D1, 'c98', ctx)?.key).toBe('known');
    expect(cellByCode(D1, 'c99', ctx)?.key).toBe('unknown');
    expect(allCellDefs(D1, ctx).filter((c) => c.group === 'rows').map((c) => c.code)).toEqual(CONDITIONS.map((_, i) => `c${i + 1}`));
  });

  it('no relation mixes "as of today" and period cells', () => {
    for (const careType of ['all', ...CARE_TYPE_KEYS]) {
      const ctx = sampleCtx({ careType });
      for (const r of relations(ctx)) {
        const ids = r.kind === 'partition' ? [r.total, ...r.parts] : [r.sub, r.sup];
        const windows = new Set(ids.map((g) => globalCellWindow(g, ctx)));
        expect(windows.size, `${r.metric}: ${ids.join(', ')}`).toBe(1);
      }
    }
  });

  it('every shared cell resolves under every filter, to a shown (not virtual) cell with the same window', () => {
    for (const careType of ['all', ...CARE_TYPE_KEYS]) {
      const ctx = sampleCtx({ careType });
      for (const m of METRICS) {
        for (const def of allCellDefs(m, ctx)) {
          if (!def.same) continue;
          const where = `${m.id}.${def.key} -> ${def.same} (${careType})`;
          expect(() => globalCellWindow(def.same, ctx), where).not.toThrow();
          expect(globalCellWindow(def.same, ctx), where).toBe(cellWindow(m, def));
          const [mid, key] = splitGlobal(def.same);
          const source = cellDef(metricById(mid), key, ctx);
          expect(source?.virtual, where).toBeFalsy();
          // A shared cell that opens a list opens the source cell's patients: the source must be listable too.
          if (def.list) {
            expect(source.list, where).toBe(true);
            expect(source.code, where).toMatch(/^c\d+$/);
          }
        }
      }
    }
    expect(globalCellWindow('A4.v:postnatal', sampleCtx({ careType: 'antenatal' }))).toBe('period');
    expect(globalCellWindow('A1.postnatal', sampleCtx({ careType: 'antenatal' }))).toBe('period');
  });

  it('under a type-of-care filter, the other types stay defined but are not shown on A1 and A4', () => {
    const ctx = sampleCtx({ careType: 'postnatal' });
    const shown = (id) => shownCellsOf(metricById(id), ctx).filter((c) => c.group !== 'trend').map((c) => c.key);
    expect(shown('A1')).toEqual(['postnatal']);
    expect(shown('A4')).toEqual(['new', 'followUp']);
    expect(cellByCode(metricById('A1'), 'c2', ctx)?.key).toBe('postnatal');
    expect(cellByCode(metricById('A1'), 'c1', ctx)).toBeNull(); // antenatal: not on the card under this filter
    expect(cellByCode(metricById('A1'), 'c1', sampleCtx())?.key).toBe('antenatal');
    expect(shownCellsOf(metricById('A4'), sampleCtx()).some((c) => c.key === 'all')).toBe(false); // the tile's cell
  });

  it('declared number links: visits recorded, the filtered visits, and a shared list cell', () => {
    const typeParts = CARE_TYPE_KEYS.map((t) => `A4.v:${t}`);
    for (const careType of ['all', 'postnatal']) {
      const rs = relations(sampleCtx({ careType }));
      const has = (total, parts) => rs.some((r) => r.kind === 'partition' && r.total === total && JSON.stringify(r.parts) === JSON.stringify(parts));
      expect(has('DQ.allVisits', ['A4.all', 'DQ.dq4']), careType).toBe(true);
      expect(has('A4.all', typeParts), careType).toBe(true);
      expect(has('A4.total', careType === 'all' ? typeParts : ['A4.v:postnatal']), careType).toBe(true);
    }
    const ctx = sampleCtx();
    expect(cellByCode(metricById('DQ'), 'c3', ctx)?.key).toBe('dq2');
    expect(globalCellId(metricById('DQ'), 'dq2', ctx)).toBe('A2.noEdd');
    expect(cellByCode(metricById('DQ'), 'c5', ctx)).toBeNull(); // dq4: visits, never a list
    expect(cellByCode(metricById('D9'), 'c4', ctx)).toBeNull(); // the footnote
    expect(cellByCode(metricById('V1'), 'c2', ctx)).toBeNull(); // visits of this type
    // B4's antenatal visits are A4's (one global cell), and its rows add up to them.
    expect(globalCellId(metricById('B4'), 'total', ctx)).toBe('A4.v:antenatal');
    const rs = relations(ctx);
    expect(rs.some((r) => r.kind === 'partition' && r.total === 'A4.v:antenatal' && JSON.stringify(r.parts) === JSON.stringify(['B4.bp', 'B4.bpNo']))).toBe(true);
  });

  it('on random hospitals: partitions add up, and every listable cell is a Set of visible, in-scope patients', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 25; seed += 1) {
      const h = randomHospital(seed);
      const me = h.doctors[seed % 3];
      const visible = new Set(h.patients.filter((p) => !p.sensitive || String(p.assignedDoctor) === String(me) || !p.assignedDoctor).map((p) => String(p._id)));
      for (const [scope, periodKey, careType] of [
        ['hospital', '12m', 'all'],
        ['mine', '6m', 'all'],
        ['hospital', 'this_month', 'antenatal'],
        ['hospital', '3m', 'newborn'],
      ]) {
        const period = parsePeriod({ period: periodKey }, { audience: 'doctor', today: T });
        const ctx = ctxOf({ ...h, period, scope, careType, userId: me, visible });
        const { cards } = computeSections(ctx, SECTIONS);
        const value = (g) => {
          const i = g.indexOf('.');
          return countOf(ctx.results.get(g.slice(0, i)).cells[g.slice(i + 1)]);
        };
        for (const r of relations(ctx, cards)) {
          if (r.kind === 'subset') {
            expect(value(r.sub), `seed ${seed}: ${r.sub} ≤ ${r.sup}`).toBeLessThanOrEqual(value(r.sup));
            continue;
          }
          expect(
            r.parts.reduce((s, g) => s + value(g), 0),
            `seed ${seed} ${scope} ${periodKey} ${careType}: ${r.total}`,
          ).toBe(value(r.total));
        }
        // The random hospitals really exercise the cards.
        if (scope === 'hospital' && periodKey === '12m') {
          for (const g of ['E1.plans', 'E4.r:lab_cbc|c:total', 'D3.total', 'D4.total', 'D6.total', 'C2.other', 'G2.total', 'G3.weighed', 'G6.known', 'H1.total', 'H3.still', 'H4.low', 'H7.newborn', 'H7.maternal']) {
            seen.add(value(g) > 0 ? g : null);
          }
        }
        // E4 lists sort by due date: every woman in a listable E4 cell has her due date in that cell's order.
        const e4 = ctx.results.get('E4');
        for (const def of allCellDefs(metricById('E4'), ctx)) {
          if (!def.list) continue;
          const ids = [...e4.cells[def.key]].sort();
          expect([...(e4.order.get(def.key)?.keys() ?? [])].sort(), `seed ${seed}: E4 ${def.key} order`).toEqual(ids);
        }
        const inScope = new Set(ctx.patientsInScope.map((p) => String(p._id)));
        for (const id of cards) {
          const m = METRICS.find((x) => x.id === id);
          for (const def of allCellDefs(m, ctx)) {
            if (!def.list) continue;
            const raw = rawValue(ctx, globalCellId(m, def.key, ctx)); // a shared cell: the source card's Set
            expect(raw, `${id}.${def.key} is a Set`).toBeInstanceOf(Set);
            for (const entry of raw) {
              const pid = patientOfUnit(entry); // a delivery or a baby: its mother's entry (facts.js unitKey)
              expect(visible.has(pid)).toBe(true);
              expect(inScope.has(pid)).toBe(true);
            }
          }
        }
      }
    }
    seen.delete(null);
    expect([...seen].sort()).toEqual(['C2.other', 'D3.total', 'D4.total', 'D6.total', 'E1.plans', 'E4.r:lab_cbc|c:total', 'G2.total', 'G3.weighed', 'G6.known', 'H1.total', 'H3.still', 'H4.low', 'H7.newborn', 'H7.maternal'].sort());
  });
});

// ---------- Patient lists (section 3.6) ----------

describe('patient lists', () => {
  const pickKeys = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
  it('every card that opens lists names a known order, and every order reads only loaded fields', () => {
    const loaded = PATIENT_FIELDS.split(' ');
    const listed = METRICS.filter((m) => m.list);
    expect(listed.length).toBeGreaterThan(10);
    for (const m of listed) {
      expect(Object.keys(LIST_ORDERS), m.id).toContain(m.list.order);
      expect(m.audiences, m.id).toContain('doctor');
    }
    for (const [key, o] of Object.entries(LIST_ORDERS)) for (const f of [...o.fields, ...LIST_TIE_FIELDS]) expect(loaded, key).toContain(f);
    // Cards that never open a list: sex at birth, visits, the visit record.
    for (const id of ['G2', 'A4', 'B4']) expect(metricById(id).list, id).toBeUndefined();
  });

  it('list order: by the card’s value, patients without one last, then by the date the record was made, then id', () => {
    const at = (iso) => new Date(`${iso}T05:00:00Z`);
    const byId = new Map([
      ['a1', { _id: 'a1', createdAt: at('2026-01-03') }],
      ['a2', { _id: 'a2', createdAt: at('2026-01-01') }],
      ['a3', { _id: 'a3', createdAt: at('2026-01-02') }],
      ['a4', { _id: 'a4', createdAt: at('2026-01-02') }],
    ]);
    const details = new Map([
      ['a1', { type: 'ga', weeks: 30, days: 1 }],
      ['a2', null],
      ['a3', { type: 'ga', weeks: 30, days: 1 }],
      ['a4', { type: 'ga', weeks: 38, days: 0 }],
    ]);
    expect(sortIds(new Set(byId.keys()), { orderKey: 'gaDesc', byId, details })).toEqual(['a4', 'a3', 'a1', 'a2']);
    expect(sortIds(new Set(byId.keys()), { orderKey: 'gaAsc', byId, details })).toEqual(['a3', 'a1', 'a4', 'a2']);
    const hb = new Map([
      ['a1', { type: 'hb', value: 9.6, on: '2026-10-03' }],
      ['a2', { type: 'hb', value: 6.8, on: '2026-10-12' }],
    ]);
    expect(sortIds(new Set(['a1', 'a2']), { orderKey: 'hbAsc', byId, details: hb })).toEqual(['a2', 'a1']);
    const bp = new Map([
      ['a1', { type: 'bp', sys: 150, dia: 96, on: '2026-10-03' }],
      ['a2', { type: 'bp', sys: 164, dia: 112, on: '2026-09-25' }],
      ['a3', { type: 'bp', sys: 150, dia: 100, on: '2026-09-25' }],
    ]);
    expect(sortIds(new Set(['a1', 'a2', 'a3']), { orderKey: 'bpDesc', byId, details: bp })).toEqual(['a2', 'a3', 'a1']);
    const due = new Map([
      ['a1', '2026-08-01'],
      ['a2', '2026-09-01'],
      ['a3', '2026-07-15'],
    ]);
    expect(sortIds(new Set(['a1', 'a2', 'a3']), { orderKey: 'dueAsc', byId, details: new Map(), due })).toEqual(['a3', 'a1', 'a2']);
    expect(() => sortIds(new Set(['a1']), { orderKey: 'nameAsc', byId, details })).toThrow(/Unknown analytics list order/);
  });

  it('a record that can no longer be opened is counted in "restricted" and never listed; rows keep only the whitelist', async () => {
    const me = oid();
    const other = oid();
    const tenantId = oid();
    const req = { user: { _id: me }, membership: { roles: ['doctor'] }, tenantId };
    const ids = [oid(), oid(), oid()].map(String);
    const made = (i) => new Date(Date.UTC(2026, 0, 1 + i));
    const byId = new Map(ids.map((id, i) => [id, { _id: id, createdAt: made(i) }]));
    const details = new Map(ids.map((id, i) => [id, { type: 'ga', weeks: 30 - i, days: 0 }]));
    const fresh = [
      // Fine: Dr "me"'s own patient. The row fetched carries fields a list must never pass on.
      {
        _id: ids[0],
        tenantId,
        mrn: 'P-000101',
        fullName: 'Sample List 01',
        careType: 'antenatal',
        ageYears: 30,
        ageRecordedOn: made(0),
        createdAt: made(0),
        assignedDoctor: me,
        sensitive: false,
        pregnancy: { effectiveEdd: new Date('2026-12-01T00:00:00Z'), lmp: new Date('2026-02-24T00:00:00Z') },
        risk: { level: 'high', override: { reason: 'typed text' } },
        newborn: { sex: 'male', birthWeightGrams: 3000 },
        notes: 'typed text',
        medical: { allergies: 'None known', bloodGroup: 'O-' },
        obstetric: { gravida: 2 },
      },
      // Became sensitive for another doctor between the count and the page: identity only now.
      { _id: ids[1], tenantId, mrn: 'P-000102', fullName: 'Sample List 02', careType: 'antenatal', createdAt: made(1), assignedDoctor: other, sensitive: true },
      // ids[2] is not returned at all.
    ];
    const asked = [];
    const out = await listPage(
      req,
      { ids: new Set(ids), byId, details, orderKey: 'gaDesc', now: NOW, page: 1, limit: 25 },
      {
        fetchRows: async (tid, pageIds) => {
          asked.push([tid, pageIds]);
          return fresh;
        },
        fetchNames: async (docIds) => new Map(docIds.map((x) => [x, 'Dr Sample'])),
      },
    );
    expect(asked).toEqual([[tenantId, ids]]); // this hospital, only the page's ids
    expect(pickKeys(out, ['count', 'restricted', 'total', 'page', 'limit', 'totalPages'])).toEqual({ count: 3, restricted: 2, total: 1, page: 1, limit: 25, totalPages: 1 });
    expect(out.patients).toHaveLength(1);
    const row = out.patients[0];
    expect([...LIST_ROW_KEYS].sort()).toEqual([...SPEC_LIST_ROW_KEYS].sort());
    expect(Object.keys(row).sort()).toEqual([...SPEC_LIST_ROW_KEYS].sort()); // Dr "me"'s own, non-sensitive patient: every whitelisted key, nothing else
    expect(row).toMatchObject({
      id: ids[0],
      mrn: 'P-000101',
      fullName: 'Sample List 01',
      careType: 'antenatal',
      currentAge: 30,
      assignedDoctorName: 'Dr Sample',
      sensitive: false,
      gestationalAge: { weeks: 33, days: 2 }, // EDD 1 Dec 2026, today 15 Oct 2026
      edd: '2026-12-01',
      riskLevel: 'high',
      bornOn: null,
      detail: { type: 'ga', weeks: 30, days: 0 },
    });
    expect(row.access.canViewCarePlan).toBe(true);
    for (const k of ['newborn', 'sex', 'override', 'notes', 'medical', 'obstetric', 'pregnancy', 'risk']) expect(JSON.stringify(row)).not.toContain(`"${k}"`);
    expect(JSON.stringify(row)).not.toMatch(/male|typed text|O-|3000/);

    // Page 2 of 2 (limit 2): only the last id is fetched.
    asked.length = 0;
    const p2 = await listPage(req, { ids: new Set(ids), byId, details, orderKey: 'gaDesc', now: NOW, page: 2, limit: 2 }, { fetchRows: async (tid, pageIds) => (asked.push(pageIds), []), fetchNames: async () => new Map() });
    expect(asked).toEqual([[ids[2]]]);
    expect(pickKeys(p2, ['count', 'restricted', 'total', 'totalPages'])).toEqual({ count: 3, restricted: 1, total: 2, totalPages: 2 });
  });
});

// ---------- Small numbers for hospital admins (section 3.5) ----------

const shownCells = (shown, virtual = {}) =>
  new Map([...Object.entries(shown).map(([k, v]) => [k, { value: v, shown: true }]), ...Object.entries(virtual).map(([k, v]) => [k, { value: v, shown: false }])]);
const partition = (total, ...parts) => ({ kind: 'partition', total, parts });
const subset = (sub, sup) => ({ kind: 'subset', sub, sup });

/**
 * Runs two readers on what the masking would send: the masking's own range check (rangeCheck) and an independent
 * one (maskReader.js: the sums solved modulo two primes, then ranges narrowed through the sums and the solved
 * equations). Every range must hold the true number (both are sound); returns the small numbers (shown, withheld
 * or never shown) either reader could pin down.
 */
function pinnedAfter(cells, rels, result) {
  const atLeastOne = new Set([...cells].filter(([, c]) => c.atLeastOne).map(([id]) => id));
  const ranges = rangeCheck(new Map(result.values), rels, { atLeastOne });
  for (const [id, c] of cells) {
    const r = ranges.get(id);
    if (r && c.value != null) expect(r.lo <= c.value && c.value <= r.hi, `${id} = ${c.value} outside [${r.lo}, ${r.hi}]`).toBe(true);
  }
  const pinned = new Set();
  for (const [id, v] of result.values) if ((v === LT5 || (v === WITHHELD && cells.get(id).value >= 1)) && ranges.get(id).lo === ranges.get(id).hi) pinned.add(id);
  for (const id of result.sensitive) if (ranges.get(id) && ranges.get(id).lo === ranges.get(id).hi) pinned.add(id);
  const other = readerPins(cells, rels, result.values, { sensitive: result.sensitive, atLeastOne });
  expect(other.wrong).toEqual([]);
  for (const id of other.pinned) pinned.add(id);
  return [...pinned].sort();
}

describe('small numbers for hospital admins', () => {
  it('"x of 40, x = 3": fewer than 5 of 40; a shown complement of 37 would give it away, so it is hidden', () => {
    const rels = [partition('total', 'x', 'rest')];
    const a = maskForAdmin(shownCells({ total: 40, x: 3 }, { rest: 37 }), rels);
    expect(Object.fromEntries(a.values)).toEqual({ total: 40, x: LT5 });
    expect(a.hiddenForProtection).toEqual([]);
    expect(rangeCheck(new Map(a.values), rels).get('x')).toEqual({ lo: 1, hi: 4 });
    const b = maskForAdmin(shownCells({ total: 40, x: 3, rest: 37 }), rels);
    expect(Object.fromEntries(b.values)).toEqual({ total: 40, x: LT5, rest: HIDDEN });
    expect(pinnedAfter(shownCells({ total: 40, x: 3, rest: 37 }), rels, b)).toEqual([]);
  });

  it('6 = 1 + 5: the 5 is hidden, then (the 1 is still pinned) the total, everywhere it is shown', () => {
    const rels = [partition('total', 'one', 'five')];
    const r = maskForAdmin(shownCells({ total: 6, one: 1, five: 5 }), rels);
    expect(r.hiddenForProtection).toEqual(['five', 'total']);
    expect(Object.fromEntries(r.values)).toEqual({ total: HIDDEN, one: LT5, five: HIDDEN });
    expect(rangeCheck(new Map(r.values), rels).get('one')).toEqual({ lo: 1, hi: 4 });
  });

  it('the fixture trimesters (1, 2, 5, 0 and 1 of 9): three small numbers, each between 1 and 2, nothing hidden', () => {
    const rels = [partition('total', 't1', 't2', 't3', 'check', 'noEdd')];
    const r = maskForAdmin(shownCells({ total: 9, t1: 1, t2: 2, t3: 5, check: 0, noEdd: 1 }), rels);
    expect(Object.fromEntries(r.values)).toEqual({ total: 9, t1: LT5, t2: LT5, t3: 5, check: 0, noEdd: LT5 });
    const ranges = rangeCheck(new Map(r.values), rels);
    for (const k of ['t1', 't2', 'noEdd']) expect(ranges.get(k)).toEqual({ lo: 1, hi: 2 });
  });

  it('a trend and categories sharing one total: each small number is protected in its own sum', () => {
    const rels = [partition('total', 'a', 'b'), partition('total', 'm1', 'm2')];
    const cells = shownCells({ total: 10, a: 3, b: 7, m1: 6, m2: 4 });
    const r = maskForAdmin(cells, rels);
    expect(r.hiddenForProtection).toEqual(['b', 'm1']);
    expect(Object.fromEntries(r.values)).toEqual({ total: 10, a: LT5, b: HIDDEN, m1: HIDDEN, m2: LT5 });
    expect(pinnedAfter(cells, rels, r)).toEqual([]);
  });

  it('"x of y" whose unshown complement is 1 to 4: the complement stays unknown', () => {
    const rels = [partition('total', 'x', 'rest')];
    const r = maskForAdmin(shownCells({ total: 20, x: 17 }, { rest: 3 }), rels);
    expect([...r.sensitive]).toEqual(['rest']);
    expect(Object.fromEntries(r.values)).toEqual({ total: 20, x: HIDDEN });
    expect(rangeCheck(new Map(r.values), rels).get('rest')).toEqual({ lo: 0, hi: 15 });
  });

  it('a subset relation that pins a small number is taken into account', () => {
    // T = a + b (5 = 1 + 4); U = s + h (9 = 4 + 5, s never shown); s ≤ b. From U and h, s = 4, so b ≥ 4, b = 4, a = 1.
    const cells = shownCells({ T: 5, a: 1, b: 4, U: 9, h: 5 }, { s: 4 });
    const withSubset = [partition('T', 'a', 'b'), partition('U', 's', 'h'), subset('s', 'b')];
    const first = rangeCheck(new Map([...cells].filter(([, c]) => c.shown).map(([k, c]) => [k, c.value > 4 ? c.value : LT5])), withSubset);
    expect(first.get('b')).toEqual({ lo: 4, hi: 4 });
    const without = rangeCheck(new Map([...cells].filter(([, c]) => c.shown).map(([k, c]) => [k, c.value > 4 ? c.value : LT5])), withSubset.slice(0, 2));
    expect(without.get('b')).toEqual({ lo: 1, hi: 4 });
    const r = maskForAdmin(cells, withSubset);
    expect(pinnedAfter(cells, withSubset, r)).toEqual([]);
    expect(r.values.get('h')).toEqual(HIDDEN);
  });

  it('4 = 1 + 1 + 1 + 1 + 0 (nothing exact left to hide): the small numbers and the zero are withheld (0 to 4, "Not shown")', () => {
    const rels = [partition('total', 'a', 'b', 'c', 'd', 'e')];
    const cells = shownCells({ total: 4, a: 1, b: 1, c: 1, d: 1, e: 0 });
    // Before: the total is at least 4 (four parts of at least 1) and at most 4, so each part is exactly 1.
    const before = rangeCheck(new Map([['total', LT5], ['a', LT5], ['b', LT5], ['c', LT5], ['d', LT5], ['e', 0]]), rels);
    expect(before.get('a')).toEqual({ lo: 1, hi: 1 });
    const r = maskForAdmin(cells, rels);
    expect(r.hiddenForProtection).toEqual([]);
    expect(r.withheld.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'total']);
    for (const v of r.values.values()) expect(v).toEqual(WITHHELD);
    expect(pinnedAfter(cells, rels, r)).toEqual([]);
    expect(rangeCheck(new Map(r.values), rels).get('a')).toEqual({ lo: 0, hi: 4 });
  });

  it('small numbers pinned through another sum: the exact number that pins them is hidden, however far', () => {
    // A month of 4 (fewer than 5) is pinned by its quarter (20 = 8 + 8 + 4); the month is split into 1 + 3.
    const rels = [partition('quarter', 'jul', 'aug', 'sep'), partition('sep', 'x', 'y')];
    const cells = shownCells({ quarter: 20, jul: 8, aug: 8, sep: 4, x: 1, y: 3 });
    const r = maskForAdmin(cells, rels);
    expect(r.hiddenForProtection).toEqual(['aug']);
    expect(r.withheld).toEqual([]);
    expect(pinnedAfter(cells, rels, r)).toEqual([]);
  });

  it('two sums on one card: 20 − 18 = 2 gives away "No care plan" (E1), so the total or "With a care plan" is hidden', () => {
    // A2.total = no plan + on hold + overdue + on track; with a plan = on hold + overdue + on track.
    const rels = [partition('total', 'noPlan', 'onHold', 'overdue', 'onTrack'), partition('plans', 'onHold', 'overdue', 'onTrack')];
    const cells = shownCells({ total: 20, noPlan: 2, onHold: 3, overdue: 4, onTrack: 11, plans: 18 });
    // Each sum alone leaves "No care plan" between 1 and 3; the two together fix it at 2.
    const naive = new Map([['total', 20], ['noPlan', LT5], ['onHold', LT5], ['overdue', LT5], ['onTrack', 11], ['plans', 18]]);
    expect(rangeCheck(naive, rels).get('noPlan')).toEqual({ lo: 2, hi: 2 });
    const r = maskForAdmin(cells, rels);
    expect(r.values.get('total') === HIDDEN || r.values.get('plans') === HIDDEN).toBe(true);
    expect(r.hiddenForProtection).not.toEqual(['onTrack']); // on track cancels out of 20 − 18: hiding it alone does nothing
    expect(pinnedAfter(cells, rels, r)).toEqual([]);
  });

  it('the seed-3 pattern: 8 = 5 + x + y + 0 and "with a care plan" = x + y + 0 (fewer than 5) is 8 − 5', () => {
    const rels = [partition('total', 'noPlan', 'onHold', 'overdue', 'onTrack'), partition('plans', 'onHold', 'overdue', 'onTrack')];
    const cells = shownCells({ total: 8, noPlan: 5, onHold: 1, overdue: 2, onTrack: 0, plans: 3 });
    const r = maskForAdmin(cells, rels);
    expect(r.values.get('plans')).toEqual(LT5);
    expect(r.hiddenForProtection).toEqual(['noPlan']);
    expect(pinnedAfter(cells, rels, r)).toEqual([]);
  });

  it('numbers that are the same by construction are shown the same way: one-month period and its month; two totals of the same parts', () => {
    // A one-month period's total is its month column, and that month is also part of a quarter.
    const month = [partition('P', 'm9'), partition('P', 'a', 'b'), partition('Q', 'm7', 'm8', 'm9')];
    const cells = shownCells({ P: 6, m9: 6, a: 1, b: 5, Q: 25, m7: 10, m8: 9 });
    const r = maskForAdmin(cells, month);
    expect(r.values.get('P')).toEqual(r.values.get('m9'));
    expect(r.values.get('P')).toEqual(HIDDEN);
    expect(pinnedAfter(cells, month, r)).toEqual([]);
    // A4.total and A4.all have the same parts: hiding one (to protect dq4 = 13 − 12) hides the other too.
    const same = [partition('allVisits', 'all', 'dq4'), partition('all', 'p', 'q'), partition('total', 'p', 'q')];
    const c2 = shownCells({ allVisits: 13, all: 12, dq4: 1, total: 12 }, { p: 7, q: 5 });
    const r2 = maskForAdmin(c2, same);
    expect(Object.fromEntries(r2.values)).toEqual({ allVisits: 13, all: HIDDEN, dq4: LT5, total: HIDDEN });
    expect(r2.hiddenForProtection.sort()).toEqual(['all', 'total']);
    expect(pinnedAfter(c2, same, r2)).toEqual([]);
  });

  it('fails closed: a range check that does not settle within its step limit throws, so nothing is sent', () => {
    const cells = shownCells({ total: 20, a: 12, c: 3, d: 5 }, { b: 8 });
    const rels = [partition('b', 'c', 'd'), partition('total', 'a', 'b')];
    expect(maskForAdmin(cells, rels).values.get('d')).toEqual(HIDDEN);
    expect(() => maskForAdmin(cells, rels, { maxSteps: 2 })).toThrow(/did not settle/);
    expect(() => rangeCheck(new Map([['total', 20], ['a', 12], ['c', LT5], ['d', 5]]), rels, { maxSteps: 2 })).toThrow(/did not settle/);
  });

  it('fails closed: a small number still pinned with nothing left to hide or withhold throws; so does a sum that does not add up', () => {
    // T = a + b + c + d (4 each) = v + h1 + h2 + h3 (v never shown, 1; h 5 each); h4 = v + w (5 = 1 + 4).
    // Whatever is hidden, h4 ≥ 5 and w ≤ 4 give v ≥ 1, so T ≥ 16 and a, b, c and d are 4.
    const rels = [partition('T', 'a', 'b', 'c', 'd'), partition('T', 'v', 'h1', 'h2', 'h3'), partition('h4', 'v', 'w')];
    const cells = shownCells({ T: 16, a: 4, b: 4, c: 4, d: 4, h1: 5, h2: 5, h3: 5, h4: 5, w: 4 }, { v: 1 });
    expect(() => maskForAdmin(cells, rels)).toThrow(/nothing is left/);
    expect(() => maskForAdmin(shownCells({ total: 5, a: 2, b: 2 }), [partition('total', 'a', 'b')])).toThrow(/does not add up/);
  });

  it('a card with every number protected says so; a ratio and a median need exact numbers', () => {
    const entry = (cells, extras = {}) => ({
      json: { total: { key: 'total', value: 0 }, cells: cells.map(([key]) => ({ key, value: 0 })), extras },
      ids: { total: 'total', cells: cells.map(([key]) => key) },
    });
    const vals = (o) => new Map(Object.entries(o));
    const all = maskedCard(entry([['a'], ['b']]), vals({ total: LT5, a: LT5, b: HIDDEN }));
    expect(all.allMasked).toBe(true);
    const some = maskedCard(entry([['a'], ['b']]), vals({ total: LT5, a: LT5, b: 0 }));
    expect(some.allMasked).toBe(false);
    const ratio = { ratio: { value: 1000, basis: 10 } };
    expect(maskedCard(entry([['girls'], ['boys']], ratio), vals({ total: 12, girls: 5, boys: 5 })).extras.ratio).toEqual(ratio.ratio);
    expect(maskedCard(entry([['girls'], ['boys']], ratio), vals({ total: 12, girls: LT5, boys: 8 })).extras.ratio).toBeUndefined();
    const median = { median: { value: 2900, n: 6 } };
    expect(maskedCard(entry([['weighed']], median), vals({ total: 7, weighed: 6 })).extras.median).toEqual(median.median);
    expect(maskedCard(entry([['weighed']], median), vals({ total: 7, weighed: HIDDEN })).extras.median).toBeUndefined();
  });

  it('on random hospitals: no number from 1 to 4 is sent and none can be worked out, on any view', () => {
    const last12 = parsePeriod({ period: 'last_12m' }, { audience: 'admin', today: T });
    let withheldSeen = 0;
    let hiddenSeen = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      const g = buildAdminGraph(dataOf({ ...randomHospital(seed), period: last12 }), { now: NOW, today: T });
      expect(pinnedAfter(g.cells, g.relations, g.masking), `seed ${seed}`).toEqual([]);
      withheldSeen += g.masking.withheld.length;
      hiddenSeen += g.masking.hiddenForProtection.length;
      for (const periodKey of ADMIN_PERIOD_KEYS) {
        for (const careType of ['all', 'antenatal', 'newborn']) {
          for (const section of careType === 'all' ? SECTIONS : ['overview']) {
            const p = adminPayload(g, { section, periodKey, careType });
            for (const c of p.cards) {
              for (const x of [c.total, ...c.cells].filter(Boolean)) {
                if (typeof x.value === 'number') expect(x.value === 0 || x.value >= 5, `seed ${seed} ${c.id}.${x.key}`).toBe(true);
                expect(x.list).toBe(false);
              }
            }
            for (const t of p.tiles ?? []) if (typeof t.value === 'number') expect(t.value === 0 || t.value >= 5).toBe(true);
            // The few-births line only with a ratio sent (girls and boys exact), never from the true count.
            const g2 = p.cards.find((c) => c.id === 'G2');
            if (g2) expect(g2.notes.includes(FEW_BIRTHS_NOTE), `seed ${seed} ${periodKey}`).toBe(g2.extras.ratio?.value != null && g2.extras.ratio.basis < RATIO_NOTE_BELOW);
          }
        }
      }
    }
    // The random hospitals are small: both ways of protecting a small number are exercised.
    expect(hiddenSeen).toBeGreaterThan(0);
    expect(withheldSeen).toBeGreaterThan(0);
  });

  it('E1 "most often overdue": admins get exact rows first (highest first), then the others from A to Z; a listed row (at least 1) pins nothing', () => {
    // Ordered by count with ties by key, the "fewer than 5" rows could be worked out (seeds 85, 94 and 115 of this
    // generator; 5004–5069 with the "listed means at least 1" fact). The order sent now uses only what is sent.
    const last12 = parsePeriod({ period: 'last_12m' }, { audience: 'admin', today: T });
    let masked = 0;
    for (const seed of [85, 94, 115, 5004, 5008, 5037, 5051, 5069]) {
      const g = buildAdminGraph(dataOf({ ...randomHospital(seed), period: last12 }), { now: NOW, today: T });
      for (const periodKey of ADMIN_PERIOD_KEYS) {
        const e1 = adminPayload(g, { section: 'care', periodKey }).cards.find((c) => c.id === 'E1');
        const rows = e1.cells.filter((c) => c.group === 'overdueItems');
        const exact = rows.filter((c) => typeof c.value === 'number');
        const others = rows.filter((c) => typeof c.value !== 'number');
        expect(rows, `seed ${seed}`).toEqual([...exact, ...others]);
        expect(exact.map((c) => c.value)).toEqual(exact.map((c) => c.value).sort((a, b) => b - a));
        expect(others.map((c) => c.label)).toEqual(others.map((c) => c.label).sort((a, b) => a.localeCompare(b)));
        expect(e1.notes).toContain('Items shown as “fewer than 5” or “Not shown” are listed from A to Z, after the others.');
        masked += others.length;
      }
      for (const [id, c] of g.cells) if (id.startsWith('E1.o:')) expect(c.atLeastOne, id).toBe(true);
      expect(pinnedAfter(g.cells, g.relations, g.masking), `seed ${seed}`).toEqual([]);
    }
    expect(masked).toBeGreaterThan(0);
  });

  it('G2: for admins the few-births line comes only with a ratio sent; no admin note reads the true counts', () => {
    const keys = ['girls', 'boys', 'indeterminate', 'notRecorded'];
    const g2 = (vals) =>
      maskedCard(
        {
          json: { id: 'G2', notes: ['fixed'], total: { key: 'total', value: 0 }, cells: keys.map((key) => ({ key, value: 0 })), extras: { ratio: { value: 857, basis: 13 } } },
          ids: { total: 'total', cells: keys },
        },
        new Map(Object.entries(vals)),
      );
    expect(g2({ total: WITHHELD, girls: WITHHELD, boys: 0, indeterminate: 0, notRecorded: 0 }).notes).toEqual(['fixed']);
    expect(g2({ total: LT5, girls: LT5, boys: LT5, indeterminate: 0, notRecorded: 0 }).notes).toEqual(['fixed']);
    expect(g2({ total: 13, girls: 6, boys: 7, indeterminate: 0, notRecorded: 0 }).notes).toEqual(['fixed', FEW_BIRTHS_NOTE]);
    // Every admin card's notes are the same when every count is 0: they never depend on the true numbers.
    const period = parsePeriod({ period: 'last_12m' }, { audience: 'admin', today: T });
    let checked = 0;
    for (const seed of [3, 5, 7]) {
      const ctx = ctxOf({ ...randomHospital(seed), period, audience: 'admin' });
      computeSections(ctx, SECTIONS);
      for (const [id, res] of ctx.results) {
        const m = metricById(id);
        if (typeof m.notes !== 'function') continue;
        const zero = { ...res, cells: Object.fromEntries(Object.keys(res.cells).map((k) => [k, 0])) };
        expect(m.notes(ctx, res), `seed ${seed} ${id}`).toEqual(m.notes(ctx, zero));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});

// ---------- No undeclared identities (section 6.5): what a reader could add up is always a declared sum ----------

describe('small numbers: no undeclared identities', () => {
  it('every linear identity that holds in all random hospitals, over every admin number of the four periods, is a declared sum', () => {
    // Rows = random hospitals, columns = every admin number (virtual ones included, every row of every card
    // that has rows only when the data has them: a row missing from a hospital counts 0). A linear identity that
    // held in every hospital is a vector of the matrix's null space; it must be a combination of the declared
    // sums (partitions). Worked over the integers modulo a large prime: when the rank of the numbers plus the
    // rank of the declared sums reaches the number of columns, that is a proof over the rational numbers too
    // (the declared sums are identities over the integers, so they stay independent of the rows mod the prime).
    const WIDTH = 4096;
    const last12 = parsePeriod({ period: 'last_12m' }, { audience: 'admin', today: T });
    const column = new Map();
    const names = [];
    const col = (id) => {
      if (!column.has(id)) {
        if (names.length >= WIDTH) throw new Error('More admin numbers than the test expects: raise WIDTH');
        column.set(id, names.length);
        names.push(id);
      }
      return column.get(id);
    };
    const numbers = echelon(() => names.length);
    const declared = echelon(() => names.length);
    const seenSums = new Set();
    const min = [];
    const max = [];
    const present = [];
    let seeds = 0;
    let limit = Infinity;
    for (let seed = 1000; seeds < limit; seed += 1) {
      const g = collectAdminViews(dataOf({ ...randomHospital(seed), period: last12 }), { now: NOW, today: T });
      if (limit === Infinity) limit = g.cells.size + 50; // N = number of admin numbers + 50
      seeds += 1;
      const row = new Float64Array(WIDTH);
      for (const [id, c] of g.cells) {
        const j = col(id);
        const v = c.value ?? 0;
        row[j] = v % MOD;
        min[j] = Math.min(min[j] ?? v, v);
        max[j] = Math.max(max[j] ?? v, v);
        present[j] = (present[j] ?? 0) + 1;
      }
      numbers.add(row);
      for (const r of g.relations) {
        if (r.kind !== 'partition') continue;
        const key = `${r.total}=${r.parts.join('+')}`;
        if (seenSums.has(key)) continue;
        seenSums.add(key);
        const v = new Float64Array(WIDTH);
        v[col(r.total)] = (v[col(r.total)] + 1) % MOD;
        for (const p of r.parts) v[col(p)] = (v[col(p)] + MOD - 1) % MOD;
        declared.add(v);
      }
      // Proven for every number seen so far: stop early.
      if (seeds >= 30 && numbers.rows.length + declared.rows.length === names.length) break;
    }

    // A number that never changes can't show an identity: the generator must make it vary.
    const constant = names.filter((_, j) => {
      const lo = present[j] < seeds ? Math.min(min[j], 0) : min[j];
      const hi = present[j] < seeds ? Math.max(max[j], 0) : max[j];
      return lo === hi;
    });
    expect(constant, 'numbers that never vary in the random hospitals – extend the generator').toEqual([]);

    if (numbers.rows.length + declared.rows.length < names.length) {
      // Name the identities that are not declared: the null space of the numbers, outside the declared sums.
      const n = names.length;
      const rows = numbers.rows;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        for (let k = 0; k < i; k += 1) {
          const f = rows[k].v[rows[i].pivot];
          if (f === 0) continue;
          for (let j = rows[i].pivot; j < n; j += 1) if (rows[i].v[j] !== 0) rows[k].v[j] = (rows[k].v[j] + (MOD - f) * rows[i].v[j]) % MOD;
        }
      }
      const pivots = new Set(rows.map((r) => r.pivot));
      const undeclared = [];
      for (let f = 0; f < n && undeclared.length < 10; f += 1) {
        if (pivots.has(f)) continue;
        const x = new Float64Array(WIDTH);
        x[f] = 1;
        for (const r of rows) if (r.v[f] !== 0) x[r.pivot] = (MOD - r.v[f]) % MOD;
        if (declared.reduce(x).every((v) => v === 0)) continue;
        const signed = (v) => (v > MOD / 2 ? v - MOD : v);
        undeclared.push([...x.slice(0, n)].map((v, j) => (v ? `${signed(v)}·${names[j]}` : null)).filter(Boolean).join(' + ') + ' = 0');
      }
      expect(undeclared, 'identities between admin numbers that no declared sum explains').toEqual([]);
    }
    expect(numbers.rows.length + declared.rows.length).toBe(names.length);
    expect(names.length).toBeGreaterThan(800);
  }, 900_000);
});

describe('audit throttle', () => {
  it('once per key every 10 minutes', () => {
    resetAnalyticsAuditThrottle();
    const t0 = new Date('2026-10-15T04:30:00Z');
    expect(shouldLogView('a', t0)).toBe(true);
    expect(shouldLogView('a', new Date(t0.getTime() + 9 * 60_000))).toBe(false);
    expect(shouldLogView('b', t0)).toBe(true);
    expect(shouldLogView('a', new Date(t0.getTime() + 10 * 60_000))).toBe(true);
    resetAnalyticsAuditThrottle();
    expect(shouldLogView('a', t0)).toBe(true);
  });
});

describe('the Abortion type of care (pregnancy loss)', () => {
  it('appears in A1, A4 and V1 with codes of its own: A4 "all visits" stays c8 and Abortion is c9', () => {
    const ctx = ctxOf({ patients: [] });
    expect(CARE_TYPE_KEYS.at(-1)).toBe('abortion');
    const code = (id, key) => allCellDefs(metricById(id), ctx).find((c) => c.key === key)?.code;
    expect(code('A1', 'abortion')).toBe('c6');
    expect(code('A4', 'all')).toBe('c8');
    expect(code('A4', 'v:abortion')).toBe('c9');
    expect(['antenatal', 'postnatal', 'infertility', 'gynaecology', 'newborn'].map((t) => code('A4', `v:${t}`))).toEqual(['c3', 'c4', 'c5', 'c6', 'c7']);
    expect(tableOf(metricById('V1'), ctx).rows.map((r) => r.key)).toEqual(['postnatal', 'gynaecology', 'infertility', 'abortion']);
    expect(code('V1', 'r:abortion|c:registered')).toBe('c10');
    expect(metricById('V1').title).toBe('Other care: postnatal, gynaecology, infertility and abortion');
  });

  it('counts abortion registrations and visits like the other types', () => {
    const p = pt({ careType: 'abortion', createdAt: new Date(NOW.getTime() - 5 * 86_400_000) });
    const ctx = ctxOf({ patients: [p], visits: [visitOf(p, isoDay(addDays(T, -3)), { careType: 'abortion' })] });
    computeSections(ctx, ['overview']);
    expect(countOf(rawValue(ctx, 'A1.abortion'))).toBe(1);
    expect(countOf(rawValue(ctx, 'A4.v:abortion'))).toBe(1);
    expect(countOf(rawValue(ctx, 'V1.r:abortion|c:seen'))).toBe(1);
  });
});

// ---------- Deliveries tab (5 Oct 2026): confirmed delivery notes and recorded deaths ----------

describe('Deliveries tab', () => {
  const me = oid();
  const other = oid();
  const mother = (o = {}) => pt({ careType: 'postnatal', assignedDoctor: me, ...o });
  const note = (p, deliveredAt, content = {}) => ({ _id: oid(), patientId: p._id, content: { deliveredAt, mode: 'normal', pph: '', babies: [{ outcome: 'live' }], ...content } });
  const oct = parsePeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-15' }, { audience: 'doctor', today: T });
  const computeOf = ({ patients, deliveries = [], period = oct, ...opts }) => {
    const ctx = ctxOf({ patients, deliveries, period, userId: me, ...opts });
    computeSections(ctx, ['deliveries']);
    return { ctx, v: (g) => countOf(rawValue(ctx, g)) };
  };

  it('a delivery counts by the hospital date of delivery; two deliveries of one woman count twice; twins are two babies', () => {
    const a = mother();
    const b = mother({ assignedDoctor: other, sensitive: true }); // another doctor's sensitive record
    const rows = {
      patients: [a, b],
      deliveries: [
        note(a, '2026-09-30T18:29:00.000Z'), // 30 Sep, 23:59 in India: before the period
        note(a, '2026-09-30T18:31:00.000Z'), // 1 Oct, 00:01 in India
        note(a, '2026-10-15T18:29:00.000Z', { mode: 'lscs', babies: [{ outcome: 'live' }, { outcome: 'stillbirth', stillbirthType: 'macerated' }] }), // 15 Oct, 23:59
        note(a, '2026-10-15T18:31:00.000Z'), // 16 Oct in India: after the period
        note(b, '2026-10-05T05:00:00.000Z'),
        { _id: oid(), patientId: a._id, content: { deliveredAt: null, mode: 'normal', babies: [{ outcome: 'live' }] } }, // no time of delivery: never counted
      ],
    };
    const all = computeOf(rows);
    expect(['H1.total', 'H1.normal', 'H1.lscs', 'H3.total', 'H3.live', 'H3.still', 'H3.macerated'].map(all.v)).toEqual([3, 2, 1, 4, 3, 1, 1]);
    // A doctor who may not see b's clinical details does not count her delivery.
    const mine = computeOf({ ...rows, visible: new Set([String(a._id)]) });
    expect(mine.v('H1.total')).toBe(2);
    const babies = [...rawValue(mine.ctx, 'H3.total')];
    expect(new Set(babies).size).toBe(3);
    expect(babies.every((e) => patientOfUnit(e) === String(a._id))).toBe(true);
    // The trend columns of the period add up to the deliveries.
    const weeks = rawValue(mine.ctx, 'H1.total').size;
    expect(oct.buckets.reduce((s, bk) => s + countOf(rawValue(mine.ctx, `H1.b:${bk.key}`)), 0)).toBe(weeks);
  });

  it('every answer and every "not recorded" has its row, and the rows add up', () => {
    const a = mother();
    const dn = (mode, pph, babies) => note(a, '2026-10-05T05:00:00.000Z', { mode, pph, babies });
    const { v, ctx } = computeOf({
      patients: [a],
      deliveries: [
        dn('normal', 'yes', [{ outcome: 'live', apgar5: 6, nicu: 'yes', breastfedWithinHour: 'not_applicable' }]),
        dn('vacuum', 'no', [{ outcome: 'live', apgar5: 7, nicu: 'no', breastfedWithinHour: 'yes' }]),
        dn('forceps', '', [{ outcome: 'live', apgar5: null, nicu: '', breastfedWithinHour: 'no' }]),
        dn('other', 'no', [{ outcome: 'live', apgar5: '', breastfedWithinHour: '' }]),
        dn('', '', [{ outcome: '' }, { outcome: 'stillbirth', stillbirthType: '' }, { outcome: 'stillbirth', stillbirthType: 'fresh' }, { outcome: 'live', apgar5: 0 }]),
        dn('lscs', 'yes', []),
      ],
    });
    const row = (id, keys) => Object.fromEntries(keys.map((k) => [k, v(`${id}.${k}`)]));
    expect(row('H1', ['total', 'normal', 'vacuum', 'forceps', 'lscs', 'other', 'noMode', 'known'])).toEqual({ total: 6, normal: 1, vacuum: 1, forceps: 1, lscs: 1, other: 1, noMode: 1, known: 5 });
    expect(row('H2', ['yes', 'no', 'notRecorded', 'answered'])).toEqual({ yes: 2, no: 2, notRecorded: 2, answered: 4 });
    expect(row('H3', ['total', 'live', 'still', 'noOutcome', 'fresh', 'macerated', 'stillKindNotRecorded'])).toEqual({ total: 8, live: 5, still: 2, noOutcome: 1, fresh: 1, macerated: 0, stillKindNotRecorded: 1 });
    // Apgar: 6 and 0 are under 7, 7 is not; a missing or blank score is not recorded.
    expect(row('H4', ['low', 'normal', 'notRecorded', 'recorded'])).toEqual({ low: 2, normal: 1, notRecorded: 2, recorded: 3 });
    expect(row('H5', ['yes', 'no', 'notRecorded', 'answered'])).toEqual({ yes: 1, no: 1, notRecorded: 3, answered: 2 });
    expect(row('H6', ['yes', 'no', 'na', 'notRecorded', 'answered'])).toEqual({ yes: 1, no: 1, na: 1, notRecorded: 2, answered: 3 });
    // Every declared sum holds.
    for (const r of relations(ctx, ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'])) {
      if (r.kind === 'subset') expect(v(r.sub)).toBeLessThanOrEqual(v(r.sup));
      else expect(r.parts.reduce((s, g) => s + v(g), 0), r.total).toBe(v(r.total));
    }
    // A list row's detail: the day, the mode; which baby of how many, and the Apgar score on H4.
    const lscs = [...rawValue(ctx, 'H1.lscs')][0];
    expect(ctx.results.get('H1').details.get(lscs)).toEqual({ type: 'delivery', on: '2026-10-05', mode: 'lscs' });
    const zero = [...rawValue(ctx, 'H4.low')].find((k) => k.endsWith('|4'));
    expect(ctx.results.get('H4').details.get(zero)).toEqual({ type: 'birth', on: '2026-10-05', baby: 4, of: 4, apgar5: 0 });
  });

  it('deaths: a newborn death in the first 28 days, early in the first 7; maternal deaths by when; the others are not counted here', () => {
    const baby = (ageDays, on = '2026-10-05') => pt({ careType: 'newborn', newborn: { birthAt: new Date('2026-09-01T04:30:00Z'), mother: null }, death: { on: d(on), ageDays } });
    const woman = (timing, on = '2026-10-05') => pt({ careType: 'antenatal', death: { on: d(on), timing } });
    const patients = [
      baby(0),
      baby(6),
      baby(7),
      baby(27),
      baby(28), // not a newborn death
      baby(null), // age not known
      baby(1, '2026-09-30'), // before the period
      woman('pregnancy'),
      woman('delivery'),
      woman('postpartum'),
      woman('other'), // not related to a pregnancy
      woman(undefined),
      woman('pregnancy', '2026-10-16'), // after the period
      pt({ careType: 'gynaecology' }),
    ];
    const { v, ctx } = computeOf({ patients });
    expect(['H7.newborn', 'H7.early', 'H7.ageUnknown', 'H7.maternal', 'H7.m:pregnancy', 'H7.m:delivery', 'H7.m:postpartum'].map(v)).toEqual([4, 2, 1, 3, 1, 1, 1]);
    expect(ctx.results.get('H7').details.get(String(patients[0]._id))).toEqual({ type: 'death', on: '2026-10-05' });
    // Stillbirths on H7 are H3's own cell.
    expect(globalCellId(metricById('H7'), 'still', ctx)).toBe('H3.still');
  });

  it('my patients: the deliveries of the women assigned to me, and deaths on my records or my patients’ babies', () => {
    const mine = mother();
    const notMine = mother({ assignedDoctor: other });
    const myBaby = pt({ careType: 'newborn', newborn: { birthAt: new Date('2026-10-03T04:30:00Z'), mother: mine._id }, death: { on: d('2026-10-05'), ageDays: 2 } });
    const otherBaby = pt({ careType: 'newborn', newborn: { birthAt: new Date('2026-10-03T04:30:00Z'), mother: notMine._id }, death: { on: d('2026-10-05'), ageDays: 2 } });
    const rows = { patients: [mine, notMine, myBaby, otherBaby], deliveries: [note(mine, '2026-10-03T04:30:00.000Z'), note(notMine, '2026-10-03T04:30:00.000Z')] };
    const { v } = computeOf({ ...rows, scope: 'mine' });
    expect([v('H1.total'), v('H3.total'), v('H7.newborn')]).toEqual([1, 1, 1]);
    expect(computeOf(rows).v('H1.total')).toBe(2);
  });

  it('a delivery note on a record marked as a duplicate counts under her main record', () => {
    const main = mother();
    const dup = oid();
    const data = dataOf({ patients: [main], deliveries: [note({ _id: dup }, '2026-10-05T05:00:00.000Z')], period: oct });
    underMainRecord(data, new Map([[String(dup), String(main._id)]]));
    expect(String(data.deliveries[0].patientId)).toBe(String(main._id));
    const ctx = buildContext(data, { now: NOW, today: T, period: oct, scope: 'hospital', careType: 'all', audience: 'doctor', userId: me, visible: null });
    computeSections(ctx, ['deliveries']);
    expect(countOf(rawValue(ctx, 'H1.total'))).toBe(1);
  });

  it('entries of deliveries and babies name their patient', () => {
    expect(unitKey('abc', 'n1')).toBe('abc|n1');
    expect(patientOfUnit(unitKey('abc', 'n1', 2))).toBe('abc');
    expect(patientOfUnit('abc')).toBe('abc');
  });

  it('list orders: the latest delivery (then the babies in their order) and the latest death first', () => {
    const byId = new Map([
      ['m', { _id: 'm', createdAt: new Date('2026-01-01T05:00:00Z') }],
      ['n', { _id: 'n', createdAt: new Date('2026-01-02T05:00:00Z') }],
    ]);
    const details = new Map([
      ['m|d1|1', { type: 'birth', on: '2026-10-05', baby: 1, of: 2 }],
      ['m|d1|2', { type: 'birth', on: '2026-10-05', baby: 2, of: 2 }],
      ['n|d2|1', { type: 'birth', on: '2026-10-07', baby: 1, of: 1 }],
    ]);
    expect(sortIds(new Set(['m|d1|2', 'n|d2|1', 'm|d1|1']), { orderKey: 'deliveredDesc', byId, details })).toEqual(['n|d2|1', 'm|d1|1', 'm|d1|2']);
    const deaths = new Map([
      ['m', { type: 'death', on: '2026-09-01' }],
      ['n', { type: 'death', on: '2026-10-01' }],
    ]);
    expect(sortIds(new Set(['m', 'n']), { orderKey: 'diedDesc', byId, details: deaths })).toEqual(['n', 'm']);
  });

  it('a list of deliveries or babies: one row per entry showing the mother, each patient fetched once', async () => {
    const tenantId = oid();
    const req = { user: { _id: me }, membership: { roles: ['doctor'] }, tenantId };
    const [m, n] = [oid(), oid()];
    const made = (i) => new Date(Date.UTC(2026, 0, 1 + i));
    const ids = [unitKey(m, 'd1', 1), unitKey(m, 'd1', 2), unitKey(n, 'd2', 1)];
    const byId = new Map([
      [String(m), { _id: m, createdAt: made(0) }],
      [String(n), { _id: n, createdAt: made(1) }],
    ]);
    const details = new Map([
      [ids[0], { type: 'birth', on: '2026-10-05', baby: 1, of: 2 }],
      [ids[1], { type: 'birth', on: '2026-10-05', baby: 2, of: 2 }],
      [ids[2], { type: 'birth', on: '2026-10-07', baby: 1, of: 1 }],
    ]);
    const fresh = [m, n].map((id, i) => ({ _id: id, tenantId, mrn: `P-00020${i}`, fullName: `Sample Mother 0${i}`, careType: 'postnatal', createdAt: made(i), assignedDoctor: me, sensitive: false }));
    const asked = [];
    const out = await listPage(
      req,
      { ids: new Set(ids), byId, details, orderKey: 'deliveredDesc', now: NOW, page: 1, limit: 25 },
      { fetchRows: async (tid, pageIds) => (asked.push(pageIds), fresh), fetchNames: async () => new Map() },
    );
    expect(asked).toEqual([[String(n), String(m)]]); // each patient once
    expect(pickKeysOf(out, ['count', 'restricted', 'total'])).toEqual({ count: 3, restricted: 0, total: 3 });
    expect(out.patients.map((r) => [r.id, r.detail.baby])).toEqual([
      [String(n), 1],
      [String(m), 1],
      [String(m), 2],
    ]);
    for (const r of out.patients) expect(Object.keys(r).sort()).toEqual([...SPEC_LIST_ROW_KEYS].sort());
    // A mother who can no longer be opened: each of her rows is counted as restricted, none listed.
    const hidden = await listPage(
      req,
      { ids: new Set(ids), byId, details, orderKey: 'deliveredDesc', now: NOW, page: 1, limit: 25 },
      { fetchRows: async () => [{ ...fresh[0], assignedDoctor: other, sensitive: true }, fresh[1]], fetchNames: async () => new Map() },
    );
    expect(pickKeysOf(hidden, ['count', 'restricted', 'total'])).toEqual({ count: 3, restricted: 2, total: 1 });
  });
});

const pickKeysOf = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
