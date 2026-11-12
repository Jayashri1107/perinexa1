import { useMemo, useState } from 'react';
import { Banknote, CalendarClock, ChevronDown, CreditCard, Home, Plus, QrCode, Search, Siren, TestTube, Timer, UserPlus, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { asName } from '../../personName.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { rupees, toPaise } from '../billing/billingFormat.js';
import { departmentName } from './labFormat.js';
import { HomeFields, PaidReceipt } from './LabWalkIn.jsx';

// Lab → New: a walk-in or referred patient, in four plain steps (owner, 19 Oct 2026; made simpler on 12 Nov 2026 at the
// developer's request – the same fields and the same save, POST /api/lab/walk-in): 1 the patient (find, or a short new-
// patient form for the lab), 2 who sent her and the tests, 3 the sample, 4 the payment – then "Save and print receipt".
// The lab enters orders from an outside prescription (owner's decision, 17 Oct 2026). Fake data only until go-live.

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const EMPTY_HOME = { address: '', on: today(), time: '09:00', collectorId: '' };
const EMPTY_NEW = { fullName: '', ageYears: '', phone: '', address: '', sex: 'female', pregnant: 'no' };

/** A step's card: its number, a plain title and one line saying what to do. */
function Step({ n, title, help, done = false, children }) {
  return (
    <section className={`card lnr-step${done ? ' is-done' : ''}`} aria-labelledby={`lnr-step-${n}`}>
      <h2 id={`lnr-step-${n}`} className="lnr-step-title">
        <span className="lnr-step-no" aria-hidden="true">
          {n}
        </span>
        {title}
      </h2>
      {help && <p className="lnr-step-help">{help}</p>}
      {children}
    </section>
  );
}

/** Big choice buttons (one of a few), as radio buttons for screen readers. */
function Choices({ name, value, onChange, options }) {
  return (
    <div className="lnr-choices" role="radiogroup" aria-label={name}>
      {options.map(([key, label, Icon, hint]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} className={`lnr-choice${value === key ? ' is-on' : ''}`} onClick={() => onChange(key)}>
          {Icon && <Icon aria-hidden="true" />}
          <span>
            <strong>{label}</strong>
            {hint && <small>{hint}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * A new patient for the lab: name, age, phone, woman or man, pregnant or not, address (optional). A pregnant woman is
 * registered for antenatal care, any other adult for gynaecology care (the record her doctor can change later); a man's
 * sex goes with the order for his usual ranges. Records that may be hers are offered first, as on New patient.
 */
function NewPatient({ onDone, onCancel }) {
  const [v, setV] = useState(EMPTY_NEW);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [matches, setMatches] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const ok = v.fullName.trim().length >= 2 && v.ageYears !== '' && v.phone.trim().length >= 8;

  const register = async (anyway = false) => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const careType = v.sex === 'female' && v.pregnant === 'yes' ? 'antenatal' : 'gynaecology';
      const body = { careType, fullName: v.fullName.trim(), ageYears: v.ageYears, phone: v.phone.trim(), address: v.address.trim(), ...(anyway ? { registerAnyway: true } : {}) };
      const { patient } = await api('/patients', { method: 'POST', body });
      onDone(patient, v.sex);
    } catch (err) {
      if (err.code === 'POSSIBLE_MATCHES') setMatches(err.matches ?? []);
      else {
        setError(err.message);
        setFields(err.fields ?? {});
      }
    }
    setBusy(false);
  };

  if (matches) {
    return (
      <div className="lnr-new">
        <Alert type="warning">This person may already be registered. Choose the record if it is the same person.</Alert>
        <ul className="lnr-matches">
          {matches.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.fullName}</strong> <span className="muted">{[m.mrn, m.age != null ? `${m.age} yrs` : null, m.phoneEnd ? `phone …${m.phoneEnd}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onDone({ id: m.id, fullName: m.fullName, mrn: m.mrn, age: m.age ?? null }, v.sex)}>
                Use this record
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => register(true)}>
            No – register a new patient
          </button>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setMatches(null)}>
            Back
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="lnr-new">
      <h3>New patient</h3>
      <Alert type="error">{error}</Alert>
      <div className="lnr-grid">
        <Field label="Full name" id="lnr-name" error={fields.fullName}>
          <input id="lnr-name" value={v.fullName} onChange={asName(set('fullName'))} maxLength={150} autoFocus />
        </Field>
        <Field label="Age (years)" id="lnr-age" error={fields.ageYears}>
          <input id="lnr-age" inputMode="numeric" value={v.ageYears} onChange={set('ageYears')} maxLength={3} />
        </Field>
        <Field label="Mobile number" id="lnr-phone" error={fields.phone}>
          <input id="lnr-phone" type="tel" value={v.phone} onChange={set('phone')} maxLength={30} />
        </Field>
        <Field label="Address (optional)" id="lnr-address" error={fields.address}>
          <input id="lnr-address" value={v.address} onChange={set('address')} maxLength={300} />
        </Field>
      </div>
      <p className="lnr-label">Woman or man</p>
      <Choices
        name="Woman or man"
        value={v.sex}
        onChange={(sex) => setV({ ...v, sex, pregnant: sex === 'male' ? 'no' : v.pregnant })}
        options={[
          ['female', 'Woman'],
          ['male', 'Man'],
        ]}
      />
      {v.sex === 'female' && (
        <>
          <p className="lnr-label">Is she pregnant?</p>
          <Choices
            name="Is she pregnant?"
            value={v.pregnant}
            onChange={(pregnant) => setV({ ...v, pregnant })}
            options={[
              ['no', 'No'],
              ['yes', 'Yes'],
            ]}
          />
        </>
      )}
      <div className="row lnr-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !ok} onClick={() => register(false)}>
          <UserPlus aria-hidden="true" /> {busy ? 'Registering…' : 'Register and continue'}
        </button>
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function LabRegistrationPage() {
  const navigate = useNavigate();
  const catalogue = useFetch('/lab/tests');
  const priced = useFetch('/lab-setup/tests'); // the hospital's prices (Billing → Price list)
  const referrers = useFetch('/lab-setup/referrers');
  const home = useFetch('/lab/home');
  const [patient, setPatient] = useState(null);
  const [adding, setAdding] = useState(false);
  // The patient's own sex for the usual ranges: a man may come for his own tests
  const [sex, setSex] = useState('');
  const [ref, setRef] = useState({ referrerId: '', prescription: '', noteToLab: '', urgent: false });
  const [more, setMore] = useState(false);
  const [chosen, setChosen] = useState([]);
  const [find, setFind] = useState('');
  const [sample, setSample] = useState('now'); // now | later | home
  const [homeForm, setHomeForm] = useState(EMPTY_HOME);
  const [discOpen, setDiscOpen] = useState(false);
  const [disc, setDisc] = useState({ mode: 'amount', value: '', reason: '' });
  // How she paid is chosen at the counter, never in advance (developer, 22 Oct 2026); 'later' = nothing taken now
  const [payMode, setPayMode] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [requestId] = useState(newRequestId);

  // What is already due on her bill today (a new patient's registration fee, for example) – added to "To pay"
  const already = useFetch(patient ? '/lab/walk-in/bill' : null, patient ? { patientId: patient.id } : undefined);
  const otherDue = already.data?.duePaise ?? 0;
  const otherItems = already.data?.items ?? [];
  const who = patient?.careType === 'newborn' ? 'newborn' : 'adult';
  const all = useMemo(() => (catalogue.data?.tests ?? []).filter((t) => t.active !== false && t.who === who), [catalogue.data, who]);
  const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length ? all.filter((t) => !chosen.includes(t.key) && words.every((w) => t.name.toLowerCase().includes(w))).slice(0, 10) : [];
  const testOf = (key) => all.find((t) => t.key === key);
  const price = (key) => priced.data?.tests?.find((t) => t.key === key)?.pricePaise ?? 0;
  const total = chosen.reduce((s, k) => s + price(k), 0);
  const discValue = !discOpen || disc.value === '' ? 0 : disc.mode === 'amount' ? (toPaise(disc.value) ?? 0) : Number(disc.value) || 0;
  // The discount is on the bill (the tests and what is already on it), as the billing desk gives it
  const discount = Math.min(disc.mode === 'percent' ? Math.round(((total + otherDue) * discValue) / 100) : discValue, total + otherDue);
  const net = total + otherDue - discount;
  const taking = payMode !== '' && payMode !== 'later';
  const amount = !taking ? 0 : payAmount === '' ? net : (toPaise(payAmount) ?? 0);
  const balance = Math.max(net - amount, 0);
  const sexNow = sex || (patient?.sex === 'male' ? 'male' : 'female');
  const add = (key) => {
    setChosen((c) => [...c, key]);
    setFind('');
  };
  const pick = (p, s = '') => {
    setPatient(p);
    setSex(s);
    setAdding(false);
  };

  // What is still missing, in plain words (the button says it)
  const missing = !patient
    ? 'Choose or register the patient'
    : !ref.referrerId && ref.prescription.trim().length < 3
      ? 'Write what she asked for (step 2)'
      : !chosen.length
        ? 'Add at least one test'
        : discount > 0 && disc.reason.trim().length < 3
          ? 'Write why the discount is given'
          : net > 0 && !payMode
            ? 'Choose how she pays (step 4)'
            : null;

  const save = async () => {
    if (missing) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const body = {
        clientRequestId: requestId,
        patientId: patient.id,
        tests: chosen.map((key) => ({ key })),
        urgent: ref.urgent,
        noteToLab: ref.noteToLab.trim(),
        referrerId: ref.referrerId || null,
        prescription: ref.prescription.trim(),
        home: sample === 'home' ? { address: homeForm.address.trim(), on: homeForm.on, time: homeForm.time, collectorId: homeForm.collectorId || null } : null,
        collectNow: sample === 'now',
        ...(patient.careType !== 'newborn' ? { sex: sexNow } : {}),
        discount: discount > 0 ? { mode: disc.mode, value: discValue, reason: disc.reason.trim() } : null,
        payment: taking && amount > 0 ? { mode: payMode, amountPaise: amount, reference: payRef.trim() } : null,
      };
      const res = await api('/lab/walk-in', { method: 'POST', body });
      if (res.payment) setDone({ order: res.order, payment: res.payment, patient, tests: chosen.map((k) => testOf(k)?.name ?? k) });
      else navigate(`/lab/orders/${res.order.id}`);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };

  if (done) return <PaidReceipt done={done} onOpen={() => navigate(`/lab/orders/${done.order.id}`)} />;

  return (
    <>
      <PageHeader
        tabs={HOSPITAL_LAB.tabs}
        breadcrumbs={[{ label: 'Lab', to: '/lab/dashboard' }, { label: 'New patient test' }]}
        title="New patient test"
        documentTitle="Lab – new patient test"
        help="For a patient who comes to the lab: find or register her, add the tests, the sample and the payment – then save and print the receipt."
      />
      <div className="pf-content lnr">
        <Alert type="error">{error || catalogue.error}</Alert>

        {/* 1. The patient */}
        <Step n={1} title="Patient" help={patient ? null : 'Search by name, mobile number or patient number. Not found? Register her as a new patient.'} done={Boolean(patient)}>
          {patient ? (
            <div className="lnr-patient">
              <div>
                <strong className="lnr-patient-name">{patient.fullName}</strong>
                <span className="muted">
                  {[patient.mrn, patient.age != null ? `${patient.age} yrs` : null, patient.phone].filter(Boolean).join(' · ')}
                </span>
              </div>
              <button type="button" className="btn btn-link btn-sm" onClick={() => pick(null)}>
                Change
              </button>
              {patient.careType !== 'newborn' && (
                <div className="lnr-sex">
                  <span className="lnr-label">Test ranges for</span>
                  <Choices
                    name="Test ranges for"
                    value={sexNow}
                    onChange={setSex}
                    options={[
                      ['female', 'Woman'],
                      ['male', 'Man'],
                    ]}
                  />
                </div>
              )}
            </div>
          ) : adding ? (
            <NewPatient onDone={pick} onCancel={() => setAdding(false)} />
          ) : (
            <>
              <PatientFinder onPick={(p) => pick(p)} />
              <button type="button" className="btn btn-secondary lnr-new-btn" onClick={() => setAdding(true)}>
                <UserPlus aria-hidden="true" /> New patient
              </button>
            </>
          )}
        </Step>

        {/* 2. Who sent her, and the tests */}
        <Step n={2} title="Doctor and tests" help="Who sent her, and the tests to do. Tap a test to add it.">
          <div className="lnr-grid">
            <Field label="Sent by" id="lnr-referrer" error={fields.referrerId} hint="Doctors and centres are added under Lab → Referrers.">
              <select id="lnr-referrer" value={ref.referrerId} onChange={(e) => setRef({ ...ref, referrerId: e.target.value })}>
                <option value="">No doctor – came herself</option>
                {(referrers.data?.referrers ?? [])
                  .filter((r) => r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.kind === 'centre' ? ' (centre)' : ''}
                    </option>
                  ))}
              </select>
            </Field>
            {/* Without a referring doctor the lab still records on whose prescription it works (owner, 17 Oct 2026) */}
            <Field
              label={ref.referrerId ? 'Prescription (optional)' : 'What she asked for'}
              id="lnr-rx"
              error={fields.prescription}
              keepHint
              hint={ref.referrerId ? 'For example: prescription of 19 Oct.' : 'For example: "Self – sugar test", or "Dr Sample, Pune – prescription of 19 Oct".'}
            >
              <input id="lnr-rx" maxLength={200} value={ref.prescription} onChange={(e) => setRef({ ...ref, prescription: e.target.value })} />
            </Field>
          </div>

          <div className="lnr-search">
            <Search aria-hidden="true" />
            <label htmlFor="lnr-find" className="sr-only">
              Find a test
            </label>
            <input id="lnr-find" type="search" autoComplete="off" placeholder="Type a test name – for example hb, thyroid, sugar" value={find} onChange={(e) => setFind(e.target.value)} disabled={!patient} />
          </div>
          {!patient && <p className="muted">Choose the patient first.</p>}
          {found.length > 0 && (
            <ul className="lnr-found" aria-label="Tests found">
              {found.map((t) => (
                <li key={t.key}>
                  <button type="button" className="lnr-pick" onClick={() => add(t.key)}>
                    <Plus aria-hidden="true" />
                    <span>{t.name}</span>
                    <span className="muted">{departmentName(t.department)}</span>
                    <span className="tabular">{price(t.key) ? rupees(price(t.key)) : 'No price'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {words.length > 0 && !found.length && <p className="muted">No test found with that name.</p>}
          {fields.tests && <p className="field-error">{fields.tests}</p>}
          {chosen.length > 0 && (
            <ul className="lnr-chosen" aria-label="Tests added">
              {chosen.map((k) => (
                <li key={k}>
                  <span>{testOf(k)?.name ?? k}</span>
                  <span className="tabular">{price(k) ? rupees(price(k)) : '–'}</span>
                  <button type="button" className="icon-btn" aria-label={`Remove ${testOf(k)?.name ?? k}`} onClick={() => setChosen((c) => c.filter((x) => x !== k))}>
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
              <li className="lnr-chosen-total">
                <span>
                  {chosen.length} test{chosen.length === 1 ? '' : 's'}
                </span>
                <strong className="tabular">{rupees(total)}</strong>
                <span />
              </li>
            </ul>
          )}
          {chosen.length > 0 && total === 0 && <p className="hint">These tests have no price yet (Billing → Price list).</p>}

          <button type="button" className="btn btn-link btn-sm lnr-more" aria-expanded={more} onClick={() => setMore(!more)}>
            <ChevronDown aria-hidden="true" /> More options (urgent, note for the lab)
          </button>
          {(more || ref.urgent || ref.noteToLab) && (
            <div className="lnr-grid">
              <label className="check lnr-urgent">
                <input type="checkbox" checked={ref.urgent} onChange={(e) => setRef({ ...ref, urgent: e.target.checked })} /> <Siren aria-hidden="true" /> Urgent
              </label>
              <Field label="Note for the lab (optional)" id="lnr-note">
                <input id="lnr-note" maxLength={500} value={ref.noteToLab} onChange={(e) => setRef({ ...ref, noteToLab: e.target.value })} />
              </Field>
            </div>
          )}
        </Step>

        {/* 3. The sample */}
        <Step n={3} title="Sample" help="When is the sample taken?">
          <Choices
            name="When is the sample taken?"
            value={sample}
            onChange={setSample}
            options={[
              ['now', 'Now, at the lab', TestTube, 'The sample number is given now'],
              ['later', 'Later', Timer, 'Waits under Samples to take'],
              ['home', 'At her home', Home, 'A collector goes to her'],
            ]}
          />
          {sample === 'home' && <HomeFields value={homeForm} onChange={setHomeForm} collectors={home.data?.collectors} fields={fields} idPrefix="lnr-home" />}
        </Step>

        {/* 4. Payment */}
        <Step n={4} title="Payment" help="How does she pay? Choose Pay later if she pays at the end.">
          <dl className="lnr-sums">
            <div>
              <dt>Tests</dt>
              <dd className="tabular">{rupees(total)}</dd>
            </div>
            {otherDue > 0 && (
              <div>
                <dt>
                  Already on her bill today
                  {otherItems.length ? <small className="lnr-sums-note">{otherItems.map((i) => i.name).join(', ')}</small> : null}
                </dt>
                <dd className="tabular">{rupees(otherDue)}</dd>
              </div>
            )}
            {discount > 0 && (
              <div>
                <dt>Discount</dt>
                <dd className="tabular">−{rupees(discount)}</dd>
              </div>
            )}
            <div className="lnr-sums-total">
              <dt>To pay</dt>
              <dd className="tabular">{rupees(net)}</dd>
            </div>
          </dl>
          {!discOpen ? (
            <button type="button" className="btn btn-link btn-sm" onClick={() => setDiscOpen(true)} disabled={!total && !otherDue}>
              Add a discount
            </button>
          ) : (
            <div className="lnr-grid lnr-discount">
              <Field label="Discount as" id="lnr-disc-mode">
                <select id="lnr-disc-mode" value={disc.mode} onChange={(e) => setDisc({ ...disc, mode: e.target.value })}>
                  <option value="amount">Amount (₹)</option>
                  <option value="percent">Percentage (%)</option>
                </select>
              </Field>
              <Field label={disc.mode === 'amount' ? 'Discount (₹)' : 'Discount (%)'} id="lnr-disc-value" error={fields['discount.value']}>
                <input id="lnr-disc-value" inputMode="decimal" className="tabular" value={disc.value} onChange={(e) => setDisc({ ...disc, value: e.target.value })} />
              </Field>
              <Field label="Why" id="lnr-disc-reason" error={fields['discount.reason']} hint="For example: staff family, hardship.">
                <input id="lnr-disc-reason" maxLength={200} value={disc.reason} onChange={(e) => setDisc({ ...disc, reason: e.target.value })} />
              </Field>
              <button
                type="button"
                className="btn btn-link btn-sm"
                onClick={() => {
                  setDiscOpen(false);
                  setDisc({ mode: 'amount', value: '', reason: '' });
                }}
              >
                Remove the discount
              </button>
            </div>
          )}
          {net > 0 && (
            <>
              <p className="lnr-label">Paid by</p>
              <Choices
                name="Paid by"
                value={payMode}
                onChange={setPayMode}
                options={[
                  ['cash', 'Cash', Banknote],
                  ['upi', 'UPI', QrCode],
                  ['card', 'Card', CreditCard],
                  ['later', 'Pay later', CalendarClock],
                ]}
              />
              {fields['payment.mode'] && <p className="field-error">{fields['payment.mode']}</p>}
              {taking && (
                <div className="lnr-grid">
                  <Field label="Amount paid now (₹)" id="lnr-pay-amount" error={fields['payment.amountPaise']} keepHint hint={`Leave empty for the full ${rupees(net)}.`}>
                    <input id="lnr-pay-amount" inputMode="decimal" className="tabular" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                  </Field>
                  {(payMode === 'upi' || payMode === 'card') && (
                    <Field label="UPI or card reference (optional)" id="lnr-pay-ref">
                      <input id="lnr-pay-ref" maxLength={80} value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                    </Field>
                  )}
                </div>
              )}
              {payMode && (
                <p className="lnr-balance">
                  Paid now <strong className="tabular">{rupees(Math.min(amount, net))}</strong> · Balance <strong className="tabular">{rupees(balance)}</strong>
                </p>
              )}
            </>
          )}
        </Step>

        {/* Always at the foot: what she pays and the one button */}
        {/* sticky-actions: on a phone the app's bottom bar (the tab bar steps aside – mobile.css) */}
        <div className="lnr-bar sticky-actions">
          <div className="lnr-bar-sum grow">
            <span className="muted lnr-bar-what">
              {chosen.length} test{chosen.length === 1 ? '' : 's'}
              {patient ? ` · ${patient.fullName}` : ''}
            </span>
            <strong className="tabular">{rupees(net)}</strong>
            {missing && <span className="lnr-missing">{missing}</span>}
          </div>
          <Link to="/lab/dashboard" className="btn btn-link">
            Cancel
          </Link>
          <button type="button" className="btn btn-primary" disabled={Boolean(missing) || busy} onClick={save}>
            <TestTube aria-hidden="true" /> {busy ? 'Saving…' : taking && amount > 0 ? 'Save and print receipt' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}
