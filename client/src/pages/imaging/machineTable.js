// The average table of readings from the ultrasound machine (docs/USG_MACHINE_PLAN.md) – PURE.
// The same rule as the server's (server/src/imaging/machineReadings.js usedValue), which works the values out again
// when they are put in the report; here it only shows them while the sonologist ticks and chooses. DRAFT: the default
// (average of the ticked readings) is the owner's decision.

export const USE_WORDS = { average: 'Average', last: 'Last reading', machine: "Machine's own", reading: 'One reading' };

const decimalsOf = (unit) => (unit === 'g' || unit === 'bpm' ? 0 : 1);
const roundFor = (value, unit) => {
  const f = 10 ** decimalsOf(unit);
  return Math.round(value * f) / f;
};

/** The value a row puts in the report; null when nothing is left to use (every reading unticked). */
export function usedValue(row, { ticked = [], use = 'average', reading = 0 } = {}) {
  if (use === 'machine') return row.machine?.value ?? null;
  if (use === 'reading') return row.readings[reading] ?? null;
  if (!row.readings.length) return row.machine?.value ?? null;
  const on = row.readings.filter((_, i) => ticked[i] !== false);
  if (!on.length) return null;
  const v = use === 'last' ? on.at(-1) : on.reduce((a, b) => a + b, 0) / on.length;
  return roundFor(v, row.unit);
}

/** The rules a row can use: "Machine's own" only when the machine sent one, the others only with single readings. */
export function usesFor(row) {
  return Object.keys(USE_WORDS).filter((u) => (u === 'machine' ? row.machine != null : row.readings.length > 0));
}

/** The choices to start from: every reading ticked, the default rule (the machine's own value when that is all). */
export function startChoices(rows, defaultUse = 'average') {
  return Object.fromEntries(rows.map((r) => [r.key, { ticked: r.readings.map(() => true), use: r.readings.length ? defaultUse : 'machine', reading: 0, on: r.inTemplate !== false }]));
}
