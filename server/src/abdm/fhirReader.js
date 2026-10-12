// ABDM milestone M3 – reading a FHIR document that another hospital sent for a patient (the hospital as a Health
// Information User). PURE (no database). It turns a FHIR R4 document Bundle (the NRCeS profiles ABDM uses, or any
// FHIR document) into what the doctor reads: the type of document, its date, the hospital and the doctor who wrote
// it, and plain lines per section – titles, medicines with their dose, results with their units and Low/High marks,
// diagnoses, procedures, vaccinations, advice and notes.
//
// Safety rules kept here:
//  - Nothing is kept as HTML: a narrative (XHTML) becomes plain text, so nothing another system wrote can run on a
//    Perinexa screen. Long documents are cut at fixed limits (and say so).
//  - PC-PNDT: every line of text (and the titles) goes through the fetal-sex guard (utils/pcpndt.js) unless the
//    patient is a baby. A SENTENCE that mentions a baby's sex is withheld and counted, so the screen can say that
//    something was withheld and why. The guard is a word list and errs on the side of withholding.
//  - Attached files: only a PDF, JPEG or PNG carried inside the document (never a link to fetch), at most 10 MB, and
//    only when its first bytes match its type (the same check as utils/storedFiles.js). Everything else is left out
//    and counted. Perinexa cannot look inside a file for words about a baby's sex – the screen says so.
//  - Names of people and hospitals are shown as written (they are not about the pregnancy).
//  - Statuses are said, never dropped: a medicine stopped or cancelled, a diagnosis ruled out or resolved, a result
//    that is preliminary – and anything "entered in error" is marked "Entered in error – not valid". Only known FHIR
//    codes become words (the words are Perinexa's own).
//  - Doses: a medicine's dose in words from its text, or from its structured parts (dose, how often, for how long,
//    when needed, route); what cannot be read is said to be in the other hospital's document, never left out silently.

import { dateWords, toHospitalDate } from '../careplans/dates.js';
import { mentionsFetalSex } from '../utils/pcpndt.js';

/** ABDM's health information types a hospital can ask for, in words. */
export const FETCH_TYPE_WORDS = {
  OPConsultation: 'Consultation',
  Prescription: 'Prescription',
  DiagnosticReport: 'Lab or scan report',
  DischargeSummary: 'Discharge summary',
  ImmunizationRecord: 'Vaccination record',
  HealthDocumentRecord: 'Other health document',
  WellnessRecord: 'Wellness record',
};
export const FETCH_HI_TYPES = Object.keys(FETCH_TYPE_WORDS);

/** The short safe list of attached files that may be downloaded. */
export const SAFE_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const LIMITS = Object.freeze({ sections: 60, linesPerSection: 300, lineChars: 3000, lines: 3000, files: 20, titleChars: 200 });

// The NRCeS document types: SNOMED CT code of Composition.type, and the profile name → ABDM's HI type
const TYPE_BY_CODE = {
  371530004: 'OPConsultation',
  440545006: 'Prescription',
  721981007: 'DiagnosticReport',
  373942005: 'DischargeSummary',
  41000179103: 'ImmunizationRecord',
  419891008: 'HealthDocumentRecord',
};
const TYPE_BY_PROFILE = {
  OPConsultRecord: 'OPConsultation',
  PrescriptionRecord: 'Prescription',
  DiagnosticReportRecord: 'DiagnosticReport',
  DischargeSummaryRecord: 'DischargeSummary',
  ImmunizationRecord: 'ImmunizationRecord',
  HealthDocumentRecord: 'HealthDocumentRecord',
  WellnessRecord: 'WellnessRecord',
};

// The first bytes of each safe file type (as utils/storedFiles.js checks an upload)
const MAGIC = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};
/** Do these bytes really look like a file of this (safe) type? */
export const looksLike = (contentType, data) => Boolean(MAGIC[contentType]?.(data));

/** A document that cannot be read (not JSON, not a FHIR Bundle). */
export class NotReadable extends Error {}

// ---------- Text ----------

const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const clip = (s, n = LIMITS.lineChars) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** One line of plain text: no control characters, single spaces. */
export const plain = (v) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', deg: '°', micro: 'µ', middot: '·', bull: '•', times: '×', plusmn: '±', le: '≤', ge: '≥' };
const decode = (s) =>
  s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Removes <script> and <style> blocks in one pass (no pattern that could take long on a hostile document). */
function withoutBlocks(html) {
  let out = '';
  let at = 0;
  const lower = html.toLowerCase();
  for (;;) {
    const s = lower.indexOf('<script', at);
    const t = lower.indexOf('<style', at);
    const start = s === -1 ? t : t === -1 ? s : Math.min(s, t);
    if (start === -1) return out + html.slice(at);
    const tag = start === s ? '</script' : '</style';
    const end = lower.indexOf(tag, start);
    out += `${html.slice(at, start)} `;
    if (end === -1) return out;
    const close = lower.indexOf('>', end);
    at = close === -1 ? html.length : close + 1;
  }
}

/** A FHIR narrative (XHTML) as plain lines – tags removed, never kept as HTML. */
export function narrativeLines(div) {
  if (typeof div !== 'string' || !div) return [];
  const text = withoutBlocks(div.slice(0, 200_000))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol|dt|dd)\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' · ')
    .replace(/<[^>]*>/g, ' ');
  return decode(text)
    .split('\n')
    .map((l) => plain(l).replace(/^(· )+|( ·)+$/g, '').trim())
    .filter(Boolean);
}

/** The words of a CodeableConcept (its text, else a coding's display, else a code). */
export function conceptText(cc) {
  if (!cc || typeof cc !== 'object') return '';
  if (Array.isArray(cc)) return cc.map(conceptText).filter(Boolean).join(', ');
  const codings = list(cc.coding);
  return plain(cc.text) || plain(codings.find((c) => c?.display)?.display) || plain(codings.find((c) => c?.code)?.code);
}

/** A date, a date and time, a month or a year, in words ('' when it is not a date). */
export function dayText(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dateWords(new Date(`${s}T00:00:00Z`));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (/^\d{4}-\d{2}$/.test(s)) return `${months[Number(s.slice(5)) - 1] ?? ''} ${s.slice(0, 4)}`.trim();
  if (/^\d{4}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : dateWords(toHospitalDate(d));
}
/** A FHIR date or dateTime as a Date (null when it is not one). */
export function dateOf(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const periodText = (p) => {
  if (!p) return '';
  const a = dayText(p.start);
  const b = dayText(p.end);
  return a && b ? (a === b ? a : `${a} to ${b}`) : a ? `from ${a}` : b ? `until ${b}` : '';
};

const quantityText = (q) => {
  if (!q || q.value == null) return '';
  const unit = plain(q.unit) || plain(q.code);
  return `${plain(q.comparator)}${plain(q.value)}${unit ? ` ${unit}` : ''}`;
};
const rangeText = (r) => (r ? [quantityText(r.low), quantityText(r.high)].filter(Boolean).join(' – ') : '');

/** The value of an Observation (or one of its components) in words. */
function valueText(o) {
  if (o.valueQuantity) return quantityText(o.valueQuantity);
  if (o.valueCodeableConcept) return conceptText(o.valueCodeableConcept);
  if (o.valueString != null) return plain(o.valueString);
  if (o.valueBoolean != null) return o.valueBoolean ? 'Yes' : 'No';
  if (o.valueInteger != null) return plain(o.valueInteger);
  if (o.valueRange) return rangeText(o.valueRange);
  if (o.valueRatio) return [quantityText(o.valueRatio.numerator), quantityText(o.valueRatio.denominator)].filter(Boolean).join(' / ');
  if (o.valueDateTime) return dayText(o.valueDateTime);
  if (o.valuePeriod) return periodText(o.valuePeriod);
  if (o.valueTime) return plain(o.valueTime);
  if (o.dataAbsentReason) return `not recorded (${conceptText(o.dataAbsentReason)})`;
  return '';
}

const notesOf = (r) => list(r.note).map((n) => plain(n?.text)).filter(Boolean);

// ---------- Resources as lines ----------

/** Who a reference points to, by name (a Practitioner, an Organization …) – '' when it is not in the document. */
function nameOf(res) {
  if (!res) return '';
  if (typeof res.name === 'string') return plain(res.name);
  const n = list(res.name)[0];
  if (!n) return '';
  return plain(n.text) || plain([...list(n.prefix), ...list(n.given), n.family].filter(Boolean).join(' '));
}

/** An Observation as one line: "Haemoglobin: 9.5 g/dL (Low) – reference 11–16 g/dL". */
function observationLine(o) {
  const name = conceptText(o.code) || 'Result';
  const comps = list(o.component)
    .map((c) => {
      const v = valueText(c);
      return v ? `${conceptText(c.code) || 'Part'} ${v}` : '';
    })
    .filter(Boolean);
  const value = valueText(o) || comps.join(', ');
  const flag = conceptText(list(o.interpretation)[0]);
  const range = list(o.referenceRange)
    .map((r) => plain(r?.text) || rangeText(r))
    .filter(Boolean)[0];
  const when = dayText(o.effectiveDateTime ?? o.effectivePeriod?.start);
  return `${name}${value ? `: ${value}` : ''}${flag && !/^normal$/i.test(flag) ? ` (${flag})` : ''}${range ? ` – reference ${range}` : ''}${when ? ` – ${when}` : ''}`;
}

// ---------- Statuses ----------

/** The code of a status: a code string, or a CodeableConcept's first coded value ('' when none). */
const codeOf = (v) => (typeof v === 'string' ? v : plain(list(v?.coding).find((c) => c?.code)?.code)).toLowerCase();
export const ENTERED_IN_ERROR = 'Entered in error – not valid';

// Each resource's status (FHIR R4 value sets) → Perinexa's words; final, active and the like say nothing
const STATUS_WORDS = {
  medicine: { stopped: 'stopped', cancelled: 'cancelled', 'on-hold': 'on hold', draft: 'draft – not yet given', completed: 'completed', intended: 'intended', 'not-taken': 'not taken', 'in-progress': 'being given', 'not-done': 'not given', declined: 'declined' },
  result: { registered: 'not yet resulted', preliminary: 'preliminary result', partial: 'partial result', amended: 'amended', corrected: 'corrected', cancelled: 'cancelled', appended: 'amended' },
  report: { registered: 'not yet reported', preliminary: 'preliminary report', partial: 'partial report', amended: 'amended', corrected: 'corrected', cancelled: 'cancelled', appended: 'amended' },
  procedure: { preparation: 'planned', 'in-progress': 'in progress', 'not-done': 'not done', 'on-hold': 'on hold', stopped: 'stopped' },
  clinical: { inactive: 'inactive', remission: 'in remission', resolved: 'resolved', recurrence: 'recurrence', relapse: 'relapse' },
  verification: { unconfirmed: 'unconfirmed', provisional: 'provisional', differential: 'possible (differential)', refuted: 'ruled out' },
  request: { draft: 'draft', 'on-hold': 'on hold', revoked: 'cancelled', completed: 'done' },
  appointment: { cancelled: 'cancelled', noshow: 'missed' },
};
/** "Entered in error" anywhere in a resource's status or verification status. */
const inError = (r) => [r.status, r.verificationStatus].some((v) => codeOf(v) === 'entered-in-error');
/** The status words of a resource, as " (stopped)" – '' when it needs none. */
function statusSuffix(r, kind) {
  const words = [STATUS_WORDS[kind]?.[codeOf(r.status)]];
  if (kind === 'condition' || kind === 'allergy') words.push(STATUS_WORDS.verification[codeOf(r.verificationStatus)], STATUS_WORDS.clinical[codeOf(r.clinicalStatus)]);
  const said = words.filter(Boolean);
  return said.length ? ` (${said.join(', ')})` : '';
}
/** A resource's main line with its status: marked when entered in error, with the status words otherwise. */
const withStatus = (r, kind, text) => (inError(r) ? `${ENTERED_IN_ERROR}: ${text}` : `${text}${statusSuffix(r, kind)}`);

/** The document's own status (Composition.status): '' for final, else preliminary, amended or entered-in-error. */
const documentStatusOf = (composition) => {
  const c = codeOf(composition?.status);
  return ['preliminary', 'amended', 'entered-in-error'].includes(c) ? c : '';
};

// ---------- Doses ----------

const PERIOD_UNITS = { s: 'second', min: 'minute', h: 'hour', d: 'day', wk: 'week', mo: 'month', a: 'year' };
const WHEN = {
  MORN: 'in the morning', AFT: 'in the afternoon', EVE: 'in the evening', NIGHT: 'at night', HS: 'at bedtime', WAKE: 'on waking', C: 'with meals', CM: 'with breakfast', CD: 'with lunch',
  CV: 'with dinner', AC: 'before meals', ACM: 'before breakfast', ACD: 'before lunch', ACV: 'before dinner', PC: 'after meals', PCM: 'after breakfast', PCD: 'after lunch', PCV: 'after dinner',
};
const DAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const unitWord = (u, n) => {
  const w = PERIOD_UNITS[u] ?? plain(u);
  return w && Number(n) !== 1 && PERIOD_UNITS[u] ? `${w}s` : w;
};
const timesWord = (f) => ({ 1: 'once', 2: 'twice' })[f] ?? `${plain(f)} times`;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** How often, when and how long, from timing.repeat: "twice a day, after meals, for 5 days". */
function repeatText(rep) {
  if (!rep || typeof rep !== 'object') return [];
  const out = [];
  const f = num(rep.frequency);
  const fMax = num(rep.frequencyMax);
  const p = num(rep.period);
  const u = rep.periodUnit;
  if (f != null && p != null && PERIOD_UNITS[u]) {
    const times = fMax != null && fMax !== f ? `${f}–${fMax} times` : timesWord(f);
    out.push(f === 1 && p !== 1 ? `every ${p} ${unitWord(u, p)}` : `${times} ${p === 1 ? `a ${unitWord(u, 1)}` : `every ${p} ${unitWord(u, p)}`}`);
  }
  const when = list(rep.when).map((w) => WHEN[String(w).toUpperCase()]).filter(Boolean);
  if (when.length) out.push(when.join(', '));
  const days = list(rep.dayOfWeek).map((d) => DAYS[String(d).toLowerCase()]).filter(Boolean);
  if (days.length) out.push(`on ${days.join(', ')}`);
  const at = list(rep.timeOfDay).map((t) => plain(t).slice(0, 5)).filter((t) => /^\d{2}:\d{2}$/.test(t));
  if (at.length) out.push(`at ${at.join(', ')}`);
  const d = num(rep.duration);
  if (d != null && PERIOD_UNITS[rep.durationUnit]) out.push(`for ${d} ${unitWord(rep.durationUnit, d)}`);
  else if (rep.boundsDuration?.value != null) out.push(`for ${quantityText(rep.boundsDuration)}`);
  else if (rep.boundsPeriod) {
    const period = periodText(rep.boundsPeriod);
    if (period) out.push(period);
  }
  if (num(rep.count) != null) out.push(`${rep.count} ${rep.count === 1 ? 'dose' : 'doses'} in all`);
  return out;
}

// The parts of a dosage read below; any other part is said to be in the other hospital's document
const DOSAGE_READ = new Set(['text', 'doseAndRate', 'timing', 'asNeededBoolean', 'asNeededCodeableConcept', 'route', 'method', 'additionalInstruction', 'patientInstruction', 'sequence', 'id', 'extension']);
const TIMING_READ = new Set(['code', 'repeat', 'id', 'extension']);
const REPEAT_READ = new Set(['frequency', 'frequencyMax', 'period', 'periodUnit', 'when', 'dayOfWeek', 'timeOfDay', 'duration', 'durationUnit', 'boundsDuration', 'boundsPeriod', 'count', 'id', 'extension']);
export const DOSE_IN_DOCUMENT = "more of the dose is in the other hospital's document";

/** One dosage in words – its text, else its structured parts (dose, how often, how long, when needed, route). */
export function dosageWords(d) {
  if (!d || typeof d !== 'object') return '';
  const text = plain(d.text);
  if (text) return text;
  const parts = [];
  for (const dr of list(d.doseAndRate)) {
    const dose = dr?.doseQuantity ? quantityText(dr.doseQuantity) : dr?.doseRange ? rangeText(dr.doseRange) : '';
    if (dose) parts.push(`Dose ${dose}`);
    const rate = dr?.rateQuantity ? quantityText(dr.rateQuantity) : dr?.rateRatio ? [quantityText(dr.rateRatio.numerator), quantityText(dr.rateRatio.denominator)].filter(Boolean).join(' per ') : '';
    if (rate) parts.push(`at ${rate}`);
  }
  if (d.timing?.code) parts.push(conceptText(d.timing.code));
  parts.push(...repeatText(d.timing?.repeat));
  if (d.asNeededBoolean === true) parts.push('when needed');
  else if (d.asNeededCodeableConcept) parts.push(`when needed for ${conceptText(d.asNeededCodeableConcept) || 'a reason given'}`);
  if (d.route) parts.push(conceptText(d.route));
  if (d.method) parts.push(conceptText(d.method));
  if (d.additionalInstruction) parts.push(conceptText(list(d.additionalInstruction)));
  if (d.patientInstruction) parts.push(plain(d.patientInstruction));
  const unread =
    Object.keys(d).some((k) => !DOSAGE_READ.has(k) && d[k] != null) ||
    Object.keys(d.timing ?? {}).some((k) => !TIMING_READ.has(k)) ||
    Object.keys(d.timing?.repeat ?? {}).some((k) => !REPEAT_READ.has(k)) ||
    list(d.doseAndRate).some((dr) => dr && typeof dr === 'object' && !dr.doseQuantity && !dr.doseRange && !dr.rateQuantity && !dr.rateRatio);
  const said = parts.filter(Boolean);
  if (unread || (!said.length && Object.keys(d).length)) said.push(DOSE_IN_DOCUMENT);
  return said.join(', ');
}

/** A medicine (MedicationRequest, MedicationStatement …) as one line: its name, the dose in words, and its status. */
function medicineLine(m, resolve) {
  const med = m.medicationCodeableConcept ? conceptText(m.medicationCodeableConcept) : conceptText(resolve(m.medicationReference)?.code) || plain(m.medicationReference?.display);
  const dosage = list(m.dosageInstruction ?? m.dosage)
    .map(dosageWords)
    .filter(Boolean)
    .join('; ');
  return withStatus(m, 'medicine', `${med || 'Medicine'}${dosage ? ` – ${dosage}` : ''}`);
}

/**
 * The lines of one resource ({ text, sub }), following references inside the document (a report's results, a
 * medicine's Medication). depth keeps a loop of references from going on for ever.
 */
function resourceLines(r, resolve, depth = 0) {
  if (!r || typeof r !== 'object' || depth > 3) return [];
  const line = (text, sub = false) => ({ text: plain(text), sub });
  const notes = notesOf(r).map((n) => line(n, true));
  switch (r.resourceType) {
    case 'Patient':
    case 'Practitioner':
    case 'PractitionerRole':
    case 'Organization':
    case 'Composition':
    case 'Medication':
      return [];
    case 'Condition':
      return [line(withStatus(r, 'condition', `${conceptText(r.code) || 'Condition'}${r.onsetDateTime ? ` – since ${dayText(r.onsetDateTime)}` : ''}`)), ...notes];
    case 'Observation':
      return [line(withStatus(r, 'result', observationLine(r))), ...list(r.hasMember).flatMap((m) => resourceLines(resolve(m), resolve, depth + 1).map((l) => ({ ...l, sub: true }))), ...notes];
    case 'DiagnosticReport': {
      const results = list(r.result).flatMap((ref) => resourceLines(resolve(ref), resolve, depth + 1).map((l) => ({ ...l, sub: true })));
      const when = dayText(r.effectiveDateTime ?? r.effectivePeriod?.start ?? r.issued);
      return [line(withStatus(r, 'report', `${conceptText(r.code) || 'Report'}${when ? ` – ${when}` : ''}`)), ...results, ...(r.conclusion ? [line(`Conclusion: ${r.conclusion}`, true)] : []), ...list(r.conclusionCode).map((c) => line(conceptText(c), true))];
    }
    case 'MedicationRequest':
    case 'MedicationStatement':
    case 'MedicationAdministration':
    case 'MedicationDispense':
      return [line(medicineLine(r, resolve)), ...notes];
    case 'Procedure':
      return [
        line(withStatus(r, 'procedure', `${conceptText(r.code) || 'Procedure'}${r.performedDateTime || r.performedPeriod ? ` – ${dayText(r.performedDateTime) || periodText(r.performedPeriod)}` : ''}`)),
        ...(r.outcome ? [line(`Outcome: ${conceptText(r.outcome)}`, true)] : []),
        ...notes,
      ];
    case 'AllergyIntolerance': {
      const reactions = list(r.reaction).flatMap((x) => list(x?.manifestation).map(conceptText)).filter(Boolean);
      return [line(withStatus(r, 'allergy', `Allergy: ${conceptText(r.code) || 'not named'}${reactions.length ? ` – ${reactions.join(', ')}` : ''}`)), ...notes];
    }
    case 'Immunization': {
      const dose = list(r.protocolApplied)
        .map((p) => p?.doseNumberString ?? p?.doseNumberPositiveInt)
        .filter((x) => x != null)[0];
      const text = `${conceptText(r.vaccineCode) || 'Vaccine'}${dose != null ? `, dose ${dose}` : ''}${r.occurrenceDateTime ? ` – ${dayText(r.occurrenceDateTime)}` : ''}${r.status === 'not-done' ? ' (not given)' : ''}`;
      return [line(inError(r) ? `${ENTERED_IN_ERROR}: ${text}` : text), ...notes];
    }
    case 'ImmunizationRecommendation':
      return list(r.recommendation).map((x) => line(`Recommended: ${conceptText(x?.vaccineCode) || 'vaccine'}${list(x?.dateCriterion)[0]?.value ? ` – ${dayText(list(x.dateCriterion)[0].value)}` : ''}`));
    case 'Appointment': {
      const when = dayText(r.start) || periodText(list(r.requestedPeriod)[0]);
      return [line(withStatus(r, 'appointment', `${r.status === 'proposed' ? 'Next visit' : 'Appointment'}${when ? ` on ${when}` : ''}${r.description ? ` – ${plain(r.description)}` : ''}`))];
    }
    case 'ServiceRequest':
      return [line(withStatus(r, 'request', `Advised: ${conceptText(r.code) || 'a test or service'}`)), ...notes];
    case 'Encounter': {
      const kind = r.class?.display || r.class?.code || conceptText(list(r.type)[0]);
      const when = periodText(r.period);
      return kind || when ? [line(`${kind ? plain(kind).replace(/^./, (c) => c.toUpperCase()) : 'Visit'}${when ? ` – ${when}` : ''}`)] : [];
    }
    case 'CarePlan':
      return [line(withStatus(r, 'request', plain(r.title) || plain(r.description) || 'Care plan')), ...list(r.activity).map((a) => line(plain(a?.detail?.description) || conceptText(a?.detail?.code), true)).filter((l) => l.text), ...notes];
    case 'FamilyMemberHistory':
      return [line(`Family history (${conceptText(r.relationship) || 'relative'}): ${list(r.condition).map((c) => conceptText(c?.code)).filter(Boolean).join(', ') || 'not named'}`)];
    case 'DocumentReference': {
      const text = `Attached document: ${plain(r.description) || conceptText(r.type) || plain(list(r.content)[0]?.attachment?.title) || 'not named'}`;
      return [line(inError(r) || codeOf(r.docStatus) === 'entered-in-error' ? `${ENTERED_IN_ERROR}: ${text}` : text)];
    }
    case 'Binary':
    case 'Media':
      return [];
    default: {
      const own = narrativeLines(r.text?.div).map((t) => line(t));
      return own.length ? own : r.code ? [line(conceptText(r.code))] : [];
    }
  }
}

// ---------- Attachments ----------

/** An attachment: the file when it is on the safe list, else why it was left out. */
function attachmentOf(a, fallback) {
  const contentType = String(a?.contentType ?? '')
    .toLowerCase()
    .split(';')[0]
    .trim()
    .slice(0, 100);
  const title = clip(plain(a?.title) || fallback, LIMITS.titleChars);
  if (!a?.data) return { title, contentType, leftOut: a?.url ? 'link' : 'empty' };
  if (!SAFE_FILE_TYPES.includes(contentType)) return { title, contentType, leftOut: 'type' };
  const b64 = String(a.data).replace(/\s/g, '');
  if (b64.length > Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4) return { title, contentType, leftOut: 'size' };
  const data = Buffer.from(b64, 'base64');
  if (!data.length) return { title, contentType, leftOut: 'empty' };
  if (data.length > MAX_FILE_BYTES) return { title, contentType, leftOut: 'size' };
  if (!looksLike(contentType, data)) return { title, contentType, leftOut: 'type' };
  return { title, contentType, data, size: data.length };
}

/** Every attachment in the document's resources (a report's PDF, a scanned document, a photo). */
function attachmentsOf(resources) {
  const out = [];
  for (const r of resources) {
    const label = { DocumentReference: 'Attached document', Binary: 'Attached file', Media: 'Photo or scan', DiagnosticReport: 'Report' }[r.resourceType];
    if (!label) continue;
    if (r.resourceType === 'Binary') out.push(attachmentOf({ contentType: r.contentType, data: r.data }, label));
    else if (r.resourceType === 'Media') out.push(attachmentOf(r.content, conceptText(r.type) || label));
    else if (r.resourceType === 'DiagnosticReport') list(r.presentedForm).forEach((a) => out.push(attachmentOf(a, `${conceptText(r.code) || label} (file)`)));
    else list(r.content).forEach((c) => out.push(attachmentOf(c?.attachment, plain(r.description) || conceptText(r.type) || label)));
  }
  return out;
}

// ---------- The fetal-sex guard ----------

/** Splits text into sentences and withholds each that mentions a baby's sex: { text, withheld }. */
export function guardText(text, on = true) {
  const t = plain(text);
  if (!on || !t) return { text: t, withheld: 0 };
  const parts = t.split(/(?<=[.!?;])\s+/);
  const kept = parts.filter((p) => !mentionsFetalSex(p));
  return { text: kept.join(' '), withheld: parts.length - kept.length };
}

// ---------- The document ----------

/** The document's type: ABDM's HI type (from its profile or SNOMED code) and its own words. */
function typeOf(composition) {
  const profiles = list(composition?.meta?.profile).map((p) => String(p).split('/').pop());
  const fromProfile = profiles.map((p) => TYPE_BY_PROFILE[p]).find(Boolean);
  const fromCode = list(composition?.type?.coding)
    .map((c) => TYPE_BY_CODE[c?.code])
    .find(Boolean);
  return { hiType: fromProfile ?? fromCode ?? '', typeText: conceptText(composition?.type) };
}

/**
 * A FHIR document (the parsed JSON) → what is kept and shown:
 * { hiType, typeText, title, date, status, hospital, authors, nameInDocument, sections: [{ title, lines: [{ text,
 *   withheld, sub }] }], withheld, truncated, files: [{ title, contentType, data, size }], filesLeftOut: [{ title,
 *   contentType, why }] }. date: the document's own date (Composition.date) or null – never when it was sent.
 *   status: '' (final), 'preliminary', 'amended' or 'entered-in-error' (Composition.status).
 * guard: run the fetal-sex guard (true for every patient who is not a baby). Throws NotReadable when it is not a
 * FHIR Bundle.
 */
export function readDocument(bundle, { guard = true } = {}) {
  if (!bundle || typeof bundle !== 'object' || bundle.resourceType !== 'Bundle') throw new NotReadable('Not a FHIR document.');
  const resources = list(bundle.entry)
    .map((e) => (e && typeof e === 'object' ? { fullUrl: String(e.fullUrl ?? ''), resource: e.resource } : null))
    .filter((e) => e?.resource && typeof e.resource === 'object' && typeof e.resource.resourceType === 'string');
  const byRef = new Map();
  for (const { fullUrl, resource } of resources) {
    if (fullUrl) byRef.set(fullUrl, resource);
    if (resource.id) {
      byRef.set(`${resource.resourceType}/${resource.id}`, resource);
      byRef.set(`urn:uuid:${resource.id}`, resource);
    }
  }
  const resolve = (ref) => {
    if (!ref || typeof ref !== 'object' || !ref.reference) return null;
    const r = String(ref.reference).slice(0, 500);
    if (byRef.has(r)) return byRef.get(r);
    const parts = r.split('/'); // a full address ("https://…/Practitioner/abc"): its last two parts
    return parts.length >= 2 ? (byRef.get(parts.slice(-2).join('/')) ?? null) : null;
  };
  const composition = resources.find((e) => e.resource.resourceType === 'Composition')?.resource ?? null;
  const all = resources.map((e) => e.resource);

  let withheld = 0;
  let truncated = false;
  let total = 0;
  const guarded = (text) => {
    const g = guardText(text, guard);
    withheld += g.withheld;
    return g;
  };
  const sections = [];
  // A line's date that is the document's own day is left out (the day is said once, at the top)
  const docDay = dayText(composition?.date);
  const sameDay = docDay ? ` – ${docDay}` : null;
  const addSection = (rawTitle, rawLines) => {
    if (sections.length >= LIMITS.sections) {
      truncated = true;
      return;
    }
    const title = guarded(clip(plain(rawTitle) || 'Details', LIMITS.titleChars));
    const lines = [];
    if (title.withheld) lines.push({ text: '', withheld: title.withheld, sub: false });
    for (const l of rawLines) {
      if (!l?.text) continue;
      if (lines.length >= LIMITS.linesPerSection || total >= LIMITS.lines) {
        truncated = true;
        break;
      }
      const g = guarded(clip(sameDay && l.text.endsWith(sameDay) ? l.text.slice(0, -sameDay.length) : l.text));
      lines.push({ text: g.text, withheld: g.withheld, sub: Boolean(l.sub) });
      total += 1;
    }
    if (lines.length) sections.push({ title: title.withheld ? 'Section' : title.text || 'Details', lines });
  };

  if (composition) {
    const walk = (secs, prefix, depth) => {
      for (const s of list(secs)) {
        if (!s || typeof s !== 'object' || depth > 3) continue;
        const title = [prefix, plain(s.title) || conceptText(s.code)].filter(Boolean).join(' – ');
        const fromEntries = list(s.entry).flatMap((ref) => resourceLines(resolve(ref), resolve));
        const lines = fromEntries.length ? fromEntries : narrativeLines(s.text?.div).map((text) => ({ text, sub: false }));
        addSection(title, lines);
        walk(s.section, title, depth + 1);
      }
    };
    walk(composition.section, '', 0);
  } else {
    addSection('Contents', all.flatMap((r) => resourceLines(r, resolve)));
  }

  const { hiType, typeText } = typeOf(composition);
  const custodian = resolve(composition?.custodian);
  const authors = list(composition?.author)
    .map((a) => nameOf(resolve(a)) || plain(a?.display))
    .filter(Boolean)
    .slice(0, 5);
  const rawTitle = clip(plain(composition?.title) || typeText || 'Health record', LIMITS.titleChars);
  const titleG = guarded(rawTitle);
  // The type's words are checked too (counted once when they are the title)
  const typeG = typeText === rawTitle ? titleG : guarded(clip(typeText, LIMITS.titleChars));
  const subject = resolve(composition?.subject) ?? all.find((r) => r.resourceType === 'Patient');

  const attachments = attachmentsOf(all);
  const files = [];
  const filesLeftOut = [];
  for (const a of attachments) {
    const t = guarded(a.title);
    const title = t.withheld ? 'Attached file' : t.text || 'Attached file';
    if (a.leftOut || files.length >= LIMITS.files) filesLeftOut.push({ title, contentType: a.contentType, why: a.leftOut ?? 'too_many' });
    else files.push({ title, contentType: a.contentType, data: a.data, size: a.size });
  }

  return {
    hiType,
    typeText: typeG.withheld ? '' : typeG.text,
    title: titleG.withheld ? FETCH_TYPE_WORDS[hiType] || 'Health record' : titleG.text,
    titleWithheld: titleG.withheld > 0,
    date: dateOf(composition?.date),
    status: documentStatusOf(composition),
    hospital: clip(nameOf(custodian), LIMITS.titleChars),
    authors,
    nameInDocument: clip(nameOf(subject), LIMITS.titleChars),
    sections,
    withheld,
    truncated,
    files,
    filesLeftOut,
  };
}
