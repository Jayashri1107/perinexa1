import { useEffect, useRef, useState } from 'react';
import { Banknote, CircleCheck, CircleX, Percent, Printer, Search, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDate, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PharmacyHeader, PharmacyLetterhead } from './pharmacyUi.jsx';
import { amount } from './searchBill.js';
import { SETTLE_TYPES, SETTLE_WAYS, findProblem, findQuery, newSettle, selectedOf, settleBody, settleSums, settledWords } from './settlement.js';

// Pharmacy → Settlement (24 Nov 2026, the developer, after the "Pharmacy Settlement" window of the pharmacy's earlier
// software), the menu item after Search bill. On the left OP, IP or External, the UHID and the patient's name, and
// Search. Beside it the patient's Paid bills and Credit bills (Select all, or tick each); under them Advance available,
// Total credit and Selected total, and the buttons Advance, Discount, Settlement and Close. Each of the three opens the
// Settlement window for the credit bills ticked – Advance with the advance filled in, Discount ready for a discount
// and its reason, Settlement with the whole amount in cash – where the bills are settled in full, by the advance, a
// discount (a concession: not money received) and money received in one or more ways. A receipt can be printed after.
// Only a registered patient's counter bills are settled here: hospital bills and ward issues are paid at the billing
// desk, and a walk-in (External) customer pays the whole bill at the counter, so External lists bills to look at only.
// Made on the server: server/src/pharmacy/settlement.js (GET and POST /api/pharmacy/settlement).

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

export function PharmacySettlementPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [query, setQuery] = useState(null); // what Search asked for
  const [patientId, setPatientId] = useState(null);
  const [chosen, setChosen] = useState(() => new Set());
  const [opened, setOpened] = useState(null); // 'advance' | 'discount' | 'settle'
  const [done, setDone] = useState(null); // the last settlement: { result, words, patient, at }
  const [printing, setPrinting] = useState(false);
  const found = useFetch(query ? '/pharmacy/settlement' : null, query ?? undefined);
  const one = useFetch(patientId ? '/pharmacy/settlement' : null, patientId ? { patientId } : undefined);
  const settings = useFetch(done ? '/pharmacy/settings' : null);
  const problem = findProblem(form);
  const people = query && query.type !== 'external' ? (found.data?.patients ?? null) : null;
  const external = query?.type === 'external' ? (found.data?.externalBills ?? null) : null;
  const data = patientId && one.data?.patientId === patientId ? one.data : null;

  // One patient found: her bills at once
  useEffect(() => {
    if (people?.length === 1) choosePatient(people[0].id);
  }, [found.data]);

  const choosePatient = (id) => {
    setPatientId(id);
    setChosen(new Set());
  };
  const search = (e) => {
    e?.preventDefault();
    if (problem) return;
    setPatientId(null);
    setChosen(new Set());
    setDone(null);
    setQuery(findQuery(form));
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
    const patient = data.patient;
    setOpened(null);
    setChosen(new Set());
    setDone({ result: answer, patient, at: new Date().toISOString(), words: settledWords(answer, modes) });
    one.reload();
    found.reload(); // what each patient found still owes
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
  const nothingWords = !query
    ? 'Search for a patient to see her bills.'
    : external
      ? 'No walk-in bills found.'
      : data
        ? 'No paid bills.'
        : people?.length
          ? 'Choose the patient on the left.'
          : found.loading
            ? 'Searching…'
            : 'No patient with pharmacy bills found.';

  return (
    <>
      <PharmacyHeader className="ph-counter-head" title="Settlement" />
      <div className="pf-content bill-page ph-sb ph-st">
        <div className="ph-sb-split">
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
            {form.type === 'external' && <p className="hint ph-sb-tip">A walk-in customer pays the whole bill at the counter: their bills are listed to look at (today’s when nothing is typed).</p>}
            <button type="submit" className="btn btn-secondary ph-sb-show" disabled={Boolean(problem)}>
              <Search aria-hidden="true" /> Search
            </button>
            {problem && (form.mrn || form.name) && <p className="field-error">{problem}</p>}
            {found.error && <Alert type="error">{found.error}</Alert>}
            {people && people.length > 1 && (
              <div className="ph-st-people" role="group" aria-label="Patients found">
                <p className="hint ph-sb-tip">{people.length} patients found – choose one:</p>
                <ul>
                  {people.map((p) => (
                    <li key={p.id}>
                      <button type="button" className={p.id === patientId ? 'ph-st-person is-on' : 'ph-st-person'} aria-pressed={p.id === patientId} onClick={() => choosePatient(p.id)}>
                        <span className="ph-st-person-name">{p.fullName}</span>
                        <span className="ph-st-person-sub tabular">
                          {p.mrn} · {p.type === 'ipd' ? 'IP' : 'OP'} · {p.creditPaise > 0 ? `₹${amount(p.creditPaise)} due` : 'nothing due'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(query || form.mrn || form.name) && (
              <button type="button" className="btn btn-link btn-sm" onClick={clear}>
                Clear
              </button>
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
              <div className="ph-sb-bills">
                <DataTable caption={external ? 'Walk-in bills' : 'Paid bills'} rows={paid} loading={one.loading || found.loading} columns={paidColumns} pageSize={0} emptyText={nothingWords} />
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
                <Fact label="Advance available" value={data ? amount(advancePaise) : ''} id="st-advance" />
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
            {data && data.from && <p className="hint ph-sb-tip">Bills from {formatDate(data.from)} to {formatDate(data.to)}.</p>}
          </div>
        </div>
      </div>

      {opened && data && (
        <SettleWindow
          preset={opened}
          patient={data.patient}
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
