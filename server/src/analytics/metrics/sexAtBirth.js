// Card G2 "Sex at birth" – the ONLY place in Analytics that reads the sex recorded for a baby (PCPNDT Act).
//
// Rules kept here (Analytics specification, section 3.7):
//  - only babies already born: the rows come from load.js's own query of newborn records with a birth time
//    that has passed (data.g2Rows), so a value saved on another type of record, or on a baby whose birth time
//    is in the future, is never counted;
//  - always the whole hospital (for a doctor: every baby whose clinical details they may see), never split by
//    "My patients", mother, doctor, age, risk or anything else;
//  - numbers only: the cells are counts, never lists of patients, and no patient list anywhere carries sex;
//  - the ratio (girls per 1,000 boys) is shown for information only, never with a status colour.

import { inRange } from '../facts.js';
import { zeros } from './util.js';

export const RATIO_NOTE_BELOW = 1000; // babies: under this, the ratio changes a lot by chance
export const FEW_BIRTHS_NOTE = 'With this few births the ratio changes a lot by chance – do not draw conclusions from it.';

export const G2 = {
  id: 'G2',
  section: 'newborn',
  order: 20,
  title: 'Sex at birth',
  window: 'period',
  form: 'tiles',
  scopeable: false,
  wholeHospital: true,
  audiences: ['doctor', 'admin', 'platform'],
  needs: ['patients', 'g2Rows'],
  uses: ['G1'],
  // Its own total: under "My patients" G1 counts fewer babies, but this card always counts the whole hospital.
  total: { key: 'total', code: 'c0', label: 'Babies registered', sub: 'whole hospital' },
  cells: [
    { key: 'girls', code: 'c1', label: 'Girls' },
    { key: 'boys', code: 'c2', label: 'Boys' },
    { key: 'indeterminate', code: 'c3', label: 'Indeterminate' },
    { key: 'notRecorded', code: 'c4', label: 'Not recorded', unknown: true },
  ],
  relations: (ctx) => [
    { total: 'total', parts: ['girls', 'boys', 'indeterminate', 'notRecorded'] },
    // Whole hospital: the same babies as G1.
    ...(ctx.scope === 'mine' ? [] : [{ total: 'G1.total', parts: ['total'] }]),
  ],
  emptyText: 'No babies were registered as born in this period.',
  // Doctors and the super admin see exact numbers: the number of babies is written. Hospital admins: never from
  // the true count (it may be "fewer than 5" or "Not shown"), only from what is sent – see maskedNotes.
  notes: (ctx, res) => {
    const n = res?.cells?.total ?? 0;
    const few = ctx.audience !== 'admin' && n > 0 && n < RATIO_NOTE_BELOW;
    return [
      'Girls per 1,000 boys, for information only. Indeterminate and not recorded are left out of the ratio.',
      'Babies registered in Perinexa, including any born elsewhere.',
      ...(few ? [`Based on ${n} babies. ${FEW_BIRTHS_NOTE}`] : []),
    ];
  },
  // Hospital admins, after masking: the ratio (and its basis, girls + boys) is only sent when girls and boys are
  // both exact, so this line depends only on numbers the admin already has.
  maskedNotes: (json) => (json.extras?.ratio?.value != null && json.extras.ratio.basis < RATIO_NOTE_BELOW ? [FEW_BIRTHS_NOTE] : []),
  compute(ctx) {
    const out = zeros('total', 'girls', 'boys', 'indeterminate', 'notRecorded');
    const { from, to } = ctx.period;
    for (const b of ctx.data.g2Rows ?? []) {
      if (!b.newborn?.birthAt || new Date(b.newborn.birthAt) > ctx.now) continue;
      if (ctx.visible && !ctx.visible.has(String(b._id))) continue; // never narrowed by "My patients"
      if (!inRange(ctx.hday(b.newborn.birthAt), from, to)) continue;
      const v = b.newborn.sex;
      out.total += 1;
      out[v === 'female' ? 'girls' : v === 'male' ? 'boys' : v === 'indeterminate' ? 'indeterminate' : 'notRecorded'] += 1;
    }
    const ratio = out.boys > 0 ? Math.round((out.girls / out.boys) * 1000) : null;
    return { cells: out, extras: { ratio: { value: ratio, basis: out.girls + out.boys } } };
  },
};
