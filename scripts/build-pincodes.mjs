// Builds a compact PIN code → district and state file from India Post's All India Pincode Directory (data.gov.in).
// Usage: node scripts/build-pincodes.mjs <pincode.csv> client/public/pincodes.json
// Source CSV: data.gov.in "All India Pincode Directory" (mirrored at github.com/dropdevrahul/pincodes-india, pincode.csv).
// Built 27 Oct 2026 for the PIN code → city and state fill on the patient form (owner's choice: a list inside Perinexa).
import { readFileSync, writeFileSync } from 'node:fs';
const [, , src, out] = process.argv;
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
const ALIAS = { 'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU': 'Dadra and Nagar Haveli and Daman and Diu', 'DADRA AND NAGAR HAVELI': 'Dadra and Nagar Haveli and Daman and Diu', 'DAMAN AND DIU': 'Dadra and Nagar Haveli and Daman and Diu', PONDICHERRY: 'Puducherry', ORISSA: 'Odisha', 'ANDAMAN & NICOBAR ISLANDS': 'Andaman and Nicobar Islands', 'NCT OF DELHI': 'Delhi' };
const byUpper = Object.fromEntries(STATES.map((s) => [s.toUpperCase(), s]));
function parseLine(line) {
  const cells = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { cells.push(cur); cur = ''; } else cur += c;
  }
  cells.push(cur); return cells;
}
const title = (t) => t.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bAnd\b/g, 'and').trim();
const lines = readFileSync(src, 'utf8').split(/\r?\n/).filter(Boolean);
const head = parseLine(lines[0]);
const iPin = head.indexOf('Pincode'), iDist = head.indexOf('District'), iState = head.indexOf('StateName');
const per = new Map(); const unknown = new Map(); let bad = 0;
for (const line of lines.slice(1)) {
  const c = parseLine(line);
  const pin = c[iPin]?.trim(); const st = c[iState]?.trim().toUpperCase(); const dist = c[iDist]?.trim();
  if (!/^[1-9]\d{5}$/.test(pin ?? '') || !dist) { bad++; continue; }
  const state = byUpper[st] ?? ALIAS[st];
  if (!state) { unknown.set(st, (unknown.get(st) ?? 0) + 1); continue; }
  const key = `${title(dist)}|${state}`;
  const m = per.get(pin) ?? new Map(); m.set(key, (m.get(key) ?? 0) + 1); per.set(pin, m);
}
// One district and state per PIN: the one most of its post offices give
const districts = []; const dIndex = new Map(); const pins = {};
for (const [pin, m] of [...per].sort()) {
  const key = [...m].sort((a, b) => b[1] - a[1])[0][0];
  if (!dIndex.has(key)) { const [d, s] = key.split('|'); dIndex.set(key, districts.length); districts.push([d, STATES.indexOf(s)]); }
  pins[pin] = dIndex.get(key);
}
writeFileSync(out, JSON.stringify({ source: 'India Post, All India Pincode Directory (data.gov.in, GODL-India)', states: STATES, districts, pins }));
console.log({ pins: Object.keys(pins).length, districts: districts.length, bad, unknownStates: Object.fromEntries(unknown) });
