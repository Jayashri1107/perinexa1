// Ultrasound reports: what is worked out from the readings, and the report written from them – PURE.
// Brought over from the sonography module of the other Perinexa copy (C:\Perinexa, server/src/usg – owner, 19 Oct 2026)
// and fitted to this app's scan templates (server/src/imaging/templates.js).
// DRAFT – the formulas, charts and sentences are the owner's to approve (the other copy's docs/USG_PLAN.md: Hadlock,
// 15 Oct 2026). Everything worked out is put in the form for the doctor to check; nothing is saved by itself.
// PC-PNDT: nothing here reads or writes the sex of a fetus.
//
// Sources (as published):
//  - Weeks from the crown-rump length: Hadlock FP et al., Radiology 1992;182:501-505.
//  - Weeks from BPD, HC, AC, FL (each, and the four together): Hadlock FP et al., Radiology 1984;152:497-501.
//  - Estimated fetal weight: Hadlock FP et al., Am J Obstet Gynecol 1985;151:333-337 (BPD-HC-AC-FL; HC-AC-FL).
//  - Weight centile for the weeks: Hadlock FP et al., Radiology 1991;181:129-133 (in-utero weight standard).
//  - Weeks from the mean sac diameter, before an embryo is measured: days = MSD in mm + 30.

export const CALC_SOURCES = 'DRAFT – Hadlock (CRL 1992, biometry 1984, weight 1985, centile 1991); MSD + 30 days';

const cm = (mm) => mm / 10;
const has = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
/** A typed reading ("62", "62.5", "62 mm") as a number, or null. */
export const reading = (v) => {
  const n = Number.parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Weeks (a decimal) as { weeks, days, totalDays }. */
export function weeksDays(weeks) {
  const totalDays = Math.round(weeks * 7);
  return { weeks: Math.floor(totalDays / 7), days: totalDays % 7, totalDays };
}
export const ordinal = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
};
export const gaWords = (ga) => (ga ? `${ga.weeks} weeks ${ga.days} day${ga.days === 1 ? '' : 's'}` : '');

/** Weeks from the crown-rump length (Hadlock 1992); for a CRL of 2–84 mm only. */
export function weeksFromCrl(crlMm) {
  if (!has(crlMm) || crlMm < 2 || crlMm > 84) return null;
  const c = cm(crlMm);
  return Math.exp(1.684969 + 0.315646 * c - 0.049306 * c ** 2 + 0.004057 * c ** 3 - 0.000120456 * c ** 4);
}

const weeksFrom = {
  bpd: (mm) => (has(mm) ? 9.54 + 1.482 * cm(mm) + 0.1676 * cm(mm) ** 2 : null),
  hc: (mm) => (has(mm) ? 8.96 + 0.54 * cm(mm) + 0.0003 * cm(mm) ** 3 : null),
  ac: (mm) => (has(mm) ? 8.14 + 0.753 * cm(mm) + 0.0036 * cm(mm) ** 2 : null),
  fl: (mm) => (has(mm) ? 10.35 + 2.46 * cm(mm) + 0.17 * cm(mm) ** 2 : null),
};

/** Weeks from the biometry: the four together when all are measured (Hadlock 1984), otherwise their average. */
export function weeksFromBiometry({ bpd, hc, ac, fl }) {
  if ([bpd, hc, ac, fl].every(has)) return 10.85 + 0.06 * cm(hc) * cm(fl) + 0.67 * cm(bpd) + 0.168 * cm(ac);
  const each = Object.entries({ bpd, hc, ac, fl })
    .map(([k, v]) => weeksFrom[k](v))
    .filter((w) => w != null);
  return each.length ? each.reduce((a, b) => a + b, 0) / each.length : null;
}

/** Estimated fetal weight in grams (Hadlock 1985): BPD-HC-AC-FL, or HC-AC-FL without the BPD. */
export function estimatedWeight({ bpd, hc, ac, fl }) {
  if (![hc, ac, fl].every(has)) return null;
  const [B, H, A, F] = [bpd, hc, ac, fl].map((v) => (has(v) ? cm(v) : null));
  const log10 = has(bpd)
    ? 1.3596 - 0.00386 * A * F + 0.0064 * H + 0.00061 * B * A + 0.0424 * A + 0.174 * F
    : 1.326 - 0.00326 * A * F + 0.0107 * H + 0.0438 * A + 0.158 * F;
  return Math.round(10 ** log10);
}

// The standard normal distribution (Abramowitz and Stegun 7.1.26), enough for a centile.
function normalCdf(z) {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** The centile (1–99) of a fetal weight for the weeks by her dates (Hadlock 1991: mean, SD 12.7 % of the mean). */
export function weightCentile(grams, weeks) {
  if (!has(grams) || !has(weeks) || weeks < 10 || weeks > 42) return null;
  const mean = Math.exp(0.578 + 0.332 * weeks - 0.00354 * weeks ** 2);
  const c = Math.round(100 * normalCdf((grams - mean) / (0.127 * mean)));
  return Math.min(99, Math.max(1, c));
}

const DAY = 24 * 60 * 60 * 1000;
const dayOf = (d) => {
  const t = new Date(d);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
};
const showDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const PREGNANCY_STUDIES = ['usg_early', 'usg_nt', 'usg_anomaly', 'usg_growth'];
export const isPregnancyStudy = (study) => PREGNANCY_STUDIES.includes(study);

/**
 * What is worked out from the readings of a scan. on: the scan day; eddByDates: the EDD on her record (null when
 * none). → { ga, gaFrom, edd, efw, efwCentile, datesGa, fill } – fill: the template fields to put them in.
 */
export function workOut(study, values, { on = new Date(), eddByDates = null } = {}) {
  const v = Object.fromEntries(['crl', 'msd', 'bpd', 'hc', 'ac', 'fl'].map((k) => [k, reading(values?.[k])]));
  const out = { ga: null, gaFrom: null, edd: null, efw: null, efwCentile: null, datesGa: null, fill: {} };
  if (!isPregnancyStudy(study)) return out;
  const fromCrl = study === 'usg_early' || study === 'usg_nt' ? weeksFromCrl(v.crl) : null;
  const fromBio = study === 'usg_anomaly' || study === 'usg_growth' ? weeksFromBiometry(v) : null;
  const fromMsd = study === 'usg_early' && !fromCrl && v.msd && v.msd <= 60 ? (v.msd + 30) / 7 : null;
  const weeks = fromCrl ?? fromBio ?? fromMsd;
  const scanDay = dayOf(on);
  if (weeks) {
    out.ga = weeksDays(weeks);
    out.gaFrom = fromCrl ? 'CRL' : fromBio ? 'biometry' : 'MSD';
    out.edd = showDay(scanDay + (280 - out.ga.totalDays) * DAY);
  }
  if (fromBio) out.efw = estimatedWeight(v);
  if (eddByDates) {
    const weeksByDates = (280 - (dayOf(eddByDates) - scanDay) / DAY) / 7;
    if (weeksByDates > 0 && weeksByDates < 45) {
      out.datesGa = weeksDays(weeksByDates);
      if (out.efw) out.efwCentile = weightCentile(out.efw, weeksByDates);
    }
  }
  // The template's own fields (server/src/imaging/templates.js) that these go into
  if (out.ga && (study === 'usg_early' || study === 'usg_nt')) out.fill.ga = `${gaWords(out.ga)} (by ${out.gaFrom})`;
  if (out.edd && study === 'usg_early') out.fill.edd = out.edd;
  if (out.efw) out.fill.efw = String(out.efw);
  if (out.efwCentile && study === 'usg_growth') out.fill.efwCentile = `${ordinal(out.efwCentile)} centile for ${gaWords(out.datesGa)} by dates`;
  return out;
}

const fmt = (v) => {
  const n = reading(v);
  if (n == null) return String(v ?? '').trim();
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
};
const filled = (v) => String(v ?? '').trim() !== '';
const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);

/**
 * The report written from the readings: { findings, impression } – the doctor changes any word before signing.
 * fields: the template's fields ({ key, name, unit }) for the scans without their own sentences.
 */
export function draftReport(study, values, calc, fields = []) {
  const v = values ?? {};
  const lines = [];
  const pregnancy = () => (v.number === 'Twins' ? 'Twin pregnancy seen.' : v.number === 'More than two' ? 'Multiple pregnancy seen.' : v.number === 'Single' ? 'Single pregnancy seen.' : '');
  const heart = () => (v.cardiac === 'Present' ? `Cardiac activity present${filled(v.fhr) ? `, fetal heart rate ${fmt(v.fhr)} bpm` : ''}.` : v.cardiac === 'Absent' ? 'No cardiac activity seen.' : filled(v.fhr) ? `Fetal heart rate ${fmt(v.fhr)} bpm.` : '');
  const biometry = () => {
    const parts = [['bpd', 'BPD'], ['hc', 'HC'], ['ac', 'AC'], ['fl', 'FL']].filter(([k]) => reading(v[k])).map(([k, l]) => `${l} ${fmt(v[k])} mm`);
    return parts.length ? `Biometry: ${parts.join(', ')}${calc.ga ? ` – corresponding to ${gaWords(calc.ga)}` : ''}.` : '';
  };
  const weight = () => (calc.efw ? `Estimated fetal weight ${calc.efw} g${calc.efwCentile ? ` (${ordinal(calc.efwCentile)} centile for ${gaWords(calc.datesGa)} by dates)` : ''}.` : '');
  const placenta = () => (filled(v.placenta) ? `Placenta ${lower(v.placenta)}.` : '');

  if (study === 'usg_early') {
    if (v.site === 'Not seen in the uterus') lines.push('No gestational sac seen in the uterus.');
    else {
      lines.push([v.site === 'Intrauterine' ? 'Intrauterine gestational sac seen.' : v.site === 'Ectopic suspected' ? 'Ectopic pregnancy suspected.' : '', pregnancy(), reading(v.msd) ? `Mean sac diameter ${fmt(v.msd)} mm.` : ''].filter(Boolean).join(' '));
      if (reading(v.crl)) lines.push(`CRL ${fmt(v.crl)} mm${calc.ga ? `, corresponding to ${gaWords(calc.ga)}` : ''}.`);
      else if (calc.ga) lines.push(`Mean sac diameter corresponds to about ${gaWords(calc.ga)}.`);
      lines.push(heart());
    }
    if (filled(v.adnexa)) lines.push(`Adnexa: ${v.adnexa}`);
  } else if (study === 'usg_nt') {
    if (reading(v.crl)) lines.push(`CRL ${fmt(v.crl)} mm${calc.ga ? `, corresponding to ${gaWords(calc.ga)}` : ''}.`);
    lines.push(heart());
    if (reading(v.nt)) lines.push(`Nuchal translucency ${fmt(v.nt)} mm.`);
    if (filled(v.nasal)) lines.push(`Nasal bone ${lower(v.nasal)}.`);
    if (filled(v.ductus)) lines.push(`Ductus venosus flow: ${v.ductus}`);
    lines.push(placenta());
  } else if (study === 'usg_anomaly' || study === 'usg_growth') {
    if (filled(v.presentation)) lines.push(`${v.presentation} presentation.`);
    lines.push(heart());
    lines.push(biometry());
    lines.push(weight());
    lines.push(placenta());
    if (filled(v.liquor)) lines.push(`Liquor ${lower(v.liquor)}.`);
    if (reading(v.afi)) lines.push(`AFI ${fmt(v.afi)} cm.`);
    if (reading(v.dvp)) lines.push(`Deepest vertical pocket ${fmt(v.dvp)} cm.`);
    if (filled(v.doppler)) lines.push(`Doppler: ${v.doppler}`);
    if (filled(v.anatomy)) lines.push(`Fetal anatomy: ${v.anatomy}`);
    if (reading(v.cervix)) lines.push(`Cervical length ${fmt(v.cervix)} mm.`);
  } else {
    // Other scans: each reading as a line, in the template's order
    for (const f of fields) if (filled(v[f.key])) lines.push(`${f.name}: ${fmt(v[f.key])}${f.unit && reading(v[f.key]) ? ` ${f.unit}` : ''}.`.replace(/\.\.$/, '.'));
  }
  let impression = '';
  if (isPregnancyStudy(study) && !(study === 'usg_early' && v.site === 'Not seen in the uterus')) {
    const many = v.number === 'Twins' ? 'Twin' : v.number === 'More than two' ? 'Multiple' : 'Single';
    const live = v.cardiac === 'Present' || (study !== 'usg_early' && reading(v.fhr)) ? ' live' : '';
    const where = study === 'usg_early' && v.site === 'Intrauterine' ? ' intrauterine' : '';
    const ga = calc.ga ? ` of ${gaWords(calc.ga)} by ${calc.gaFrom}` : '';
    impression = `${many}${live}${where} pregnancy${ga}.`;
  }
  return { findings: lines.filter(Boolean).join('\n'), impression };
}
