import { Fragment, useEffect, useRef, useState } from 'react';
import { BedDouble, TriangleAlert, CalendarClock, CalendarDays, CircleCheck, CircleX, ClipboardList, Minus, PackageX, Plus, Receipt, Stethoscope, Trash2, UserPlus, UserRound } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { cleanGstin, gstinProblem, gstinState } from './gstin.js';
import { CONTROLLED, FREQUENCY_WORDS, allergyClash, einvoiceHsnOk, expiryLabel, givenLine, inPacks, looseProblem, medicineLabel, prescribedLines, priceOf, scannedForList } from './pharmacyFormat.js';
import { allergyStatus } from '../patients/patientFormat.js';
import { HighAlertPill } from './MedicineMarks.jsx';
import { OtherBrandsDialog } from './Substitutes.jsx';
import { BatchGrid, PaymentWindow } from './CounterParts.jsx';
import { BarcodeBox, MedicineFinder, PharmacyHeader, ScheduleMark, money, useSend } from './pharmacyUi.jsx';
import { KitPicker, kitShortfall } from './Kits.jsx';
import { FindElsewhere, TypePill, billsPlace, useClickOrDouble } from './RegisterPage.jsx';

// Pharmacy → New bill (counter) and → Issue to ward (kind 'issue', admitted patients only): choose OPD, IPD or External
// (owner, 26 Oct 2026) – an OPD patient from today's register (or found by her number or phone), an admitted patient,
// or a walk-in customer – or come from the Daily register with her already chosen, take medicines from her prescription or find them on the stock list, choose
// quantities (batches: the earliest-expiring first unless one is chosen), then make the GST tax invoice. A registered
// patient's invoice goes on her hospital bill; a walk-in pays here. A walk-in sale may be to a business that gives its
// GSTIN (its details go on the tax invoice, and the hospital admin can download an e-invoice file for it).

const NEEDS_RX = ['H', 'H1', 'X', 'narcotic'];

// The dose and quantity boxes offer a list to choose from (6 Nov 2026) and still take anything typed. The doses are the
// prescription's own frequencies (pharmacyFormat.js FREQUENCY_WORDS): "1-0-1 (twice a day)", "SOS (when needed)" …
export const DOSE_CHOICES = Object.entries(FREQUENCY_WORDS)
  .filter(([k]) => k !== 'custom')
  .map(([k, words]) => {
    if (/^[\d-]+$/.test(k)) return `${k} (${words})`;
    if (words.toLowerCase().startsWith(k)) return words[0].toUpperCase() + words.slice(1); // weekly, alternate days
    return `${k.toUpperCase()} (${words})`; // SOS, STAT
  });

// The bill's total at MRP (before any discount), and the hospital's date and time for the top of the bill
// PH2: a line bought by the pack is priced from the pack's MRP (pharmacyFormat.js priceOf)
const grossOf = (lines) => lines.reduce((n, l) => n + (/^\d+$/.test(l.qty) ? (priceOf(l, Number(l.qty)) ?? 0) : 0), 0);
// PH2: the batch's pack price, kept on a line (packMrpPaise, unitsPerPack) – none for a batch bought by the unit
const packOf = (b) => ({ packMrpPaise: b?.packMrpPaise ?? null, unitsPerPack: b?.unitsPerPack ?? null });
const nowStamp = () => {
  const d = new Date();
  const date = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
  return { date, time };
};

// The patient's initials for the round badge on the bill: "Madhavi Patil" → "MP"
const initialsOf = (name = '') =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '·';

const OWN = '__own';
/**
 * A drop-down that opens on a click, with "Type another…" for anything not on the list (then a box, and "List" to go
 * back). value/onChange: the text; choices: the list; placeholder: the first, empty choice.
 */
export function ChoiceBox({ value, onChange, choices, placeholder, label, ownLabel = 'Type another…', inputMode, maxLength = 60, onEnter, autoFocus = false, className = '' }) {
  const listed = value === '' || choices.map(String).includes(String(value));
  const [typing, setTyping] = useState(!listed);
  const [switched, setSwitched] = useState(false); // chosen "Type another…" just now: the box takes the cursor
  if (typing || !listed) {
    return (
      <span className={`ph-choice ph-choice-own ${className}`}>
        <input aria-label={label} inputMode={inputMode} value={value} maxLength={maxLength} autoFocus={switched} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} />
        <button
          type="button"
          className="btn btn-link btn-sm"
          onClick={() => {
            setTyping(false);
            onChange('');
          }}
        >
          List
        </button>
      </span>
    );
  }
  return (
    <select
      className={`ph-choice ${className}`}
      aria-label={label}
      value={String(value)}
      autoFocus={autoFocus}
      onChange={(e) => {
        if (e.target.value === OWN) {
          setTyping(true);
          setSwitched(true);
          onChange('');
        } else onChange(e.target.value);
      }}
      onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
    >
      <option value="">{placeholder}</option>
      {choices.map((c) => (
        <option key={c} value={String(c)}>
          {c}
        </option>
      ))}
      <option value={OWN}>{ownLabel}</option>
    </select>
  );
}

/**
 * Today's OPD patients from the daily register, finding someone from another day, and – the owner's approval of 9 Nov
 * 2026 – every OPD patient from the first registration to today below them (a page at a time, narrowed by what is typed).
 * onPickIpd: someone found who is admitted (else the Issue to ward page opens with her).
 */
export function TodayOpdPicker({ onPick, onPickIpd = null, slim = false }) {
  const navigate = useNavigate();
  const res = useFetch('/pharmacy/register');
  const [text, setText] = useState('');
  const clicks = useClickOrDouble();
  const term = text.trim().toLowerCase();
  const opd = (res.data?.rows ?? []).filter((r) => r.type === 'opd').filter((r) => !term || [r.patient.fullName, r.patient.mrn, r.patient.phone, r.opdNo].some((v) => v && String(v).toLowerCase().includes(term)));
  return (
    <>
      <FindElsewhere bare={!slim} slim={slim} onPick={({ type, patient }) => (type === 'ipd' ? (onPickIpd ? onPickIpd(patient) : navigate('/pharmacy/issue', { state: { patient } })) : onPick(patient))} onOpenBills={(patient) => navigate(...billsPlace(patient))} onOpenBill={(id) => navigate(`/pharmacy/invoices/${id}`)} onText={setText} />
      <h3 className="ph-today-title">Today's OPD patients</h3>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {res.data && !opd.length && <p className="muted">{term ? "Nobody on today's list matches." : "No OPD patient on today's register yet."}</p>}
      <ul className="appt-pick-list" aria-label="Today's OPD patients">
        {opd.map((r) => (
          <li key={r.patient.id}>
            <button type="button" className="appt-pick" title="Double-click to open their bills" {...clicks(() => onPick(r.patient), () => navigate(...billsPlace(r.patient)))}>
              <strong>{r.patient.fullName}</strong>
              <span className="muted">
                {[r.patient.mrn, r.doctor, r.prescription ? 'prescription written today' : 'no prescription yet', r.bills.length ? `billed ${r.bills.map((b) => b.number).join(', ')}` : ''].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <AllOpdPatients term={term} onPick={onPick} skip={new Set(opd.map((r) => r.patient.id))} />
    </>
  );
}

/** Every OPD patient, from the first registration to today (owner's approval, 9 Nov 2026): name and number, newest first. */
function AllOpdPatients({ term, onPick, skip }) {
  const [pages, setPages] = useState(1);
  const search = term.length >= 2 ? term : '';
  const res = useFetch('/pharmacy/invoices/people', { type: 'opd', ...(search ? { search } : {}), ...(pages > 1 && !search ? { pages } : {}) });
  const people = (res.data?.people ?? []).filter((x) => x.mrn && !skip.has(x.key));
  return (
    <>
      <h3 className="ph-today-title">All OPD patients</h3>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {res.data && !people.length && <p className="muted">{search ? 'Nobody matches.' : 'No OPD patient yet.'}</p>}
      <ul className="appt-pick-list ph-all-opd" aria-label="All OPD patients">
        {people.map((x) => (
          <li key={x.key}>
            <button type="button" className="appt-pick" onClick={() => onPick({ id: x.key, fullName: x.name, mrn: x.mrn })}>
              <strong>{x.name}</strong>
              <span className="muted">{[x.mrn, x.billCount ? `${x.billCount} pharmacy bill${x.billCount === 1 ? '' : 's'}` : 'No pharmacy bill yet'].join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
      {res.data?.more && !search && (
        <button type="button" className="btn btn-secondary btn-sm" disabled={res.loading} onClick={() => setPages((n) => n + 1)}>
          {res.loading ? 'Loading…' : 'Show more'}
        </button>
      )}
    </>
  );
}

/** The admitted patients, with a search by name, number, ward or bed (an issue to the ward is for them only). */
export function InpatientPicker({ onPick }) {
  const inpatients = useFetch('/pharmacy/inpatients');
  const [text, setText] = useState('');
  const term = text.trim().toLowerCase();
  const all = inpatients.data?.inpatients ?? [];
  const shown = all.filter((x) => !term || [x.patient.fullName, x.patient.mrn, x.patient.phone, x.ward, x.bed].some((v) => v && String(v).toLowerCase().includes(term)));
  return (
    <>
      <input type="search" className="bill-search-plain" aria-label="Find an admitted patient" placeholder="Name, number, ward or bed" value={text} onChange={(e) => setText(e.target.value)} />
      {inpatients.error && <Alert type="error">{inpatients.error}</Alert>}
      {inpatients.data && !shown.length && <p className="muted">{term && all.length ? 'Nobody admitted matches.' : 'Nobody is admitted.'}</p>}
      <ul className="appt-pick-list" aria-label="Admitted patients">
        {shown.map((x) => (
          <li key={x.patient.id}>
            <button type="button" className="appt-pick" onClick={() => onPick(x.patient)}>
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
  );
}

function BatchPicker({ line, onChange, onPrice = null }) {
  const res = useFetch(`/pharmacy/medicines/${line.medicine.id}/batches`);
  const batches = res.data?.batches ?? [];
  // The MRP and expiry of the batch chosen, else of the one sold first (earliest expiry), for the row
  const shown = batches.find((b) => b.id === line.batchId) ?? batches[0];
  const mrp = shown?.mrpPaise ?? null;
  const expiry = shown?.expiry ?? null;
  useEffect(() => {
    if (onPrice && (mrp !== (line.mrpPaise ?? null) || expiry !== (line.expiry ?? null))) onPrice({ mrpPaise: mrp, expiry, ...packOf(shown) });
  }, [mrp, expiry, line.mrpPaise, line.expiry, onPrice]);
  return (
    <select className="ph-batch" aria-label={`Batch of ${line.medicine.name}`} value={line.batchId ?? ''} onChange={(e) => onChange(e.target.value || null)}>
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

/** PH7: her allergy line on the counter – the allergy, "None known", or "Not recorded – ask". */
function AllergyLine({ text }) {
  if (text == null) return null;
  const status = allergyStatus(text);
  if (status === 'recorded') {
    return (
      <p className="ph-allergy is-recorded">
        <TriangleAlert aria-hidden="true" /> <strong>Allergies:</strong> {text}
      </p>
    );
  }
  return <p className="ph-allergy">{status === 'none' ? 'Allergies: none known.' : 'Allergies: not recorded – ask her.'}</p>;
}

function Prescriptions({ patientId, onUse, chosenVisit, useFirst = null, onAllergies = null }) {
  const res = useFetch(`/pharmacy/patients/${patientId}/prescriptions`);
  // PH7: her allergy line goes up to the counter (warnings on the bill's lines)
  const allergyText = res.data?.patient?.allergies?.text;
  const allergyKnown = Boolean(res.data);
  useEffect(() => {
    if (allergyKnown && onAllergies) onAllergies(allergyText ?? '');
  }, [allergyKnown, allergyText, onAllergies]);
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
        This record ({res.data.patient.mrn}) is marked as a duplicate of {res.data.patient.duplicateOf.mrn} and takes no new sale. Press "Change" and find{' '}
        {res.data.patient.duplicateOf.mrn}: her prescriptions written on this record are listed there too.
      </Alert>
    );
  }
  // A closed record takes no counter sale (never said why)
  if (res.data.patient?.closed) {
    return <Alert type="info">This record ({res.data.patient.mrn}) is closed and takes no new sale at the counter. Press "Change".</Alert>;
  }
  if (!res.data.prescriptions.length) return <p className="muted ph-rx-none">No prescription in Perinexa. Add the medicines on the right.</p>;
  // Each prescription a small card (7 Nov 2026): the day and doctor, each medicine with how it is taken and whether the
  // stock list has it, and one button to put it on the bill
  return (
    <ul className="ph-rx-list">
      {res.data.prescriptions.map((rx) => {
        const chosen = chosenVisit === rx.visitId;
        return (
          <li key={rx.visitId} className={chosen ? 'ph-rx-card is-chosen' : 'ph-rx-card'}>
            <div className="ph-rx-card-head">
              <span className="ph-rx-date">
                <CalendarDays aria-hidden="true" /> {dayLabel(rx.date)}
              </span>
              {rx.doctor && (
                <span className="ph-rx-doc">
                  {rx.doctor.name}
                  {rx.doctor.reg ? ` · Reg. ${rx.doctor.reg}` : ''}
                </span>
              )}
            </div>
            {/* Written on a record that was marked as a duplicate of hers: the paper carries that number */}
            {rx.fromRecord && <p className="hint ph-rx-from">Written on her earlier record {rx.fromRecord}</p>}
            <ul className="ph-rx-meds">
              {rx.items.map((it) => (
                <li key={it.id}>
                  <strong>
                    {it.drug} {it.strength}
                  </strong>
                  <span className="ph-rx-how">
                    {it.dose} {FREQUENCY_WORDS[it.frequency] || it.frequencyText}
                    {it.durationValue ? `, ${it.durationValue} ${it.durationUnit}` : ''}
                  </span>
                  {/* PH6: what was already given from this line */}
                  {givenLine(it) && <span className={`ph-rx-given${it.givenInFull ? ' is-full' : ''}`}>{givenLine(it)}</span>}
                  {it.matches.length ? (
                    <span className="ph-rx-match">
                      <CircleCheck aria-hidden="true" /> In stock: {it.matches.map((m) => `${m.name} (${m.inStock})`).join(', ')}
                    </span>
                  ) : (
                    <span className="ph-rx-match is-missing">
                      <PackageX aria-hidden="true" /> Not on the stock list
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {rx.soldUnlinked?.length > 0 && <p className="hint">Sold from this prescription before: {rx.soldUnlinked.map((x) => `${x.number} on ${x.date}`).join(', ')}.</p>}
            <button type="button" className={`btn btn-sm ph-rx-use ${chosen ? 'btn-secondary is-chosen' : 'btn-secondary'}`} onClick={() => onUse(rx)}>
              {chosen ? <CircleCheck aria-hidden="true" /> : <ClipboardList aria-hidden="true" />} {chosen ? 'On the bill' : 'Use this prescription'}
            </button>
          </li>
        );
      })}
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

/**
 * embedded (Sold, 6 Nov 2026): the same bill inside another page – start gives the patient or { type: 'external' },
 * onMade(invoice) gets the new invoice instead of opening it, onCancel goes back to choosing someone.
 */
export function SellPage({ kind = 'sale', start: given = null, embedded = false, fromList = false, onMade = null, onCancel = null }) {
  const navigate = useNavigate();
  // From the Daily register: { patient } already chosen, or { type: 'external' }
  const routed = useLocation().state;
  const start = given ?? routed ?? {};
  const issue = kind === 'issue';
  const [who, setWho] = useState(issue ? 'inpatient' : start.type === 'external' ? 'walkin' : 'patient'); // patient (OPD) | walkin (External) | inpatient (IPD)
  const [patient, setPatient] = useState(start.patient ?? null);
  const [customer, setCustomer] = useState({ name: start.customer?.name ?? '', phone: start.customer?.phone ?? '' });
  const [visitId, setVisitId] = useState(null);
  // PH7: her allergy line (owner's decision 2: the pharmacist sees her allergies and nothing else of her record)
  const [allergies, setAllergies] = useState(null);
  // PH10: the prescription line whose other brands are being looked at
  const [otherBrands, setOtherBrands] = useState(null);
  const [doctor, setDoctor] = useState({ name: '', reg: '' });
  const [rxSeen, setRxSeen] = useState(false);
  const [lines, setLines] = useState(() =>
    issue && start.wardRequest
      ? start.wardRequest.lines.filter((l) => l.medicine && !l.refused && l.issuedQty < l.qty).map((l) => ({ key: `${l.medicineId}-wr`, medicine: l.medicine, qty: String(l.qty - l.issuedQty), batchId: null, dose: '' }))
      : [],
  ); // { key, medicine, qty, batchId }
  const [kit, setKit] = useState(null); // PH14: the issue was filled from this kit { id, name, note }
  // PH12: answering a ward request – its open lines fill the issue; its doctor is the prescriber
  const [wardRequest, setWardRequest] = useState(issue && start.wardRequest ? start.wardRequest : null);
  const [discount, setDiscount] = useState(''); // Disc % (what the invoice keeps)
  const [discountAmount, setDiscountAmount] = useState(''); // Disc amount in rupees: the % is worked out from it
  const [discountReason, setDiscountReason] = useState('');
  const [paying, setPaying] = useState(null); // the Payment window is open: the invoice about to be made
  const [business, setBusiness] = useState(false);
  const [buyer, setBuyer] = useState({ name: '', gstin: '', address: '', place: '', pin: '' });
  // Saved (9 Nov 2026): the Bill list tab, with this person's bills and the bill's print preview open
  const s = useSend((res) =>
    onMade
      ? onMade(res.invoice)
      : navigate('/pharmacy/invoices', {
          state: { made: { invoice: { id: res.invoice.id, number: res.invoice.number }, name: who === 'walkin' ? res.invoice.customer?.name || customer.name.trim() : (patient?.fullName ?? ''), mrn: who === 'walkin' ? '' : (patient?.mrn ?? ''), type: who === 'walkin' ? 'external' : issue ? 'ipd' : 'opd' } },
        }),
  );

  const addMedicine = (m, qty = 1, dose = '') => setLines((ls) => (ls.some((l) => l.medicine.id === m.id) ? ls : [...ls, { key: `${m.id}-${Date.now()}`, medicine: m, qty: String(qty), batchId: null, dose }]));
  // A medicine taken from its batch list: the same batch again adds to its quantity, another batch is a line of its own
  const addFromBatch = (m, batch, qty, dose) =>
    setLines((ls) => {
      const same = ls.find((l) => l.medicine.id === m.id && (l.batchId === batch.id || (!l.batchId && !l.prescribed)));
      if (same) return ls.map((l) => (l === same ? { ...l, batchId: batch.id, batchNo: batch.batch, mrpPaise: batch.mrpPaise, ...packOf(batch), expiry: batch.expiry, qty: String((Number(l.qty) || 0) + qty), dose: dose || l.dose } : l));
      return [...ls, { key: `${m.id}-${batch.id}-${Date.now()}`, medicine: m, qty: String(qty), batchId: batch.id, batchNo: batch.batch, mrpPaise: batch.mrpPaise, ...packOf(batch), expiry: batch.expiry, dose }];
    });
  // As in the store's earlier software (6 and 7 Nov 2026): choose the medicine from the drop-down, then its batch from
  // the batch list, write the quantity and dose, then Add
  const [entry, setEntry] = useState(null); // { medicine, batch, qty, dose }
  const entryOk = Boolean(entry?.batch) && /^\d+$/.test(entry.qty) && Number(entry.qty) >= 1 && Number(entry.qty) <= entry.batch.qtyLeft && !looseProblem(entry.medicine, Number(entry.qty));
  const [finderKey, setFinderKey] = useState(0); // a new, empty Item name box (with the cursor) after each Add
  const qtyBox = useRef(null);
  // A batch chosen: the cursor goes to Qty, as in the earlier software
  useEffect(() => {
    if (entry?.batch) qtyBox.current?.select();
  }, [entry?.batch]);
  const addEntry = () => {
    if (!entryOk) return;
    addFromBatch(entry.medicine, entry.batch, Number(entry.qty), entry.dose.trim());
    setEntry(null);
    setFinderKey((k) => k + 1);
  };
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
  // Disc % and Disc amount fill each other in (7 Nov 2026): the invoice keeps the %, worked out to 4 places from an amount
  const changePct = (text) => {
    setDiscount(text);
    const n = Number(text);
    setDiscountAmount(text === '' || !Number.isFinite(n) ? '' : ((grossOf(lines) * n) / 10000).toFixed(2));
  };
  const changeAmount = (text) => {
    setDiscountAmount(text);
    const n = Number(text);
    const gross = grossOf(lines);
    setDiscount(text === '' || !Number.isFinite(n) || !gross ? '' : String(Math.round(((n * 100) / gross) * 100 * 10000) / 10000));
  };
  const qtyOk = lines.length > 0 && lines.every((l) => /^\d+$/.test(l.qty) && Number(l.qty) > 0 && !looseProblem(l.medicine, Number(l.qty)));
  // PH6: a prescription line given in full is sold again only with a reason
  const repeatsOk = lines.every((l) => !l.givenInFull || (l.repeatReason ?? '').trim().length >= 3);
  const whoOk = who === 'walkin' ? customer.name.trim().length >= 2 : Boolean(patient);
  const ready = qtyOk && repeatsOk && whoOk && (!isBusiness || buyerOk) && (pct === 0 || discountReason.trim().length >= 3) && pct >= 0 && pct <= 100;

  // Save: the Payment window opens with the bill's figures; its Save makes the invoice (a walk-in with how they paid)
  const bodyOf = () => {
    const body = {
      kind,
      ...(who === 'walkin' ? { customer: { name: customer.name.trim(), phone: customer.phone.trim() } } : { patientId: patient.id }),
      ...(isBusiness ? { buyer: { name: buyer.name.trim(), gstin: cleanGstin(buyer.gstin), address: buyer.address.trim(), place: buyer.place.trim(), pin: buyer.pin.trim() } } : {}),
      ...(visitId ? { visitId } : {}),
      ...(!visitId && (doctor.name.trim() || doctor.reg.trim()) ? { doctor: { name: doctor.name.trim(), reg: doctor.reg.trim() } } : {}),
      rxSeen: !visitId && rxSeen,
      ...(issue && kit ? { kitId: kit.id } : {}),
      ...(issue && wardRequest ? { wardRequestId: wardRequest.id } : {}),
      lines: lines.map((l) => ({
        medicineId: l.medicine.id,
        qty: Number(l.qty),
        ...(l.batchId ? { batchId: l.batchId } : {}),
        ...(l.dose?.trim() ? { dose: l.dose.trim() } : {}),
        // PH6: the prescription line it is sold from (only with her Perinexa prescription), and why again
        ...(visitId && l.rxItemId ? { rxItemId: l.rxItemId, ...(l.givenInFull ? { repeatReason: (l.repeatReason ?? '').trim() } : {}), ...(l.substitution ? { substitution: l.substitution } : {}) } : {}),
      })),
      discountPercent: pct,
      discountReason: discountReason.trim(),
    };
    return body;
  };
  const save = () => {
    s.setError(null);
    setPaying(bodyOf());
  };
  const submit = (payment) => s.send('/pharmacy/invoices', { ...paying, ...payment });

  // Phones, as in the app design (2 Nov 2026): one less, one more beside the quantity
  const onPhone = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 719px)').matches);
  const setQty = (key, qty) => setLines((ls) => ls.map((x) => (x.key === key ? { ...x, qty } : x)));
  const setLine = (key, change) => setLines((ls) => ls.map((x) => (x.key === key ? { ...x, ...change } : x)));
  // Each row's amount at its batch MRP, and the total after the discount (the invoice has the exact figures)
  const rowPaise = (l) => (/^\d+$/.test(l.qty) ? priceOf(l, Number(l.qty)) : null);
  const grossPaise = grossOf(lines);
  const totalPaise = Math.round(grossPaise * (1 - (Number.isFinite(pct) ? pct : 0) / 100));
  // The GST inside the prices (MRP includes GST), after the discount
  const gstPaise = Math.round(lines.reduce((n, l) => n + ((rowPaise(l) ?? 0) * (1 - (Number.isFinite(pct) ? pct : 0) / 100) * l.medicine.gstRate) / (100 + l.medicine.gstRate), 0));
  const entryAmount = entry?.batch && /^\d+$/.test(entry.qty) ? priceOf(entry.batch, Number(entry.qty)) : null;
  const close = embedded && onCancel ? onCancel : () => navigate('/pharmacy/invoices');
  // Medicines added or changed after a discount was given: the % stays, the amount follows it
  useEffect(() => {
    const n = Number(discount);
    if (discount !== '' && Number.isFinite(n)) setDiscountAmount(((grossPaise * n) / 10000).toFixed(2));
  }, [grossPaise]);
  const stepQty = (l, by) => setQty(l.key, String(Math.max(1, (Number(l.qty) || 0) + by)));

  return (
    <>
      {!embedded && <PharmacyHeader title="Sales bill" crumb={issue ? 'Issue to ward' : 'New bill'} subtitle={issue ? 'Issue to ward: medicines for an admitted patient, on her stay’s bill.' : undefined} sales />}
      <div className={embedded ? 'ph-counter is-embedded' : 'pf-content ph-counter'}>
        <Alert type="error" onClose={() => s.setError(null)}>
          {s.error}
        </Alert>
        <div className="ph-counter-main">
          {/* Left, as the store's earlier Sales Bill (7 Nov 2026): the date and time, the bill's net amount, then the patient */}
          <aside className="card ph-counter-left" aria-labelledby="ph-who">
            {/* The bill's header band (7 Nov 2026): what it is, when, and the net amount large */}
            <header className="ph-bill-head">
              <div className="ph-bill-head-row">
                <span className="ph-bill-tag">
                  <Receipt aria-hidden="true" /> {issue ? 'Issue to ward' : 'Sales bill'}
                </span>
                <span className="ph-bill-when tabular">
                  {nowStamp().date} · {nowStamp().time}
                </span>
              </div>
              <span className="ph-bill-net-label">Net amount</span>
              <strong className="ph-bill-net tabular" aria-label="Net amount">
                ₹{(totalPaise / 100).toFixed(2)}
              </strong>
              <span className="ph-bill-count">
                {lines.length ? `${lines.length} medicine${lines.length === 1 ? '' : 's'} · ${lines.reduce((n, l) => n + (Number(l.qty) || 0), 0)} units` : 'No medicine yet'}
              </span>
            </header>

            <div className="ph-counter-body">
              {!patient && !embedded && !fromList && (
                <div className="ph-type-tabs" role="radiogroup" aria-label="Type of patient">
                  <button type="button" role="radio" aria-checked={who === 'patient'} onClick={() => (issue ? navigate('/pharmacy') : setWho('patient'))}>
                    <Stethoscope aria-hidden="true" /> OPD
                  </button>
                  <button type="button" role="radio" aria-checked={who === 'inpatient'} onClick={() => !issue && navigate('/pharmacy/issue')}>
                    <BedDouble aria-hidden="true" /> IPD
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={who === 'walkin'}
                    onClick={() => {
                      if (issue) return navigate('/pharmacy', { state: { type: 'external' } });
                      setWho('walkin');
                      reset();
                    }}
                  >
                    <UserPlus aria-hidden="true" /> External
                  </button>
                </div>
              )}

              <div className="ph-section-row">
                <h2 id="ph-who" className="ph-section-label">
                  Patient
                </h2>
                {(patient || (fromList && who === 'walkin')) && (
                  <button type="button" className="btn btn-link btn-sm ph-person-change" onClick={(embedded || fromList) && onCancel ? onCancel : reset}>
                    Change
                  </button>
                )}
              </div>
              {who === 'patient' && !patient && <TodayOpdPicker slim onPick={setPatient} />}
              {who === 'inpatient' && !patient && <InpatientPicker onPick={setPatient} />}
              {patient && (
                <div className="ph-person">
                  <span className="ph-person-avatar" aria-hidden="true">
                    {initialsOf(patient.fullName)}
                  </span>
                  <div className="ph-person-main">
                    <strong className="ph-person-name">{patient.fullName}</strong>
                    <span className="ph-person-meta">
                      <TypePill type={issue ? 'ipd' : 'opd'} /> <span className="tabular">{patient.mrn}</span>
                    </span>
                    {patient.phone && <span className="ph-person-doc tabular">{patient.phone}</span>}
                    <span className="ph-person-doc">
                      <UserRound aria-hidden="true" /> {doctor.name ? `${doctor.name}${doctor.reg ? ` · Reg. ${doctor.reg}` : ''}` : 'No doctor yet'}
                    </span>
                  </div>
                </div>
              )}
              {who === 'walkin' && (
                <div className="ph-walkin">
                  <Field label={business ? 'Name of the person collecting' : 'Patient name'} id="ph-cust-name" error={s.fields['customer.name']}>
                    <input id="ph-cust-name" value={customer.name} maxLength={150} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
                  </Field>
                  <Field label="Phone (optional)" id="ph-cust-phone">
                    <input id="ph-cust-phone" type="tel" value={customer.phone} maxLength={30} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
                  </Field>
                  <BusinessBuyerFields business={business} setBusiness={setBusiness} buyer={buyer} setBuyer={setBuyer} errors={s.fields} />
                </div>
              )}

              {patient && (
                <div className="ph-counter-rx">
                  <h2 id="ph-rx" className="ph-section-label">
                    Prescription
                  </h2>
                  <AllergyLine text={allergies} />
                  <Prescriptions patientId={patient.id} onUse={useRx} chosenVisit={visitId} useFirst={start.patient?.id === patient.id ? (start.visitId ?? null) : null} onAllergies={setAllergies} />
                </div>
              )}
              {who === 'walkin' && <p className="hint ph-allergy-ask">No record – ask about allergies before giving.</p>}
              {(patient || who === 'walkin') && !visitId && (needsRx || who === 'walkin') && (
                <div className="ph-rx-seen">
                  <h2 className="ph-section-label">Outside prescription</h2>
                  <p className="hint">{controlled ? 'A narcotic or Schedule X medicine: the doctor’s registration number is required, and it is given only to a registered patient.' : needsRx ? 'A prescription medicine: write the doctor’s name and tick that you saw the prescription.' : 'If there is a prescription, write the doctor’s name.'}</p>
                  <Field label="Doctor name" id="ph-doc-name">
                    <input id="ph-doc-name" value={doctor.name} maxLength={150} onChange={(e) => setDoctor({ ...doctor, name: e.target.value })} />
                  </Field>
                  <Field label="Registration number" id="ph-doc-reg">
                    <input id="ph-doc-reg" value={doctor.reg} maxLength={60} onChange={(e) => setDoctor({ ...doctor, reg: e.target.value })} />
                  </Field>
                  <label className="appt-reason">
                    <input type="checkbox" checked={rxSeen} onChange={(e) => setRxSeen(e.target.checked)} /> I have seen the prescription
                  </label>
                </div>
              )}
            </div>
          </aside>

          {/* Right: the item row, the bill's grid, the totals and the buttons */}
          <section className="card ph-counter-right" aria-labelledby="ph-lines">
            <h2 id="ph-lines" className="sr-only">
              Medicines
            </h2>
            {!(patient || who === 'walkin') ? (
              <p className="muted ph-counter-wait">Choose the patient first, then add the medicines here.</p>
            ) : (
              <>
                {issue && wardRequest && (
                  <p className="hint">
                    Answering the ward’s request <strong>{wardRequest.number}</strong>, ordered by {wardRequest.orderedBy.name}. Change a quantity to give less; what is not given stays open for later.{' '}
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setWardRequest(null)}>
                      Not for this request
                    </button>
                  </p>
                )}
                {issue && (
                  <div className="ph-kit">
                    <KitPicker
                      onPick={(k) => {
                        for (const l of k.lines) if (l.medicine.active !== false) addMedicine(l.medicine, l.qty);
                        const gap = kitShortfall(k);
                        setKit({ id: k.id, name: k.name, note: [gap.short.length ? `Short: ${gap.short.join(', ')}.` : '', gap.stopped.length ? `No longer used, left out: ${gap.stopped.join(', ')}.` : ''].filter(Boolean).join(' ') });
                      }}
                    />
                    {kit && (
                      <p className="hint">
                        From the kit <strong>{kit.name}</strong>. {kit.note}{' '}
                        <button type="button" className="btn btn-link btn-sm" onClick={() => setKit(null)}>
                          Not from a kit
                        </button>
                      </p>
                    )}
                  </div>
                )}
                <div className="ph-item-row" role="group" aria-label="Medicine to add">
                  <div className="ph-item-name">
                    <span className="ph-item-label">Item name</span>
                    {entry ? (
                      <div className="ph-item-chosen">
                        <strong>{medicineLabel(entry.medicine)}</strong> <ScheduleMark schedule={entry.medicine.schedule} />
                        <button
                          type="button"
                          className="btn btn-link btn-sm"
                          onClick={() => {
                            setEntry(null);
                            setFinderKey((k) => k + 1);
                          }}
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <MedicineFinder key={finderKey} label="Item name" autoFocus={finderKey > 0} onPick={(m) => setEntry({ medicine: m, batch: null, qty: '1', dose: '' })} />
                    )}
                  </div>
                  <label className="ph-item-field">
                    <span className="ph-item-label">Batch no</span>
                    <input readOnly className="tabular" value={entry?.batch?.batch ?? ''} onClick={() => entry?.batch && setEntry({ ...entry, batch: null })} />
                  </label>
                  <label className="ph-item-field ph-item-qty">
                    <span className="ph-item-label">Qty</span>
                    <input
                      ref={qtyBox}
                      inputMode="numeric"
                      className="tabular"
                      maxLength={5}
                      disabled={!entry?.batch}
                      value={entry?.batch ? entry.qty : ''}
                      onChange={(e) => setEntry({ ...entry, qty: e.target.value.replace(/\D/g, '') })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addEntry();
                        }
                      }}
                    />
                  </label>
                  <label className="ph-item-field">
                    <span className="ph-item-label">MRP</span>
                    <input readOnly className="tabular" value={entry?.batch ? (entry.batch.mrpPaise / 100).toFixed(2) : ''} />
                  </label>
                  <label className="ph-item-field ph-item-gst">
                    <span className="ph-item-label">GST %</span>
                    <input readOnly className="tabular" value={entry ? Number(entry.medicine.gstRate).toFixed(2) : ''} />
                  </label>
                  <label className="ph-item-field">
                    <span className="ph-item-label">Amount</span>
                    <input readOnly className="tabular" value={entryAmount != null ? (entryAmount / 100).toFixed(2) : ''} />
                  </label>
                  <div className="ph-item-field ph-item-dose">
                    <span className="ph-item-label">Dose</span>
                    <ChoiceBox label="Dose" value={entry?.dose ?? ''} choices={DOSE_CHOICES} placeholder="No dose" ownLabel="Type another dose…" onChange={(dose) => entry && setEntry({ ...entry, dose })} onEnter={addEntry} />
                  </div>
                  <button type="button" className="btn btn-secondary ph-item-add" disabled={!entryOk} onClick={addEntry}>
                    <Plus aria-hidden="true" /> Add
                  </button>
                </div>
                {entry?.batch && Number(entry.qty) > entry.batch.qtyLeft && <p className="field-error">Only {entry.batch.qtyLeft} in batch {entry.batch.batch}: choose another batch for the rest.</p>}
                {/* PH2: a medicine bought by the pack – the quantity in packs, and a whole pack in one press */}
                {entry?.batch && entry.medicine.packSize > 1 && (
                  <p className={looseProblem(entry.medicine, Number(entry.qty)) ? 'field-error' : 'hint'}>
                    {/^\d+$/.test(entry.qty) && Number(entry.qty) > 0 ? `= ${inPacks(Number(entry.qty), entry.medicine)}. ` : ''}
                    {looseProblem(entry.medicine, Number(entry.qty)) ?? ''}{' '}
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setEntry({ ...entry, qty: String((Number(entry.qty) || 0) + entry.medicine.packSize) })}>
                      + 1 {entry.medicine.packName || 'pack'} ({entry.medicine.packSize})
                    </button>
                  </p>
                )}
                {entry && !entry.batch && <BatchGrid medicine={entry.medicine} onPick={(batch) => setEntry({ ...entry, batch })} onCancel={() => { setEntry(null); setFinderKey((k) => k + 1); }} />}
                <details className="ph-counter-barcode">
                  <summary>Scan a barcode</summary>
                  <BarcodeBox onPick={scan} />
                </details>

                <div className="ph-grid-wrap">
                  <table className="ph-grid">
                    <thead>
                      <tr>
                        <th scope="col">Item name</th>
                        <th scope="col">Batch no</th>
                        <th scope="col">Exp. date</th>
                        <th scope="col" className="num">Qty</th>
                        <th scope="col">Dose</th>
                        <th scope="col" className="num">GST%</th>
                        <th scope="col" className="num">MRP</th>
                        <th scope="col" className="num">Total</th>
                        <th scope="col">
                          <span className="sr-only">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {!lines.length && (
                        <tr>
                          <td colSpan={9} className="muted ph-grid-empty">
                            No medicine on the bill yet.
                          </td>
                        </tr>
                      )}
                      {lines.map((l) => (
                        <Fragment key={l.key}>
                          <tr>
                            <td data-label="Item name" className="ph-grid-name">
                              <strong>{l.medicine.name}</strong> <ScheduleMark schedule={l.medicine.schedule} /> <HighAlertPill medicine={l.medicine} />
                              {/* PH10: given in place of the brand the doctor wrote, with the doctor who agreed */}
                              {l.substitution && <span className="ph-line-note">In place of {l.prescribedName}, agreed by {l.substitution.agreedByName}</span>}
                              {visitId && l.rxItemId && !l.substitution && (
                                <button type="button" className="btn btn-link btn-sm" onClick={() => setOtherBrands(l)}>
                                  Other brands
                                </button>
                              )}
                            </td>
                            <td data-label="Batch no" className="tabular">
                              {/* Chosen from the batch list: its number, as on the earlier bill; else (a prescription's line) a choice */}
                              {l.batchNo ? l.batchNo : <BatchPicker line={l} onChange={(batchId) => setLine(l.key, { batchId })} onPrice={(info) => setLine(l.key, info)} />}
                            </td>
                            <td data-label="Exp. date" className="tabular">
                              {l.expiry ? expiryLabel(l.expiry) : '–'}
                            </td>
                            <td data-label="Qty" className="num">
                              {onPhone && (
                                <button type="button" className="ph-qty-step" aria-label={`One less ${l.medicine.name}`} onClick={() => stepQty(l, -1)}>
                                  <Minus aria-hidden="true" />
                                </button>
                              )}
                              <input className="bill-price-input" inputMode="numeric" aria-label={`Quantity of ${l.medicine.name}`} value={l.qty} onChange={(e) => setQty(l.key, e.target.value.replace(/\D/g, ''))} />
                              {l.medicine.packSize > 1 && /^\d+$/.test(l.qty) && Number(l.qty) > 0 && (
                                <span className={`ph-line-note${looseProblem(l.medicine, Number(l.qty)) ? ' field-error' : ''}`}>{looseProblem(l.medicine, Number(l.qty)) ?? inPacks(Number(l.qty), l.medicine)}</span>
                              )}
                              {onPhone && (
                                <button type="button" className="ph-qty-step" aria-label={`One more ${l.medicine.name}`} onClick={() => stepQty(l, 1)}>
                                  <Plus aria-hidden="true" />
                                </button>
                              )}
                            </td>
                            <td data-label="Dose">
                              <ChoiceBox className="ph-dose-input" label={`Dose of ${l.medicine.name}`} value={l.dose ?? ''} choices={DOSE_CHOICES} placeholder="No dose" ownLabel="Type another dose…" onChange={(dose) => setLine(l.key, { dose })} />
                            </td>
                            <td data-label="GST %" className="num tabular">
                              {Number(l.medicine.gstRate).toFixed(2)}
                            </td>
                            <td data-label="MRP" className="num tabular">
                              {l.mrpPaise ? (l.mrpPaise / 100).toFixed(2) : '–'}
                            </td>
                            <td data-label="Total" className="num tabular">
                              {rowPaise(l) != null ? (rowPaise(l) / 100).toFixed(2) : '–'}
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
                          {/* PH7: her allergy, a look-alike – shown, never asked about (owner, 10 Nov 2026) */}
                          {(patient && allergyClash(l.medicine, allergies)) || l.medicine.lookAlike?.length ? (
                            <tr>
                              <td colSpan={9} className="ph-warn-row">
                                {patient && allergyClash(l.medicine, allergies) && (
                                  <span className="ph-warn">
                                    <TriangleAlert aria-hidden="true" /> Allergy: her record says “{allergies}” – {l.medicine.name} may be a {allergyClash(l.medicine, allergies)}. Check with her and the doctor before giving.
                                  </span>
                                )}
                                {l.medicine.lookAlike?.length > 0 && (
                                  <span className="ph-warn">
                                    <TriangleAlert aria-hidden="true" /> Looks or sounds like {l.medicine.lookAlike.map((x) => x.name).join(', ')} – check the pack.
                                  </span>
                                )}
                              </td>
                            </tr>
                          ) : null}
                          {/* PH6: already given in full – sold again only with a reason */}
                          {l.givenInFull && (
                            <tr>
                              <td colSpan={9} className="ph-repeat-row">
                                <label className="ph-repeat">
                                  <span className={(l.repeatReason ?? '').trim().length >= 3 ? 'hint' : 'field-error'}>
                                    {l.medicine.name} was already given in full ({l.sold.map((x) => `${x.qty} on ${x.date}, ${x.number}`).join('; ')}). Why is it sold again?
                                  </span>
                                  <input maxLength={200} value={l.repeatReason ?? ''} onChange={(e) => setLine(l.key, { repeatReason: e.target.value })} aria-label={`Why ${l.medicine.name} is sold again`} />
                                </label>
                              </td>
                            </tr>
                          )}
                          {l.prescribed && l.medicine.inStock < Number(l.qty) && (
                            <tr>
                              <td colSpan={9} className="field-error ph-prescribed-short">
                                {l.medicine.name}: not enough in stock. It stays on the bill, so the invoice can be made once it is received.
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                {isBusiness && <ShortHsnWarning medicines={lines.map((l) => l.medicine)} />}
                {visitId && (
                  <p className="hint">
                    From her Perinexa prescription{doctor.name ? ` by ${doctor.name}` : ''}
                    {doctor.reg ? ` (Reg. ${doctor.reg})` : ''}.
                  </p>
                )}

                <div className="ph-totals">
                  <label className="ph-total-field">
                    <span>GST amount</span>
                    <input readOnly className="tabular" value={(gstPaise / 100).toFixed(2)} />
                  </label>
                  <label className="ph-total-field">
                    <span>Disc %</span>
                    <input inputMode="decimal" className="tabular" value={discount} maxLength={8} disabled={!lines.length} onChange={(e) => changePct(e.target.value)} />
                  </label>
                  <label className="ph-total-field">
                    <span>Disc amount</span>
                    <input inputMode="decimal" className="tabular" value={discountAmount} maxLength={12} disabled={!lines.length} onChange={(e) => changeAmount(e.target.value)} />
                  </label>
                  <label className="ph-total-field ph-total-reason">
                    <span>Conc. reason</span>
                    <input value={discountReason} maxLength={200} disabled={!(pct > 0)} onChange={(e) => setDiscountReason(e.target.value)} />
                  </label>
                  <label className="ph-total-field">
                    <span>Total amount</span>
                    <input readOnly className="tabular" value={(grossPaise / 100).toFixed(2)} />
                  </label>
                  <label className="ph-total-field ph-total-net">
                    <span>Net amount</span>
                    <input readOnly className="tabular" value={(totalPaise / 100).toFixed(2)} />
                  </label>
                </div>
                {(s.fields.discountPercent || s.fields.discountReason) && <p className="field-error">{s.fields.discountPercent || s.fields.discountReason}</p>}
                {pct > 100 && <p className="field-error">The discount cannot be more than the bill.</p>}
                <p className="hint">
                  {who === 'walkin' ? 'Save opens the Payment window: the customer pays here, by cash, cheque, card, NEFT / RTGS or online, or in parts.' : issue ? 'The invoice goes on her stay’s bill.' : 'The invoice goes on her hospital bill; she pays at the billing desk.'} Prices are the batch MRP (GST included).
                </p>
              </>
            )}
            <div className="ph-counter-actions">
              <Link className="btn btn-secondary" to="/pharmacy/reports">
                <CalendarClock aria-hidden="true" /> Expiry list
              </Link>
              <button type="button" className="btn btn-primary" disabled={!ready || s.busy} onClick={save}>
                <Receipt aria-hidden="true" /> {issue ? 'Save the issue' : 'Save'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={close}>
                <CircleX aria-hidden="true" /> Close
              </button>
            </div>
          </section>
        </div>
        {otherBrands && (
        <OtherBrandsDialog
          line={otherBrands}
          onClose={() => setOtherBrands(null)}
          onPick={(m, agreed) => {
            setLine(otherBrands.key, { medicine: m, batchId: null, batchNo: null, mrpPaise: null, packMrpPaise: null, unitsPerPack: null, expiry: null, substitution: agreed, prescribedName: otherBrands.medicine.name });
            setOtherBrands(null);
          }}
        />
      )}
      {paying && (
          <PaymentWindow
            body={paying}
            who={who === 'walkin' ? { uhid: '', name: customer.name.trim() } : { uhid: patient?.mrn ?? '', name: patient?.fullName ?? '' }}
            walkIn={who === 'walkin'}
            saving={s.busy}
            error={s.error}
            onSave={submit}
            onClose={() => setPaying(null)}
          />
        )}
      </div>
    </>
  );
}
