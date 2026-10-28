import { useState } from 'react';
import { ListChecks, Search } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { rupees } from './billingFormat.js';
import { CancelExpenseDialog, ExpenseEntryForm, ExpenseHeadsDialog, ExpensesList } from './ExpenseEntry.jsx';
import { expensesTotal, hospitalNow } from './expenseFormat.js';

// Daily Expenses (owner, 28 Oct 2026): its own place in the menu for reception, the billing department and the
// hospital admin, laid out like the hospital's old "Daily Expenses" screen – the expenses of a period on the left
// (From, To, Show), a new expense on the right. Every expense is also taken off the day on Billing → Daily summary.

export function DailyExpensesPage() {
  const { activeMembership } = useAuth();
  const today = hospitalNow().date;
  const [range, setRange] = useState({ from: today, to: today });
  const [shown, setShown] = useState({ from: today, to: today });
  const [cancelling, setCancelling] = useState(null);
  const [managing, setManaging] = useState(false);
  const list = useFetch('/billing/expenses', shown);
  const heads = useFetch('/billing/expense-heads');
  const isAdmin = activeMembership.roles.includes('admin');
  const expenses = list.data?.expenses ?? [];

  const show = (e) => {
    e.preventDefault();
    setShown({ ...range });
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
          <h2 id="exp-list-title">Expenses entered</h2>
          <form className="exp-range" onSubmit={show}>
            <Field label="From date" id="exp-from">
              <input id="exp-from" type="date" value={range.from} max={today} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </Field>
            <Field label="To date" id="exp-to">
              <input id="exp-to" type="date" value={range.to} max={today} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </Field>
            <button type="submit" className="btn btn-secondary" disabled={!range.from || !range.to}>
              <Search aria-hidden="true" /> Show
            </button>
          </form>
          <Alert type="error">{list.error?.message}</Alert>
          {list.loading && !list.data ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <ExpensesList expenses={expenses} onCancel={setCancelling} showDate caption="Expenses of the period" empty="No expenses entered in this period." />
              {expenses.length > 0 && (
                <p className="exp-total">
                  Total for the period: <strong>{rupees(expensesTotal(expenses))}</strong>
                </p>
              )}
            </>
          )}
        </section>

        <section className="card exp-new" aria-labelledby="exp-new-title">
          <h2 id="exp-new-title">New expense</h2>
          <Alert type="error">{heads.error?.message}</Alert>
          <ExpenseEntryForm heads={heads.data?.heads ?? []} onAdded={() => list.reload()} primary />
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
      {managing && <ExpenseHeadsDialog heads={heads.data?.heads ?? []} onClose={() => setManaging(false)} onChanged={() => heads.reload()} />}
    </>
  );
}
