// Words and links for the Analytics pages (Feature 11). Numbers come from the server already decided: exact
// numbers are shown with formatNumber; a hospital admin's small or protected numbers arrive as
// { masked: 'lt5' | 'hidden' | 'withheld' } and are shown in words here, never worked out again.
import { formatNumber } from '../../components/DataTable.jsx';
import { formatDate } from '../../components/ui.jsx';
import { DELIVERY_MODE_LABELS } from '../inpatient/inpatientFormat.js';
import { formatGestation } from '../patients/patientFormat.js';
import { OUTCOME_LABELS as PLAN_OUTCOME_WORDS, STEP_WORDS as CYCLE_STEP_WORDS } from '../patients/fertilityFormat.js';

// The tabs, in page order (the server has the same ones: server/src/analytics/registry.js SECTIONS).
export const SECTIONS = ['overview', 'pregnancy', 'risk', 'care', 'deliveries', 'newborn', 'fertility'];
export const SECTION_LABELS = {
  overview: 'Overview',
  pregnancy: 'Pregnancy',
  risk: 'Risk & conditions',
  care: 'Care plans & visits',
  deliveries: 'Deliveries',
  newborn: 'Newborn',
  fertility: 'Fertility',
};

/**
 * The "Not in this version" card on Overview: what is not counted yet, what is planned, and where the delivery
 * outcomes are (the Deliveries tab, 5 Oct 2026). A hospital admin's Deliveries tab has deliveries and postpartum
 * haemorrhage only, so their card says that. audience: 'doctor', 'admin' or 'platform'.
 */
export function notInThisVersion(audience) {
  return [
    'Not counted in this version: birth doses; the GDM rate and lab results as numbers; clinical measures for gynaecology; the postnatal schedule. Fertility treatment cycles and plans are on the Fertility tab.',
    "Planned for later: doctors' changes to the risk level, problems in earlier pregnancies, reduced fetal movements, and whether women came back on the date given.",
    audience === 'admin'
      ? 'Deliveries, the mode of delivery and postpartum haemorrhage are on the Deliveries tab. Births, stillbirths, deaths and the other newborn numbers there are only for doctors.'
      : 'Delivery outcomes are on the Deliveries tab, from the delivery notes a doctor confirmed: mode of delivery and the caesarean rate, postpartum haemorrhage, stillbirths, Apgar, NICU or SNCU admissions, breastfeeding within one hour, and newborn and maternal deaths.',
  ];
}

/** True for an exact number (not masked, not "not applicable"). */
export const isExact = (v) => typeof v === 'number' && Number.isFinite(v);
/** True for a value a hospital admin gets in words instead of a number. */
export const isMasked = (v) => Boolean(v && typeof v === 'object' && v.masked);

// The super admin's small-hospital switch (PLATFORM_MIN_DENOMINATOR on the server, off unless the owner turns it
// on): a medical card of a hospital with too few women in it has no numbers for that hospital.
export const TOO_FEW_TEXT = 'Too few patients in this hospital to show';
/** True for a super admin card that has no numbers because every hospital picked is left out by the switch. */
export const isLeftOutCard = (card) => Array.isArray(card?.tooFew) && card.tooFew.length > 0 && card.tooFew.every(Boolean);
/** The notes under a card; a card that already says "Too few patients…" does not say it again below. */
export const cardNotes = (card) => (card?.notes ?? []).filter((n) => !(isLeftOutCard(card) && n === `${TOO_FEW_TEXT}.`));
/**
 * One hospital's value in a "by hospital" table (counts, and the ratio and median rows): "Too few patients in
 * this hospital to show" for a hospital the switch leaves out, else the value in words (fmt).
 */
export const perHospitalText = (v, i, tooFew, fmt = formatCount) => (v === null && Array.isArray(tooFew) && tooFew[i] ? TOO_FEW_TEXT : fmt(v));

/**
 * The words of a headline tile: { sub, tooFew }. sub always starts with the time window it counts ("As of today"
 * or "In the period"); then the tile's own words, and, when the switch leaves some hospitals out, the note that
 * names them. tooFew: the tile has no number because every hospital picked is left out.
 */
export function tileWords(t) {
  const when = t.window === 'now' ? 'As of today' : 'In the period';
  const leftOut = Array.isArray(t.tooFew) && t.tooFew.some(Boolean);
  const tooFew = t.value === null && leftOut;
  const note = leftOut && t.note && t.note !== `${TOO_FEW_TEXT}.` ? t.note : null;
  const parts = [when, ...(t.sub && !tooFew ? [t.sub] : []), ...(note ? [note] : [])];
  return { sub: parts.join(' · '), tooFew };
}

/** A cell value in words: "1,234", "fewer than 5", "Not shown" or "—". */
export function formatCount(v) {
  if (isExact(v)) return formatNumber(v);
  if (isMasked(v)) return v.masked === 'lt5' ? 'fewer than 5' : 'Not shown';
  return '—';
}

// A percentage only from two exact numbers and a denominator of 20 or more (rule R2).
export const MIN_DENOMINATOR_FOR_PERCENT = 20;

/** The percentage of x in y, or null when it must not be shown. */
export function sharePercent(x, y) {
  if (!isExact(x) || !isExact(y) || y < MIN_DENOMINATOR_FOR_PERCENT) return null;
  return Math.round((x / y) * 100);
}

/**
 * "x of y": "34 of 40 · 85%", "12 of 15 · Too few to compare", "fewer than 5 of 40", "Not shown of 40",
 * "None yet" (0 of 0). A masked side gives no percentage, and its words come from formatCount.
 */
export function shareText(x, y) {
  if (x == null || y == null) return '—';
  if (isExact(x) && isExact(y)) {
    if (x === 0 && y === 0) return 'None yet';
    const pct = sharePercent(x, y);
    return `${formatNumber(x)} of ${formatNumber(y)} · ${pct === null ? 'Too few to compare' : `${pct}%`}`;
  }
  return `${formatCount(x)} of ${formatCount(y)}`;
}

/** The sex ratio at birth: "1,000 girls per 1,000 boys", or "—" when there is none. */
export const ratioText = (r) => (isExact(r) ? `${formatNumber(r)} girls per 1,000 boys` : '—');

const plural = (n, one, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** The value that put a patient on a list, in words. */
export function listDetailText(detail) {
  if (!detail) return '—';
  const ga = (d) => (d.weeks == null ? null : formatGestation({ weeks: d.weeks, days: d.days ?? 0 }));
  switch (detail.type) {
    case 'ga':
      return ga(detail) ?? '—';
    case 'booked':
      return ga(detail) ? `Booked at ${ga(detail)} on ${formatDate(detail.on)}` : `Booked on ${formatDate(detail.on)}, gestation not known`;
    case 'edd':
      return `EDD ${formatDate(detail.on)}`;
    case 'hb':
      return `Hb ${Number(detail.value).toFixed(1)} g/dL on ${formatDate(detail.on)}`;
    case 'bp':
      return `BP ${detail.sys}/${detail.dia} on ${formatDate(detail.on)}`;
    case 'grams':
      return `${formatNumber(detail.value)} g`;
    case 'lastVisit':
      return `Last visit ${formatDate(detail.on)}`;
    case 'items':
      return plural(detail.count, 'item');
    // Deliveries tab: a row per delivery or per baby (a mother of twins has two rows, told apart here)
    case 'delivery':
      return [`Delivered ${formatDate(detail.on)}`, DELIVERY_MODE_LABELS[detail.mode] ?? null].filter(Boolean).join(' · ');
    case 'birth':
      return [
        `Born ${formatDate(detail.on)}`,
        detail.of > 1 ? `baby ${detail.baby} of ${detail.of}` : null,
        isExact(detail.apgar5) ? `Apgar ${detail.apgar5} at 5 minutes` : 'apgar5' in detail ? 'Apgar not recorded' : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'death':
      return `Died ${formatDate(detail.on)}`;
    // Fertility tab: a row per cycle or plan (a woman with two cycles in the period has two rows)
    case 'cycle':
      return [`Cycle ended ${formatDate(detail.on)}`, CYCLE_STEP_WORDS[detail.step] ?? null].filter(Boolean).join(' · ');
    case 'plan':
      return [`Plan ended ${formatDate(detail.on)}`, PLAN_OUTCOME_WORDS[detail.outcome] ?? null].filter(Boolean).join(' · ');
    default:
      return '—';
  }
}

// ---------- Filters in the address bar ----------

// What each audience may choose, and its defaults (a default is left out of the address).
export const FILTER_DEFAULTS = {
  doctor: { period: '12m', from: '', to: '', scope: 'hospital', careType: 'all' },
  admin: { period: 'last_12m', careType: 'all' },
  platform: { hospital: 'all', period: 'last_12m', from: '', to: '', careType: 'all' },
};
const CUSTOM_PERIODS = ['custom', 'custom_months'];

export const PERIOD_OPTIONS = {
  doctor: [
    { value: 'this_month', label: 'This month' },
    { value: '3m', label: '3 months' },
    { value: '6m', label: '6 months' },
    { value: '12m', label: '12 months' },
    { value: 'custom', label: 'Custom' },
  ],
  admin: [
    { value: 'last_month', label: 'Last month' },
    { value: 'last_3m', label: 'Last 3 months' },
    { value: 'last_6m', label: 'Last 6 months' },
    { value: 'last_12m', label: 'Last 12 months' },
  ],
  platform: [
    { value: 'last_month', label: 'Last month' },
    { value: 'last_3m', label: 'Last 3 months' },
    { value: 'last_6m', label: 'Last 6 months' },
    { value: 'last_12m', label: 'Last 12 months' },
    { value: 'custom_months', label: 'Custom months' },
  ],
};

/**
 * The filters with a period this audience can't choose (from a shared link, or a period chosen in another hospital
 * where the person has another role) replaced by its default, and the dates of that period dropped.
 */
export function analyticsParams(params, audience) {
  const allowed = (PERIOD_OPTIONS[audience] ?? []).map((o) => o.value);
  if (!params || allowed.includes(params.period)) return params;
  const defaults = FILTER_DEFAULTS[audience] ?? {};
  return { ...params, period: defaults.period, ...('from' in defaults ? { from: '', to: '' } : {}) };
}

/**
 * Which cards take the full width at two columns: tables, trends and E4 (WIDE_CARDS), and a half-width card that
 * starts a row when the next card is full width or there is no next card, so no row is left half empty.
 * The order of the cards never changes. Returns one true/false per card.
 */
export function cardWidths(cards, wideIds) {
  const full = cards.map((c) => wideIds.has(c.id));
  let col = 0; // 0 = the card starts a row, 1 = it fills the second half
  return cards.map((c, i) => {
    if (full[i]) {
      col = 0;
      return true;
    }
    if (col === 1) {
      col = 0;
      return false;
    }
    const alone = i === cards.length - 1 || full[i + 1];
    col = alone ? 0 : 1;
    return alone;
  });
}

/** The filters an audience sends to the server (defaults and dates of a preset period left out). */
export function analyticsQuery(params, audience) {
  const defaults = FILTER_DEFAULTS[audience] ?? {};
  const out = {};
  for (const key of Object.keys(defaults)) {
    const value = params?.[key];
    if (value === undefined || value === null || value === '' || value === defaults[key]) continue;
    if ((key === 'from' || key === 'to') && !CUSTOM_PERIODS.includes(params.period)) continue;
    out[key] = String(value);
  }
  return out;
}

/** The query string of an Analytics page ("" or "?period=3m&scope=mine"), without that audience's defaults. */
export function analyticsSearch(params, audience) {
  const q = new URLSearchParams(analyticsQuery(params, audience)).toString();
  return q ? `?${q}` : '';
}

/**
 * The link to the patients behind one number (doctors only). It carries opaque codes only – never a label – so
 * the browser history never shows a diagnosis: /analytics/list?metric=A2&cell=c3&back=pregnancy&period=…
 */
export function listHref({ metric, cell, section, params }) {
  const q = new URLSearchParams({ metric, cell, back: section });
  for (const [k, v] of Object.entries(analyticsQuery(params, 'doctor'))) q.set(k, v);
  return `/analytics/list?${q.toString()}`;
}

/** "2026-10" for the month input; the hospital's month today. */
export const thisMonth = () => new Date().toISOString().slice(0, 7);
/** True for a real month like "2026-10" (the same check as the server: 01–12 only). */
export const isReportMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? '');
/** "October 2026" from "2026-10". */
export const monthWords = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/**
 * The page tabs, each keeping the chosen filters. base: '/analytics' or '/platform/analytics'.
 * report: the Monthly report tab (doctors of a hospital only); ask: Ask your records (doctors; always last).
 */
export function analyticsTabs(base, search = '', { ask = false, report = false } = {}) {
  const tabs = SECTIONS.map((s) => ({ label: SECTION_LABELS[s], to: `${s === 'overview' ? base : `${base}/${s}`}${search}`, end: true }));
  if (report) tabs.push({ label: 'By doctor', to: '/analytics/doctors', end: true }, { label: 'Monthly report', to: '/analytics/report', end: true });
  if (ask) tabs.push({ label: 'Ask your records', to: '/analytics/ask', end: true });
  return tabs;
}
