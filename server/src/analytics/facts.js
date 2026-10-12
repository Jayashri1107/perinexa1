// Pure helpers for Analytics: what counts as an active pregnancy, a booking, a visit of the current pregnancy,
// and so on (definitions in the Analytics specification, section 0). They work on rows loaded by load.js and
// on the context built by compute.js; nothing here reads the database or the clock.

import { addDays, daysBetween, gaOn, toHospitalDate, utcDay } from '../careplans/dates.js';
import { closedForPregnancy } from '../careplans/plansService.js';

export const ACTIVE_AFTER_EDD_DAYS = 28; // an EDD up to 4 weeks ago is still an active pregnancy
export const NO_EDD_ACTIVE_DAYS = 308; // a record with no EDD counts as active for 44 weeks after it was made
export const MAX_PREGNANCY_DAYS = 315; // 45 weeks: gestation above this belongs to another pregnancy
// Close reasons that mean "this pregnancy's care here is over" (not "new pregnancy" or "other").
export const CLOSED_PREGNANCY_REASONS = ['delivered', 'pregnancy_ended', 'transferred_out', 'care_elsewhere'];
export const NEW_RECORD_DAYS = 14; // "registered in the last 14 days, first visit not yet"

// The id strings of a row (and of a visit's or plan's patient), worked out once per row: an ObjectId turned into
// a string costs more than a lookup, and the same rows are read by many cards. Kept under symbols, so they are
// never sent or saved.
const ID = Symbol('analytics id');
const PID = Symbol('analytics patient id');
export const idOf = (row) => row[ID] ?? (row[ID] = String(row._id));
/** The patient id (string) of a visit or a care plan row. */
export const pidOf = (row) => row[PID] ?? (row[PID] = String(row.patientId));
export function sameId(a, b) {
  if (a == null || b == null) return false;
  if (typeof a === 'object' && typeof b === 'object' && typeof a.equals === 'function' && a.id instanceof Uint8Array && b.id instanceof Uint8Array) return a.equals(b);
  return String(a) === String(b);
}

/**
 * A counted thing that is not a patient – a delivery, or one baby of a delivery (the Deliveries tab) – is kept in a
 * cell's Set as '<patient id>|<more>': the patient it belongs to (the mother, whose record holds the delivery note),
 * then what makes it one of its own. Two deliveries of one woman in a period count twice, and twins count as two
 * babies. Its patient list row is that patient (listService.js). Every other cell holds plain patient ids.
 */
export const unitKey = (patientId, ...parts) => [String(patientId), ...parts.map(String)].join('|');
/** The patient a cell's entry belongs to: the entry itself, or the part before the first '|' (see unitKey). */
export const patientOfUnit = (key) => {
  const k = String(key);
  const i = k.indexOf('|');
  return i < 0 ? k : k.slice(0, i);
};

/**
 * The hospital's date of an instant, remembered per minute (the date only changes on a minute boundary in
 * every time zone). One cache per request.
 */
export function dayCache(tz) {
  const cache = new Map();
  return (instant) => {
    if (instant == null) return null;
    const minute = Math.floor((instant instanceof Date ? instant.getTime() : new Date(instant).getTime()) / 60_000);
    let d = cache.get(minute);
    if (d === undefined) {
      d = toHospitalDate(new Date(minute * 60_000), tz);
      cache.set(minute, d);
    }
    return d;
  };
}

export const inRange = (d, from, to) => d != null && d >= from && d <= to;
export const eddOf = (p) => utcDay(p.pregnancy?.effectiveEdd);
/** Gestation on a date from the patient's current EDD (null with no EDD, or before day 0). */
export const gaAt = (p, date) => {
  const edd = eddOf(p);
  return edd ? gaOn(edd, date) : null;
};
/** A gestation that makes sense for one pregnancy (0 to 45 weeks), else null. */
export const usableGa = (ga) => (ga && ga.totalDays >= 0 && ga.totalDays <= MAX_PREGNANCY_DAYS ? ga : null);

/**
 * Closed for this pregnancy: no current antenatal plan, and a closed antenatal plan (delivered, pregnancy
 * ended, transferred out or care elsewhere) that matches her EDD by the care plans' own rule.
 */
export function closedForThisPregnancy(p, ctx) {
  const plans = ctx.plansOf(p);
  if (plans.current) return false;
  const edd = eddOf(p);
  if (!edd) return false;
  return closedForPregnancy(
    plans.closed.filter((pl) => CLOSED_PREGNANCY_REASONS.includes(pl.closed?.reason)),
    edd,
  );
}

/**
 * A death a doctor recorded on the record ends her pregnancy for every count of the women still in care: she is never
 * an active pregnancy, an expected delivery, past her due date, "not seen recently" or overdue on her care plan
 * (patients/deathRules.js: a closed record is left out of the follow-up and overdue lists). A death undone as recorded
 * in error is not on the record any more.
 */
const diedOnRecord = (p) => Boolean(p.death?.on);

/** An antenatal record that is still a current pregnancy (not closed; EDD at most 4 weeks ago, or a recent record with no EDD). */
export function isActivePregnancy(p, ctx) {
  if (p.careType !== 'antenatal' || diedOnRecord(p) || closedForThisPregnancy(p, ctx)) return false;
  const edd = eddOf(p);
  if (edd) return edd >= addDays(ctx.today, -ACTIVE_AFTER_EDD_DAYS);
  return ctx.hday(p.createdAt) >= addDays(ctx.today, -NO_EDD_ACTIVE_DAYS);
}

/** An antenatal record, not closed, whose pregnancy is older than 44 weeks (never counted as active). */
export function olderThan44(p, ctx) {
  if (p.careType !== 'antenatal' || diedOnRecord(p) || closedForThisPregnancy(p, ctx)) return false;
  const edd = eddOf(p);
  if (edd) return edd < addDays(ctx.today, -ACTIVE_AFTER_EDD_DAYS);
  return ctx.hday(p.createdAt) < addDays(ctx.today, -NO_EDD_ACTIVE_DAYS);
}

/** A visit on this date belongs to her current pregnancy (0 to 45 weeks by her current EDD). */
export const visitInPregnancy = (p, visitOn) => usableGa(gaAt(p, visitOn)) != null;

/** The type of care at her first active visit, or her type of care now if she has not been seen (rule R6). */
export const careTypeAtFirstVisit = (p, ctx) => ctx.summaryOf(p)?.firstCareType ?? p.careType;

/**
 * Her earliest booking in the period: { on, ga } (ga null when not usable), or null.
 * A booking is an antenatal care plan's booking date; only a woman with no antenatal plan at all falls back to
 * her first active antenatal visit.
 */
export function bookingOf(p, ctx, from, to) {
  const plans = ctx.plansOf(p).all;
  if (plans.length) {
    let best = null;
    for (const pl of plans) {
      const on = utcDay(pl.bookedOn);
      if (!inRange(on, from, to)) continue;
      if (!best || on < best.on) best = { on, edd: utcDay(pl.basis?.edd) };
    }
    return best ? { on: best.on, ga: best.edd ? usableGa(gaOn(best.edd, best.on)) : null } : null;
  }
  const on = utcDay(ctx.summaryOf(p)?.firstAntenatalOn);
  if (!inRange(on, from, to)) return null;
  return { on, ga: usableGa(gaAt(p, on)) };
}

/** B1 cell of a gestation at booking. */
export function bookingCell(ga) {
  if (!ga) return 'unknown';
  if (ga.totalDays < 84) return 'lt12';
  if (ga.totalDays < 140) return 'w12_19';
  if (ga.totalDays < 196) return 'w20_27';
  return 'w28p';
}

/** How long without a visit is "too long" at this gestation (days), and the grace after a missed next-visit date. */
export const visitGapLimit = (gaDays) => (gaDays != null && gaDays >= 252 ? 10 : gaDays != null && gaDays >= 196 ? 21 : 35);
export const missedGrace = (gaDays) => (gaDays != null && gaDays >= 252 ? 3 : 7);

/**
 * D10 "Not seen recently" for one active pregnancy: 'neverSeen' | 'waitingFirst' | 'missedAppt' | 'gap' | 'ok'
 * (the first that matches). GA is gestation today.
 */
export function d10Cell(p, ctx) {
  const s = ctx.summaryOf(p);
  if (!s?.lastOn) {
    const age = daysBetween(ctx.hday(p.createdAt), ctx.today);
    return age >= NEW_RECORD_DAYS ? 'neverSeen' : 'waitingFirst';
  }
  const gaDays = gaAt(p, ctx.today)?.totalDays ?? null;
  const next = utcDay(s.lastNextVisitOn);
  if (next && addDays(next, missedGrace(gaDays)) < ctx.today) return 'missedAppt';
  if (daysBetween(utcDay(s.lastOn), ctx.today) > visitGapLimit(gaDays)) return 'gap';
  return 'ok';
}

/** A baby already born (only born babies are ever counted). */
export const isBornBaby = (p, now) => p.careType === 'newborn' && p.newborn?.birthAt != null && new Date(p.newborn.birthAt) <= now;

/** Trimester cell of a gestation (A2). */
export function trimesterKey(ga) {
  if (!ga) return 'check';
  if (ga.totalDays < 98) return 't1';
  if (ga.totalDays < 196) return 't2';
  return 't3';
}

// ---------- Risk & conditions ----------

export const DEFAULT_GRAND_MULTIPARA = 4;

/**
 * The hospital's grand multipara threshold (births, para, at or above it), from the `grand_multipara` rule of
 * its standard template's risk rules – the rules the risk levels use. The rule is found by its key alone; it
 * can be read only when it says "para at least n" (op 'gte' n, or 'gt' n − 1, with a whole number). 'eq',
 * 'lt' and 'lte' do not mean "n or more", so they are not read. Returns { n, source }: source 'rule', or
 * 'none' (no such rule) or 'unreadable' (a rule not written that way), both with n = 4.
 */
export function grandThreshold(template) {
  const rule = (template?.riskRules ?? []).find((r) => r.key === 'grand_multipara');
  if (!rule) return { n: DEFAULT_GRAND_MULTIPARA, source: 'none' };
  const ok = rule.factor === 'para' && Number.isInteger(rule.value) && ['gte', 'gt'].includes(rule.op);
  const n = ok ? (rule.op === 'gt' ? rule.value + 1 : rule.value) : null;
  return n != null && n >= 1 ? { n, source: 'rule' } : { n: DEFAULT_GRAND_MULTIPARA, source: 'unreadable' };
}

const ALBUMIN_1_PLUS = ['1+', '2+', '3+', '4+'];
export const hasBp = (v) => v.vitals?.bpSystolic != null && v.vitals?.bpDiastolic != null;
export const bpHigh = (v) => hasBp(v) && (v.vitals.bpSystolic >= 140 || v.vitals.bpDiastolic >= 90);
export const bpSevere = (v) => hasBp(v) && (v.vitals.bpSystolic >= 160 || v.vitals.bpDiastolic >= 110);
export const albuminOnePlus = (v) => ALBUMIN_1_PLUS.includes(v.vitals?.urineAlbumin);

/** Anaemia band of a haemoglobin (g/dL): 'none' 11.0 or more, 'mild' 10.0–10.9, 'moderate' 7.0–9.9, 'severe' under 7.0. */
export function hbBand(hb) {
  if (hb >= 11) return 'none';
  if (hb >= 10) return 'mild';
  if (hb >= 7) return 'moderate';
  return 'severe';
}

/**
 * Her active antenatal visits in [from, to] that belong to her current pregnancy (0–45 weeks by her current
 * EDD), oldest first. The visits come from the window loaded for the request.
 */
export const pregnancyVisitsIn = (p, ctx, from, to) => ctx.visitsOf(p).filter((v) => v.careType === 'antenatal' && inRange(v.visitOn, from, to) && visitInPregnancy(p, v.visitOn));

// ---------- Newborn ----------

export const MULTIPLE_BIRTH_MS = 24 * 3600_000; // twins or more: born to the same mother within 24 hours
const GA_AT_BIRTH_MIN = 140;
const EDD_CANDIDATES_AGREE_DAYS = 14;

/**
 * The EDD to use for a baby's gestation at birth, from the linked mother's dates: { edd, source ('scan' |
 * 'lmp'), fromPlan } or null (dates not usable). Candidates are the EDD of each of her antenatal care plans
 * and her current EDD; only those that put the birth at 20 to 45 weeks count, and they must agree within 14 days.
 * A plan's EDD is used when there is one (plans: newest first).
 */
export function babyEdd(mother, plans, birthDay) {
  const cands = [];
  const add = (edd, source, fromPlan) => {
    const d = utcDay(edd);
    if (!d) return;
    const ga = gaOn(d, birthDay);
    if (!ga || ga.totalDays < GA_AT_BIRTH_MIN || ga.totalDays > MAX_PREGNANCY_DAYS) return;
    if (cands.some((c) => c.edd.getTime() === d.getTime())) return; // the same day counts once (a plan's EDD first)
    cands.push({ edd: d, source, fromPlan });
  };
  for (const pl of plans) add(pl.basis?.edd, pl.basis?.eddSource ?? null, true);
  const own = mother.pregnancy?.effectiveEdd;
  const ownSource = mother.pregnancy?.scanEdd && utcDay(mother.pregnancy.scanEdd).getTime() === utcDay(own)?.getTime() ? 'scan' : 'lmp';
  add(own, ownSource, false);
  if (!cands.length) return null;
  const times = cands.map((c) => c.edd.getTime());
  if (daysBetween(new Date(Math.min(...times)), new Date(Math.max(...times))) > EDD_CANDIDATES_AGREE_DAYS) return null;
  return cands.find((c) => c.fromPlan) ?? cands[0];
}

/** G6 cell of a gestation at birth (days). */
export function birthGaCell(days) {
  if (days < 196) return 'lt28';
  if (days < 224) return 'w28_31';
  if (days < 238) return 'w32_33';
  if (days < 259) return 'w34_36';
  if (days < 294) return 'term';
  return 'post';
}

/** G3 cell of a birth weight in grams (exactly 2,500 g is normal). */
export function weightCell(g) {
  if (g == null) return 'notWeighed';
  if (g < 1000) return 'elbw';
  if (g < 1500) return 'vlbw';
  if (g < 2500) return 'lbw';
  if (g < 4000) return 'normal';
  return 'macro';
}

/** The middle value (the mean of the two middle values for an even count), rounded to a gram; null when empty. */
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}
