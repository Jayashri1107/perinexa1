import { useState } from 'react';
import { Banknote, ListChecks, Printer, ReceiptText, Wallet, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { rupees } from './billingFormat.js';
import { ExpensePrintPreview } from './ExpensePrint.jsx';
import { CancelExpenseDialog, ExpenseEntryForm, ExpenseHeadsDialog } from './ExpenseEntry.jsx';
import { ExpensesTable } from './ExpensesTable.jsx';
import { expenseFigures, filterExpenses, hospitalNow, isFiltering, quickPeriods } from './expenseFormat.js';

// Daily Expenses (owner, 28 Oct 2026): its own place in the menu for reception, the billing department and the
// hospital admin, laid out like the hospital's old "Daily Expenses" screen – the expenses of a period on the left
// (From, To), a new expense on the right. Every expense is also taken off the day on Billing → Daily summary. What is
// typed or chosen in the new expense filters the list as you go (3 Nov 2026), so a repeat entry is seen before saving.
// Print (11 Nov 2026): one expense ticked prints its voucher, several (or none ticked: all shown) the expenses sheet.
// Redesigned 12 Nov 2026: quick periods next to From/To, the figures of the period as tiles, one toolbar for ticking
// and printing, and a table whose rows stay short (ExpensesTable.jsx).

export function DailyExpensesPage() {
  const { activeMembership } = useAuth();
  const today = hospitalNow().date;
  const [range, setRange] = useState({ from: today, to: today });
  const [filter, setFilter] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const [cancelling, setCancelling] = useState(null);
  const [managing, setManaging] = useState(false);
  const [ticked, setTicked] = useState([]);
  const [printing, setPrinting] = useState(null); // the expenses being printed
  // A date changed in the form shows that day; the period applies as soon as it is chosen
  const rangeOk = range.from && range.to && range.from <= range.to;
  const list = useFetch(rangeOk || filter?.date ? '/billing/expenses' : null, filter?.date ? { from: filter.date, to: filter.date } : range);
  const heads = useFetch('/billing/expense-heads');
  const isAdmin = activeMembership.roles.includes('admin');
  const all = list.data?.expenses ?? [];
  const expenses = filterExpenses(all, filter);
  const filtering = isFiltering(filter);
  const printable = expenses.filter((e) => !e.cancelled);
  const tickedShown = printable.filter((e) => ticked.includes(e.id));
  const toPrint = tickedShown.length ? tickedShown : printable;
  const printLabel = tickedShown.length === 1 ? 'Print voucher' : tickedShown.length ? `Print sheet of ${tickedShown.length}` : 'Print sheet of all';
  const figures = expenseFigures(expenses);
  const periods = quickPeriods(today);
  const choose = (from, to) => {
    setRange({ from, to });
    setTicked([]);
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Daily expenses' }]}
        title="Daily expenses"
        subtitle="Money paid out from the counter. It is taken off the day's collection on Billing → Daily summary."
        actions={
          isAdmin && (
            <button type="button" className="btn btn-secondary" onClick={() => setManaging(true)}>
              <ListChecks aria-hidden="true" /> Expense heads
            </button>
          )
        }
      />
      <div className="exp-layout">
        <section className="card exp-list" aria-labelledby="exp-list-title">
          <div className="exp-list-head">
            <h2 id="exp-list-title">Expenses entered</h2>
            <div className="exp-quick" role="group" aria-label="Quick period">
              {periods.map((q) => (
                <button key={q.key} type="button" className="exp-quick-btn" aria-pressed={!filter?.date && range.from === q.from && range.to === q.to} onClick={() => choose(q.from, q.to)}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          <div className="exp-range">
            <Field label="From date" id="exp-from">
              <input id="exp-from" type="date" value={range.from} max={today} onChange={(e) => choose(e.target.value, range.to)} />
            </Field>
            <Field label="To date" id="exp-to">
              <input id="exp-to" type="date" value={range.to} max={today} onChange={(e) => choose(range.from, e.target.value)} />
            </Field>
          </div>
          {!rangeOk && !filter?.date && <p className="muted">Choose a From date on or before the To date.</p>}

          <div className="exp-tiles">
            <div className="exp-tile exp-tile-total">
              <span className="exp-tile-label">
                <Wallet aria-hidden="true" /> {filtering ? 'Total of these' : 'Total paid out'}
              </span>
              <strong className="exp-tile-value">{rupees(figures.totalPaise)}</strong>
            </div>
            <div className="exp-tile">
              <span className="exp-tile-label">
                <ReceiptText aria-hidden="true" /> Expenses
              </span>
              <strong className="exp-tile-value">{figures.count}</strong>
              {figures.cancelled > 0 && <span className="exp-tile-note">{figures.cancelled} cancelled, not counted</span>}
            </div>
            <div className="exp-tile">
              <span className="exp-tile-label">
                <Banknote aria-hidden="true" /> Cash
              </span>
              <strong className="exp-tile-value">{rupees(figures.cashPaise)}</strong>
              {figures.otherPaise > 0 && <span className="exp-tile-note">Other ways {rupees(figures.otherPaise)}</span>}
            </div>
          </div>

          {filtering && (
            <p className="exp-filtering">
              <span>
                Showing {expenses.length} of {all.length}, matching the new expense form.
              </span>
              <button type="button" className="btn btn-link" onClick={() => setFormKey((k) => k + 1)}>
                <X aria-hidden="true" /> Clear the form
              </button>
            </p>
          )}
          <Alert type="error">{list.error}</Alert>
          {list.loading && !list.data ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              {printable.length > 0 && (
                <div className="exp-toolbar">
                  <span className="exp-toolbar-note">
                    {tickedShown.length ? (
                      <>
                        <strong>{tickedShown.length} ticked</strong>
                        <button type="button" className="btn btn-link" onClick={() => setTicked([])}>
                          Clear
                        </button>
                      </>
                    ) : (
                      'Tick one expense to print its voucher, or several for the expenses sheet.'
                    )}
                  </span>
                  <button type="button" className="btn btn-secondary" onClick={() => setPrinting(toPrint)}>
                    <Printer aria-hidden="true" /> {printLabel}
                  </button>
                </div>
              )}
              <ExpensesTable expenses={expenses} selected={ticked} onSelect={setTicked} onCancel={setCancelling} empty={filtering ? 'No expense in this period matches the form.' : 'No expenses entered in this period.'} />
            </>
          )}
        </section>

        <section className="card exp-new" aria-labelledby="exp-new-title">
          <h2 id="exp-new-title">New expense</h2>
          <Alert type="error">{heads.error}</Alert>
          <ExpenseEntryForm key={formKey} heads={heads.data?.heads ?? []} onAdded={() => list.reload()} onFilter={setFilter} primary />
        </section>
      </div>

      {cancelling && (
        <CancelExpenseDialog
          expense={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            list.reload();
          }}
        />
      )}
      {printing && <ExpensePrintPreview expenses={printing} onClose={() => setPrinting(null)} />}
      {managing && <ExpenseHeadsDialog heads={heads.data?.heads ?? []} onClose={() => setManaging(false)} onChanged={() => heads.reload()} />}
    </>
  );
}
