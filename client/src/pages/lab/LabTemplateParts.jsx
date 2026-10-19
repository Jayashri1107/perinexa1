import { CALC_WORDS, calculate } from './labCalcs.js';
import { SENSITIVITY } from './labFormat.js';

// Parts of the result forms for the report templates (docs/LAB_TEMPLATES_PLAN.md): a value worked out from others
// (shown while typing; the server works it out again when saved), and the culture template's sensitivity table.

/** The typed numbers of one test in the form: { fieldKey: number } (worked-out values left out). */
export function typedNumbers(def, entry) {
  const out = {};
  for (const f of def?.fields ?? []) {
    const v = entry?.values?.[f.key];
    if (f.type === 'number' && v && v.value !== '' && !v.calculated) out[f.key] = Number(String(v.value).replace(/,/g, ''));
  }
  return out;
}

/** What a worked-out value comes to from what is typed now, or null. */
export const previewCalc = (f, def, entry) => (f.calc ? calculate(f.calc, typedNumbers(def, entry)) : null);

/** The hint under a worked-out value: the formula, and what it comes to now. */
export function calcHint(f, def, entry) {
  if (!f.calc) return null;
  const now = previewCalc(f, def, entry);
  return `Worked out if left empty (${CALC_WORDS[f.calc] ?? 'from the other values'})${now != null ? `: ${now}` : ''}`;
}

/** The sensitivity table (culture template): each antibiotic Sensitive, Intermediate or Resistant, and the zone. */
export function AntibioticTable({ idPrefix, rows, onChange, error }) {
  const set = (j, k, v) => onChange(rows.map((r, i) => (i === j ? { ...r, [k]: v } : r)));
  return (
    <div className="lab-abx">
      <table className="lab-values lab-abx-table">
        <caption>Sensitivity – leave an antibiotic empty if not tested</caption>
        <thead>
          <tr>
            <th scope="col">Antibiotic</th>
            <th scope="col">Result</th>
            <th scope="col">Zone (optional)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, j) => (
            <tr key={r.name}>
              <th scope="row">
                <label htmlFor={`${idPrefix}-abx-${j}`}>{r.name}</label>
              </th>
              <td>
                <select id={`${idPrefix}-abx-${j}`} value={r.result} onChange={(e) => set(j, 'result', e.target.value)}>
                  <option value="">Not tested</option>
                  {Object.entries(SENSITIVITY).map(([k, w]) => (
                    <option key={k} value={k}>
                      {w} ({k})
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input aria-label={`Zone for ${r.name}`} maxLength={20} value={r.zone} onChange={(e) => set(j, 'zone', e.target.value)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
