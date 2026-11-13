import { useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { toPaise } from '../billing/billingFormat.js';
import { money, useSend } from './pharmacyUi.jsx';
import { DateText } from '../../components/DateText.jsx';

// PH15 (docs/PHARMACY_BUILD_NOTE.md): the pharmacy's missing reports and the day's closing, on Reports.
// Counts and amounts only – no patient list. "Use by ward" comes with stock outside the pharmacy (PH13).

const MODE_WORDS = { cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', neft: 'NEFT / RTGS' };

function Table({ caption, head, rows, empty }) {
  return (
    <table className="bill-report">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {head.map(([label, num]) => (
            <th key={label} scope="col" className={num ? 'num' : undefined}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows
        ) : (
          <tr>
            <td colSpan={head.length} className="muted">
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function FiguresReport({ from, to }) {
  const res = useFetch('/pharmacy/reports/figures', { from, to });
  const d = res.data;
  if (res.error) return <Alert type="error">{res.error}</Alert>;
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <>
      <section className="card bill-section" aria-labelledby="fig-profit">
        <h2 id="fig-profit">Profit by medicine</h2>
        <p className="hint">
          Sales before GST, net of returns, less what the stock cost. All medicines: sales {money(d.profit.salesPaise)}, cost {money(d.profit.costPaise)}, profit <strong>{money(d.profit.profitPaise)}</strong>.
        </p>
        <Table
          caption="Profit by medicine"
          head={[['Medicine'], ['Qty', 1], ['Sales', 1], ['Cost', 1], ['Profit', 1], ['Margin', 1]]}
          empty="No sales in this period."
          rows={d.profit.rows.slice(0, 50).map((r) => (
            <tr key={r.medicineId}>
              <td>{r.name}</td>
              <td className="num">{r.qty}</td>
              <td className="num">{money(r.salesPaise)}</td>
              <td className="num">{money(r.costPaise)}</td>
              <td className="num">{money(r.profitPaise)}</td>
              <td className="num">{r.marginPercent == null ? '—' : `${r.marginPercent}%`}</td>
            </tr>
          ))}
        />
      </section>
      <section className="card bill-section" aria-labelledby="fig-slow">
        <h2 id="fig-slow">Slow and non-moving stock (today)</h2>
        <p className="hint">Usable stock not sold or issued for 90 days (slow) or 180 days (non-moving), at cost: {money(d.nonMoving.valuePaise)}. Expired and held stock is shown apart.</p>
        <Table
          caption="Slow and non-moving stock"
          head={[['Medicine'], ['Last sold'], ['Qty', 1], ['Value at cost', 1], ['Expired or held', 1]]}
          empty="None – every medicine in stock moved in the last 90 days."
          rows={d.nonMoving.rows.slice(0, 50).map((r) => (
            <tr key={r.medicineId}>
              <td>
                {r.name}{' '}
                <StatusPill tone={r.band === 'non_moving' ? 'high' : 'watch'} icon={CircleAlert}>
                  {r.band === 'non_moving' ? 'Non-moving' : 'Slow'}
                </StatusPill>
              </td>
              <td>{r.lastSold ? formatDate(r.lastSold) : 'Not in 180 days'}</td>
              <td className="num">{r.qty}</td>
              <td className="num">{money(r.valuePaise)}</td>
              <td className="num">{r.heldOrExpiredPaise ? money(r.heldOrExpiredPaise) : '—'}</td>
            </tr>
          ))}
        />
      </section>
      <section className="card bill-section" aria-labelledby="fig-loss">
        <h2 id="fig-loss">Value lost to expiry</h2>
        <p>
          Written off as expired: <strong>{money(d.expiryLoss.writtenOffPaise)}</strong> ({d.expiryLoss.writeOffs} write-off{d.expiryLoss.writeOffs === 1 ? '' : 's'}) · returned to suppliers as expired:{' '}
          <strong>{money(d.expiryLoss.returnedToSupplierPaise)}</strong> ({d.expiryLoss.returns}). At cost.
        </p>
      </section>
      <section className="card bill-section" aria-labelledby="fig-out">
        <h2 id="fig-out">Days out of stock</h2>
        <p className="hint">About: worked out from the stock after every change (expired stock still counts as stock). Period: {d.outOfStock.periodDays} days.</p>
        <Table
          caption="Days out of stock"
          head={[['Medicine'], ['Days out of stock', 1]]}
          empty="No medicine was out of stock in this period."
          rows={d.outOfStock.rows.slice(0, 50).map((r) => (
            <tr key={r.medicineId}>
              <td>{r.name}</td>
              <td className="num">{r.days}</td>
            </tr>
          ))}
        />
      </section>
      <section className="card bill-section" aria-labelledby="fig-rx">
        <h2 id="fig-rx">Prescriptions filled in-house</h2>
        <p>
          {d.prescriptions.written} prescription{d.prescriptions.written === 1 ? '' : 's'} written in this period; {d.prescriptions.filled} sold from (at least in part) at this pharmacy
          {d.prescriptions.percent != null ? ` – ${d.prescriptions.percent} %` : ''}.
        </p>
      </section>
      <section className="card bill-section" aria-labelledby="fig-h1">
        <h2 id="fig-h1">Antibiotic (Schedule H1) use by month</h2>
        <Table
          caption="H1 use by month"
          head={[['Medicine'], ...d.h1.months.map((m) => [m, 1])]}
          empty="No Schedule H1 medicine sold or issued in this period."
          rows={d.h1.rows.map((r) => (
            <tr key={r.medicineId}>
              <td>{r.name}</td>
              {d.h1.months.map((m) => (
                <td key={m} className="num">
                  {r.byMonth[m] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        />
      </section>
    </>
  );
}

export function DayClosing() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const res = useFetch('/pharmacy/reports/day', { date });
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const s = useSend(() => {
    setCounted('');
    setNote('');
    res.reload();
  });
  const d = res.data;
  const countedPaise = toPaise(counted);
  const diff = d && Number.isFinite(countedPaise) ? countedPaise - d.expectedCashPaise : null;
  return (
    <section className="card bill-section" aria-labelledby="day-close">
      <h2 id="day-close">Day closing</h2>
      <Field label="Day" id="dc-date">
        <DateText id="dc-date" value={date} onChange={(v) => setDate(v)} />
      </Field>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {d && (
        <>
          <dl className="ph-facts">
            {Object.entries(d.byMode).map(([k, v]) => (
              <div key={k}>
                <dt>{MODE_WORDS[k] ?? k}</dt>
                <dd>{money(v)}</dd>
              </div>
            ))}
            <div>
              <dt>Refunds</dt>
              <dd>{d.refundsPaise ? money(d.refundsPaise) : '—'}</dd>
            </div>
            <div>
              <dt>On patients’ hospital bills</dt>
              <dd>{money(d.onBillsPaise)}</dd>
            </div>
            <div>
              <dt>Invoices</dt>
              <dd>{d.invoices}</dd>
            </div>
            <div>
              <dt>Cash expected</dt>
              <dd>
                <strong>{money(d.expectedCashPaise)}</strong>
              </dd>
            </div>
          </dl>
          {d.closed ? (
            <p>
              <StatusPill tone={d.closed.differencePaise ? 'watch' : 'stable'} icon={d.closed.differencePaise ? CircleAlert : CircleCheck}>
                Closed
              </StatusPill>{' '}
              by {d.closed.byName}, {formatDateTime(d.closed.at)} · cash counted {money(d.closed.countedCashPaise)}
              {d.closed.differencePaise ? ` · difference ${money(d.closed.differencePaise)}: ${d.closed.note}` : ''}
            </p>
          ) : (
            d.canClose && (
              <>
                <Alert type="error">{s.error}</Alert>
                <div className="form-grid">
                  <Field label="Cash counted ₹" id="dc-counted" hint={diff ? `${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than expected.` : undefined} keepHint>
                    <input id="dc-counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
                  </Field>
                  <Field label={diff ? 'Why the cash differs' : 'Note (optional)'} id="dc-note" error={s.fields.note}>
                    <input id="dc-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                </div>
                <div className="row">
                  <button type="button" className="btn btn-primary" disabled={!Number.isFinite(countedPaise) || counted === '' || (diff && note.trim().length < 3) || s.busy} onClick={() => s.send('/pharmacy/day-close', { date, countedCashPaise: countedPaise, note: note.trim() })}>
                    {s.busy ? 'Saving…' : 'Close the day'}
                  </button>
                </div>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
