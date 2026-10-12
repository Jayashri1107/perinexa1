import { Field, formatDate } from '../../components/ui.jsx';
import {
  KEPT_RUPTURE_HINT,
  LOSS_FINDING_GROUPS,
  UNKNOWN_LOCATION_HINT,
  currentLossFindings,
  locationFlagsText,
  lossFindingByText,
  lossFindingLabel,
  lossFindingText,
  lossLocation,
  pastLossFindings,
  showsKeptRupture,
  shownLossFindings,
} from './abortionFormat.js';

// Findings of a pregnancy loss (the Abortion type of care): what was found on examination and on the scan, as
// fields with fixed answers – never free text, and nothing about the baby (PC-PNDT). Used in the Pregnancy loss
// section of the patient form, on the visit page and on the Overview. Each value is saved with who recorded it and
// when (the server writes that); a doctor or RMO changes it.

/**
 * The fields, grouped: Examination, Scan, and – for an ectopic pregnancy or one not yet located – signs of rupture.
 * - values: { os: 'open', crlMm: '7.5', … } as text ('' = not recorded); onChange(key, value) changes one
 * - seen: the values as the form opened (her record): "Signs of rupture: Yes" stays shown while it is there
 * - lossType: the type of loss chosen (the fields that do not fit it are not shown)
 * - entries: the record's current findings (who recorded each value, shown under a field while it is unchanged)
 * - rulesOn: whether the hospital's red-flag rules check pregnancy-loss care (abortionFormat.js lossRulesOn)
 * - fe(key): the message for a field, if any; idPrefix: for the fields' ids (two sets may be on one page)
 */
export function LossFindingFields({ values, onChange, lossType, seen = null, entries = [], rulesOn = null, fe = () => undefined, idPrefix = 'lf', disabled = false }) {
  const shown = shownLossFindings(lossType, values, seen);
  const stored = Object.fromEntries(entries.map((f) => [f.key, f]));
  const groups = Object.entries(LOSS_FINDING_GROUPS)
    .map(([key, title]) => ({ key, title, fields: shown.filter((f) => f.group === key) }))
    .filter((g) => g.fields.length);
  // Who recorded the value on the record – only while the field still shows that value
  const recordedBy = (f) => {
    const entry = stored[f.key];
    return entry && String(entry.value) === String(values[f.key] ?? '').trim().replace(',', '.') ? `Recorded by ${lossFindingByText(entry, formatDate)}` : undefined;
  };
  const unknownLocation = lossLocation(lossType || null, values.sacSeen || null, values.productsSeen || null) === 'unknown';
  const keptRupture = showsKeptRupture(lossType, values, seen);

  return (
    <>
      {groups.map((g) => (
        <fieldset key={g.key} className="fieldset lf-group">
          <legend>{g.title}</legend>
          <div className="form-grid">
            {g.fields.map((f) => {
              const id = `${idPrefix}-${f.key}`;
              return (
                <Field key={f.key} label={f.type === 'number' ? `${f.label} (${f.unit})` : f.label} id={id} error={fe(f.key)} hint={recordedBy(f)} keepHint>
                  {f.type === 'number' ? (
                    <input id={id} className="tabular" inputMode="decimal" value={values[f.key] ?? ''} onChange={(e) => onChange(f.key, e.target.value)} maxLength={5} disabled={disabled} />
                  ) : (
                    <select id={id} value={values[f.key] ?? ''} onChange={(e) => onChange(f.key, e.target.value)} disabled={disabled}>
                      <option value="">Not recorded</option>
                      {Object.entries(f.choices).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              );
            })}
          </div>
          {g.key === 'scan' && unknownLocation && <p className="hint">{[UNKNOWN_LOCATION_HINT, locationFlagsText(rulesOn)].filter(Boolean).join(' ')}</p>}
          {g.key === 'ectopic' && keptRupture && <p className="hint">{KEPT_RUPTURE_HINT}</p>}
        </fieldset>
      ))}
    </>
  );
}

/**
 * The findings on the record, read-only: each with its value, who recorded it and when; the earlier values under
 * "Earlier entries". Nothing when none was ever recorded.
 */
export function LossFindingsList({ abortion }) {
  const now = currentLossFindings(abortion);
  const past = pastLossFindings(abortion, formatDate);
  if (!now.length && !past.length) return null;
  return (
    <>
      {now.length ? (
        <ul className="plain-list pf-finding-list">
          {now.map((f) => (
            <li key={f.key}>
              <span className="reason-label">
                {lossFindingLabel(f.key)}: {lossFindingText(f.key, f.value)}
              </span>
              <span className="muted"> – {lossFindingByText(f, formatDate)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted pf-finding-none">None recorded now.</p>
      )}
      {past.length > 0 && (
        <details className="override-history">
          <summary>Earlier entries ({past.length})</summary>
          <ul>
            {past.map((f, i) => (
              <li key={i}>
                <span className="reason-label">{f.label}</span> <span className="muted">– {f.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
