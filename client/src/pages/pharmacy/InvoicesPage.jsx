import { useState } from 'react';
import { ChevronLeft, ChevronRight, FileJson, Printer, RotateCcw } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, apiFile } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { MenuButton } from '../../components/MenuButton.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { PrintDocument, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, Field, formatDateTime, useDebounced } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { addDaysIso } from '../appointments/appointmentFormat.js';
import { TallyMarks } from '../billing/TallyPage.jsx';
import { MODE_LABELS, expiryLabel } from './pharmacyFormat.js';
import { Modal, PharmacyHeader, ScheduleMark, money, useSend } from './pharmacyUi.jsx';

// Pharmacy → Invoices: a day's invoices (or a search), one invoice with its GST tax invoice to print, and returns of
// unopened medicines before their expiry (each a credit note). A walk-in sale to a business with a GSTIN shows the
// buyer, and the hospital admin can download its e-invoice file (to upload on the e-invoice portal by hand).

const whoOf = (v) => (v.patient ? `${v.patient.fullName} (${v.patient.mrn})` : v.buyer ? `${v.buyer.name} (business)` : v.customer ? `${v.customer.name} (walk-in)` : '');
const buyerAddress = (b) => [b.address, [b.place, b.pin].filter(Boolean).join(' '), b.state && `${b.state} (${b.stateCode})`].filter(Boolean).join(', ');

export function InvoicesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 300);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : undefined;
  const res = useFetch('/pharmacy/invoices', search.length >= 2 ? { search } : { date });
  const day = date ?? res.data?.today;
  const go = (d) => setParams({ date: d }, { replace: true });
  return (
    <>
      <PharmacyHeader title="Invoices" crumb="Invoices" />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <DataTable
          caption="Pharmacy invoices"
          rows={res.data?.invoices}
          loading={res.loading}
          onRowClick={(v) => navigate(`/pharmacy/invoices/${v.id}`)}
          emptyText={search.length >= 2 ? 'No invoices match.' : 'No invoices on this day.'}
          toolbar={
            <div className="bill-toolbar">
              <input type="search" className="bill-search-plain" aria-label="Find an invoice" placeholder="Name, phone, patient or invoice number" value={text} onChange={(e) => setText(e.target.value)} />
              {search.length < 2 && day && (
                <div className="appt-daynav" role="group" aria-label="Day">
                  <button type="button" className="icon-btn" onClick={() => go(addDaysIso(day, -1))} aria-label="Previous day">
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  <input type="date" aria-label="Day" value={day} onChange={(e) => e.target.value && go(e.target.value)} />
                  <button type="button" className="icon-btn" onClick={() => go(addDaysIso(day, 1))} aria-label="Next day">
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          }
          columns={[
            { key: 'number', header: 'Invoice', render: (v) => <span className="tabular">{v.number}</span> },
            { key: 'date', header: 'Time', render: (v) => formatDateTime(v.date) },
            { key: 'kind', header: 'Kind', render: (v) => (v.kind === 'issue' ? 'Inpatient issue' : 'Counter sale') },
            { key: 'who', header: 'Patient / customer', render: whoOf },
            { key: 'items', header: 'Items', align: 'right', render: (v) => v.lines.length },
            { key: 'net', header: 'Amount', align: 'right', render: (v) => <span className="tabular">{money(v.netPaise)}</span> },
          ]}
        />
      </div>
    </>
  );
}

/** The printed GST tax invoice (or a credit note), A5. */
function InvoicePrint({ invoice: v, settings, stay, creditNote = null, onClose }) {
  const ret = creditNote ? v.returns.find((r) => r.number === creditNote) : null;
  const lines = ret ? ret.lines.map((x) => ({ ...v.lines.find((l) => l.id === x.lineId), qty: x.qty, amountPaise: x.amountPaise })) : v.lines;
  const record = () => api(`/pharmacy/invoices/${v.id}/printed`, { method: 'POST', body: { what: creditNote ? 'credit_note' : 'invoice' } });
  const total = lines.reduce((s, l) => s + l.amountPaise, 0);
  return (
    <PrintPreview title={creditNote ? 'Credit note – print preview' : 'Tax invoice – print preview'} hint="Check it, then print on A5 paper." page={{ size: 'A5', margin: '8mm' }} onPrint={record} onClose={onClose}>
      <PrintDocument className="bill-doc ph-doc">
        <header className="ph-doc-head">
          <div className="lh-name">{settings.name}</div>
          {settings.address && <div>{settings.address}</div>}
          <div className="pdoc-small">
            {[settings.phone && `Phone ${settings.phone}`, settings.gstin && `GSTIN ${settings.gstin}`, settings.licence20 && `DL 20: ${settings.licence20}`, settings.licence21 && `DL 21: ${settings.licence21}`].filter(Boolean).join(' · ')}
          </div>
        </header>
        <h1 className="pdoc-title">{creditNote ? 'Credit note' : 'Tax invoice'}</h1>
        <table className="bill-doc-head">
          <tbody>
            <tr>
              <th scope="row">{creditNote ? 'Credit note' : 'Invoice no.'}</th>
              <td>{creditNote ?? v.number}</td>
              <th scope="row">Date</th>
              <td>{formatDateTime(ret ? ret.at : v.date)}</td>
            </tr>
            <tr>
              <th scope="row">{v.patient ? 'Patient' : 'Customer'}</th>
              <td>{v.patient ? `${v.patient.fullName} (${v.patient.mrn})` : v.customer?.name}</td>
              <th scope="row">Doctor</th>
              <td>{v.doctor ? `${v.doctor.name}${v.doctor.reg ? `, Reg. ${v.doctor.reg}` : ''}` : '–'}</td>
            </tr>
            {v.buyer && (
              <>
                <tr>
                  <th scope="row">Buyer</th>
                  <td>{v.buyer.name}</td>
                  <th scope="row">GSTIN</th>
                  <td>{v.buyer.gstin}</td>
                </tr>
                <tr>
                  <th scope="row">Address</th>
                  <td colSpan={3}>{buyerAddress(v.buyer)}</td>
                </tr>
              </>
            )}
            {(creditNote || stay) && (
              <tr>
                <th scope="row">{creditNote ? 'Against invoice' : 'Ward'}</th>
                <td>{creditNote ? v.number : `${stay?.ward ?? ''}${stay?.bed ? `, bed ${stay.bed}` : ''}`}</td>
                <th scope="row" />
                <td />
              </tr>
            )}
          </tbody>
        </table>
        <table className="bill-doc-lines ph-doc-lines">
          <thead>
            <tr>
              <th scope="col">Medicine</th>
              <th scope="col">HSN</th>
              <th scope="col">Batch / exp</th>
              <th scope="col" className="num">Qty</th>
              <th scope="col" className="num">MRP</th>
              <th scope="col" className="num">GST</th>
              <th scope="col" className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.name}
                  {l.schedule ? ` (${l.schedule === 'narcotic' ? 'NDPS' : `Sch. ${l.schedule}`})` : ''}
                </td>
                <td>{l.hsn}</td>
                <td>
                  {l.batch} / {expiryLabel(l.expiry)}
                </td>
                <td className="num">{l.qty}</td>
                <td className="num">{money(l.mrpPaise)}</td>
                <td className="num">{l.gstRate}%</td>
                <td className="num">{money(l.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!creditNote && (
          <table className="bill-doc-sums">
            <tbody>
              {v.discountPercent > 0 && (
                <tr>
                  <th scope="row">Discount</th>
                  <td>{v.discountPercent}% (included above)</td>
                </tr>
              )}
              <tr>
                <th scope="row">Taxable value</th>
                <td>{money(v.taxablePaise)}</td>
              </tr>
              <tr>
                <th scope="row">CGST</th>
                <td>{money(v.cgstPaise)}</td>
              </tr>
              <tr>
                <th scope="row">SGST</th>
                <td>{money(v.sgstPaise)}</td>
              </tr>
              <tr className="bill-doc-balance">
                <th scope="row">Total{v.returnedPaise ? ' (after returns)' : ''}</th>
                <td>{money(v.netPaise)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {creditNote && (
          <table className="bill-doc-sums">
            <tbody>
              <tr className="bill-doc-balance">
                <th scope="row">Credited</th>
                <td>{money(total)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="pdoc-small">
          {v.patient ? 'Payable at the billing desk with the hospital bill.' : v.payments.map((p) => `${p.kind === 'refund' ? 'Refunded' : 'Paid'} ${money(p.amountPaise)} by ${MODE_LABELS[p.mode]}`).join('; ')}
          {settings.pharmacistName ? ` · Pharmacist: ${settings.pharmacistName}` : ''}. Prices include GST. This is a computer-generated {creditNote ? 'credit note' : 'invoice'}.
        </p>
      </PrintDocument>
    </PrintPreview>
  );
}

function ReturnDialog({ invoice: v, onClose, onDone }) {
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('cash');
  const s = useSend(onDone);
  const items = v.lines.filter((l) => l.canReturn).map((l) => ({ l, n: Number(qty[l.id] ?? 0) }));
  const chosen = items.filter((x) => x.n > 0);
  const ok = chosen.length > 0 && chosen.every((x) => Number.isInteger(x.n) && x.n <= x.l.qty - x.l.returnedQty) && reason.trim().length >= 3;
  return (
    <Modal id="ph-return" title="Take medicines back" onClose={onClose} wide>
      <p>Only unopened medicines, before their expiry. Stock goes back to its batch and a credit note is made.</p>
      <Alert type="error">{s.error}</Alert>
      <table className="bill-lines">
        <thead>
          <tr>
            <th scope="col">Medicine</th>
            <th scope="col" className="num">Sold</th>
            <th scope="col" className="num">Returned</th>
            <th scope="col" className="num">Return now</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ l }) => (
            <tr key={l.id}>
              <td>
                {l.name} <span className="muted">· {l.batch}</span>
              </td>
              <td className="num">{l.qty}</td>
              <td className="num">{l.returnedQty}</td>
              <td className="num">
                <input className="bill-price-input" inputMode="numeric" aria-label={`Return how many ${l.name}`} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-grid">
        <Field label="Reason" id="ph-ret-reason" error={s.fields.reason}>
          <input id="ph-ret-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {!v.patient && (
          <Field label="Money given back by" id="ph-ret-mode">
            <select id="ph-ret-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              {Object.entries(MODE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={!ok || s.busy} onClick={() => s.send(`/pharmacy/invoices/${v.id}/returns`, { items: chosen.map((x) => ({ lineId: x.l.id, qty: x.n })), reason: reason.trim(), ...(v.patient ? {} : { refund: { mode } }) })}>
          <RotateCcw aria-hidden="true" /> {s.busy ? 'Saving…' : 'Take back'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/**
 * A sale to a business with a GSTIN: the buyer, and the e-invoice file. The file is the invoice in the Government of
 * India's e-invoice format (schema INV-01, version 1.1); the hospital admin downloads it and uploads it on the
 * e-invoice portal by hand. Perinexa sends nothing to the portal.
 */
function BusinessBuyer({ invoice: v, einvoice }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const download = async (creditNote) => {
    setBusy(creditNote ?? 'invoice');
    setError(null);
    setSaved(null);
    try {
      const { blob, name } = await apiFile(`/pharmacy/invoices/${v.id}/einvoice`, { query: { creditNote } });
      downloadFile(blob, name);
      setSaved(`Saved as “${name}” in your Downloads folder. Give it to your accountant to check before it is uploaded.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const problems = einvoice?.problems ?? [];
  return (
    <section className="card bill-section ph-einvoice" aria-labelledby="ph-einv">
      <h2 id="ph-einv">Business buyer and e-invoice file</h2>
      <p>
        <strong>{v.buyer.name}</strong> · GSTIN {v.buyer.gstin} · {buyerAddress(v.buyer)}
      </p>
      <ul>
        <li>Sales to patients need no e-invoice. This file is only for this sale to a business that gave its GSTIN.</li>
        <li>Perinexa does not connect to the e-invoice portal. The file is downloaded here and uploaded on the portal by hand; the portal then gives the invoice its reference number (IRN) and QR code.</li>
        <li>Your accountant must check the file before it is uploaded – and whether e-invoicing applies to this pharmacy at all (it depends on the yearly turnover).</li>
        {v.buyer.stateCode && einvoice?.sellerStateCode && v.buyer.stateCode !== einvoice.sellerStateCode && (
          <li>This buyer is registered in another state. The invoice charges CGST and SGST because the medicines were handed over at the pharmacy’s counter: ask the accountant whether that is right for this buyer.</li>
        )}
      </ul>
      {problems.length > 0 && (
        <Alert type="warning">
          The file cannot be made yet:
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}
      <Alert type="error" onClose={() => setError(null)}>
        {error}
      </Alert>
      <Alert type="success" onClose={() => setSaved(null)}>
        {saved}
      </Alert>
      {einvoice?.canDownload ? (
        <div className="row">
          <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || problems.length > 0} onClick={() => download()}>
            <FileJson aria-hidden="true" /> {busy === 'invoice' ? 'Making the file…' : 'Download the e-invoice file'}
          </button>
          {v.returns.map((r) => (
            <button key={r.number} type="button" className="btn btn-secondary" disabled={Boolean(busy) || problems.length > 0} onClick={() => download(r.number)}>
              <FileJson aria-hidden="true" /> {busy === r.number ? 'Making the file…' : `File for credit note ${r.number}`}
            </button>
          ))}
        </div>
      ) : (
        <p className="hint">The hospital admin downloads the e-invoice file from this page.</p>
      )}
    </section>
  );
}

export function InvoicePage() {
  const { id } = useParams();
  const location = useLocation();
  const { activeMembership } = useAuth();
  const res = useFetch(`/pharmacy/invoices/${id}`);
  const [invoice, setInvoice] = useState(null);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [returning, setReturning] = useState(false);
  const [printing, setPrinting] = useState(null); // { creditNote? }
  const v = invoice ?? res.data?.invoice;
  if (res.error && !v) return <div className="pf-content"><Alert type="error">{res.error}</Alert></div>;
  if (!v) return <div className="pf-content"><p className="muted" aria-busy="true">Loading the invoice…</p></div>;
  const desk = activeMembership.roles.includes('pharmacist');
  const printItems = [{ label: 'Tax invoice', icon: Printer, onSelect: () => setPrinting({}) }, ...v.returns.map((r) => ({ label: `Credit note ${r.number}`, icon: Printer, onSelect: () => setPrinting({ creditNote: r.number }) }))];
  return (
    <>
      <PharmacyHeader
        title={`Invoice ${v.number}`}
        crumb={v.number}
        subtitle={[v.kind === 'issue' ? 'Issue to an admitted patient' : 'Counter sale', whoOf(v), formatDateTime(v.date), `by ${v.byName}`].join(' · ')}
        actions={
          <>
            {desk && v.lines.some((l) => l.canReturn) && (
              <button type="button" className="btn btn-secondary" onClick={() => setReturning(true)}>
                <RotateCcw aria-hidden="true" /> Take back
              </button>
            )}
            <MenuButton className="btn btn-primary" icon={Printer} label="Print" items={printItems} align="end" />
          </>
        }
      />
      <div className="pf-content bill-page">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        {v.billId && (
          <p className="hint">
            On her hospital bill: <Link to={`/billing/bills/${v.billId}`}>open the bill</Link> (reception takes the payment).
          </p>
        )}
        {activeMembership.roles.includes('admin') && <TallyMarks model="invoice" id={v.id} />}
        <section className="card bill-section">
          <table className="bill-lines">
            <thead>
              <tr>
                <th scope="col">Medicine</th>
                <th scope="col">Batch</th>
                <th scope="col" className="num">Qty</th>
                <th scope="col" className="num">MRP</th>
                <th scope="col" className="num">GST</th>
                <th scope="col" className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {v.lines.map((l) => (
                <tr key={l.id}>
                  <td data-label="Medicine">
                    {l.name} <ScheduleMark schedule={l.schedule} />
                    {l.returnedQty > 0 && <span className="muted"> · {l.returnedQty} returned</span>}
                  </td>
                  <td data-label="Batch">
                    {l.batch} · exp {expiryLabel(l.expiry)}
                  </td>
                  <td data-label="Qty" className="num">{l.qty}</td>
                  <td data-label="MRP" className="num">{money(l.mrpPaise)}</td>
                  <td data-label="GST" className="num">{l.gstRate}%</td>
                  <td data-label="Amount" className="num">{money(l.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="bill-sums">
            <tbody>
              {v.discountPercent > 0 && (
                <tr>
                  <th scope="row">Discount</th>
                  <td>
                    {v.discountPercent}% – {v.discountReason}
                  </td>
                </tr>
              )}
              {v.returnedPaise > 0 && (
                <tr>
                  <th scope="row">Returned</th>
                  <td>−{money(v.returnedPaise)}</td>
                </tr>
              )}
              <tr>
                <th scope="row">Taxable value</th>
                <td>{money(v.taxablePaise)}</td>
              </tr>
              <tr>
                <th scope="row">CGST + SGST</th>
                <td>
                  {money(v.cgstPaise)} + {money(v.sgstPaise)}
                </td>
              </tr>
              <tr className="bill-balance">
                <th scope="row">Total</th>
                <td>{money(v.netPaise)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        {v.buyer && <BusinessBuyer invoice={v} einvoice={res.data?.einvoice} />}
        {(v.payments.length > 0 || v.returns.length > 0) && (
          <section className="card bill-section">
            <h2>Payments and returns</h2>
            <ul className="appt-lines">
              {v.payments.map((p, i) => (
                <li key={`p${i}`}>
                  {p.kind === 'refund' ? 'Refund' : 'Paid'} {money(p.amountPaise)} · {MODE_LABELS[p.mode]}
                  {p.reference ? ` · ${p.reference}` : ''} <span className="muted">· {formatDateTime(p.at)} · {p.byName}</span>
                </li>
              ))}
              {v.returns.map((r) => (
                <li key={r.number}>
                  Credit note {r.number}: {money(r.amountPaise)} – {r.reason} <span className="muted">· {formatDateTime(r.at)} · {r.byName}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {v.doctor && (
          <p className="hint">
            Prescribed by {v.doctor.name}
            {v.doctor.reg ? ` (Reg. ${v.doctor.reg})` : ''}
            {v.fromPrescription ? ' – Perinexa prescription' : v.rxSeen ? ' – outside prescription seen' : ''}.
          </p>
        )}
      </div>
      {returning && (
        <ReturnDialog
          invoice={v}
          onClose={() => setReturning(false)}
          onDone={(out) => {
            setInvoice(out.invoice);
            setReturning(false);
            setFlash(`Taken back – credit note ${out.creditNote}.`);
          }}
        />
      )}
      {printing && res.data && <InvoicePrint invoice={v} settings={res.data.settings} stay={res.data.stay} creditNote={printing.creditNote ?? null} onClose={() => setPrinting(null)} />}
    </>
  );
}
