import { useEffect, useState } from 'react';
import { ClipboardList, Pencil } from 'lucide-react';
import { api } from '../../api.js';
import { Alert } from '../../components/ui.jsx';
import { LossFindingFields, LossFindingsList } from '../patients/LossFindings.jsx';
import {
  DRAFT_NOTE,
  LOSS_FINDINGS,
  LOSS_FINDINGS_HINT,
  currentLossFindings,
  isRetiredLoss,
  lossFindingValues,
  lossFindingsChanged,
  lossFindingsPayload,
  lossFlagsText,
  lossRulesOn,
  showsPregnancyFields,
  validMm,
} from '../patients/abortionFormat.js';

/** Whether the visit page shows the findings of a pregnancy loss: an abortion-care visit of a record whose type of loss is a pregnancy now. */
export function showsLossFindings(patient, visit) {
  const lossType = patient?.abortion?.lossType;
  return patient?.careType === 'abortion' && visit?.careType === 'abortion' && Boolean(lossType) && !isRetiredLoss(lossType) && showsPregnancyFields(lossType);
}

/**
 * On the visit page in pregnancy-loss care: the findings on her record (cervical os, the scan, signs of rupture,
 * bleeding, fever with discharge), each with who recorded it and when. The treating doctor or an RMO records or
 * changes them here without leaving the visit – they are saved on her RECORD, with the visit they were found at –
 * as long as the visit itself can be changed (not signed, not marked entered in error, not on a record marked as a
 * duplicate: page.access.canEdit, the same rule as the rest of the visit page). Everyone else sees them read-only.
 * onSaved(message): something was saved (the page then reads the record and the visit again – the red flags follow).
 */
export function LossFindingsCard({ patient, page, onSaved }) {
  const a = patient.abortion;
  const recorded = JSON.stringify(lossFindingValues(a));
  const [values, setValues] = useState(() => JSON.parse(recorded));
  const [seen, setSeen] = useState(() => JSON.parse(recorded)); // the values as the card showed them when it opened
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  // The record was read again and its findings changed (saved here, or by a colleague): show what is on the record now
  useEffect(() => {
    setValues(JSON.parse(recorded));
    setSeen(JSON.parse(recorded));
    setFields({});
    setError(null);
  }, [recorded]);

  if (!showsLossFindings(patient, page.visit)) return null;
  const canEdit = Boolean(patient.access?.canEditClinical) && Boolean(page.access?.canEdit) && page.visit.status === 'active';
  // Whether this hospital's red-flag rules check pregnancy-loss care (from the visit's or the record's red flags)
  const rulesOn = lossRulesOn(page.redFlags?.rules ?? patient.redFlags?.rules);
  const any = (a.findings ?? []).length > 0;
  if (!canEdit && !any) return null;
  const changed = lossFindingsChanged(values, seen);

  const cancel = () => {
    setValues(seen);
    setFields({});
    setError(null);
    setOpen(false);
  };
  const save = async () => {
    const bad = Object.fromEntries(LOSS_FINDINGS.filter((f) => f.type === 'number' && !validMm(values[f.key])).map((f) => [f.key, `${f.label} must be a number of ${f.unit}, for example 7 or 7.5`]));
    if (Object.keys(bad).length) {
      setFields(bad);
      setError('Please check the highlighted fields.');
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const res = await api(`/patients/${patient.id}/loss-findings`, { method: 'PUT', body: { findings: lossFindingsPayload(values, a.lossType, seen), seen, visitId: page.visit.id } });
      setOpen(false);
      onSaved(res.changed ? 'Findings saved to her record.' : 'Nothing to save – the findings are as on her record.');
    } catch (err) {
      setError(err.message);
      // The server names a field as "findings.crlMm"
      setFields(Object.fromEntries(Object.entries(err.fields ?? {}).map(([k, v]) => [k.replace(/^findings\./, ''), v])));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card vs-findings" aria-labelledby="vs-findings-title">
      <div className="vs-findings-head">
        <h2 id="vs-findings-title">
          <ClipboardList aria-hidden="true" /> Findings of this pregnancy loss
        </h2>
        {canEdit && !open && (
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
            <Pencil aria-hidden="true" /> {any ? 'Change findings' : 'Record findings'}
          </button>
        )}
      </div>
      <Alert type="error">{error}</Alert>
      {open ? (
        <>
          <p className="hint">
            {LOSS_FINDINGS_HINT} They are saved on her record, not only in this visit. {lossFlagsText(rulesOn)} {DRAFT_NOTE}
          </p>
          <LossFindingFields
            values={values}
            onChange={(key, value) => setValues((cur) => ({ ...cur, [key]: value }))}
            lossType={a.lossType}
            seen={seen}
            rulesOn={rulesOn}
            entries={currentLossFindings(a)}
            fe={(key) => fields[key]}
            idPrefix="vs-lf"
            disabled={saving}
          />
          <div className="row lf-actions">
            <button type="button" className="btn btn-secondary" onClick={save} disabled={saving || !changed}>
              {saving ? 'Saving…' : 'Save findings to her record'}
            </button>
            <button type="button" className="btn btn-link" onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </>
      ) : any ? (
        <LossFindingsList abortion={a} />
      ) : (
        <p className="muted pf-finding-none">None recorded yet: cervical os, products of conception, the scan, bleeding, fever with discharge.</p>
      )}
    </section>
  );
}
