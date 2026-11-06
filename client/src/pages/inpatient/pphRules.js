// The PPH chart's rules on the website (Clinical Requirements Group B, item 15): the same steps, bands and shock index
// as server/src/clinical/pph.js – a server test checks both copies. DRAFT until OBG-F-07 replaces it.

export const PPH_SOURCE =
  'RCOG Green-top Guideline 52, Prevention and management of postpartum haemorrhage (2016); WHO recommendations for the prevention and treatment of PPH (2012) and on tranexamic acid (2017); shock index – Nathan HL et al., BJOG 2015';

// The cause – the "four Ts"
export const PPH_CAUSES = { tone: 'Tone (uterine atony)', trauma: 'Trauma (tear, rupture, haematoma)', tissue: 'Tissue (retained placenta or membranes)', thrombin: 'Thrombin (clotting problem)' };

// The steps, in the order they are usually taken. medicine: a dose and route are typed when it is ticked.
export const PPH_STEPS = [
  { key: 'help', label: 'Called for help (senior obstetrician, anaesthetist)' },
  { key: 'iv', label: 'Two large-bore IV lines' },
  { key: 'bloods', label: 'Bloods sent (Hb, group and cross-match, clotting)' },
  { key: 'massage', label: 'Uterine massage' },
  { key: 'oxytocin', label: 'Oxytocin', medicine: true },
  { key: 'ergometrine', label: 'Ergometrine', medicine: true },
  { key: 'carboprost', label: 'Carboprost', medicine: true },
  { key: 'misoprostol', label: 'Misoprostol', medicine: true },
  { key: 'tranexamic', label: 'Tranexamic acid (within 3 hours of birth)', medicine: true },
  { key: 'fluids', label: 'IV fluids (warmed crystalloid)' },
  { key: 'catheter', label: 'Bladder catheter' },
  { key: 'examined', label: 'Examined for trauma and retained tissue' },
  { key: 'bimanual', label: 'Bimanual compression' },
  { key: 'balloon', label: 'Uterine balloon tamponade' },
  { key: 'transfusion', label: 'Blood or blood products transfused' },
  { key: 'theatre', label: 'Moved to theatre' },
  { key: 'other', label: 'Other step' },
];
export const PPH_OUTCOMES = { controlled: 'Bleeding controlled', theatre: 'Surgery needed', referred: 'Referred to a higher centre', other: 'Other' };
export const LOSS_METHODS = { measured: 'Measured (weighed or collected)', estimated: 'Estimated' };

// Blood loss (RCOG 52): minor 500–1000 mL; major over 1000 mL – moderate 1001–2000, severe over 2000.
/** The blood loss so far in words and band. PURE. */
export function lossBand(ml) {
  if (ml == null) return null;
  if (ml > 2000) return { band: 'red', words: 'Major PPH – severe (over 2000 mL)' };
  if (ml > 1000) return { band: 'red', words: 'Major PPH – moderate (1001 to 2000 mL)' };
  if (ml >= 500) return { band: 'yellow', words: 'Minor PPH (500 to 1000 mL)' };
  return { band: 'normal', words: 'Under 500 mL' };
}

// Shock index = heart rate ÷ systolic BP. 0.9 or more: watch closely; 1.4 or more: urgent (Nathan 2015).
export const SHOCK_WATCH = 0.9;
export const SHOCK_URGENT = 1.4;
/** The shock index (two decimals) and its band, or null without both readings. PURE. */
export function shockIndex(hr, sbp) {
  if (hr == null || sbp == null || !Number(sbp)) return null;
  const value = Math.round((Number(hr) / Number(sbp)) * 100) / 100;
  return { value, band: value >= SHOCK_URGENT ? 'red' : value >= SHOCK_WATCH ? 'yellow' : 'normal' };
}

/** The blood loss so far: the sum of the amounts recorded (not counting ones entered in error). PURE. */
export const totalLoss = (losses = []) => losses.filter((l) => !l.cancelled).reduce((a, l) => a + Number(l.ml || 0), 0);
