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
import { SETTLE_TYPES, SETTLE_WAYS, findProblem, findQuery, findWindowProblem, findWindowQuery, newFindFilters, newSettle, selectedOf, settleBody, settleSums, settledWords } from './settlement.js';

// Pharmacy → Settlement (24 Nov 2026, the developer, after the "Pharmacy Settlement" window of the pharmacy's earlier
// software), the menu item after Search bill. On the left OPD, IPD or External, the UHID and the patient's name, her
// advance balance, and Search – which opens the Find patient window, as the earlier software (the developer's video,
// 24 Nov 2026): the patients of the type (IPD everyone admitted now, OPD today's) to choose from, narrowed by name,
// mobile, UHID and dates; what was typed on the left finds her at once when she is the only one. Beside the panel the
// chosen patient's Paid bills and Credit bills (Select all, or tick each); under them Advance available,
// Total credit and Selected total, and the buttons Advance, Discount, Settlement and Close. Each of the three opens the
// Settlement window for the credit bills ticked – Advance with the advance filled in, Discount ready for a discount
// and its reason, Settlement with the whole amount in cash – where the bills are settled in full, by the advance, a
// discount (a concession: not money received) and money received in one or more ways. A receipt can be printed after.
// Only a registered patient's counter bills are settled here: hospital bills and ward issues are paid at the billing
// desk, and a walk-in (External) customer pays the whole bill at the counter, so External lists bills to look at only.
// Made on the server: server/src/pharmacy/settlement.js (GET and POST /api/pharmacy/settlement, and GET
// /api/pharmacy/settlement/patients for the Find patient window).

const EMPTY = { type: 'opd', mrn: '', name: '' };

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

// The hospital's today (India), for the Find patient window's dates before the server has said which day it is
const hospitalToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '');

/**
 * The Find patient window (24 Nov 2026, the developer's video of the earlier software's Pharmacy Settlement): Search
 * opens it. On the left the patient type (as chosen), and the boxes – Patient name (first, middle, last, mobile no), UHID,
 * Date (from, to) – each used when ticked, and Show; beside them the patients: UHID, Patient name, Date, Time, Number
 * (IPD her admission's, OPD her latest bill's) and Doctor name. ↑ ↓ and Enter, a double click, or Select chooses one.
 * autoOne: what was typed on the screen found exactly one patient – she is chosen at once, the window never shows.
 */
/** A window over the screen: the keyboard stays in it, Esc closes it (mounted only when it is to be seen). */
function ModalFrame({ onClose, labelledBy, className, onKeyDown, children }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`modal modal-wide ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  );
}

function FindPatientWindow({ type, initial, autoOne, onSelect, onClose }) {
  const [f, setF] = useState(initial);
  const [asked, setAsked] = useState(() => findWindowQuery(type, initial));
  const [hi, setHi] = useState(0);
  const [ready, setReady] = useState(!autoOne); // with autoOne: shown only when the one typed isn't found alone
  const res = useFetch('/pharmacy/settlement/patients', asked);
  const list = res.data?.patients ?? null;
  const problem = findWindowProblem(f);
  const set = (change) => setF((x) => ({ ...x, ...change }));
  useEffect(() => {
    setHi(0);
    if (!list || ready) return;
    if (list.length === 1) onSelect(list[0]);
    else setReady(true);
  }, [res.data]);
  const show = (e) => {
    e?.preventDefault();
    if (problem) return;
    const next = findWindowQuery(type, f);
    if (JSON.stringify(next) === JSON.stringify(asked)) res.reload();
    else setAsked(next);
  };
  const keys = (e) => {
    if (!list?.length || e.target.closest('input, select, button, textarea')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSelect(list[hi]);
    }
  };
  useEffect(() => {
    document.getElementById(`st-find-row-${hi}`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);
  const word = type === 'ipd' ? 'IPD' : 'OPD';
  if (!ready) return res.error ? <ModalFrame onClose={onClose} labelledBy="st-find-title" className="ph-st-find-window"><h2 id="st-find-title" className="ph-pay-title">Find patient – {word}</h2><Alert type="error">{res.error}</Alert></ModalFrame> : null;

  return (
    <ModalFrame onClose={onClose} labelledBy="st-find-title" className="ph-st-find-window" onKeyDown={keys}>
        <h2 id="st-find-title" className="ph-pay-title">
          Find patient – {word}
        </h2>
        <div className="ph-st-find-body">
          <form className="ph-st-find-filters" onSubmit={show} aria-label="What to look for">
            <fieldset className="ph-sb-set">
              <legend>Patient type</legend>
              <div className="ph-sb-choices">
                {SETTLE_TYPES.filter(([k]) => k !== 'external').map(([k, label]) => (
                  <label key={k} className="check">
                    <input type="radio" name="st-find-type" checked={type === k} disabled readOnly /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="check ph-sb-tick">
              <input type="checkbox" checked={f.byName} onChange={(e) => set({ byName: e.target.checked })} /> Patient name
            </label>
            <label className="ph-sb-field">
              <span>First name</span>
              <input type="search" value={f.first} maxLength={50} disabled={!f.byName} onChange={(e) => set({ first: e.target.value })} />
            </label>
            <label className="ph-sb-field">
              <span>Middle name</span>
              <input type="search" value={f.middle} maxLength={50} disabled={!f.byName} onChange={(e) => set({ middle: e.target.value })} />
            </label>
            <label className="ph-sb-field">
              <span>Last name</span>
              <input type="search" value={f.last} maxLength={50} disabled={!f.byName} onChange={(e) => set({ last: e.target.value })} />
            </label>
            <label className="ph-sb-field">
              <span>Mob. no</span>
              <input type="search" inputMode="tel" value={f.phone} maxLength={20} disabled={!f.byName} onChange={(e) => set({ phone: e.target.value })} />
            </label>
            <label className="check ph-sb-tick">
              <input type="checkbox" checked={f.byMrn} onChange={(e) => set({ byMrn: e.target.checked })} /> UHID
            </label>
            <label className="ph-sb-field is-wide">
              <span className="sr-only">UHID</span>
              <input type="search" value={f.mrn} maxLength={40} disabled={!f.byMrn} aria-label="UHID" onChange={(e) => set({ mrn: e.target.value })} />
            </label>
            <label className="check ph-sb-tick">
              <input type="checkbox" checked={f.byDate} onChange={(e) => set({ byDate: e.target.checked })} /> Date
            </label>
            <label className="ph-sb-field">
              <span>From date</span>
              <DateText aria-label="From date" value={f.from} disabled={!f.byDate} onChange={(v) => set({ from: v })} />
            </label>
            <label className="ph-sb-field">
              <span>To date</span>
              <DateText aria-label="To date" value={f.to} disabled={!f.byDate} onChange={(v) => set({ to: v })} />
            </label>
            {problem && <p className="field-error">{problem}</p>}
            <button type="submit" className="btn btn-secondary ph-sb-show" disabled={Boolean(problem)}>
              <Search aria-hidden="true" /> Show
            </button>
          </form>
          <div className="ph-st-find-list ph-plist">
            {res.error && <Alert type="error">{res.error}</Alert>}
            <p className="ph-plist-title" role="status">
              {res.loading && !list ? 'Looking…' : list ? `${list.length} patient${list.length === 1 ? '' : 's'}${list.length === 500 ? ' (the newest 500)' : ''}` : ''}
            </p>
            <div className="ph-plist-scroll ph-st-find-scroll" tabIndex={0} role="listbox" aria-label="Patients" aria-activedescendant={list?.length ? `st-find-row-${hi}` : undefined}>
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
                  {(list ?? []).map((p, i) => (
                    <tr key={p.id} id={`st-find-row-${i}`} role="option" aria-selected={i === hi} className={i === hi ? 'is-on' : undefined} onClick={() => setHi(i)} onDoubleClick={() => onSelect(p)}>
                      <td className="tabular">{p.mrn || '–'}</td>
                      <td title={p.fullName}>{p.fullName}</td>
                      <td className="tabular">{p.at ? formatDate(p.at) : ''}</td>
                      <td className="tabular">{timeOf(p.at)}</td>
                      <td className="tabular">{p.number}</td>
                      <td title={p.doctor}>{p.doctor}</td>
                    </tr>
                  ))}
                  {list && list.length === 0 && (
                    <tr>
                      <td colSpan={6} className="ph-st-find-none">
                        {type === 'ipd' ? 'Nobody admitted now fits.' : 'No patient with counter bills fits.'} Change the boxes on the left and press Show.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="ph-pay-foot">
          <button type="button" className="btn btn-primary" disabled={!list?.[hi]} onClick={() => onSelect(list[hi])}>
            <CircleCheck aria-hidden="true" /> Select
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            <CircleX aria-hidden="true" /> Close
          </button>
        </div>
    </ModalFrame>
  );
}

export function PharmacySettlementPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [query, setQuery] = useState(null); // External: the walk-in bills asked for
  const [finding, setFinding] = useState(null); // the Find patient window: { type, initial, autoOne }
  const [patientId, setPatientId] = useState(null);
  const [chosen, setChosen] = useState(() => new Set());
  const [opened, setOpened] = useState(null); // 'advance' | 'discount' | 'settle'
  const [done, setDone] = useState(null); // the last settlement: { result, words, patient, at }
  const [printing, setPrinting] = useState(false);
  const split = useRef(null); // the screen under the title bar: brought to the top of the window by Search
  const walkIns = useFetch(query ? '/pharmacy/settlement' : null, query ?? undefined);
  const one = useFetch(patientId ? '/pharmacy/settlement' : null, patientId ? { patientId } : undefined);
  const settings = useFetch(done ? '/pharmacy/settings' : null);
  const problem = findProblem(form);
  const external = query?.type === 'external' ? (walkIns.data?.externalBills ?? null) : null;
  const data = patientId && one.data?.patientId === patientId ? one.data : null;

  const search = (e) => {
    e?.preventDefault();
    if (problem) return;
    setChosen(new Set());
    setDone(null);
    bringIntoView(split.current);
    if (form.type === 'external') {
      setPatientId(null);
      setQuery(findQuery(form));
      return;
    }
    setQuery(null);
    setFinding({ type: form.type, initial: newFindFilters(form, hospitalToday()), autoOne: Boolean(form.mrn.trim() || form.name.trim()) });
  };
  // A patient chosen in the Find patient window: her UHID and name on the left, her bills beside them
  const choose = (p) => {
    setFinding(null);
    setPatientId(p.id);
    setChosen(new Set());
    setForm((f) => ({ ...f, mrn: p.mrn ?? '', name: p.fullName }));
  };
  const set = (change) => setForm((f) => ({ ...f, ...change }));
  const clear = () => {
    setForm(EMPTY);
    setQuery(null);
    setPatientId(null);
    setChosen(new Set());
    setDone(null);
  };

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
        : 'Choose OPD, IPD or External and press Search – the list of patients opens – or type the UHID or name first.';

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
                    <input type="radio" name="st-type" value={k} checked={form.type === k} onChange={() => set({ type: k })} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="ph-st-field">
              <span>UHID</span>
              <input type="search" value={form.mrn} maxLength={40} autoComplete="off" onChange={(e) => set({ mrn: e.target.value })} />
            </label>
            <label className="ph-st-field">
              <span>{form.type === 'external' ? 'Customer name' : 'Patient name'}</span>
              <input type="search" value={form.name} maxLength={80} autoComplete="off" onChange={(e) => set({ name: e.target.value })} />
            </label>
            {data && (
              <p className="ph-st-advance">
                Advance balance: <strong className="tabular">₹{amount(advancePaise)}</strong>
              </p>
            )}
            {form.type === 'external' && <p className="hint ph-sb-tip">A walk-in customer pays the whole bill at the counter: their bills are listed to look at (today’s when nothing is typed).</p>}
            {problem && (form.mrn || form.name) && <p className="field-error">{problem}</p>}
            {walkIns.error && <Alert type="error">{walkIns.error}</Alert>}
            <div className="ph-st-find">
              <button type="submit" className="btn btn-secondary ph-sb-show" disabled={Boolean(problem)}>
                <Search aria-hidden="true" /> Search
              </button>
              {(query || patientId || form.mrn || form.name) && (
                <button type="button" className="btn btn-link btn-sm" onClick={clear}>
                  Clear
                </button>
              )}
            </div>
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
            {form.type === 'ipd' && data && <p className="hint ph-sb-tip">Only counter bills are settled here: ward issues, and bills put on the hospital bill, are paid at the billing desk.</p>}
          </div>
        </div>
      </div>

      {finding && <FindPatientWindow key={JSON.stringify(finding)} type={finding.type} initial={finding.initial} autoOne={finding.autoOne} onSelect={choose} onClose={() => setFinding(null)} />}
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
