// Labels and small calculations for OBGY patient records (shared by the patient pages).
import { LOSS_SHORT } from './abortionFormat.js';

// The order of these objects is the order of the New patient menu. Abortion: pregnancy loss that was not induced
// (miscarriage, ectopic and molar pregnancy; owner decision of 2 Oct 2026).

export const CARE_TYPE_LABELS = {
  antenatal: 'Pregnancy (antenatal)',
  postnatal: 'After delivery (postnatal)',
  infertility: 'Infertility',
  gynaecology: 'Gynaecology',
  abortion: 'Abortion (pregnancy loss)',
  newborn: 'Newborn',
};
export const CARE_TYPE_SHORT = {
  antenatal: 'Antenatal',
  postnatal: 'Postnatal',
  infertility: 'Infertility',
  gynaecology: 'Gynaecology',
  abortion: 'Abortion',
  newborn: 'Newborn',
};
export const CARE_TYPE_HINTS = {
  antenatal: 'Pregnant patient',
  postnatal: 'Mother after delivery',
  infertility: 'Infertility treatment',
  gynaecology: 'Routine or other gynaecology care',
  abortion: 'Miscarriage, ectopic or molar pregnancy',
  newborn: 'Baby, linked to the mother',
};
export const CARE_TYPES = Object.keys(CARE_TYPE_LABELS);
// The "New patient" menu: registering starts by choosing the type of care.
export const NEW_PATIENT_LINKS = CARE_TYPES.map((t) => ({ type: t, label: CARE_TYPE_LABELS[t], to: `/patients/new/${t}` }));

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

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

// Problems in earlier pregnancies ("bad obstetric history")
export const PAST_COMPLICATION_LABELS = {
  stillbirth_or_neonatal_death: 'Stillbirth or newborn death',
  preterm_birth: 'Preterm birth',
  pre_eclampsia: 'Pre-eclampsia / eclampsia',
  congenital_anomaly: 'Baby with a congenital anomaly',
  low_birth_weight_baby: 'Baby under 2.5 kg',
  big_baby: 'Baby over 4 kg',
  obstructed_labour: 'Obstructed labour',
  pph: 'Heavy bleeding after delivery (PPH)',
  rh_isoimmunisation: 'Rh sensitisation',
};

// Findings made in THIS pregnancy (the same keys and order as the server's patients/pregnancyFindings.js). A doctor
// or RMO ticks them on the record; nothing is ever ticked by the software.
export const PREGNANCY_FINDING_LABELS = {
  gdm: 'Gestational diabetes (GDM)',
  hypertension: 'High blood pressure in this pregnancy',
  multiple: 'Twins or more',
  placenta_praevia: 'Low-lying placenta / placenta praevia',
  bleeding: 'Bleeding in this pregnancy',
};
export const PREGNANCY_FINDING_HINTS = {
  hypertension: 'Gestational hypertension or pre-eclampsia – not blood pressure that was high before the pregnancy',
};

/** The findings ticked for this pregnancy, as the server marks them (`current`), in the form's order. */
export function currentFindings(patient) {
  const now = (patient?.pregnancy?.findings ?? []).filter((f) => f.current);
  return Object.keys(PREGNANCY_FINDING_LABELS).flatMap((key) => now.filter((f) => f.key === key));
}

/**
 * Earlier entries, newest first: unticked ones ("removed by … on …") and those from an earlier pregnancy on the
 * same record. Each: { key, label, text } with the dates left to the caller's formatter.
 */
export function pastFindings(patient, formatDate = (d) => String(d)) {
  return (patient?.pregnancy?.findings ?? [])
    .filter((f) => !f.current)
    .map((f) => ({
      key: f.key,
      label: PREGNANCY_FINDING_LABELS[f.key] ?? f.key,
      text: f.endedAt
        ? `recorded by ${f.byName ?? 'staff'} on ${formatDate(f.at)}, removed by ${f.endedByName ?? 'staff'} on ${formatDate(f.endedAt)}`
        : `recorded by ${f.byName ?? 'staff'} on ${formatDate(f.at)}, in an earlier pregnancy`,
    }))
    .reverse();
}

/**
 * The readings of this pregnancy the risk rules use, in words: [['Lowest Hb', '9.8 g/dL · 12 Sep 2026 (lab result)'],
 * ['Latest BP', '150/96 · 3 Oct 2026']]. Empty when nothing was measured.
 */
export function readingRows(patient, formatDate = (d) => String(d)) {
  const r = patient?.pregnancy?.readings;
  const rows = [];
  if (r?.lowestHb) rows.push(['Lowest Hb', `${r.lowestHb.value} g/dL · ${formatDate(r.lowestHb.on)} (${r.lowestHb.source === 'lab' ? 'lab result' : 'visit'})`]);
  if (r?.latestBp) rows.push(['Latest BP', `${r.latestBp.systolic}/${r.latestBp.diastolic} · ${formatDate(r.latestBp.on)}`]);
  return rows;
}

// Same rule as the server: a current pregnancy with Gravida 1 and no earlier deliveries, abortions or
// caesareans, so there are no previous pregnancies to ask about.
const positive = (x) => Number(String(x ?? '').trim()) > 0;
export function isFirstPregnancy(careType, o) {
  return careType === 'antenatal' && String(o?.gravida ?? '').trim() === '1' && !positive(o.para) && !positive(o.abortions) && !positive(o.previousCaesareans);
}

export const NEWBORN_SEX_LABELS = { female: 'Female', male: 'Male', indeterminate: 'Indeterminate' };
// Breastfeeding, on a postnatal record (the same values as the server): '' = not recorded.
export const BREASTFEEDING_LABELS = { '': 'Not recorded', yes: 'Yes', no: 'No' };
// A baby's care after birth (the same values as the server, models/Patient.js): '' = not recorded.
export const NICU_ADMITTED_LABELS = { '': 'Not recorded', yes: 'Yes', no: 'No' };
export const FEEDING_AT_DISCHARGE_LABELS = { '': 'Not recorded', exclusive: 'Breast milk only (exclusive)', partial: 'Breast milk and other milk (partial)', none: 'No breast milk' };

/**
 * A baby's NICU or SNCU stay in words (formatDate: how a date is written): "Yes – from 2 Oct 2026 to 5 Oct 2026",
 * "Yes – from 2 Oct 2026, still there", "No", "Not recorded".
 */
export function nicuStayText(nicu, formatDate) {
  if (nicu?.admitted === 'no') return 'No';
  if (nicu?.admitted !== 'yes') return 'Not recorded';
  if (!nicu.from) return 'Yes';
  return `Yes – from ${formatDate(nicu.from)}${nicu.to ? ` to ${formatDate(nicu.to)}` : ', still there or discharge not recorded'}`;
}

const DAY = 24 * 60 * 60 * 1000;

// Naegele's rule, same as the server: EDD = LMP + 280 days. Dates are "YYYY-MM-DD" strings.
export function eddFromLmp(lmp) {
  if (!lmp) return null;
  const d = new Date(`${lmp}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 280 * DAY);
}

export function gestationFromEdd(edd, now = new Date()) {
  if (!edd) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = 280 - Math.round((new Date(edd).getTime() - today) / DAY);
  if (days < 0) return null;
  return { weeks: Math.floor(days / 7), days: days % 7 };
}

/**
 * A warning about the pregnancy dates entered, or null: weeks today above 42 (usually a mistyped or misheard LMP,
 * e.g. "18 5" heard as "18 November") or an LMP in the future. Said with the date in words so it is easy to check.
 */
export function datesWarning({ lmp, scanEdd }, now = new Date()) {
  const used = scanEdd ? new Date(`${scanEdd}T00:00:00Z`) : eddFromLmp(lmp);
  if (!used || Number.isNaN(used.getTime())) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = 280 - Math.round((used.getTime() - today) / DAY);
  const which = scanEdd ? `The scan EDD entered is ${formatDateWords(scanEdd)}` : `The LMP entered is ${formatDateWords(lmp)}`;
  if (lmp && !scanEdd && Date.parse(`${lmp}T00:00:00Z`) > today) return `${which} – that is in the future. Please check the date.`;
  if (days > 42 * 7) return `${which}, which makes her ${Math.floor(days / 7)} weeks today – more than 42 weeks. Please check the date (day, month and year).`;
  return null;
}
const formatDateWords = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Gestation as the brand guide writes it: "28 w 3 d". Both names are kept for the pages that import them.
export const formatGestation = (ga) => (ga ? `${ga.weeks} w ${ga.days} d` : '—');
export const formatGestationShort = formatGestation;

// "G2 P1 L1 A0" plus previous caesareans
export function formatGpla(o) {
  if (!o || [o.gravida, o.para, o.living, o.abortions].every((v) => v == null)) return '—';
  const v = (x) => (x == null ? '?' : x);
  const base = `G${v(o.gravida)} P${v(o.para)} L${v(o.living)} A${v(o.abortions)}`;
  return o.previousCaesareans ? `${base} · ${o.previousCaesareans} previous caesarean${o.previousCaesareans > 1 ? 's' : ''}` : base;
}

// Allergies are one free-text note. "None known" is what the form's tick box and voice entry write; the other
// usual ways of writing "no allergies" mean the same. An empty note means nobody has asked yet.
export const NO_KNOWN_ALLERGIES = 'None known';
const NO_ALLERGY_TEXT = /^(nil|none|no|nka|nkda|none known|nil known|no allerg(y|ies)|no known( drug)? allerg(y|ies))\.?$/;
export const isNoKnownAllergies = (text) => NO_ALLERGY_TEXT.test((text ?? '').trim().toLowerCase());
/** 'recorded' (an allergy is written), 'none' (asked: none known) or 'not_asked' (empty). */
export function allergyStatus(text) {
  if (!(text ?? '').trim()) return 'not_asked';
  return isNoKnownAllergies(text) ? 'none' : 'recorded';
}
/** The allergy line printed on prescriptions: the allergy, "None known", or "Not recorded" (null: no medical details). */
export function allergyPrintLine(patient) {
  if (patient.medical === undefined || patient.careType === 'newborn') return null;
  const text = patient.medical?.allergies ?? '';
  const status = allergyStatus(text);
  return status === 'recorded' ? text.trim() : status === 'none' ? 'None known' : 'Not recorded';
}
export const isRhNegative = (bloodGroup) => /-$/.test(bloodGroup ?? '');

export function bmi(medical) {
  if (!medical?.heightCm || !medical?.weightKg) return null;
  const m = medical.heightCm / 100;
  return Math.round((medical.weightKg / (m * m)) * 10) / 10;
}

export function newbornAge(birthAt, now = new Date()) {
  if (!birthAt) return '—';
  const days = Math.floor((now - new Date(birthAt)) / DAY);
  if (days < 1) return 'Born today';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} old`;
  const months = Math.floor(days / 30.44);
  return `${months} month${months === 1 ? '' : 's'} old`;
}

export const ageText = (p) => (p.careType === 'newborn' ? newbornAge(p.newborn?.birthAt) : p.currentAge != null ? `${p.currentAge} yrs` : '—');

// "2026-09-27" for date inputs from a stored date
export const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
// "2026-09-27T14:30" (local time) for datetime inputs
export function toDateTimeInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- The Patients list in plain words ----------

/**
 * What care she is under now, in plain words: "Pregnant · 18 w 3 d", "After delivery", "Newborn · 40 days old",
 * "Abortion · missed" (the type of loss only for those who see the medical details).
 */
export function careNowText(p) {
  if (p.careType === 'abortion') return ['Abortion', LOSS_SHORT[p.abortion?.lossType]].filter(Boolean).join(' · ');
  if (p.careType === 'antenatal') {
    const ga = p.gestationalAge ? `${p.gestationalAge.weeks} w ${p.gestationalAge.days} d` : null;
    return ['Pregnant', ga ?? 'dates not entered'].join(' · ');
  }
  if (p.careType === 'newborn') return ['Newborn', ageText(p)].filter(Boolean).join(' · ');
  return { postnatal: 'After delivery', gynaecology: 'Gynaecology', infertility: 'Fertility care' }[p.careType] ?? CARE_TYPE_SHORT[p.careType] ?? '';
}

/** "Today", "Yesterday", "3 days ago", "5 weeks ago", "4 months ago" (hospital dates at midnight UTC). */
export function sinceText(day, now = new Date()) {
  if (!day) return '';
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - new Date(day).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30.4)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

// Who may mark a patient arrived (as server/src/routes/arrivals.js)
export const ARRIVAL_ROLES = ['receptionist', 'nurse', 'doctor', 'rmo'];

/**
 * Is a patient just registered here now, so marked arrived (on Today's patients, with an OPD number)? Registered for
 * OPD by someone who marks arrivals (28 Oct 2026) – not for a stay (IPD, day care), not for a booking (which may be
 * for another day), not from an online sign-up (she may be at home).
 */
export const arrivesOnRegistration = ({ setting, booking = null, fromSignup = null, roles = [] }) =>
  setting === 'opd' && !booking && !fromSignup && roles.some((r) => ARRIVAL_ROLES.includes(r));
