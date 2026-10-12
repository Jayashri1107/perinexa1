// Groups of patients and visits shared by several cards, worked out once per request (ctx.once). Every card
// that shows the same number takes it from the same helper, so the numbers always agree (rule R4).

import { addDays, isoDay, utcDay } from '../careplans/dates.js';
import { planStatuses } from '../careplans/planEngine.js';
import { previewSync } from '../careplans/plansService.js';
import { careTypeAtFirstVisit, closedForThisPregnancy, eddOf, gaAt, idOf, inRange, isActivePregnancy, isBornBaby, olderThan44, pidOf, unitKey } from './facts.js';

/** Active pregnancies in scope: [{ p, id, edd, ga (today) }]. */
export const activeInScope = (ctx) =>
  ctx.once('active', () =>
    ctx.patientsInScope.filter((p) => isActivePregnancy(p, ctx)).map((p) => ({ p, id: idOf(p), edd: eddOf(p), ga: gaAt(p, ctx.today) })),
  );

/** Antenatal records older than 44 weeks, in scope. */
export const olderInScope = (ctx) => ctx.once('older44', () => ctx.patientsInScope.filter((p) => olderThan44(p, ctx)));

/** Antenatal records whose care plan was closed for this pregnancy (still marked antenatal), in scope. */
export const closedStillAntenatalInScope = (ctx) =>
  ctx.once('closedAntenatal', () => ctx.patientsInScope.filter((p) => p.careType === 'antenatal' && closedForThisPregnancy(p, ctx)));

/** Patients in scope registered in the period (hospital date of createdAt), each with its type of care per rule R6. */
export const registrationsInPeriod = (ctx) =>
  ctx.once('registrations', () => {
    const { from, to } = ctx.period;
    const out = [];
    for (const p of ctx.patientsInScope) {
      const on = ctx.hday(p.createdAt);
      if (inRange(on, from, to)) out.push({ p, id: idOf(p), on, type: careTypeAtFirstVisit(p, ctx) });
    }
    return out;
  });

/** Active visits in the period whose patient is in scope (all types of care), oldest first. */
export const visitsInPeriod = (ctx) =>
  ctx.once('visits', () => {
    const { from, to } = ctx.period;
    return ctx.windowVisits.filter((v) => inRange(v.visitOn, from, to) && ctx.isInScope(pidOf(v)));
  });

/** Born babies in scope whose birth (hospital date) falls in the period: [{ p, id, on }]. */
export const babiesInPeriod = (ctx) =>
  ctx.once('babies', () => {
    const { from, to } = ctx.period;
    const out = [];
    for (const p of ctx.patientsInScope) {
      if (!isBornBaby(p, ctx.now)) continue;
      const on = ctx.hday(p.newborn.birthAt);
      if (inRange(on, from, to)) out.push({ p, id: idOf(p), on });
    }
    return out;
  });

/** Visits marked "entered in error" in the period, whose patient is in scope. */
export const cancelledInPeriod = (ctx) => ctx.once('cancelled', () => ctx.data.cancelledVisits.filter((v) => ctx.isInScope(pidOf(v))));

// ---------- Deliveries tab ----------

const timeOfDelivery = (d) => {
  const t = d.content?.deliveredAt ? new Date(d.content.deliveredAt).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * The deliveries of the period: delivery notes a doctor confirmed (load.js), whose time of delivery falls in the
 * period by the hospital's date, of a mother in scope (for a doctor, a mother whose clinical details they may see;
 * under "My patients", one assigned to them). Oldest first. [{ key, pid, docId, at, on, mode, pph, babies }]:
 * key is the delivery's own entry ('<mother id>|<note id>', facts.js unitKey); mode and pph are '' when not
 * recorded; babies as written on the note (outcome, stillbirthType, apgar5, breastfedWithinHour, nicu).
 */
export const deliveriesInPeriod = (ctx) =>
  ctx.once('deliveries', () => {
    const { from, to } = ctx.period;
    const out = [];
    for (const d of ctx.data.deliveries ?? []) {
      const at = timeOfDelivery(d);
      if (at == null) continue;
      const pid = pidOf(d);
      if (!ctx.isInScope(pid)) continue;
      const on = ctx.hday(new Date(at));
      if (!inRange(on, from, to)) continue;
      const c = d.content ?? {};
      out.push({ key: unitKey(pid, d._id), pid, docId: String(d._id), at, on, mode: c.mode || '', pph: c.pph || '', babies: Array.isArray(c.babies) ? c.babies : [] });
    }
    return out.sort((a, b) => a.at - b.at || a.docId.localeCompare(b.docId));
  });

/**
 * Every baby on those delivery notes: [{ key ('<mother id>|<note id>|<n>'), pid, on, n (1, 2 …), of (babies on the
 * note), baby, delivery }]. Twins count as two babies.
 */
export const birthsInPeriod = (ctx) =>
  ctx.once('births', () =>
    deliveriesInPeriod(ctx).flatMap((d) => d.babies.map((baby, i) => ({ key: unitKey(d.pid, d.docId, i + 1), pid: d.pid, on: d.on, n: i + 1, of: d.babies.length, baby: baby ?? {}, delivery: d }))),
  );

/** A delivery or a baby as the detail of a list row: the day of delivery, the mode, which baby of how many. */
export const deliveryDetail = (d) => ({ type: 'delivery', on: isoDay(d.on), mode: d.mode || null });
export const birthDetail = (b, extra = {}) => ({ type: 'birth', on: isoDay(b.on), baby: b.n, of: b.of, ...extra });

/**
 * Deaths a doctor recorded on records in scope, whose day of death is in the period: [{ p, id, on, baby }]. baby: a
 * baby's record (newborn). A death recorded in error and undone is not on the record any more (deathHistory), so
 * it is never counted.
 */
export const deathsInPeriod = (ctx) =>
  ctx.once('deaths', () => {
    const { from, to } = ctx.period;
    const out = [];
    for (const p of ctx.patientsInScope) {
      const on = utcDay(p.death?.on);
      if (!on || !inRange(on, from, to)) continue;
      out.push({ p, id: idOf(p), on, baby: p.careType === 'newborn' });
    }
    return out;
  });

export const daysAgo = (ctx, n) => addDays(ctx.today, -n);

/**
 * Current antenatal care plans of patients in scope, as a read of the plan would show them now (previewSync:
 * following her type of care and EDD, then worked out again – never saved), with every item's status today:
 * Map patient id → { plan, statuses, pausedOn }. Statuses always come from the plan engine, never from stored
 * values. pausedOn (paused plans only, else null): the hospital day it was paused, from the stored plan log
 * (the preview's log is thrown away); today if only the preview pauses it (the saved sync has not run yet);
 * undefined if it is paused but the day is not known.
 */
export const currentPlansNow = (ctx) =>
  ctx.once('plansNow', () => {
    const out = new Map();
    for (const pl of ctx.data.fullPlans ?? []) {
      if (!pl.current || !ctx.isInScope(pidOf(pl))) continue;
      const p = ctx.byId.get(pidOf(pl));
      if (!p) continue;
      const plan = previewSync(pl, p, ctx.now);
      let pausedOn = null;
      if (plan.status === 'paused') {
        const at = pl.status === 'paused' ? (pl.log ?? []).findLast((l) => l.action === 'paused')?.at : ctx.now;
        pausedOn = at ? ctx.hday(at) : undefined;
      }
      out.set(pidOf(pl), { plan, statuses: planStatuses(plan, ctx.today), pausedOn });
    }
    return out;
  });

/** The hospital's standard template items by key: Map key → { name, appliesWhen }. */
export const templateItems = (ctx) => ctx.once('templateItems', () => new Map((ctx.data.template?.items ?? []).map((t) => [t.key, { name: t.name, appliesWhen: t.appliesWhen ?? 'always' }])));
