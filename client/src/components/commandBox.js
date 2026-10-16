// The command box (doctor ideas, 16 Oct 2026 – docs/IDEAS_FOR_LATER.md #1): what a typed line can mean. PURE.
//  - a page or an action from the person's own menu ("billing", "unpaid", "new patient");
//  - "book" with a day ("book Friday", "book tomorrow", "book 21 Oct") → the appointments of that day;
//  - anything else (2+ letters) is also searched as a patient – a patient number ("P-000003 anaemia") alone.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const iso = (d) => d.toISOString().slice(0, 10);
const words = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * The day in "book …", as YYYY-MM-DD, or null. today: YYYY-MM-DD (the hospital's day). A weekday is the next one
 * (today's weekday means today); "21 Oct" or "Oct 21" is this year's, or next year's when it has passed.
 */
export function bookingDay(text, today) {
  const w = words(text);
  if (w[0] !== 'book' && w[0] !== 'appointment' && w[0] !== 'appointments') return null;
  const rest = w.slice(1).filter((x) => x !== 'on' && x !== 'for' && x !== 'next');
  if (!rest.length) return null;
  const base = new Date(`${today}T00:00:00Z`);
  if (rest[0] === 'today') return today;
  if (rest[0] === 'tomorrow') return iso(new Date(base.getTime() + DAY_MS));
  const wd = WEEKDAYS.findIndex((d) => d.startsWith(rest[0]) && rest[0].length >= 3);
  if (wd >= 0) return iso(new Date(base.getTime() + (((wd - base.getUTCDay()) + 7) % 7) * DAY_MS));
  const num = rest.find((x) => /^\d{1,2}$/.test(x));
  const mon = rest.findIndex((x) => MONTHS.some((m) => x.startsWith(m)) && x.length >= 3);
  if (num && mon >= 0) {
    const month = MONTHS.findIndex((m) => rest[mon].startsWith(m));
    let d = new Date(Date.UTC(base.getUTCFullYear(), month, Number(num)));
    if (d.getUTCMonth() !== month) return null; // 31 Feb
    if (d < base) d = new Date(Date.UTC(base.getUTCFullYear() + 1, month, Number(num)));
    return iso(d);
  }
  return null;
}

/** The patient search for a typed line: a patient number alone when one is in it, else the line itself. */
export function patientTerm(text) {
  const t = String(text ?? '').trim();
  const mrn = t.match(/\bP-?\d{3,}\b/i);
  return mrn ? mrn[0].toUpperCase().replace(/^P(?!-)/, 'P-') : t;
}

/**
 * The person's own pages and actions as commands: [{ label, to, keywords }]. modules: hospitalModules(roles);
 * extra: more actions (e.g. the New patient links).
 */
export function commandsFrom(modules, extra = []) {
  const out = [];
  for (const m of modules) {
    out.push({ label: m.label, to: m.to, keywords: m.label });
    for (const t of m.tabs ?? []) {
      if (t.to === m.to && t.label === m.label) continue;
      out.push({ label: `${m.label} › ${t.label}`, to: t.to, keywords: `${m.label} ${t.label}` });
    }
  }
  const seen = new Set();
  return [...out, ...extra].filter((c) => (seen.has(c.to + c.label) ? false : seen.add(c.to + c.label)));
}

/** The commands matching a typed line: every typed word starts a word of the command (best first), at most `max`. */
export function matchCommands(text, commands, max = 6) {
  const typed = words(text);
  if (!typed.length) return commands.slice(0, max);
  const scored = [];
  for (const c of commands) {
    const cw = words(c.keywords);
    if (!typed.every((t) => cw.some((w) => w.startsWith(t)))) continue;
    // Fewer words and a match at the start of the label first
    scored.push({ c, score: (words(c.label)[0]?.startsWith(typed[0]) ? 0 : 10) + cw.length });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, max).map((s) => s.c);
}
