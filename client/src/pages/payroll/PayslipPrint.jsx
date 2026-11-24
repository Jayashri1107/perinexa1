import { PrintDocument, PrintFacts, PrintPreview } from '../../components/print/PrintPreview.jsx';
import { Alert, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { amountInWords } from '../billing/amountWords.js';
import { lastFour, payLines, payslipBand } from './payFormat.js';
import { countsText, daysText, monthLabel } from './runFormat.js';

// Payslips (Stage D, docs/PAYROLL_BUILD_NOTE.md section 5 D): one a page, all of a month in one print, or one person's.
// Printed from what the server kept when the month was locked – so the same payslip can always be made again. While
// the month is open every page says "DRAFT – not for payment"; a version that was reopened says "Replaced".
// The PF number, ESI number, PAN and bank account show their last four characters only. Opening this is written in
// the audit log (the month and how many payslips – never an amount).

const amount = (paise) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Lines({ title, lines, totalLabel, totalPaise }) {
  return (
    <table className="ptable pdoc-table ps-lines">
      <thead>
        <tr>
          <th scope="col">{title}</th>
          <th scope="col" className="num">
            ₹
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map(([label, paise], i) => (
          <tr key={`${label}-${i}`}>
            <td>{label}</td>
            <td className="num">{amount(paise)}</td>
          </tr>
        ))}
        {!lines.length && (
          <tr>
            <td colSpan={2}>None</td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{totalLabel}</th>
          <td className="num">
            <strong>{amount(totalPaise)}</strong>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function Payslip({ slips, row }) {
  const lines = payLines(row);
  return (
    <section className="ps-slip">
      <header className="ps-head">
        <p className="ps-hospital">{slips.hospitalName}</p>
        <h1>{`Payslip – ${monthLabel(slips.month)}`}</h1>
        {slips.revised && !slips.replacedOn && <p className="ps-version">{`Revised – version ${slips.version}`}</p>}
      </header>
      <PrintFacts
        items={[
          ['Name', row.name],
          ['Staff number', row.staffNumber],
          ['Designation', row.designation],
          ['Department', row.department],
          ['PF number (UAN)', lastFour(row.numbers?.uan)],
          ['ESI number', lastFour(row.numbers?.esiNumber)],
          ['PAN', lastFour(row.numbers?.pan)],
          ['Bank account', [row.bankName, lastFour(row.numbers?.accountNumber)].filter(Boolean).join(' ')],
          ['Paid days', `${daysText(row.paidDays)} of ${row.basis ?? slips.basisDays}`],
          ['Monthly pay', `₹${amount(row.monthlyPaise)}`],
        ]}
      />
      <div className="ps-cols">
        <Lines title="Earnings" lines={lines.earnings} totalLabel="Total earnings" totalPaise={lines.earningsPaise} />
        <Lines title="Deductions" lines={lines.deductions} totalLabel="Total deductions" totalPaise={lines.deductionsPaise} />
      </div>
      <p className="ps-net">
        <span>Take-home</span> <strong>{`₹${amount(lines.takeHomePaise)}`}</strong>
      </p>
      <p className="ps-words">{amountInWords(lines.takeHomePaise)}</p>
      {row.counts && <p className="ps-days">{`Days: ${countsText(row.counts)}.`}</p>}
      {row.correction && <p className="ps-days">{`Paid days written by hand: ${row.correction.reason}.`}</p>}
      <p className="ps-made">{slips.draft ? 'Made from the month as it stands – not locked.' : `Made from the month locked by ${slips.lockedByName} on ${formatDateTime(slips.lockedAt)}. A computer-made payslip: no signature is needed.`}</p>
    </section>
  );
}

/** only: a staff id for one person's payslip (left out: everyone's). version: an older locked version (left out: the month as it stands). */
export function PayslipsPrint({ month, version, only, onClose }) {
  const res = useFetch(`/payroll/runs/${month}/payslips${version ? `?version=${version}` : ''}`);
  const slips = res.data;
  const rows = slips ? slips.rows.filter((r) => !only || r.staffId === only) : [];
  const band = slips ? payslipBand(slips, formatDate) : null;
  const title = `Payslips – ${monthLabel(month)}`;
  return (
    <PrintPreview title={`${title} – print preview`} hint={slips ? `${rows.length} payslip${rows.length === 1 ? '' : 's'}, one a page.${slips.draft ? ' The month is not locked: every page says DRAFT – not for payment.' : ''}` : 'Loading…'} onClose={onClose}>
      {res.error && <Alert type="error">{res.error}</Alert>}
      {slips && (
        <PrintDocument className="ps-doc" draft={slips.draft || slips.replacedOn ? band : undefined}>
          {rows.map((row) => (
            <Payslip key={row.staffId} slips={slips} row={row} />
          ))}
          {!rows.length && <p>No payslip: this person has no sum in this month.</p>}
        </PrintDocument>
      )}
    </PrintPreview>
  );
}
