// The Abortion type of care (pregnancy loss): the lists used to record it. Owner decision of 2 Oct 2026:
// only pregnancy loss that was not induced – spontaneous miscarriage, ectopic and molar pregnancy, and the
// work-up for recurrent loss. Nothing else is recorded, and there is no field for the baby's sex (PC-PNDT).
// Owner decision of 3 Oct 2026: a threatened miscarriage is a continuing pregnancy and stays under Antenatal, so it
// is no longer a type of loss here. Records saved before keep it (shown, never changed silently – see RETIRED_*).
//
// The website has an identical copy (client/src/pages/patients/abortionFormat.js); a test checks they match.
// The help texts, the management choices per type and the week limits are DRAFTS (NICE NG126, ESHRE 2022,
// RCOG GTG 38, WHO 2022, MoHFW CAC 2018), checked by the hospital's doctor before use.

export const LOSS_TYPES = [
  { key: 'inevitable', label: 'Inevitable miscarriage', help: 'Bleeding and pain, os open, nothing passed yet.' },
  { key: 'incomplete', label: 'Incomplete miscarriage', help: 'Some tissue passed, some still in the uterus.' },
  {
    key: 'complete',
    label: 'Complete miscarriage',
    help: 'All tissue passed, os closed, uterus empty on scan. If a pregnancy in the uterus was never seen, rule out ectopic with serial beta hCG.',
  },
  {
    key: 'missed',
    label: 'Missed miscarriage',
    help: 'Pregnancy not viable and not expelled. NICE: CRL 7 mm or more with no heartbeat, or mean sac diameter 25 mm or more with no fetal pole; otherwise repeat the scan after at least 7 days.',
  },
  { key: 'septic', label: 'Septic miscarriage', help: 'Any of the above with infection of the uterus. Emergency.' },
  { key: 'ectopic', label: 'Ectopic pregnancy', help: 'Outside the uterine cavity. A ruptured ectopic is an emergency.' },
  { key: 'molar', label: 'Molar pregnancy', help: 'Complete or partial mole; confirmed by histology; beta hCG follow-up until normal.' },
  {
    key: 'recurrent',
    label: 'Recurrent pregnancy loss (work-up)',
    help: 'Two or more losses before 24 weeks (ESHRE 2022). Not pregnant now; a new pregnancy is registered as Antenatal.',
  },
];
export const LOSS_TYPE_KEYS = LOSS_TYPES.map((t) => t.key);
// No longer chosen (3 Oct 2026), only shown on records saved before: a threatened miscarriage is recorded under
// Antenatal. Saving such a record without choosing another type of loss is refused with RETIRED_LOSS_MESSAGE.
export const RETIRED_LOSS_TYPES = [{ key: 'threatened', label: 'Threatened miscarriage (now recorded under Antenatal)' }];
// What a stored record may hold (the database keeps the old value; nothing is migrated).
export const STORED_LOSS_TYPE_KEYS = [...LOSS_TYPE_KEYS, ...RETIRED_LOSS_TYPES.map((t) => t.key)];
// Every stored type of loss with its words, for showing a record.
export const LOSS_LABELS = Object.fromEntries([...LOSS_TYPES, ...RETIRED_LOSS_TYPES].map((t) => [t.key, t.label]));
export const THREATENED_HINT = 'A threatened miscarriage is a continuing pregnancy – register or keep her under Pregnancy (antenatal).';
export const RETIRED_LOSS_MESSAGE =
  'Threatened miscarriage is now recorded under Pregnancy (antenatal). Choose another type of loss, or change the type of care to Pregnancy (antenatal).';

export const MANAGEMENT = {
  none_needed: 'No treatment needed',
  expectant: 'Wait and watch (expectant)',
  medicines: "Medicines (doctor's choice)", // only on records saved before 3 Oct 2026 (threatened miscarriage)
  medical: 'Medical management',
  surgical_evacuation: 'Surgical evacuation (MVA / EVA / D&E)',
  antibiotics_evacuation: 'Antibiotics and evacuation',
  methotrexate: 'Methotrexate',
  laparoscopy: 'Laparoscopy',
  laparotomy: 'Laparotomy',
  suction_evacuation: 'Suction evacuation',
  hysterectomy: 'Hysterectomy',
  workup: 'Work-up',
  referred: 'Referred',
  other: 'Other',
};

// Which management fits which type of loss (the form offers only these; the server refuses the rest).
export const MANAGEMENT_FOR = {
  inevitable: ['expectant', 'medical', 'surgical_evacuation', 'referred', 'other'],
  incomplete: ['expectant', 'medical', 'surgical_evacuation', 'referred', 'other'],
  complete: ['none_needed', 'referred', 'other'],
  missed: ['expectant', 'medical', 'surgical_evacuation', 'referred', 'other'],
  septic: ['antibiotics_evacuation', 'surgical_evacuation', 'referred', 'other'],
  ectopic: ['expectant', 'methotrexate', 'laparoscopy', 'laparotomy', 'referred', 'other'],
  molar: ['suction_evacuation', 'hysterectomy', 'referred', 'other'],
  recurrent: ['workup', 'referred', 'other'],
};
// Operations, counted in the monthly report.
export const SURGICAL_METHODS = ['surgical_evacuation', 'antibiotics_evacuation', 'suction_evacuation', 'laparoscopy', 'laparotomy', 'hysterectomy'];

export const OUTCOMES = {
  complete: 'Treatment complete',
  another_needed: 'Needed another method',
  referred: 'Referred',
  in_progress: 'In progress',
};
// No longer chosen (3 Oct 2026), only shown on records saved before: a continuing pregnancy is recorded under Antenatal.
export const RETIRED_OUTCOMES = { continuing: 'Pregnancy continuing (now recorded under Antenatal)' };
export const OUTCOME_LABELS = { ...OUTCOMES, ...RETIRED_OUTCOMES };
export const RETIRED_OUTCOME_MESSAGE = '"Pregnancy continuing" is no longer used here – a continuing pregnancy is recorded under Pregnancy (antenatal). Choose another outcome.';
export const ECTOPIC_SITES = {
  tube: 'Fallopian tube',
  cervix: 'Cervix',
  scar: 'Caesarean scar',
  interstitial: 'Interstitial (cornual)',
  ovary: 'Ovary',
  abdomen: 'Abdomen',
  not_sure: 'Not sure yet',
};
export const MOLE_KINDS = { complete: 'Complete mole', partial: 'Partial mole', awaiting: 'Waiting for histology' };
export const HISTOLOGY = { not_sent: 'Not sent', sent: 'Sent', received: 'Result received' };
export const ANTI_D = { given: 'Given', not_needed: 'Not needed', not_yet: 'Not given yet', declined: 'Declined' };

// Not pregnant now: no LMP, weeks, anti-D, management date or findings.
export const NOT_PREGNANT_NOW = ['recurrent'];
// Weeks at presentation must be below 28 w 0 d: from 28 weeks it is a still birth, recorded as a delivery.
export const MAX_WEEKS = 27;
// From 20 weeks the form shows a hint (usually recorded as a delivery: intrauterine death or preterm birth).
export const HINT_FROM_WEEKS = 20;

const DAY = 86_400_000;
const midnight = (v) => {
  if (v == null || v === '') return null;
  const t = (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : new Date(v)).getTime();
  return Number.isNaN(t) ? null : t - (((t % DAY) + DAY) % DAY);
};

/** Weeks and days from the LMP to a date, e.g. { weeks: 9, days: 2 } (null without both dates or before the LMP). */
export function gaFrom(lmp, on) {
  const a = midnight(lmp);
  const b = midnight(on);
  if (a == null || b == null || b < a) return null;
  const t = Math.round((b - a) / DAY);
  return { weeks: Math.floor(t / 7), days: t % 7 };
}
/** "9 w 2 d" from the LMP to a date (null when it can't be worked out). */
export function gaText(lmp, on) {
  const ga = gaFrom(lmp, on);
  return ga ? `${ga.weeks} w ${ga.days} d` : null;
}

// ---------- Findings as fields (5 Oct 2026) ----------
// What was found on examination and on the scan, recorded as optional fields on the record instead of in the note.
// Each one is kept with who recorded it and when (patients/lossFindings.js); nothing typed, so nothing about the
// baby can be written here (PC-PNDT). group: where the form shows it. A number is in millimetres, one decimal.
export const YES_NO = { yes: 'Yes', no: 'No' };
// The gestational sac: "earlier" – not on today's scan, but an earlier scan showed the pregnancy in the uterus (so it
// is not a pregnancy of unknown location – NICE NG126).
export const SAC_SEEN = { yes: 'Yes', no: 'No', earlier: 'Not now – an earlier scan showed it' };
export const LOSS_FINDINGS = [
  { key: 'os', label: 'Cervical os', group: 'exam', type: 'choice', choices: { open: 'Open', closed: 'Closed', not_examined: 'Not examined' } },
  { key: 'productsSeen', label: 'Products of conception seen', group: 'exam', type: 'choice', choices: YES_NO },
  { key: 'bleeding', label: 'Bleeding', group: 'exam', type: 'choice', choices: { light: 'Light', moderate: 'Moderate', heavy: 'Heavy' } },
  { key: 'feverDischarge', label: 'Fever with foul-smelling discharge', group: 'exam', type: 'choice', choices: YES_NO },
  { key: 'sacSeen', label: 'Gestational sac seen in the uterus', group: 'scan', type: 'choice', choices: SAC_SEEN },
  { key: 'sacDiameterMm', label: 'Mean sac diameter', group: 'scan', type: 'number', unit: 'mm', min: 1, max: 150 },
  { key: 'crlMm', label: 'Crown–rump length', group: 'scan', type: 'number', unit: 'mm', min: 1, max: 150 },
  { key: 'heartbeat', label: 'Heartbeat seen', group: 'scan', type: 'choice', choices: YES_NO },
  { key: 'adnexalMass', label: 'Adnexal mass', group: 'scan', type: 'choice', choices: YES_NO },
  { key: 'freeFluid', label: 'Free fluid', group: 'scan', type: 'choice', choices: YES_NO },
  { key: 'ruptureSigns', label: 'Signs of rupture', group: 'ectopic', type: 'choice', choices: YES_NO },
];
export const LOSS_FINDING_KEYS = LOSS_FINDINGS.map((f) => f.key);
export const LOSS_FINDING_GROUPS = { exam: 'Examination', scan: 'Scan', ectopic: 'Ectopic or not yet located' };

/**
 * Where the pregnancy is, as far as the record says – DRAFT (NICE NG126: a pregnancy of unknown location is one that
 * the scan shows neither in the uterus nor outside it; a complete miscarriage with no earlier scan that showed the
 * pregnancy in the uterus is treated as one):
 *  'ectopic' – the type of loss is an ectopic pregnancy;
 *  'unknown' – a pregnancy of unknown location: a COMPLETE miscarriage whose scan showed no gestational sac in the
 *              uterus (and no earlier scan did), with no products of conception seen – an ectopic is not ruled out;
 *  null      – in the uterus (any other miscarriage: tissue is still in the uterus, or a scan showed it there), a
 *              molar pregnancy, not scanned yet, or not pregnant now.
 * productsSeen: the "Products of conception seen" finding.
 */
export function lossLocation(lossType, sacSeen, productsSeen = null) {
  if (lossType === 'ectopic') return 'ectopic';
  return lossType === 'complete' && sacSeen === 'no' && productsSeen !== 'yes' ? 'unknown' : null;
}

/**
 * Does this finding fit the type of loss? None for a type that is not a pregnancy now (the recurrent-loss
 * work-up); "signs of rupture" only for an ectopic pregnancy or a pregnancy of unknown location.
 */
export function lossFindingApplies(key, lossType, sacSeen, productsSeen = null) {
  if (!lossType || NOT_PREGNANT_NOW.includes(lossType)) return false;
  return key === 'ruptureSigns' ? lossLocation(lossType, sacSeen, productsSeen) !== null : true;
}

// ---------- Another loss on the same record ----------
// A date seen this many days or more away from the one on the record is ANOTHER loss: the care plan closes the plan
// of the earlier loss and starts a new one, and the findings of the earlier loss stop counting (they are kept as
// earlier entries). Closer than that, the date was only corrected. The same 8 weeks as for a pregnancy's EDD
// (careplans/planRules.js SAME_PREGNANCY_DAYS – a test checks they agree).
export const SAME_LOSS_DAYS = 56;
const dayOf = (v) => {
  const t = midnight(v);
  return t == null ? null : t / DAY;
};
/** True when the date seen moved from `from` to `to` by more than SAME_LOSS_DAYS (both known): another loss. */
export function anotherLoss(from, to) {
  const a = dayOf(from);
  const b = dayOf(to);
  return a != null && b != null && Math.abs(b - a) > SAME_LOSS_DAYS;
}

/** A finding's value in words: "Open", "Yes", "12.5 mm" ('' when not recorded). */
export function lossFindingText(key, value) {
  const f = LOSS_FINDINGS.find((x) => x.key === key);
  if (!f || value == null || value === '') return '';
  return f.type === 'number' ? `${value} ${f.unit}` : (f.choices[value] ?? String(value));
}

// ---------- The recurrent-loss work-up ----------
// From which loss the care plan asks for the recurrent-loss work-up. ONE number, used by the care plan
// (careplans/planEngine.js) and by the words on the screens. DRAFT: ESHRE (2022) defines recurrent pregnancy loss as
// two or more losses and advises the tests after two; this app starts from the third. The doctor decides for each
// woman – change the number here to follow ESHRE exactly.
export const RECURRENT_WORKUP_FROM_LOSSES = 3;
const ORDINALS = { 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' };
/** "third" – the loss from which the work-up is asked for, in words. */
export const recurrentWorkupOrdinal = () => ORDINALS[RECURRENT_WORKUP_FROM_LOSSES] ?? `${RECURRENT_WORKUP_FROM_LOSSES}th`;
