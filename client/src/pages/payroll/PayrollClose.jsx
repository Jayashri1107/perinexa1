import { useState } from 'react';
import { Banknote, CircleCheck, Download, FilePen, HandCoins, Lock, LockOpen, PencilLine, Plus, Printer, Trash2, TriangleAlert, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, apiFile } from '../../api.js';
import { downloadFile } from '../../components/print/pdfExport.js';
import { Alert, Field, FieldError, KpiCard, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { rupees } from '../billing/billingFormat.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { SimpleTable } from '../quality/SimpleTable.jsx';
import { LINE_KIND_WORDS, LISTS, LIST_WORDS, LOCK_BLOCKER_WORDS, PAY_NOTE_WORDS, RATE_WORDS, hasMonthChanges, monthBody, monthForm, payLines } from './payFormat.js';
import { monthLabel } from './runFormat.js';

// Run payroll, Stages C and D (docs/PAYROLL_BUILD_NOTE.md section 5 C and D) – the parts of the screen after the
// salary sheet: each person's deductions and take-home, one person's month (TDS for the month, one-off lines, an
// advance's instalment), then locking the month, payslips and the monthly lists. Nothing is worked out here: the
// server sends every figure. A locked month is shown from its kept snapshot and takes no change.

const MAX_LINES = 10;
const money = (paise) => (paise ? rupees(paise) : '—');

// ---------- One person's month ----------
export function PersonMonthDialog({ month, row, onDone, onCancel }) {
  const [v, setV] = useState(() => monthForm(row));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fe = (k) => error?.fields?.[k];
  const setLine = (i, patch) => setV({ ...v, lines: v.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setInstalment = (id, patch) => setV({ ...v, instalments: { ...v.instalments, [id]: { ...v.instalments[id], ...patch } } });
  const save = async () => {
    const { body, errors } = monthBody(v, row);
    if (Object.keys(errors).length) {
      setError({ message: 'Please check the highlighted boxes.', fields: errors });
      return;
    }
    setBusy(true);
    try {
      onDone(await api(`/payroll/runs/${month}/people/${row.staffId}`, { method: 'PUT', body }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const lines = payLines(row);
  return (
    <FormDialog id="pr-person" title={`${monthLabel(month)} – ${row.name}`} submitLabel="Save" busy={busy} onSubmit={save} onCancel={onCancel} grid>
      <Alert type="error">{error?.message}</Alert>
      {lines && <p className="hint">{`As it stands: earnings ${rupees(lines.earningsPaise)}, deductions ${rupees(lines.deductionsPaise)}, take-home ${rupees(lines.takeHomePaise)}. What is typed here is for this month only.`}</p>}

      <Field label="Income tax (TDS) for this month (₹)" id="pr-person-tds" error={fe('tdsPaise')} hint={`Empty: the figure on the person’s pay, ${rupees(row.month.entryTdsPaise)}. Perinexa never works the tax out.`} keepHint>
        <input id="pr-person-tds" inputMode="decimal" value={v.tds} onChange={(e) => setV({ ...v, tds: e.target.value })} />
      </Field>

      <fieldset className="pr-lines">
        <legend>One-off additions and deductions</legend>
        <p className="hint">For example an arrear, or a deduction the hospital’s rules allow. Each line says what it is for – it is printed on the payslip.</p>
        <FieldError role="alert">{fe('lines')}</FieldError>
        {v.lines.map((l, i) => (
          <div className="pr-line" key={i}>
            <select aria-label={`Line ${i + 1}: addition or deduction`} value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value })}>
              {Object.entries(LINE_KIND_WORDS).map(([k, word]) => (
                <option key={k} value={k}>
                  {word}
                </option>
              ))}
            </select>
            <input aria-label={`Line ${i + 1}: what it is for`} placeholder="What it is for" value={l.label} maxLength={80} aria-invalid={fe(`lines.${i}.label`) ? true : undefined} onChange={(e) => setLine(i, { label: e.target.value })} />
            <input aria-label={`Line ${i + 1}: amount in rupees`} placeholder="₹" inputMode="decimal" className="pr-line-amount" value={l.amount} aria-invalid={fe(`lines.${i}.amountPaise`) ? true : undefined} onChange={(e) => setLine(i, { amount: e.target.value })} />
            <button type="button" className="icon-btn" aria-label={`Remove line ${i + 1}`} title="Remove" onClick={() => setV({ ...v, lines: v.lines.filter((_, j) => j !== i) })}>
              <Trash2 aria-hidden="true" />
            </button>
            <FieldError>{fe(`lines.${i}.label`) ?? fe(`lines.${i}.amountPaise`)}</FieldError>
          </div>
        ))}
        {v.lines.length < MAX_LINES && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setV({ ...v, lines: [...v.lines, { kind: 'addition', label: '', amount: '' }] })}>
            <Plus aria-hidden="true" /> Add a line
          </button>
        )}
      </fieldset>

      {row.month.advances.length > 0 && (
        <fieldset className="pr-lines">
          <legend>Advances taken back this month</legend>
          {row.month.advances.map((a, i) => (
            <div className="pr-advance" key={a.id}>
              <p className="hint">{`${rupees(a.amountPaise)} given on ${formatDate(a.givenOn)}${a.note ? ` (${a.note})` : ''}: ${rupees(a.balancePaise)} left, ${rupees(a.instalmentPaise)} each month.`}</p>
              <div className="form-grid">
                <Field label="This month only (₹)" id={`pr-person-adv-${i}`} error={fe(`instalments.${i}.amountPaise`) ?? fe(`instalments.${i}.advanceId`)} hint="Empty: the usual instalment. 0: nothing this month.">
                  <input id={`pr-person-adv-${i}`} inputMode="decimal" value={v.instalments[a.id]?.amount ?? ''} onChange={(e) => setInstalment(a.id, { amount: e.target.value })} />
                </Field>
                <Field label="Reason" id={`pr-person-why-${i}`} error={fe(`instalments.${i}.reason`)}>
                  <input id={`pr-person-why-${i}`} value={v.instalments[a.id]?.reason ?? ''} maxLength={200} onChange={(e) => setInstalment(a.id, { reason: e.target.value })} />
                </Field>
              </div>
            </div>
          ))}
        </fieldset>
      )}
    </FormDialog>
  );
}

// ---------- Deductions and take-home ----------
export function PaySection({ state, month, onOpenPerson, onPrintOne }) {
  const sheet = state.sheet;
  const locked = Boolean(state.locked);
  const totals = sheet.totals;
  const rateWords = state.draftRates.map((g) => RATE_WORDS[g]).join(', ');
  return (
    <section className="card" aria-labelledby="pr-pay-h">
      <h2 id="pr-pay-h">{`5. Deductions and take-home – ${monthLabel(month)}`}</h2>
      <div className="kpi-grid">
        <KpiCard icon={Wallet} label="Take-home" value={rupees(totals.takeHomePaise)} textValue sub={`${sheet.people - sheet.withoutPay} people`} />
        <KpiCard icon={Banknote} label="Deductions" value={rupees(totals.deductionsPaise)} textValue sub="PF, ESI, professional tax, TDS, others, advances" />
        <KpiCard icon={HandCoins} label="Hospital’s shares" value={rupees(totals.pfEmployerPaise + totals.esiEmployerPaise)} textValue sub="PF and ESI – never taken from the take-home" />
      </div>
      {state.draft && (
        <p className="pr-draft">
          <StatusPill tone="watch" icon={TriangleAlert}>
            DRAFT – not for payment
          </StatusPill>{' '}
          {state.draftRates.length ? `Worked out with rates the accountant has not confirmed: ${rateWords}.` : 'The rules for a day’s pay are not confirmed by the accountant.'} Compare with the present method. <Link to="/payroll/rates">Rates</Link>
        </p>
      )}
      <div className="pr-fit">
        <SimpleTable
          rowKey="staffId"
          rows={sheet.rows}
          columns={[
            { key: 'number', header: 'Staff no.', nowrap: true, render: (r) => r.staffNumber },
            { key: 'name', header: 'Name', main: true, wide: true, render: (r) => r.name },
            { key: 'gross', header: 'Pay for the month', num: true, nowrap: true, render: (r) => (r.pay ? rupees(r.pay.grossPaise) : '—') },
            { key: 'add', header: 'Additions', num: true, nowrap: true, render: (r) => (r.pay ? money(r.pay.additionsPaise) : '—') },
            { key: 'pf', header: 'PF', num: true, nowrap: true, render: (r) => (r.pay && r.applies?.pf ? rupees(r.pay.pfPaise) : '—') },
            { key: 'esi', header: 'ESI', num: true, nowrap: true, render: (r) => (r.pay && r.applies?.esi ? rupees(r.pay.esiPaise) : '—') },
            { key: 'pt', header: 'Prof. tax', num: true, nowrap: true, render: (r) => (r.pay && r.applies?.pt ? rupees(r.pay.ptPaise) : '—') },
            { key: 'tds', header: 'TDS', num: true, nowrap: true, render: (r) => (r.pay ? money(r.pay.tdsPaise) : '—') },
            { key: 'other', header: 'Other', num: true, nowrap: true, render: (r) => (r.pay ? money(r.pay.otherDeductionsPaise) : '—') },
            { key: 'advance', header: 'Advance', num: true, nowrap: true, render: (r) => (r.pay ? money(r.pay.advancePaise) : '—') },
            { key: 'net', header: 'Take-home', num: true, nowrap: true, render: (r) => (r.pay ? <strong>{rupees(r.pay.takeHomePaise)}</strong> : '—') },
            {
              key: 'notes',
              header: 'Notes',
              render: (r) => {
                const notes = [...(r.pay?.notes ?? []).map((n) => PAY_NOTE_WORDS[n] ?? n), ...(r.pay ? [] : ['Pay not entered']), ...(hasMonthChanges(r) ? ['Changed for this month'] : [])];
                return notes.join('; ') || '—';
              },
            },
            {
              key: 'do',
              header: '',
              render: (r) =>
                r.pay && (
                  <span className="pr-hand">
                    {!locked && (
                      <button type="button" className="icon-btn" aria-label={`This month for ${r.name}: TDS, one-off lines, advances`} title="This month: TDS, one-off lines, advances" onClick={() => onOpenPerson(r)}>
                        <PencilLine aria-hidden="true" />
                      </button>
                    )}
                    <button type="button" className="icon-btn" aria-label={`Print the payslip of ${r.name}`} title="Print this payslip" onClick={() => onPrintOne(r)}>
                      <Printer aria-hidden="true" />
                    </button>
                  </span>
                ),
            },
          ]}
        />
      </div>
      <p className="hint">
        PF and ESI are worked out on the parts of the pay that count for each (Payroll → Settings), with the rates of Payroll → Rates; professional tax is looked up by the person’s slab; TDS is the figure typed, never worked out. An advance is taken back last and never below a take-home of zero.
      </p>
    </section>
  );
}

// ---------- Lock, reopen, payslips, lists ----------
function LockDialog({ month, people, onDone, onCancel }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const lock = async () => {
    setBusy(true);
    try {
      onDone(await api(`/payroll/runs/${month}/lock`, { method: 'POST' }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <FormDialog id="pr-lock" title={`Lock ${monthLabel(month)}?`} submitLabel="Lock the month" busy={busy} onSubmit={lock} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <p>{`The month is kept exactly as it stands, for ${people} ${people === 1 ? 'person' : 'people'}: days, pay, deductions, advances and take-home. Payslips and the monthly lists are made from what is kept.`}</p>
      <p className="hint">A locked month takes no change. Only the hospital admin can reopen it, with a written reason – the payslips of this version are then marked “Replaced”.</p>
    </FormDialog>
  );
}

function ReopenDialog({ month, state, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const reopen = async () => {
    if (reason.trim().length < 5) {
      setError({ fields: { reason: 'Say why the month is reopened' } });
      return;
    }
    setBusy(true);
    try {
      onDone(await api(`/payroll/runs/${month}/reopen`, { method: 'POST', body: { reason: reason.trim() } }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const saved = [...new Set(state.downloads.map((d) => d.list))];
  return (
    <FormDialog id="pr-reopen" title={`Reopen ${monthLabel(month)}?`} submitLabel="Reopen the month" busy={busy} onSubmit={reopen} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <p>{`Version ${state.locked.version} stays as it was locked, and its payslips are marked “Replaced”. The month can then be corrected and locked again as version ${state.locked.version + 1}, whose payslips say “Revised”. What this version took back of advances is undone until then.`}</p>
      {saved.length > 0 && (
        <Alert type="warning">
          {`Already saved as files from this version: ${saved.map((l) => LIST_WORDS[l] ?? l).join(', ')}. What was filed or paid outside Perinexa from them is not changed by reopening – the accountant must correct it there.`}
        </Alert>
      )}
      <Field label="Reason" id="pr-reopen-why" error={error?.fields?.reason} hint="Kept with the month and written in the audit log.">
        <textarea id="pr-reopen-why" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

/** The buttons that save a locked month's lists as files. lists: the ones this hospital may save; downloads: what was saved already. */
export function ListButtons({ month, lists = LISTS, downloads = [], onSaved }) {
  const [problem, setProblem] = useState(null);
  const [saving, setSaving] = useState(null); // the list being saved
  const save = async (list) => {
    setSaving(list);
    setProblem(null);
    try {
      const { blob, name } = await apiFile(`/payroll/runs/${month}/lists/${list}`);
      downloadFile(blob, name);
      // (noted here without asking the server for the month again – opening the sheet is itself an audited reading)
      onSaved?.({ list, byName: 'you', at: new Date().toISOString() });
    } catch (err) {
      setProblem(err.message);
    } finally {
      setSaving(null);
    }
  };
  const lastSaved = (list) => [...downloads].reverse().find((d) => d.list === list);
  return (
    <>
      <Alert type="error">{problem}</Alert>
      <ul className="pr-lists">
        {lists.map((list) => {
          const last = lastSaved(list);
          return (
            <li key={list}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={saving === list} onClick={() => save(list)}>
                <Download aria-hidden="true" /> {saving === list ? 'Saving…' : (LIST_WORDS[list] ?? list)}
              </button>
              <span className="hint">{last ? `Last saved by ${last.byName}, ${formatDateTime(last.at)}` : 'Not saved yet'}</span>
            </li>
          );
        })}
      </ul>
      {lists.includes('bank') && <p className="hint">The bank payment list holds account numbers in full: keep the file safe and delete it once the bank has it. In Excel, open it through Data → From Text/CSV and set the account column to Text, or leading zeros are lost.</p>}
    </>
  );
}

export function LockSection({ state, month, onChanged, onPrint }) {
  const [open, setOpen] = useState(null); // 'lock' | 'reopen'
  const locked = state.locked;
  const replaced = state.versions.filter((v) => v.replaced);
  return (
    <section className="card" aria-labelledby="pr-lock-h">
      <h2 id="pr-lock-h">6. Lock, payslips and lists</h2>
      {locked ? (
        <>
          <p className="pr-draft">
            <StatusPill tone="stable" icon={Lock}>{`Locked – version ${locked.version}`}</StatusPill> {`By ${locked.byName}, ${formatDateTime(locked.at)}. The sheet above is shown as it was kept; nothing is worked out again.`}
          </p>
          <div className="row pr-lock-actions">
            <button type="button" className="btn btn-primary" onClick={() => onPrint({})}>
              <Printer aria-hidden="true" /> Print the payslips
            </button>
            {state.canReopen ? (
              <button type="button" className="btn btn-secondary" onClick={() => setOpen('reopen')}>
                <LockOpen aria-hidden="true" /> Reopen the month
              </button>
            ) : (
              <span className="hint">Only the hospital admin reopens a locked month, with a reason.</span>
            )}
          </div>
          <h3 className="pr-sub">The monthly lists</h3>
          <p className="hint">Each is a CSV file that opens in Excel. PF and ESI numbers show their last four characters unless the hospital admin switched full numbers on (Payroll → Settings). Each file saved is written in the audit log.</p>
          <ListButtons month={month} lists={state.lists} downloads={state.downloads} onSaved={(saved) => onChanged({ ...state, downloads: [...state.downloads, saved] }, null)} />
        </>
      ) : (
        <>
          {state.lockBlockers.length > 0 ? (
            <>
              <p className="pr-draft">
                <StatusPill tone="watch" icon={FilePen}>
                  Not ready to lock
                </StatusPill>{' '}
                Before this month can be locked:
              </p>
              <ul className="pr-problems">
                {state.lockBlockers.map((b) => (
                  <li key={b}>{LOCK_BLOCKER_WORDS[b] ?? b}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="pr-draft">
              <StatusPill tone="stable" icon={CircleCheck}>
                Ready to lock
              </StatusPill>{' '}
              Nothing is waiting. Check the sheet, then lock the month: payslips and lists are made from the locked month.
            </p>
          )}
          <div className="row pr-lock-actions">
            <button type="button" className="btn btn-primary" disabled={state.lockBlockers.length > 0} onClick={() => setOpen('lock')}>
              <Lock aria-hidden="true" /> Lock the month
            </button>
            {state.sheet && (
              <button type="button" className="btn btn-secondary" onClick={() => onPrint({})}>
                <Printer aria-hidden="true" /> Print DRAFT payslips
              </button>
            )}
          </div>
          {state.sheet && <p className="hint">Payslips of a month that is not locked are for checking only: every page says “DRAFT – not for payment”.</p>}
        </>
      )}

      {replaced.length > 0 && (
        <>
          <h3 className="pr-sub">Versions of this month</h3>
          <SimpleTable
            rowKey="version"
            rows={state.versions}
            columns={[
              { key: 'version', header: 'Version', num: true, render: (v) => v.version },
              { key: 'locked', header: 'Locked', render: (v) => `${v.lockedByName}, ${formatDateTime(v.lockedAt)}` },
              { key: 'people', header: 'People', num: true, render: (v) => v.people },
              { key: 'replaced', header: 'Reopened', wide: true, render: (v) => (v.replaced ? `${v.replaced.byName}, ${formatDateTime(v.replaced.at)}: ${v.replaced.reason}` : '—') },
              {
                key: 'slips',
                header: '',
                render: (v) => (
                  <button type="button" className="btn btn-link btn-sm" onClick={() => onPrint({ version: v.version })}>
                    <Printer aria-hidden="true" /> Payslips
                  </button>
                ),
              },
            ]}
          />
        </>
      )}

      {open === 'lock' && <LockDialog month={month} people={state.sheet.people} onCancel={() => setOpen(null)} onDone={(next) => { setOpen(null); onChanged(next, `${monthLabel(month)} is locked.`); }} />}
      {open === 'reopen' && <ReopenDialog month={month} state={state} onCancel={() => setOpen(null)} onDone={(next) => { setOpen(null); onChanged(next, `${monthLabel(month)} is open again. Lock it again when the correction is made.`); }} />}
    </section>
  );
}
