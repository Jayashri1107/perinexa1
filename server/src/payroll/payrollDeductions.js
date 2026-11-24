// Payroll, Stage C (docs/PAYROLL_BUILD_NOTE.md section 5 C): from a row of the salary sheet to the take-home –
// earnings by part, PF, ESI, professional tax, TDS, one-off lines and advance recoveries.
//
// THE RATES ARE LEGAL CONTENT. The figures below are the DRAFT table of section 8 of the note – "from general
// knowledge, not from the current government notifications". They exist so the accountant has something to correct.
// A group of rates (PF, ESI, professional tax) is DRAFT until the hospital admin has written the accountant's name
// and the date for it; a month worked out with a DRAFT rate may be looked at and printed as "DRAFT – not for
// payment", and can never be locked (routes/payrollRuns.js).
//
// Rules written here because a sum needs them and nobody has decided them yet – each a question for the accountant:
//   4. every part of the pay is reduced alike for unpaid days;
//   5. PF is worked out on the earned parts that count for PF – on no more than the pay limit when "limit" is on;
//   6. ESI is worked out on the earned parts that count for ESI; pay above the limit is only marked, not left out;
//   7. professional tax is looked up on the month's gross (earned pay plus one-off additions);
//   8. PF, ESI: each rounded to the nearest rupee; one-off additions count for neither;
//   9. deductions are taken in this order: PF, ESI, professional tax, TDS, one-off deductions, then advances – and
//      an advance recovery never takes the take-home below zero.
// No database, no requests: every function here is PURE.

export const RATE_GROUPS = ['pf', 'esi', 'pt'];
export const PT_SLABS = ['men', 'women'];
export const MAX_SLAB_ROWS = 8;

// DRAFT – section 8 of the note, Maharashtra assumed for professional tax. Never "confirmed" by code.
export const DRAFT_RATES = {
  pf: { staffPercent: 12, employerPercent: 12, limitPaise: 15000_00, capAtLimit: true },
  esi: { staffPercent: 0.75, employerPercent: 3.25, limitPaise: 21000_00 },
  pt: {
    // each row: gross up to this figure pays this amount; upToPaise null = everything above
    slabs: {
      men: [{ upToPaise: 7500_00, amountPaise: 0 }, { upToPaise: 10000_00, amountPaise: 175_00 }, { upToPaise: null, amountPaise: 200_00 }],
      women: [{ upToPaise: 25000_00, amountPaise: 0 }, { upToPaise: null, amountPaise: 200_00 }],
    },
    februaryPaise: 300_00, // the top slab's amount in February
  },
};

const date10 = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const whose = (g) => ({ status: g?.status === 'confirmed' && g?.confirmedBy && g?.confirmedOn ? 'confirmed' : 'draft', confirmedBy: g?.confirmedBy ?? '', confirmedOn: date10(g?.confirmedOn), from: date10(g?.from) });

const FIGURES = { pf: ['staffPercent', 'employerPercent', 'limitPaise', 'capAtLimit'], esi: ['staffPercent', 'employerPercent', 'limitPaise'] };
const slabsOf = (list, fallback) => (Array.isArray(list) && list.length ? list : fallback).map((s) => ({ upToPaise: s.upToPaise ?? null, amountPaise: s.amountPaise ?? 0 }));
/** One set of figures of a group as kept, with the DRAFT figures where one is missing and who confirmed it. */
function setOf(group, raw) {
  if (group === 'pt') {
    return { slabs: { men: slabsOf(raw?.slabs?.men, DRAFT_RATES.pt.slabs.men), women: slabsOf(raw?.slabs?.women, DRAFT_RATES.pt.slabs.women) }, februaryPaise: raw?.februaryPaise ?? DRAFT_RATES.pt.februaryPaise, ...whose(raw) };
  }
  return { ...DRAFT_RATES[group], ...pick(raw, FIGURES[group]), ...whose(raw) };
}
function pick(o, keys) {
  return Object.fromEntries(keys.filter((k) => o?.[k] !== undefined && o?.[k] !== null).map((k) => [k, o[k]]));
}

export const MAX_EARLIER = 20;
/**
 * The hospital's rate table: for each group the figures as last saved (the DRAFT figures where it never saved its
 * own), who confirmed them, and `earlier` – the sets confirmed before, each in force from its own date, oldest
 * first. A rate change never rewrites an old month: ratesFor picks the set in force in that month.
 */
export function ratesWithDefaults(rates) {
  const r = rates ?? {};
  return Object.fromEntries(
    RATE_GROUPS.map((g) => [
      g,
      {
        ...setOf(g, r[g]),
        updatedByName: r[g]?.updatedByName ?? '',
        updatedAt: r[g]?.updatedAt ?? null,
        earlier: (Array.isArray(r[g]?.earlier) ? r[g].earlier : []).map((e) => setOf(g, e)).filter((e) => e.status === 'confirmed' && e.from).sort((x, y) => x.from.localeCompare(y.from)),
      },
    ]),
  );
}

/**
 * The table for one month: for each group the confirmed figures in force in that month – the latest of the figures
 * as last saved and the earlier ones whose date is not after the month. Where none is: the figures as last saved,
 * which rateIsDraft then calls DRAFT. Figures typed but not confirmed are never used while confirmed ones are in force.
 */
export function ratesFor(table, month) {
  return Object.fromEntries(
    RATE_GROUPS.map((g) => {
      const { earlier = [], updatedByName, updatedAt, ...current } = table[g];
      const inForce = [...earlier, current].filter((s) => s.status === 'confirmed' && s.from && s.from.slice(0, 7) <= month);
      return [g, inForce.length ? inForce.reduce((best, s) => (s.from >= best.from ? s : best)) : current];
    }),
  );
}

/**
 * What is kept when a group is saved: { ...next, earlier }. before: the group as kept (with its earlier sets);
 * next: the figures as typed with status, confirmedBy, confirmedOn, from.
 *  - Figures confirmed before stay in force for their months – unless the new confirmation starts on the same day
 *    or before it (then it is a correction, and takes their place).
 *  - A new confirmation takes the place of every earlier set that starts on its day or later.
 */
export function nextRateGroup(before, next) {
  const { earlier = [], updatedByName, updatedAt, ...current } = before;
  let kept = next.status === 'confirmed' ? earlier.filter((e) => e.from < next.from) : earlier;
  if (current.status === 'confirmed' && !(next.status === 'confirmed' && next.from <= current.from)) kept = [...kept.filter((e) => e.from !== current.from), current];
  kept = kept.sort((x, y) => x.from.localeCompare(y.from)).slice(-MAX_EARLIER);
  return { ...next, earlier: kept };
}

/** Is a group of rates still DRAFT for a month? Not confirmed, or confirmed only from a later month on. */
export const rateIsDraft = (group, month) => group?.status !== 'confirmed' || Boolean(group.from && month < group.from.slice(0, 7));

/** What is wrong with a table of slabs as typed (the last row is "above", the others rise), or null. */
export function slabProblem(slabs) {
  if (!Array.isArray(slabs) || !slabs.length) return 'Write at least one row';
  if (slabs.length > MAX_SLAB_ROWS) return `At most ${MAX_SLAB_ROWS} rows`;
  if (slabs[slabs.length - 1].upToPaise != null) return 'The last row is for everything above: leave its “up to” empty';
  for (let i = 0; i < slabs.length - 1; i += 1) {
    if (slabs[i].upToPaise == null) return 'Only the last row may have an empty “up to”';
    if (i > 0 && slabs[i].upToPaise <= slabs[i - 1].upToPaise) return 'Each “up to” must be higher than the one before';
  }
  return null;
}

const rupee = (paise) => Math.round(paise / 100) * 100;

/** Each part of the monthly pay reduced alike for the paid days, in whole paise, adding up to the month's pay exactly. */
export function earnedParts(parts, monthlyPaise, grossPaise) {
  const list = (parts ?? []).filter((p) => p.amountPaise > 0);
  if (!list.length || !monthlyPaise || grossPaise == null) return [];
  const earned = list.map((p) => ({ key: p.key, amountPaise: Math.floor((p.amountPaise * grossPaise) / monthlyPaise) }));
  // what the rounding down left over goes on the largest part, so the parts add up to the pay for the month
  const left = grossPaise - earned.reduce((sum, p) => sum + p.amountPaise, 0);
  const biggest = earned.reduce((best, p, i) => (list[i].amountPaise > list[best].amountPaise ? i : best), 0);
  earned[biggest].amountPaise += left;
  return earned;
}

/** Professional tax for a month's gross by the slab table, or null when the person's slab is not known. */
export function professionalTax(grossPaise, slab, month, pt) {
  const rows = pt?.slabs?.[slab];
  if (!rows?.length) return null;
  const at = rows.findIndex((r) => r.upToPaise == null || grossPaise <= r.upToPaise);
  const row = rows[at < 0 ? rows.length - 1 : at];
  const top = at < 0 || at === rows.length - 1;
  return top && row.amountPaise > 0 && month.endsWith('-02') ? pt.februaryPaise : row.amountPaise;
}

/** What is still to be taken back of an advance: the amount given less what locked months took back. */
export const advanceBalance = (advance) => Math.max(0, (advance.amountPaise ?? 0) - (advance.recovered ?? []).reduce((sum, r) => sum + (r.amountPaise ?? 0), 0));

/**
 * The month's pay of one person, from their row of the salary sheet (payrollMath.js sheetRow).
 * staff: { ptSlab, pay entry flags via row.applies }; settings: the hospital's (parts with countsForPf / countsForEsi);
 * rates: ratesWithDefaults(...); tdsOverride: { tdsPaise } for this month or null; lines: one-off additions and
 * deductions [{ kind, label, amountPaise }]; advances: the person's open advances, oldest first, each
 * { id, instalmentPaise, balancePaise, thisMonthPaise? } (thisMonthPaise: the instalment changed for this month).
 * Returns null when the row has no pay for the month (no pay entered, or no days).
 * notes: 'ptSlabMissing', 'esiAboveLimit', 'overDeducted', 'advanceShort'.
 */
export function payOf({ row, applies, ptSlab, settings, rates, month, tdsPaise = 0, lines = [], advances = [] }) {
  if (row.payPaise == null) return null;
  const notes = [];
  const draftRates = [];
  const part = new Map((settings.parts ?? []).map((p) => [p.key, p]));
  const earned = earnedParts(row.parts, row.monthlyPaise, row.payPaise);
  const gross = row.payPaise;
  const additions = lines.filter((l) => l.kind === 'addition').reduce((sum, l) => sum + l.amountPaise, 0);
  const otherDeductions = lines.filter((l) => l.kind === 'deduction').reduce((sum, l) => sum + l.amountPaise, 0);
  const wages = (flag) => earned.filter((p) => part.get(p.key)?.[flag]).reduce((sum, p) => sum + p.amountPaise, 0);

  let pf = 0;
  let pfEmployer = 0;
  let pfWages = 0;
  if (applies.pf) {
    pfWages = wages('countsForPf');
    if (rates.pf.capAtLimit && pfWages > rates.pf.limitPaise) pfWages = rates.pf.limitPaise;
    pf = rupee((pfWages * rates.pf.staffPercent) / 100);
    pfEmployer = rupee((pfWages * rates.pf.employerPercent) / 100);
    if (rateIsDraft(rates.pf, month)) draftRates.push('pf');
  }
  let esi = 0;
  let esiEmployer = 0;
  let esiWages = 0;
  if (applies.esi) {
    esiWages = wages('countsForEsi');
    esi = rupee((esiWages * rates.esi.staffPercent) / 100);
    esiEmployer = rupee((esiWages * rates.esi.employerPercent) / 100);
    const fullMonth = (row.parts ?? []).filter((p) => part.get(p.key)?.countsForEsi).reduce((sum, p) => sum + p.amountPaise, 0);
    if (fullMonth > rates.esi.limitPaise) notes.push('esiAboveLimit');
    if (rateIsDraft(rates.esi, month)) draftRates.push('esi');
  }
  let pt = 0;
  if (applies.pt) {
    const tax = professionalTax(gross + additions, ptSlab, month, rates.pt);
    if (tax == null) notes.push('ptSlabMissing');
    else pt = tax;
    if (rateIsDraft(rates.pt, month)) draftRates.push('pt');
  }

  const before = gross + additions;
  const fixed = pf + esi + pt + tdsPaise + otherDeductions;
  if (fixed > before) notes.push('overDeducted');
  // Advances come last, and only from what is left
  let left = Math.max(0, before - fixed);
  const recoveries = [];
  for (const a of advances) {
    const due = Math.min(a.thisMonthPaise ?? a.instalmentPaise, a.balancePaise);
    const taken = Math.min(due, left);
    if (taken < due) notes.push('advanceShort');
    if (taken > 0) recoveries.push({ advanceId: a.id, amountPaise: taken });
    left -= taken;
  }
  const advancePaise = recoveries.reduce((sum, r) => sum + r.amountPaise, 0);
  return {
    earned,
    grossPaise: gross,
    additionsPaise: additions,
    lines: lines.map((l) => ({ kind: l.kind, label: l.label, amountPaise: l.amountPaise })),
    pfWagesPaise: pfWages,
    esiWagesPaise: esiWages,
    pfPaise: pf,
    pfEmployerPaise: pfEmployer,
    esiPaise: esi,
    esiEmployerPaise: esiEmployer,
    ptPaise: pt,
    tdsPaise,
    otherDeductionsPaise: otherDeductions,
    advancePaise,
    recoveries,
    deductionsPaise: fixed + advancePaise,
    takeHomePaise: Math.max(0, before - fixed - advancePaise),
    notes: [...new Set(notes)],
    draftRates,
  };
}

/** The totals of a month: each column of the sheet added up over the people who have a sum. */
export function monthTotals(rows) {
  const keys = ['grossPaise', 'additionsPaise', 'pfPaise', 'esiPaise', 'ptPaise', 'tdsPaise', 'otherDeductionsPaise', 'advancePaise', 'deductionsPaise', 'takeHomePaise', 'pfEmployerPaise', 'esiEmployerPaise'];
  const totals = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) if (r.pay) for (const k of keys) totals[k] += r.pay[k];
  return totals;
}
