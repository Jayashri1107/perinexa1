import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Printer, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDate, formatDateTime, formatDayMonth } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { MODE_LABELS, expiryLabel } from './pharmacyFormat.js';
import { PharmacyHeader, PharmacyLetterhead } from './pharmacyUi.jsx';
import { amount } from './searchBill.js';
import { RETURN_KINDS, findProblem, findQuery, lineForCode, linesShown, payWord, returnBody, returnFigures, typedQty } from './patientReturn.js';

// Pharmacy → Sale return patient-wise (24 Nov 2026, the developer, after the "Sales Return" window of the pharmacy's
// earlier software), the menu item after Settlement. On the left OPD or IPD, Registration no (UHID), First name, Doctor
// name, the Date (today), the Tax, Direct print and Search. Beside it Item name (or a barcode, with Barcode ticked) and
// the patient's medicines from all her bills – OPD her counter sales, IPD her ward issues – with a Return qty box on
// each; under them the cash, credit and total figures, the reason, how money is given back, Save and Close.
// Save takes the quantities back from every bill at once: each bill gets its own GST credit note (printable from the
// bill), stock goes back to its batch. Money is given back only for what was paid beyond what is still owed; the rest
// comes off her credit, and a ward issue comes off her hospital bill (never a final one). A return slip of the whole
// return prints after Save (straight away with Direct print).
// Made on the server: server/src/routes/pharmacyPatientReturn.js and pharmacy/patientReturn.js.

const EMPTY = { type: 'opd', mrn: '', first: '', doctor: '' };
const MODES = ['cash', 'upi', 'card', 'cheque', 'neft'];

function Fact({ label, value, id, strong = false }) {
  return (
    <div className={`ph-pr-fact${strong ? ' is-strong' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} readOnly value={value} className="tabular" />
    </div>
  );
}

/** The paper given with the return: every medicine taken back, its bill and credit note, and the money. */
export function ReturnSlip({ done, settings }) {
  const noteOf = (invoiceId) => done.creditNotes.find((c) => c.invoiceId === invoiceId)?.creditNote ?? '';
  const t = done.totals;
  const hospital = done.creditNotes.filter((c) => c.onHospitalBill).reduce((n, c) => n + c.creditPaise, 0);
  return (
    <PrintDocument className="bill-doc ph-doc ph-pr-slip">
      <PharmacyLetterhead settings={settings} />
      <h1 className="pdoc-title">Sale return</h1>
      <dl className="pdoc-facts">
        <div>
          <dt>Patient</dt>
          <dd>{done.patient.fullName}</dd>
        </div>
        <div>
          <dt>Registration no</dt>
          <dd>{done.patient.mrn || '—'}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatDateTime(done.at)}</dd>
        </div>
      </dl>
      <table className="bill-report">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Batch</th>
            <th scope="col">Bill no</th>
            <th scope="col">Credit note</th>
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {done.chosen.map((c) => (
            <tr key={c.line.key}>
              <td>{c.line.name}</td>
              <td>{c.line.batch}</td>
              <td>{c.line.number}</td>
              <td>{noteOf(c.line.invoiceId)}</td>
              <td className="num">{c.qty}</td>
              <td className="num">{amount(c.amountPaise)}</td>
            </tr>
          ))}
          <tr className="bill-report-total">
            <th scope="row" colSpan={5}>
              Net return amount
            </th>
            <td className="num">{amount(t.amountPaise)}</td>
          </tr>
        </tbody>
      </table>
      <p className="ph-pr-slip-money">
        {t.refundPaise > 0 && <span>Given back: ₹{amount(t.refundPaise)} by {MODE_LABELS[done.mode] ?? done.mode}. </span>}
        {t.creditPaise - hospital > 0 && <span>Taken off what is owed to the pharmacy: ₹{amount(t.creditPaise - hospital)}. </span>}
        {hospital > 0 && <span>Taken off the hospital bill: ₹{amount(hospital)}.</span>}
      </p>
      <p className="bill-sign">Received by: ____________________ &nbsp; Pharmacist: ____________________</p>
    </PrintDocument>
  );
}

export function PatientReturnPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [query, setQuery] = useState(null);
  const [patientId, setPatientId] = useState(null);
  const [typed, setTyped] = useState({}); // return qty typed, by line
  const [item, setItem] = useState('');
  const [barcode, setBarcode] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('cash');
  const [direct, setDirect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [printing, setPrinting] = useState(false);
  const found = useFetch(query ? '/pharmacy/patient-return' : null, query ?? undefined);
  const one = useFetch(patientId ? '/pharmacy/patient-return' : null, patientId ? { type: query?.type ?? form.type, patientId, ...(query?.doctor ? { doctor: query.doctor } : {}) } : undefined);
  const people = found.data?.patients ?? null;
  const data = patientId && one.data?.patient?.id === patientId ? one.data : null;
  const problem = findProblem(form);
  const figures = returnFigures(data, typed);
  const shown = linesShown(data?.lines, barcode ? '' : item);
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // One patient found: her medicines at once
  useEffect(() => {
    if (people?.length === 1) choose(people[0].id);
  }, [found.data]);

  const choose = (id) => {
    setPatientId(id);
    setTyped({});
    setError(null);
  };
  const set = (change) => setForm((f) => ({ ...f, ...change }));
  const search = (e) => {
    e?.preventDefault();
    if (problem) return;
    setPatientId(null);
    setTyped({});
    setDone(null);
    setError(null);
    setQuery(findQuery(form));
  };
  const scan = (e) => {
    e.preventDefault();
    if (!barcode || !item.trim()) return;
    const line = lineForCode(data?.lines, typed, item);
    if (!line) setScanNote('No medicine on her bills has this barcode, or all of it is already in the return.');
    else {
      const next = (typedQty(typed[line.key], line.canReturnQty) ?? 0) + 1;
      setTyped((t) => ({ ...t, [line.key]: String(next) }));
      setScanNote(`${line.name} (bill ${line.number}): return qty ${next}.`);
    }
    setItem('');
  };
  const canSave = Boolean(data) && figures.chosen.length > 0 && !figures.problem && reason.trim().length >= 3 && !saving;
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const answer = await api('/pharmacy/patient-return', { method: 'POST', body: returnBody({ patientId, type: data.type, chosen: figures.chosen, reason, mode }) });
      setDone({ ...answer, chosen: figures.chosen, patient: data.patient, mode: answer.refundMode ?? mode, at: new Date().toISOString() });
      setTyped({});
      setReason('');
      setPrinting(direct);
      one.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'name', header: 'Item name', render: (l) => <span className="ph-pr-name">{l.name}</span> },
    { key: 'batch', header: 'Batch no', render: (l) => l.batch },
    { key: 'expiry', header: 'Exp date', render: (l) => (l.expiry ? expiryLabel(l.expiry) : '–') },
    { key: 'mrp', header: 'Unit MRP', align: 'right', render: (l) => amount(l.mrpPaise) },
    {
      key: 'ret',
      header: 'Return qty',
      align: 'right',
      render: (l) => {
        const bad = typedQty(typed[l.key], l.canReturnQty) === null;
        return (
          <input
            className="ph-pr-qty tabular"
            inputMode="numeric"
            aria-label={`Return qty of ${l.name}, bill ${l.number}`}
            aria-invalid={bad || undefined}
            value={typed[l.key] ?? ''}
            maxLength={5}
            onChange={(e) => setTyped((t) => ({ ...t, [l.key]: e.target.value.replace(/[^\d]/g, '') }))}
          />
        );
      },
    },
    {
      key: 'amt',
      header: 'Return amt',
      align: 'right',
      render: (l) => {
        const c = figures.chosen.find((x) => x.line.key === l.key);
        return c ? amount(c.amountPaise) : '';
      },
    },
    { key: 'qty', header: 'Qty', align: 'right', render: (l) => <span title={`Sold ${l.qty}, taken back before ${l.returnedQty}`}>{l.canReturnQty}</span> },
    { key: 'disc', header: 'Disc %', align: 'right', render: (l) => `${l.discountPercent ?? 0}` },
    { key: 'bill', header: 'Bill no', render: (l) => <span className="tabular">{l.number}</span> },
    { key: 'date', header: 'Bill date', render: (l) => <span title={formatDate(l.date)}>{formatDayMonth(l.date)}</span> },
    { key: 'pay', header: 'Pay', render: (l) => payWord(data?.bills?.find((b) => b.invoiceId === l.invoiceId)) },
  ];
  const emptyWords = !query
    ? 'Search for a patient to see the medicines on her bills.'
    : data
      ? data.lines.length
        ? 'No medicine with that name on her bills.'
        : 'Nothing on her bills can be taken back (already returned, expired, or on a final hospital bill).'
      : people?.length
        ? 'Choose the patient on the left.'
        : found.loading
          ? 'Searching…'
          : `No patient with ${query.type === 'ipd' ? 'ward issues' : 'pharmacy bills'} found.`;

  return (
    <>
      <PharmacyHeader className="ph-counter-head" title="Sale return patient-wise" />
      <div className="pf-content bill-page ph-sb ph-st ph-pr">
        <div className="ph-sb-split">
          <form className="card ph-sb-panel" aria-label="Find the patient" onSubmit={search}>
            <fieldset className="ph-sb-set">
              <legend>Patient type</legend>
              <div className="ph-sb-choices">
                {RETURN_KINDS.map(([k, label]) => (
                  <label key={k} className="check">
                    <input type="radio" name="pr-type" value={k} checked={form.type === k} onChange={() => set({ type: k })} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="ph-st-field">
              <span>Registration no</span>
              <input type="search" value={form.mrn} maxLength={40} autoComplete="off" placeholder="UHID" onChange={(e) => set({ mrn: e.target.value })} />
            </label>
            <label className="ph-st-field">
              <span>First name</span>
              <input type="search" value={form.first} maxLength={50} autoComplete="off" onChange={(e) => set({ first: e.target.value })} />
            </label>
            <label className="ph-st-field">
              <span>Doctor name</span>
              <input type="search" value={form.doctor} maxLength={150} autoComplete="off" placeholder="Any doctor" onChange={(e) => set({ doctor: e.target.value })} />
            </label>
            <label className="ph-st-field">
              <span>Date</span>
              <input readOnly value={formatDate(todayIso)} aria-describedby="pr-date-hint" />
            </label>
            <label className="ph-st-field">
              <span>Tax</span>
              <select disabled defaultValue="gst">
                <option value="gst">CGST / SGST</option>
              </select>
            </label>
            <label className="check ph-sb-tick">
              <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} /> Direct print
            </label>
            <button type="submit" className="btn btn-secondary ph-sb-show" disabled={Boolean(problem)}>
              <Search aria-hidden="true" /> Search
            </button>
            {problem && (form.mrn || form.first) && <p className="field-error">{problem}</p>}
            {found.error && <Alert type="error">{found.error}</Alert>}
            {people && people.length > 1 && (
              <div className="ph-st-people" role="group" aria-label="Patients found">
                <p className="hint ph-sb-tip">{people.length} patients found – choose one:</p>
                <ul>
                  {people.map((p) => (
                    <li key={p.id}>
                      <button type="button" className={p.id === patientId ? 'ph-st-person is-on' : 'ph-st-person'} aria-pressed={p.id === patientId} onClick={() => choose(p.id)}>
                        <span className="ph-st-person-name">{p.fullName}</span>
                        <span className="ph-st-person-sub tabular">{p.mrn}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p id="pr-date-hint" className="hint ph-sb-tip">
              Only unopened medicines, before their expiry. Each bill gets its own credit note.
            </p>
          </form>

          <div className="ph-sb-results">
            {done && (
              <Alert type="success" onClose={() => setDone(null)}>
                {`Taken back for ${done.patient.fullName}: ₹${amount(done.totals.amountPaise)} – credit note${done.creditNotes.length === 1 ? '' : 's'} ${done.creditNotes.map((c) => c.creditNote).join(', ')}. `}
                {done.totals.refundPaise > 0 ? `Give back ₹${amount(done.totals.refundPaise)} by ${MODE_LABELS[done.mode] ?? done.mode}. ` : 'No money to give back. '}
                <button type="button" className="btn btn-link btn-sm" onClick={() => setPrinting(true)}>
                  <Printer aria-hidden="true" /> Print return slip
                </button>
              </Alert>
            )}
            <Alert type="error" onClose={() => setError(null)}>
              {error}
            </Alert>
            {one.error && <Alert type="error">{one.error}</Alert>}
            <form className="ph-pr-item" onSubmit={scan}>
              <label className="ph-pr-item-box">
                <span>{barcode ? 'Barcode' : 'Item name'}</span>
                <input
                  type="search"
                  value={item}
                  maxLength={100}
                  autoComplete="off"
                  placeholder={barcode ? 'Scan the pack, or type the number and press Enter' : 'Type to show only that medicine'}
                  onChange={(e) => {
                    setItem(e.target.value);
                    setScanNote('');
                  }}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={barcode}
                  onChange={(e) => {
                    setBarcode(e.target.checked);
                    setItem('');
                    setScanNote('');
                  }}
                />{' '}
                Barcode
              </label>
            </form>
            {scanNote && (
              <p className="hint ph-sb-tip" role="status">
                {scanNote}
              </p>
            )}
            {data && (
              <p className="ph-st-who">
                <strong>{data.patient.fullName}</strong> <span className="muted tabular">· Registration no {data.patient.mrn || '–'}</span>
              </p>
            )}
            <section className="ph-st-grid" aria-label="Medicines on her bills">
              <div className="ph-sb-bills ph-pr-lines">
                <DataTable caption="Medicines on her bills" rows={data ? shown : []} rowKey="key" loading={one.loading || found.loading} columns={columns} pageSize={0} emptyText={emptyWords} rowClassName={(l) => (figures.chosen.some((c) => c.line.key === l.key) ? 'is-picked' : undefined)} />
              </div>
            </section>
            {data?.more && <p className="hint ph-sb-tip">Only her newest 500 medicines are listed.</p>}
            {figures.problem && <p className="field-error">{figures.problem}</p>}

            <div className="ph-pr-sums" aria-label="Return figures">
              <div className="ph-pr-col">
                <Fact label="Total cash return" value={amount(figures.cash.grossPaise)} id="pr-cash-gross" />
                <Fact label="Total cash disc" value={amount(figures.cash.discountPaise)} id="pr-cash-disc" />
                <Fact label="Total cash N disc" value={amount(figures.cash.amountPaise)} id="pr-cash-net" />
                <Fact label="Net cash return" value={amount(figures.cash.moneyPaise)} id="pr-cash-money" strong />
              </div>
              <div className="ph-pr-col">
                <Fact label="Total credit return" value={amount(figures.credit.grossPaise)} id="pr-credit-gross" />
                <Fact label="Total credit disc" value={amount(figures.credit.discountPaise)} id="pr-credit-disc" />
                <Fact label="Total credit N disc" value={amount(figures.credit.amountPaise)} id="pr-credit-net" />
                <Fact label="Net credit return" value={amount(figures.credit.moneyPaise)} id="pr-credit-money" strong />
              </div>
              <div className="ph-pr-col">
                <Fact label="Total return amt" value={amount(figures.total.grossPaise)} id="pr-total-gross" />
                <Fact label="Total discount amt" value={amount(figures.total.discountPaise)} id="pr-total-disc" />
                <Fact label="Total N discount amt" value={amount(figures.total.amountPaise)} id="pr-total-net" />
                <Fact label="Net return amt" value={amount(figures.total.moneyPaise)} id="pr-total-money" strong />
              </div>
            </div>
            <p className="hint ph-sb-tip">Net cash return is the money given back – only what was paid beyond what is still owed. Net credit return comes off what she owes, or off her hospital bill.</p>

            <div className="ph-pr-foot">
              <label className="ph-st-field ph-pr-reason">
                <span>Reason for the return</span>
                <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
              </label>
              <label className="ph-st-field">
                <span>Money given back by</span>
                <select value={mode} disabled={!figures.cash.moneyPaise} onChange={(e) => setMode(e.target.value)}>
                  {MODES.map((k) => (
                    <option key={k} value={k}>
                      {MODE_LABELS[k] ?? k}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ph-st-actions">
                <button type="button" className="btn btn-primary" disabled={!canSave} onClick={save}>
                  <CircleCheck aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => navigate('/pharmacy')}>
                  <CircleX aria-hidden="true" /> Close
                </button>
              </div>
            </div>
            {data && figures.chosen.length > 0 && reason.trim().length < 3 && <p className="hint ph-sb-tip">Write the reason for the return, then Save.</p>}
          </div>
        </div>
      </div>

      {printing && done && (one.data?.settings || done.settings) && (
        <PrintPreview title="Sale return – print preview" hint="Check it, then print on A5 paper." page={{ size: 'A5', margin: '8mm' }} autoPrint={direct} onClose={() => setPrinting(false)}>
          <ReturnSlip done={done} settings={done.settings ?? one.data.settings} />
        </PrintPreview>
      )}
    </>
  );
}
