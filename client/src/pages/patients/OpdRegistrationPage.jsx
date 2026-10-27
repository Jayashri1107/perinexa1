import { useState } from 'react';
import { CircleCheck, Receipt, Search, Stethoscope, UserPlus, UserRoundSearch } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Avatar, Field, StatusPill, formatDate, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { DEPARTMENTS } from '../../platform/departments.js';
import { canRegisterPatients, newPatientLinks } from '../../platform/modules.js';
import { PURPOSE_LABELS, VISIT_PURPOSES } from '../appointments/appointmentFormat.js';
import { ChargeLines, billCharges, billedText, chargesOk, chargesTotal, useChargeItems } from '../billing/ServiceChargeDialog.jsx';
import { rupees } from '../billing/billingFormat.js';
import { CARE_TYPE_HINTS, CARE_TYPE_SHORT, ageText } from './patientFormat.js';

// Patients → OPD → OPD registration (owner, 27 Oct 2026): first the question – a new patient, or one registered
// before. New registration opens the registration form (by type of care). Registered: find her by patient number,
// name or phone, see her details, then choose the department, the doctor of that department, why she came and the
// services – Send to doctor gives her the day's OPD number and the doctor's token (POST /api/arrivals) and bills the
// services with that doctor on them, paid now or at the billing desk.

let seq = 0;

function NewRegistration({ roles }) {
  return (
    <section className="card opd-new" aria-labelledby="opd-new-title">
      <h2 id="opd-new-title">Type of care</h2>
      <p className="hint">Choose the type of care; the registration form opens. A wrong choice can be changed on the form.</p>
      <div className="opd-care-grid">
        {newPatientLinks(roles).map((l) => (
          <Link key={l.to} to={l.to} className="opd-care">
            <strong>{l.label}</strong>
            {CARE_TYPE_HINTS[l.type] && <span className="muted">{CARE_TYPE_HINTS[l.type]}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}

function PatientCard({ p }) {
  const rows = [
    ['Patient no.', p.mrn],
    ['Age', ageText(p)],
    ['Phone', p.phone],
    ['Address', [p.address, p.city, p.state, p.pinCode].filter(Boolean).join(', ')],
    ['Type of care', CARE_TYPE_SHORT[p.careType] ?? p.careType],
    ['Her doctor', p.assignedDoctorName ?? ''],
    ['Registered on', p.createdAt ? formatDate(p.createdAt) : ''],
    ['Emergency contact', [p.emergencyContact?.name, p.emergencyContact?.relation, p.emergencyContact?.phone].filter(Boolean).join(' · ')],
  ].filter(([, v]) => v);
  return (
    <section className="card opd-patient" aria-labelledby="opd-patient-name">
      <div className="opd-patient-head">
        <Avatar name={p.fullName} seed={p.id} />
        <div>
          <h2 id="opd-patient-name">{p.fullName}</h2>
          <span className="muted">{[p.mrn, ageText(p)].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      {p.currentAdmission && (
        <StatusPill tone="admitted" icon={Stethoscope}>
          In hospital{p.currentAdmission.bed ? ` · Bed ${p.currentAdmission.bed}` : ''}
        </StatusPill>
      )}
      <dl className="details opd-details">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <Link to={`/patients/${p.id}`}>Open her record</Link>
    </section>
  );
}

/** The OPD visit of a registered patient: department → doctor → why she came → services → send and bill. */
function OpdVisit({ p, canCharge, canSend, onDone }) {
  const doctors = useFetch('/tenant/doctors');
  const all = doctors.data?.doctors ?? [];
  const departments = DEPARTMENTS.filter((d) => all.some((x) => x.department === d));
  const own = all.find((d) => d.name === p.assignedDoctorName);
  const [department, setDepartment] = useState(null); // null: not chosen yet – her doctor's department
  const dept = department ?? own?.department ?? '';
  const offered = all.filter((d) => !dept || d.department === dept);
  const [doctorId, setDoctorId] = useState(null);
  const chosen = doctorId ?? (offered.some((d) => d.id === own?.id) ? own.id : (offered[0]?.id ?? ''));
  const doctor = all.find((d) => d.id === chosen);
  const [purpose, setPurpose] = useState('consultation');
  const { items, error: pricesError } = useChargeItems(canCharge);
  const [lines, setLines] = useState([]);
  const [pay, setPay] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const total = chargesTotal(lines);
  // One click for the consultation (new patient or follow-up), from the price list
  const quick = (key) => {
    const item = items?.find((i) => i.key === key);
    if (item && !lines.some((x) => x.item.id === item.id)) setLines([...lines, { key: `q${(seq += 1)}`, item, rate: '' }]);
  };
  const send = async () => {
    setBusy(true);
    setError(null);
    const done = { doctor: doctor?.name ?? '' };
    try {
      if (canSend) {
        const res = await api('/arrivals', { method: 'POST', body: { patientId: p.id, ...(chosen ? { doctorId: chosen } : {}), purpose: { kind: purpose, note: '' } } });
        Object.assign(done, { opdNo: res.arrival?.opdNo ?? null, token: res.appointment?.token ?? null, time: res.appointment?.start ?? null });
      }
      if (lines.length) {
        try {
          done.bill = await billCharges(p.id, lines, pay, null, chosen || null);
        } catch (err) {
          done.billError = err.bill ? `The services are on bill ${err.bill.number}, but the payment was not saved: ${err.message}` : `The services could not be billed: ${err.message}`;
          done.bill = err.bill ?? null;
        }
      }
      onDone(done);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card opd-visit" aria-labelledby="opd-visit-title">
      <h2 id="opd-visit-title">OPD visit</h2>
      <Alert type="error">{error ?? doctors.error ?? pricesError}</Alert>
      <div className="form-grid">
        {departments.length > 0 && (
          <Field label="Department" id="opd-dept">
            <select
              id="opd-dept"
              value={dept}
              onChange={(e) => {
                setDepartment(e.target.value);
                setDoctorId(null);
              }}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Doctor" id="opd-doctor" hint={dept ? `Doctors of ${dept}` : undefined}>
          <select id="opd-doctor" value={chosen} onChange={(e) => setDoctorId(e.target.value)}>
            {!offered.length && <option value="">No doctor in this department</option>}
            {offered.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.qualification ? ` (${d.qualification})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Came for" id="opd-purpose">
          <select id="opd-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {VISIT_PURPOSES.map((k) => (
              <option key={k} value={k}>
                {PURPOSE_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {canCharge && (
        <div className="opd-services">
          <div className="opd-services-head">
            <h3>Services and charges</h3>
            <span className="opd-quick">
              <button type="button" className="btn btn-secondary btn-sm" disabled={!items} onClick={() => quick('consult_new')}>
                + New consultation
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!items} onClick={() => quick('consult_follow')}>
                + Follow-up consultation
              </button>
            </span>
          </div>
          <ChargeLines idPrefix="opd-charge" items={items} lines={lines} onLines={setLines} pay={pay} onPay={setPay} />
        </div>
      )}

      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy || (!canSend && !lines.length) || !chargesOk(lines)} onClick={send}>
          <Receipt aria-hidden="true" /> {busy ? 'Saving…' : `${canSend ? `Send to ${doctor?.name ?? 'the doctor'}` : 'Bill'}${total ? ` and bill ${rupees(total)}` : ''}`}
        </button>
      </div>
    </section>
  );
}

function Registered({ canCharge, canSend }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState(null);
  const [done, setDone] = useState(null);
  const q = text.trim();
  const found = useFetch(q.length >= 2 && !picked ? '/patients' : null, { search: q, doctor: 'all', limit: 10 });
  const record = useFetch(picked ? `/patients/${picked}` : null);
  const p = record.data?.patient;
  const again = () => {
    setPicked(null);
    setDone(null);
    setText('');
  };

  if (done && p) {
    return (
      <section className="card opd-done" role="status">
        <p>
          <CircleCheck aria-hidden="true" /> <strong>{p.fullName}</strong>
          {done.doctor ? ` is sent to ${done.doctor}` : ' is done'}
          {done.token ? ` – token ${done.token}` : done.time ? ` – appointment at ${done.time}` : ''}
          {done.opdNo ? `, OPD no. ${done.opdNo}` : ''}.
          {done.bill && !done.billError ? ` ${billedText(done.bill)}` : ''}
        </p>
        {done.billError && <Alert type="error">{done.billError}</Alert>}
        <div className="row">
          {done.bill && (
            <Link className="btn btn-secondary" to={`/billing/bills/${done.bill.id}`}>
              <Receipt aria-hidden="true" /> Open the bill to print
            </Link>
          )}
          <button type="button" className="btn btn-primary" onClick={again}>
            Next patient
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      {!picked && (
        <section className="card opd-find" aria-labelledby="opd-find-title">
          <h2 id="opd-find-title">Find the patient</h2>
          <label className="opd-search">
            <Search aria-hidden="true" />
            <span className="sr-only">Patient number, name or phone</span>
            <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Patient number, name or phone" autoFocus />
          </label>
          {found.error && <Alert type="error">{found.error}</Alert>}
          {q.length >= 2 && found.data && (
            <ul className="opd-results">
              {found.data.patients.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setPicked(r.id)}>
                    <Avatar name={r.fullName} seed={r.id} />
                    <span>
                      <strong>{r.fullName}</strong>
                      <span className="muted">{[r.mrn, r.careType === 'newborn' ? null : ageText(r), r.phone].filter(Boolean).join(' · ')}</span>
                    </span>
                    {r.assignedDoctorName && <span className="muted opd-result-doc">{r.assignedDoctorName}</span>}
                  </button>
                </li>
              ))}
              {!found.data.patients.length && <li className="muted opd-none">No registered patient found. Check the number, or register her as new.</li>}
            </ul>
          )}
          {q.length < 2 && <p className="hint">Type at least two letters or digits.</p>}
        </section>
      )}
      {picked && (
        <>
          <div className="row opd-back">
            <button type="button" className="btn btn-link btn-sm" onClick={again}>
              ← Find another patient
            </button>
          </div>
          {record.error && <Alert type="error">{record.error}</Alert>}
          {p && (
            <div className="opd-grid">
              <PatientCard p={p} />
              {p.duplicateOf || p.closed ? (
                <Alert type="warning">{p.duplicateOf ? `This record is a duplicate of ${p.duplicateOf.mrn}: open that record.` : 'This record is closed.'}</Alert>
              ) : (
                <OpdVisit p={p} canCharge={canCharge} canSend={canSend} onDone={setDone} />
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

export function OpdRegistrationPage() {
  const { activeMembership } = useAuth();
  const roles = activeMembership.roles;
  const [params, setParams] = useSearchParams();
  const registered = params.get('as') === 'registered' || !canRegisterPatients(roles);
  const canCharge = hasRole(activeMembership, 'receptionist', 'billing', 'admin');
  const canSend = hasRole(activeMembership, 'receptionist', 'nurse', 'doctor', 'rmo');
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Patients', to: '/patients' }, { label: 'OPD registration' }]} title="OPD registration" />
      <div className="pf-content opd-page">
        <div className="opd-choice" role="group" aria-label="New or registered patient">
          {canRegisterPatients(roles) && (
            <button type="button" className={`opd-choice-card ${!registered ? 'is-on' : ''}`} aria-pressed={!registered} onClick={() => setParams({}, { replace: true })}>
              <UserPlus aria-hidden="true" />
              <span>
                <strong>New registration</strong>
                <span>First time in this hospital: fill the registration form</span>
              </span>
            </button>
          )}
          <button type="button" className={`opd-choice-card ${registered ? 'is-on' : ''}`} aria-pressed={registered} onClick={() => setParams({ as: 'registered' }, { replace: true })}>
            <UserRoundSearch aria-hidden="true" />
            <span>
              <strong>Registered patient</strong>
              <span>Came before: find her, choose the doctor and the services</span>
            </span>
          </button>
        </div>
        {registered ? <Registered canCharge={canCharge} canSend={canSend} /> : <NewRegistration roles={roles} />}
      </div>
    </>
  );
}
