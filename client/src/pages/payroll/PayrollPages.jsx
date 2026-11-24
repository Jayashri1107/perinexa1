import { useEffect, useState } from 'react';
import { Banknote, CircleCheck, DoorOpen, Eye, EyeOff, FilePen, Plus, Save, Trash2, TriangleAlert, UserX, Users } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { SearchInput } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, FieldError, KpiCard, StatusPill, formatDate, formatDateTime, roleLabel } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { HOSPITAL_PAYROLL } from '../../platform/modules.js';
import { rupees } from '../billing/billingFormat.js';
import { ShowChoice, SimpleTable } from '../quality/SimpleTable.jsx';
import { SLAB_WORDS } from './payFormat.js';
import { DAY_BASIS_WORDS, NUMBER_FIELDS, NUMBER_HINTS, NUMBER_LABELS, ROUNDING_WORDS, SHOW_OPTIONS, emptyForm, formFrom, maskedNumber, partsTotal, payAction, searchStaff, settingsBody, staffBody, staffStatus } from './payrollFormat.js';

// Payroll, Stage A (owner's choice of 23 Nov 2026 – docs/PAYROLL_BUILD_NOTE.md): the staff list with pay, one
// person's page, and the payroll settings. For the accounts login and the hospital admin only. Desk screens.
// The PF number, ESI number, PAN and bank account are shown as their last four characters; "Show" reads one in full
// (written in the audit log) and hides it again after a minute. Nothing here is sent to any AI feature.

const STATUS_LOOK = {
  working: { tone: 'stable', icon: CircleCheck, word: 'Working' },
  left: { tone: 'inactive', icon: DoorOpen, word: 'Left' },
  off: { tone: 'inactive', icon: UserX, word: 'Off the payroll' },
};

// The pay rules are legal content: DRAFT until the hospital's accountant has confirmed them (name and date).
function DraftNote({ settingsLink = true }) {
  return (
    <Alert type="warning">
      <strong>DRAFT.</strong> How one day’s pay is counted, and which salary parts count for PF and ESI, are not confirmed by the hospital’s accountant yet. Nothing is worked out from them until they are.
      {settingsLink && (
        <>
          {' '}
          <Link to="/payroll/settings">Open the payroll settings</Link>
        </>
      )}
    </Alert>
  );
}

// ---------- The staff list ----------
export function PayrollStaffPage() {
  const [show, setShow] = useState('working');
  const [search, setSearch] = useState('');
  const { data, error, loading } = useFetch('/payroll/staff', { show });
  const rows = searchStaff(data?.staff ?? [], search);
  return (
    <>
      <PageHeader
        tabs={HOSPITAL_PAYROLL.tabs}
        title="Payroll staff"
        documentTitle="Payroll staff"
        help="Everyone the hospital pays a monthly salary, with or without a Perinexa login. Only the accounts login and the hospital admin see this."
        actions={
          <Link className="btn btn-primary" to="/payroll/staff/new">
            <Plus aria-hidden="true" /> Add a staff member
          </Link>
        }
      />
      <div className="pf-content pr-page">
        <Alert type="error">{error}</Alert>
        {data?.rulesDraft && <DraftNote />}
        {data && (
          <div className="kpi-grid">
            <KpiCard icon={Users} label="Working staff" value={data.counts.working} sub={data.counts.left ? `${data.counts.left} left or off the payroll` : 'Nobody has left'} />
            <KpiCard icon={Banknote} label="Monthly pay" value={rupees(data.monthlyPaise)} textValue sub="Before deductions, working staff" />
            <KpiCard tone={data.withoutPay ? 'watch' : 'stable'} label="Pay not entered" value={data.withoutPay} sub={data.withoutPay ? 'Open each person to enter it' : 'Everyone working has pay'} />
          </div>
        )}
        <section className="card">
          <div className="row-between pr-toolbar">
            <ShowChoice options={SHOW_OPTIONS} value={show} onChange={setShow} />
            <SearchInput value={search} onChange={setSearch} placeholder="Name, staff number, designation…" label="Search the staff list" />
          </div>
          <SimpleTable
            loading={loading && !data}
            rows={rows}
            emptyText={search ? 'Nobody matches these words.' : show === 'working' ? 'Nobody on the payroll yet. Add the first staff member.' : 'Nobody here.'}
            columns={[
              { key: 'number', header: 'Staff number', nowrap: true, render: (s) => s.staffNumber },
              { key: 'name', header: 'Name', main: true, wide: true, render: (s) => <Link to={`/payroll/staff/${s.id}`}>{s.name}</Link> },
              { key: 'work', header: 'Designation', render: (s) => [s.designation, s.department].filter(Boolean).join(' · ') || '—' },
              { key: 'pay', header: 'Monthly pay', num: true, nowrap: true, render: (s) => (s.monthlyPaise == null ? <span className="muted">Not entered</span> : rupees(s.monthlyPaise)) },
              { key: 'from', header: 'Pay from', nowrap: true, render: (s) => (s.payFrom ? formatDate(s.payFrom) : '—') },
              { key: 'login', header: 'Login', render: (s) => (s.hasLogin ? 'Yes' : '—') },
              {
                key: 'status',
                header: 'Status',
                render: (s) => {
                  const look = STATUS_LOOK[staffStatus(s)];
                  return (
                    <StatusPill tone={look.tone} icon={look.icon}>
                      {look.word}
                      {staffStatus(s) === 'left' && s.leftOn ? ` ${formatDate(s.leftOn)}` : ''}
                    </StatusPill>
                  );
                },
              },
            ]}
          />
        </section>
      </div>
    </>
  );
}

// ---------- One of the four numbers ----------
function NumberRow({ staffId, field, kept, canKeep, value, clear, error, onType, onClear }) {
  const [shown, setShown] = useState(null); // the number in full, while it is shown
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  // Shown for a minute, then hidden again (a screen left open does not keep it)
  useEffect(() => {
    if (shown == null) return undefined;
    const t = setTimeout(() => setShown(null), 60000);
    return () => clearTimeout(t);
  }, [shown]);
  const show = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setShown((await api(`/payroll/staff/${staffId}/number`, { method: 'POST', body: { field } })).value);
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };
  const id = `pr-${field}`;
  return (
    <div className="pr-number">
      <Field label={NUMBER_LABELS[field]} id={id} error={error} hint={kept?.kept ? `Type a number only to replace the one kept. ${NUMBER_HINTS[field]}.` : `${NUMBER_HINTS[field]}.`} keepHint>
        <input id={id} value={value} maxLength={40} autoComplete="off" spellCheck={false} disabled={!canKeep || clear} onChange={(e) => onType(e.target.value)} />
      </Field>
      {kept?.kept && (
        <p className="pr-kept">
          <span>
            Kept: <strong className="pr-digits">{shown ?? maskedNumber(kept)}</strong>
          </span>
          {shown == null ? (
            <button type="button" className="btn btn-link btn-sm" disabled={busy} onClick={show}>
              <Eye aria-hidden="true" /> {busy ? 'Reading…' : 'Show in full'}
            </button>
          ) : (
            <button type="button" className="btn btn-link btn-sm" onClick={() => setShown(null)}>
              <EyeOff aria-hidden="true" /> Hide
            </button>
          )}
          <label className="check pr-remove">
            <input type="checkbox" checked={clear} onChange={(e) => onClear(e.target.checked)} /> Remove it
          </label>
        </p>
      )}
      <FieldError role="alert">{problem}</FieldError>
    </div>
  );
}

const PAY_NOTES = {
  first: 'This becomes the person’s first pay entry.',
  correct: 'The first day is the same as the pay already entered: saving corrects that entry.',
  add: 'A later first day: saving adds a new pay entry. The earlier one is kept for the months before it.',
  early: 'This day is before the pay already entered. Choose the same day to correct it, or a later day for a rise.',
};

// ---------- One person: add or change ----------
export function PayrollStaffFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const lists = useFetch('/payroll/staff/form');
  const person = useFetch(id ? `/payroll/staff/${id}` : null);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null); // the person as last sent by the server (after a save)
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  // Another person opened (or the new person just added): start from what the server has
  useEffect(() => {
    setForm(null);
    setSaved(null);
    setError(null);
  }, [id]);

  const staff = saved ?? person.data?.staff ?? null;
  const parts = lists.data?.parts ?? [];
  const latest = staff?.pay?.[0] ?? null;
  const v = form ?? (id ? (staff ? formFrom(staff) : null) : lists.data ? emptyForm(lists.data.suggestedNumber) : null);
  const set = (patch) => {
    setNotice(null);
    setForm({ ...v, ...patch });
  };
  const text = (k) => (e) => set({ [k]: e.target.value });
  const tick = (k) => (e) => set({ [k]: e.target.checked });
  // The server's sentence for a box – also when it is about one item inside it ("attendanceCodes.0", "pay.parts.1.amountPaise")
  const fe = (k) => error?.fields?.[k] ?? Object.entries(error?.fields ?? {}).find(([name]) => name.startsWith(`${k}.`))?.[1];
  const canKeep = lists.data?.canKeepNumbers !== false;
  const action = v ? payAction(v, parts, latest) : 'none';

  const save = async () => {
    const { body, errors } = staffBody(v, parts, latest);
    if (Object.keys(errors).length) {
      setError({ message: 'Please check the highlighted fields.', fields: errors });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api(id ? `/payroll/staff/${id}` : '/payroll/staff', { method: id ? 'PUT' : 'POST', body });
      if (!id) {
        setForm(null);
        setNotice('Added to the payroll.');
        navigate(`/payroll/staff/${res.staff.id}`, { replace: true });
        return;
      }
      setSaved(res.staff);
      setForm(null);
      setNotice(res.changed?.length ? 'Saved.' : 'Nothing was changed.');
      lists.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const title = id ? (staff ? staff.name : 'Staff member') : 'Add a staff member';
  const look = staff ? STATUS_LOOK[staffStatus(staff)] : null;
  return (
    <>
      <PageHeader
        tabs={HOSPITAL_PAYROLL.tabs}
        breadcrumbs={[{ label: 'Payroll staff', to: '/payroll' }, { label: title }]}
        title={title}
        documentTitle={title}
        badges={
          look && (
            <StatusPill tone={look.tone} icon={look.icon}>
              {look.word}
            </StatusPill>
          )
        }
        help="Pay is kept as dated entries: a rise adds an entry and the earlier pay stays for the months before it."
      />
      <div className="pf-content pr-page">
        <Alert type="error">{lists.error || person.error}</Alert>
        <Alert type="error">{error?.message}</Alert>
        {notice && (
          <Alert type="success" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}
        {!v && !lists.error && !person.error && <p className="muted">Loading…</p>}
        {v && (
          <>
            <section className="card" aria-labelledby="pr-who">
              <h2 id="pr-who">The person</h2>
              <div className="form-grid">
                <Field label="Staff number" id="pr-number" error={fe('staffNumber')} hint="The hospital’s own number for this person. Each one once.">
                  <input id="pr-number" value={v.staffNumber} maxLength={20} onChange={text('staffNumber')} />
                </Field>
                <Field label="Name" id="pr-name" error={fe('name')}>
                  <input id="pr-name" value={v.name} maxLength={120} onChange={text('name')} />
                </Field>
                <Field label="Designation (optional)" id="pr-designation" error={fe('designation')}>
                  <input id="pr-designation" value={v.designation} maxLength={80} onChange={text('designation')} />
                </Field>
                <Field label="Department (optional)" id="pr-department" error={fe('department')}>
                  <input id="pr-department" value={v.department} maxLength={80} onChange={text('department')} />
                </Field>
                <Field label="Joined on (optional)" id="pr-joined" error={fe('joinedOn')}>
                  <input id="pr-joined" type="date" value={v.joinedOn} onChange={text('joinedOn')} />
                </Field>
                <Field label="Last working day (optional)" id="pr-left" error={fe('leftOn')} hint="Fill this in when the person leaves. They move to the “Left” list after this day.">
                  <input id="pr-left" type="date" value={v.leftOn} onChange={text('leftOn')} />
                </Field>
                <Field label="Attendance code (optional)" id="pr-codes" error={fe('attendanceCodes')} hint="The code this person has in the attendance machine or the sheet. More than one: separate them with commas.">
                  <input id="pr-codes" value={v.codes} maxLength={200} onChange={text('codes')} />
                </Field>
                <Field label="Perinexa login (optional)" id="pr-login" error={fe('userId')} hint="Only if this person also signs in to Perinexa. It ties the two records and gives no rights.">
                  <select id="pr-login" value={v.userId} onChange={text('userId')}>
                    <option value="">No login</option>
                    {(lists.data?.logins ?? []).map((l) => (
                      <option key={l.userId} value={l.userId} disabled={Boolean(l.staffId) && l.staffId !== id}>
                        {`${l.name} – ${l.roles.map(roleLabel).join(', ')}${l.staffId && l.staffId !== id ? ' (already tied to a staff member)' : ''}`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={v.isActive} onChange={tick('isActive')} /> On the payroll
              </label>
              <p className="hint">Untick only for a record added by mistake. Nobody is deleted from the staff list.</p>
            </section>

            <section className="card" aria-labelledby="pr-pay">
              <h2 id="pr-pay">Monthly pay</h2>
              <div className="form-grid">
                <Field label="Pay from" id="pr-pay-from" error={fe('pay.from')} hint="The first day this pay counts.">
                  <input id="pr-pay-from" type="date" value={v.payFrom} onChange={text('payFrom')} />
                </Field>
                {parts.map((p) => (
                  <Field key={p.key} label={`${p.name} – ₹ a month`} id={`pr-part-${p.key}`}>
                    <input id={`pr-part-${p.key}`} inputMode="decimal" value={v.parts[p.key] ?? ''} onChange={(e) => set({ parts: { ...v.parts, [p.key]: e.target.value } })} />
                  </Field>
                ))}
                <Field label="TDS – ₹ a month (optional)" id="pr-tds" error={fe('pay.tdsPaise')} hint="Income tax taken from salary: the figure the accountant gives for this person. Perinexa never works it out.">
                  <input id="pr-tds" inputMode="decimal" value={v.tds} onChange={text('tds')} />
                </Field>
              </div>
              <FieldError role="alert">{fe('pay.parts')}</FieldError>
              <p className="pr-total">
                Monthly pay before deductions: <strong>{rupees(partsTotal(v, parts)) || '₹0'}</strong>
              </p>
              <div className="check-grid">
                <label className="check">
                  <input type="checkbox" checked={v.pf} onChange={tick('pf')} /> PF applies
                </label>
                <label className="check">
                  <input type="checkbox" checked={v.esi} onChange={tick('esi')} /> ESI applies
                </label>
                <label className="check">
                  <input type="checkbox" checked={v.pt} onChange={tick('pt')} /> Professional tax applies
                </label>
              </div>
              {(v.pt || v.ptSlab) && (
                <Field label="Professional tax slab" id="pr-pt-slab" error={fe('ptSlab')} hint="The state’s table of professional tax differs for men and women. Which table is this person’s?">
                  <select id="pr-pt-slab" value={v.ptSlab} onChange={text('ptSlab')}>
                    {Object.entries(SLAB_WORDS).map(([k, word]) => (
                      <option key={k} value={k}>
                        {word}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <p className="hint">
                These record who each deduction applies to. The deductions themselves are worked out on Run payroll, with the rates of <Link to="/payroll/rates">Payroll → Rates</Link> – DRAFT until the accountant confirms them.
              </p>
              {PAY_NOTES[action] && <Alert type={action === 'early' ? 'warning' : 'info'}>{PAY_NOTES[action]}</Alert>}
              {staff?.pay?.length > 0 && (
                <>
                  <h3 className="pr-sub">Pay entries</h3>
                  <SimpleTable
                    rowKey="from"
                    rows={staff.pay}
                    columns={[
                      { key: 'from', header: 'From', main: true, nowrap: true, render: (e) => formatDate(e.from) },
                      { key: 'parts', header: 'Parts', render: (e) => e.parts.map((x) => `${parts.find((p) => p.key === x.key)?.name ?? x.key} ${rupees(x.amountPaise)}`).join(' · ') },
                      { key: 'total', header: 'Monthly pay', num: true, nowrap: true, render: (e) => rupees(e.monthlyPaise) },
                      { key: 'applies', header: 'Applies', render: (e) => [e.pf && 'PF', e.esi && 'ESI', e.pt && 'Professional tax'].filter(Boolean).join(', ') || '—' },
                      { key: 'tds', header: 'TDS', num: true, nowrap: true, render: (e) => (e.tdsPaise ? rupees(e.tdsPaise) : '—') },
                      { key: 'by', header: 'Entered', render: (e) => (e.byName ? `${e.byName}${e.at ? `, ${formatDateTime(e.at)}` : ''}` : '—') },
                    ]}
                  />
                </>
              )}
            </section>

            <section className="card" aria-labelledby="pr-numbers">
              <h2 id="pr-numbers">Bank and statutory numbers</h2>
              {!canKeep && (
                <Alert type="warning">These four numbers can’t be kept yet: the key that protects them is not set on this server. Everything else can be saved. For the developer: PAYROLL_KEY in server/.env (docs/RUNBOOK.md).</Alert>
              )}
              <p className="hint">Kept sealed, and shown as the last four characters. Reading a number in full is written in the audit log with your name. Aadhaar is never kept in Perinexa.</p>
              <div className="form-grid">
                <Field label="Bank name (optional)" id="pr-bank" error={fe('bank.bankName')}>
                  <input id="pr-bank" value={v.bankName} maxLength={80} onChange={text('bankName')} />
                </Field>
                <Field label="IFSC (optional)" id="pr-ifsc" error={fe('bank.ifsc')} hint="11 characters, like HDFC0001234.">
                  <input id="pr-ifsc" value={v.ifsc} maxLength={11} autoComplete="off" spellCheck={false} onChange={text('ifsc')} />
                </Field>
              </div>
              <div className="form-grid pr-numbers">
                {NUMBER_FIELDS.map((f) => (
                  <NumberRow
                    key={f}
                    staffId={id}
                    field={f}
                    kept={staff?.numbers?.[f]}
                    canKeep={canKeep}
                    value={v.numbers[f]}
                    clear={v.clear[f]}
                    error={fe(`numbers.${f}`)}
                    onType={(value) => set({ numbers: { ...v.numbers, [f]: value } })}
                    onClear={(on) => set({ clear: { ...v.clear, [f]: on } })}
                  />
                ))}
              </div>
            </section>

            <div className="row pr-actions">
              <button type="button" className="btn btn-primary" disabled={busy || (Boolean(id) && !form)} onClick={save}>
                <Save aria-hidden="true" /> {busy ? 'Saving…' : id ? 'Save changes' : 'Add to the payroll'}
              </button>
              <Link className="btn btn-secondary" to="/payroll">
                Back to the staff list
              </Link>
              {staff?.updatedByName && <span className="hint">{`Last changed by ${staff.updatedByName}, ${formatDateTime(staff.updatedAt)}.`}</span>}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---------- Settings ----------
export function PayrollSettingsPage() {
  const res = useFetch('/payroll/settings');
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const v = form ?? res.data?.settings ?? null;
  const canChange = res.data?.canChange === true;
  const maxParts = res.data?.lists?.maxParts ?? 12;
  const fe = (k) => error?.fields?.[k];
  const change = (patch) => {
    setNotice(null);
    setForm({ ...v, ...patch });
  };
  // A changed rule is DRAFT again: the accountant's name and date are written once they have confirmed the new rule
  const changeRule = (patch) => change({ ...patch, confirmedBy: '', confirmedOn: null });
  const setPart = (i, patch, rule) => (rule ? changeRule : change)({ parts: v.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await api('/payroll/settings', { method: 'PUT', body: settingsBody(v) });
      setForm(null);
      setNotice(answer.changed?.length ? 'Saved.' : 'Nothing was changed.');
      res.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const confirmed = v && v.confirmedBy && v.confirmedOn && v.dayBasis;
  return (
    <>
      <PageHeader
        tabs={HOSPITAL_PAYROLL.tabs}
        title="Payroll settings"
        documentTitle="Payroll settings"
        help="The salary parts the hospital uses and how one day’s pay is counted. The hospital admin changes them; the accounts login reads them."
        badges={
          v &&
          (confirmed ? (
            <StatusPill tone="stable" icon={CircleCheck}>{`Confirmed by ${v.confirmedBy}, ${formatDate(v.confirmedOn)}`}</StatusPill>
          ) : (
            <StatusPill tone="watch" icon={FilePen}>
              DRAFT – not confirmed by the accountant
            </StatusPill>
          ))
        }
      />
      <div className="pf-content pr-page">
        <Alert type="error">{res.error}</Alert>
        <Alert type="error">{error?.message}</Alert>
        {notice && (
          <Alert type="success" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}
        {v && !canChange && <Alert type="info">Only the hospital admin changes these settings. Tell the admin if something here is not right.</Alert>}
        {v && (
          <fieldset className="fieldset" disabled={!canChange}>
            <section className="card" aria-labelledby="pr-parts">
              <h2 id="pr-parts">Salary parts</h2>
              <p className="hint">The parts a monthly salary is made of. Which parts count for PF and for ESI is for the accountant to say. A part that a staff member’s pay already uses can be renamed, not removed.</p>
              <FieldError role="alert">{fe('parts')}</FieldError>
              <div className="an-table-wrap">
                <table className="ca-table pr-parts">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Counts for PF</th>
                      <th scope="col">Counts for ESI</th>
                      <th scope="col">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.parts.map((p, i) => (
                      <tr key={p.key || `new-${i}`}>
                        <td data-label="Name">
                          <input aria-label={`Name of salary part ${i + 1}`} value={p.name} maxLength={40} aria-invalid={fe(`parts.${i}.name`) ? true : undefined} onChange={(e) => setPart(i, { name: e.target.value })} />
                          <FieldError>{fe(`parts.${i}.name`)}</FieldError>
                        </td>
                        <td data-label="Counts for PF">
                          <input type="checkbox" aria-label={`${p.name || 'This part'} counts for PF`} checked={Boolean(p.countsForPf)} onChange={(e) => setPart(i, { countsForPf: e.target.checked }, true)} />
                        </td>
                        <td data-label="Counts for ESI">
                          <input type="checkbox" aria-label={`${p.name || 'This part'} counts for ESI`} checked={Boolean(p.countsForEsi)} onChange={(e) => setPart(i, { countsForEsi: e.target.checked }, true)} />
                        </td>
                        <td>
                          {canChange && v.parts.length > 1 && (
                            <button type="button" className="icon-btn" aria-label={`Remove ${p.name || 'this part'}`} title="Remove" onClick={() => changeRule({ parts: v.parts.filter((_, j) => j !== i) })}>
                              <Trash2 aria-hidden="true" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canChange && v.parts.length < maxParts && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => change({ parts: [...v.parts, { key: '', name: '', countsForPf: false, countsForEsi: false }] })}>
                  <Plus aria-hidden="true" /> Add a salary part
                </button>
              )}
            </section>

            <section className="card narrow" aria-labelledby="pr-day">
              <h2 id="pr-day">One day’s pay</h2>
              <p className="hint">Used on Run payroll, when a month’s attendance is turned into pay.</p>
              <Field label="A month’s pay is divided by" id="pr-basis" error={fe('dayBasis')}>
                <select id="pr-basis" value={v.dayBasis} onChange={(e) => changeRule({ dayBasis: e.target.value })}>
                  {['', ...(res.data?.lists?.dayBases ?? [])].map((k) => (
                    <option key={k} value={k}>
                      {DAY_BASIS_WORDS[k] ?? k}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="check">
                <input type="checkbox" checked={v.weeklyOffsPaid} onChange={(e) => changeRule({ weeklyOffsPaid: e.target.checked })} /> Weekly offs are paid days
              </label>
              <label className="check">
                <input type="checkbox" checked={v.holidaysPaid} onChange={(e) => changeRule({ holidaysPaid: e.target.checked })} /> Holidays are paid days
              </label>
              <Field label="Rounding of a month’s pay" id="pr-rounding" error={fe('rounding')}>
                <select id="pr-rounding" value={v.rounding} onChange={(e) => changeRule({ rounding: e.target.value })}>
                  {(res.data?.lists?.roundings ?? []).map((k) => (
                    <option key={k} value={k}>
                      {ROUNDING_WORDS[k] ?? k}
                    </option>
                  ))}
                </select>
              </Field>
            </section>

            <section className="card narrow" aria-labelledby="pr-confirm">
              <h2 id="pr-confirm">The accountant’s confirmation</h2>
              <p className="hint">These rules are legal content. Write the name of the accountant who confirmed them and the date; until then they are marked DRAFT. Changing a rule empties these two boxes.</p>
              <div className="form-grid">
                <Field label="Accountant’s name" id="pr-by" error={fe('confirmedBy')}>
                  <input id="pr-by" value={v.confirmedBy} maxLength={120} onChange={(e) => change({ confirmedBy: e.target.value })} />
                </Field>
                <Field label="Confirmed on" id="pr-on" error={fe('confirmedOn')}>
                  <input id="pr-on" type="date" value={v.confirmedOn ?? ''} onChange={(e) => change({ confirmedOn: e.target.value || null })} />
                </Field>
              </div>
              {v.updatedByName && <p className="hint">{`Last changed by ${v.updatedByName}, ${formatDateTime(v.updatedAt)}.`}</p>}
              {canChange && (
                <button type="button" className="btn btn-primary" disabled={!form || busy} onClick={save}>
                  <Save aria-hidden="true" /> {busy ? 'Saving…' : 'Save'}
                </button>
              )}
            </section>
          </fieldset>
        )}
        {v && (
          <fieldset className="fieldset" disabled={!canChange}>
            <section className="card narrow" aria-labelledby="pr-full">
              <h2 id="pr-full">Files with numbers in full</h2>
              <p className="hint">Everywhere in Perinexa the PF number, ESI number and bank account show their last four characters. These two switches let files leave Perinexa with the numbers in full. Leave them off unless the hospital’s owner has said yes. Each such file is written in the audit log.</p>
              <label className="check">
                <input type="checkbox" checked={v.bankList === true} onChange={(e) => change({ bankList: e.target.checked })} /> Bank payment list – names, bank, IFSC, full account numbers and take-home
              </label>
              <label className="check">
                <input type="checkbox" checked={v.fullNumbers === true} onChange={(e) => change({ fullNumbers: e.target.checked })} /> Full PF numbers (UAN) and ESI numbers in the PF and ESI lists
              </label>
              {canChange && (
                <button type="button" className="btn btn-primary" disabled={!form || busy} onClick={save}>
                  <Save aria-hidden="true" /> {busy ? 'Saving…' : 'Save'}
                </button>
              )}
            </section>
          </fieldset>
        )}
        {res.data && (
          <section className="card narrow" aria-labelledby="pr-key">
            <h2 id="pr-key">Protection of the four numbers</h2>
            {res.data.canKeepNumbers ? (
              <p>
                <StatusPill tone="stable" icon={CircleCheck}>
                  Key set
                </StatusPill>{' '}
                PF numbers, ESI numbers, PANs and bank accounts are kept sealed on this server.
              </p>
            ) : (
              <p>
                <StatusPill tone="watch" icon={TriangleAlert}>
                  Key not set
                </StatusPill>{' '}
                These four numbers can’t be kept until the key is set on this server. For the developer: PAYROLL_KEY in server/.env (docs/RUNBOOK.md).
              </p>
            )}
            <p className="hint">
              The rates of PF, ESI and professional tax are on <Link to="/payroll/rates">Payroll → Rates</Link>.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
