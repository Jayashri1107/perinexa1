// Tab "Deliveries" (5 Oct 2026): what happened at the births of the period, from the delivery notes a doctor
// CONFIRMED (drafts and notes marked "entered in error" are never counted) and from the deaths a doctor recorded on
// the records. H1 deliveries and mode of delivery, H2 postpartum haemorrhage, H3 births and stillbirths, H4 Apgar at
// 5 minutes, H5 NICU or SNCU admission, H6 breastfeeding within one hour, H7 stillbirths and deaths.
//
// Why a tab of its own (not cards on the Newborn tab): the Newborn tab counts the babies' own records (babies
// registered in Perinexa, some born elsewhere, stillborn babies never), while these cards count the delivery notes
// written here – another source with other denominators. Side by side on one tab they would read as one count.
//
// Units: a delivery is one confirmed note, a baby is one baby on it (twins are two). A cell's Set holds them as
// '<mother id>|<note id>' and '<mother id>|<note id>|<n>' (facts.js unitKey), so that two deliveries of one woman in
// the period count twice and every number is exactly the length of its patient list (one row per delivery or baby,
// showing the mother). A death is counted on the record it was recorded on (a plain patient id).
//
// Who sees what: doctors – exact numbers over the mothers (and babies) whose clinical details they may see, and the
// patient lists; hospital admins – H1 and H2 only, with small numbers protected (roles.js ADMIN_HIDDEN says why the
// others are kept from them); the super admin – every card, numbers only.

import { DELIVERY_MODES, PPH_ML_CAESAREAN, PPH_ML_VAGINAL, PPH_SOURCE } from '../../inpatient/docSchemas.js';
import { DEATH_DEFINITIONS_SOURCE, DEATH_TIMINGS, EARLY_NEONATAL_DAYS, MATERNAL_DEATH_TIMINGS, NEONATAL_DAYS } from '../../patients/deathRules.js';
import { isoDay } from '../../careplans/dates.js';
import { bucketKeyOfDate } from '../period.js';
import { birthDetail, birthsInPeriod, deathsInPeriod, deliveriesInPeriod, deliveryDetail } from '../populations.js';
import { ADMIN_HIDDEN } from '../roles.js';
import { trendCells, trendKeys } from './overview.js';
import { sets } from './util.js';

/** Every audience, except hospital admins for a card in roles.js ADMIN_HIDDEN. */
const audiencesOf = (id) => (ADMIN_HIDDEN.includes(id) ? ['doctor', 'platform'] : ['doctor', 'admin', 'platform']);

// Said once, on the first card: every card of the tab counts the deliveries (and babies) of the same women.
const DOCTOR_NOTE = 'Deliveries of women whose clinical details you may not see are not counted on this tab.';
const FROM_NOTES = 'From the delivery notes a doctor confirmed, by the date of delivery. Drafts and notes marked “entered in error” are not counted.';
const LIVE_BIRTHS_EMPTY = 'No live births on the delivery notes confirmed for this period.';
const doctorNote = (ctx) => (ctx.audience === 'doctor' ? [DOCTOR_NOTE] : []);

// ---------- H1 Deliveries and mode of delivery ----------

// Cell codes follow DELIVERY_MODES (inpatient/docSchemas.js): c1 normal … c5 other; a new mode goes at the end and
// takes the next code. "Not recorded" and "recorded" keep the reserved codes c98 and c99, so they never clash.
export const MODE_LABELS = { normal: 'Normal vaginal', vacuum: 'Vacuum-assisted', forceps: 'Forceps', lscs: 'Caesarean section', other: 'Other' };
const MODES = DELIVERY_MODES;

export const H1 = {
  id: 'H1',
  section: 'deliveries',
  order: 10,
  title: 'Deliveries and mode of delivery',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: audiencesOf('H1'),
  needs: ['patients', 'deliveries'],
  total: { key: 'total', code: 'c0', label: 'Deliveries', sub: 'confirmed delivery notes', list: true },
  cells: (ctx) => [
    ...MODES.map((m, i) => ({ key: m, code: `c${i + 1}`, label: MODE_LABELS[m] ?? m, list: true })),
    { key: 'noMode', code: 'c98', label: 'Mode not recorded', unknown: true, list: true },
    { key: 'known', code: 'c99', label: 'Mode recorded', den: true, list: true },
    ...trendCells(ctx),
  ],
  relations: (ctx) => [
    { total: 'total', parts: ['known', 'noMode'] },
    { total: 'known', parts: MODES },
    { total: 'total', parts: trendKeys(ctx) },
  ],
  trend: (ctx) => ({ cells: trendKeys(ctx), color: 'bar' }),
  shares: [{ key: 'lscs', label: 'Caesarean rate', num: 'lscs', den: 'known' }],
  list: { order: 'deliveredDesc', detailLabel: 'Delivery' },
  emptyText: 'No delivery note was confirmed for a delivery in this period.',
  notes: (ctx) => [
    FROM_NOTES,
    'Each delivery counts once, whatever the number of babies. Caesarean rate: caesarean sections out of the deliveries whose mode is recorded.',
    ...doctorNote(ctx),
    ...(ctx.audience === 'admin'
      ? ['Births and stillbirths, Apgar, NICU or SNCU admissions, breastfeeding and deaths are only for doctors: in a small hospital even a count can point to a family.']
      : []),
  ],
  compute(ctx) {
    const out = sets('total', 'known', 'noMode', ...MODES, ...trendKeys(ctx));
    const details = new Map();
    for (const d of deliveriesInPeriod(ctx)) {
      out.total.add(d.key);
      out[`b:${bucketKeyOfDate(d.on, ctx.period.kind)}`].add(d.key);
      if (MODES.includes(d.mode)) {
        out.known.add(d.key);
        out[d.mode].add(d.key);
      } else out.noMode.add(d.key);
      details.set(d.key, deliveryDetail(d));
    }
    return { cells: out, details };
  },
};

// ---------- H2 Postpartum haemorrhage ----------

// The numbers the delivery note suggests it from, written as the card says them ("1,000 mL").
const ml = (n) => `${n.toLocaleString('en-IN')} mL`;

export const H2 = {
  id: 'H2',
  section: 'deliveries',
  order: 20,
  // (in plain words first: hospital admins see this card too – as the rest of the app says it, patientFormat.js)
  title: 'Heavy bleeding after delivery (postpartum haemorrhage)',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: audiencesOf('H2'),
  needs: ['patients', 'deliveries'],
  uses: ['H1'],
  total: { key: 'total', code: 'c0', label: 'Deliveries', same: 'H1.total', list: true },
  cells: [
    { key: 'yes', code: 'c1', label: 'Heavy bleeding (PPH)', list: true },
    { key: 'no', code: 'c2', label: 'No heavy bleeding', list: true },
    { key: 'notRecorded', code: 'c3', label: 'Not recorded', unknown: true, list: true },
    { key: 'answered', code: 'c4', label: 'Answer recorded', den: true, list: true },
  ],
  relations: [
    { total: 'total', parts: ['answered', 'notRecorded'] },
    { total: 'answered', parts: ['yes', 'no'] },
  ],
  shares: [
    { key: 'yes', label: 'Heavy bleeding (PPH)', num: 'yes', den: 'answered' },
    { key: 'answered', label: 'Answer recorded', num: 'answered', den: 'total' },
  ],
  list: { order: 'deliveredDesc', detailLabel: 'Delivery' },
  emptyText: 'No delivery note was confirmed for a delivery in this period.',
  notes: (ctx) => [
    `As the doctor answered it on the delivery note. The note suggests it from the blood loss – ${ml(PPH_ML_VAGINAL)} or more, or ${ml(PPH_ML_CAESAREAN)} or more after a caesarean – and the doctor decides. These amounts are a DRAFT for a doctor to check. Source: ${PPH_SOURCE}.`,
    'The rate is out of the deliveries with an answer. Not recorded: no answer on the note – every note confirmed before this question was added (5 Oct 2026), and any left blank.',
  ],
  compute(ctx) {
    const out = sets('yes', 'no', 'notRecorded', 'answered');
    const details = new Map();
    for (const d of deliveriesInPeriod(ctx)) {
      if (d.pph === 'yes' || d.pph === 'no') {
        out[d.pph].add(d.key);
        out.answered.add(d.key);
      } else out.notRecorded.add(d.key);
      details.set(d.key, deliveryDetail(d));
    }
    return { cells: out, details };
  },
};

// ---------- H3 Births and stillbirths ----------

export const H3 = {
  id: 'H3',
  section: 'deliveries',
  order: 30,
  title: 'Births and stillbirths',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: audiencesOf('H3'),
  needs: ['patients', 'deliveries'],
  total: { key: 'total', code: 'c0', label: 'Babies born', sub: 'on the confirmed delivery notes', list: true },
  cells: [
    { key: 'live', code: 'c1', label: 'Live births', list: true },
    { key: 'still', code: 'c2', label: 'Stillbirths', list: true },
    { key: 'noOutcome', code: 'c3', label: 'Live birth or stillbirth not recorded', unknown: true, list: true },
    { key: 'fresh', code: 'c4', label: 'Fresh', sub: 'died during labour', group: 'still', list: true },
    { key: 'macerated', code: 'c5', label: 'Macerated', sub: 'died before labour', group: 'still', list: true },
    { key: 'stillKindNotRecorded', code: 'c6', label: 'Fresh or macerated not recorded', group: 'still', unknown: true, list: true },
  ],
  relations: [
    { total: 'total', parts: ['live', 'still', 'noOutcome'] },
    { total: 'still', parts: ['fresh', 'macerated', 'stillKindNotRecorded'] },
  ],
  shares: [{ key: 'still', label: 'Stillbirths', num: 'still', den: 'total' }],
  list: { order: 'deliveredDesc', detailLabel: 'Baby' },
  emptyText: 'No babies on the delivery notes confirmed for this period.',
  notes: (ctx) => [
    'Every baby on a confirmed delivery note counts once: twins count as two. The list shows the mother, once for each baby.',
    'Fresh or macerated is recorded on delivery notes from 5 Oct 2026; older notes count as not recorded.',
  ],
  compute(ctx) {
    const out = sets('total', 'live', 'still', 'noOutcome', 'fresh', 'macerated', 'stillKindNotRecorded');
    const details = new Map();
    for (const b of birthsInPeriod(ctx)) {
      out.total.add(b.key);
      details.set(b.key, birthDetail(b));
      if (b.baby.outcome === 'live') out.live.add(b.key);
      else if (b.baby.outcome === 'stillbirth') {
        out.still.add(b.key);
        const kind = b.baby.stillbirthType;
        out[kind === 'fresh' || kind === 'macerated' ? kind : 'stillKindNotRecorded'].add(b.key);
      } else out.noOutcome.add(b.key);
    }
    return { cells: out, details };
  },
};

/** The live births of the period (each card out of them names the same total, H3.live). */
const liveBirths = (ctx) => birthsInPeriod(ctx).filter((b) => b.baby.outcome === 'live');

// ---------- H4 Apgar at 5 minutes ----------

// DRAFT clinical content, to be checked by the owner: a score under 7 at 5 minutes is the usual cut-off for a low
// score (American Academy of Pediatrics and American College of Obstetricians and Gynecologists, "The Apgar
// Score", Committee Opinion 644, 2015: 7 to 10 reassuring, 4 to 6 moderately abnormal, 0 to 3 low). The card's
// note says the same.
export const APGAR_LOW_BELOW = 7;
const apgarOf = (baby) => {
  const v = baby.apgar5 === '' || baby.apgar5 == null ? null : Number(baby.apgar5);
  return Number.isFinite(v) ? v : null;
};

export const H4 = {
  id: 'H4',
  section: 'deliveries',
  order: 40,
  title: 'Apgar score at 5 minutes',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: audiencesOf('H4'),
  needs: ['patients', 'deliveries'],
  uses: ['H3'],
  total: { key: 'total', code: 'c0', label: 'Live births', same: 'H3.live', list: true },
  cells: [
    { key: 'low', code: 'c1', label: `Under ${APGAR_LOW_BELOW} at 5 minutes`, list: true },
    { key: 'normal', code: 'c2', label: `${APGAR_LOW_BELOW} or more at 5 minutes`, list: true },
    { key: 'notRecorded', code: 'c3', label: 'Not recorded', unknown: true, list: true },
    { key: 'recorded', code: 'c4', label: 'Apgar at 5 minutes recorded', den: true, list: true },
  ],
  relations: [
    { total: 'total', parts: ['recorded', 'notRecorded'] },
    { total: 'recorded', parts: ['low', 'normal'] },
  ],
  shares: [
    { key: 'low', label: `Apgar under ${APGAR_LOW_BELOW} at 5 minutes`, num: 'low', den: 'recorded' },
    { key: 'recorded', label: 'Apgar at 5 minutes recorded', num: 'recorded', den: 'total' },
  ],
  list: { order: 'deliveredDesc', detailLabel: 'Baby' },
  emptyText: LIVE_BIRTHS_EMPTY,
  notes: (ctx) => [
    `Out of the live births. Under ${APGAR_LOW_BELOW} at 5 minutes: the usual cut-off for a low score (American Academy of Pediatrics and ACOG, “The Apgar Score”, 2015) – a draft for a doctor to check.`,
  ],
  compute(ctx) {
    const out = sets('low', 'normal', 'notRecorded', 'recorded');
    const details = new Map();
    for (const b of liveBirths(ctx)) {
      const a = apgarOf(b.baby);
      details.set(b.key, birthDetail(b, { apgar5: a }));
      if (a == null) {
        out.notRecorded.add(b.key);
        continue;
      }
      out.recorded.add(b.key);
      out[a < APGAR_LOW_BELOW ? 'low' : 'normal'].add(b.key);
    }
    return { cells: out, details };
  },
};

// ---------- H5 NICU or SNCU admission ----------

export const H5 = {
  id: 'H5',
  section: 'deliveries',
  order: 50,
  title: 'NICU or SNCU admission',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: audiencesOf('H5'),
  needs: ['patients', 'deliveries'],
  uses: ['H3'],
  total: { key: 'total', code: 'c0', label: 'Live births', same: 'H3.live', list: true },
  cells: [
    { key: 'yes', code: 'c1', label: 'Admitted to the NICU or SNCU', list: true },
    { key: 'no', code: 'c2', label: 'Not admitted', list: true },
    { key: 'notRecorded', code: 'c3', label: 'Not recorded', unknown: true, list: true },
    { key: 'answered', code: 'c4', label: 'Answer recorded', den: true, list: true },
  ],
  relations: [
    { total: 'total', parts: ['answered', 'notRecorded'] },
    { total: 'answered', parts: ['yes', 'no'] },
  ],
  shares: [
    { key: 'yes', label: 'Admitted to the NICU or SNCU', num: 'yes', den: 'answered' },
    { key: 'answered', label: 'Answer recorded', num: 'answered', den: 'total' },
  ],
  list: { order: 'deliveredDesc', detailLabel: 'Baby' },
  emptyText: LIVE_BIRTHS_EMPTY,
  notes: (ctx) => [
    'Out of the live births, as recorded for each baby on the delivery note. The rate is out of the babies with an answer.',
    "An admission recorded only on the baby's own record (for example a few days after the birth) is not counted here.",
  ],
  compute(ctx) {
    const out = sets('yes', 'no', 'notRecorded', 'answered');
    const details = new Map();
    for (const b of liveBirths(ctx)) {
      details.set(b.key, birthDetail(b));
      const v = b.baby.nicu;
      if (v === 'yes' || v === 'no') {
        out[v].add(b.key);
        out.answered.add(b.key);
      } else out.notRecorded.add(b.key);
    }
    return { cells: out, details };
  },
};

// ---------- H6 Breastfeeding within one hour ----------

export const H6 = {
  id: 'H6',
  section: 'deliveries',
  order: 60,
  title: 'Breastfeeding within one hour of birth',
  window: 'period',
  form: 'bars',
  scopeable: true,
  audiences: audiencesOf('H6'),
  needs: ['patients', 'deliveries'],
  uses: ['H3'],
  total: { key: 'total', code: 'c0', label: 'Live births', same: 'H3.live', list: true },
  cells: [
    { key: 'yes', code: 'c1', label: 'Breastfed within one hour', list: true },
    { key: 'no', code: 'c2', label: 'Not within one hour', list: true },
    { key: 'na', code: 'c3', label: 'Not applicable', sub: 'for example, the baby went to the NICU or SNCU at once', list: true },
    { key: 'notRecorded', code: 'c4', label: 'Not recorded', unknown: true, list: true },
    { key: 'answered', code: 'c5', label: 'Answer recorded', den: true, list: true },
  ],
  relations: [
    { total: 'total', parts: ['answered', 'notRecorded'] },
    { total: 'answered', parts: ['yes', 'no', 'na'] },
  ],
  shares: [
    { key: 'yes', label: 'Breastfed within one hour, of all live births', num: 'yes', den: 'total' },
    { key: 'answered', label: 'Answer recorded', num: 'answered', den: 'total' },
  ],
  list: { order: 'deliveredDesc', detailLabel: 'Baby' },
  emptyText: LIVE_BIRTHS_EMPTY,
  notes: (ctx) => [
    'Breastfeeding started within one hour of birth (WHO and UNICEF: early initiation of breastfeeding), out of all live births – babies with no answer, or for whom it did not apply, are in the denominator.',
  ],
  compute(ctx) {
    const out = sets('yes', 'no', 'na', 'notRecorded', 'answered');
    const details = new Map();
    for (const b of liveBirths(ctx)) {
      details.set(b.key, birthDetail(b));
      const v = b.baby.breastfedWithinHour;
      const cell = v === 'yes' ? 'yes' : v === 'no' ? 'no' : v === 'not_applicable' ? 'na' : null;
      if (!cell) {
        out.notRecorded.add(b.key);
        continue;
      }
      out[cell].add(b.key);
      out.answered.add(b.key);
    }
    return { cells: out, details };
  },
};

// ---------- H7 Stillbirths and deaths ----------

// A baby's death (on a baby's record): a newborn death in the first 28 days of life (days 0 to 27), early in the
// first 7; every other record: a maternal death during pregnancy, during delivery or within 24 hours after it, or from
// 24 hours up to 42 days after it (patients/deathRules.js – the definitions the monthly report uses too).
const MATERNAL = MATERNAL_DEATH_TIMINGS.map((t) => `m:${t}`);

export const H7 = {
  id: 'H7',
  section: 'deliveries',
  order: 70,
  title: 'Stillbirths and deaths',
  window: 'period',
  form: 'facts',
  scopeable: true,
  audiences: audiencesOf('H7'),
  needs: ['patients', 'deliveries'],
  uses: ['H3'],
  total: null,
  cells: [
    { key: 'still', code: 'c1', label: 'Stillbirths', sub: 'on the confirmed delivery notes', same: 'H3.still', list: true },
    { key: 'newborn', code: 'c2', label: 'Newborn deaths', sub: `in the first ${NEONATAL_DAYS} days of life`, list: true },
    { key: 'early', code: 'c3', label: `In the first ${EARLY_NEONATAL_DAYS} days`, group: 'newborn', list: true },
    { key: 'ageUnknown', code: 'c4', label: "Babies' deaths, age not known", sub: "the baby's time of birth is not on the record", unknown: true, list: true },
    { key: 'maternal', code: 'c5', label: 'Maternal deaths', sub: 'during pregnancy or within 42 days after it', list: true },
    ...MATERNAL_DEATH_TIMINGS.map((t, i) => ({ key: `m:${t}`, code: `c${i + 6}`, label: DEATH_TIMINGS[t], group: 'maternal', list: true })),
  ],
  relations: [
    { sub: 'early', sup: 'newborn' },
    { total: 'maternal', parts: MATERNAL },
  ],
  list: { order: 'diedDesc', detailLabel: 'Date of death' },
  emptyText: 'No stillbirths or deaths were recorded in this period.',
  notes: (ctx) => [
    'Stillbirths: the same number as on Births and stillbirths. Deaths: those a doctor recorded on the records, by the day of death – a death recorded in error and undone is not counted.',
    `Newborn death: in the first ${NEONATAL_DAYS} days of life (days 0 to ${NEONATAL_DAYS - 1}). Maternal death: during pregnancy or within 42 days after it ends, not from an accident or a cause not related to the pregnancy – as the doctor chose when recording it. These definitions are a DRAFT for a doctor to check. Source: ${DEATH_DEFINITIONS_SOURCE}. Deaths of older babies and other deaths are in the monthly report.`,
    ...(ctx.audience === 'doctor' ? ['Deaths on records whose clinical details you may not see are not counted.'] : []),
  ],
  compute(ctx) {
    const out = sets('newborn', 'early', 'ageUnknown', 'maternal', ...MATERNAL);
    const details = new Map();
    for (const { p, id, on, baby } of deathsInPeriod(ctx)) {
      if (baby) {
        const age = Number.isFinite(p.death?.ageDays) ? p.death.ageDays : null;
        if (age == null) out.ageUnknown.add(id);
        else if (age < NEONATAL_DAYS) {
          out.newborn.add(id);
          if (age < EARLY_NEONATAL_DAYS) out.early.add(id);
        } else continue; // 28 days or older: not a newborn death (the monthly report counts it)
      } else {
        const timing = p.death?.timing;
        if (!MATERNAL_DEATH_TIMINGS.includes(timing)) continue; // not a maternal death (the monthly report counts it)
        out.maternal.add(id);
        out[`m:${timing}`].add(id);
      }
      details.set(id, { type: 'death', on: isoDay(on) });
    }
    return { cells: out, details };
  },
};

export const DELIVERY_METRICS = [H1, H2, H3, H4, H5, H6, H7];
