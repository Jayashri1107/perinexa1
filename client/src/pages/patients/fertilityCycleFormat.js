// Words and helpers for the cycle (follicular study) sheet and its printed report (docs/FERTILITY_PLAN.md section 7).
// The keys mirror server/src/fertility/cycleFields.js (a server test compares them). Words with { en, mr, hi } print
// bilingually on the couple's report.
//
// ⚠️ DRAFT – the Marathi and Hindi words in this file must be checked by fluent speakers before they are used with
// patients (listed in docs/TRANSLATIONS_TO_CHECK.md).

export const PROTOCOL_KIND_WORDS = {
  natural: { en: 'Natural cycle (no medicines)', mr: 'नैसर्गिक चक्र (औषधाशिवाय)', hi: 'प्राकृतिक चक्र (बिना दवा)' },
  letrozole: { en: 'Letrozole tablets', mr: 'लेट्रोझोल गोळ्या', hi: 'लेट्रोज़ोल गोलियाँ' },
  clomiphene: { en: 'Clomiphene tablets', mr: 'क्लोमिफेन गोळ्या', hi: 'क्लोमीफीन गोलियाँ' },
  gonadotrophins: { en: 'Hormone injections (gonadotrophins)', mr: 'हार्मोन इंजेक्शन्स', hi: 'हार्मोन इंजेक्शन' },
  letrozole_gonadotrophins: { en: 'Letrozole tablets with hormone injections', mr: 'लेट्रोझोल गोळ्या व हार्मोन इंजेक्शन्स', hi: 'लेट्रोज़ोल गोलियाँ और हार्मोन इंजेक्शन' },
  other: { en: 'Other', mr: 'इतर', hi: 'अन्य' },
};
export const PATTERN_WORDS = {
  trilaminar: { en: 'Three-line (trilaminar)', mr: 'तीन रेषांचे', hi: 'तीन रेखाओं वाली' },
  homogeneous: { en: 'Uniform (homogeneous)', mr: 'एकसारखे', hi: 'एकसमान' },
  other: { en: 'Other', mr: 'इतर', hi: 'अन्य' },
};
export const TIMING_WORDS = {
  intercourse: { en: 'Timed relations', mr: 'ठरवलेल्या दिवशी संबंध', hi: 'तय दिनों पर संबंध' },
  iui: { en: 'Insemination (IUI)', mr: 'गर्भाशयात वीर्य रोपण (IUI)', hi: 'गर्भाशय में वीर्य प्रवेश (IUI)' },
  none: { en: 'None this cycle', mr: 'या चक्रात नाही', hi: 'इस चक्र में नहीं' },
};
export const CANCEL_REASON_LABELS = {
  too_many_follicles: 'More than 2 follicles of 14 mm or more (multiple pregnancy risk)',
  no_response: 'No follicle grew',
  ovulated_early: 'Ovulated before the trigger or the IUI',
  patient_choice: "The couple's choice",
  other: 'Other',
};
export const TEST_RESULT_WORDS = {
  positive: { en: 'Positive', mr: 'पॉझिटिव्ह (गर्भधारणा झाली)', hi: 'पॉज़िटिव (गर्भ ठहरा)' },
  negative: { en: 'Negative', mr: 'निगेटिव्ह', hi: 'निगेटिव' },
  not_done: { en: 'Not done', mr: 'केली नाही', hi: 'नहीं की' },
};
export const CLINICAL_LABELS = { yes: 'Clinical pregnancy on scan', no: 'No pregnancy on scan', pending: 'Scan awaited' };
export const CYCLE_STATUS_LOOK = {
  monitoring: { tone: 'due', word: 'Monitoring' },
  after_trigger: { tone: 'watch', word: 'After trigger' },
  completed: { tone: 'stable', word: 'Completed' },
  cancelled: { tone: 'inactive', word: 'Cancelled' },
};

// The report's headings and standard lines, bilingual
export const REPORT_WORDS = {
  title: { en: 'Follicular study report', mr: 'फॉलिक्युलर स्टडी अहवाल', hi: 'फॉलिक्युलर स्टडी रिपोर्ट' },
  name: { en: 'Name', mr: 'नाव', hi: 'नाम' },
  patientNo: { en: 'Patient no.', mr: 'रुग्ण क्रमांक', hi: 'रोगी क्रमांक' },
  age: { en: 'Age', mr: 'वय', hi: 'आयु' },
  cycle: { en: 'Cycle', mr: 'चक्र क्रमांक', hi: 'चक्र संख्या' },
  day1: { en: 'Day 1 of the cycle (first day of the period)', mr: 'पाळीचा पहिला दिवस', hi: 'माहवारी का पहला दिन' },
  medicines: { en: 'Medicines for this cycle', mr: 'या चक्रातील औषधे', hi: 'इस चक्र की दवाएँ' },
  scans: { en: 'Scans of this cycle', mr: 'या चक्रातील सोनोग्राफी', hi: 'इस चक्र की सोनोग्राफी' },
  date: { en: 'Date', mr: 'दिनांक', hi: 'दिनांक' },
  cycleDay: { en: 'Cycle day', mr: 'चक्राचा दिवस', hi: 'चक्र का दिन' },
  right: { en: 'Right ovary – follicles (mm)', mr: 'उजवे अंडाशय – फॉलिकल (मिमी)', hi: 'दायाँ अंडाशय – फॉलिकल (मिमी)' },
  left: { en: 'Left ovary – follicles (mm)', mr: 'डावे अंडाशय – फॉलिकल (मिमी)', hi: 'बायाँ अंडाशय – फॉलिकल (मिमी)' },
  endometrium: { en: 'Lining of the womb (mm)', mr: 'गर्भाशयाचे अस्तर (मिमी)', hi: 'गर्भाशय की परत (मिमी)' },
  given: { en: 'Medicine given', mr: 'दिलेले औषध', hi: 'दी गई दवा' },
  trigger: { en: 'Trigger injection', mr: 'ट्रिगर इंजेक्शन', hi: 'ट्रिगर इंजेक्शन' },
  timing: { en: 'Relations or insemination', mr: 'संबंध किंवा वीर्य रोपण', hi: 'संबंध या वीर्य प्रवेश' },
  postWash: { en: 'Motile sperm after preparation (million)', mr: 'तयारीनंतर हालचाल करणारे शुक्राणू (दशलक्ष)', hi: 'तैयारी के बाद गतिशील शुक्राणु (मिलियन)' },
  luteal: { en: 'Medicines after ovulation', mr: 'अंडोत्सर्गानंतरची औषधे', hi: 'अंडोत्सर्ग के बाद की दवाएँ' },
  test: { en: 'Pregnancy test', mr: 'गर्भधारणा चाचणी', hi: 'गर्भावस्था जाँच' },
  result: { en: 'Result', mr: 'निकाल', hi: 'परिणाम' },
  cancelled: { en: 'This cycle was stopped', mr: 'हे चक्र थांबवले', hi: 'यह चक्र रोका गया' },
  advice: { en: 'Advice', mr: 'सल्ला', hi: 'सलाह' },
  nextVisit: { en: 'Next visit', mr: 'पुढील भेट', hi: 'अगली भेंट' },
  explain: {
    en: 'The scans follow the growth of the egg follicle and the lining of the womb through this cycle. Please bring this report to every visit.',
    mr: 'या चक्रात अंड्याच्या फॉलिकलची वाढ आणि गर्भाशयाच्या अस्तराची जाडी सोनोग्राफीने तपासली. हा अहवाल प्रत्येक भेटीला सोबत आणा.',
    hi: 'इस चक्र में अंडे के फॉलिकल की बढ़त और गर्भाशय की परत की मोटाई सोनोग्राफी से देखी गई। यह रिपोर्ट हर भेंट पर साथ लाएँ।',
  },
  emergency: { en: 'In an emergency, go to the hospital straight away.', mr: 'आणीबाणीत लगेच रुग्णालयात या.', hi: 'आपातकाल में तुरंत अस्पताल आएँ।' },
  notRecorded: { en: 'Not recorded', mr: 'नोंद नाही', hi: 'दर्ज नहीं' },
};

const str = (v) => (v == null ? '' : String(v));
const toDay = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');

/** "16, 14.5" → the sizes in mm; null when something is not a number. */
export function parseMm(text) {
  const parts = String(text ?? '')
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const out = [];
  for (const t of parts) {
    const n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    out.push(Math.round(n * 10) / 10);
  }
  return out;
}
/** [16, 14.5] → "16, 14.5" (the largest first). */
export const mmText = (sizes) => [...(sizes ?? [])].sort((a, b) => b - a).map((n) => String(n)).join(', ');

/** The cycle day of a date, counted from day 1 (day 1 = 1). */
/** The date (YYYY-MM-DD) of cycle day n, counted from day 1 (fertility idea F7: the next scan booked by cycle day). */
export function dateOfCycleDay(day1, n) {
  if (!day1 || !Number.isInteger(n) || n < 1 || n > 60) return '';
  const d = new Date(`${toDay(day1)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n - 1);
  return d.toISOString().slice(0, 10);
}

export function cycleDay(day1, on) {
  if (!day1 || !on) return null;
  const a = new Date(`${toDay(day1)}T00:00:00Z`);
  const b = new Date(`${toDay(on)}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

/** The form's values for a sheet, as text, from a stored cycle. */
export function cycleValues(c) {
  return {
    day1: toDay(c.day1),
    protocol: { kind: c.protocol?.kind ?? '', drug: c.protocol?.drug ?? '', dose: c.protocol?.dose ?? '', days: c.protocol?.days ?? '' },
    entries: (c.entries ?? []).map((e) => ({
      on: toDay(e.on),
      right: mmText(e.right),
      left: mmText(e.left),
      endometriumMm: str(e.endometriumMm),
      pattern: e.pattern ?? '',
      e2: str(e.e2),
      lh: str(e.lh),
      p4: str(e.p4),
      given: e.given ?? '',
      note: e.note ?? '',
      byName: e.byName ?? null,
      at: e.at ?? null,
    })),
    trigger: { drug: c.trigger?.drug ?? '', dose: c.trigger?.dose ?? '', at: toDay(c.trigger?.at) },
    timing: { kind: c.timing?.kind ?? '', on: toDay(c.timing?.on), postWashMillions: str(c.timing?.postWashMillions), note: c.timing?.note ?? '' },
    luteal: c.luteal ?? '',
    cancelled: c.cancelled ? { reason: c.cancelled.reason, note: c.cancelled.note ?? '' } : null,
    outcome: {
      test: c.outcome?.test ?? '',
      testOn: toDay(c.outcome?.testOn),
      betaHcg: str(c.outcome?.betaHcg),
      betaHcgOn: toDay(c.outcome?.betaHcgOn),
      clinical: c.outcome?.clinical ?? '',
      scanOn: toDay(c.outcome?.scanOn),
      note: c.outcome?.note ?? '',
    },
  };
}

/** A new scan day for the form, dated today. */
export const blankEntry = (on = '') => ({ on, right: '', left: '', endometriumMm: '', pattern: '', e2: '', lh: '', p4: '', given: '', note: '', byName: null, at: null });

const numOrNull = (t) => (String(t ?? '').trim() === '' ? null : Number(String(t).replace(',', '.')));

/** What the website checks before saving: the follicle sizes and numbers, by field path (the server checks too). */
export function cycleErrors(v) {
  const out = {};
  if (!v.day1) out.day1 = 'Give day 1 of the cycle (the first day of the period).';
  v.entries.forEach((e, i) => {
    if (!e.on) out[`entries.${i}.on`] = 'Give the date of the scan.';
    else if (v.day1 && cycleDay(v.day1, e.on) < 1) out[`entries.${i}.on`] = 'A scan day cannot be before day 1.';
    if (parseMm(e.right) === null) out[`entries.${i}.right`] = 'Sizes in mm, separated by commas – for example 16, 14.5';
    if (parseMm(e.left) === null) out[`entries.${i}.left`] = 'Sizes in mm, separated by commas – for example 16, 14.5';
    for (const k of ['endometriumMm', 'e2', 'lh', 'p4']) if (String(e[k]).trim() && !Number.isFinite(numOrNull(e[k]))) out[`entries.${i}.${k}`] = 'Must be a number';
  });
  if (String(v.timing.postWashMillions).trim() && !Number.isFinite(numOrNull(v.timing.postWashMillions))) out['timing.postWashMillions'] = 'Must be a number';
  if (v.timing.kind === 'iui' && !v.timing.on) out['timing.on'] = 'Give the IUI date.';
  if (String(v.outcome.betaHcg).trim() && !Number.isFinite(numOrNull(v.outcome.betaHcg))) out['outcome.betaHcg'] = 'Must be a number';
  if (v.outcome.test && v.outcome.test !== 'not_done' && !v.outcome.testOn) out['outcome.testOn'] = 'Give the date of the pregnancy test.';
  return out;
}

/** What is sent to the server (PUT), from the form's values. */
export function cyclePayload(v, rev) {
  return {
    rev,
    day1: v.day1,
    protocol: v.protocol,
    entries: v.entries.map((e) => ({
      on: e.on,
      right: parseMm(e.right) ?? [],
      left: parseMm(e.left) ?? [],
      endometriumMm: numOrNull(e.endometriumMm),
      pattern: e.pattern,
      e2: numOrNull(e.e2),
      lh: numOrNull(e.lh),
      p4: numOrNull(e.p4),
      given: e.given.trim(),
      note: e.note.trim(),
    })),
    trigger: { drug: v.trigger.drug.trim(), dose: v.trigger.dose.trim(), at: v.trigger.at || null },
    timing: { kind: v.timing.kind, on: v.timing.on || null, postWashMillions: numOrNull(v.timing.postWashMillions), note: v.timing.note.trim() },
    luteal: v.luteal.trim(),
    cancelled: v.cancelled ? { reason: v.cancelled.reason, note: (v.cancelled.note ?? '').trim() } : null,
    outcome: {
      test: v.outcome.test,
      testOn: v.outcome.testOn || null,
      betaHcg: numOrNull(v.outcome.betaHcg),
      betaHcgOn: v.outcome.betaHcgOn || null,
      clinical: v.outcome.clinical,
      scanOn: v.outcome.scanOn || null,
      note: v.outcome.note.trim(),
    },
  };
}

/** "Letrozole 2.5 mg, day 3 to 7" – the medicines of the cycle in one line (English). */
export function protocolText(p) {
  if (!p) return '';
  const kind = PROTOCOL_KIND_WORDS[p.kind]?.en ?? '';
  const detail = [p.drug, p.dose, p.days].filter(Boolean).join(' ');
  return detail ? (p.kind && p.kind !== 'other' && !detail.toLowerCase().includes((p.drug || '').toLowerCase()) ? `${kind}: ${detail}` : detail) : kind;
}

/** The lead follicle of the latest scan: "Lead follicle 16 mm (right), day 12". */
export function leadFollicleText(c) {
  const last = (c.entries ?? []).at(-1);
  if (!last) return '';
  const r = Math.max(0, ...(last.right ?? []));
  const l = Math.max(0, ...(last.left ?? []));
  if (!r && !l) return '';
  const side = r >= l ? 'right' : 'left';
  return `Lead follicle ${Math.max(r, l)} mm (${side}), day ${last.day}`;
}

/** One line for the list of cycles: "Cycle 2 · Letrozole tablets · 3 scans · IUI day 15 · Negative". */
export function cycleSummary(c, formatDate) {
  const parts = [`Cycle ${c.number}`, PROTOCOL_KIND_WORDS[c.protocol?.kind]?.en ?? '', `${c.entries.length} scan${c.entries.length === 1 ? '' : 's'}`];
  if (c.timing?.kind === 'iui' && c.timing.on) parts.push(`IUI ${formatDate(c.timing.on)}`);
  else if (c.timing?.kind === 'intercourse' && c.timing.on) parts.push(`timed relations ${formatDate(c.timing.on)}`);
  else if (c.trigger?.at) parts.push(`trigger ${formatDate(c.trigger.at)}`);
  if (c.status === 'cancelled') parts.push(`stopped – ${CANCEL_REASON_LABELS[c.cancelled?.reason] ?? ''}`.trim());
  else if (c.outcome?.test) parts.push(`test ${TEST_RESULT_WORDS[c.outcome.test]?.en.toLowerCase()}`);
  if (c.outcome?.clinical === 'yes') parts.push('clinical pregnancy');
  return parts.filter(Boolean).join(' · ');
}
