// Words and helpers for the fertility history and the fertility treatment plan (docs/FERTILITY_PLAN.md – DRAFT).
// The lists mirror server/src/fertility/fertilityFields.js (a server test compares the keys).

export const FERTILITY_TYPE_LABELS = { primary: 'Primary (never conceived)', secondary: 'Secondary (conceived before)' };
export const CYCLE_LABELS = { regular: 'Regular (21–35 days)', irregular: 'Irregular', amenorrhoea: 'No periods (amenorrhoea)' };
export const OVULATION_LABELS = { confirmed: 'Confirmed (progesterone or scan)', anovulation: 'Anovulation', not_tested: 'Not tested yet' };
export const TUBAL_LABELS = { patent_both: 'Both tubes patent', one_blocked: 'One tube blocked', both_blocked: 'Both tubes blocked', hydrosalpinx: 'Hydrosalpinx', not_tested: 'Not tested yet' };
export const UTERINE_LABELS = {
  normal: 'Normal cavity',
  septum: 'Septum',
  submucous_fibroid: 'Submucous fibroid',
  polyp: 'Endometrial polyp',
  adhesions: 'Intrauterine adhesions',
  other: 'Other finding',
  not_assessed: 'Not assessed yet',
};
export const ENDOMETRIOSIS_LABELS = { none: 'None found', suspected: 'Suspected', minimal_mild: 'Minimal–mild (stage I–II)', moderate_severe: 'Moderate–severe (stage III–IV)' };
export const SEMEN_LABELS = {
  normal: 'Within the WHO 2021 ranges',
  mild_abnormal: 'Mildly to moderately abnormal',
  severe_abnormal: 'Severely abnormal',
  azoospermia: 'Azoospermia (no sperm)',
  not_tested: 'Not tested yet',
};
export const DIAGNOSIS_LABELS = {
  pcos: 'PCOS',
  hypogonadotropic: 'Hypogonadotropic hypogonadism (low FSH and LH)',
  poi: 'Premature ovarian insufficiency',
  hyperprolactinaemia: 'Hyperprolactinaemia',
  diminished_reserve: 'Low ovarian reserve for her age',
  genital_tb: 'Genital tuberculosis',
  pelvic_infection_or_surgery: 'Past pelvic infection or surgery',
  varicocele: 'Varicocele (partner)',
  sexual_difficulty: 'Vaginal intercourse not possible or very difficult',
};
// The choice fields, in the order the form shows them, with their lists
export const FERTILITY_CHOICES = [
  { key: 'type', label: 'Kind of infertility', labels: FERTILITY_TYPE_LABELS },
  { key: 'cycle', label: 'Menstrual cycles', labels: CYCLE_LABELS },
  { key: 'ovulation', label: 'Ovulation', labels: OVULATION_LABELS },
  { key: 'tubes', label: 'Tubes (HSG, HyCoSy or laparoscopy)', labels: TUBAL_LABELS },
  { key: 'uterus', label: 'Uterine cavity', labels: UTERINE_LABELS },
  { key: 'endometriosis', label: 'Endometriosis', labels: ENDOMETRIOSIS_LABELS },
  { key: 'semen', label: "Partner's semen analysis", labels: SEMEN_LABELS },
];
// The numbers, with the ranges the server accepts (the same as fertilityFields.js)
export const FERTILITY_NUMBER_FIELDS = [
  { key: 'durationMonths', label: 'Months trying to conceive', min: 0, max: 480, integer: true },
  { key: 'partnerAgeYears', label: "Partner's age (years)", min: 15, max: 100, integer: true },
  { key: 'cycleLengthDays', label: 'Cycle length (days)', min: 15, max: 180, integer: true },
  { key: 'amh', label: 'AMH (ng/mL)', min: 0, max: 50, integer: false },
  { key: 'afc', label: 'Antral follicle count', min: 0, max: 99, integer: true },
  { key: 'fsh', label: 'Day 2–3 FSH (IU/L)', min: 0, max: 200, integer: false },
  { key: 'prolactin', label: 'Prolactin (ng/mL)', min: 0, max: 5000, integer: false },
  { key: 'tsh', label: 'TSH (mIU/L)', min: 0, max: 200, integer: false },
  { key: 'oiCycles', label: 'Ovulation induction cycles done', min: 0, max: 50, integer: true },
  { key: 'iuiCycles', label: 'IUI cycles done', min: 0, max: 50, integer: true },
  { key: 'ivfCycles', label: 'IVF or ICSI cycles done', min: 0, max: 20, integer: true },
];
export const FERTILITY_TEXT_FIELDS = [
  { key: 'semenDetail', label: 'Semen analysis detail (optional)', max: 300, hint: 'e.g. count 12 million/mL, progressive motility 20 %, date of the test' },
  { key: 'previousTreatment', label: 'Previous treatment (optional)', max: 500, hint: 'What was tried before, where, and with what result' },
  { key: 'note', label: 'Note (optional)', max: 500, hint: '' },
];
export const FERTILITY_KEYS = [...FERTILITY_CHOICES.map((c) => c.key), 'diagnoses', ...FERTILITY_NUMBER_FIELDS.map((n) => n.key), ...FERTILITY_TEXT_FIELDS.map((t) => t.key)];

const str = (v) => (v == null ? '' : String(v));

/** The form's values for the fertility history, as text ('' = not recorded), from a stored record or empty. */
export function fertilityValues(f) {
  const out = {};
  for (const c of FERTILITY_CHOICES) out[c.key] = f?.[c.key] ?? '';
  out.diagnoses = [...(f?.diagnoses ?? [])];
  for (const n of FERTILITY_NUMBER_FIELDS) out[n.key] = str(f?.[n.key]);
  for (const t of FERTILITY_TEXT_FIELDS) out[t.key] = f?.[t.key] ?? '';
  return out;
}

/** True when nothing is entered in the section. */
export const fertilityEmpty = (v) =>
  !v ||
  (FERTILITY_CHOICES.every((c) => !v[c.key]) && !(v.diagnoses ?? []).length && FERTILITY_NUMBER_FIELDS.every((n) => !String(v[n.key] ?? '').trim()) && FERTILITY_TEXT_FIELDS.every((t) => !String(v[t.key] ?? '').trim()));

/** What is sent to the server (the whole section; the server merges it field by field). */
export function fertilityPayload(v) {
  const out = {};
  for (const c of FERTILITY_CHOICES) out[c.key] = v[c.key] ?? '';
  out.diagnoses = v.diagnoses ?? [];
  for (const n of FERTILITY_NUMBER_FIELDS) out[n.key] = String(v[n.key] ?? '').trim();
  for (const t of FERTILITY_TEXT_FIELDS) out[t.key] = (v[t.key] ?? '').trim();
  return out;
}

/** A number typed in the form that is not a number in its range, by field path (the server's own words). */
export function fertilityNumberErrors(v) {
  const out = {};
  for (const n of FERTILITY_NUMBER_FIELDS) {
    const raw = String(v?.[n.key] ?? '').trim();
    if (!raw) continue;
    const x = Number(raw.replace(',', '.'));
    if (!Number.isFinite(x)) out[`fertility.${n.key}`] = `${n.label} must be a number`;
    else if (n.integer && !Number.isInteger(x)) out[`fertility.${n.key}`] = `${n.label} must be a whole number`;
    else if (x < n.min) out[`fertility.${n.key}`] = `${n.label} is too low`;
    else if (x > n.max) out[`fertility.${n.key}`] = `${n.label} is too high`;
  }
  return out;
}

/** The months trying as words ("1 y 6 m", "8 months"). */
export function durationWords(months) {
  if (months == null || months === '') return '';
  const m = Number(months);
  if (!Number.isFinite(m)) return '';
  if (m < 12) return `${m} month${m === 1 ? '' : 's'}`;
  const y = Math.floor(m / 12);
  const rest = m % 12;
  return rest ? `${y} y ${rest} m` : `${y} year${y === 1 ? '' : 's'}`;
}

/** The rows of the Overview card ("Fertility history"), label and value; a value '' shows as a dash. */
export function fertilityRows(f) {
  if (!f) return [];
  const join = (parts) => parts.filter(Boolean).join(' · ');
  const reserve = join([f.amh != null ? `AMH ${f.amh} ng/mL` : '', f.afc != null ? `AFC ${f.afc}` : '', f.fsh != null ? `FSH ${f.fsh} IU/L` : '']);
  const hormones = join([f.prolactin != null ? `Prolactin ${f.prolactin} ng/mL` : '', f.tsh != null ? `TSH ${f.tsh} mIU/L` : '']);
  const treated = join([f.oiCycles ? `Ovulation induction ${f.oiCycles}` : '', f.iuiCycles ? `IUI ${f.iuiCycles}` : '', f.ivfCycles ? `IVF/ICSI ${f.ivfCycles}` : '']);
  return [
    ['Infertility', join([FERTILITY_TYPE_LABELS[f.type], durationWords(f.durationMonths) ? `trying ${durationWords(f.durationMonths)}` : '', f.partnerAgeYears != null ? `partner ${f.partnerAgeYears} yrs` : ''])],
    ['Cycles and ovulation', join([CYCLE_LABELS[f.cycle], f.cycleLengthDays ? `${f.cycleLengthDays} days` : '', OVULATION_LABELS[f.ovulation]])],
    ['Tubes', TUBAL_LABELS[f.tubes] ?? ''],
    ['Uterus', UTERINE_LABELS[f.uterus] ?? ''],
    ['Endometriosis', ENDOMETRIOSIS_LABELS[f.endometriosis] ?? ''],
    ['Semen', join([SEMEN_LABELS[f.semen], f.semenDetail])],
    ['Diagnoses', (f.diagnoses ?? []).map((d) => DIAGNOSIS_LABELS[d] ?? d).join(', ')],
    ['Ovarian reserve', reserve],
    ...(hormones ? [['Hormones', hormones]] : []),
    ['Previous cycles', treated || (f.previousTreatment ? '' : 'None recorded')],
    ...(f.previousTreatment ? [['Previous treatment', f.previousTreatment]] : []),
    ...(f.note ? [['Note', f.note]] : []),
  ];
}

// ---------- The treatment plan ----------

export const PLAN_STATUS_LOOK = {
  draft: { tone: 'watch', word: 'Draft' },
  active: { tone: 'stable', word: 'Confirmed' },
  completed: { tone: 'neutral', word: 'Completed' },
  stopped: { tone: 'inactive', word: 'Stopped' },
};
export const OUTCOME_LABELS = {
  pregnant: 'Pregnant',
  next_step: 'Moved to the next step',
  no_response: 'No response to treatment',
  patient_choice: "The couple's choice",
  discarded: 'Draft discarded',
  other: 'Other',
};
// Which outcomes end a plan as completed (the rest stop it) – as server/src/models/FertilityPlan.js
export const COMPLETED_KINDS = ['pregnant', 'next_step'];
export const FIT_LABELS = { recommended: 'Suggested for her', consider: 'May also apply', other: 'Other protocols in the library' };
export const FIT_ORDER = ['recommended', 'consider', 'other'];
export const MAX_PROTOCOLS = 5;

/** "Started 12 Oct 2026 · review 9 Nov 2026" */
export function planDatesText(plan, formatDate) {
  const parts = [];
  if (plan.startOn) parts.push(`Started ${formatDate(plan.startOn)}`);
  if (plan.reviewOn) parts.push(`review ${formatDate(plan.reviewOn)}`);
  return parts.join(' · ');
}

/** How the plan ended, in words: "Completed – pregnant (Dr. Riley Demo, 12 Oct 2026)". */
export function outcomeText(plan, formatDate) {
  if (!plan.outcome) return '';
  const who = [plan.outcome.byName, plan.outcome.at ? formatDate(plan.outcome.at) : ''].filter(Boolean).join(', ');
  return `${PLAN_STATUS_LOOK[plan.status].word} – ${OUTCOME_LABELS[plan.outcome.kind] ?? plan.outcome.kind}${plan.outcome.note ? `: ${plan.outcome.note}` : ''}${who ? ` (${who})` : ''}`;
}

/** The lines of a section's text as a list: "• item" lines become items; a line without a bullet is a heading. */
export function sectionLines(text) {
  return String(text ?? '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .map((l) => (l.startsWith('• ') ? { kind: 'item', text: l.slice(2) } : l.startsWith('•') ? { kind: 'item', text: l.slice(1).trim() } : { kind: 'heading', text: l }));
}

/** What the facts card says is still missing, as one sentence. */
export function missingText(facts) {
  const list = facts?.missing ?? [];
  if (!list.length) return '';
  return `Not yet on her record: ${list.map((m) => m.label).join('; ')}.`;
}
