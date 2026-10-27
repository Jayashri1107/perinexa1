// Tab "Fertility" (fertility idea F8, the owner's go-ahead of 27 Oct 2026): how the treatment cycles and plans of the
// period ended – K1 cycles by step, K2 the pregnancy test of the completed cycles, K3 cancelled cycles and why, K4 how
// plans ended (pregnant, moved to the next step, stopped and why), K5 time from her first plan to a pregnancy.
//
// Units: a cycle is '<patient id>|<cycle id>', a plan '<patient id>|<plan id>' (facts.js unitKey): a woman with two
// cycles in the period counts twice, and every number is exactly the length of its list (one row per cycle or plan).
// A cycle ends on the day it was cancelled, or on the day of its test result (or the last change of the sheet when
// no day is written); a plan on the day its outcome was recorded.
//
// Who sees what: doctors – every card over the women whose clinical details they may see, with the lists; hospital
// admins – K1 only (how many cycles, small numbers protected as on every card), since outcomes in a small clinic can
// point to a couple; the super admin – every card, numbers only.

import { isoDay, utcDay } from '../../careplans/dates.js';
import { CANCEL_REASONS } from '../../fertility/cycleFields.js';
import { LADDER_STEPS } from '../../fertility/ladder.js';
import { OUTCOME_KINDS } from '../../models/FertilityPlan.js';
import { idOf, pidOf, unitKey } from '../facts.js';
import { sets } from './util.js';

const STEPS = LADDER_STEPS.map((s) => s.key);
const STEP_LABELS = { follicular_study: 'Follicular study (ovulation induction)', iui: 'IUI', ivf: 'IVF or ICSI' };
const CANCEL_LABELS = { too_many_follicles: 'More than 2 follicles of 14 mm', no_response: 'No response', ovulated_early: 'Ovulated early', patient_choice: "The couple's choice", other: 'Other reason' };
const OUTCOME_LABELS = { pregnant: 'Pregnant', next_step: 'Moved to the next step', no_response: 'Stopped – no response', patient_choice: "Stopped – the couple's choice", discarded: 'Draft discarded', other: 'Stopped – other reason' };
const MONTH_BANDS = [
  { key: 'm3', label: 'Under 3 months', upTo: 3 },
  { key: 'm6', label: '3 to under 6 months', upTo: 6 },
  { key: 'm12', label: '6 to under 12 months', upTo: 12 },
  { key: 'm12plus', label: '12 months or more', upTo: Infinity },
];

const DOCTOR_NOTE = 'Women whose clinical details you may not see are not counted on this tab.';
const doctorNote = (ctx) => (ctx.audience === 'doctor' ? [DOCTOR_NOTE] : []);
const inPeriod = (ctx, on) => on && on >= utcDay(ctx.period.from) && on <= utcDay(ctx.period.to);

/** The day a cycle ended, or null while it is open. */
function cycleEnd(ctx, c) {
  if (c.cancelled) return ctx.hday(new Date(c.cancelled.at ?? c.updatedAt));
  if (c.status !== 'completed') return null;
  const on = c.outcome?.testOn ?? c.outcome?.betaHcgOn ?? c.outcome?.scanOn ?? null;
  return on ? utcDay(on) : ctx.hday(new Date(c.lastEdited?.at ?? c.updatedAt));
}

/** The cycles of the period that ended (completed or cancelled), of women in scope: [{ key, pid, on, c }]. */
const cyclesEnded = (ctx) =>
  ctx.once('fertilityCycles', () => {
    const out = [];
    for (const c of ctx.data.fertilityCycles ?? []) {
      const pid = pidOf(c);
      if (!ctx.isInScope(pid)) continue;
      const on = cycleEnd(ctx, c);
      if (inPeriod(ctx, on)) out.push({ key: unitKey(pid, idOf(c)), pid, on, c });
    }
    return out;
  });

/** The plans whose outcome was recorded in the period, of women in scope: [{ key, pid, on, plan, firstAt }]. */
const plansEnded = (ctx) =>
  ctx.once('fertilityPlans', () => {
    const first = new Map(); // her first plan's day
    for (const p of ctx.data.fertilityPlans ?? []) {
      const pid = pidOf(p);
      const at = new Date(p.createdAt);
      if (!first.has(pid) || at < first.get(pid)) first.set(pid, at);
    }
    const out = [];
    for (const p of ctx.data.fertilityPlans ?? []) {
      const pid = pidOf(p);
      if (!p.outcome?.kind || !ctx.isInScope(pid)) continue;
      const on = ctx.hday(new Date(p.outcome.at ?? p.updatedAt));
      if (inPeriod(ctx, on)) out.push({ key: unitKey(pid, idOf(p)), pid, on, plan: p, firstAt: first.get(pid) });
    }
    return out;
  });

const cycleDetail = (x) => ({ type: 'cycle', on: isoDay(x.on), step: x.c.step ?? null });
const planDetail = (x) => ({ type: 'plan', on: isoDay(x.on), outcome: x.plan.outcome.kind });

// ---------- K1 Treatment cycles by step ----------

export const K1 = {
  id: 'K1',
  section: 'fertility',
  order: 10,
  title: 'Treatment cycles ended, by step',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: ['doctor', 'admin', 'platform'],
  needs: ['patients', 'fertility'],
  total: { key: 'total', code: 'c0', label: 'Cycles ended', sub: 'completed or cancelled', list: true },
  cells: [
    ...STEPS.map((s, i) => ({ key: s, code: `c${i + 1}`, label: STEP_LABELS[s] ?? s, list: true })),
    { key: 'noStep', code: 'c98', label: 'Step not recorded', unknown: true, list: true },
  ],
  relations: [{ total: 'total', parts: [...STEPS, 'noStep'] }],
  list: { order: 'endedDesc', detailLabel: 'Cycle' },
  emptyText: 'No treatment cycle ended in this period.',
  notes: (ctx) => [
    'From the cycle (follicular study) sheets: a cycle ends when it is cancelled or its test result is written. The step is the plan’s step when the cycle started.',
    ...doctorNote(ctx),
    ...(ctx.audience === 'admin' ? ['The outcomes of the cycles and plans are only for doctors: in a small clinic even a count can point to a couple.'] : []),
  ],
  compute(ctx) {
    const out = sets('total', 'noStep', ...STEPS);
    const details = new Map();
    for (const x of cyclesEnded(ctx)) {
      out.total.add(x.key);
      out[STEPS.includes(x.c.step) ? x.c.step : 'noStep'].add(x.key);
      details.set(x.key, cycleDetail(x));
    }
    return { cells: out, details };
  },
};

// ---------- K2 The pregnancy test of the completed cycles ----------

export const K2 = {
  id: 'K2',
  section: 'fertility',
  order: 20,
  title: 'Pregnancy test after a completed cycle',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: ['doctor', 'platform'],
  needs: ['patients', 'fertility'],
  total: { key: 'total', code: 'c0', label: 'Cycles completed', list: true },
  cells: [
    { key: 'positive', code: 'c1', label: 'Test positive', list: true },
    { key: 'negative', code: 'c2', label: 'Test negative', list: true },
    { key: 'notDone', code: 'c3', label: 'Test not done', list: true },
    { key: 'noResult', code: 'c4', label: 'No test result written', unknown: true, list: true },
    { key: 'tested', code: 'c5', label: 'Tested', den: true, list: true },
  ],
  relations: [
    { total: 'total', parts: ['positive', 'negative', 'notDone', 'noResult'] },
    { total: 'tested', parts: ['positive', 'negative'] },
  ],
  shares: [{ key: 'positive', label: 'Positive per cycle tested', num: 'positive', den: 'tested' }],
  list: { order: 'endedDesc', detailLabel: 'Cycle' },
  emptyText: 'No treatment cycle was completed in this period.',
  notes: (ctx) => ['A positive test is not yet a clinical pregnancy: the plan’s outcome records that (the next card). Cancelled cycles are not counted here.', ...doctorNote(ctx)],
  compute(ctx) {
    const out = sets('total', 'positive', 'negative', 'notDone', 'noResult', 'tested');
    const details = new Map();
    for (const x of cyclesEnded(ctx)) {
      if (x.c.cancelled) continue;
      out.total.add(x.key);
      const t = x.c.outcome?.test;
      const cell = t === 'positive' ? 'positive' : t === 'negative' ? 'negative' : t === 'not_done' ? 'notDone' : 'noResult';
      out[cell].add(x.key);
      if (cell === 'positive' || cell === 'negative') out.tested.add(x.key);
      details.set(x.key, cycleDetail(x));
    }
    return { cells: out, details };
  },
};

// ---------- K3 Cancelled cycles and why ----------

export const K3 = {
  id: 'K3',
  section: 'fertility',
  order: 30,
  title: 'Cancelled cycles and why',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: ['doctor', 'platform'],
  needs: ['patients', 'fertility'],
  total: { key: 'total', code: 'c0', label: 'Cycles cancelled', list: true },
  cells: CANCEL_REASONS.map((r, i) => ({ key: r, code: `c${i + 1}`, label: CANCEL_LABELS[r] ?? r, list: true })),
  relations: [{ total: 'total', parts: CANCEL_REASONS }],
  list: { order: 'endedDesc', detailLabel: 'Cycle' },
  emptyText: 'No treatment cycle was cancelled in this period.',
  notes: (ctx) => ['As the reason was chosen on the cycle sheet when it was cancelled.', ...doctorNote(ctx)],
  compute(ctx) {
    const out = sets('total', ...CANCEL_REASONS);
    const details = new Map();
    for (const x of cyclesEnded(ctx)) {
      if (!x.c.cancelled) continue;
      out.total.add(x.key);
      out[CANCEL_REASONS.includes(x.c.cancelled.reason) ? x.c.cancelled.reason : 'other'].add(x.key);
      details.set(x.key, cycleDetail(x));
    }
    return { cells: out, details };
  },
};

// ---------- K4 How treatment plans ended ----------

export const K4 = {
  id: 'K4',
  section: 'fertility',
  order: 40,
  title: 'Treatment plans ended, and how',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: ['doctor', 'platform'],
  needs: ['patients', 'fertility'],
  total: { key: 'total', code: 'c0', label: 'Plans ended', list: true },
  cells: OUTCOME_KINDS.map((k, i) => ({ key: k, code: `c${i + 1}`, label: OUTCOME_LABELS[k] ?? k, list: true })),
  relations: [{ total: 'total', parts: OUTCOME_KINDS }],
  shares: [{ key: 'pregnant', label: 'Pregnant', num: 'pregnant', den: 'total' }],
  list: { order: 'endedDesc', detailLabel: 'Plan' },
  emptyText: 'No treatment plan ended in this period.',
  notes: (ctx) => ['By the outcome the doctor recorded on the plan. "Moved to the next step" is a switch along the ladder (follicular study → IUI → IVF or ICSI) or to a procedure.', ...doctorNote(ctx)],
  compute(ctx) {
    const out = sets('total', ...OUTCOME_KINDS);
    const details = new Map();
    for (const x of plansEnded(ctx)) {
      out.total.add(x.key);
      out[OUTCOME_KINDS.includes(x.plan.outcome.kind) ? x.plan.outcome.kind : 'other'].add(x.key);
      details.set(x.key, planDetail(x));
    }
    return { cells: out, details };
  },
};

// ---------- K5 Time to pregnancy ----------

export const K5 = {
  id: 'K5',
  section: 'fertility',
  order: 50,
  title: 'Time from her first plan to a pregnancy',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: ['doctor', 'platform'],
  needs: ['patients', 'fertility'],
  uses: ['K4'],
  total: { key: 'pregnant', code: 'c0', label: 'Plans ended pregnant', same: 'K4.pregnant', list: true },
  cells: MONTH_BANDS.map((b, i) => ({ key: b.key, code: `c${i + 1}`, label: b.label, list: true })),
  relations: [{ total: 'pregnant', parts: MONTH_BANDS.map((b) => b.key) }],
  list: { order: 'endedDesc', detailLabel: 'Plan' },
  emptyText: 'No treatment plan ended in a pregnancy in this period.',
  notes: (ctx) => ['Months from the day her first treatment plan here was built to the day the pregnancy was recorded on a plan.', ...doctorNote(ctx)],
  compute(ctx) {
    const out = sets(...MONTH_BANDS.map((b) => b.key));
    const details = new Map();
    for (const x of plansEnded(ctx)) {
      if (x.plan.outcome.kind !== 'pregnant') continue;
      const months = (x.on - utcDay(x.firstAt)) / (30.44 * 86400000);
      out[MONTH_BANDS.find((b) => months < b.upTo).key].add(x.key);
      details.set(x.key, planDetail(x));
    }
    return { cells: out, details };
  },
};

export const FERTILITY_METRICS = [K1, K2, K3, K4, K5];
