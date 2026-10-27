import { Field } from '../../components/ui.jsx';
import { DIAGNOSIS_LABELS, FERTILITY_CHOICES, FERTILITY_NUMBER_FIELDS, FERTILITY_TEXT_FIELDS } from './fertilityFormat.js';

/**
 * The "Fertility history" section of the patient form (the Infertility type of care; docs/FERTILITY_PLAN.md): the kind
 * and duration of infertility, cycles and ovulation, tubes, uterus, endometriosis, the partner's semen, diagnoses
 * already made, ovarian reserve and other numbers, and previous treatment. The Treatment plan tab reads these to
 * suggest protocols; every field may stay empty ("not recorded").
 * - values: fertilityValues(…); set(key, value) changes one; fe(path): the server's message for a field
 */
export function FertilitySection({ values: f, set, fe }) {
  const on = (key) => (e) => set(key, e.target.value);
  const toggle = (d) => set('diagnoses', f.diagnoses.includes(d) ? f.diagnoses.filter((x) => x !== d) : [...f.diagnoses, d]);
  const numbers = (keys) => FERTILITY_NUMBER_FIELDS.filter((n) => keys.includes(n.key));
  const numberField = (n) => (
    <Field key={n.key} label={n.label} id={`fert-${n.key}`} error={fe(`fertility.${n.key}`)}>
      <input id={`fert-${n.key}`} inputMode={n.integer ? 'numeric' : 'decimal'} value={f[n.key]} onChange={on(n.key)} maxLength={6} />
    </Field>
  );
  return (
    <section className="card form-section" aria-labelledby="pf-fertility">
      <h2 id="pf-fertility">Fertility history</h2>
      <p className="hint">What the Treatment plan tab reads to suggest protocols. Leave a field empty when it is not known yet; "Not tested yet" says the test is still to come.</p>
      <div className="form-grid">
        {FERTILITY_CHOICES.slice(0, 3).map((c) => (
          <Field key={c.key} label={c.label} id={`fert-${c.key}`} error={fe(`fertility.${c.key}`)}>
            <select id={`fert-${c.key}`} value={f[c.key]} onChange={on(c.key)}>
              <option value="">Not recorded</option>
              {Object.entries(c.labels).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        ))}
        {numbers(['durationMonths', 'partnerAgeYears', 'cycleLengthDays']).map(numberField)}
      </div>
      <div className="form-grid">
        {FERTILITY_CHOICES.slice(3).map((c) => (
          <Field key={c.key} label={c.label} id={`fert-${c.key}`} error={fe(`fertility.${c.key}`)}>
            <select id={`fert-${c.key}`} value={f[c.key]} onChange={on(c.key)}>
              <option value="">Not recorded</option>
              {Object.entries(c.labels).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      <fieldset className="fieldset">
        <legend>Diagnoses already made</legend>
        <div className="check-grid">
          {Object.entries(DIAGNOSIS_LABELS).map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={f.diagnoses.includes(k)} onChange={() => toggle(k)} /> {label}
            </label>
          ))}
        </div>
        <p className="hint">Thyroid disease, diabetes and tuberculosis are ticked under Medical background; the suggestions read them from there.</p>
      </fieldset>
      <fieldset className="fieldset">
        <legend>Ovarian reserve and hormones (optional)</legend>
        <div className="form-grid form-grid-5">{numbers(['amh', 'afc', 'fsh', 'prolactin', 'tsh']).map(numberField)}</div>
      </fieldset>
      <fieldset className="fieldset">
        <legend>Treatment so far</legend>
        <div className="form-grid">{numbers(['oiCycles', 'iuiCycles', 'ivfCycles']).map(numberField)}</div>
        {FERTILITY_TEXT_FIELDS.map((t) => (
          <Field key={t.key} label={t.label} id={`fert-${t.key}`} error={fe(`fertility.${t.key}`)} hint={t.hint || undefined}>
            {t.key === 'semenDetail' ? (
              <input id={`fert-${t.key}`} value={f[t.key]} onChange={on(t.key)} maxLength={t.max} />
            ) : (
              <textarea id={`fert-${t.key}`} rows={2} value={f[t.key]} onChange={on(t.key)} maxLength={t.max} />
            )}
          </Field>
        ))}
      </fieldset>
    </section>
  );
}
