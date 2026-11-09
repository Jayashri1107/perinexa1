import { useState } from 'react';
import { Baby, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { DateTimeInput } from '../../components/DateTimeInput.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, hasRole } from '../../components/ui.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { capitalizeName } from '../../personName.js';
import { nowLocal, toIso } from './nicuFields.js';

// Admit a new baby to the NICU (9 Nov 2026): a baby with no record yet – born elsewhere, or not registered – is
// registered as "B/O <mother's name>" and admitted in one step. The header only (as at the desk): the admitting doctor and
// the nurses are told and complete the NICU form. Reception, doctors and RMOs (those who register patients).

const babyOfName = (mother) => (mother.trim() ? `B/O ${capitalizeName(mother.trim())}` : 'B/O …'); // as the server saves it

function MotherSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const find = async () => {
    if (q.trim().length < 2) return;
    try {
      const r = await api('/patients', { query: { search: q.trim() } });
      setList((r.patients ?? []).filter((p) => p.careType !== 'newborn').slice(0, 8));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="stack">
      <div className="row">
        <Field label="Find her record – name, phone or patient number" id="nb-msearch">
          <input
            id="nb-msearch"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                find();
              }
            }}
          />
        </Field>
        <button type="button" className="btn btn-secondary" onClick={find}>
          <Search aria-hidden="true" /> Find
        </button>
      </div>
      <Alert type="error">{error}</Alert>
      {list && !list.length && <p className="muted">No mother found. Type her name below instead.</p>}
      {list?.length > 0 && (
        <ul className="plain-list">
          {list.map((p) => (
            <li key={p.id} className="row">
              <span>{`${p.fullName} · ${p.mrn}${p.phone ? ` · ${p.phone}` : ''}`}</span>
              <button type="button" className="btn btn-link" onClick={() => onPick(p)}>
                This is the mother
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NicuNewBabyPage() {
  const navigate = useNavigate();
  const membership = useAuth()?.activeMembership;
  const reception = hasRole(membership, 'receptionist') && !hasRole(membership, 'doctor', 'rmo', 'nurse');
  // the form's lists: units with where a baby may come from, NICU beds (free or taken), doctors
  const { data: o, error: loadError } = useFetch('/newborn-care/nicu/new-baby/options');
  const [requestId, setRequestId] = useState(newRequestId);
  const [mother, setMother] = useState(null);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const header = <PageHeader breadcrumbs={[{ label: reception ? 'Beds' : 'Newborn follow-up', to: reception ? '/beds' : '/newborn-follow-up' }, { label: 'Admit a new baby to the NICU' }]} title="Admit a new baby to the NICU" subtitle="For a baby with no record yet: registered as B/O her mother's name and admitted in one step." />;
  if (loadError) return (
    <>
      {header}
      <div className="pf-content">
        <Alert type="error">{loadError}</Alert>
      </div>
    </>
  );
  if (!o) return (
    <>
      {header}
      <div className="pf-content">
        <p className="muted">Loading…</p>
      </div>
    </>
  );
  const form = f ?? { motherName: '', phone: '', address: '', birthAt: nowLocal(), sex: '', birthWeightGrams: '', unit: o.units[0]?.key ?? '', source: '', transferFromName: '', admittedAt: nowLocal(), bedId: '', admittingDoctorId: '', consultantId: '' };
  const set = (k, v) => setF({ ...form, [k]: v });
  const unit = o.units.find((u) => u.key === form.unit);
  const beds = o.beds.filter((b) => b.unit === form.unit);
  const admitting = o.people.filter((p) => p.roles.some((r) => r === 'doctor' || r === 'rmo'));
  const doctors = o.people.filter((p) => p.roles.includes('doctor'));
  const fe = (k) => error?.fields?.[k];
  const submit = async (registerAnyway = false) => {
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, clientRequestId: requestId, motherId: mother?.id ?? null, motherName: mother ? '' : form.motherName, birthAt: toIso(form.birthAt), admittedAt: toIso(form.admittedAt), consultantId: form.consultantId || null, admittingDoctorId: form.admittingDoctorId || null, birthWeightGrams: form.birthWeightGrams, registerAnyway };
      const r = await api('/newborn-care/nicu/new-baby', { method: 'POST', body });
      setRequestId(newRequestId());
      navigate(`/patients/${r.baby.id}/${reception ? 'nicu-desk' : 'newborn-care'}`);
    } catch (err) {
      if (err.code === 'POSSIBLE_MATCHES') setMatches({ list: err.matches ?? [], total: err.total ?? 0 });
      else setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {header}
      <form
        className="pf-content appt-page"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <Alert type="error">{error?.message}</Alert>
        {matches && (
          <Alert type="info">
            {`This baby may already be registered (${matches.total}). Open the record to admit from it, or register a new baby anyway.`}
            <ul className="plain-list">
              {matches.list.map((m) => (
                <li key={m.id}>
                  <Link to={`/patients/${m.id}/${reception ? 'nicu-desk' : 'newborn-care'}`}>{`${m.fullName} · ${m.mrn}`}</Link>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => submit(true)}>
              Register a new baby anyway
            </button>
          </Alert>
        )}

        <section className="card appt-section" aria-labelledby="nb-mother">
          <h2 id="nb-mother">
            <Baby aria-hidden="true" /> The mother
          </h2>
          {mother ? (
            <p className="row">
              <strong>{`${mother.fullName} · ${mother.mrn}`}</strong>
              <button type="button" className="btn btn-link" onClick={() => setMother(null)}>
                Change
              </button>
            </p>
          ) : (
            <>
              <MotherSearch onPick={setMother} />
              <p className="hint">Not registered here (a baby born elsewhere)? Type her name – her own record is not needed.</p>
              <div className="form-grid">
                <Field label="Mother's name" id="nb-mname" error={fe('motherName') ?? fe('motherId')}>
                  <input id="nb-mname" maxLength={140} value={form.motherName} onChange={(e) => set('motherName', e.target.value)} />
                </Field>
                <Field label="Phone (optional)" id="nb-phone" error={fe('phone')}>
                  <input id="nb-phone" type="tel" maxLength={30} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
                </Field>
                <Field label="Address (optional)" id="nb-addr" error={fe('address')}>
                  <input id="nb-addr" maxLength={300} value={form.address} onChange={(e) => set('address', e.target.value)} />
                </Field>
              </div>
            </>
          )}
          <p className="hint">{`The baby is registered as: ${babyOfName(mother?.fullName ?? form.motherName)}`}</p>
        </section>

        <section className="card appt-section" aria-labelledby="nb-baby">
          <h2 id="nb-baby">The baby</h2>
          <div className="form-grid">
            <Field label="Date and time of birth" id="nb-born" error={fe('birthAt')}>
              <DateTimeInput id="nb-born" value={form.birthAt} onChange={(e) => set('birthAt', e.target.value)} />
            </Field>
            <Field label="Sex (optional)" id="nb-sex" error={fe('sex')}>
              <select id="nb-sex" value={form.sex} onChange={(e) => set('sex', e.target.value)}>
                <option value="">Not recorded</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="indeterminate">Indeterminate</option>
              </select>
            </Field>
            <Field label="Birth weight in grams (optional)" id="nb-bw" error={fe('birthWeightGrams')}>
              <input id="nb-bw" inputMode="numeric" value={form.birthWeightGrams} onChange={(e) => set('birthWeightGrams', e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="card appt-section" aria-labelledby="nb-nicu">
          <h2 id="nb-nicu">The NICU</h2>
          <div className="form-grid">
            <Field label="Unit" id="nb-unit" error={fe('unit')}>
              <select id="nb-unit" value={form.unit} onChange={(e) => setF({ ...form, unit: e.target.value, source: '', bedId: '' })}>
                {o.units.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Came from" id="nb-src" error={fe('source')}>
              <select id="nb-src" value={form.source} onChange={(e) => set('source', e.target.value)}>
                <option value="">Choose…</option>
                {Object.entries(unit?.sources ?? {}).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
            {form.source === 'transfer_other' && (
              <Field label="Hospital it came from" id="nb-from" error={fe('transferFromName')}>
                <input id="nb-from" maxLength={150} value={form.transferFromName} onChange={(e) => set('transferFromName', e.target.value)} />
              </Field>
            )}
            <Field label="Admitted" id="nb-at" error={fe('admittedAt')}>
              <DateTimeInput id="nb-at" value={form.admittedAt} onChange={(e) => set('admittedAt', e.target.value)} />
            </Field>
            <Field label="Bed" id="nb-bed" error={fe('bedId')} hint={beds.length ? `${beds.filter((b) => !b.occupied).length} of ${beds.length} free` : 'No NICU beds set up for this unit'}>
              <select id="nb-bed" value={form.bedId} onChange={(e) => set('bedId', e.target.value)}>
                <option value="">Choose…</option>
                {beds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {`${b.ward} · ${b.name} – ${b.occupied ? 'taken' : 'free'}`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Admitting doctor" id="nb-doc" error={fe('admittingDoctorId')} hint="The doctor or RMO who asked for the admission">
              <select id="nb-doc" value={form.admittingDoctorId} onChange={(e) => set('admittingDoctorId', e.target.value)}>
                <option value="">Choose…</option>
                {admitting.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Consultant (optional)" id="nb-cons" error={fe('consultantId')}>
              <select id="nb-cons" value={form.consultantId} onChange={(e) => set('consultantId', e.target.value)}>
                <option value="">Not chosen</option>
                {doctors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="hint">The admitting doctor and the nurses are told at once; they record the baby's weight, temperature and the rest of the NICU form.</p>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Registering and admitting…' : 'Register and admit'}
            </button>
          </div>
        </section>
      </form>
    </>
  );
}
