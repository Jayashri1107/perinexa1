import { useEffect, useRef, useState } from 'react';
import { Banknote, CircleCheck, CircleX, Percent, Printer, Search, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { DateText } from '../../components/DateText.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDate, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PharmacyHeader, PharmacyLetterhead, bringIntoView } from './pharmacyUi.jsx';
import { amount } from './searchBill.js';
import {
  SETTLE_TYPES,
  SETTLE_WAYS,
  emptyFindFilters,
  findProblem,
  findQuery,
  findWindowProblem,
  findWindowQuery,
  findWindowTyped,
  newSettle,
  selectedOf,
  settleBody,
  settleSums,
  settledWords,
} from './settlement.js';

// Pharmacy → Settlement (24 Nov 2026, the developer, after the "Pharmacy Settlement" window of the pharmacy's earlier
// software; 25 Nov 2026, the pharmacy's request: the Find patient boxes moved into this column itself, no pop-up
// window), the menu item after Search bill. On the left OPD, IPD or External, and Search. External: the UHID and
// customer's name. OPD/IPD: Patient name (first, middle, last, mobile), UHID, Doctor name, Date (from, to) – each
// used when ticked – and the patients found (IPD everyone admitted now, OPD today's, when nothing is ticked):
// clicking one, or ↑ ↓ and Enter, chooses her; what was typed finds her at once when she is the only one. Beside the
// panel the chosen patient's Paid bills and Credit bills (Select all, or tick each); under them Advance available,
// Total credit and Selected total, and the buttons Advance, Discount, Settlement and Close. Each of the three opens the
// Settlement window for the credit bills ticked – Advance with the advance filled in, Discount ready for a discount
// and its reason, Settlement with the whole amount in cash – where the bills are settled in full, by the advance, a
// discount (a concession: not money received) and money received in one or more ways. A receipt can be printed after.
// Only a registered patient's counter bills are settled here: hospital bills and ward issues are paid at the billing
// desk, and a walk-in (External) customer pays the whole bill at the counter, so External lists bills to look at only.
// Made on the server: server/src/pharmacy/settlement.js (GET and POST /api/pharmacy/settlement, and GET
// /api/pharmacy/settlement/patients). 25 Nov 2026 (the pharmacy's request): the search and the patients it finds stay
// in the left column itself – no pop-up window, as on the Sale return screen.

function Fact({ label, value, id }) {
  return (
    <div className="ph-st-fact">
      <label htmlFor={id}>{label}</label>
      <input id={id} readOnly value={value} className="tabular" />
    </div>
  );
}

/** The Settlement window: the bills chosen settled in full by advance, discount and money received. */
function SettleWindow({ preset, patient, rows, selectedPaise, advancePaise, onDone, onClose }) {
  const ref = useDialogFocus(onClose);
  const [s, setS] = useState(() => newSettle(preset, { selectedPaise, advancePaise }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const discountBox = useRef(null);
  useEffect(() => {
    if (preset === 'discount') discountBox.current?.focus();
  }, []);
  const sums = settleSums(s, { selectedPaise, advancePaise });
  const way = (mode, change) => setS((x) => ({ ...x, ways: { ...x.ways, [mode]: { ...x.ways[mode], ...change } } }));
  // Ticking a way fills in what is still to settle; unticking clears it
  const tick = (mode, on) => way(mode, on ? { on, amount: sums.left > 0 ? (sums.left / 100).toFixed(2) : '' } : { on, amount: '' });
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = settleBody(s, { patientId: patient.id, invoiceIds: rows.map((r) => r.id), sums });
      const answer = await api('/pharmacy/settlement', { method: 'POST', body });
      onDone(answer, body.payments.map((p) => p.mode));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal modal-wide ph-pay ph-st-window" role="dialog" aria-modal="true" aria-labelledby="ph-st-title">
        <h2 id="ph-st-title" className="ph-pay-title">
          Settlement
        </h2>
        <Alert type="error">{error}</Alert>
        <div className="ph-pay-body">
          <div className="ph-pay-left">
            <Fact label="UHID" value={patient.mrn || '–'} id="ph-st-uhid" />
            <Fact label="Patient name" value={patient.fullName} id="ph-st-name" />
            <Fact label="Bills" value={rows.map((r) => r.number).join(', ')} id="ph-st-bills" />
            <Fact label="Selected total" value={amount(selectedPaise)} id="ph-st-selected" />
            <Fact label="Advance available" value={amount(advancePaise)} id="ph-st-available" />
          </div>
          <div className="ph-pay-right">
            <div className="ph-st-adjust">
              <label className="ph-pay-field">
                <span>Advance used</span>
                <input inputMode="decimal" className="tabular" value={s.advance} maxLength={12} disabled={advancePaise <= 0} onChange={(e) => setS({ ...s, advance: e.target.value })} />
              </label>
              <label className="ph-pay-field">
                <span>Discount</span>
                <input ref={discountBox} inputMode="decimal" className="tabular" value={s.concession} maxLength={12} onChange={(e) => setS({ ...s, concession: e.target.value })} />
              </label>
              <label className="ph-pay-field ph-st-reason">
                <span>Reason for the discount</span>
                <input value={s.reason} maxLength={200} disabled={!s.concession.trim()} onChange={(e) => setS({ ...s, reason: e.target.value })} />
              </label>
            </div>
            <h3 className="ph-st-sub">Money received</h3>
            <div className="ph-pay-grid">
              {SETTLE_WAYS.map((w) => {
                const x = s.ways[w.mode];
                return (
                  <fieldset key={w.mode} className={`ph-pay-way ph-st-way${x.on ? ' is-on' : ''}`}>
                    <legend className="sr-only">{w.label}</legend>
                    <label className="ph-pay-tick">
                      <input type="checkbox" checked={x.on} onChange={(e) => tick(w.mode, e.target.checked)} /> {w.label}
                    </label>
                    <label className="ph-pay-field">
                      <span>Amount</span>
                      <input inputMode="decimal" className="tabular" aria-label={`${w.label} amount`} disabled={!x.on} value={x.amount} maxLength={12} onChange={(e) => way(w.mode, { amount: e.target.value })} />
                    </label>
                    {w.ref && (
                      <>
                        <label className="ph-pay-field">
                          <span>{w.ref}</span>
                          <input
                            disabled={!x.on}
                            value={x.reference}
                            maxLength={w.mode === 'card' ? 4 : 80}
                            inputMode={w.mode === 'card' ? 'numeric' : undefined}
                            autoComplete="off"
                            onChange={(e) => way(w.mode, { reference: w.mode === 'card' ? e.target.value.replace(/\D/g, '') : e.target.value })}
                          />
                        </label>
                        <label className="ph-pay-field">
                          <span>{w.bank}</span>
                          <input disabled={!x.on} value={x.bank} maxLength={80} onChange={(e) => way(w.mode, { bank: e.target.value })} />
                        </label>
                      </>
                    )}
                  </fieldset>
                );
              })}
            </div>
            <label className="ph-pay-field ph-pay-wide">
              <span>Remarks</span>
              <input value={s.remarks} maxLength={200} onChange={(e) => setS({ ...s, remarks: e.target.value })} />
            </label>
          </div>
        </div>
        <div className="ph-pay-foot">
          <div className="ph-pay-sums">
            <Fact label="Settled" value={amount(sums.accounted)} id="ph-st-accounted" />
            <Fact label="Still to settle" value={amount(Math.max(0, sums.left))} id="ph-st-left" />
          </div>
          <div className="ph-pay-actions">
            <button type="button" className="btn btn-primary" disabled={Boolean(sums.problem) || saving} onClick={save}>
              <CircleCheck aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              <CircleX aria-hidden="true" /> Close
            </button>
          </div>
        </div>
        {sums.problem && (
          <p className="hint ph-st-problem" role="status">
            {sums.problem}
          </p>
        )}
      </div>
    </div>
  );
}

/** The receipt of one settlement: the bills settled and how. */
export function SettlementReceipt({ done, settings }) {
  const { result, patient, at } = done;
  return (
    <PrintDocument className="bill-doc ph-doc ph-st-receipt">
      <PharmacyLetterhead settings={settings} />
      <h1 className="pdoc-title">Settlement receipt</h1>
      <dl className="pdoc-facts">
        <div>
          <dt>Patient</dt>
          <dd>{patient.fullName}</dd>
        </div>
        <div>
          <dt>UHID</dt>
          <dd>{patient.mrn || '—'}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatDateTime(at)}</dd>
        </div>
      </dl>
      <table className="bill-report">
        <thead>
          <tr>
            <th scope="col">Bill no</th>
            <th scope="col" className="num">
              Received
            </th>
            <th scope="col" className="num">
              Advance
            </th>
            <th scope="col" className="num">
              Discount
            </th>
          </tr>
        </thead>
        <tbody>
          {result.invoices.map((x) => (
            <tr key={x.invoiceId}>
              <td>{x.number}</td>
              <td className="num">{amount(x.receivedPaise)}</td>
              <td className="num">{amount(x.advancePaise)}</td>
              <td className="num">{amount(x.concessionPaise)}</td>
            </tr>
          ))}
          <tr className="bill-report-total">
            <th scope="row">Total {amount(result.duePaise)}</th>
            <td className="num">{amount(result.receivedPaise)}</td>
            <td className="num">{amount(result.advancePaise)}</td>
            <td className="num">{amount(result.concessionPaise)}</td>
          </tr>
        </tbody>
      </table>
      <p className="bill-sign">Received by: ____________________</p>
    </PrintDocument>
  );
}

// The hospital's today (India), for the date boxes before the server has said which day it is
const hospitalToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '');

export function PharmacySettlementPage() {
  const navigate = useNavigate();
  const [type, setType] = useState('opd');
  const [ext, setExt] = useState({ mrn: '', name: '', byMrn: true, byName: true }); // External: a plain UHID/name box, as before
  const [f, setF] = useState(() => emptyFindFilters('opd', hospitalToday())); // OPD/IPD: the boxes, in the column itself (25 Nov 2026, the pharmacy's request: no pop-up window)
  const [asked, setAsked] = useState(null); // OPD/IPD: what Search last asked for (null: nothing searched yet)
  const [autoOne, setAutoOne] = useState(false); // this search typed a UHID or name: if it finds exactly one patient, choose her at once
  const [hi, setHi] = useState(0); // the patient list: the row lit by the arrow keys
  const [query, setQuery] = useState(null); // External: the walk-in bills asked for
  const [patientId, setPatientId] = useState(null);
  const [chosen, setChosen] = useState(() => new Set());
  const [opened, setOpened] = useState(null); // 'advance' | 'discount' | 'settle'
  const [done, setDone] = useState(null); // the last settlement: { result, words, patient, at }
  const [printing, setPrinting] = useState(false);
  const split = useRef(null); // the screen under the title bar: brought to the top of the window by Search
  const list = useFetch(type !== 'external' && asked ? '/pharmacy/settlement/patients' : null, asked ?? undefined);
  const patients = list.data?.patients ?? null;
  const walkIns = useFetch(query ? '/pharmacy/settlement' : null, query ?? undefined);
  const one = useFetch(patientId ? '/pharmacy/settlement' : null, patientId ? { patientId } : undefined);
  const settings = useFetch(done ? '/pharmacy/settings' : null);
  const problem = type === 'external' ? findProblem({ type, mrn: ext.mrn, name: ext.name, byMrn: ext.byMrn, byName: ext.byName }) : findWindowProblem(f);
  const external = query?.type === 'external' ? (walkIns.data?.externalBills ?? null) : null;
  const data = patientId && one.data?.patientId === patientId ? one.data : null;

  // A patient chosen from the list: her bills load on the right, at once – nothing else to close
  const choose = (p) => {
    setPatientId(p.id);
    setChosen(new Set());
  };
  useEffect(() => {
    setHi(0);
    if (!patients || !autoOne) return;
    if (patients.length === 1) choose(patients[0]);
  }, [list.data]);
  useEffect(() => {
    document.getElementById(`st-find-row-${hi}`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const search = (e) => {
    e?.preventDefault();
    if (problem) return;
    setChosen(new Set());
    setDone(null);
    setPatientId(null);
    bringIntoView(split.current);
    if (type === 'external') {
      setAsked(null);
      setQuery(findQuery({ type, mrn: ext.mrn, name: ext.name, byMrn: ext.byMrn, byName: ext.byName }));
      return;
    }
    setQuery(null);
    setAutoOne(findWindowTyped(f));
    const next = findWindowQuery(type, f);
    if (asked && JSON.stringify(next) === JSON.stringify(asked)) list.reload();
    else setAsked(next);
  };
  const keys = (e) => {
    if (!patients?.length || e.target.closest('input, select, button, textarea')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, patients.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(patients[hi]);
    }
  };
  const setExtField = (change) => setExt((x) => ({ ...x, ...change }));
  const setFField = (change) => setF((x) => ({ ...x, ...change }));
  const changeType = (k) => {
    setChosen(new Set());
    setDone(null);
    setPatientId(null);
    setQuery(null);
    setAsked(null);
    setAutoOne(false);
    if (k === 'external') setExt({ mrn: '', name: '', byMrn: true, byName: true });
    else setF(emptyFindFilters(k, hospitalToday()));
    setType(k);
  };
  const clear = () => changeType('opd');

  const credit = data?.creditBills ?? [];
  const paid = external ?? data?.paidBills ?? [];
  const selected = selectedOf(credit, chosen);
  const patient = data?.patient ?? null;
  const advancePaise = data?.advance?.balancePaise ?? 0;
  const tick = (id, on) =>
    setChosen((all) => {
      const next = new Set(all);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allTicked = credit.length > 0 && credit.every((b) => chosen.has(b.id));
  const settled = (answer, modes) => {
    setOpened(null);
    setChosen(new Set());
    setDone({ result: answer, patient, at: new Date().toISOString(), words: settledWords(answer, modes) });
    one.reload();
  };

  const money = (key) => ({ key, align: 'right', render: (r) => amount(r[`${key}Paise`]) });
  const paidColumns = [
    { key: 'date', header: 'Sales date', render: (r) => formatDateTime(r.date) },
    { key: 'number', header: 'Print bill no', render: (r) => <span className="tabular">{r.number}</span> },
    { key: 'mrn', header: external ? 'Customer' : 'UHID', render: (r) => (external ? r.name : <span className="tabular">{r.mrn || '–'}</span>) },
    { ...money('billAmount'), header: 'Bill amt' },
    { ...money('concession'), header: 'Con. amt' },
    { ...money('netPayable'), header: 'Net pay amt' },
    { ...money('paid'), header: 'Paid amt' },
    { ...money('balance'), header: 'Balance' },
  ];
  const creditColumns = [
    {
      key: 'tick',
      width: '44px',
      header: <span className="sr-only">Chosen</span>,
      render: (r) => <input type="checkbox" aria-label={`Settle bill ${r.number}`} checked={chosen.has(r.id)} onChange={(e) => tick(r.id, e.target.checked)} onClick={(e) => e.stopPropagation()} />,
    },
    { key: 'date', header: 'Sales date', render: (r) => formatDateTime(r.date) },
    { key: 'number', header: 'Print bill no', render: (r) => <span className="tabular">{r.number}</span> },
    { key: 'mrn', header: 'UHID', render: (r) => <span className="tabular">{r.mrn || '–'}</span> },
    { ...money('billAmount'), header: 'Bill amt' },
    { ...money('concession'), header: 'Con. amt' },
    { ...money('netPayable'), header: 'Net pay amt' },
    { ...money('balance'), header: 'Balance' },
  ];
  const nothingWords = external
    ? 'No walk-in bills found.'
    : data
      ? 'No paid bills.'
      : patientId || walkIns.loading
        ? 'Loading…'
        : 'Choose OPD, IPD or External, tick what to search by, and press Search.';
  const canClear = Boolean(query || patientId || asked || ext.mrn || ext.name);

  return (
    <>
      <PharmacyHeader className="ph-counter-head" title="Settlement" />
      <div className="pf-content bill-page ph-sb ph-st ph-st-main">
        <div className="ph-sb-split" ref={split}>
          <form className="card ph-sb-panel" aria-label="Find the patient" onSubmit={search}>
            <fieldset className="ph-sb-set">
              <legend>Patient type</legend>
              <div className="ph-sb-choices">
                {SETTLE_TYPES.map(([k, label]) => (
                  <label key={k} className="check">
                    <input type="radio" name="st-type" value={k} checked={type === k} onChange={() => changeType(k)} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {/* 25 Nov 2026 (the pharmacy's request): Search sits right under Patient type, and for OPD/IPD everything
                it looks by – and the patients it finds – stay in this column: no pop-up window, as on the Sale
                return screen. Each box ticked on or off, one to a row, the tick and its label a fixed width. */}
            <div className="ph-tick-search-bar">
              <button type="submit" className="btn btn-secondary ph-tick-search-btn" disabled={Boolean(problem)}>
                <Search aria-hidden="true" /> Search
              </button>
              {canClear && (
                <button type="button" className="btn btn-link btn-sm" onClick={clear}>
                  Clear
                </button>
              )}
            </div>
            {type === 'external' ? (
              <div className="ph-tick-rows">
                <div className="ph-tick-row">
                  <label className="check ph-tick-label">
                    <input type="checkbox" checked={ext.byMrn} onChange={(e) => setExtField({ byMrn: e.target.checked })} /> UHID
                  </label>
                  <input type="search" value={ext.mrn} maxLength={40} autoComplete="off" aria-label="UHID" disabled={!ext.byMrn} onChange={(e) => setExtField({ mrn: e.target.value })} />
                </div>
                <div className="ph-tick-row">
                  <label className="check ph-tick-label">
                    <input type="checkbox" checked={ext.byName} onChange={(e) => setExtField({ byName: e.target.checked })} /> Customer name
                  </label>
                  <input type="search" value={ext.name} maxLength={80} autoComplete="off" aria-label="Customer name" disabled={!ext.byName} onChange={(e) => setExtField({ name: e.target.value })} />
                </div>
              </div>
            ) : (
              <div className="ph-tick-rows">
                <div className="ph-tick-row">
                  <label className="check ph-tick-label">
                    <input type="checkbox" checked={f.byName} onChange={(e) => setFField({ byName: e.target.checked })} /> Patient name
                  </label>
                </div>
                <div className="ph-tick-row">
                  <span className="ph-tick-label ph-tick-sub">First name</span>
                  <input type="search" value={f.first} maxLength={50} disabled={!f.byName} onChange={(e) => setFField({ first: e.target.value })} />
                </div>
                <div className="ph-tick-row">
                  <span className="ph-tick-label ph-tick-sub">Middle name</span>
                  <input type="search" value={f.middle} maxLength={50} disabled={!f.byName} onChange={(e) => setFField({ middle: e.target.value })} />
                </div>
                <div className="ph-tick-row">
                  <span className="ph-tick-label ph-tick-sub">Last name</span>
                  <input type="search" value={f.last} maxLength={50} disabled={!f.byName} onChange={(e) => setFField({ last: e.target.value })} />
                </div>
                <div className="ph-tick-row">
                  <span className="ph-tick-label ph-tick-sub">Mob. no</span>
                  <input type="search" inputMode="tel" value={f.phone} maxLength={20} disabled={!f.byName} onChange={(e) => setFField({ phone: e.target.value })} />
                </div>
                <div className="ph-tick-row">
                  <label className="check ph-tick-label">
                    <input type="checkbox" checked={f.byMrn} onChange={(e) => setFField({ byMrn: e.target.checked })} /> UHID
                  </label>
                  <input type="search" value={f.mrn} maxLength={40} disabled={!f.byMrn} aria-label="UHID" onChange={(e) => setFField({ mrn: e.target.value })} />
                </div>
                {/* 25 Nov 2026 (the pharmacy's request): Doctor name, as on the Sale return window */}
                <div className="ph-tick-row">
                  <label className="check ph-tick-label">
                    <input type="checkbox" checked={f.byDoctor} onChange={(e) => setFField({ byDoctor: e.target.checked })} /> Doctor name
                  </label>
                  <input type="search" value={f.doctor} maxLength={150} disabled={!f.byDoctor} aria-label="Doctor name" onChange={(e) => setFField({ doctor: e.target.value })} />
                </div>
                <div className="ph-tick-row">
                  <label className="check ph-tick-label">
                    <input type="checkbox" checked={f.byDate} onChange={(e) => setFField({ byDate: e.target.checked })} /> Date
                  </label>
                </div>
                <div className="ph-tick-row">
                  <span className="ph-tick-label ph-tick-sub">From date</span>
                  <DateText aria-label="From date" value={f.from} disabled={!f.byDate} onChange={(v) => setFField({ from: v })} />
                </div>
                <div className="ph-tick-row">
                  <span className="ph-tick-label ph-tick-sub">To date</span>
                  <DateText aria-label="To date" value={f.to} disabled={!f.byDate} onChange={(v) => setFField({ to: v })} />
                </div>
              </div>
            )}
            {data && (
              <p className="ph-st-advance">
                Advance balance: <strong className="tabular">₹{amount(advancePaise)}</strong>
              </p>
            )}
            {type === 'external' && <p className="hint ph-sb-tip">A walk-in customer pays the whole bill at the counter: their bills are listed to look at (today’s when nothing is typed).</p>}
            {problem && <p className="field-error">{problem}</p>}
            {walkIns.error && <Alert type="error">{walkIns.error}</Alert>}

            {type !== 'external' && asked && (
              <div className="ph-plist ph-st-inline-list">
                {list.error && <Alert type="error">{list.error}</Alert>}
                <p className="ph-plist-title" role="status">
                  {list.loading && !patients
                    ? 'Looking…'
                    : patients
                      ? `${patients.length} patient${patients.length === 1 ? '' : 's'}${patients.length === 500 ? ' (the newest 500)' : ''}`
                      : ''}
                </p>
                <div
                  className="ph-plist-scroll ph-st-inline-scroll"
                  tabIndex={0}
                  onKeyDown={keys}
                  role="listbox"
                  aria-label="Patients"
                  aria-activedescendant={patients?.length ? `st-find-row-${hi}` : undefined}
                >
                  <table className="ph-plist-table ph-st-find-table">
                    <thead>
                      <tr>
                        <th scope="col" className="ph-st-find-uhid">
                          UHID
                        </th>
                        <th scope="col">Patient name</th>
                        <th scope="col" className="ph-st-find-date">
                          Date
                        </th>
                        <th scope="col" className="ph-st-find-time">
                          Time
                        </th>
                        <th scope="col" className="ph-st-find-no">
                          Number
                        </th>
                        <th scope="col" className="ph-st-find-doc">
                          Doctor name
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(patients ?? []).map((p, i) => (
                        <tr
                          key={p.id}
                          id={`st-find-row-${i}`}
                          role="option"
                          aria-selected={i === hi}
                          className={[i === hi ? 'is-on' : '', p.id === patientId ? 'is-picked' : ''].filter(Boolean).join(' ') || undefined}
                          onClick={() => {
                            setHi(i);
                            choose(p);
                          }}
                        >
                          <td className="tabular">{p.mrn || '–'}</td>
                          <td title={p.fullName}>{p.fullName}</td>
                          <td className="tabular">{p.at ? formatDate(p.at) : ''}</td>
                          <td className="tabular">{timeOf(p.at)}</td>
                          <td className="tabular">{p.number}</td>
                          <td title={p.doctor}>{p.doctor}</td>
                        </tr>
                      ))}
                      {patients && patients.length === 0 && (
                        <tr>
                          <td colSpan={6} className="ph-st-find-none">
                            {type === 'ipd' ? 'Nobody admitted now fits.' : 'No patient with counter bills fits.'} Change the boxes above and press Search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </form>

          <div className="ph-sb-results">
            {done && (
              <Alert type="success" onClose={() => setDone(null)}>
                {`Settled for ${done.patient.fullName}: ${done.words}.`}{' '}
                <button type="button" className="btn btn-link btn-sm" onClick={() => setPrinting(true)}>
                  <Printer aria-hidden="true" /> Print receipt
                </button>
              </Alert>
            )}
            {one.error && <Alert type="error">{one.error}</Alert>}
            {data && (
              <p className="ph-st-who">
                <strong>{data.patient.fullName}</strong> <span className="muted tabular">· UHID {data.patient.mrn || '–'}</span>
              </p>
            )}
            <section className="ph-st-grid" aria-labelledby="st-paid">
              <h2 id="st-paid" className="ph-st-title">
                {external ? 'Walk-in bills' : 'Paid bills'}
              </h2>
              <div className="ph-sb-bills ph-st-paid">
                <DataTable caption={external ? 'Walk-in bills' : 'Paid bills'} rows={paid} loading={one.loading || walkIns.loading} columns={paidColumns} pageSize={0} emptyText={nothingWords} />
              </div>
            </section>
            <section className="ph-st-grid" aria-labelledby="st-credit">
              <div className="ph-st-grid-head">
                <h2 id="st-credit" className="ph-st-title">
                  Credit bills
                </h2>
                <label className="check ph-st-all">
                  <input type="checkbox" disabled={!credit.length} checked={allTicked} onChange={(e) => setChosen(e.target.checked ? new Set(credit.map((b) => b.id)) : new Set())} /> Select all
                </label>
              </div>
              <div className="ph-sb-bills">
                <DataTable
                  caption="Credit bills"
                  rows={external ? [] : credit}
                  loading={one.loading}
                  columns={creditColumns}
                  pageSize={0}
                  emptyText={external ? 'A walk-in customer has no credit to settle.' : data ? 'Nothing is owed on this patient’s counter bills.' : nothingWords}
                  onRowClick={(r) => tick(r.id, !chosen.has(r.id))}
                  rowClassName={(r) => (chosen.has(r.id) ? 'is-picked' : undefined)}
                />
              </div>
            </section>

            <div className="ph-st-foot">
              <div className="ph-st-facts">
                <Fact label="Advance available" value={patient ? amount(advancePaise) : ''} id="st-advance" />
                <Fact label="Total credit" value={data ? amount(data.totalCreditPaise) : ''} id="st-credit-total" />
                <Fact label="Selected total" value={data ? amount(selected.paise) : ''} id="st-selected" />
              </div>
              <div className="ph-st-actions">
                <button type="button" className="btn btn-secondary" disabled={!selected.rows.length || advancePaise <= 0} onClick={() => setOpened('advance')}>
                  <Wallet aria-hidden="true" /> Advance
                </button>
                <button type="button" className="btn btn-secondary" disabled={!selected.rows.length} onClick={() => setOpened('discount')}>
                  <Percent aria-hidden="true" /> Discount
                </button>
                <button type="button" className="btn btn-primary" disabled={!selected.rows.length} onClick={() => setOpened('settle')}>
                  <Banknote aria-hidden="true" /> Settlement
                </button>
                <button type="button" className="btn btn-link" onClick={() => navigate('/pharmacy')}>
                  Close
                </button>
              </div>
            </div>
            {data && credit.length > 0 && !selected.rows.length && <p className="hint ph-sb-tip">Tick the credit bills to settle (or Select all), then Advance, Discount or Settlement.</p>}
            {type === 'ipd' && data && <p className="hint ph-sb-tip">Only counter bills are settled here: ward issues, and bills put on the hospital bill, are paid at the billing desk.</p>}
          </div>
        </div>
      </div>

      {opened && patient && (
        <SettleWindow
          preset={opened}
          patient={patient}
          rows={selected.rows}
          selectedPaise={selected.paise}
          advancePaise={advancePaise}
          onDone={settled}
          onClose={() => setOpened(null)}
        />
      )}
      {printing && done && settings.data && (
        <PrintPreview title="Settlement receipt – print preview" hint="Check it, then print on A5 paper." page={{ size: 'A5', margin: '8mm' }} onClose={() => setPrinting(false)}>
          <SettlementReceipt done={done} settings={settings.data.settings ?? settings.data} />
        </PrintPreview>
      )}
    </>
  );
}
