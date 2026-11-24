import { useRef, useState } from 'react';
import { Banknote, CircleCheck, FilePen, FileUp, Lock, PencilLine, Trash2, TriangleAlert, Users } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, FieldError, KpiCard, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_PAYROLL } from '../../platform/modules.js';
import { rupees } from '../billing/billingFormat.js';
import { FormDialog } from '../quality/FormDialog.jsx';
import { SimpleTable } from '../quality/SimpleTable.jsx';
import { LockSection, PaySection, PersonMonthDialog } from './PayrollClose.jsx';
import { PayslipsPrint } from './PayslipPrint.jsx';
import { ROUNDING_WORDS } from './payrollFormat.js';
import {
  BASIS_SHORT,
  BLOCKER_WORDS,
  DATE_ORDER_WORDS,
  KIND_WORDS,
  MARK_MEANINGS,
  MAX_FILE_BYTES,
  NOTE_WORDS,
  SHAPES,
  SHAPE_WORDS,
  SUMMARY_COLUMNS,
  SUMMARY_WORDS,
  canRead,
  columnLabel,
  columnName,
  countsText,
  daysText,
  emptyLayout,
  isMonth,
  layoutBody,
  layoutFromSaved,
  marksToExplain,
  monthLabel,
  notPaid,
  previousMonth,
  readDaysTyped,
  toBase64,
  usesMarks,
} from './runFormat.js';

// Payroll, Stage B (docs/PAYROLL_BUILD_NOTE.md section 5): Run payroll – a month's attendance file read into the
// salary sheet. The steps on one screen: the month → the file → its columns → the check → the sheet.
// The person says which column holds what, on a preview of the file's first rows; nothing is guessed. The sheet is
// made only when every code in the file and every person on the payroll is answered. No deduction is worked out
// here (stage C) and nothing is locked or printed as a payslip (stage D). Nothing is sent to any AI feature.

const SHAPE_SHORT = { register: 'Register', days: 'Daily list', summary: 'Totals' };

// ---------- A chosen file: its first rows, its columns, the check ----------
function ReadFile({ month, picked, layouts, onRead, onCancel }) {
  const [layout, setLayout] = useState(emptyLayout);
  const [check, setCheck] = useState(null); // the server's answer for the layout as it was when "Check" was pressed
  const [changed, setChanged] = useState(false); // a column changed since that check
  const [saveAs, setSaveAs] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const { preview, content, name } = picked;

  const set = (patch) => {
    setLayout({ ...layout, ...patch });
    setChanged(true);
  };
  // A mark's meaning is not a column: the check still stands, the list of marks to explain gets shorter
  const setMark = (mark, meaning) => setLayout({ ...layout, marks: { ...layout.marks, [mark]: meaning } });
  const fe = (k) => check?.fields?.[k] ?? error?.fields?.[`layout.${k}`];
  const headings = layout.headerRow > 0 ? (preview.rows[layout.headerRow - 1] ?? []) : [];
  const columns = Array.from({ length: preview.columns }, (_, i) => i + 1);
  const columnSelect = (id, label, value, onChange, { optional = false, error: err, hint } = {}) => (
    <Field label={optional ? `${label} (optional)` : label} id={id} error={err} hint={hint} keepHint>
      <select id={id} value={value || 0} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={0}>{optional ? 'None' : 'Choose…'}</option>
        {columns.map((n) => (
          <option key={n} value={n}>
            {columnLabel(n, headings[n - 1])}
          </option>
        ))}
      </select>
    </Field>
  );
  const send = async (path) => api(`/payroll/runs/${month}/${path}`, { method: 'POST', body: { fileName: name, content, layout: layoutBody(layout), saveLayoutAs: path === 'files' ? saveAs.trim() : '' } });
  const runCheck = async () => {
    setBusy('check');
    setError(null);
    try {
      setCheck((await send('preview')).check);
      setChanged(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
    }
  };
  const read = async () => {
    setBusy('read');
    setError(null);
    try {
      onRead(await send('files'));
    } catch (err) {
      setError(err);
      setBusy('');
    }
  };
  const toExplain = check && !changed ? marksToExplain(layout, check.marks) : [];
  const ready = canRead(layout, check, changed);

  return (
    <div className="pr-read">
      <h3 className="pr-sub">{`${name} – ${preview.totalRows} rows, ${preview.columns} columns`}</h3>
      {preview.file.alreadyRead && <Alert type="warning">This same file was already read for this month. Reading it again is refused – remove the earlier reading first if it was wrong.</Alert>}
      <p className="hint">The first rows of the file, as text. Use them to say which column holds what. Columns are named as in Excel (A, B, C…).</p>
      <div className="an-table-wrap pr-preview" tabIndex={0} role="region" aria-label="The first rows of the file">
        <table>
          <thead>
            <tr>
              <th scope="col">Row</th>
              {columns.map((n) => (
                <th key={n} scope="col">
                  {columnName(n)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, 12).map((r, i) => (
              <tr key={i} className={i + 1 === Number(layout.headerRow) ? 'pr-heading-row' : undefined}>
                <th scope="row">{i + 1}</th>
                {columns.map((n) => (
                  <td key={n}>{r[n - 1] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {layouts.length > 0 && (
        <Field label="Use a saved layout" id="pr-saved" hint="A layout saved in an earlier month fills in the boxes below. Check them against this file.">
          <select
            id="pr-saved"
            value=""
            onChange={(e) => {
              const saved = layouts.find((l) => l.name === e.target.value);
              if (saved) {
                setLayout(layoutFromSaved(saved.layout));
                setSaveAs(saved.name);
                setChanged(true);
              }
            }}
          >
            <option value="">Choose…</option>
            {layouts.map((l) => (
              <option key={l.name} value={l.name}>
                {`${l.name} – ${SHAPE_SHORT[l.layout.shape] ?? l.layout.shape}`}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="form-grid">
        <Field label="This file is" id="pr-shape" error={fe('shape')}>
          <select id="pr-shape" value={layout.shape} onChange={(e) => set({ shape: e.target.value })}>
            {SHAPES.map((k) => (
              <option key={k} value={k}>
                {SHAPE_WORDS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="The headings are on row" id="pr-header" error={fe('headerRow')} hint="The rows above it (a title) are not read. 0 when the file has no headings.">
          <input id="pr-header" type="number" min={0} max={50} value={layout.headerRow} onChange={(e) => set({ headerRow: e.target.value === '' ? '' : Number(e.target.value) })} />
        </Field>
        {columnSelect('pr-code', 'Code column', layout.codeColumn, (n) => set({ codeColumn: n }), { error: fe('codeColumn'), hint: 'The code each person has in the machine or the sheet. Rows are matched to staff by it – never by name.' })}
        {columnSelect('pr-name', 'Name column', layout.nameColumn, (n) => set({ nameColumn: n }), { optional: true, error: fe('nameColumn') })}
        {layout.shape === 'register' && columnSelect('pr-day1', 'Column of day 1', layout.firstDayColumn, (n) => set({ firstDayColumn: n }), { error: fe('firstDayColumn'), hint: 'Day 2 is the next column, and so on to the last day of the month.' })}
        {layout.shape === 'days' && (
          <>
            {columnSelect('pr-date', 'Date column', layout.dateColumn, (n) => set({ dateColumn: n }), { error: fe('dateColumn') })}
            <Field label="Dates are written" id="pr-order">
              <select id="pr-order" value={layout.dateOrder} onChange={(e) => set({ dateOrder: e.target.value })}>
                {Object.entries(DATE_ORDER_WORDS).map(([k, w]) => (
                  <option key={k} value={k}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
            {columnSelect('pr-status', 'Status column', layout.statusColumn, (n) => set({ statusColumn: n }), { optional: true, error: fe('statusColumn'), hint: 'A mark for the day (P, A, half day…). Without it, a row for a day counts as a day present.' })}
          </>
        )}
        {layout.shape === 'summary' &&
          SUMMARY_COLUMNS.map((k) => columnSelect(`pr-col-${k}`, SUMMARY_WORDS[k], layout.columns[k], (n) => set({ columns: { ...layout.columns, [k]: n } }), { optional: true, error: k === 'present' ? fe('columns') : undefined }))}
      </div>

      <Alert type="error">{error?.message}</Alert>
      {(error?.details?.problems ?? []).length > 1 && (
        <ul className="pr-problems">
          {error.details.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {check && !changed && (
        <div className="pr-check">
          {check.problems.length > 0 && (
            <Alert type="error">
              <strong>This file can’t be read as it is.</strong>
              <ul className="pr-problems">
                {check.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          )}
          {usesMarks(layout) && check.marks.length > 0 && (
            <>
              <h3 className="pr-sub">What each mark in the file means</h3>
              <p className="hint">Every mark found in the day boxes needs a meaning before the file is read. “Not counted” is for a box that says nothing about the day.</p>
              <FieldError role="alert">{error?.fields?.['layout.marks']}</FieldError>
              <div className="an-table-wrap">
                <table className="ca-table pr-marks">
                  <thead>
                    <tr>
                      <th scope="col">Mark</th>
                      <th scope="col" className="num">
                        Times
                      </th>
                      <th scope="col">Means</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.marks.map((m) => (
                      <tr key={m.mark}>
                        <th scope="row">{m.mark}</th>
                        <td className="num" data-label="Times">
                          {m.count}
                        </td>
                        <td data-label="Means">
                          <select aria-label={`What ${m.mark} means`} value={layout.marks[m.mark] ?? ''} onChange={(e) => setMark(m.mark, e.target.value)}>
                            <option value="">Choose…</option>
                            {MARK_MEANINGS.map((k) => (
                              <option key={k} value={k}>
                                {KIND_WORDS[k]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!check.problems.length && !Object.keys(check.fields).length && (
            <p className="pr-found" aria-live="polite">
              {`Found ${check.people} ${check.people === 1 ? 'person' : 'people'} with a code`}
              {check.unknownCodes ? `, ${check.unknownCodes} of them with a code nobody on the payroll carries yet` : ''}
              {check.skippedRows ? ` · ${check.skippedRows} row${check.skippedRows === 1 ? '' : 's'} without a code not read (titles, totals)` : ''}
              {check.otherMonths ? ` · ${check.otherMonths} row${check.otherMonths === 1 ? '' : 's'} of another month not read` : ''}.
              {/* the first person as counted – only from a check made with every mark explained */}
              {toExplain.length === 0 && !check.unmapped.length && check.sample[0] ? ` First row read: ${check.sample[0].code}${check.sample[0].name ? `, ${check.sample[0].name}` : ''} – ${check.sample[0].paidDaysGiven != null ? `paid days ${daysText(check.sample[0].paidDaysGiven)}` : countsText(check.sample[0].counts)}.` : ''}
              {toExplain.length === 0 && check.unmapped.length > 0 ? ' Every mark has a meaning now: press “Check again” to see the first row counted, or read the file.' : ''}
            </p>
          )}
        </div>
      )}

      <Field label="Save this layout as (optional)" id="pr-save-as" error={error?.fields?.saveLayoutAs} hint="A name such as “Biometric machine”. Next month it is offered again, so the columns need not be chosen twice.">
        <input id="pr-save-as" value={saveAs} maxLength={60} onChange={(e) => setSaveAs(e.target.value)} />
      </Field>
      <div className="row">
        <button type="button" className={ready ? 'btn btn-secondary' : 'btn btn-primary'} disabled={Boolean(busy)} onClick={runCheck}>
          {busy === 'check' ? 'Checking…' : check && !changed ? 'Check again' : 'Check the file'}
        </button>
        <button type="button" className={ready ? 'btn btn-primary' : 'btn btn-secondary'} disabled={!ready || Boolean(busy) || preview.file.alreadyRead} onClick={read}>
          <FileUp aria-hidden="true" /> {busy === 'read' ? 'Reading…' : 'Read this file'}
        </button>
        <button type="button" className="btn btn-link" onClick={onCancel}>
          Cancel
        </button>
        {check && !changed && toExplain.length > 0 && <span className="hint">{`Still to explain: ${toExplain.join(', ')}`}</span>}
      </div>
    </div>
  );
}

// ---------- A person's paid days by hand ----------
function DaysDialog({ month, days, person, correction, fileDays, onDone, onCancel }) {
  const [paid, setPaid] = useState(correction ? daysText(correction.paidDays) : '');
  const [reason, setReason] = useState(correction?.reason ?? '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const url = `/payroll/runs/${month}/corrections/${person.staffId}`;
  const save = async () => {
    const paidDays = readDaysTyped(paid, days);
    if (paidDays == null) {
      setError({ fields: { paidDays: `Write the paid days as a number up to ${days}, like 26 or 25.5` } });
      return;
    }
    setBusy(true);
    try {
      onDone(await api(url, { method: 'PUT', body: { paidDays, reason: reason.trim() } }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      onDone(await api(url, { method: 'DELETE' }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <FormDialog id="pr-days" title={`Paid days of ${person.name}`} submitLabel="Save" busy={busy} onSubmit={save} onCancel={onCancel}>
      <Alert type="error">{error?.message}</Alert>
      <p className="hint">{fileDays != null ? `The file says ${daysText(fileDays)} paid days. What you write here is used for the sum and shown beside the file’s figure – never in its place.` : 'This person has no row in the file. Write the paid days for the month.'}</p>
      <Field label={`Paid days in ${monthLabel(month)}`} id="pr-days-n" error={error?.fields?.paidDays}>
        <input id="pr-days-n" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
      </Field>
      <Field label="Reason" id="pr-days-why" error={error?.fields?.reason} hint="For example: the machine was down on the 21st; from the hand-kept register.">
        <input id="pr-days-why" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {correction && (
        <button type="button" className="btn btn-link" disabled={busy} onClick={remove}>
          Take the hand-written days back
        </button>
      )}
    </FormDialog>
  );
}

// ---------- The screen ----------
export function PayrollRunPage() {
  const [params, setParams] = useSearchParams();
  const list = useFetch('/payroll/runs');
  const asked = params.get('month');
  const month = isMonth(asked) ? asked : list.data ? previousMonth(list.data.currentMonth) : null;
  const fetched = useFetch(month ? `/payroll/runs/${month}` : null);
  const [changed, setChanged] = useState(null); // the month as the last change answered it
  const s = changed?.month === month ? changed : fetched.data;
  const [picked, setPicked] = useState(null); // { name, content, preview }
  const [notice, setNotice] = useState(null);
  const [problem, setProblem] = useState(null);
  const [open, setOpen] = useState(null); // { kind: 'days', person, correction, fileDays } | { kind: 'remove', file } | { kind: 'person', row }
  const [print, setPrint] = useState(null); // payslips to print: { version?, only? }
  const [answers, setAnswers] = useState({}); // code → { staffId, reason } typed so far
  const fileInput = useRef(null);

  const done = (state, text) => {
    setChanged(state);
    setOpen(null);
    setProblem(null);
    if (text !== undefined) setNotice(text);
  };
  const choose = async (file) => {
    setProblem(null);
    setNotice(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setProblem('This file is larger than 1 MB. An attendance file for one month is far smaller – check that the right file was chosen.');
      return;
    }
    try {
      const content = toBase64(new Uint8Array(await file.arrayBuffer()));
      const preview = await api(`/payroll/runs/${month}/preview`, { method: 'POST', body: { fileName: file.name, content } });
      setPicked({ name: file.name, content, preview });
    } catch (err) {
      setProblem(err.message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const answerCode = async (code, body, text) => {
    try {
      done(await api(`/payroll/runs/${month}/codes`, { method: 'POST', body: { code, ...body } }), text);
    } catch (err) {
      setProblem(err.fields?.reason ?? err.fields?.staffId ?? err.message);
    }
  };
  const typed = (code) => answers[code] ?? { staffId: '', reason: '' };
  const type = (code, patch) => setAnswers({ ...answers, [code]: { ...typed(code), ...patch } });

  const files = s?.files ?? [];
  const locked = s?.status === 'locked'; // shown from its kept snapshot; takes no change
  const waitingCodes = (s?.unknownCodes ?? []).filter((c) => !c.leftOut);
  const waitingStaff = (s?.noRow ?? []).filter((p) => !p.answered);
  const title = month ? `Run payroll – ${monthLabel(month)}` : 'Run payroll';
  return (
    <>
      <PageHeader
        tabs={HOSPITAL_PAYROLL.tabs}
        title={title}
        documentTitle={title}
        help="A month’s attendance file is read into the salary sheet; deductions and advances give the take-home; the month is then locked, and payslips and the monthly lists are made from it."
        badges={
          s &&
          (locked ? (
            <StatusPill tone="stable" icon={Lock}>{`Locked – version ${s.locked.version}`}</StatusPill>
          ) : s.draft ? (
            <StatusPill tone="watch" icon={FilePen}>
              DRAFT – not confirmed by the accountant
            </StatusPill>
          ) : (
            <StatusPill tone="stable" icon={CircleCheck}>
              Rules and rates confirmed
            </StatusPill>
          ))
        }
      />
      <div className="pf-content pr-page">
        <Alert type="error">{list.error || fetched.error}</Alert>
        <Alert type="error">{problem}</Alert>
        {notice && (
          <Alert type="success" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}

        <section className="card" aria-labelledby="pr-month-h">
          <h2 id="pr-month-h">1. The month</h2>
          <div className="pr-month">
            <Field label="Month" id="pr-month" hint="Usually the month that has just ended.">
              <input
                id="pr-month"
                type="month"
                value={month ?? ''}
                max={list.data?.currentMonth}
                min="2020-01"
                onChange={(e) => {
                  if (!isMonth(e.target.value)) return;
                  setPicked(null);
                  setNotice(null);
                  setProblem(null);
                  setParams({ month: e.target.value }, { replace: true });
                }}
              />
            </Field>
          </div>
          {s && (
            <p className="pr-rules">
              {s.basisDays ? `A month’s pay is divided by ${s.basisDays} days – ${BASIS_SHORT[s.settings.dayBasis]}.` : 'How one day’s pay is counted is not chosen yet.'}{' '}
              {`Weekly offs are ${s.settings.weeklyOffsPaid ? 'paid' : 'not paid'}; holidays are ${s.settings.holidaysPaid ? 'paid' : 'not paid'}. Rounding: ${ROUNDING_WORDS[s.settings.rounding].toLowerCase()}.`} <Link to="/payroll/settings">Payroll settings</Link>
            </p>
          )}
          {s?.rulesDraft && (
            <Alert type="warning">
              <strong>DRAFT.</strong> These rules are not confirmed by the hospital’s accountant yet. A sheet made with them is for checking against the present method – not for payment.
            </Alert>
          )}
        </section>

        {s && (
          <section className="card" aria-labelledby="pr-files-h">
            <h2 id="pr-files-h">2. The attendance file</h2>
            <p className="hint">A CSV file from the attendance machine or the sheet (in Excel: File → Save As → “CSV (Comma delimited)”). At most 1 MB. Two sources may be read as two files – a person in one of them only.</p>
            {files.length > 0 && (
              <SimpleTable
                rows={files}
                columns={[
                  { key: 'name', header: 'File', main: true, wide: true, render: (f) => f.fileName || 'File' },
                  { key: 'shape', header: 'Kind', render: (f) => SHAPE_SHORT[f.shape] ?? f.shape },
                  { key: 'people', header: 'People', num: true, render: (f) => f.people },
                  { key: 'read', header: 'Read', render: (f) => `${f.readByName}, ${formatDateTime(f.readAt)}` },
                  {
                    key: 'state',
                    header: '',
                    render: (f) =>
                      f.removed ? (
                        <StatusPill tone="inactive" icon={Trash2} title={f.removed.reason}>{`Removed by ${f.removed.byName}`}</StatusPill>
                      ) : locked ? null : (
                        <button type="button" className="btn btn-link btn-sm" onClick={() => setOpen({ kind: 'remove', file: f })}>
                          Remove
                        </button>
                      ),
                  },
                ]}
              />
            )}
            {locked && <p className="hint">This month is locked: no file is read or removed until the hospital admin reopens it.</p>}
            {!picked && !locked && (
              <div className="row pr-choose">
                <input ref={fileInput} id="pr-file" type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
                <label htmlFor="pr-file" className={files.some((f) => !f.removed) ? 'btn btn-secondary' : 'btn btn-primary'}>
                  <FileUp aria-hidden="true" /> {files.some((f) => !f.removed) ? 'Read another file' : 'Choose the file'}
                </label>
              </div>
            )}
            {picked && !locked && (
              <ReadFile
                key={`${picked.name}-${picked.preview.file.sha256}`}
                month={month}
                picked={picked}
                layouts={picked.preview.layouts ?? s.layouts}
                onCancel={() => setPicked(null)}
                onRead={(state) => {
                  setPicked(null);
                  done(state, 'The file was read.');
                }}
              />
            )}
          </section>
        )}

        {s && (s.unknownCodes.length > 0 || s.notThisMonth.length > 0 || s.noRow.length > 0 || s.twoRows.length > 0) && (
          <section className="card" aria-labelledby="pr-match-h">
            <h2 id="pr-match-h">3. People and codes to answer</h2>
            {s.unknownCodes.length > 0 && (
              <>
                <h3 className="pr-sub">Codes in the file that nobody on the payroll carries</h3>
                <p className="hint">Tie the code to the staff member it belongs to – it is kept for the months to come – or leave its row out of this month with a reason.</p>
                <SimpleTable
                  rowKey="code"
                  rows={s.unknownCodes}
                  columns={[
                    { key: 'code', header: 'Code', main: true, nowrap: true, render: (c) => c.code },
                    { key: 'name', header: 'Name in the file', render: (c) => c.name || '—' },
                    { key: 'where', header: 'Row', render: (c) => `${c.row}${c.fileName ? `, ${c.fileName}` : ''}` },
                    {
                      key: 'answer',
                      header: 'Answer',
                      wide: true,
                      render: (c) =>
                        c.leftOut ? (
                          <span className="row">
                            <StatusPill tone="inactive" icon={Trash2}>{`Left out: ${c.leftOut.reason}`}</StatusPill>
                            <button type="button" className="btn btn-link btn-sm" onClick={() => answerCode(c.code, { undo: true }, null)}>
                              Take back
                            </button>
                          </span>
                        ) : (
                          <span className="pr-answer">
                            <select aria-label={`Staff member for code ${c.code}`} value={typed(c.code).staffId} onChange={(e) => type(c.code, { staffId: e.target.value })}>
                              <option value="">Staff member…</option>
                              {s.staffChoices.map((p) => (
                                <option key={p.id} value={p.id}>{`${p.name} (${p.staffNumber})`}</option>
                              ))}
                            </select>
                            <button type="button" className="btn btn-secondary btn-sm" disabled={!typed(c.code).staffId} onClick={() => answerCode(c.code, { staffId: typed(c.code).staffId }, `Code ${c.code} is now tied to its staff member.`)}>
                              Tie
                            </button>
                            <input aria-label={`Reason to leave out code ${c.code}`} placeholder="or a reason to leave it out" value={typed(c.code).reason} maxLength={200} onChange={(e) => type(c.code, { reason: e.target.value })} />
                            <button type="button" className="btn btn-secondary btn-sm" disabled={typed(c.code).reason.trim().length < 3} onClick={() => answerCode(c.code, { leaveOut: true, reason: typed(c.code).reason.trim() }, `Code ${c.code} is left out of this month.`)}>
                              Leave out
                            </button>
                          </span>
                        ),
                    },
                  ]}
                />
              </>
            )}
            {s.noRow.length > 0 && (
              <>
                <h3 className="pr-sub">On the payroll, with no row in the file</h3>
                <p className="hint">Write the person’s paid days by hand, with a reason (0 for a month with no pay). If they are in the file under a code, tie that code to them above instead.</p>
                <SimpleTable
                  rowKey="staffId"
                  rows={s.noRow}
                  columns={[
                    { key: 'number', header: 'Staff number', nowrap: true, render: (p) => p.staffNumber },
                    { key: 'name', header: 'Name', main: true, wide: true, render: (p) => p.name },
                    { key: 'designation', header: 'Designation', render: (p) => p.designation || '—' },
                    {
                      key: 'answer',
                      header: 'Answer',
                      render: (p) =>
                        p.answered ? (
                          <StatusPill tone="stable" icon={CircleCheck}>
                            Days written by hand
                          </StatusPill>
                        ) : (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen({ kind: 'days', person: p, correction: null, fileDays: null })}>
                            <PencilLine aria-hidden="true" /> Write the paid days
                          </button>
                        ),
                    },
                  ]}
                />
              </>
            )}
            {s.twoRows.length > 0 && (
              <Alert type="error">
                {s.twoRows.map((p) => `${p.name} (${p.staffNumber}) has two rows in the files, under the codes ${p.codes.join(' and ')}.`).join(' ')} Remove one of the files, or take one of the codes off the person (Payroll → Staff).
              </Alert>
            )}
            {s.notThisMonth.length > 0 && (
              <p className="hint">
                {`Not read into this month: ${s.notThisMonth.map((p) => `${p.name} (${p.staffNumber}, code ${p.code}) – ${p.why === 'off' ? 'off the payroll' : 'not employed in this month'}`).join('; ')}.`}
              </p>
            )}
          </section>
        )}

        {s && (
          <section className="card" aria-labelledby="pr-sheet-h">
            <h2 id="pr-sheet-h">{`4. The salary sheet – ${monthLabel(month)}`}</h2>
            {!s.sheet && (
              <>
                <p className="hint">The sheet is made when nothing is left to answer:</p>
                <ul className="pr-problems">
                  {s.blockers.map((b) => (
                    <li key={b}>
                      {BLOCKER_WORDS[b] ?? b}
                      {b === 'codes' ? ` (${waitingCodes.length} to answer)` : b === 'noRow' ? ` (${waitingStaff.length} to answer${files.some((f) => !f.removed) ? '' : ' – or read the attendance file first'})` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {s.sheet && (
              <>
                <div className="kpi-grid">
                  <KpiCard icon={Users} label="People" value={s.sheet.people} sub={`of ${s.expected} on the payroll this month`} />
                  <KpiCard icon={Banknote} label="Pay for the month" value={rupees(s.sheet.payPaise)} textValue sub="Before deductions" />
                  <KpiCard tone={s.sheet.withoutPay ? 'watch' : 'stable'} label="Without a sum" value={s.sheet.withoutPay} sub={s.sheet.withoutPay ? 'Pay not entered – Payroll → Staff' : 'Everyone has a sum'} />
                </div>
                {s.rulesDraft && (
                  <p className="pr-draft">
                    <StatusPill tone="watch" icon={TriangleAlert}>
                      DRAFT – not for payment
                    </StatusPill>{' '}
                    Compare this sheet with the present method. Deductions and the take-home are in part 5.
                  </p>
                )}
                <div className="pr-fit">
                  <SimpleTable
                    rowKey="staffId"
                    rows={s.sheet.rows}
                    columns={[
                      { key: 'number', header: 'Staff no.', nowrap: true, render: (r) => r.staffNumber },
                      { key: 'name', header: 'Name', main: true, wide: true, render: (r) => r.name },
                      { key: 'present', header: 'Present', num: true, render: (r) => daysText(r.counts?.present) },
                      { key: 'half', header: 'Half days', num: true, render: (r) => daysText(r.counts?.half) },
                      { key: 'off', header: 'Weekly offs', num: true, render: (r) => daysText(r.counts?.weeklyOff) },
                      { key: 'holiday', header: 'Holidays', num: true, render: (r) => daysText(r.counts?.holiday) },
                      { key: 'leave', header: 'Paid leave', num: true, render: (r) => daysText(r.counts?.paidLeave) },
                      { key: 'not', header: 'Not paid', num: true, render: (r) => daysText(notPaid(r.counts)) },
                      { key: 'file', header: 'Paid days, file', num: true, render: (r) => daysText(r.fileDays) },
                      {
                        key: 'hand',
                        header: 'By hand',
                        num: true,
                        render: (r) => (
                          <span className="pr-hand" title={r.correction ? `${r.correction.reason} – ${r.correction.byName}` : undefined}>
                            {r.correction ? daysText(r.correction.paidDays) : ''}
                            {!locked && (
                              <button type="button" className="icon-btn" aria-label={`Write the paid days of ${r.name} by hand`} title="Write the paid days by hand" onClick={() => setOpen({ kind: 'days', person: r, correction: r.correction, fileDays: r.fileDays })}>
                                <PencilLine aria-hidden="true" />
                              </button>
                            )}
                          </span>
                        ),
                      },
                      { key: 'paid', header: 'Paid days', num: true, render: (r) => <strong>{daysText(r.paidDays)}</strong> },
                      { key: 'monthly', header: 'Monthly pay', num: true, nowrap: true, render: (r) => (r.monthlyPaise == null ? '—' : rupees(r.monthlyPaise)) },
                      { key: 'pay', header: 'Pay for the month', num: true, nowrap: true, render: (r) => (r.payPaise == null ? '—' : <strong>{rupees(r.payPaise)}</strong>) },
                      { key: 'notes', header: 'Notes', render: (r) => [...r.notes.map((n) => NOTE_WORDS[n] ?? n), r.correction ? `By hand: ${r.correction.reason}` : ''].filter(Boolean).join('; ') || '—' },
                    ]}
                  />
                </div>
                <p className="hint">{`Pay for the month = monthly pay × paid days ÷ ${s.basisDays}, rounded: ${ROUNDING_WORDS[s.settings.rounding].toLowerCase()}. Days before joining and after the last working day are not counted. ${locked ? 'This month is locked: the sheet is shown as it was kept.' : 'Until the month is locked the sheet is worked out again each time it is opened.'}`}</p>
              </>
            )}
          </section>
        )}
        {/* (the checks on totals and lockBlockers: a server not yet restarted with stages C and D sends neither) */}
        {s?.sheet?.totals && <PaySection state={s} month={month} onOpenPerson={(row) => setOpen({ kind: 'person', row })} onPrintOne={(row) => setPrint({ only: row.staffId })} />}
        {s?.lockBlockers && <LockSection state={s} month={month} onChanged={done} onPrint={setPrint} />}
        {!s && !fetched.error && !list.error && <p className="muted">Loading…</p>}
      </div>

      {open?.kind === 'days' && <DaysDialog month={month} days={s.days} person={open.person} correction={open.correction} fileDays={open.fileDays} onCancel={() => setOpen(null)} onDone={(state) => done(state, 'Saved.')} />}
      {open?.kind === 'person' && <PersonMonthDialog month={month} row={open.row} onCancel={() => setOpen(null)} onDone={(state) => done(state, 'Saved.')} />}
      {print && <PayslipsPrint month={month} version={print.version} only={print.only} onClose={() => setPrint(null)} />}
      {open?.kind === 'remove' && <RemoveDialog month={month} file={open.file} onCancel={() => setOpen(null)} onDone={(state) => done(state, 'The file was removed. Its rows are no longer in this month.')} />}
    </>
  );
}

function RemoveDialog({ month, file, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      onDone(await api(`/payroll/runs/${month}/files/${file.id}/remove`, { method: 'POST', body: { reason: reason.trim() } }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <FormDialog id="pr-remove" title={`Remove ${file.fileName || 'this file'}`} submitLabel="Remove the file" busy={busy} onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.fields?.reason ? null : error?.message}</Alert>
      <p className="hint">{`Its ${file.people} people leave this month’s sheet. The file itself stays on record, marked as removed. Days written by hand stay.`}</p>
      <Field label="Reason" id="pr-remove-why" error={error?.fields?.reason}>
        <input id="pr-remove-why" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}
