// One visit (as in Perinexa's visit page): vitals, findings, the prescription with its safety warnings, and the red
// flags from the values recorded. Her doctor or an RMO signs it; after that nothing changes and corrections are added
// below. A visit opened by mistake is marked "entered in error" (never deleted).
import { ArrowLeft, Printer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { visitsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDateTime, labelOf } from '../../utils/format.js';
import { dayText } from '../appointments/appointmentFormat.js';
import { PrescriptionPart } from './PrescriptionPart.jsx';
import { AdditionsCard, FindingsPart, RedFlagsCard, VitalsPart } from './VisitParts.jsx';
import { visitLook } from './visitFormat.js';

export function VisitPage() {
  const { id: patientId, visitId } = useParams();
  const writeRx = useSearchParams()[0].get('rx') === '1'; // from "Write prescription" on her record
  const { patients: settings, prescriberRoles } = useAppConfig();
  const { hasRole } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    visitsApi.get(patientId, visitId).then(setData).catch((err) => setError(err.message));
  }, [patientId, visitId]);
  useEffect(load, [load]);

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { visit, patient, checks, can } = data;
  const isPrescriber = hasRole(...prescriberRoles);

  const act = async (action) => {
    setBusy(true);
    setError('');
    try {
      setData(await action());
      setCancelling(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        back={<Link to={`/hospital/patients/${patient.id}`} className="back-link"><ArrowLeft size={16} aria-hidden /> {patient.name}</Link>}
        title={`Visit · ${dayText(visit.visitOn, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
        subtitle={`${patient.patientNumber} · ${labelOf(settings.careTypes, visit.careType)}${checks.weeks != null ? ` · ${checks.weeks} weeks of pregnancy` : ''}${patient.allergies ? ` · Allergies: ${patient.allergies}` : ''} · started by ${visit.createdByName}`}
        actions={
          <>
            <StateBadge look={visitLook(visit)} />
            {visit.status === 'active' && (
              <a className="btn btn-ghost" href={`/hospital/print/prescription/${patient.id}/${visit.id}`} target="_blank" rel="noreferrer"><Printer size={16} aria-hidden /> Print</a>
            )}
            {can.cancel && <button type="button" className="btn btn-link btn-danger-text" onClick={() => setCancelling(true)}>Entered in error</button>}
            {can.sign && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => window.confirm('Sign this visit? After signing nothing can change; corrections are added below it.') && act(() => visitsApi.sign(patient.id, visit.id))}>Sign the visit</button>}
          </>
        }
      />
      <Alert type="error">{error}</Alert>
      {visit.cancelled && <Alert type="info">Entered in error – {visit.cancelled.reason} ({visit.cancelled.byName}, {formatDateTime(visit.cancelled.at)}).</Alert>}

      <div className="grid-2">
        <VitalsPart visit={visit} editable={can.vitals} save={(v) => visitsApi.vitals(patient.id, visit.id, v)} onSaved={setData} />
        <RedFlagsCard checks={checks} />
      </div>
      <div className="top-gap">
        <FindingsPart visit={visit} careType={visit.careType} editable={can.details} isPrescriber={isPrescriber} save={(v) => visitsApi.details(patient.id, visit.id, v)} onSaved={setData} />
      </div>
      <div className="top-gap">
        <PrescriptionPart visit={visit} careType={visit.careType} checks={checks} editable={can.prescription} canSend={can.sendToPharmacy} autoEdit={writeRx} save={(v) => visitsApi.prescription(patient.id, visit.id, v)} onSaved={setData} />
      </div>
      <div className="top-gap">
        <AdditionsCard visit={visit} canAdd={can.addition} add={async (text) => setData(await visitsApi.addition(patient.id, visit.id, text))} />
      </div>

      {cancelling && (
        <Modal title="Mark as entered in error" onClose={() => setCancelling(false)} size="sm">
          <form onSubmit={(e) => { e.preventDefault(); act(() => visitsApi.cancel(patient.id, visit.id, reason)); }}>
            <p className="muted small">The visit is kept (never deleted) and shown as entered in error.</p>
            <div className="form-field">
              <label htmlFor="visit-cancel">Why<span className="required" aria-hidden> *</span></label>
              <input id="visit-cancel" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="modal-foot inline">
              <button type="button" className="btn btn-ghost" onClick={() => setCancelling(false)}>Back</button>
              <button type="submit" className="btn btn-primary" disabled={busy || reason.trim().length < 3}>Mark as entered in error</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
