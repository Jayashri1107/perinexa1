import { useState } from 'react';
import { Ban, Printer, Undo2 } from 'lucide-react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { dayLabel } from '../appointments/appointmentFormat.js';
import { SUPPLIER_RETURN_REASONS, debitSums, expiryLabel, medicineLabel, momentDay, returnBatchesShown, returnChosen, unitsLabel } from './pharmacyFormat.js';
import { Modal, PharmacyHeader, PharmacyLetterhead, ScheduleMark, money, useSend } from './pharmacyUi.jsx';

// Pharmacy → Purchases → Returns to supplier: stock sent back to the supplier it was bought from (SR-000001 …) –
// expired, damaged, recalled, excess or the wrong item – each with a printable debit note. The stock leaves with its
// own kind of stock move, so the Schedule H1, Schedule X and narcotic registers show it. A return entered by mistake is
// cancelled from its own page (the pharmacist, with a reason): the stock goes back on its batches.

export function SupplierReturnsPage() {
  const navigate = useNavigate();
  const { activeMembership } = useAuth();
  const res = useFetch('/pharmacy/supplier-returns');
  const desk = activeMembership.roles.includes('pharmacist');
  return (
    <>
      <PharmacyHeader
        title="Returns to supplier"
        crumb="Returns to supplier"
        buying
        actions={
          desk && (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/pharmacy/supplier-returns/new')}>
              <Undo2 aria-hidden="true" /> Return stock to a supplier
            </button>
          )
        }
      />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <p className="hint">Stock that goes back to the supplier it was bought from. Each return has a debit note to print and give to the supplier.</p>
        <DataTable
          caption="Returns to suppliers"
          rows={res.data?.returns}
          loading={res.loading}
          onRowClick={(r) => navigate(`/pharmacy/supplier-returns/${r.id}`)}
          emptyText="Nothing has been returned to a supplier yet."
          columns={[
            {
              key: 'number',
              header: 'Debit note',
              render: (r) => (
                <>
                  <span className="tabular">{r.number}</span> {r.status === 'cancelled' && <StatusPill tone="inactive">Cancelled</StatusPill>}
                </>
              ),
            },
            { key: 'date', header: 'Date', render: (r) => momentDay(r.date) },
            { key: 'supplier', header: 'Supplier', render: (r) => r.supplier?.name ?? '' },
            { key: 'reason', header: 'Reason', render: (r) => r.reasonLabel },
            { key: 'items', header: 'Batches', align: 'right', render: (r) => r.lines.length },
            { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="tabular">{money(r.totals.amountPaise)}</span> },
          ]}
        />
      </div>
    </>
  );
}

// ---------- A new return ----------

export function NewSupplierReturnPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const suppliers = useFetch('/pharmacy/suppliers');
  // "Return stock" beside a supplier (Suppliers tab) comes here with ?supplier=<id>
  const [supplierId, setSupplierId] = useState(() => (/^[a-f\d]{24}$/i.test(params.get('supplier') ?? '') ? params.get('supplier') : ''));
  const offer = useFetch(supplierId ? '/pharmacy/supplier-returns/batches' : null, { supplierId });
  const [qty, setQty] = useState({}); // batch id → what was typed
  const [onlyExpired, setOnlyExpired] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [witness, setWitness] = useState('');
  const s = useSend((res) => navigate(`/pharmacy/supplier-returns/${res.return.id}`, { state: { flash: `Returned – debit note ${res.return.number}.` } }));

  const data = supplierId && offer.data?.supplier?.id === supplierId ? offer.data : null;
  const batches = data?.batches ?? [];
  // What is sent is every batch with a quantity typed – so the list never hides one of them, and the debit note
  // card below names each before the button.
  const shown = returnBatchesShown(batches, qty, onlyExpired);
  const chosen = returnChosen(batches, qty);
  const keptInList = onlyExpired ? chosen.filter((x) => !x.b.expired).length : 0;
  const bad = chosen.filter((x) => x.qty == null);
  const controlled = chosen.some((x) => x.b.controlled);
  const sums = debitSums(chosen.filter((x) => x.qty != null).map((x) => ({ qty: x.qty, ratePaise: x.b.ratePaise, gstRate: x.b.gstRate })));
  const ready = chosen.length > 0 && bad.length === 0 && reason && (!controlled || witness.trim().length >= 2);
  const choose = (id) => {
    setSupplierId(id);
    setQty({});
    setWitness('');
  };

  return (
    <>
      <PharmacyHeader title="Return stock to a supplier" crumb="New return" buying />
      <div className="pf-content bill-page">
        <Alert type="error" onClose={() => s.setError(null)}>
          {s.error}
        </Alert>
        <section className="card bill-section">
          <h2>Supplier</h2>
          <div className="form-grid">
            <Field label="Return to" id="sr-sup" hint="A batch goes back to the supplier it was bought from.">
              <select id="sr-sup" value={supplierId} onChange={(e) => choose(e.target.value)}>
                <option value="">Choose…</option>
                {(suppliers.data?.suppliers ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.active ? '' : ' (not in use)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason" id="sr-reason" error={s.fields.reason}>
              <select id="sr-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Choose…</option>
                {Object.entries(SUPPLIER_RETURN_REASONS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note (optional)" id="sr-note" hint="Printed on the debit note, for example who collected the stock.">
              <input id="sr-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        </section>

        {supplierId && (
          <section className="card bill-section">
            <div className="row-between">
              <h2>Batches bought from this supplier</h2>
              <label className="appt-reason">
                <input type="checkbox" checked={onlyExpired} onChange={(e) => setOnlyExpired(e.target.checked)} /> Show only expired batches
              </label>
            </div>
            {offer.error && <Alert type="error">{offer.error}</Alert>}
            {!data && !offer.error && (
              <p className="muted" aria-busy="true">
                Loading the batches…
              </p>
            )}
            {data && !batches.length && <p className="muted">No stock in hand was bought from this supplier.</p>}
            {data && batches.length > 0 && !shown.length && <p className="muted">No expired batch from this supplier.</p>}
            {shown.length > 0 && (
              <table className="bill-lines ph-return-lines">
                <thead>
                  <tr>
                    <th scope="col">Medicine</th>
                    <th scope="col">Batch · expiry</th>
                    <th scope="col" className="num">
                      In stock
                    </th>
                    <th scope="col" className="num">
                      Rate
                    </th>
                    <th scope="col" className="num">
                      GST
                    </th>
                    <th scope="col" className="num">
                      Return
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((b) => {
                    const text = (qty[b.id] ?? '').trim();
                    const wrong = text !== '' && (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > b.qtyLeft);
                    return (
                      <tr key={b.id} className={text !== '' && !wrong ? 'is-chosen' : ''}>
                        <td data-label="Medicine">
                          {medicineLabel(b)} <ScheduleMark schedule={b.schedule} />
                          {b.invoiceNo && (
                            <span className="ph-line-note">
                              Invoice {b.invoiceNo}
                              {b.invoiceDate ? ` · ${dayLabel(b.invoiceDate)}` : ''}
                            </span>
                          )}
                        </td>
                        <td data-label="Batch">
                          {b.batch} · {expiryLabel(b.expiry)} {b.expired && <StatusPill tone="high">Expired</StatusPill>}
                        </td>
                        <td data-label="In stock" className="num">
                          {b.qtyLeft}
                        </td>
                        <td data-label="Rate" className="num">
                          {money(b.ratePaise)}
                        </td>
                        <td data-label="GST" className="num">
                          {b.gstRate}%
                        </td>
                        <td data-label="Return" className="num">
                          <input className="ph-num" inputMode="numeric" aria-label={`Return how many of ${b.name}, batch ${b.batch}`} aria-invalid={wrong || undefined} value={qty[b.id] ?? ''} onChange={(e) => setQty({ ...qty, [b.id]: e.target.value })} />{' '}
                          <button type="button" className="btn btn-link btn-sm" onClick={() => setQty({ ...qty, [b.id]: String(b.qtyLeft) })} aria-label={`Return all ${b.qtyLeft} of ${b.name}, batch ${b.batch}`}>
                            All
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {bad.length > 0 && <p className="field-error">Check the quantity of {bad[0].b.name}, batch {bad[0].b.batch}: a whole number, at most {bad[0].b.qtyLeft}.</p>}
            {keptInList > 0 && (
              <p className="hint">
                {keptInList === 1 ? 'One batch that has not expired stays' : `${keptInList} batches that have not expired stay`} in the list, because a quantity is typed beside {keptInList === 1 ? 'it' : 'them'}. Empty the box to leave{' '}
                {keptInList === 1 ? 'it' : 'them'} out of the return.
              </p>
            )}
            {data && batches.length > 0 && (
              <p className="hint">
                Type how many go back, batch by batch. Expired stock may be returned. The rate is the purchase price per unit, before GST (where free units came with the purchase, the price paid spread over all the units).{' '}
                {data.interState ? 'This supplier is in another state: the debit note shows IGST.' : 'The debit note shows CGST and SGST.'}
              </p>
            )}
          </section>
        )}

        {chosen.length > 0 && (
          <section className="card bill-section">
            <h2>The debit note</h2>
            <table className="bill-lines ph-return-chosen">
              <caption className="sr-only">What goes back to the supplier</caption>
              <thead>
                <tr>
                  <th scope="col">Going back</th>
                  <th scope="col">Batch · expiry</th>
                  <th scope="col" className="num">
                    Quantity
                  </th>
                  <th scope="col" className="num">
                    Purchase value
                  </th>
                </tr>
              </thead>
              <tbody>
                {chosen.map((x) => (
                  <tr key={x.b.id}>
                    <td data-label="Going back">
                      {medicineLabel(x.b)} <ScheduleMark schedule={x.b.schedule} />
                    </td>
                    <td data-label="Batch">
                      {x.b.batch} · {expiryLabel(x.b.expiry)}
                    </td>
                    <td data-label="Quantity" className="num">
                      {x.qty != null ? unitsLabel(x.qty, x.b.unit) : 'Check the quantity'}
                    </td>
                    <td data-label="Purchase value" className="num">
                      {x.qty != null ? money(x.qty * x.b.ratePaise) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="bill-sums">
              <tbody>
                <tr>
                  <th scope="row">Purchase value going back</th>
                  <td>{money(sums.taxablePaise)}</td>
                </tr>
                <tr>
                  <th scope="row">GST</th>
                  <td>{money(sums.gstPaise)}</td>
                </tr>
                <tr className="bill-balance">
                  <th scope="row">Total</th>
                  <td>{money(sums.amountPaise)}</td>
                </tr>
              </tbody>
            </table>
            {controlled && (
              <>
                <Alert type="warning">A narcotic or Schedule X medicine is going back: write the name of the staff member who saw it handed over. The return goes in its register.</Alert>
                <div className="form-grid">
                  <Field label="Witness (staff who saw it handed over)" id="sr-witness" error={s.fields.witness}>
                    <input id="sr-witness" value={witness} maxLength={150} onChange={(e) => setWitness(e.target.value)} />
                  </Field>
                </div>
              </>
            )}
            <p className="hint">The stock leaves the pharmacy now. Check the list above first. A return entered by mistake can be cancelled from its own page: the stock then goes back on its batches.</p>
            <div className="row ph-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!ready || s.busy}
                onClick={() => s.send('/pharmacy/supplier-returns', { supplierId, reason, note: note.trim(), witness: witness.trim(), lines: chosen.map((x) => ({ batchId: x.b.id, qty: x.qty })) })}
              >
                <Undo2 aria-hidden="true" /> {s.busy ? 'Saving…' : 'Return and make the debit note'}
              </button>
              <button type="button" className="btn btn-link" onClick={() => navigate('/pharmacy/supplier-returns')}>
                Cancel
              </button>
            </div>
            {!reason && <p className="hint">Choose the reason first.</p>}
          </section>
        )}
      </div>
    </>
  );
}

// ---------- One return and its debit note ----------

/** The printed debit note (A4): what went back, with HSN, batch, expiry, rate and GST as on the purchase. */
export function DebitNoteDocument({ ret: r, settings }) {
  const sup = r.supplier ?? {};
  const t = r.totals;
  return (
    <PrintDocument className="bill-doc ph-doc">
      <PharmacyLetterhead settings={settings} />
      <h1 className="pdoc-title">{r.status === 'cancelled' ? 'Debit note – cancelled' : 'Debit note – goods returned'}</h1>
      {r.status === 'cancelled' && <p className="pdoc-note">This debit note was cancelled{r.cancelled?.at ? ` on ${momentDay(r.cancelled.at)}` : ''}: the goods below did not go back to the supplier.</p>}
      <table className="bill-doc-head">
        <tbody>
          <tr>
            <th scope="row">Debit note no.</th>
            <td>{r.number}</td>
            <th scope="row">Date</th>
            <td>{momentDay(r.date)}</td>
          </tr>
          <tr>
            <th scope="row">To</th>
            <td>{sup.name}</td>
            <th scope="row">GSTIN</th>
            <td>{sup.gstin || '–'}</td>
          </tr>
          <tr>
            <th scope="row">Address</th>
            <td>{sup.address || '–'}</td>
            <th scope="row">Drug licence</th>
            <td>{sup.drugLicence || '–'}</td>
          </tr>
          <tr>
            <th scope="row">Reason</th>
            <td>
              {r.reasonLabel}
              {r.note ? ` – ${r.note}` : ''}
            </td>
            <th scope="row">{r.witness ? 'Witness' : ''}</th>
            <td>{r.witness}</td>
          </tr>
        </tbody>
      </table>
      <table className="bill-doc-lines ph-doc-lines ph-doc-wide">
        <thead>
          <tr>
            <th scope="col">Medicine</th>
            <th scope="col">HSN</th>
            <th scope="col">Batch / exp</th>
            <th scope="col">Your invoice</th>
            <th scope="col" className="num">Qty</th>
            <th scope="col" className="num">Rate</th>
            <th scope="col" className="num">Taxable</th>
            <th scope="col" className="num">GST %</th>
            <th scope="col" className="num">GST</th>
            <th scope="col" className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {l.name}
                {l.schedule ? ` (${l.schedule === 'narcotic' ? 'NDPS' : `Sch. ${l.schedule}`})` : ''}
              </td>
              <td>{l.hsn}</td>
              <td>
                <span>{l.batch}</span>
                <span>{expiryLabel(l.expiry)}</span>
              </td>
              <td>
                <span>{l.invoiceNo}</span>
                {l.invoiceDate && <span>{formatDate(l.invoiceDate)}</span>}
              </td>
              <td className="num">{l.qty}</td>
              <td className="num">{money(l.ratePaise)}</td>
              <td className="num">{money(l.taxablePaise)}</td>
              <td className="num">{l.gstRate}%</td>
              <td className="num">{money(l.gstPaise)}</td>
              <td className="num">{money(l.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="bill-doc-sums">
        <tbody>
          <tr>
            <th scope="row">Taxable value</th>
            <td>{money(t.taxablePaise)}</td>
          </tr>
          {r.interState ? (
            <tr>
              <th scope="row">IGST</th>
              <td>{money(t.igstPaise)}</td>
            </tr>
          ) : (
            <>
              <tr>
                <th scope="row">CGST</th>
                <td>{money(t.cgstPaise)}</td>
              </tr>
              <tr>
                <th scope="row">SGST</th>
                <td>{money(t.sgstPaise)}</td>
              </tr>
            </>
          )}
          <tr className="bill-doc-balance">
            <th scope="row">Total debit</th>
            <td>{money(t.amountPaise)}</td>
          </tr>
        </tbody>
      </table>
      <p className="pdoc-small">Please issue a credit note for the goods above. Rates are per unit, before GST, as on your invoice. This is a computer-generated debit note.</p>
      <p className="bill-sign">
        For {settings.name}: ____________________{settings.pharmacistName ? ` (${settings.pharmacistName})` : ''} &nbsp; Received by the supplier: ____________________
      </p>
    </PrintDocument>
  );
}

function DebitNotePrint({ ret, settings, onClose }) {
  const record = () => api(`/pharmacy/supplier-returns/${ret.id}/printed`, { method: 'POST', body: {} });
  return (
    <PrintPreview title="Debit note – print preview" hint="Check it, then print on A4 paper: one copy for the supplier, one for the pharmacy’s records." onPrint={record} onClose={onClose}>
      <DebitNoteDocument ret={ret} settings={settings} />
    </PrintPreview>
  );
}

/** Cancelling a return that was entered by mistake: a reason, and a witness when controlled stock comes back. */
export function CancelReturnForm({ ret, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [witness, setWitness] = useState('');
  const s = useSend(onDone);
  const ready = reason.trim().length >= 3 && (!ret.controlled || witness.trim().length >= 2);
  return (
    <>
      <p>
        For a return entered by mistake – the wrong quantity or batch, or entered twice. The return is kept, marked cancelled. Its {unitsLabel(ret.totals.qty, 'unit')} {ret.totals.qty === 1 ? 'goes' : 'go'} back on the{' '}
        {ret.lines.length === 1 ? 'batch' : 'batches'} they left, and the return no longer counts in the reports.
      </p>
      <Alert type="error">{s.error}</Alert>
      <Field label="Why is it cancelled" id="ph-sr-cancel-reason" error={s.fields.reason}>
        <input id="ph-sr-cancel-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      {ret.controlled && (
        <Field label="Witness (staff who saw it put back in stock)" id="ph-sr-cancel-witness" error={s.fields.witness} keepHint hint="A narcotic or Schedule X medicine comes back into stock: the cancelling goes in its register.">
          <input id="ph-sr-cancel-witness" value={witness} maxLength={150} onChange={(e) => setWitness(e.target.value)} />
        </Field>
      )}
      <div className="row">
        <button type="button" className="btn btn-danger" disabled={!ready || s.busy} onClick={() => s.send(`/pharmacy/supplier-returns/${ret.id}/cancel`, { reason: reason.trim(), witness: witness.trim() })}>
          {s.busy ? 'Saving…' : 'Cancel the return'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Keep it
        </button>
      </div>
    </>
  );
}

export function SupplierReturnPage() {
  const { id } = useParams();
  const location = useLocation();
  const res = useFetch(`/pharmacy/supplier-returns/${id}`);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [printing, setPrinting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [changed, setChanged] = useState(null); // the return as cancelling it here answered
  const r = (changed?.id === id ? changed : null) ?? res.data?.return;
  const cancelled = r?.status === 'cancelled';
  if (!r) {
    return (
      <>
        <PharmacyHeader title="Return to supplier" crumb="Returns to supplier" buying />
        <div className="pf-content">
          {res.error ? (
            <Alert type="error">{res.error}</Alert>
          ) : (
            <p className="muted" aria-busy="true">
              Loading the return…
            </p>
          )}
        </div>
      </>
    );
  }
  const t = r.totals;
  // "Note: … · Witness: …", then a full stop – unless what was typed already ends with one
  const typed = [r.note && `Note: ${r.note}`, r.witness && `Witness: ${r.witness}`].filter(Boolean).join(' · ');
  const typedEnd = !typed ? '' : /[.?]$/.test(typed) ? ' ' : '. ';
  return (
    <>
      <PharmacyHeader
        title={`Return ${r.number}`}
        crumb={r.number}
        buying
        subtitle={[r.supplier?.name, r.reasonLabel, formatDateTime(r.date), `by ${r.byName}`].filter(Boolean).join(' · ')}
        badges={cancelled ? <StatusPill tone="inactive">Cancelled</StatusPill> : undefined}
        actions={
          <button type="button" className={cancelled ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => setPrinting(true)}>
            <Printer aria-hidden="true" /> Print the debit note
          </button>
        }
      />
      <div className="pf-content bill-page">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        {cancelled && (
          <Alert type="warning" icon={Ban}>
            Cancelled by {r.cancelled?.byName} on {formatDateTime(r.cancelled?.at)}: {r.cancelled?.reason?.replace(/[.\s]+$/, '')}. The stock was put back on its {r.lines.length === 1 ? 'batch' : 'batches'}
            {r.cancelled?.witness ? ` (witness: ${r.cancelled.witness})` : ''}. If the debit note was already given to the supplier, tell the supplier and your accountant.
          </Alert>
        )}
        <section className="card bill-section">
          <table className="bill-lines">
            <thead>
              <tr>
                <th scope="col">Medicine</th>
                <th scope="col">Batch</th>
                <th scope="col" className="num">Qty</th>
                <th scope="col" className="num">Rate</th>
                <th scope="col" className="num">GST</th>
                <th scope="col" className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id}>
                  <td data-label="Medicine">
                    {l.name} <ScheduleMark schedule={l.schedule} />
                    {l.invoiceNo && <span className="ph-line-note">Bought on invoice {l.invoiceNo}</span>}
                  </td>
                  <td data-label="Batch">
                    {l.batch} · exp {expiryLabel(l.expiry)}
                  </td>
                  <td data-label="Qty" className="num">{l.qty}</td>
                  <td data-label="Rate" className="num">{money(l.ratePaise)}</td>
                  <td data-label="GST" className="num">{l.gstRate}%</td>
                  <td data-label="Amount" className="num">{money(l.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="bill-sums">
            <tbody>
              <tr>
                <th scope="row">Purchase value going back</th>
                <td>{money(t.taxablePaise)}</td>
              </tr>
              <tr>
                <th scope="row">{r.interState ? 'IGST' : 'CGST + SGST'}</th>
                <td>{r.interState ? money(t.igstPaise) : `${money(t.cgstPaise)} + ${money(t.sgstPaise)}`}</td>
              </tr>
              <tr className="bill-balance">
                <th scope="row">Total debit</th>
                <td>{money(t.amountPaise)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <p className="hint">
          {typed}
          {typedEnd}The supplier’s credit note is recorded by your accountant; Perinexa keeps the debit note and the stock.
        </p>
        {r.canCancel && (
          <p>
            <button type="button" className="btn btn-link btn-sm bill-cancel" onClick={() => setCancelling(true)}>
              <Ban aria-hidden="true" /> Cancel this return
            </button>
          </p>
        )}
      </div>
      {cancelling && (
        <Modal id="ph-sr-cancel" title={`Cancel return ${r.number}`} onClose={() => setCancelling(false)}>
          <CancelReturnForm
            ret={r}
            onClose={() => setCancelling(false)}
            onDone={(out) => {
              setChanged(out.return);
              setCancelling(false);
              setFlash(`Return ${out.return.number} was cancelled. Its stock is back on the ${out.return.lines.length === 1 ? 'batch' : 'batches'}.`);
            }}
          />
        </Modal>
      )}
      {printing && <DebitNotePrint ret={r} settings={res.data.settings} onClose={() => setPrinting(false)} />}
    </>
  );
}
