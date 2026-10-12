import { Droplet } from 'lucide-react';
import { Alert, Field, StatusPill, formatDate } from '../../components/ui.jsx';
import { mentionsFetalSex, PCPNDT_MESSAGE } from '../../pcpndtWords.js';
import {
  ANOTHER_LOSS_HINT,
  ANTI_D,
  CHANGE_FROM_ANTENATAL,
  DRAFT_NOTE,
  ECTOPIC_SITES,
  HISTOLOGY,
  LOSS_FINDINGS,
  LOSS_FINDINGS_HINT,
  LOSS_HELP,
  LOSS_LABELS,
  LOSS_TYPES,
  MANAGEMENT,
  MAX_WEEKS,
  MOLAR_HINT,
  MOLE_KINDS,
  OUTCOME_LABELS,
  OUTCOMES,
  RETIRED_LOSS_MESSAGE,
  THREATENED_HINT,
  anotherLoss,
  anyLossFinding,
  blankLossFindings,
  dateSeenHint,
  gaFrom,
  gaText,
  isRetiredLoss,
  lateHint,
  lossFindingValues,
  lossFindingsPayload,
  lossFlagsText,
  managementChoices,
  presentationWeeks,
  showsPregnancyFields,
  validMm,
} from './abortionFormat.js';
import { LossFindingFields } from './LossFindings.jsx';
import { isRhNegative, toDateInput } from './patientFormat.js';

// The hospital's date in this browser, "2026-10-12" (the form's default for the date seen).
export function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The form's values for the pregnancy-loss section, as text (from a stored record, or empty with today as the date seen). */
export function abortionValues(a) {
  const s = (x) => (x == null ? '' : String(x));
  return {
    lossType: a?.lossType ?? '',
    lmp: toDateInput(a?.lmp),
    presentedOn: toDateInput(a?.presentedOn) || localToday(),
    weeks: a?.lmp ? '' : s(a?.weeks),
    days: a?.lmp ? '' : s(a?.days),
    ectopicSite: a?.ectopicSite ?? '',
    moleKind: a?.moleKind ?? '',
    method: a?.management?.method ?? '',
    managedOn: toDateInput(a?.management?.on),
    outcome: a?.management?.outcome ?? '',
    histologyStatus: a?.histology?.status ?? '',
    histologyResult: a?.histology?.result ?? '',
    antiD: a?.antiD?.status ?? '',
    antiDOn: toDateInput(a?.antiD?.on),
    note: a?.note ?? '',
    // The findings as fields ({ os: 'open', crlMm: '7.5', … }, '' = not recorded). findingsSeen: the values as this
    // form opened – sent with the changes, so a finding a colleague records meanwhile is not put back by this form.
    findings: lossFindingValues(a),
    findingsSeen: lossFindingValues(a),
  };
}

/** True when nothing has been entered in the section (the date seen alone does not count). */
export const abortionEmpty = (v) =>
  Object.entries(v).every(([k, x]) => k === 'presentedOn' || k === 'findingsSeen' || (k === 'findings' ? !anyLossFinding(x) : !String(x ?? '').trim()));

/** What is sent to the server: the whole section (it replaces the stored one). */
export function abortionPayload(v) {
  return {
    lossType: v.lossType,
    lmp: v.lmp,
    presentedOn: v.presentedOn,
    weeks: v.lmp ? '' : v.weeks,
    days: v.lmp ? '' : v.days,
    ectopicSite: v.ectopicSite,
    moleKind: v.moleKind,
    management: { method: v.method, on: v.managedOn, outcome: v.outcome },
    histology: { status: v.histologyStatus, result: v.histologyResult },
    antiD: { status: v.antiD, on: v.antiDOn },
    note: v.note,
    // Only the findings the form shows for this type of loss; the server writes what was changed, with who and when
    findings: lossFindingsPayload(v.findings, v.lossType, v.findingsSeen),
    findingsSeen: v.findingsSeen ?? {},
  };
}

/** Problems the website can show before saving (the server checks the same and more): text about the baby's sex. */
export function abortionTextErrors(v) {
  const out = {};
  if (mentionsFetalSex(v.note)) out['abortion.note'] = PCPNDT_MESSAGE;
  if (mentionsFetalSex(v.histologyResult)) out['abortion.histology.result'] = PCPNDT_MESSAGE;
  return out;
}

/** A scan measurement that is not a number of millimetres (the server's own words), by the field's path. */
export function abortionFindingErrors(v) {
  const out = {};
  for (const f of LOSS_FINDINGS) {
    if (f.type === 'number' && !validMm(v.findings?.[f.key])) out[`abortion.findings.${f.key}`] = `${f.label} must be a number of ${f.unit}, for example 7 or 7.5`;
  }
  return out;
}

/**
 * The "Pregnancy loss" section of the patient form (the Abortion type of care): the type of loss, dates and weeks,
 * site or kind of mole, management, anti-D and a note. Only pregnancy loss that was not induced is recorded.
 * - values: abortionValues(…); set(key, value) changes one; bloodGroup: the medical background's blood group
 * - fe(path): the server's message for a field; vc / vm: the "From voice" class and mark
 * - fromAntenatal: the record is being changed from antenatal (her antenatal plan will be paused)
 * - storedSeen: the stored date seen ("2026-10-01"), used while the date box is empty
 * - storedFindings: the findings on the record now (who recorded each value – shown under its field)
 * - rulesOn: whether the hospital's red-flag rules check pregnancy-loss care (abortionFormat.js lossRulesOn)
 * A date seen more than 8 weeks from the stored one is another loss (anotherLoss): the findings start empty – the
 * server ends those of the earlier loss when it is saved – and come back if the date is moved back.
 */
export function AbortionSection({ values: a, set, bloodGroup, fe, vc, vm, fromAntenatal, storedSeen, storedFindings = [], rulesOn = null }) {
  const on = (key) => (e) => set(key, e.target.value);
  const newLoss = anotherLoss(storedSeen, a.presentedOn);
  const onSeen = (e) => {
    const value = e.target.value;
    set('presentedOn', value);
    const before = anotherLoss(storedSeen, a.presentedOn);
    const after = anotherLoss(storedSeen, value);
    if (after === before) return;
    const values = after ? blankLossFindings() : lossFindingValues({ findings: storedFindings });
    set('findings', values);
    set('findingsSeen', values);
  };
  const pregnant = showsPregnancyFields(a.lossType);
  // An emptied date seen keeps the stored one when saved (the server), so the weeks are counted to it too.
  const seen = a.presentedOn || storedSeen || localToday();
  const fromLmp = a.lmp ? gaFrom(a.lmp, seen) : null;
  const weeks = presentationWeeks(a, seen);
  // A stored value no longer offered (a record saved before 3 Oct 2026: threatened miscarriage, "medicines",
  // "pregnancy continuing") is still shown as chosen, so nothing changes without the doctor seeing it.
  const retired = isRetiredLoss(a.lossType);
  const keepShown = (list, value, labels) => (value && !list.some(([k]) => k === value) ? [...list, [value, labels[value] ?? value]] : list);
  const choices = keepShown(managementChoices(a.lossType), a.method, MANAGEMENT);
  const outcomes = keepShown(Object.entries(OUTCOMES), a.outcome, OUTCOME_LABELS);
  const today = localToday();
  const late = pregnant ? lateHint(weeks) : null;

  return (
    <section className="card form-section">
      <h2>Pregnancy loss</h2>
      <p className="hint">Only pregnancy loss that was not induced. {THREATENED_HINT} {DRAFT_NOTE}</p>
      {fromAntenatal && <Alert type="warning">{CHANGE_FROM_ANTENATAL}</Alert>}
      {retired && <Alert type="warning">{RETIRED_LOSS_MESSAGE}</Alert>}
      <div className="form-grid">
        <Field label="Type of loss" id="ab-lossType" error={fe('abortion.lossType')} hint={LOSS_HELP[a.lossType]} keepHint>
          <select id="ab-lossType" className={vc('abortion.lossType')} value={a.lossType} onChange={on('lossType')}>
            <option value="">Choose…</option>
            {LOSS_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
            {retired && (
              <option value={a.lossType} disabled>
                {LOSS_LABELS[a.lossType]}
              </option>
            )}
          </select>
          {vm('abortion.lossType')}
        </Field>
        <Field label="Date seen" id="ab-presentedOn" error={fe('abortion.presentedOn')} hint={`${a.presentedOn ? `${formatDate(a.presentedOn)}. ` : ''}${dateSeenHint(a.lossType)}`} keepHint>
          <input id="ab-presentedOn" type="date" value={a.presentedOn} onChange={onSeen} max={today} />
        </Field>
      </div>
      {newLoss && <Alert type="warning">{ANOTHER_LOSS_HINT}</Alert>}
      {pregnant && (
        <>
          <div className="form-grid">
            <Field label="LMP (last menstrual period)" id="ab-lmp" error={fe('abortion.lmp')} hint={a.lmp ? formatDate(a.lmp) : 'If not known, enter the weeks below.'} keepHint>
              <input id="ab-lmp" className={vc('abortion.lmp')} type="date" value={a.lmp} onChange={on('lmp')} max={seen} />
              {vm('abortion.lmp')}
            </Field>
            {a.lmp ? (
              <div className="field">
                <span className="field-label">Weeks at presentation</span>
                <p className="calc-row" aria-live="polite">
                  <strong>{gaText(a.lmp, seen) ?? '—'}</strong>
                  <span className="muted"> (from the LMP)</span>
                </p>
              </div>
            ) : (
              <>
                <Field label="Weeks at presentation" id="ab-weeks" error={fe('abortion.weeks')} hint={`0 to ${MAX_WEEKS}`} keepHint>
                  <input id="ab-weeks" className={vc('abortion.weeks')} inputMode="numeric" value={a.weeks} onChange={on('weeks')} maxLength={2} />
                  {vm('abortion.weeks')}
                </Field>
                <Field label="Days" id="ab-days" error={fe('abortion.days')} hint="0 to 6" keepHint>
                  <input id="ab-days" inputMode="numeric" value={a.days} onChange={on('days')} maxLength={1} />
                </Field>
              </>
            )}
          </div>
          {late && <Alert type="warning">{late}</Alert>}
        </>
      )}

      {a.lossType === 'ectopic' && (
        <div className="form-grid">
          <Field label="Site" id="ab-site" error={fe('abortion.ectopicSite')}>
            <select id="ab-site" value={a.ectopicSite} onChange={on('ectopicSite')}>
              <option value="">Choose…</option>
              {Object.entries(ECTOPIC_SITES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {a.lossType === 'molar' && (
        <>
          <div className="form-grid">
            <Field label="Kind of mole" id="ab-mole" error={fe('abortion.moleKind')}>
              <select id="ab-mole" value={a.moleKind} onChange={on('moleKind')}>
                <option value="">Choose…</option>
                {Object.entries(MOLE_KINDS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Histology" id="ab-histology" error={fe('abortion.histology.status')}>
              <select id="ab-histology" value={a.histologyStatus} onChange={on('histologyStatus')}>
                <option value="">Choose…</option>
                {Object.entries(HISTOLOGY).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Histology result (optional)" id="ab-histology-result" error={fe('abortion.histology.result')}>
              <input id="ab-histology-result" value={a.histologyResult} onChange={on('histologyResult')} maxLength={300} />
            </Field>
          </div>
          <p className="hint">{MOLAR_HINT}</p>
        </>
      )}

      <div className="form-grid">
        <Field label="Management" id="ab-method" error={fe('abortion.management.method')} hint={a.lossType ? undefined : 'Choose the type of loss first.'}>
          <select id="ab-method" value={a.method} onChange={on('method')} disabled={!a.lossType}>
            <option value="">Not decided yet</option>
            {choices.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {pregnant && (
          <Field label="Date of management" id="ab-managedOn" error={fe('abortion.management.on')}>
            <input id="ab-managedOn" type="date" value={a.managedOn} onChange={on('managedOn')} min={a.lmp || undefined} max={today} />
          </Field>
        )}
        <Field label="Outcome" id="ab-outcome" error={fe('abortion.management.outcome')}>
          <select id="ab-outcome" value={a.outcome} onChange={on('outcome')}>
            <option value="">Not known yet</option>
            {outcomes.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {pregnant && (
        <>
          <div className="form-grid">
            <Field label="Anti-D" id="ab-antiD" error={fe('abortion.antiD.status')}>
              <select id="ab-antiD" value={a.antiD} onChange={on('antiD')}>
                <option value="">Not recorded</option>
                {Object.entries(ANTI_D).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {a.antiD === 'given' && (
              <Field label="Anti-D given on" id="ab-antiDOn" error={fe('abortion.antiD.on')}>
                <input id="ab-antiDOn" type="date" value={a.antiDOn} onChange={on('antiDOn')} max={today} />
              </Field>
            )}
          </div>
          <p className="hint">
            {isRhNegative(bloodGroup) ? (
              <StatusPill tone="watch" icon={Droplet}>
                Rh negative
              </StatusPill>
            ) : null}{' '}
            {isRhNegative(bloodGroup) ? 'Blood group is Rh negative – anti-D given?' : bloodGroup ? `Blood group ${bloodGroup}.` : 'Blood group not recorded – see Medical background below.'}
          </p>
        </>
      )}

      {pregnant && a.lossType && !retired && (
        <div className="lf-block">
          <h3>Findings</h3>
          <p className="hint">
            {LOSS_FINDINGS_HINT} {lossFlagsText(rulesOn)}
          </p>
          <LossFindingFields
            values={a.findings ?? {}}
            onChange={(key, value) => set('findings', { ...a.findings, [key]: value })}
            lossType={a.lossType}
            seen={a.findingsSeen}
            rulesOn={rulesOn}
            entries={newLoss ? [] : storedFindings}
            fe={(key) => fe(`abortion.findings.${key}`)}
            idPrefix="ab-f"
          />
        </div>
      )}

      <Field label="Note (optional)" id="ab-note" error={fe('abortion.note')} hint="Anything the fields above do not cover, and how she is now. Never the baby's sex." keepHint>
        <textarea id="ab-note" rows={2} value={a.note} onChange={on('note')} maxLength={500} />
      </Field>
    </section>
  );
}
