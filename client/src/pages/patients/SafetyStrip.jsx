import { useState } from 'react';
import { Baby, CalendarDays, Droplet, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PatientAlertsDialog } from './PatientAlerts.jsx';
import { allergyStatus, isRhNegative } from './patientFormat.js';

/**
 * The facts that prevent treatment errors, at the top of every screen of a patient's record (Overview, Care plan,
 * Visits, a visit and its prescription): allergies, blood group with Rh and, in a pregnancy, the EDD used; after a
 * pregnancy loss in an Rh-negative woman, anti-D until it is recorded; after delivery, whether she is breastfeeding
 * (the medicine safety check uses it).
 * With them, the alerts that follow the patient (PX-X-13 – difficult airway, declines blood products …); those who
 * may write her chart add and end them from here (canAlerts), on every screen the strip is on.
 * Shown only to people who may see medical details. Each fact is colour + icon + words.
 */
export function SafetyStrip({ patient, canAlerts = false, onAlertsChanged }) {
  const [open, setOpen] = useState(false);
  const medical = patient.medical;
  if (medical === undefined) return null;
  const alerts = patient.alerts ?? [];
  const isNewborn = patient.careType === 'newborn';
  const allergies = allergyStatus(medical?.allergies);
  const bloodGroup = medical?.bloodGroup ?? '';
  const edd = patient.careType === 'antenatal' ? patient.pregnancy?.effectiveEdd : null;
  // Pregnancy loss in an Rh-negative woman: anti-D may be needed, until it is recorded as given or not needed.
  // (Not for the recurrent-loss work-up: she is not pregnant now.)
  const loss = patient.abortion;
  const antiD = patient.careType === 'abortion' && isRhNegative(bloodGroup) && loss?.lossType !== 'recurrent' && !['given', 'not_needed'].includes(loss?.antiD?.status);
  // After delivery: breastfeeding as recorded ('' = not recorded yet); undefined for other types of care.
  const breastfeeding = patient.careType === 'postnatal' && patient.postnatal !== undefined ? (patient.postnatal?.breastfeeding ?? '') : undefined;

  return (
    <section className="safety-strip" aria-label="Safety details">
      {alerts.map((a) => (
        <StatusPill key={a.id} tone="high" icon={TriangleAlert} large className="safety-allergy" title={a.auto ? 'Worked out by Perinexa from her record' : `Added by ${a.byName}`}>
          <span>
            <strong>{a.label}</strong>
            {a.note ? `: ${a.note}` : ''}
          </span>
        </StatusPill>
      ))}
      {!isNewborn && allergies === 'recorded' && (
        <StatusPill tone="high" icon={ShieldAlert} large className="safety-allergy">
          <span>
            <strong>Allergy:</strong> {medical.allergies.trim()}
          </span>
        </StatusPill>
      )}
      {!isNewborn && allergies === 'none' && (
        <StatusPill tone="stable" icon={ShieldCheck} large>
          No known allergies
        </StatusPill>
      )}
      {!isNewborn && allergies === 'not_asked' && (
        <StatusPill tone="watch" icon={ShieldQuestion} large title="Ask about allergies and record the answer on Edit details.">
          Allergies not recorded – ask
        </StatusPill>
      )}
      {bloodGroup ? (
        <StatusPill tone={isRhNegative(bloodGroup) ? 'watch' : 'neutral'} icon={Droplet} large>
          Blood group {bloodGroup}
          {isRhNegative(bloodGroup) ? ' (Rh negative)' : ''}
        </StatusPill>
      ) : (
        <StatusPill tone="neutral" icon={Droplet} large>
          Blood group not known
        </StatusPill>
      )}
      {antiD && (
        <StatusPill tone="watch" icon={Droplet} large title="Record anti-D (given or not needed) in Edit details → Pregnancy loss.">
          Rh negative – anti-D
        </StatusPill>
      )}
      {edd && (
        <StatusPill tone="neutral" icon={CalendarDays} large>
          EDD {formatDate(edd)}
        </StatusPill>
      )}
      {breastfeeding === 'yes' && (
        <StatusPill tone="neutral" icon={Baby} large title="As recorded on Edit details. The medicine safety check on her prescriptions uses it.">
          Breastfeeding
        </StatusPill>
      )}
      {breastfeeding === 'no' && (
        <StatusPill tone="neutral" icon={Baby} large>
          Not breastfeeding
        </StatusPill>
      )}
      {breastfeeding === '' && (
        <StatusPill tone="watch" icon={ShieldQuestion} large title="Ask, and record the answer on Edit details.">
          Breastfeeding not recorded – ask
        </StatusPill>
      )}
      {canAlerts && (
        <button type="button" className="btn btn-link" onClick={() => setOpen(true)}>
          {alerts.length ? 'Alerts' : 'Add an alert'}
        </button>
      )}
      {open && <PatientAlertsDialog patientId={patient.id} newborn={isNewborn} onClose={() => setOpen(false)} onChanged={onAlertsChanged} />}
    </section>
  );
}

/**
 * The same band on a screen outside her record (her operation, …): fetched for this patient. Nothing is shown to
 * someone who may not see her medical details.
 */
export function PatientSafetyBand({ patientId }) {
  const { data, reload } = useFetch(patientId ? '/patient-alerts/band' : null, { patientId });
  if (!data) return null;
  return <SafetyStrip patient={{ ...data.patient, alerts: data.alerts }} canAlerts={data.access.write} onAlertsChanged={reload} />;
}
