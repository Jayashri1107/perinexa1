import { useState } from 'react';
import { Banknote, CircleCheck, CircleSlash, HandCoins, Hourglass, PencilLine, Plus } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, KpiCard, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_PAYROLL } from '../../platform/modules.js';
import { rupees } from '../billing/billingFormat.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { SimpleTable } from '../quality/SimpleTable.jsx';
import { ADVANCE_STATUS_WORDS, advanceStatus, amountText, monthsLeft, typedPaise } from './payFormat.js';
import { isMonth, monthLabel } from './runFormat.js';

// Payroll → Advances (Stage C, docs/PAYROLL_BUILD_NOTE.md section 5 C): an advance given to a staff member and taken
// back from their salary month by month. What a month takes back is written when that month is locked; one month's
// instalment is changed on Run payroll, with a reason. The amount and the date are not changed afterwards: an
// advance entered wrongly is stopped with a reason and entered again. Nothing here goes into Daily expenses.

const STATUS_PILL = { open: ['watch', Hourglass], done: ['stable', CircleCheck], stopped: ['inactive', CircleSlash] };
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

function NewAdvance({ staffChoices, currentMonth, onDone, onCancel }) {
  const [v, setV] = useState({ staffId: '', givenOn: today(), amount: '', instalment: '', recoverFrom: currentMonth, note: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fe = (k) => error?.fields?.[k];
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    const amountPaise = typedPaise(v.amount);
    const instalmentPaise = typedPaise(v.instalment);
    const fields = {};
    if (!v.staffId) fields.staffId = 'Choose the staff member';
    if (!v.givenOn) fields.givenOn = 'Choose the day the advance was given';
    if (!amountPaise) fields.amountPaise = 'Write the amount of the advance, like 10000';
    if (instalmentPaise == null) fields.instalmentPaise = 'Write what is taken back each month, like 2000 (0 for nothing yet)';
    if (!isMonth(v.recoverFrom)) fields.recoverFrom = 'Choose the first month it is taken back from';
    if (Object.keys(fields).length) {
      setError({ fields });
      return;
    }
    setBusy(true);
    try {
      onDone(await api('/payroll/advances', { method: 'POST', body: { staffId: v.staffId, givenOn: v.givenOn, amountPaise, instalmentPaise, recoverFrom: v.recoverFrom, note: v.note.trim() } }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <FormDialog id="pr-adv-new" title="Give an advance" submitLabel="Save the advance" busy={busy} onSubmit={save} onCancel={onCancel} grid>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Staff member" id="pr-adv-who" error={fe('staffId')}>
        <select id="pr-adv-who" value={v.staffId} onChange={set('staffId')}>
          <option value="">Choose…</option>
          {staffChoices.map((p) => (
            <option key={p.id} value={p.id}>{`${p.name} (${p.staffNumber})`}</option>
          ))}
        </select>
      </Field>
      <Field label="Given on" id="pr-adv-on" error={fe('givenOn')}>
        <input id="pr-adv-on" type="date" value={v.givenOn} max={today()} onChange={set('givenOn')} />
      </Field>
      <Field label="Amount (₹)" id="pr-adv-amount" error={fe('amountPaise')}>
        <input id="pr-adv-amount" inputMode="decimal" value={v.amount} onChange={set('amount')} />
      </Field>
      <Field label="Taken back each month (₹)" id="pr-adv-inst" error={fe('instalmentPaise')}>
        <input id="pr-adv-inst" inputMode="decimal" value={v.instalment} onChange={set('instalment')} />
      </Field>
      <Field label="First month it is taken back from" id="pr-adv-from" error={fe('recoverFrom')}>
        <input id="pr-adv-from" type="month" value={v.recoverFrom} onChange={set('recoverFrom')} />
      </Field>
      <Field label="Note" id="pr-adv-note" error={fe('note')}>
        <input id="pr-adv-note" value={v.note} maxLength={200} onChange={set('note')} />
      </Field>
      <p className="hint">The amount and the date can’t be changed later. An advance entered wrongly is stopped with a reason and entered again.</p>
    </FormDialog>
  );
}

function ChangeAdvance({ advance, onDone, onCancel }) {
  const [v, setV] = useState({ instalment: amountText(advance.instalmentPaise), recoverFrom: advance.recoverFrom, note: advance.note, stopped: Boolean(advance.stopped), stopReason: advance.stopped?.reason ?? '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fe = (k) => error?.fields?.[k];
  const save = async () => {
    const instalmentPaise = typedPaise(v.instalment);
    if (instalmentPaise == null) {
      setError({ fields: { instalmentPaise: 'Write what is taken back each month, like 2000 (0 for nothing)' } });
      return;
    }
    setBusy(true);
    try {
      onDone(await api(`/payroll/advances/${advance.id}`, { method: 'PUT', body: { instalmentPaise, recoverFrom: v.recoverFrom, note: v.note.trim(), stopped: v.stopped, stopReason: v.stopReason.trim() } }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <FormDialog id="pr-adv-edit" title={`Advance of ${advance.name}`} submitLabel="Save" busy={busy} onSubmit={save} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <p className="hint">{`${rupees(advance.amountPaise)} given on ${formatDate(advance.givenOn)}. ${rupees(advance.balancePaise)} is left.`}</p>
      {advance.months.length > 0 && <p className="hint">{`Taken back so far: ${advance.months.map((m) => `${monthLabel(m.month)} ${rupees(m.amountPaise)}`).join('; ')}.`}</p>}
      <Field label="Taken back each month (₹)" id="pr-adv-e-inst" error={fe('instalmentPaise')} hint="For the months not locked yet. One month alone is changed on Run payroll.">
        <input id="pr-adv-e-inst" inputMode="decimal" value={v.instalment} onChange={(e) => setV({ ...v, instalment: e.target.value })} />
      </Field>
      <Field label="First month it is taken back from" id="pr-adv-e-from" error={fe('recoverFrom')}>
        <input id="pr-adv-e-from" type="month" value={v.recoverFrom} onChange={(e) => setV({ ...v, recoverFrom: e.target.value })} />
      </Field>
      <Field label="Note" id="pr-adv-e-note" error={fe('note')}>
        <input id="pr-adv-e-note" value={v.note} maxLength={200} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={v.stopped} onChange={(e) => setV({ ...v, stopped: e.target.checked })} /> Stop taking this advance back
      </label>
      {v.stopped && (
        <Field label="Why it is stopped" id="pr-adv-e-why" error={fe('stopReason')} hint="For example: entered twice; settled in cash.">
          <input id="pr-adv-e-why" value={v.stopReason} maxLength={200} disabled={Boolean(advance.stopped)} onChange={(e) => setV({ ...v, stopReason: e.target.value })} />
        </Field>
      )}
    </FormDialog>
  );
}

export function PayrollAdvancesPage() {
  const res = useFetch('/payroll/advances');
  const [saved, setSaved] = useState(null);
  const [open, setOpen] = useState(null); // 'new' | an advance
  const [notice, setNotice] = useState(null);
  const data = saved ?? res.data;
  const done = (answer, text) => {
    setSaved(answer);
    setOpen(null);
    setNotice(text);
  };
  const rows = data?.advances ?? [];
  const running = rows.filter((a) => advanceStatus(a) === 'open');
  return (
    <>
      <PageHeader
        tabs={HOSPITAL_PAYROLL.tabs}
        title="Advances"
        documentTitle="Payroll advances"
        help="An advance given to a staff member is taken back from their salary, an instalment a month. What a month took back is written when that month is locked."
        actions={
          data && (
            <button type="button" className="btn btn-primary" onClick={() => setOpen('new')}>
              <Plus aria-hidden="true" /> Give an advance
            </button>
          )
        }
      />
      <div className="pf-content pr-page">
        <Alert type="error">{res.error}</Alert>
        {notice && (
          <Alert type="success" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}
        {data && (
          <>
            <div className="kpi-grid">
              <KpiCard icon={Banknote} label="Still to be taken back" value={rupees(data.openPaise)} textValue sub="Of the advances not stopped" />
              <KpiCard icon={HandCoins} label="Being taken back" value={running.length} sub={running.length === 1 ? 'Advance' : 'Advances'} />
            </div>
            <section className="card" aria-labelledby="pr-adv-h">
              <h2 id="pr-adv-h">Advances given</h2>
              <div className="pr-fit">
                <SimpleTable
                  rows={rows}
                  emptyText="No advance was given yet."
                  columns={[
                    { key: 'number', header: 'Staff no.', nowrap: true, render: (a) => a.staffNumber },
                    { key: 'name', header: 'Name', main: true, wide: true, render: (a) => a.name },
                    { key: 'given', header: 'Given on', nowrap: true, render: (a) => formatDate(a.givenOn) },
                    { key: 'amount', header: 'Amount', num: true, nowrap: true, render: (a) => rupees(a.amountPaise) },
                    { key: 'inst', header: 'Each month', num: true, nowrap: true, render: (a) => rupees(a.instalmentPaise) },
                    { key: 'from', header: 'From', render: (a) => monthLabel(a.recoverFrom) },
                    { key: 'left', header: 'Left', num: true, nowrap: true, render: (a) => <strong>{rupees(a.balancePaise)}</strong> },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (a) => {
                        const status = advanceStatus(a);
                        const [tone, icon] = STATUS_PILL[status];
                        const left = status === 'open' ? monthsLeft(a) : null;
                        return (
                          <StatusPill tone={tone} icon={icon} title={a.stopped ? `${a.stopped.reason} – ${a.stopped.byName}` : undefined}>
                            {`${ADVANCE_STATUS_WORDS[status]}${left ? ` – ${left} more month${left === 1 ? '' : 's'}` : ''}`}
                          </StatusPill>
                        );
                      },
                    },
                    { key: 'note', header: 'Note', render: (a) => a.note || '—' },
                    {
                      key: 'change',
                      header: '',
                      render: (a) => (
                        <button type="button" className="btn btn-link btn-sm" onClick={() => setOpen(a)}>
                          <PencilLine aria-hidden="true" /> Change
                        </button>
                      ),
                    },
                  ]}
                />
              </div>
              <p className="hint">One month’s instalment is changed on Run payroll (the pencil on the person’s row), with a reason. An advance is never taken back below a take-home of zero.</p>
            </section>
          </>
        )}
        {!data && !res.error && <p className="muted">Loading…</p>}
      </div>
      {open === 'new' && <NewAdvance staffChoices={data.staffChoices} currentMonth={data.currentMonth} onCancel={() => setOpen(null)} onDone={(answer) => done(answer, 'The advance was saved.')} />}
      {open && open !== 'new' && <ChangeAdvance advance={open} onCancel={() => setOpen(null)} onDone={(answer) => done(answer, 'Saved.')} />}
    </>
  );
}
