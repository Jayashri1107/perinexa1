import { useState } from 'react';
import { ShieldAlert, Sparkles, TriangleAlert, UserPen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, ConfirmDialog, Field, FieldError, StatusPill, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { CONDITION_LABELS, PAST_COMPLICATION_LABELS } from './patientFormat.js';
import { NOT_CHECKED_YET, RISK_HINTS, RISK_LABELS, RISK_STATUS, findingsNotCheckedText, noReasonText, notMeasuredText, readingsNotCheckedText } from './riskFormat.js';

const OVERRIDE_CHOICES = ['high', 'moderate', 'low'];

/**
 * Risk badge: a status pill with colour, icon and word (e.g. "High-risk"). Pass `risk` (the patient's risk object)
 * to show the extra markers wherever the level appears: "May be higher" (information missing), "Override" (set by a
 * doctor), "Review override" (the automatic result has changed since the override) and "Draft rules" (not
 * doctor-approved). Pass just `level` for a plain badge (e.g. a rule's level).
 */
export function RiskBadge({ level, risk, large = false }) {
  const shown = risk ? risk.level : level;
  if (!shown) return null;
  const status = RISK_STATUS[shown] ?? { tone: 'neutral', icon: null, label: RISK_LABELS[shown] ?? shown };
  const draft = risk && !risk.templateApproved && !risk.override;
  const title = [
    RISK_LABELS[shown],
    risk?.override && `Set by ${risk.override.byName} (automatic: ${RISK_LABELS[risk.computedLevel]})`,
    risk?.overrideNeedsReview && 'The automatic result has changed since this override – please review',
    draft && 'Based on draft risk rules that no doctor has approved yet – use only as a reminder',
    risk?.mayBeHigher && 'Some information is missing – the risk may be higher',
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <span className="risk-badge-wrap" title={title}>
      <StatusPill tone={status.tone} icon={status.icon} large={large}>
        {status.label}
      </StatusPill>
      {risk?.mayBeHigher && (
        <StatusPill tone="watch" className="risk-marker">
          May be higher
        </StatusPill>
      )}
      {risk?.override && (
        <StatusPill tone="neutral" icon={UserPen} className="risk-marker">
          Override
        </StatusPill>
      )}
      {risk?.overrideNeedsReview && (
        <StatusPill tone="watch" className="risk-marker">
          Review override
        </StatusPill>
      )}
      {draft && (
        <StatusPill tone="watch" className="risk-marker">
          Draft rules
        </StatusPill>
      )}
    </span>
  );
}

function OverrideDialog({ patient, onDone, onCancel }) {
  const current = patient.risk.override;
  const computed = patient.risk.computedLevel;
  // Start from the current override, or the automatic level – but never pre-select for an incomplete result.
  const [level, setLevel] = useState(current?.level ?? (OVERRIDE_CHOICES.includes(computed) ? computed : null));
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await api(`/patients/${patient.id}/risk-override`, { method: 'PUT', body: { level, reason } });
      onDone(res.patient);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
      setSaving(false);
    }
  };

  const dialogRef = useDialogFocus(onCancel);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={dialogRef} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="ov-title" onSubmit={save} noValidate>
        <h2 id="ov-title">{current ? 'Change your override' : 'Override the risk level'}</h2>
        <p className="hint">
          The automatic result is <strong>{RISK_LABELS[computed]}</strong>. Your decision will be shown instead, with your name and reason, and kept in
          the record's override history. The automatic result stays visible underneath.
        </p>
        <Alert type="error">{error}</Alert>
        <fieldset className="fieldset">
          <legend>Risk level to use</legend>
          <div className="risk-choice">
            {OVERRIDE_CHOICES.map((l) => (
              <label key={l} className={`risk-option ${level === l ? 'checked' : ''}`}>
                <input type="radio" name="ov-level" value={l} checked={level === l} onChange={() => setLevel(l)} />
                <RiskBadge level={l} />
              </label>
            ))}
          </div>
          <FieldError>{fieldErrors.level}</FieldError>
        </fieldset>
        <Field label="Reason" id="ov-reason" error={fieldErrors.reason} hint='e.g. "Twin pregnancy on scan" or "Thyroid disease well controlled, reviewed by physician"'>
          <textarea id="ov-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
        </Field>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving || !level}>
            {saving ? 'Saving…' : 'Save override'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * "Check typed text with AI" (Smart features, step 7): conditions and previous-pregnancy problems that were
 * typed as free text (other conditions, notes, visit notes) are read by AI and offered as risk factors. Each
 * one is added to the record only when the doctor clicks Add; the risk level is then worked out again.
 */
function AiRiskCheck({ patient, onChanged }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api(`/patients/${patient.id}/ai/risk-suggestions`, { method: 'POST' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const add = async (s) => {
    setBusy(true);
    setError(null);
    try {
      const body =
        s.kind === 'condition'
          ? { medical: { conditions: [...new Set([...(patient.medical?.conditions ?? []), s.code])] } }
          : { obstetric: { pastComplications: [...new Set([...(patient.obstetric?.pastComplications ?? []), s.code])] } };
      const res = await api(`/patients/${patient.id}`, { method: 'PATCH', body });
      const label = s.kind === 'condition' ? CONDITION_LABELS[s.code] : PAST_COMPLICATION_LABELS[s.code];
      onChanged(res.patient, `“${label}” added to the record – the risk level was checked again.`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="ai-risk">
      <Alert type="error">{error}</Alert>
      {!result ? (
        <button type="button" className="btn btn-link" onClick={run} disabled={busy}>
          <Sparkles aria-hidden="true" /> {busy ? 'Reading the typed notes…' : 'Check the typed notes with AI'}
        </button>
      ) : result.suggestions.length === 0 ? (
        <p className="hint">AI found no further risk factors in the typed notes.</p>
      ) : (
        <ul className="ai-risk-list">
          {result.suggestions.map((s) => (
            <li key={s.code}>
              <span>
                <strong>{s.kind === 'condition' ? CONDITION_LABELS[s.code] : `Previous pregnancy: ${PAST_COMPLICATION_LABELS[s.code]}`}</strong>
                <span className="muted"> – typed as “{s.quote}”</span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => add(s)} disabled={busy}>
                Add to the record
              </button>
            </li>
          ))}
        </ul>
      )}
      {result && <p className="hint">Suggested by AI (OpenAI) from the typed notes only – nothing is added until you click Add.</p>}
    </div>
  );
}

/** Risk level card for an antenatal patient (only shown to people who can see medical details). */
export function RiskCard({ patient, onChanged }) {
  const r = patient.risk;
  const [dialog, setDialog] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!r || !r.level) return null;

  const ov = r.override;
  const canOverride = patient.access.canOverrideRisk;
  const newReasons = ov?.reasonKeysAtOverride ? r.reasons.filter((x) => !ov.reasonKeysAtOverride.includes(x.key)) : [];
  const history = patient.riskOverrideHistory ?? [];
  const notMeasured = notMeasuredText(r); // readings of this pregnancy that a rule needs and nobody has measured yet
  const notChecked = findingsNotCheckedText(r); // findings ticked that the hospital's rules have no rule for
  const readingsNotChecked = readingsNotCheckedText(r, patient.pregnancy?.readings); // readings recorded that they have no rule for

  // Runs after the person confirms in the dialog.
  const removeOverride = async () => {
    setConfirmRemove(false);
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/patients/${patient.id}/risk-override`, { method: 'DELETE' });
      onChanged(res.patient, 'Override removed – the automatic risk level is used again.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // On view: the level, why (the reasons), what is still to record, and anything that needs a doctor now.
  // Explanations, rule details, the override record and its history are under "More details".
  return (
    <section className={`card card-wide risk-card risk-border-${r.level}`} aria-labelledby="risk-card-title">
      <div className="risk-head">
        <h2 id="risk-card-title">
          <ShieldAlert aria-hidden="true" /> Risk level
        </h2>
        {canOverride && (
          <button type="button" className="btn btn-secondary" onClick={() => setDialog(true)}>
            {ov ? 'Change override' : 'Override'}
          </button>
        )}
      </div>
      <div className="risk-level-row">
        <RiskBadge risk={r} large />
        {ov && <span className="muted">Set by {ov.byName}: {ov.reason}</span>}
      </div>
      <Alert type="error">{error}</Alert>

      {r.overrideNeedsReview && (
        <div className="override-warning">
          <TriangleAlert aria-hidden="true" />
          <span>
            The automatic result has changed since this override
            {ov.computedLevelAtOverride !== r.computedLevel && ` (was ${RISK_LABELS[ov.computedLevelAtOverride]}, now ${RISK_LABELS[r.computedLevel]})`}
            {newReasons.length > 0 && ` – new: ${newReasons.map((x) => x.label).join(', ')}`}. Please review the override.
          </span>
        </div>
      )}

      {r.reasons.length > 0 ? (
        <ul className="reason-list" aria-label="Reasons">
          {r.reasons.map((x) => (
            <li key={x.key}>
              {x.level !== r.computedLevel && <RiskBadge level={x.level} />}
              <span className="reason-label">{x.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted risk-none">{noReasonText(r)}</p>
      )}

      {r.missing.length > 0 && (
        <p className="risk-missing">
          <strong>{r.mayBeHigher ? 'May be higher – still to record:' : 'Still to record:'}</strong> {r.missing.join(' · ')}
        </p>
      )}
      {notChecked && (
        <p className="risk-missing">
          <strong>{notChecked.lead}</strong> {notChecked.list} – {notChecked.rest}{' '}
          {r.templateId && <Link to={`/care-plans/templates/${r.templateId}#risk-rules`}>See the rules</Link>}
        </p>
      )}
      {readingsNotChecked && (
        <p className="risk-missing">
          <strong>{readingsNotChecked.lead}</strong> {readingsNotChecked.list} – {readingsNotChecked.rest}{' '}
          {r.templateId && <Link to={`/care-plans/templates/${r.templateId}#risk-rules`}>See the rules</Link>}
        </p>
      )}
      {notMeasured && (
        <p className="risk-missing">
          <strong>{notMeasured.lead}</strong> {notMeasured.list}. {notMeasured.rest}
        </p>
      )}
      {r.freeTextNotChecked && patient.medical?.otherConditions && (
        <p className="risk-missing">
          <strong>Doctor to assess:</strong> “{patient.medical.otherConditions}” (not checked automatically)
        </p>
      )}
      {patient.access.canEditClinical && (patient.medical?.otherConditions || patient.notes) && <AiRiskCheck patient={patient} onChanged={onChanged} />}

      <details className="override-history risk-more">
        <summary>More details</summary>
        <div className="risk-more-body">
          <p>{ov ? `Automatic result: ${RISK_LABELS[r.computedLevel]}. ` : ''}{RISK_HINTS[r.computedLevel]}</p>
          {r.reasons.length > 0 && (
            <ul className="reason-list">
              {r.reasons.map((x) => (
                <li key={x.key}>
                  <RiskBadge level={x.level} />
                  <span>
                    <span className="reason-label">{x.label}</span>
                    {x.detail && <span className="muted"> – {x.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!r.templateApproved && (
            <Alert type="warning">
              Based on <strong>draft rules that no doctor has approved yet</strong> ({r.templateName}, version {r.templateVersion}). Use only as a reminder, not
              for clinical decisions. <Link to={`/care-plans/templates/${r.templateId}`}>Review the rules</Link>
            </Alert>
          )}
          {ov && (
            <div className="override-box">
              <div className="override-line">
                <strong>Doctor's override:</strong> <RiskBadge level={ov.level} /> <span>– {ov.reason}</span>
              </div>
              <div className="t-caption muted">
                {ov.byName}, {formatDateTime(ov.at)}
              </div>
              {canOverride && (
                <button type="button" className="btn btn-link" onClick={() => setConfirmRemove(true)} disabled={busy}>
                  Remove override
                </button>
              )}
            </div>
          )}
          <p className="hint">
            {NOT_CHECKED_YET} Last checked <span className="tabular">{formatDateTime(r.computedAt)}</span> against {r.rulesChecked} rules.
          </p>
          {history.length > 0 && (
            <>
              <h3>Override history ({history.length})</h3>
              <ul>
                {[...history].reverse().map((h, i) => (
                  <li key={i}>
                    <div className="override-line">
                      <RiskBadge level={h.level} /> <span>by {h.byName} – {h.reason}</span>
                    </div>
                    <div className="t-caption muted">{formatDateTime(h.at)}</div>
                    <div className="hint">
                      Automatic then: {RISK_LABELS[h.computedLevelAtOverride] ?? '—'}
                      {h.endedAt && ` · ${h.endedBecause === 'replaced' ? 'replaced' : 'removed'} by ${h.endedByName}, ${formatDateTime(h.endedAt)}`}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </details>

      {confirmRemove && (
        <ConfirmDialog
          id="remove-override"
          title="Remove your override?"
          confirmLabel="Remove override"
          danger
          onConfirm={removeOverride}
          onCancel={() => setConfirmRemove(false)}
        >
          The automatic risk level will be used again. Your override stays in the override history.
        </ConfirmDialog>
      )}
      {dialog && (
        <OverrideDialog
          patient={patient}
          onCancel={() => setDialog(false)}
          onDone={(p) => {
            setDialog(false);
            onChanged(p, 'Risk level override saved.');
          }}
        />
      )}
    </section>
  );
}
