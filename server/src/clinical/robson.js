// The Robson ten-group classification (PX-REQ-00: PX-OBG-13 part, PX-OBG-28). A standard definition, no manual page
// needed (owner's go-ahead 5 Nov 2026). Source: WHO Robson Classification: Implementation Manual (2017), table 1.
// Worked out from the delivery note – never typed: parity, a previous caesarean, the number of babies, the
// presentation, the weeks of pregnancy and the onset of labour. The website keeps a copy of the group words
// (client/src/pages/inpatient/robson.js); a test keeps both the same.

export const ROBSON_SOURCE = 'WHO Robson Classification: Implementation Manual (2017), table 1';
export const PARITY = ['nullipara', 'multipara'];
export const PRESENTATIONS = ['cephalic', 'breech', 'transverse_oblique'];

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

/** What the classification still needs from the note: [] when the group can be worked out. PURE. */
export function robsonMissing(c = {}) {
  const out = [];
  const babies = Array.isArray(c.babies) ? c.babies.length : 0;
  if (!babies) out.push('babies');
  if (!c.parity) out.push('parity');
  if (c.parity === 'multipara' && !c.previousCaesarean) out.push('previousCaesarean');
  if (babies === 1) {
    if (!c.presentation) out.push('presentation');
    if (c.presentation === 'cephalic') {
      if (c.gestationWeeks == null || c.gestationWeeks === '') out.push('gestationWeeks');
      else if (Number(c.gestationWeeks) >= 37 && !(c.parity === 'multipara' && c.previousCaesarean === 'yes') && !c.labourOnset) out.push('labourOnset');
    }
  }
  return out;
}

/** The Robson group (1–10) of a delivery note's content, or null while something it needs is missing. PURE. */
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

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

/**
 * The monthly ten-group table from delivery notes' content: per group the women, the caesareans, the group's size
 * (% of all women), its caesarean rate, and its absolute and relative contribution to the overall rate. Notes that
 * cannot be classified are counted on their own row. PURE.
 */
export function robsonTable(contents = []) {
  const rows = Object.keys(ROBSON_GROUPS).map((g) => ({ group: Number(g), women: 0, caesareans: 0 }));
  const unclassified = { women: 0, caesareans: 0 };
  for (const c of contents) {
    const g = robsonGroup(c);
    const row = g ? rows[g - 1] : unclassified;
    row.women += 1;
    if (c.mode === 'lscs') row.caesareans += 1;
  }
  const women = contents.length;
  const caesareans = contents.filter((c) => c.mode === 'lscs').length;
  return {
    women,
    caesareans,
    caesareanRate: pct(caesareans, women),
    rows: rows.map((r) => ({
      ...r,
      groupSize: pct(r.women, women),
      caesareanRate: pct(r.caesareans, r.women),
      absoluteContribution: pct(r.caesareans, women),
      relativeContribution: pct(r.caesareans, caesareans),
    })),
    unclassified,
    source: ROBSON_SOURCE,
  };
}
