// A date typed the Indian way (13 Nov 2026, the pharmacy: typing is quicker than a calendar): dd/mm/yyyy, with the
// slashes added while typing. PURE – used by components/DateText.jsx.

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → '13/11/2026' ('' for anything else). */
export function isoToTyped(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * What was typed → 'YYYY-MM-DD', or null when it is not a real date. Reads 13/11/2026, 13-11-2026, 13.11.2026,
 * 13112026, 1/2/2027, and a two-digit year (13/11/26 → 2026).
 */
export function typedToIso(text) {
  const t = String(text ?? '').trim();
  const m = /^(\d{1,2})\s*[/.\-\s]\s*(\d{1,2})\s*[/.\-\s]\s*(\d{2}|\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(t);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** While typing: '13' → '13/', '13/11' → '13/11/' (only when a digit was added – deleting is left alone). */
export function typingDate(next, before = '') {
  const v = String(next ?? '').replace(/[^\d/.\-]/g, '').slice(0, 10);
  if (v.length <= before.length) return v;
  if (/^\d{2}$/.test(v) || /^\d{1,2}[/.-]\d{2}$/.test(v)) return `${v}/`;
  return v;
}
