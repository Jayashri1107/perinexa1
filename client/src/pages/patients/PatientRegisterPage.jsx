// Register a new patient – typed, or filled by voice first (VoiceFill). A possible duplicate (same name or phone) is
// shown first; she can still be registered.
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { patientsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormBuilder } from '../../components/form/FormBuilder.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { contactFields, emptyPatient } from '../../forms/patientForms.js';
import { useForm } from '../../hooks/useForm.js';
import { useOptions } from '../../hooks/useOptions.js';
import { ageText } from '../../utils/format.js';
import { setPath } from '../../utils/objectPath.js';
import { VoiceFill } from './VoiceFill.jsx';
import { AskByVoice } from './AskByVoice.jsx';
import { usePincodeFill } from '../../hooks/usePincodeFill.js';

export function PatientRegisterPage() {
  const { patients: settings } = useAppConfig();
  const navigate = useNavigate();
  const doctors = useOptions(patientsApi.doctors);
  const initial = useMemo(() => emptyPatient(settings.careTypes, settings.sexes), [settings]);
  const form = useForm(initial);
  usePincodeFill(form);
  const [duplicates, setDuplicates] = useState(null);

  const save = async (values, confirmDuplicate = false) => {
    try {
      const { patient } = await patientsApi.register({ ...values, confirmDuplicate });
      navigate(`/hospital/patients/${patient.id}`, { replace: true });
    } catch (err) {
      if (err.code === 'POSSIBLE_DUPLICATE') {
        setDuplicates(err.details.duplicates);
        return;
      }
      throw err;
    }
  };

  return (
    <>
      <PageHeader back={<Link to="/hospital/patients" className="back-link"><ArrowLeft size={16} aria-hidden /> Patients</Link>} title="New patient" />
      {duplicates && (
        <section className="card warn-card">
          <h2>Already registered?</h2>
          <p>A patient with the same name or phone number is already here. Open her record instead of registering her twice.</p>
          <ul className="plain-list rows">
            {duplicates.map((d) => (
              <li key={d.id}>
                <span>
                  <strong>{d.name}</strong> · {d.patientNumber} · {ageText(d.birthDate, d.birthDateApprox)} · {d.phone || 'no phone'}
                </span>
                <Link to={`/hospital/patients/${d.id}`} className="btn btn-ghost btn-sm">Open</Link>
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setDuplicates(null)}>Change the details</button>
            <button type="button" className="btn btn-primary" onClick={form.submit((v) => save(v, true))}>She is a different person – register</button>
          </div>
        </section>
      )}
      <AskByVoice
        values={form.values}
        onFill={form.setField}
        careTypes={settings.careTypes}
        sexes={settings.sexes}
        idProofTypes={settings.idProofTypes}
        doctors={doctors}
      />
      <VoiceFill
        careTypes={settings.careTypes}
        doctors={doctors}
        onUse={(found) => form.setValues((v) => Object.entries(found).reduce((acc, [k, val]) => setPath(acc, k, val), { ...v, ...(found.ageYears && { birthDate: '' }) }))}
      />
      <section className="card top-gap">
        <Alert type="info">Use only fake sample data until the app has been reviewed for real use.</Alert>
        <form onSubmit={form.submit((v) => save(v))} noValidate>
          <FormBuilder fields={contactFields({ careTypes: settings.careTypes, sexes: settings.sexes, idProofTypes: settings.idProofTypes, doctors })} form={form} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={form.submitting}>{form.submitting ? 'Saving…' : 'Register patient'}</button>
          </div>
        </form>
      </section>
    </>
  );
}
