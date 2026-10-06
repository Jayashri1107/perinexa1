// One patient's record, showing only what this person may see; changes only where the server allows them.
import { ArrowLeft, Lock, Pencil, Receipt, Siren } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { patientsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormModal } from '../../components/form/FormModal.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { clinicalFields, clinicalValues, contactFields, contactValues, emergencyFields } from '../../forms/patientForms.js';
import { useForm } from '../../hooks/useForm.js';
import { useOptions } from '../../hooks/useOptions.js';
import { ageText, formatDate, formatDateTime, labelOf } from '../../utils/format.js';

const ACCESS_WORDS = {
  full: 'Full access',
  clinicalRead: 'Read only',
  contactEdit: 'Contact details',
  contactRead: 'Contact details, read only',
  basic: 'Name and number only',
};

export function PatientDetailPage() {
  const { id } = useParams();
  const { patients: settings } = useAppConfig();
  const { canAccess } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // 'contact' | 'clinical' | 'emergency'
  const doctors = useOptions(patientsApi.doctors);
  const form = useForm({});

  const load = useCallback(() => {
    patientsApi.get(id).then(setData).catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { patient: p, can } = data;
  const clinical = p.access === 'full' || p.access === 'clinicalRead';

  const open = (name, values) => {
    form.reset(values);
    setDialog(name);
  };
  const done = (result) => {
    setData(result);
    setDialog(null);
  };
  const toggleStatus = async () => {
    const next = p.status === 'active' ? 'closed' : 'active';
    if (!window.confirm(next === 'closed' ? 'Close this record?' : 'Reopen this record?')) return;
    try {
      setData(await patientsApi.setStatus(id, next));
    } catch (err) {
      setError(err.message);
    }
  };

  const address = [p.address?.line, p.address?.city, p.address?.state, p.address?.pincode].filter(Boolean).join(', ');

  return (
    <>
      <PageHeader
        back={<Link to="/hospital/patients" className="back-link"><ArrowLeft size={16} aria-hidden /> Patients</Link>}
        title={p.name}
        subtitle={`${p.patientNumber} · ${ageText(p.birthDate, p.birthDateApprox)} · ${labelOf(settings.sexes, p.sex)} · registered ${formatDate(p.createdAt)}`}
        actions={
          <>
            <StatusBadge status={p.status === 'active' ? 'active' : 'inactive'} />
            {p.isSensitive && <span className="badge badge-pending"><Lock size={13} aria-hidden /> Sensitive</span>}
            <span className="badge badge-info">{ACCESS_WORDS[p.access]}</span>
            {canAccess('billing') && (
              <Link to={`/hospital/billing?patientId=${p.id}`} className="btn btn-ghost"><Receipt size={16} aria-hidden /> Bills</Link>
            )}
            {can.changeStatus && (
              <button type="button" className="btn btn-ghost" onClick={toggleStatus}>{p.status === 'active' ? 'Close record' : 'Reopen record'}</button>
            )}
          </>
        }
      />
      <Alert type="error">{error}</Alert>
      {data.emergencyUntil && <Alert type="info">Emergency access until {formatDateTime(data.emergencyUntil)}.</Alert>}
      {can.emergencyAccess && (
        <Alert type="info">
          You can read this record but not change it, because she is another doctor’s patient.{' '}
          <button type="button" className="btn btn-link" onClick={() => open('emergency', { reason: '' })}>
            <Siren size={14} aria-hidden /> Emergency access
          </button>
        </Alert>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Contact</h2>
            {can.editContact && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('contact', contactValues(p))}><Pencil size={14} aria-hidden /> Edit</button>
            )}
          </div>
          <dl className="details">
            {p.phone !== undefined && (<><dt>Phone</dt><dd>{[p.phone, p.alternatePhone].filter(Boolean).join(', ') || '—'}</dd></>)}
            {p.address !== undefined && (<><dt>Address</dt><dd>{address || '—'}</dd></>)}
            {p.abhaNumber !== undefined && (<><dt>ABHA</dt><dd>{p.abhaNumber || '—'}</dd></>)}
            {p.careType !== undefined && (<><dt>Care</dt><dd>{labelOf(settings.careTypes, p.careType)}</dd></>)}
            {p.doctor !== undefined && (<><dt>Doctor</dt><dd>{p.doctor?.name ?? '—'}</dd></>)}
            {p.consentMessages !== undefined && (<><dt>Reminders</dt><dd>{p.consentMessages ? 'Agreed' : 'Not agreed'}</dd></>)}
          </dl>
        </section>

        {clinical && (
          <section className="card">
            <div className="card-head">
              <h2>Clinical</h2>
              {can.editClinical && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('clinical', clinicalValues(p))}><Pencil size={14} aria-hidden /> Edit</button>
              )}
            </div>
            <dl className="details">
              <dt>LMP</dt><dd>{formatDate(p.lmp)}</dd>
              <dt>EDD</dt><dd>{formatDate(p.edd)}</dd>
              <dt>G / P</dt><dd>{p.gravida ?? '—'} / {p.para ?? '—'}</dd>
              <dt>Blood group</dt><dd>{p.bloodGroup || '—'}</dd>
              <dt>Allergies</dt><dd>{p.allergies || '—'}</dd>
              <dt>Notes</dt><dd className="pre">{p.notes || '—'}</dd>
            </dl>
          </section>
        )}
      </div>

      {dialog === 'contact' && (
        <FormModal
          title="Contact details"
          size="lg"
          fields={contactFields({ careTypes: settings.careTypes, sexes: settings.sexes, doctors, withLmp: can.editClinical })}
          form={form}
          onSubmit={async (v) => done(await patientsApi.updateContact(id, v))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'clinical' && (
        <FormModal
          title="Clinical details"
          size="lg"
          fields={clinicalFields(settings)}
          form={form}
          onSubmit={async (v) => done(await patientsApi.updateClinical(id, v))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'emergency' && (
        <FormModal
          title="Emergency access"
          fields={emergencyFields}
          form={form}
          submitLabel="Open the record"
          onSubmit={async (v) => done(await patientsApi.emergencyAccess(id, v.reason))}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
