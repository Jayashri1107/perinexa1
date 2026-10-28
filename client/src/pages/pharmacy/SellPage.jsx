import { useEffect, useRef, useState } from 'react';
import { BedDouble, ClipboardList, Receipt, Stethoscope, Trash2, UserPlus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { cleanGstin, gstinProblem, gstinState } from './gstin.js';
import { CONTROLLED, FREQUENCY_WORDS, MODE_LABELS, einvoiceHsnOk, expiryLabel, medicineLabel, prescribedLines, scannedForList } from './pharmacyFormat.js';
import { FindMedicine, PharmacyHeader, ScheduleMark, money, useSend } from './pharmacyUi.jsx';
import { FindElsewhere, TypePill } from './RegisterPage.jsx';

// Pharmacy → New bill (counter) and → Issue to ward (kind 'issue', admitted patients only): choose OPD, IPD or External
// (owner, 26 Oct 2026) – an OPD patient from today's register (or found by her number or phone), an admitted patient,
// or a walk-in customer – or come from the Daily register with her already chosen, take medicines from her prescription or find them on the stock list, choose
// quantities (batches: the earliest-expiring first unless one is chosen), then make the GST tax invoice. A registered
// patient's invoice goes on her hospital bill; a walk-in pays here. A walk-in sale may be to a business that gives its
// GSTIN (its details go on the tax invoice, and the hospital admin can download an e-invoice file for it).

const NEEDS_RX = ['H', 'H1', 'X', 'narcotic'];

/** Today's OPD patients from the daily register (never the whole patient list), and finding someone from another day. */
function TodayOpdPicker({ onPick }) {
  const navigate = useNavigate();
  const res = useFetch('/pharmacy/register');
  const opd = (res.data?.rows ?? []).filter((r) => r.type === 'opd');
  return (
    <>
      <FindElsewhere bare onPick={({ type, patient }) => (type === 'ipd' ? navigate('/pharmacy/issue', { state: { patient } }) : onPick(patient))} onOpenBill={(id) => navigate(`/pharmacy/invoices/${id}`)} />
      <h3 className="ph-today-title">Today's OPD patients</h3>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {res.data && !opd.length && <p className="muted">No OPD patient on today's register yet.</p>}
      <ul className="appt-pick-list" aria-label="Today's OPD patients">
        {opd.map((r) => (
          <li key={r.patient.id}>
            <button type="button" className="appt-pick" onClick={() => onPick(r.patient)}>
              <strong>{r.patient.fullName}</strong>
              <span className="muted">
                {[r.patient.mrn, r.doctor, r.prescription ? 'prescription written today' : 'no prescription yet', r.bills.length ? `billed ${r.bills.map((b) => b.number).join(', ')}` : ''].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function BatchPicker({ line, onChange }) {
  const res = useFetch(`/pharmacy/medicines/${line.medicine.id}/batches`);
  const batches = res.data?.batches ?? [];
  return (
    <select aria-label={`Batch of ${line.medicine.name}`} value={line.batchId ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Earliest expiry first</option>
      {batches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.batch} · exp {expiryLabel(b.expiry)} · {b.qtyLeft} left · MRP {money(b.mrpPaise)}
          {b.daysLeft <= (res.data?.warnDays ?? 30) ? ' · expires soon' : ''}
        </option>
      ))}
    </select>
  );
}

function Prescriptions({ patientId, onUse, chosenVisit, useFirst = null }) {
  const res = useFetch(`/pharmacy/patients/${patientId}/prescriptions`);
  // "Bill the prescription" on the register: that prescription goes on the bill by itself, once
  const used = useRef(false);
  const first = useFirst && res.data && !res.data.patient?.duplicateOf && !res.data.patient?.closed ? res.data.prescriptions.find((rx) => rx.visitId === useFirst) : null;
  useEffect(() => {
    if (!first || used.current) return;
    used.current = true;
    onUse(first);
  }, [first, onUse]);
  if (res.error) return <Alert type="error">{res.error}</Alert>;
  if (!res.data) return <p className="muted">Loading her prescriptions…</p>;
  // A record marked as a duplicate takes no sale: the pharmacist is sent to her main record, where the
  // prescriptions written on this record can be chosen too
  if (res.data.patient?.duplicateOf) {
    return (
      <Alert type="warning">
        This record ({res.data.patient.mrn}) is marked as a duplicate of {res.data.patient.duplicateOf.mrn} and takes no new sale. Press "Choose someone else" and find{' '}
        {res.data.patient.duplicateOf.mrn}: her prescriptions written on this record are listed there too.
      </Alert>
    );
  }
  // A closed record takes no counter sale (never said why)
  if (res.data.patient?.closed) {
    return <Alert type="info">This record ({res.data.patient.mrn}) is closed and takes no new sale at the counter. Press "Choose someone else".</Alert>;
  }
  if (!res.data.prescriptions.length) return <p className="muted">No prescriptions in Perinexa. Add medicines from the stock list below.</p>;
  return (
    <ul className="appt-lines">
      {res.data.prescriptions.map((rx) => (
        <li key={rx.visitId} className={chosenVisit === rx.visitId ? 'ph-rx is-chosen' : 'ph-rx'}>
          <div className="row-between">
            <strong>
              {dayLabel(rx.date)}
              {rx.doctor ? ` · ${rx.doctor.name}${rx.doctor.reg ? ` (Reg. ${rx.doctor.reg})` : ''}` : ''}
              {/* Written on a record that was marked as a duplicate of hers: the paper carries that number */}
              {rx.fromRecord ? ` · written on her earlier record ${rx.fromRecord}` : ''}
            </strong>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onUse(rx)}>
              <ClipboardList aria-hidden="true" /> {chosenVisit === rx.visitId ? 'Using this one' : 'Use this prescription'}
            </button>
          </div>
          <ul className="ph-rx-items">
            {rx.items.map((it) => (
              <li key={it.id}>
                {it.drug} {it.strength} – {it.dose} {FREQUENCY_WORDS[it.frequency] || it.frequencyText}
                {it.durationValue ? `, ${it.durationValue} ${it.durationUnit}` : ''}
                <span className="muted"> · {it.matches.length ? `on the list: ${it.matches.map((m) => `${m.name} (${m.inStock})`).join(', ')}` : 'not on the stock list'}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * A walk-in sale to a business that gives its GSTIN: a tick box, then the business's name, GSTIN, address, town and
 * PIN code. The state is read from the GSTIN's first two digits. Never for a patient.
 */
export function BusinessBuyerFields({ business, setBusiness, buyer, setBuyer, errors = {} }) {
  const buyerState = gstinState(buyer.gstin);
  const gstinError = buyer.gstin.trim() && cleanGstin(buyer.gstin).length >= 15 ? gstinProblem(buyer.gstin) : null;
  return (
    <div className="ph-buyer">
      <label className="appt-reason">
        <input type="checkbox" checked={business} onChange={(e) => setBusiness(e.target.checked)} /> The buyer is a business that gives its GSTIN
      </label>
      <p className="hint">Only for a business – another hospital, a clinic or a chemist – that wants its GSTIN on the tax invoice. Never for a patient: sales to patients need no GSTIN and no e-invoice.</p>
      {business && (
        <div className="form-grid">
          <Field label="Business name (as on its GST certificate)" id="ph-buyer-name" error={errors['buyer.name']}>
            <input id="ph-buyer-name" value={buyer.name} maxLength={100} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
          </Field>
          <Field
            label="GSTIN"
            id="ph-buyer-gstin"
            error={errors['buyer.gstin'] ?? gstinError}
            keepHint
            hint={buyerState ? `State: ${buyerState.name} (${buyerState.code}) – read from the GSTIN.` : '15 characters, for example 27ABCDE1234F1Z0. The state is read from it.'}
          >
            <input id="ph-buyer-gstin" value={buyer.gstin} maxLength={20} autoComplete="off" spellCheck={false} onChange={(e) => setBuyer({ ...buyer, gstin: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Address" id="ph-buyer-address" error={errors['buyer.address']}>
            <input id="ph-buyer-address" value={buyer.address} maxLength={200} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} />
          </Field>
          <Field label="City or town" id="ph-buyer-place" error={errors['buyer.place']}>
            <input id="ph-buyer-place" value={buyer.place} maxLength={50} onChange={(e) => setBuyer({ ...buyer, place: e.target.value })} />
          </Field>
          <Field label="PIN code" id="ph-buyer-pin" error={errors['buyer.pin']}>
            <input id="ph-buyer-pin" inputMode="numeric" value={buyer.pin} maxLength={6} onChange={(e) => setBuyer({ ...buyer, pin: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  );
}
/**
 * A sale to a business may need an e-invoice, and the e-invoice portal takes HSN codes of 6 or 8 digits only: said
 * before the invoice is made, naming the medicines whose code is shorter or missing. It never stops the sale.
 */
export function ShortHsnWarning({ medicines }) {
  const short = [...new Set(medicines.filter((m) => !einvoiceHsnOk(m.hsn)).map((m) => m.name))];
  if (!short.length) return null;
  return (
    <Alert type="warning">
      The e-invoice portal takes an HSN code of 6 or 8 digits. {short.join(', ')} {short.length === 1 ? 'has' : 'have'} a shorter code or none. If this business needs an e-invoice, write the longer code under Medicines. The invoice can be made
      now and the code changed afterwards.
    </Alert>
  );
}
/** Is everything needed about the business buyer filled in (the server checks again)? */
export const buyerComplete = (buyer) => buyer.name.trim().length >= 3 && Boolean(gstinState(buyer.gstin)) && buyer.address.trim().length >= 3 && buyer.place.trim().length >= 3 && /^[1-9]\d{5}$/.test(buyer.pin.trim());

export function SellPage({ kind = 'sale' }) {
  const navigate = useNavigate();
  // From the Daily register: { patient } already chosen, or { type: 'external' }
  const start = useLocation().state ?? {};
  const issue = kind === 'issue';
  const inpatients = useFetch(issue ? '/pharmacy/inpatients' : null);
  const [who, setWho] = useState(issue ? 'inpatient' : start.type === 'external' ? 'walkin' : 'patient'); // patient (OPD) | walkin (External) | inpatient (IPD)
  const [patient, setPatient] = useState(start.patient ?? null);
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [visitId, setVisitId] = useState(null);
  const [doctor, setDoctor] = useState({ name: '', reg: '' });
  const [rxSeen, setRxSeen] = useState(false);
  const [lines, setLines] = useState([]); // { key, medicine, qty, batchId }
  const [discount, setDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [business, setBusiness] = useState(false);
  const [buyer, setBuyer] = useState({ name: '', gstin: '', address: '', place: '', pin: '' });
  const s = useSend((res) => navigate(`/pharmacy/invoices/${res.invoice.id}`, { state: { flash: `Invoice ${res.invoice.number} made.` } }));

  const addMedicine = (m, qty = 1) => setLines((ls) => (ls.some((l) => l.medicine.id === m.id) ? ls : [...ls, { key: `${m.id}-${Date.now()}`, medicine: m, qty: String(qty), batchId: null }]));
  // The doctor's prescription on the bill (owner's developer, 28 Oct 2026): its medicines are marked `prescribed` and
  // cannot be taken off – only their quantity and batch change; medicines the pharmacist adds can be. Another
  // prescription chosen replaces the last one's medicines.
  const useRx = (rx) => {
    setVisitId(rx.visitId);
    setRxSeen(false);
    setDoctor(rx.doctor ?? { name: '', reg: '' });
    setLines((ls) => prescribedLines(ls, rx));
  };
  const reset = () => {
    setPatient(null);
    setVisitId(null);
    setLines([]);
    setDoctor({ name: '', reg: '' });
    setRxSeen(false);
  };
  // A scanned (or typed) barcode: the medicine goes on the list like one found by name
  const scan = (m) => {
    const out = scannedForList(m, lines.some((l) => l.medicine.id === m.id));
    if (out.add) addMedicine(m);
    return out.said;
  };
  const isBusiness = who === 'walkin' && business;
  const buyerOk = buyerComplete(buyer);

  const needsRx = lines.some((l) => NEEDS_RX.includes(l.medicine.schedule));
  const controlled = lines.some((l) => CONTROLLED.includes(l.medicine.schedule));
  const pct = discount === '' ? 0 : Number(discount);
  const qtyOk = lines.length > 0 && lines.every((l) => /^\d+$/.test(l.qty) && Number(l.qty) > 0);
  const whoOk = who === 'walkin' ? customer.name.trim().length >= 2 : Boolean(patient);
  const ready = qtyOk && whoOk && (!isBusiness || buyerOk) && (pct === 0 || discountReason.trim().length >= 3) && pct >= 0 && pct <= 100;

  const submit = () => {
    const body = {
      kind,
      ...(who === 'walkin' ? { customer: { name: customer.name.trim(), phone: customer.phone.trim() }, payment: { mode, reference: reference.trim() } } : { patientId: patient.id }),
      ...(isBusiness ? { buyer: { name: buyer.name.trim(), gstin: cleanGstin(buyer.gstin), address: buyer.address.trim(), place: buyer.place.trim(), pin: buyer.pin.trim() } } : {}),
      ...(visitId ? { visitId } : {}),
      ...(!visitId && (doctor.name.trim() || doctor.reg.trim()) ? { doctor: { name: doctor.name.trim(), reg: doctor.reg.trim() } } : {}),
      rxSeen: !visitId && rxSeen,
      lines: lines.map((l) => ({ medicineId: l.medicine.id, qty: Number(l.qty), ...(l.batchId ? { batchId: l.batchId } : {}) })),
      discountPercent: pct,
      discountReason: discountReason.trim(),
    };
    s.send('/pharmacy/invoices', body);
  };

  return (
    <>
      <PharmacyHeader title={issue ? 'Issue to an admitted patient' : 'New bill'} crumb={issue ? 'Issue to ward' : 'New bill'} />
      <div className="pf-content bill-page">
        <Alert type="error" onClose={() => s.setError(null)}>
          {s.error}
        </Alert>

        <section className="card bill-section" aria-labelledby="ph-who">
          <h2 id="ph-who">Who is it for</h2>
          {!patient && (
            <div className="segmented" role="group" aria-label="Type of patient">
              <button type="button" aria-pressed={who === 'patient'} onClick={() => (issue ? navigate('/pharmacy') : setWho('patient'))}>
                <Stethoscope aria-hidden="true" /> OPD patient
              </button>
              <button type="button" aria-pressed={who === 'inpatient'} onClick={() => !issue && navigate('/pharmacy/issue')}>
                <BedDouble aria-hidden="true" /> IPD patient
              </button>
              <button
                type="button"
                aria-pressed={who === 'walkin'}
                onClick={() => {
                  if (issue) return navigate('/pharmacy', { state: { type: 'external' } });
                  setWho('walkin');
                  reset();
                }}
              >
                <UserPlus aria-hidden="true" /> External (walk-in)
              </button>
            </div>
          )}
          {who === 'patient' && !patient && <TodayOpdPicker onPick={setPatient} />}
          {who === 'inpatient' && !patient && (
            <>
              {inpatients.error && <Alert type="error">{inpatients.error}</Alert>}
              {inpatients.data && !inpatients.data.inpatients.length && <p className="muted">Nobody is admitted.</p>}
              <ul className="appt-pick-list">
                {(inpatients.data?.inpatients ?? []).map((x) => (
                  <li key={x.patient.id}>
                    <button type="button" className="appt-pick" onClick={() => setPatient(x.patient)}>
                      <strong>
                        <BedDouble aria-hidden="true" /> {x.patient.fullName}
                      </strong>
                      <span className="muted">
                        {x.patient.mrn} · {x.ward || 'Ward not given'}
                        {x.bed ? `, bed ${x.bed}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {patient && (
            <div className="appt-chosen">
              <TypePill type={issue ? 'ipd' : 'opd'} />
              <strong>{patient.fullName}</strong>
              <span className="muted">
                {patient.mrn}
                {patient.phone ? ` · ${patient.phone}` : ''}
              </span>
              <button type="button" className="btn btn-link btn-sm" onClick={reset}>
                Choose someone else
              </button>
            </div>
          )}
          {who === 'walkin' && (
            <>
              <div className="form-grid">
                <Field label={business ? 'Name of the person collecting' : "Customer's name"} id="ph-cust-name" error={s.fields['customer.name']}>
                  <input id="ph-cust-name" value={customer.name} maxLength={150} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
                </Field>
                <Field label="Phone (optional)" id="ph-cust-phone">
                  <input id="ph-cust-phone" type="tel" value={customer.phone} maxLength={30} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
                </Field>
              </div>
              <BusinessBuyerFields business={business} setBusiness={setBusiness} buyer={buyer} setBuyer={setBuyer} errors={s.fields} />
            </>
          )}
        </section>

        {patient && (
          <section className="card bill-section" aria-labelledby="ph-rx">
            <h2 id="ph-rx">Her prescriptions</h2>
            <Prescriptions patientId={patient.id} onUse={useRx} chosenVisit={visitId} useFirst={start.patient?.id === patient.id ? (start.visitId ?? null) : null} />
          </section>
        )}

        {(patient || who === 'walkin') && (
          <section className="card bill-section" aria-labelledby="ph-lines">
            <h2 id="ph-lines">Medicines</h2>
            <FindMedicine onPick={(m) => addMedicine(m)} onScan={scan} />
            {lines.length > 0 && (
              <table className="bill-lines ph-lines">
                <thead>
                  <tr>
                    <th scope="col">Medicine</th>
                    <th scope="col">Batch</th>
                    <th scope="col" className="num">
                      Quantity
                    </th>
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td data-label="Medicine">
                        {medicineLabel(l.medicine)} <ScheduleMark schedule={l.medicine.schedule} />
                        <span className="muted"> · {l.medicine.inStock} in stock</span>
                        {l.prescribed && l.medicine.inStock < Number(l.qty) && <span className="field-error ph-prescribed-short">Not enough in stock: it stays on the bill, so the invoice can be made once it is received.</span>}
                      </td>
                      <td data-label="Batch">
                        <BatchPicker line={l} onChange={(batchId) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, batchId } : x)))} />
                      </td>
                      <td data-label="Quantity" className="num">
                        <input className="bill-price-input" inputMode="numeric" aria-label={`Quantity of ${l.medicine.name}`} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} />
                      </td>
                      <td>
                        {l.prescribed ? (
                          <span className="ph-prescribed" title="Prescribed by the doctor: it stays on the bill. Change the quantity or the batch.">
                            <ClipboardList aria-hidden="true" /> Prescribed
                          </span>
                        ) : (
                          <button type="button" className="icon-btn" aria-label={`Remove ${l.medicine.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                            <Trash2 aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {isBusiness && <ShortHsnWarning medicines={lines.map((l) => l.medicine)} />}
            {!visitId && (needsRx || who === 'walkin') && (
              <div className="ph-rx-seen">
                <p className="hint">{controlled ? 'A narcotic or Schedule X medicine: the doctor’s registration number is required, and it is given only to a registered patient.' : needsRx ? 'A prescription medicine: write the doctor’s name and tick that you saw the prescription.' : 'If there is a prescription, write the doctor’s name.'}</p>
                <div className="form-grid">
                  <Field label="Doctor's name" id="ph-doc-name">
                    <input id="ph-doc-name" value={doctor.name} maxLength={150} onChange={(e) => setDoctor({ ...doctor, name: e.target.value })} />
                  </Field>
                  <Field label="Registration number" id="ph-doc-reg">
                    <input id="ph-doc-reg" value={doctor.reg} maxLength={60} onChange={(e) => setDoctor({ ...doctor, reg: e.target.value })} />
                  </Field>
                </div>
                <label className="appt-reason">
                  <input type="checkbox" checked={rxSeen} onChange={(e) => setRxSeen(e.target.checked)} /> I have seen the prescription
                </label>
              </div>
            )}
            {visitId && (
              <p className="hint">
                From her Perinexa prescription{doctor.name ? ` by ${doctor.name}` : ''}
                {doctor.reg ? ` (Reg. ${doctor.reg})` : ''}.
              </p>
            )}
          </section>
        )}

        {lines.length > 0 && (
          <section className="card bill-section" aria-labelledby="ph-pay">
            <h2 id="ph-pay">{who === 'walkin' ? 'Payment' : 'Discount'}</h2>
            <div className="form-grid">
              <Field label="Discount (%) – optional" id="ph-disc" error={s.fields.discountPercent}>
                <input id="ph-disc" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              {pct > 0 && (
                <Field label="Reason for the discount" id="ph-disc-reason" error={s.fields.discountReason}>
                  <input id="ph-disc-reason" value={discountReason} maxLength={200} onChange={(e) => setDiscountReason(e.target.value)} />
                </Field>
              )}
              {who === 'walkin' && (
                <>
                  <Field label="Paid by" id="ph-mode">
                    <select id="ph-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                      {Object.entries(MODE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {mode !== 'cash' && (
                    <Field label="Reference (optional)" id="ph-ref">
                      <input id="ph-ref" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
                    </Field>
                  )}
                </>
              )}
            </div>
            <p className="hint">
              {who === 'walkin'
                ? 'The customer pays the invoice total here.'
                : issue
                  ? 'The invoice goes on her stay’s bill.'
                  : 'The invoice goes on her hospital bill; she pays at the billing desk.'}{' '}
              Prices are the batch MRP (GST included).
            </p>
            <button type="button" className="btn btn-primary" disabled={!ready || s.busy} onClick={submit}>
              <Receipt aria-hidden="true" /> {s.busy ? 'Making the invoice…' : issue ? 'Issue and make the invoice' : 'Make the invoice'}
            </button>
          </section>
        )}
      </div>
    </>
  );
}
