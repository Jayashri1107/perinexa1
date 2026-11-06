// The Robson group and the caesarean's decision-to-delivery interval, worked out on the delivery note while it is
// written (Clinical Requirements Group A, items 1 and 2). The same rules as server/src/clinical/robson.js and
// server/src/clinical/caesarean.js – a server test checks that both copies give the same answers.
// DRAFT until the Lead Obstetrician confirms them. Sources: WHO Robson Classification: Implementation Manual (2017);
// NICE guideline NG192, Caesarean birth (2021).

export const ROBSON_SOURCE = 'WHO Robson Classification: Implementation Manual (2017), table 1';
export const CS_SOURCE = 'NICE guideline NG192, Caesarean birth (2021), recommendations 1.5.2–1.5.7';
export const PARITY_LABELS = { nullipara: 'Nulliparous (no earlier birth)', multipara: 'Multiparous (has given birth before)' };
export const PRESENTATION_LABELS = { cephalic: 'Cephalic', breech: 'Breech', transverse_oblique: 'Transverse or oblique lie' };
export const YES_NO_LABELS = { yes: 'Yes', no: 'No' };
export const CS_CATEGORY_LABELS = {
  1: 'Category 1 – immediate threat to the life of the woman or the baby',
  2: 'Category 2 – compromise, not immediately life-threatening',
  3: 'Category 3 – no compromise, needs early delivery',
  4: 'Category 4 – at a time to suit the woman and the team',
};
export const CS_TARGET_MINUTES = { 1: 30, 2: 75 };

export const ROBSON_GROUPS = {
  1: 'Nulliparous, single cephalic, 37 weeks or more, spontaneous labour',
  2: 'Nulliparous, single cephalic, 37 weeks or more, induced or caesarean before labour',
  3: 'Multiparous without a previous caesarean, single cephalic, 37 weeks or more, spontaneous labour',
  4: 'Multiparous without a previous caesarean, single cephalic, 37 weeks or more, induced or caesarean before labour',
  5: 'All multiparous with at least one previous caesarean, single cephalic, 37 weeks or more',
  6: 'All nulliparous breech',
  7: 'All multiparous breech, including previous caesarean',
  8: 'All multiple pregnancies, including previous caesarean',
  9: 'All single transverse or oblique lie, including previous caesarean',
  10: 'All single cephalic under 37 weeks, including previous caesarean',
};
const blank = (v) => v == null || String(v).trim() === '';

/** What the classification still needs: [] when the group can be worked out. */
export function robsonMissing(c = {}) {
  const out = [];
  const babies = Array.isArray(c.babies) ? c.babies.length : 0;
  if (!babies) out.push('babies');
  if (!c.parity) out.push('parity');
  if (c.parity === 'multipara' && !c.previousCaesarean) out.push('previousCaesarean');
  if (babies === 1) {
    if (!c.presentation) out.push('presentation');
    if (c.presentation === 'cephalic') {
      if (blank(c.gestationWeeks)) out.push('gestationWeeks');
      else if (Number(c.gestationWeeks) >= 37 && !(c.parity === 'multipara' && c.previousCaesarean === 'yes') && !c.labourOnset) out.push('labourOnset');
    }
  }
  return out;
}

/** The Robson group (1–10), or null while something it needs is missing. */
export function robsonGroup(c = {}) {
  if (robsonMissing(c).length) return null;
  if (c.babies.length > 1) return 8;
  if (c.presentation === 'transverse_oblique') return 9;
  if (c.presentation === 'breech') return c.parity === 'nullipara' ? 6 : 7;
  if (Number(c.gestationWeeks) < 37) return 10;
  const spontaneous = c.labourOnset === 'spontaneous';
  if (c.parity === 'nullipara') return spontaneous ? 1 : 2;
  if (c.previousCaesarean === 'yes') return 5;
  return spontaneous ? 3 : 4;
}

/** Whole minutes from the decision to the delivery (ISO times), or null. */
export function decisionToDeliveryMinutes(c = {}) {
  if (!c.decisionAt || !c.deliveredAt) return null;
  const ms = new Date(c.deliveredAt).getTime() - new Date(c.decisionAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 60000);
}

/** Category 1 delivered more than 30 minutes after the decision: shown in red. */
export function category1Late(c = {}) {
  const m = decisionToDeliveryMinutes(c);
  return c.mode === 'lscs' && String(c.csCategory) === '1' && m != null && m > CS_TARGET_MINUTES[1];
}

const MISSING_WORDS = { babies: 'the baby', parity: 'parity', previousCaesarean: 'a previous caesarean', presentation: 'the presentation', gestationWeeks: 'the weeks of pregnancy', labourOnset: 'the onset of labour' };

/** "Robson group 1 – …" or what is still needed. */
export function robsonWords(c) {
  const g = robsonGroup(c);
  if (g) return `Robson group ${g} – ${ROBSON_GROUPS[g]}`;
  return `Robson group: needs ${robsonMissing(c).map((k) => MISSING_WORDS[k]).join(', ')}`;
}

/** The interval in words, with whether it is over the category's target (null when it can't be worked out yet). */
export function intervalWords(c) {
  const m = decisionToDeliveryMinutes(c);
  if (m == null) return null;
  const target = CS_TARGET_MINUTES[c.csCategory];
  const over = target != null && m > target;
  return { minutes: m, red: category1Late(c), over, text: `Decision to delivery: ${m} minutes${target ? ` (target ${target} minutes or less for category ${c.csCategory})` : ''}` };
}
