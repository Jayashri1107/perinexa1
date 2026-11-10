// Urgent scan findings (owner's go-ahead, 10 Nov 2026 – docs/USG_APPS_REVIEW.md U2): when a scan report is signed,
// these written rules – never AI – pick the findings her doctor must know about now. They appear on the doctor's
// Today page (like a laboratory result outside its range) until a doctor marks them seen. Read only from the
// template's own fields, so the words of a finding are fixed and contain no free text.
// ⚠️ DRAFT – the list and its limits are the owner's to approve as the doctor (docs/USG_APPS_REVIEW.md section 9):
// usual obstetric cut-offs, written down here so that they can be changed in one place.

export const URGENT_LIMITS = {
  fhrLow: 100, // bpm – a fetal heart rate below this
  fhrHigh: 180, // bpm – or above this
  afiLow: 5, // cm – AFI at or below
  afiHigh: 25, // cm – AFI at or above
  dvpLow: 2, // cm – deepest vertical pocket below
  dvpHigh: 8, // cm – deepest vertical pocket above
  cervixShort: 25, // mm – cervical length below
  ntHigh: 3.5, // mm – nuchal translucency at or above
  twinDiscordance: 25, // % – weight difference between twins at or above
};

const L = URGENT_LIMITS;
const num = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
};
const PREGNANCY = new Set(['usg_early', 'usg_nt', 'usg_anomaly', 'usg_growth', 'usg_twins']);

/** The weight difference between twins in % of the larger (null when either weight is missing). */
export function twinDiscordance(a, b) {
  const [x, y] = [num(a), num(b)];
  if (!x || !y) return null;
  return Math.round((100 * Math.abs(x - y)) / Math.max(x, y));
}

/** The urgent findings of a report's values: [{ key, text }] in a fixed order (empty when none). */
export function urgentFindingsOf(study, values = {}) {
  if (!PREGNANCY.has(study)) return [];
  const v = values ?? {};
  const out = [];
  const add = (key, text) => out.push({ key, text });
  if (study === 'usg_early') {
    if (v.site === 'Ectopic suspected') add('ectopic', 'Ectopic pregnancy suspected');
    if (v.site === 'Not seen in the uterus') add('not_in_uterus', 'Pregnancy not seen in the uterus');
    if (v.cardiac === 'Absent') add('no_cardiac', 'No cardiac activity seen');
  }
  for (const [k, who] of [
    ['fhr', ''],
    ['fhr1', 'Twin 1: '],
    ['fhr2', 'Twin 2: '],
  ]) {
    const f = num(v[k]);
    if (f != null && (f < L.fhrLow || f > L.fhrHigh)) add(`${k}_out`, `${who}fetal heart rate ${f} bpm`);
  }
  if (v.placenta === 'Covering the internal os') add('praevia', 'Placenta covering the internal os (placenta praevia)');
  const afi = num(v.afi);
  if (afi != null && afi <= L.afiLow) add('afi_low', `AFI ${afi} cm – very little liquor`);
  if (afi != null && afi >= L.afiHigh) add('afi_high', `AFI ${afi} cm – too much liquor`);
  for (const [k, who] of [
    ['dvp', ''],
    ['dvp1', 'Twin 1: '],
    ['dvp2', 'Twin 2: '],
  ]) {
    const d = num(v[k]);
    if (d != null && d < L.dvpLow) add(`${k}_low`, `${who}deepest vertical pocket ${d} cm – very little liquor`);
    if (d != null && d > L.dvpHigh) add(`${k}_high`, `${who}deepest vertical pocket ${d} cm – too much liquor`);
  }
  const cervix = num(v.cervix);
  if (cervix != null && cervix < L.cervixShort) add('short_cervix', `Cervical length ${cervix} mm`);
  const nt = num(v.nt);
  if (nt != null && nt >= L.ntHigh) add('nt_high', `Nuchal translucency ${nt} mm`);
  if (study === 'usg_nt' && v.nasal === 'Absent') add('nasal_absent', 'Nasal bone not seen');
  if (study === 'usg_twins') {
    if (v.chorionicity === 'Monochorionic monoamniotic (MCMA)') add('mcma', 'Monochorionic monoamniotic twins');
    const diff = twinDiscordance(v.efw1, v.efw2);
    if (diff != null && diff >= L.twinDiscordance) add('discordance', `Weight difference between the twins ${diff} %`);
  }
  return out;
}
