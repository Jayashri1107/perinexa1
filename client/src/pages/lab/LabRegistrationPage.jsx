import { useMemo, useState } from 'react';
import { Plus, Search, TestTube, UserPlus, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { PatientFinder } from '../appointments/AppointmentDialogs.jsx';
import { AdmitRegister } from '../beds/AdmitRegister.jsx';
import { rupees, toPaise } from '../billing/billingFormat.js';
import { departmentName } from './labFormat.js';
import { HomeFields, PaidReceipt } from './LabWalkIn.jsx';

// Registration on one screen (owner, 19 Oct 2026 – docs/LAB_DASHBOARD_PLAN.md, the eLabAssist layout in Perinexa's
// look): the patient, who referred her, the tests (search and add several), the sample (taken now, later, or at home),
// and the bill – total, discount, payment, balance – then "Save and print receipt". The lab enters orders from an
// outside prescription (owner's decision, 17 Oct 2026). Fake data only until go-live.

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const EMPTY_HOME = { address: '', on: today(), time: '09:00', collectorId: '' };

export function LabRegistrationPage() {
  const navigate = useNavigate();
  const catalogue = useFetch('/lab/tests');
  const priced = useFetch('/lab-setup/tests'); // the hospital's prices (Billing → Price list)
  const referrers = useFetch('/lab-setup/referrers');
  const home = useFetch('/lab/home');
  const [patient, setPatient] = useState(null);
  // The patient's own sex for the usual ranges (report templates): a man may come for his own tests
  const [sex, setSex] = useState('');
  const [ref, setRef] = useState({ referrerId: '', prescription: '', noteToLab: '', urgent: false });
  const [chosen, setChosen] = useState([]);
  const [find, setFind] = useState('');
  const [sample, setSample] = useState('now'); // now | later | home
  const [homeForm, setHomeForm] = useState(EMPTY_HOME);
  const [disc, setDisc] = useState({ mode: 'amount', value: '', reason: '' });
  const [pay, setPay] = useState({ take: true, mode: 'cash', amount: '', reference: '' });
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [requestId] = useState(() => crypto.randomUUID());

  const who = patient?.careType === 'newborn' ? 'newborn' : 'adult';
  const all = useMemo(() => (catalogue.data?.tests ?? []).filter((t) => t.active !== false && t.who === who), [catalogue.data, who]);
  const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length ? all.filter((t) => !chosen.includes(t.key) && words.every((w) => t.name.toLowerCase().includes(w))).slice(0, 12) : [];
  const testOf = (key) => all.find((t) => t.key === key);
  const price = (key) => priced.data?.tests?.find((t) => t.key === key)?.pricePaise ?? 0;
  const total = chosen.reduce((s, k) => s + price(k), 0);
  const discValue = disc.value === '' ? 0 : disc.mode === 'amount' ? (toPaise(disc.value) ?? 0) : Number(disc.value) || 0;
  const discount = Math.min(disc.mode === 'percent' ? Math.round((total * discValue) / 100) : discValue, total);
  const net = total - discount;
  const amount = pay.amount === '' ? net : (toPaise(pay.amount) ?? 0);
  const balance = Math.max(net - (pay.take ? amount : 0), 0);
  const add = (key) => {
    setChosen((c) => [...c, key]);
    setFind('');
  };

  const save = async () => {
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
        ...(patient.careType !== 'newborn' ? { sex: sex || (patient.sex === 'male' ? 'male' : 'female') } : {}),
        discount: discount > 0 ? { mode: disc.mode, value: discValue, reason: disc.reason.trim() } : null,
        payment: pay.take && amount > 0 ? { mode: pay.mode, amountPaise: amount, reference: pay.reference.trim() } : null,
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
  const ready = patient && chosen.length > 0 && (discount === 0 || disc.reason.trim().length >= 3);

  return (
    <>
      <PageHeader
        tabs={HOSPITAL_LAB.tabs}
        breadcrumbs={[{ label: 'Lab', to: '/lab/dashboard' }, { label: 'New registration' }]}
        title="New registration"
        documentTitle="Lab registration"
        help="A walk-in or referred patient: find or register her, add the tests, take the sample and the payment, all on this screen."
      />
      <div className="pf-content lab-reg">
        <Alert type="error">{error || catalogue.error}</Alert>
        <div className="lab-reg-cols">
          <div className="lab-reg-main">
            <section className="card lab-reg-card" aria-labelledby="reg-patient">
              <h2 id="reg-patient">1. Patient</h2>
              {!patient ? (
                <>
                  <PatientFinder onPick={setPatient} />
                  <AdmitRegister onRegistered={setPatient} />
                </>
              ) : (
                <dl className="lab-reg-patient">
                  <div>
                    <dt>Name</dt>
                    <dd>{patient.fullName}</dd>
                  </div>
                  <div>
                    <dt>Patient no.</dt>
                    <dd className="tabular">{patient.mrn}</dd>
                  </div>
                  {patient.age != null && (
                    <div>
                      <dt>Age</dt>
                      <dd>{patient.age} yrs</dd>
                    </div>
                  )}
                  {patient.phone && (
                    <div>
                      <dt>Phone</dt>
                      <dd className="tabular">{patient.phone}</dd>
                    </div>
                  )}
                  <div>
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setPatient(null)}>
                      Choose someone else
                    </button>
                  </div>
                </dl>
              )}
              {patient && patient.careType !== 'newborn' && (
                <Field label="Sex (for the usual ranges)" id="reg-sex" hint="Men's ranges differ for some tests (haemoglobin, creatinine …).">
                  <select id="reg-sex" value={sex || (patient.sex === 'male' ? 'male' : 'female')} onChange={(e) => setSex(e.target.value)}>
                    <option value="female">Woman</option>
                    <option value="male">Man</option>
                  </select>
                </Field>
              )}
            </section>

            <section className="card lab-reg-card" aria-labelledby="reg-ref">
              <h2 id="reg-ref">2. Referral</h2>
              <div className="form-grid">
                <Field label="Referred by" id="reg-referrer" error={fields.referrerId} hint="Add doctors and centres under Lab → Referrers.">
                  <select id="reg-referrer" value={ref.referrerId} onChange={(e) => setRef({ ...ref, referrerId: e.target.value })}>
                    <option value="">No referrer (self)</option>
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
                <Field label={ref.referrerId ? 'Prescription (optional)' : 'Prescription'} id="reg-rx" error={fields.prescription} hint='e.g. "Prescription of 19 Oct" or "Self – no prescription".'>
                  <input id="reg-rx" maxLength={200} value={ref.prescription} onChange={(e) => setRef({ ...ref, prescription: e.target.value })} />
                </Field>
                <Field label="Note for the lab (optional)" id="reg-note">
                  <input id="reg-note" maxLength={500} value={ref.noteToLab} onChange={(e) => setRef({ ...ref, noteToLab: e.target.value })} />
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={ref.urgent} onChange={(e) => setRef({ ...ref, urgent: e.target.checked })} /> Urgent
              </label>
            </section>

            <section className="card lab-reg-card" aria-labelledby="reg-tests">
              <h2 id="reg-tests">
                3. Tests <span className="muted">· {chosen.length}</span>
              </h2>
              {fields.tests && <p className="field-error">{fields.tests}</p>}
              <div className="lab-reg-search">
                <Search aria-hidden="true" />
                <label htmlFor="reg-find" className="sr-only">
                  Find a test
                </label>
                <input id="reg-find" type="search" autoComplete="off" placeholder="Type to find a test – e.g. hb, thyroid, sugar" value={find} onChange={(e) => setFind(e.target.value)} disabled={!patient} />
              </div>
              {found.length > 0 && (
                <ul className="lab-reg-found" aria-label="Tests found">
                  {found.map((t) => (
                    <li key={t.key}>
                      <button type="button" className="lab-reg-pick" onClick={() => add(t.key)}>
                        <span>{t.name}</span>
                        <span className="muted">{departmentName(t.department)}</span>
                        <span className="tabular">{price(t.key) ? rupees(price(t.key)) : 'no price'}</span>
                        <Plus aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {words.length > 0 && !found.length && <p className="muted">No test found. Tests are kept under Lab → Test master.</p>}
              {chosen.length > 0 ? (
                <table className="bill-lines lab-reg-chosen">
                  <thead>
                    <tr>
                      <th scope="col">No.</th>
                      <th scope="col">Test</th>
                      <th scope="col">Department</th>
                      <th scope="col" className="num">
                        Price
                      </th>
                      <th scope="col">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {chosen.map((k, i) => (
                      <tr key={k}>
                        <td className="tabular">{i + 1}</td>
                        <td>{testOf(k)?.name ?? k}</td>
                        <td>{departmentName(testOf(k)?.department)}</td>
                        <td className="num tabular">{price(k) ? rupees(price(k)) : '–'}</td>
                        <td className="num">
                          <button type="button" className="icon-btn" aria-label={`Remove ${testOf(k)?.name ?? k}`} onClick={() => setChosen((c) => c.filter((x) => x !== k))}>
                            <X aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">{patient ? 'Type above and tap a test to add it.' : 'Choose the patient first.'}</p>
              )}
              {chosen.length > 0 && total === 0 && <p className="hint">These tests have no price on the price list yet (Billing → Price list).</p>}
            </section>

            <section className="card lab-reg-card" aria-labelledby="reg-sample">
              <h2 id="reg-sample">4. Sample</h2>
              <div className="segmented" role="group" aria-label="Sample">
                <button type="button" aria-pressed={sample === 'now'} onClick={() => setSample('now')}>
                  Taken now at the counter
                </button>
                <button type="button" aria-pressed={sample === 'later'} onClick={() => setSample('later')}>
                  To take later
                </button>
                <button type="button" aria-pressed={sample === 'home'} onClick={() => setSample('home')}>
                  Collect at home
                </button>
              </div>
              <p className="hint">
                {sample === 'now'
                  ? 'The sample number is given now; print the labels from the order after saving.'
                  : sample === 'later'
                    ? 'The order waits under Samples to take.'
                    : 'The collector finds it under Home collections.'}
              </p>
              {sample === 'home' && <HomeFields value={homeForm} onChange={setHomeForm} collectors={home.data?.collectors} fields={fields} idPrefix="reg-home" />}
            </section>
          </div>

          <aside className="card lab-reg-bill" aria-labelledby="reg-bill">
            <h2 id="reg-bill">5. Bill</h2>
            <table className="bill-sums">
              <tbody>
                <tr>
                  <th scope="row">Total ({chosen.length} test{chosen.length === 1 ? '' : 's'})</th>
                  <td>{rupees(total)}</td>
                </tr>
                <tr>
                  <th scope="row">Discount</th>
                  <td>{discount ? `−${rupees(discount)}` : rupees(0)}</td>
                </tr>
                <tr className="bill-total">
                  <th scope="row">To pay</th>
                  <td>{rupees(net)}</td>
                </tr>
              </tbody>
            </table>
            <fieldset className="fieldset">
              <legend>Discount (optional)</legend>
              <div className="form-grid">
                <Field label="As" id="reg-disc-mode">
                  <select id="reg-disc-mode" value={disc.mode} onChange={(e) => setDisc({ ...disc, mode: e.target.value })}>
                    <option value="amount">Amount (₹)</option>
                    <option value="percent">Percentage</option>
                  </select>
                </Field>
                <Field label={disc.mode === 'amount' ? 'Discount (₹)' : 'Discount (%)'} id="reg-disc-value" error={fields['discount.value']}>
                  <input id="reg-disc-value" inputMode="decimal" className="tabular" value={disc.value} onChange={(e) => setDisc({ ...disc, value: e.target.value })} />
                </Field>
              </div>
              {discount > 0 && (
                <Field label="Why" id="reg-disc-reason" error={fields['discount.reason']} hint="For example: staff family, hardship.">
                  <input id="reg-disc-reason" maxLength={200} value={disc.reason} onChange={(e) => setDisc({ ...disc, reason: e.target.value })} />
                </Field>
              )}
            </fieldset>
            <fieldset className="fieldset">
              <legend>Payment</legend>
              <label className="check">
                <input type="checkbox" checked={pay.take} onChange={(e) => setPay({ ...pay, take: e.target.checked })} /> Take the payment now
              </label>
              {pay.take && (
                <div className="form-grid">
                  <Field label="Paid by" id="reg-pay-mode">
                    <select id="reg-pay-mode" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="card">Card</option>
                    </select>
                  </Field>
                  <Field label="Amount (₹)" id="reg-pay-amount" error={fields['payment.amountPaise']} hint={`Empty = ${rupees(net)}.`}>
                    <input id="reg-pay-amount" inputMode="decimal" className="tabular" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                  </Field>
                  {pay.mode !== 'cash' && (
                    <Field label="UPI or card reference (optional)" id="reg-pay-ref">
                      <input id="reg-pay-ref" maxLength={80} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
                    </Field>
                  )}
                </div>
              )}
            </fieldset>
            <table className="bill-sums">
              <tbody>
                <tr>
                  <th scope="row">Paid now</th>
                  <td>{rupees(pay.take ? Math.min(amount, net) : 0)}</td>
                </tr>
                <tr className="bill-balance">
                  <th scope="row">Balance</th>
                  <td>{rupees(balance)}</td>
                </tr>
              </tbody>
            </table>
            <button type="button" className="btn btn-primary lab-reg-save" disabled={!ready || busy} onClick={save}>
              {pay.take && amount > 0 ? <TestTube aria-hidden="true" /> : <UserPlus aria-hidden="true" />} {busy ? 'Saving…' : pay.take && amount > 0 ? 'Save and print receipt' : 'Save registration'}
            </button>
            <Link to="/lab/dashboard" className="btn btn-link">
              Cancel
            </Link>
          </aside>
        </div>
      </div>
    </>
  );
}
