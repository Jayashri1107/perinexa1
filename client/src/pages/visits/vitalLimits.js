// Values outside the usual range, shown as they are typed on Visit details (before saving). Pure.
// A reminder only, like the red flags (which are worked out from the hospital's rules after saving): the limits are
// the same as the draft red-flag rules (FOGSI / WHO / ACOG-based), plus pulse, temperature and SpO2. The doctor
// decides. To be reviewed by the owner with the red-flag rules.
// A baby (newborn care) has its own limits: the adult limits for blood pressure, pulse, haemoglobin and urine are
// not used (a pulse of 140 is normal for a baby), and the temperature follows the draft newborn rules – under
// 97.7 °F or over 99.5 °F (WHO Thermal protection of the newborn; IMNCI: under 95.9 °F is a danger sign).
// SpO2 keeps the reminder this form has always shown for every patient (under 95, under 92) – it is not a newborn
// guideline value, and no red-flag rule checks a baby's SpO2 after saving (the "What is not checked" text says so).
// To be reviewed by the owner with the newborn rules.
//
// Each check: { key, level: 'high' | 'watch', text } – 'high' is shown in Alert Red, 'watch' in amber.

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const URINE_ORDER = ['nil', 'trace', '1+', '2+', '3+', '4+'];
const atLeast = (grade, min) => URINE_ORDER.indexOf(grade) >= URINE_ORDER.indexOf(min);

/**
 * The vital signs and pregnancy check outside the usual range. pregnant: antenatal (FHR, movements, oedema);
 * baby: a patient in newborn care (a baby's temperature limits; no adult limits).
 */
export function vitalFlags(vitals = {}, details = {}, { pregnant = false, baby = false } = {}) {
  const out = [];
  const add = (key, level, text) => out.push({ key, level, text });
  if (baby) {
    const t = num(vitals.temperatureF);
    if (t != null && t < 95.9) add('temp', 'high', `Temperature ${t} °F – very low for a baby`);
    else if (t != null && t < 97.7) add('temp', 'watch', `Temperature ${t} °F – low for a baby`);
    else if (t != null && t > 99.5) add('temp', 'high', `Temperature ${t} °F – high for a baby`);
    const o2 = num(vitals.spo2);
    if (o2 != null && o2 < 92) add('spo2', 'high', `SpO2 ${o2}% – low`);
    else if (o2 != null && o2 < 95) add('spo2', 'watch', `SpO2 ${o2}% – below 95`);
    return out;
  }

  const sys = num(vitals.bpSystolic);
  const dia = num(vitals.bpDiastolic);
  if (sys != null || dia != null) {
    const bp = `BP ${sys ?? '?'}/${dia ?? '?'}`;
    if ((sys != null && sys >= 160) || (dia != null && dia >= 110)) add('bp', 'high', `${bp} – severe range`);
    else if ((sys != null && sys >= 140) || (dia != null && dia >= 90)) add('bp', 'high', `${bp} – raised`);
    else if (sys != null && sys < 90) add('bp', 'watch', `${bp} – low`);
  }
  const pulse = num(vitals.pulse);
  if (pulse != null && pulse > 110) add('pulse', 'high', `Pulse ${pulse} – fast`);
  else if (pulse != null && (pulse > 100 || pulse < 60)) add('pulse', 'watch', `Pulse ${pulse} – ${pulse > 100 ? 'fast' : 'slow'}`);
  const temp = num(vitals.temperatureF);
  if (temp != null && temp >= 100.4) add('temp', 'high', `Temperature ${temp} °F – fever`);
  const spo2 = num(vitals.spo2);
  if (spo2 != null && spo2 < 92) add('spo2', 'high', `SpO2 ${spo2}% – low`);
  else if (spo2 != null && spo2 < 95) add('spo2', 'watch', `SpO2 ${spo2}% – below 95`);
  const hb = num(vitals.hb);
  if (hb != null && hb < 7) add('hb', 'high', `Hb ${hb} – severe anaemia`);
  else if (hb != null && hb < 10) add('hb', 'watch', `Hb ${hb} – moderate anaemia`);
  else if (hb != null && hb < 11 && pregnant) add('hb', 'watch', `Hb ${hb} – mild anaemia`);
  if (vitals.urineAlbumin && atLeast(vitals.urineAlbumin, '1+')) add('albumin', atLeast(vitals.urineAlbumin, '2+') ? 'high' : 'watch', `Urine albumin ${vitals.urineAlbumin}`);
  if (vitals.urineSugar && atLeast(vitals.urineSugar, '1+')) add('sugar', 'watch', `Urine sugar ${vitals.urineSugar}`);

  if (pregnant) {
    const fhr = num(details.fetalHeartRate);
    if (fhr != null && (fhr < 110 || fhr > 160)) add('fhr', 'high', `Fetal heart rate ${fhr} – outside 110–160`);
    if (details.fetalMovements === 'absent') add('movements', 'high', 'Fetal movements absent');
    else if (details.fetalMovements === 'reduced') add('movements', 'high', 'Fetal movements reduced');
    if (details.oedema === 'severe') add('oedema', 'watch', 'Severe oedema');
  }
  return out;
}

/** The input keys a check is about (to mark those inputs). */
export const FLAG_INPUTS = {
  bp: ['bpSystolic', 'bpDiastolic'],
  pulse: ['pulse'],
  temp: ['temperatureF'],
  spo2: ['spo2'],
  hb: ['hb'],
  albumin: ['urineAlbumin'],
  sugar: ['urineSugar'],
  fhr: ['fetalHeartRate'],
  movements: ['fetalMovements'],
  oedema: ['oedema'],
};
