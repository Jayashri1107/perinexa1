import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleX, Printer, Search, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { DateText } from '../../components/DateText.jsx';
import { Alert, StatusPill, formatDate, formatDayMonth } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { MODE_LABELS, expiryLabel } from './pharmacyFormat.js';
import { Modal, PatientPickList, PharmacyHeader, bringIntoView } from './pharmacyUi.jsx';
import { amount } from './searchBill.js';
import { HISTORY_STATES, RETURN_KINDS, findProblem, findQuery, lineForCode, payWord, pickChoices, returnBody, returnFigures, typedQty } from './patientReturn.js';

// Pharmacy → Sale return patient-wise (24 Nov 2026, the developer, after the "Sales Return" window of the pharmacy's
// earlier software), the menu item after Settlement. On the left OPD or IPD, Registration no (UHID), First name, Doctor
// name, the Date (today), the Tax, Direct print and Search. Beside it Item name (or a barcode, with Barcode ticked) and
// the medicines in the return. As the earlier window (the developer's video, 24 Nov 2026): typing in Item name lists her
// bills' medicines – OPD her counter sales, IPD her ward issues – with Sales no, Date, Bill type, Batch, Expiry and MRP;
// the one chosen comes into the return with Return qty 1 (its box ready to change); under them the cash, credit and
// total figures, the reason, how money is given back, Save and Close.
// Save takes the quantities back from every bill at once: each bill gets its own GST credit note (printable from the
// bill), stock goes back to its batch. Money is given back only for what was paid beyond what is still owed; the rest
// comes off her credit, and a ward issue comes off her hospital bill (never a final one). The Pharmacy Sales Return Bill
// of the whole return opens after Save, as on the earlier window (printed straight away with Direct print).
// Made on the server: server/src/routes/pharmacyPatientReturn.js and pharmacy/patientReturn.js.

// 25 Nov 2026 (the pharmacy's request): Registration no and First name ticked from the start (how Search already
// worked); Doctor name, Date and Tax start unticked (extras, as on the earlier software's window)
const EMPTY = { type: 'opd', mrn: '', first: '', doctor: '', byMrn: true, byFirst: true, byDoctor: false, byDate: false, date: '', byTax: false };
const MODES = ['cash', 'upi', 'card', 'cheque', 'neft'];

function Fact({ label, value, id, strong = false }) {
  return (
    <div className={`ph-pr-fact${strong ? ' is-strong' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} readOnly value={value} className="tabular" />
    </div>
  );
}

// The return bill's date and time as the store's earlier papers print them: 24/11/2026 and 16:43:05 (India time)
const slipDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
const slipTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

/**
 * Her whole history (26 Nov 2026, the pharmacy's request): everything she has taken so far, on all her bills, as soon
 * as she is chosen – data.history (server/src/pharmacy/patientReturn.js purchaseHistory); a medicine that can still be
 * taken back (it is in data.lines) comes into the return on a click.
 */
export function HerHistory({ data, picked = [], onPick }) {
  const canTake = (h) => data.lines.find((l) => l.key === h.key) ?? null;
  return (
    <section className="ph-st-grid ph-pr-history" aria-labelledby="pr-history">
      <h2 id="pr-history" className="ph-st-title">
        Her medicines so far <span className="muted">({data.history.length}{data.historyMore ? '+' : ''})</span>
      </h2>
      <div className="ph-sb-bills ph-pr-history-box">
        <DataTable
          caption="Her medicines so far"
          rows={data.history}
          rowKey="key"
          pageSize={0}
          emptyText="Nothing sold or issued to her yet."
          onRowClick={(h) => {
            const line = canTake(h);
            if (line) onPick?.(line);
          }}
          rowClassName={(h) => (canTake(h) ? (picked.includes(h.key) ? 'is-picked' : 'is-pickable') : 'is-past')}
          columns={[
            { key: 'date', header: 'Date', render: (h) => <span title={formatDate(h.date)}>{formatDayMonth(h.date)}</span> },
            { key: 'number', header: 'Sales no', render: (h) => <span className="tabular">{h.number}</span> },
            { key: 'type', header: 'Bill type', render: (h) => (h.kind === 'issue' ? 'IPD issue' : payWord({ madeAs: h.madeAs })) },
            { key: 'name', header: 'Item name', render: (h) => <span className="ph-pr-name">{h.name}</span> },
            { key: 'batch', header: 'Batch no', render: (h) => h.batch },
            { key: 'expiry', header: 'Exp date', render: (h) => (h.expiry ? expiryLabel(h.expiry) : '–') },
            { key: 'qty', header: 'Qty', align: 'right', render: (h) => h.qty },
            { key: 'ret', header: 'Returned', align: 'right', render: (h) => (h.returnedQty ? <span title={h.creditNotes.join(', ')}>{h.returnedQty}</span> : '–') },
            { key: 'amt', header: 'Amount', align: 'right', render: (h) => amount(h.amountPaise) },
            {
              key: 'state',
              header: 'Return',
              render: (h) => {
                const s = HISTORY_STATES[canTake(h) ? 'open' : h.state === 'open' ? 'other' : h.state];
                return <StatusPill tone={s.tone}>{s.word}</StatusPill>;
              },
            },
          ]}
        />
      </div>
    </section>
  );
}

/**
 * The paper given with the return, as the earlier software's "Pharmacy Sales Return Bill" (24 Nov 2026, the developer's
 * video): the store's heading, Reg No, Patient Name, Sales Ret. No (each bill's credit note), Date and Time; the medicines
 * (Item Name, Batch No, Expiry, Qty, Total Amount); Total Amount, Cash Return and Credit Return; the store's lines and the
 * pharmacist. The same look as the Sales bill's paper.
 */
export function ReturnSlip({ done, settings, showTax = false }) {
  const t = done.totals;
  const licences = [settings.licence20, settings.licence21].filter(Boolean).join(' ');
  const hospital = done.creditNotes.filter((c) => c.onHospitalBill).reduce((n, c) => n + c.creditPaise, 0);
  const plain = (paise) => amount(paise);
  return (
    <PrintDocument className="bill-doc ph-doc ph-pr-slip">
      <div className="ph-slip">
        <header className="ph-slip-head">
          <div className="lh-name">{settings.name}</div>
          {settings.address && <div>{settings.address}</div>}
          {(licences || settings.gstin) && (
            <div className="ph-slip-ids">
              {licences && <span>D.L. No. {licences}</span>}
              {settings.gstin && <span>GSTN No. {settings.gstin}</span>}
            </div>
          )}
          {settings.phone && <div className="ph-slip-mobile">Mobile No. {settings.phone}</div>}
          <div className="ph-slip-mobile">Pharmacy Sales Return Bill</div>
        </header>
        <dl className="ph-slip-facts">
          <div>
            <dt>Reg No</dt>
            <dd>{done.patient.mrn || ''}</dd>
          </div>
          <div className="is-long">
            <dt>Sales Ret. No</dt>
            <dd>{done.creditNotes.map((c) => c.creditNote).join(', ')}</dd>
          </div>
          <div className="is-long">
            <dt>Patient Name</dt>
            <dd>{done.patient.fullName}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{slipDay(done.at)}</dd>
          </div>
          <div className="is-long">
            <dt>Against bill</dt>
            <dd>{done.creditNotes.map((c) => c.number).join(', ')}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{slipTime(done.at)}</dd>
          </div>
        </dl>
        <table className="ptable ph-slip-lines">
          <thead>
            <tr>
              <th scope="col">Item Name</th>
              <th scope="col">Batch No</th>
              <th scope="col">Expiry</th>
              <th scope="col" className="num">
                Qty
              </th>
              <th scope="col" className="num">
                Total Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {done.chosen.map((c) => (
              <tr key={c.line.key}>
                <td>{c.line.name}</td>
                <td>{c.line.batch}</td>
                <td className="nowrap">{c.line.expiry ? expiryLabel(c.line.expiry).replace(' ', '-') : ''}</td>
                <td className="num">{c.qty}</td>
                <td className="num">{plain(c.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ph-slip-sums">
          <div>
            <span>Total Amount</span>
            <span>{plain(t.amountPaise)}</span>
          </div>
          {showTax && (
            <>
              <div>
                <span>Taxable Value</span>
                <span>{plain(t.taxablePaise)}</span>
              </div>
              <div>
                <span>CGST</span>
                <span>{plain(t.cgstPaise)}</span>
              </div>
              <div>
                <span>SGST</span>
                <span>{plain(t.sgstPaise)}</span>
              </div>
            </>
          )}
          <div className="ph-slip-credit">
            <span>Cash Return{t.refundPaise > 0 && done.mode !== 'cash' ? ` (${MODE_LABELS[done.mode] ?? done.mode})` : ''}</span>
            <span>{plain(t.refundPaise)}</span>
          </div>
          <div>
            <span>Credit Return{hospital > 0 ? ' (hospital bill ' + plain(hospital) + ')' : ''}</span>
            <span>{plain(t.creditPaise)}</span>
          </div>
        </div>
        <div className="ph-slip-foot">
          <div>
            <p>OVERCHARGE IF ANY IS REFUNDABLE, E.&amp;O.E</p>
            <p>* * * GET WELL SOON * * *</p>
            {settings.place && <p>Subject to {settings.place} Jurisdiction</p>}
          </div>
          <div className="ph-slip-sign">
            <div className="ph-slip-sign-line">Pharmacist</div>
            {settings.pharmacistName && <div>{settings.pharmacistName}</div>}
          </div>
        </div>
      </div>
    </PrintDocument>
  );
}

/** start: { type } – the screen as after Search with nothing typed (that type's patients asked for). */
export function PatientReturnPage({ start = null } = {}) {
  const navigate = useNavigate();
  const [form, setForm] = useState(() => (start?.type ? { ...EMPTY, type: start.type } : EMPTY));
  const [query, setQuery] = useState(() => (start ? findQuery({ ...EMPTY, type: start.type ?? EMPTY.type }) : null));
  const [patientId, setPatientId] = useState(null);
  const [typed, setTyped] = useState({}); // return qty typed, by line
  const [picked, setPicked] = useState([]); // the lines in the return, in the order chosen (24 Nov 2026, as the earlier window)
  const [open, setOpen] = useState(false); // the Item name list is showing
  const [hi, setHi] = useState(0); // the line lit in it (arrow keys)
  const [focusKey, setFocusKey] = useState(null); // a line just added: its Return qty box gets the cursor
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
  // 27 Nov 2026 (the pharmacy's request): the patients found open in a pop-up – from Search until one is chosen
  const [pickOpen, setPickOpen] = useState(false);
  const split = useRef(null); // the screen under the title bar: brought to the top of the window by Search
  const found = useFetch(query ? '/pharmacy/patient-return' : null, query ?? undefined);
  const one = useFetch(patientId ? '/pharmacy/patient-return' : null, patientId ? { type: query?.type ?? form.type, patientId, ...(query?.doctor ? { doctor: query.doctor } : {}) } : undefined);
  const people = found.data?.patients ?? null;
  const data = patientId && one.data?.patient?.id === patientId ? one.data : null;
  const problem = findProblem(form);
  const figures = returnFigures(data, typed);
  const rows = picked.map((k) => data?.lines?.find((l) => l.key === k)).filter(Boolean);
  const choices = data && !barcode && open ? pickChoices(data.lines, item, picked) : [];
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // One patient found by number or name: her medicines at once (the list of today's patients stays a list)
  useEffect(() => {
    if (people?.length === 1 && !found.data?.list) choose(people[0].id);
  }, [found.data]);

  const choose = (id) => {
    setPatientId(id);
    setTyped({});
    setPicked([]);
    setItem('');
    setError(null);
  };
  // A line chosen from the Item name list (or scanned): into the return with Return qty 1, its box ready to change
  const pick = (line, qty = 1) => {
    setPicked((p) => (p.includes(line.key) ? p : [...p, line.key]));
    setTyped((t) => ({ ...t, [line.key]: String(qty) }));
    setItem('');
    setOpen(false);
    setHi(0);
    setFocusKey(line.key);
  };
  const unpick = (key) => {
    setPicked((p) => p.filter((k) => k !== key));
    setTyped((t) => {
      const next = { ...t };
      delete next[key];
      return next;
    });
  };
  useEffect(() => {
    if (!focusKey) return;
    const box = document.getElementById(`pr-qty-${focusKey}`);
    box?.focus();
    box?.select();
    setFocusKey(null);
  }, [focusKey]);
  const itemKeys = (e) => {
    if (barcode) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHi((h) => Math.min(h + 1, Math.max(0, choices.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (choices[hi]) pick(choices[hi]);
    } else if (e.key === 'Escape') setOpen(false);
  };
  const set = (change) => setForm((f) => ({ ...f, ...change }));
  // 26 Nov 2026 (the pharmacy's request): the screen stays blank – only Patient type and Search – until Search is
  // pressed; OPD or IPD chosen starts again from there
  const shown = Boolean(query);
  const restart = (type) => {
    setQuery(null);
    setPickOpen(false);
    setPatientId(null);
    setTyped({});
    setPicked([]);
    setItem('');
    setDone(null);
    setError(null);
    set({ type });
  };
  const search = (e) => {
    e?.preventDefault();
    if (problem) return;
    setPatientId(null);
    setTyped({});
    setPicked([]);
    setDone(null);
    setError(null);
    setQuery(findQuery(form));
    setPickOpen(true);
    bringIntoView(split.current);
  };
  // The patients found, when there is a choice to make: in the pop-up
  const listed = Boolean(people && (people.length > 1 || (found.data?.list && people.length > 0)));
  const listTitle = found.data?.list ? `${query?.type === 'ipd' ? 'Admitted now, with ward issues' : 'Billed today'} (${people?.length ?? 0})` : `${people?.length ?? 0} patients found`;
  const scan = (e) => {
    e.preventDefault();
    if (!barcode || !item.trim()) return;
    const line = lineForCode(data?.lines, typed, item);
    if (!line) setScanNote('No medicine on her bills has this barcode, or all of it is already in the return.');
    else {
      const next = (typedQty(typed[line.key], line.canReturnQty) ?? 0) + 1;
      pick(line, next);
      setFocusKey(null); // the scanner keeps the cursor
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
      setPicked([]);
      setReason('');
      setPrinting(true); // the return bill straight after Save, as the earlier window (printed at once with Direct print)
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
            id={`pr-qty-${l.key}`}
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
        return c ? amount(c.grossPaise) : ''; // at MRP, as the earlier window; the discount is in the figures under the list
      },
    },
    { key: 'qty', header: 'Qty', align: 'right', render: (l) => <span title={`Sold ${l.qty}, taken back before ${l.returnedQty}`}>{l.canReturnQty}</span> },
    { key: 'disc', header: 'Disc %', align: 'right', render: (l) => `${l.discountPercent ?? 0}` },
    { key: 'bill', header: 'Bill no', render: (l) => <span className="tabular">{l.number}</span> },
    { key: 'date', header: 'Bill date', render: (l) => <span title={formatDate(l.date)}>{formatDayMonth(l.date)}</span> },
    { key: 'pay', header: 'Pay', render: (l) => payWord(data?.bills?.find((b) => b.invoiceId === l.invoiceId)) },
    {
      key: 'remove',
      width: '40px',
      header: <span className="sr-only">Remove</span>,
      render: (l) => (
        <button type="button" className="icon-btn ph-pr-remove" aria-label={`Take ${l.name} (bill ${l.number}) out of the return`} onClick={() => unpick(l.key)}>
          <X aria-hidden="true" />
        </button>
      ),
    },
  ];
  const emptyWords = !query
    ? 'Choose OPD or IPD and press Search for today’s patients – or type a registration no or first name.'
    : data
      ? data.lines.length
        ? barcode
          ? 'Scan the pack: its medicine comes into the return.'
          : 'Type the medicine’s name in Item name and choose it from the list – it comes here with Return qty 1.'
        : 'Nothing on her bills can be taken back (already returned, expired, or on a final hospital bill).'
      : people?.length
        ? 'Choose the patient in the list.'
        : found.loading
          ? 'Searching…'
          : found.data?.list
            ? query.type === 'ipd'
              ? 'Nobody admitted now has ward issues.'
              : 'No OPD patient has a pharmacy bill today.'
            : `No patient with ${query.type === 'ipd' ? 'ward issues' : 'pharmacy bills'} found.`;

  return (
    <>
      <PharmacyHeader className="ph-counter-head" title="Sale return patient-wise" />
      <div className="pf-content bill-page ph-sb ph-st ph-pr">
        <div className="ph-sb-split" ref={split}>
          <form className="card ph-sb-panel" aria-label="Find the patient" onSubmit={search}>
            <fieldset className="ph-sb-set">
              <legend>Patient type</legend>
              <div className="ph-sb-choices">
                {/* 26 Nov 2026 (the pharmacy's request): choosing OPD or IPD starts again from a blank screen */}
                {RETURN_KINDS.map(([k, label]) => (
                  <label key={k} className="check">
                    <input type="radio" name="pr-type" value={k} checked={form.type === k} onChange={() => restart(k)} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {/* 25 Nov 2026 (the pharmacy's request): Search sits right under Patient type, in reach before the boxes
                below are even touched – pressing it with nothing ticked still lists the type's patients, as before.
                A tick before each box, as the earlier software's windows – ticked, the box is used; unticked, it is
                skipped (Registration no and First name start ticked, how Search already worked; Date, unticked, stays
                today; Tax, unticked, is left off the printed slip). One row per box, the tick and its label a fixed
                width so every box starts at the same place – no wrapped labels, no ragged columns. */}
            <div className="ph-tick-search-bar">
              <button type="submit" className="btn btn-secondary ph-tick-search-btn" disabled={Boolean(problem)}>
                <Search aria-hidden="true" /> Search
              </button>
              {shown && (
                <label className="check ph-tick-extra">
                  <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} /> Direct print
                </label>
              )}
            </div>
            {/* 26 Nov 2026 (the pharmacy's request): until Search is pressed, only Patient type and Search */}
            {shown && (
            <div className="ph-tick-rows">
              <div className="ph-tick-row">
                <label className="check ph-tick-label">
                  <input type="checkbox" checked={form.byMrn} onChange={(e) => set({ byMrn: e.target.checked })} /> Registration no
                </label>
                <input type="search" value={form.mrn} maxLength={40} autoComplete="off" placeholder="UHID" aria-label="Registration no" disabled={!form.byMrn} onChange={(e) => set({ mrn: e.target.value })} />
              </div>
              <div className="ph-tick-row">
                <label className="check ph-tick-label">
                  <input type="checkbox" checked={form.byFirst} onChange={(e) => set({ byFirst: e.target.checked })} /> First name
                </label>
                <input type="search" value={form.first} maxLength={50} autoComplete="off" aria-label="First name" disabled={!form.byFirst} onChange={(e) => set({ first: e.target.value })} />
              </div>
              <div className="ph-tick-row">
                <label className="check ph-tick-label">
                  <input type="checkbox" checked={form.byDoctor} onChange={(e) => set({ byDoctor: e.target.checked })} /> Doctor name
                </label>
                <input type="search" value={form.doctor} maxLength={150} autoComplete="off" placeholder="Any doctor" aria-label="Doctor name" disabled={!form.byDoctor} onChange={(e) => set({ doctor: e.target.value })} />
              </div>
              <div className="ph-tick-row">
                <label className="check ph-tick-label">
                  <input type="checkbox" checked={form.byDate} onChange={(e) => set({ byDate: e.target.checked, date: e.target.checked ? form.date || todayIso : form.date })} /> Date
                </label>
                {form.byDate ? (
                  <DateText aria-label="Date" aria-describedby="pr-date-hint" value={form.date || todayIso} onChange={(v) => set({ date: v })} />
                ) : (
                  <input readOnly value={formatDate(todayIso)} aria-label="Date" aria-describedby="pr-date-hint" />
                )}
              </div>
              <div className="ph-tick-row">
                <label className="check ph-tick-label">
                  <input type="checkbox" checked={form.byTax} onChange={(e) => set({ byTax: e.target.checked })} /> Tax
                </label>
                <select disabled={!form.byTax} aria-label="Tax" defaultValue="gst">
                  <option value="gst">CGST / SGST</option>
                </select>
              </div>
            </div>
            )}
            {problem && (form.mrn || form.first) && <p className="field-error">{problem}</p>}
            {found.error && <Alert type="error">{found.error}</Alert>}
            {listed && !pickOpen && (
              <button type="button" className="btn btn-secondary ph-pick-again" onClick={() => setPickOpen(true)}>
                <Users aria-hidden="true" /> {patientId ? 'Change the patient' : 'Choose the patient'} – {listTitle}
              </button>
            )}
          </form>
          {listed && pickOpen && (
            <Modal id="pr-pick" title={`${listTitle} – choose one`} onClose={() => setPickOpen(false)}>
              <div className="ph-pick-pop">
                <PatientPickList
                  title="Click the patient: her medicines open. Escape closes the list."
                  people={people}
                  chosenId={patientId}
                  onChoose={(id) => {
                    choose(id);
                    setPickOpen(false);
                  }}
                />
              </div>
            </Modal>
          )}

          {shown ? (
          <div className="ph-sb-results">
            {done && (
              <Alert type="success" onClose={() => setDone(null)}>
                {`Return saved. Taken back for ${done.patient.fullName}: ₹${amount(done.totals.amountPaise)} – credit note${done.creditNotes.length === 1 ? '' : 's'} ${done.creditNotes.map((c) => c.creditNote).join(', ')}. `}
                {done.totals.refundPaise > 0 ? `Give back ₹${amount(done.totals.refundPaise)} by ${MODE_LABELS[done.mode] ?? done.mode}. ` : 'No money to give back. '}
                <button type="button" className="btn btn-link btn-sm" onClick={() => setPrinting(true)}>
                  <Printer aria-hidden="true" /> Print the return bill again
                </button>
                <button type="button" className="btn btn-link btn-sm" onClick={() => navigate('/pharmacy/search-bill?returns=1')}>
                  <Search aria-hidden="true" /> Search sale return
                </button>
              </Alert>
            )}
            <Alert type="error" onClose={() => setError(null)}>
              {error}
            </Alert>
            {one.error && <Alert type="error">{one.error}</Alert>}
            {data && (
              <p className="ph-pr-who">
                <strong>{data.patient.fullName}</strong>
                <span className="tabular">
                  Registration no {data.patient.mrn || '–'} · {(data.type ?? query?.type) === 'ipd' ? 'IPD' : 'OPD'} · {data.bills?.length ?? 0} bill{data.bills?.length === 1 ? '' : 's'}
                </span>
              </p>
            )}
            {/* 26 Nov 2026 (the pharmacy's request): her whole history – everything she has taken so far, on all her
                bills – as soon as she is chosen; a medicine that can still be taken back comes into the return on a click */}
            {data?.history && <HerHistory data={data} picked={picked} onPick={(line) => !picked.includes(line.key) && pick(line)} />}
            <form className="ph-pr-item" onSubmit={scan}>
              <div className="ph-pr-item-box">
                <label htmlFor="pr-item">{barcode ? 'Barcode' : 'Item name'}</label>
                <input
                  id="pr-item"
                  type="search"
                  value={item}
                  maxLength={100}
                  autoComplete="off"
                  disabled={!data}
                  role={barcode ? undefined : 'combobox'}
                  aria-expanded={barcode ? undefined : choices.length > 0}
                  aria-controls={barcode ? undefined : 'pr-choices'}
                  aria-activedescendant={choices[hi] ? `pr-choice-${hi}` : undefined}
                  placeholder={!data ? 'Choose the patient first' : barcode ? 'Scan the pack, or type the number and press Enter' : 'Type the medicine’s name, then choose it from the list (↓ shows all)'}
                  onChange={(e) => {
                    setItem(e.target.value);
                    setOpen(Boolean(e.target.value.trim()));
                    setHi(0);
                    setScanNote('');
                  }}
                  onKeyDown={itemKeys}
                  onBlur={() => setOpen(false)}
                />
                {choices.length > 0 && (
                  <div className="ph-pr-choices" id="pr-choices" role="listbox" aria-label="Medicines on her bills">
                    <div className="ph-pr-choice ph-pr-choice-head" aria-hidden="true">
                      <span>Sales no</span>
                      <span>Date</span>
                      <span>Bill type</span>
                      <span>Item name</span>
                      <span>Batch no</span>
                      <span>Exp date</span>
                      <span className="num">Unit MRP</span>
                      <span className="num">Can return</span>
                    </div>
                    {choices.map((l, i) => (
                      <div
                        key={l.key}
                        id={`pr-choice-${i}`}
                        role="option"
                        aria-selected={i === hi}
                        className={i === hi ? 'ph-pr-choice is-on' : 'ph-pr-choice'}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHi(i)}
                        onClick={() => pick(l)}
                      >
                        <span className="tabular">{l.number}</span>
                        <span className="tabular">{formatDayMonth(l.date)}</span>
                        <span>{payWord(data.bills?.find((b) => b.invoiceId === l.invoiceId))}</span>
                        <span className="ph-pr-choice-name">{l.name}</span>
                        <span>{l.batch}</span>
                        <span>{l.expiry ? expiryLabel(l.expiry) : '–'}</span>
                        <span className="num tabular">{amount(l.mrpPaise)}</span>
                        <span className="num tabular">{l.canReturnQty}</span>
                      </div>
                    ))}
                  </div>
                )}
                {data && !barcode && open && item.trim() && !choices.length && <p className="hint ph-pr-nomatch">No medicine on her bills has this name, or it is already in the return.</p>}
              </div>
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
            <p id="pr-date-hint" className="hint ph-sb-tip">
              Only unopened medicines, before their expiry. Each bill gets its own credit note.
            </p>
            {scanNote && (
              <p className="hint ph-sb-tip" role="status">
                {scanNote}
              </p>
            )}
            <section className="ph-st-grid" aria-label="Medicines in the return">
              <div className="ph-sb-bills ph-pr-lines">
                <DataTable caption="Medicines in the return" rows={rows} rowKey="key" loading={one.loading || found.loading} columns={columns} pageSize={0} emptyText={emptyWords} />
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
          ) : (
            <div className="ph-sb-results ph-blank-results" aria-hidden="true" />
          )}
        </div>
      </div>

      {printing && done && (one.data?.settings || done.settings) && (
        <PrintPreview title="Sale return – print preview" hint="Check it, then print on A5 paper." page={{ size: 'A5', margin: '8mm' }} autoPrint={direct} onClose={() => setPrinting(false)}>
          <ReturnSlip done={done} settings={done.settings ?? one.data.settings} showTax={form.byTax} />
        </PrintPreview>
      )}
    </>
  );
}
