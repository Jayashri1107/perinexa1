// Tab "Risk & conditions": C1 risk level, C2 risk reasons, C9 information missing for the risk check, C4
// mothers' profile, D1 known conditions, D3 BP 140/90 or higher, D4 anaemia, D6 baby not head-down at 36 weeks.
// Every card is as of today over active pregnancies, except D3 and D4 (visits in the period). Risk levels are
// the stored ones (the route brings them up to date first). Rows that would show a diagnosis to a hospital
// admin (roles.js ADMIN_HIDDEN) are not computed for admins at all.

import { isoDay, utcDay } from '../../careplans/dates.js';
import { isFirstPregnancy, RISK_FACTORS } from '../../careplans/risk.js';
import { CONDITIONS, currentAge } from '../../models/Patient.js';
import { albuminOnePlus, bpHigh, bpSevere, gaAt, grandThreshold, hasBp, hbBand, pregnancyVisitsIn } from '../facts.js';
import { activeInScope } from '../populations.js';
import { gaDetail, hashCode, hiddenFor, sets } from './util.js';

const ALL = ['doctor', 'admin', 'platform'];
const NOT_ADMIN = ['doctor', 'platform'];

// ---------- C1 Risk level ----------

const LEVELS = ['high', 'moderate', 'low', 'incomplete'];

export const C1 = {
  id: 'C1',
  section: 'risk',
  order: 10,
  title: 'Risk level',
  window: 'now',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight'],
  uses: ['A2'],
  total: { key: 'total', code: 'c0', label: 'Active pregnancies', same: 'A2.total' },
  cells: [
    { key: 'high', code: 'c1', label: 'High-risk', status: 'high', list: true },
    { key: 'moderate', code: 'c2', label: 'Moderate-risk', status: 'moderate', list: true },
    { key: 'low', code: 'c3', label: 'Low-risk', status: 'low', list: true },
    { key: 'incomplete', code: 'c4', label: 'Incomplete – information missing', status: 'incomplete', list: true },
    { key: 'none', code: 'c5', label: 'Not assessed yet', unknown: true, list: true },
  ],
  relations: [{ total: 'total', parts: ['high', 'moderate', 'low', 'incomplete', 'none'] }],
  list: { order: 'gaDesc', detailLabel: 'Gestation today' },
  emptyText: 'No active pregnancies.',
  notes: ['Information missing is never counted as low risk.', "The level shown is the doctor's if a doctor changed it, otherwise the automatic one."],
  compute(ctx) {
    const out = sets(...LEVELS, 'none');
    const details = new Map();
    for (const { p, id, ga } of activeInScope(ctx)) {
      const level = LEVELS.includes(p.risk?.level) ? p.risk.level : 'none';
      out[level].add(id);
      details.set(id, gaDetail(ga));
    }
    return { cells: out, details };
  },
};

// ---------- C2 Risk reasons (doctors and the super admin only) ----------

const TOP_REASONS = 10;
// The super admin's card has every reason and no "Other reasons" row, so each reason can be added up across
// hospitals: a reason in one hospital's top 10 may be folded into another hospital's "Other reasons". Doctors
// get the top 10 and "Other reasons".
const onPlatform = (ctx) => ctx.audience === 'platform';
const topReasons = (ctx) => (onPlatform(ctx) ? Infinity : TOP_REASONS);
const OTHER_REASONS = { key: 'other', code: 'c1', label: 'Other reasons', list: true };

/** The distinct risk reasons of active pregnancies in scope: [{ key, code, label, ids }], most common first. */
const reasonRows = (ctx) =>
  ctx.once('C2.rows', () => {
    const byKey = new Map();
    for (const { p, id } of activeInScope(ctx)) {
      const at = p.risk?.computedAt ? new Date(p.risk.computedAt).getTime() : 0;
      for (const r of p.risk?.reasons ?? []) {
        if (!r?.key) continue;
        let row = byKey.get(r.key);
        if (!row) byKey.set(r.key, (row = { key: r.key, code: hashCode(r.key), label: r.label || r.key, at: -1, ids: new Set() }));
        row.ids.add(id);
        if (r.label && at > row.at) [row.label, row.at] = [r.label, at]; // the most recent label of this reason
      }
    }
    return [...byKey.values()].sort((a, b) => b.ids.size - a.ids.size || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  });

export const C2 = {
  id: 'C2',
  section: 'risk',
  order: 20,
  title: 'Most common high- and moderate-risk reasons',
  window: 'now',
  form: 'bars',
  scopeable: true,
  audiences: NOT_ADMIN,
  needs: ['patients', 'plansLight'],
  uses: ['A2'],
  total: { key: 'total', code: 'c0', label: 'Active pregnancies', same: 'A2.total' },
  cells: (ctx) => [
    ...reasonRows(ctx)
      .slice(0, topReasons(ctx))
      .map((r) => ({ key: r.code, code: r.code, label: r.label, list: true })),
    ...(onPlatform(ctx) ? [] : [OTHER_REASONS]),
  ],
  relations: (ctx) => [
    ...reasonRows(ctx)
      .slice(0, topReasons(ctx))
      .map((r) => ({ sub: r.code, sup: 'total' })),
    ...(onPlatform(ctx) ? [] : [{ sub: 'other', sup: 'total' }]),
  ],
  list: { order: 'gaDesc', detailLabel: 'Gestation today' },
  emptyText: 'No active pregnancy has a high- or moderate-risk reason.',
  notes: (ctx) => [
    'A woman can have more than one reason, so the rows add up to more than the total. Each row is out of all active pregnancies.',
    ...(onPlatform(ctx) ? ['Every reason is listed.'] : []),
  ],
  compute(ctx) {
    const rows = reasonRows(ctx);
    const cells = onPlatform(ctx) ? {} : { other: new Set() };
    rows.slice(0, topReasons(ctx)).forEach((r) => (cells[r.code] = r.ids));
    if (!onPlatform(ctx)) for (const r of rows.slice(TOP_REASONS)) for (const id of r.ids) cells.other.add(id);
    const details = new Map(activeInScope(ctx).map(({ id, ga }) => [id, gaDetail(ga)]));
    return { cells, details };
  },
};

// ---------- C9 Information missing for the risk check (doctors and the super admin only) ----------

const needsOf = (factor) => RISK_FACTORS[factor].needs;
// The fixed rows, in this order; codes c1…c9 by position. Each matches the words the risk check writes.
export const MISSING_ROWS = [
  { key: 'age', label: 'Age', match: (m) => m === needsOf('age') },
  { key: 'height', label: 'Height', match: (m) => m === needsOf('heightCm') },
  { key: 'weight', label: 'Weight', match: (m) => m === needsOf('weightKg') },
  { key: 'obstetric', label: 'Obstetric history (G P L A)', match: (m) => [needsOf('gravida'), needsOf('para'), needsOf('abortions')].includes(m) },
  { key: 'caesareans', label: 'Number of previous caesareans', match: (m) => m === needsOf('previousCaesareans') },
  { key: 'bloodGroup', label: 'Blood group', match: (m) => m === needsOf('rhNegative') },
  { key: 'conditions', label: 'Pre-existing conditions (tick any, or confirm none known)', match: (m) => m === needsOf('condition') },
  { key: 'pastProblems', label: 'Problems in previous pregnancies (tick any, or confirm none)', match: (m) => m === needsOf('pastComplication') },
  { key: 'other', label: 'Other', match: () => true }, // anything else folds in here
];
export const missingRowOf = (text) => MISSING_ROWS.find((r) => r.match(text)).key;

export const C9 = {
  id: 'C9',
  section: 'risk',
  order: 30,
  title: 'Information missing for the risk check',
  window: 'now',
  form: 'bars',
  scopeable: true,
  audiences: NOT_ADMIN,
  needs: ['patients', 'plansLight'],
  uses: ['A2'],
  total: { key: 'total', code: 'c0', label: 'Active pregnancies', same: 'A2.total' },
  cells: MISSING_ROWS.map((r, i) => ({ key: r.key, code: `c${i + 1}`, label: r.label, list: true, ...(r.key === 'other' ? { unknown: true } : {}) })),
  relations: MISSING_ROWS.map((r) => ({ sub: r.key, sup: 'total' })),
  list: { order: 'gaDesc', detailLabel: 'Gestation today' },
  emptyText: 'No active pregnancies.',
  notes: ['A woman can miss more than one item, so the rows add up to more than the total. Each row is out of all active pregnancies.'],
  compute(ctx) {
    const out = sets(...MISSING_ROWS.map((r) => r.key));
    const details = new Map();
    for (const { p, id, ga } of activeInScope(ctx)) {
      for (const m of p.risk?.missing ?? []) out[missingRowOf(m)].add(id);
      details.set(id, gaDetail(ga));
    }
    return { cells: out, details };
  },
};

// ---------- C4 Mothers' profile ----------

const grandOf = (ctx) => ctx.once('grand', () => grandThreshold(ctx.data.template));

const AGE = [
  { key: 'age:lt18', label: 'Under 18' },
  { key: 'age:a18_19', label: '18 to 19' },
  { key: 'age:a20_34', label: '20 to 34' },
  { key: 'age:a35p', label: '35 or older' },
  { key: 'age:unknown', label: 'Age not recorded', unknown: true },
];
const PREGNANCY_NUMBER = (n) => [
  { key: 'preg:g1', label: 'First pregnancy' },
  { key: 'preg:multi', label: 'Second or later pregnancy' },
  { key: 'preg:grand', label: `Grand multipara (${n} or more births)` },
  { key: 'preg:unknown', label: 'Not recorded', unknown: true },
];
const CAESAREAN = [
  { key: 'cs:none', label: 'No previous caesarean' },
  { key: 'cs:one', label: 'One previous caesarean' },
  { key: 'cs:twoPlus', label: 'Two or more' },
  { key: 'cs:unknown', label: 'Not recorded', unknown: true },
];
const BLOOD = [
  { key: 'blood:rhNeg', label: 'Rh negative' },
  { key: 'blood:rhPos', label: 'Rh positive' },
  { key: 'blood:unknown', label: 'Blood group not recorded', unknown: true },
];
const C4_GROUPS = (ctx) => [
  { group: 'age', title: 'Age now', rows: AGE },
  { group: 'pregnancies', title: 'Pregnancy number', rows: PREGNANCY_NUMBER(grandOf(ctx).n) },
  { group: 'caesarean', title: 'Previous caesarean', rows: CAESAREAN },
  ...(hiddenFor(ctx, 'C4.blood') ? [] : [{ group: 'blood', title: 'Blood group', rows: BLOOD }]),
];
// Codes are fixed by position over all four groups (blood group last), whoever is asking.
const C4_CODES = new Map([...AGE, ...PREGNANCY_NUMBER(0), ...CAESAREAN, ...BLOOD].map((r, i) => [r.key, `c${i + 1}`]));

function ageKey(age) {
  if (age == null) return 'age:unknown';
  if (age < 18) return 'age:lt18';
  if (age < 20) return 'age:a18_19';
  if (age < 35) return 'age:a20_34';
  return 'age:a35p';
}
function pregnancyKey(p, grand) {
  const o = p.obstetric ?? {};
  if (o.para != null && o.para >= grand) return 'preg:grand';
  if (o.gravida == null) return 'preg:unknown';
  return o.gravida === 1 ? 'preg:g1' : 'preg:multi';
}
function caesareanKey(p) {
  const cs = p.obstetric?.previousCaesareans;
  if (cs === 0 || (cs == null && isFirstPregnancy(p))) return 'cs:none';
  if (cs == null) return 'cs:unknown';
  return cs === 1 ? 'cs:one' : 'cs:twoPlus';
}
function bloodKey(p) {
  const g = p.medical?.bloodGroup;
  if (!g) return 'blood:unknown';
  return g.endsWith('-') ? 'blood:rhNeg' : 'blood:rhPos';
}

export const C4 = {
  id: 'C4',
  section: 'risk',
  order: 40,
  title: "Mothers' profile",
  window: 'now',
  form: 'groups',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight', 'template'],
  uses: ['A2'],
  total: { key: 'total', code: 'c0', label: 'Active pregnancies', same: 'A2.total' },
  cells: (ctx) => C4_GROUPS(ctx).flatMap((g) => g.rows.map((r) => ({ ...r, code: C4_CODES.get(r.key), group: g.group, list: true }))),
  relations: (ctx) => C4_GROUPS(ctx).map((g) => ({ total: 'total', parts: g.rows.map((r) => r.key) })),
  list: { order: 'gaDesc', detailLabel: 'Gestation today' },
  emptyText: 'No active pregnancies.',
  notes: (ctx) => [
    'Each group adds up to all active pregnancies.',
    {
      rule: "Grand multipara uses the number of births in your hospital's risk rules.",
      none: `Your hospital's risk rules have no grand multipara rule, so ${grandOf(ctx).n} or more births is used.`,
      unreadable: `Your hospital's grand multipara rule is not written as 'at least a number of births', so ${grandOf(ctx).n} or more births is used. A doctor can check the rule in the care plan settings.`,
    }[grandOf(ctx).source],
  ],
  compute(ctx) {
    const blood = !hiddenFor(ctx, 'C4.blood');
    const keys = C4_GROUPS(ctx).flatMap((g) => g.rows.map((r) => r.key));
    const out = sets(...keys);
    const details = new Map();
    const { n } = grandOf(ctx);
    for (const { p, id, ga } of activeInScope(ctx)) {
      out[ageKey(currentAge(p, ctx.now))].add(id);
      out[pregnancyKey(p, n)].add(id);
      out[caesareanKey(p)].add(id);
      if (blood) out[bloodKey(p)].add(id);
      details.set(id, gaDetail(ga));
    }
    return { cells: out, details };
  },
};

// ---------- D1 Known conditions before pregnancy ----------

// The same words as the patient form (client/src/pages/patients/patientFormat.js CONDITION_LABELS; a test
// checks both copies). Rows are 'c' + the 1-based position in CONDITIONS (append-only); 'known'/'unknown' use
// the reserved codes c98/c99, at the top of the two-digit range, so appending conditions never clashes.
export const CONDITION_LABELS = {
  diabetes: 'Diabetes',
  hypertension: 'High blood pressure',
  thyroid: 'Thyroid disease',
  heart_disease: 'Heart disease',
  asthma: 'Asthma',
  epilepsy: 'Epilepsy',
  anaemia: 'Anaemia',
  tuberculosis: 'Tuberculosis',
  hiv: 'HIV',
  hepatitis_b: 'Hepatitis B',
  syphilis: 'Syphilis',
  uterine_surgery: 'Previous surgery on the uterus (e.g. myomectomy)',
  renal_disease: 'Kidney disease',
  autoimmune: 'Autoimmune disease (e.g. SLE, APS)',
  thrombophilia: 'Thrombophilia (clotting disorder)',
  mental_health: 'Mental health condition',
  liver_disease: 'Other liver disease / jaundice',
};
const conditionsKnown = (p) => (p.medical?.conditions?.length ?? 0) > 0 || p.medical?.conditionsReviewed === true;

export const D1 = {
  id: 'D1',
  section: 'risk',
  order: 50,
  title: 'Known conditions before pregnancy',
  window: 'now',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight'],
  uses: ['A2'],
  total: { key: 'total', code: 'c0', label: 'Active pregnancies', same: 'A2.total' },
  cells: (ctx) => [
    { key: 'known', code: 'c98', label: 'Conditions known', den: true, list: true, group: 'known' },
    { key: 'unknown', code: 'c99', label: 'Not asked or not recorded yet', unknown: true, list: true, group: 'known' },
    ...(hiddenFor(ctx, 'D1.rows') ? [] : CONDITIONS.map((c, i) => ({ key: c, code: `c${i + 1}`, label: CONDITION_LABELS[c] ?? c, list: true, group: 'rows' }))),
  ],
  relations: (ctx) => [{ total: 'total', parts: ['known', 'unknown'] }, ...(hiddenFor(ctx, 'D1.rows') ? [] : CONDITIONS.map((c) => ({ sub: c, sup: 'known' })))],
  shares: [{ key: 'known', label: 'Known', num: 'known', den: 'total' }],
  list: { order: 'gaDesc', detailLabel: 'Gestation today' },
  emptyText: 'No active pregnancies.',
  notes: (ctx) =>
    hiddenFor(ctx, 'D1.rows')
      ? ['Known: at least one condition ticked, or "none known" confirmed.', 'Condition-by-condition numbers are only for doctors.']
      : ['Known: at least one condition ticked, or "none known" confirmed. Each condition is out of the women whose conditions are known.'],
  compute(ctx) {
    const rows = !hiddenFor(ctx, 'D1.rows');
    const out = sets('known', 'unknown', ...(rows ? CONDITIONS : []));
    const details = new Map();
    for (const { p, id, ga } of activeInScope(ctx)) {
      const known = conditionsKnown(p);
      out[known ? 'known' : 'unknown'].add(id);
      if (rows && known) for (const c of new Set(p.medical?.conditions ?? [])) if (out[c]) out[c].add(id);
      details.set(id, gaDetail(ga));
    }
    return { cells: out, details };
  },
};

// ---------- D3 BP 140/90 or higher at a visit (period) ----------

const bpOrder = (a, b) => b.vitals.bpSystolic - a.vitals.bpSystolic || b.vitals.bpDiastolic - a.vitals.bpDiastolic;

/** Women in scope with a current-pregnancy antenatal visit in the period that has both BP numbers: [{ p, id, visits }]. */
const bpWomen = (ctx) =>
  ctx.once('D3.women', () => {
    const out = [];
    for (const p of ctx.patientsInScope) {
      if (!ctx.visitsOf(p).length) continue;
      const visits = pregnancyVisitsIn(p, ctx, ctx.period.from, ctx.period.to).filter(hasBp);
      if (visits.length) out.push({ p, id: String(p._id), visits });
    }
    return out;
  });

export const D3 = {
  id: 'D3',
  section: 'risk',
  order: 60,
  title: 'BP 140/90 or higher at a visit',
  window: 'period',
  form: 'shares',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'windowVisits', 'visitVitals'],
  total: { key: 'total', code: 'c0', label: 'Women with BP recorded at a visit', list: true },
  cells: (ctx) => [
    { key: 'high', code: 'c1', label: 'BP 140/90 or higher at a visit', list: true },
    { key: 'normal', code: 'c2', label: 'All readings below 140/90', list: true },
    ...(hiddenFor(ctx, 'D3.subRows')
      ? []
      : [
          { key: 'severe', code: 'c3', label: 'BP 160/110 or higher at a visit', list: true, group: 'sub' },
          { key: 'twoPlus', code: 'c4', label: 'BP 140/90 or higher at 2 or more visits', list: true, group: 'sub' },
          { key: 'withAlbumin', code: 'c5', label: 'With urine albumin 1+ or more, from 20 weeks', list: true, group: 'sub' },
        ]),
  ],
  relations: (ctx) => [
    { total: 'total', parts: ['high', 'normal'] },
    ...(hiddenFor(ctx, 'D3.subRows') ? [] : ['severe', 'twoPlus', 'withAlbumin'].map((k) => ({ sub: k, sup: 'high' }))),
  ],
  shares: [{ key: 'high', label: 'BP 140/90 or higher at a visit', num: 'high', den: 'total' }],
  list: { order: 'bpDesc', detailLabel: 'Highest BP' },
  emptyText: 'No BP was recorded at an antenatal visit in this period.',
  notes: ['A reading, not a diagnosis. Visits with no BP recorded are not counted.', 'Visits from an earlier pregnancy on the same record are left out.'],
  compute(ctx) {
    const sub = !hiddenFor(ctx, 'D3.subRows');
    const out = sets('total', 'high', 'normal', ...(sub ? ['severe', 'twoPlus', 'withAlbumin'] : []));
    const details = new Map();
    for (const { p, id, visits } of bpWomen(ctx)) {
      out.total.add(id);
      const high = visits.filter(bpHigh);
      out[high.length ? 'high' : 'normal'].add(id);
      if (sub && high.length) {
        if (high.some(bpSevere)) out.severe.add(id);
        if (high.length >= 2) out.twoPlus.add(id);
        if (high.some((v) => albuminOnePlus(v) && (gaAt(p, v.visitOn)?.totalDays ?? -1) >= 140)) out.withAlbumin.add(id);
      }
      const top = [...visits].sort(bpOrder)[0];
      details.set(id, { type: 'bp', sys: top.vitals.bpSystolic, dia: top.vitals.bpDiastolic, on: isoDay(top.visitOn) });
    }
    return { cells: out, details };
  },
};

// ---------- D4 Anaemia by the lowest Hb in the period ----------

export const D4 = {
  id: 'D4',
  section: 'risk',
  order: 70,
  title: 'Anaemia by the lowest Hb in the period',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'windowVisits', 'visitVitals'],
  uses: ['D3'],
  total: { key: 'total', code: 'c0', label: 'Women with Hb recorded', list: true },
  cells: (ctx) => [
    { key: 'none', code: 'c1', label: 'No anaemia', sub: '11.0 g/dL or more', list: true },
    { key: 'mild', code: 'c2', label: 'Mild', sub: '10.0 to 10.9', list: true },
    ...(hiddenFor(ctx, 'D4.split')
      ? [{ key: 'modSevere', code: 'c5', label: 'Moderate or severe', sub: 'under 10.0', list: true }]
      : [
          { key: 'moderate', code: 'c3', label: 'Moderate', sub: '7.0 to 9.9', list: true },
          { key: 'severe', code: 'c4', label: 'Severe', sub: 'under 7.0', list: true },
        ]),
    { key: 'seen', code: 'c6', label: 'Women seen for antenatal care in the period', den: true, list: true },
  ],
  virtual: ['noHb'],
  relations: (ctx) => [
    { total: 'seen', parts: ['total', 'noHb'] },
    { total: 'total', parts: hiddenFor(ctx, 'D4.split') ? ['none', 'mild', 'modSevere'] : ['none', 'mild', 'moderate', 'severe'] },
    { sub: 'D3.total', sup: 'seen' },
  ],
  shares: [{ key: 'recorded', label: 'Hb recorded', num: 'total', den: 'seen' }],
  list: { order: 'hbAsc', detailLabel: 'Lowest Hb' },
  emptyText: 'No Hb was recorded at an antenatal visit in this period.',
  notes: ['Hb entered at visits only; lab results in the care plan are free text.', 'Visits from an earlier pregnancy on the same record are left out.'],
  compute(ctx) {
    const split = !hiddenFor(ctx, 'D4.split');
    const out = sets('seen', 'total', 'noHb', 'none', 'mild', ...(split ? ['moderate', 'severe'] : ['modSevere']));
    const details = new Map();
    for (const p of ctx.patientsInScope) {
      if (!ctx.visitsOf(p).length) continue;
      const visits = pregnancyVisitsIn(p, ctx, ctx.period.from, ctx.period.to);
      if (!visits.length) continue;
      const id = String(p._id);
      out.seen.add(id);
      const withHb = visits.filter((v) => v.vitals?.hb != null);
      if (!withHb.length) {
        out.noHb.add(id);
        continue;
      }
      out.total.add(id);
      const low = withHb.reduce((a, v) => (v.vitals.hb < a.vitals.hb ? v : a)); // the first (oldest) of equal lows
      const band = hbBand(low.vitals.hb);
      out[!split && (band === 'moderate' || band === 'severe') ? 'modSevere' : band].add(id);
      details.set(id, { type: 'hb', value: low.vitals.hb, on: isoDay(low.visitOn) });
    }
    return { cells: out, details };
  },
};

// ---------- D6 Baby not head-down at 36 weeks or later ----------

const CEPHALIC = 'cephalic';
const NOT_CEPHALIC = ['breech', 'transverse', 'oblique', 'variable'];
const WEEK_36 = 252;

export const D6 = {
  id: 'D6',
  section: 'risk',
  order: 80,
  title: 'Baby not head-down at 36 weeks or later',
  window: 'now',
  form: 'bars',
  scopeable: true,
  audiences: ALL,
  needs: ['patients', 'plansLight', 'windowVisits', 'visitVitals'],
  // The identities with other cards (declared here, where all of them are computed).
  uses: ['A2', 'A3', 'D9'],
  total: { key: 'total', code: 'c0', label: 'Active pregnancies from 36 weeks', list: true },
  cells: [
    { key: 'cephalic', code: 'c1', label: 'Head-down (cephalic)', list: true },
    { key: 'notCephalic', code: 'c2', label: 'Not head-down', sub: 'breech, transverse, oblique or variable', list: true },
    { key: 'notRecorded', code: 'c3', label: 'Not recorded from 36 weeks', unknown: true, list: true },
  ],
  virtual: ['eddT28'], // EDD exactly 28 days from today (36 w 0 d today)
  relations: [
    { total: 'total', parts: ['cephalic', 'notCephalic', 'notRecorded'] },
    // From 36 weeks means an EDD at most 4 weeks away; active means an EDD at most 4 weeks ago.
    { total: 'total', parts: ['D9.total', 'A3.next4', 'eddT28'] },
    { total: 'A2.t3', parts: ['total', 'A2.ga196_251'] },
  ],
  list: { order: 'gaDesc', detailLabel: 'Gestation today' },
  emptyText: 'No active pregnancy is at 36 weeks or later.',
  notes: ['The latest presentation recorded at a visit from 36 weeks of this pregnancy.'],
  compute(ctx) {
    const out = sets('total', 'cephalic', 'notCephalic', 'notRecorded', 'eddT28');
    const details = new Map();
    for (const { p, id, edd, ga } of activeInScope(ctx)) {
      if (!ga || ga.totalDays < WEEK_36) continue;
      out.total.add(id);
      if (edd && utcDay(edd).getTime() === ctx.today.getTime() + 28 * 86_400_000) out.eddT28.add(id);
      let latest = null;
      for (const v of pregnancyVisitsIn(p, ctx, new Date(0), ctx.today)) {
        if ((gaAt(p, v.visitOn)?.totalDays ?? -1) < WEEK_36) continue;
        if (v.details?.presentation) latest = v.details.presentation; // visits are oldest first
      }
      out[latest === CEPHALIC ? 'cephalic' : NOT_CEPHALIC.includes(latest) ? 'notCephalic' : 'notRecorded'].add(id);
      details.set(id, gaDetail(ga));
    }
    return { cells: out, details };
  },
};

export const RISK_METRICS = [C1, C2, C9, C4, D1, D3, D4, D6];
