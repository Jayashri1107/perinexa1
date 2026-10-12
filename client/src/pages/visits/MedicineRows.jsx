import { useState } from 'react';
import { ArrowDown, ArrowUp, History, PackageCheck, PackageMinus, PackageX, Plus, Trash2 } from 'lucide-react';
import { Field, StatusPill } from '../../components/ui.jsx';
import { findMedicine } from './medicines.js';
import {
  COUNTED_UNITS,
  DURATION_LABELS,
  FORM_NAMES,
  FREQUENCY_LABELS,
  ROUTE_LABELS,
  RX_DURATION_UNITS,
  RX_FORMS,
  RX_FREQUENCIES,
  RX_ROUTES,
  RX_TIMINGS,
  TIMING_LABELS,
  instructionLine,
  medicineName,
} from './rxFormat.js';
import { RX_FIELDS, isUsual, toItem, toRow } from './rxRows.js';
import { STOCK_STATUS } from './rxStock.js';

// The medicine rows of a prescription or a ready-made set (Feature 8 and 8b), in order. Quick to fill: names are
// suggested (datalist `names`), a listed medicine offers its usual strengths, and each row's title shows how it
// will print. With `usual` (the doctor's recent medicines by lower-case name), a row offers "Your usual".
// With `stockOf` (a visit's prescription, when the hospital keeps medicines in the Pharmacy module), a row shows
// whether the medicine is in the pharmacy – only when it could be matched with confidence.
// Errors come from fieldError(i, key).

const listId = (key) => `rx-strengths-${key}`;
const STOCK_ICONS = { in: PackageCheck, low: PackageMinus, out: PackageX };

/** "In the pharmacy" / "Not in stock" beside a medicine: colour + icon + word. */
function StockPill({ status }) {
  const s = STOCK_STATUS[status];
  if (!s) return null;
  return (
    <StatusPill tone={s.tone} icon={STOCK_ICONS[status]} title="From the hospital pharmacy’s stock list, matched by name and strength.">
      {s.word}
    </StatusPill>
  );
}

export function MedicineRows({ rows, setRows, fieldError, names, usual = null, stockOf = null }) {
  // Route and Instructions are used less often: folded per row until opened (always shown once filled in).
  const [extraOpen, setExtraOpen] = useState(() => new Set());
  const update = (i, changes) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...changes } : r)));
  const setField = (i, k) => (e) => {
    const value = e.target.value;
    if (k !== 'drug') return update(i, { [k]: value });
    // A listed medicine fills in its usual form when the row still has the default one and no strength.
    const listed = findMedicine(value);
    const r = rows[i];
    return update(i, { drug: value, ...(listed && !r.strength && r.form === 'tab' ? { form: listed.form } : {}) });
  };
  const applyUsual = (i) => {
    const m = usual?.get(rows[i].drug.trim().toLowerCase());
    if (m) update(i, { ...toRow(m), key: rows[i].key });
  };
  const move = (i, d) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i) => setRows((rs) => rs.filter((_, k) => k !== i));
  const fe = (i, k) => fieldError(i, k);

  return (
    <>
      <datalist id="rx-medicines">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {rows.map((r, i) => {
        const listed = findMedicine(r.drug);
        const mine = usual?.get(r.drug.trim().toLowerCase());
        const hasError = RX_FIELDS.some((k) => fe(i, k));
        const preview = r.drug.trim() && r.frequency ? `${medicineName(toItem(r))} – ${instructionLine(toItem(r))}` : '';
        return (
          <section key={r.key} className={`vs-rx-row ${hasError ? 'item-editor-error' : ''}`.trim()} aria-label={`Medicine ${i + 1}`}>
            <div className="item-editor-head">
              <span className="item-editor-title">
                <span className="item-editor-label">{i + 1}.</span>
                <span className="vs-rx-preview">{preview || 'New medicine'}</span>
                {stockOf && <StockPill status={stockOf(r)} />}
              </span>
              <div className="row">
                <button type="button" className="icon-btn" onClick={() => move(i, -1)} aria-label={`Move medicine ${i + 1} up`} disabled={i === 0}>
                  <ArrowUp aria-hidden="true" />
                </button>
                <button type="button" className="icon-btn" onClick={() => move(i, 1)} aria-label={`Move medicine ${i + 1} down`} disabled={i === rows.length - 1}>
                  <ArrowDown aria-hidden="true" />
                </button>
                <button type="button" className="icon-btn icon-danger" onClick={() => remove(i)} aria-label={`Remove medicine ${i + 1}`}>
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="vs-rx-grid">
              <div className="vs-span-2">
                <Field label="Medicine" id={`rx-drug-${r.key}`} error={fe(i, 'drug')}>
                  <input id={`rx-drug-${r.key}`} list="rx-medicines" autoComplete="off" maxLength={120} value={r.drug} onChange={setField(i, 'drug')} />
                </Field>
                {mine && !isUsual(r, mine) && (
                  <p className="hint vs-usual">
                    <History aria-hidden="true" /> Your usual: {instructionLine(mine)}{' '}
                    <button type="button" className="btn btn-link plan-inline-link" onClick={() => applyUsual(i)}>
                      Use it
                    </button>
                  </p>
                )}
              </div>
              <Field label="Form" id={`rx-form-${r.key}`} error={fe(i, 'form')}>
                <select id={`rx-form-${r.key}`} value={r.form} onChange={setField(i, 'form')}>
                  {RX_FORMS.map((f) => (
                    <option key={f} value={f}>
                      {FORM_NAMES[f]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Strength" id={`rx-strength-${r.key}`} error={fe(i, 'strength')}>
                <input id={`rx-strength-${r.key}`} list={listed?.strengths.length ? listId(r.key) : undefined} maxLength={40} value={r.strength} onChange={setField(i, 'strength')} />
              </Field>
              {listed?.strengths.length > 0 && (
                <datalist id={listId(r.key)}>
                  {listed.strengths.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              )}
              <Field label="Dose" id={`rx-dose-${r.key}`} error={fe(i, 'dose')} hint="e.g. 1, ½, 10 ml">
                <input id={`rx-dose-${r.key}`} maxLength={40} value={r.dose} onChange={setField(i, 'dose')} />
              </Field>
              <Field label="How often" id={`rx-freq-${r.key}`} error={fe(i, 'frequency')}>
                <select id={`rx-freq-${r.key}`} value={r.frequency} onChange={setField(i, 'frequency')}>
                  <option value="">Choose…</option>
                  {RX_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABELS[f]}
                    </option>
                  ))}
                </select>
              </Field>
              {r.frequency === 'custom' && (
                <Field label="How often (in words)" id={`rx-freqtext-${r.key}`} error={fe(i, 'frequencyText')}>
                  <input id={`rx-freqtext-${r.key}`} maxLength={60} value={r.frequencyText} onChange={setField(i, 'frequencyText')} />
                </Field>
              )}
              <Field label="When" id={`rx-timing-${r.key}`} error={fe(i, 'timing')}>
                <select id={`rx-timing-${r.key}`} value={r.timing} onChange={setField(i, 'timing')}>
                  {RX_TIMINGS.map((t) => (
                    <option key={t || '-'} value={t}>
                      {TIMING_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="field vs-duration">
                <span className="field-label" id={`rx-dur-label-${r.key}`}>
                  How long
                </span>
                <div className="vs-duration-inputs" role="group" aria-labelledby={`rx-dur-label-${r.key}`}>
                  <input
                    aria-label="Number"
                    inputMode="numeric"
                    value={r.durationValue}
                    disabled={!COUNTED_UNITS.includes(r.durationUnit) && r.durationUnit !== ''}
                    onChange={setField(i, 'durationValue')}
                    aria-invalid={Boolean(fe(i, 'durationValue'))}
                  />
                  <select
                    aria-label="Unit"
                    value={r.durationUnit}
                    onChange={(e) => update(i, { durationUnit: e.target.value, ...(COUNTED_UNITS.includes(e.target.value) || !e.target.value ? {} : { durationValue: '' }) })}
                    aria-invalid={Boolean(fe(i, 'durationUnit'))}
                  >
                    {RX_DURATION_UNITS.map((u) => (
                      <option key={u || '-'} value={u}>
                        {DURATION_LABELS[u]}
                      </option>
                    ))}
                  </select>
                </div>
                {(fe(i, 'durationValue') || fe(i, 'durationUnit')) && <p className="field-error">{fe(i, 'durationValue') || fe(i, 'durationUnit')}</p>}
              </div>
              {!(r.route || r.instructions || fe(i, 'route') || fe(i, 'instructions') || extraOpen.has(r.key)) ? (
                <div className="vs-span-2 vs-rx-more">
                  <button type="button" className="btn btn-link btn-sm" onClick={() => setExtraOpen((s) => new Set(s).add(r.key))}>
                    <Plus aria-hidden="true" /> Route or instructions
                  </button>
                </div>
              ) : (
                <>
              <Field label="Route" id={`rx-route-${r.key}`} error={fe(i, 'route')}>
                <select id={`rx-route-${r.key}`} value={r.route} onChange={setField(i, 'route')}>
                  {RX_ROUTES.map((x) => (
                    <option key={x || '-'} value={x}>
                      {ROUTE_LABELS[x]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="vs-span-2">
                <Field label="Instructions (optional)" id={`rx-instr-${r.key}`} error={fe(i, 'instructions')} hint="e.g. Not with milk or tea">
                  <input id={`rx-instr-${r.key}`} maxLength={200} value={r.instructions} onChange={setField(i, 'instructions')} />
                </Field>
              </div>
                </>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
