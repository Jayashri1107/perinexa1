import { useEffect, useId, useState } from 'react';
import { Check, Download, FileCode2, Plus, RotateCcw, Save, SkipForward, TriangleAlert, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, apiFile } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { downloadFile } from '../../components/print/pdfExport.js';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { billingTabs, rupees } from './billingFormat.js';
import { useSend } from './billingUi.jsx';

// Billing → Accounts (docs/TALLY_PLAN.md, hospital admin only): the Tally link, step 1 – the file. The admin keeps the
// accountant's account names, prepares a batch up to a day (what it holds, what stops it), downloads its two files
// (the entries, and the new account names), confirms what Tally imported, records what Tally refused, and reads a
// monthly control sheet to compare with Tally. Nothing connects to Tally; the files hold document numbers, never names.

export const STATUS_LOOK = {
  exported: { tone: 'due', label: 'Waiting for Tally' },
  imported: { tone: 'stable', label: 'Imported' },
  failed: { tone: 'high', label: 'Refused by Tally' },
  skipped: { tone: 'inactive', label: 'Skipped' },
};
export const KIND_WORDS = { sales: 'Sales', receipt: 'Receipt', payment: 'Payment', credit_note: 'Credit note', debit_note: 'Debit note', journal: 'Journal' };
// The statuses inside a sentence ("7 waiting for Tally, 2 imported")
const STATUS_WORDS = { exported: 'waiting for Tally', imported: 'imported', failed: 'refused by Tally', skipped: 'skipped' };

export const tallySubtabs = [
  { label: 'Batches', to: '/billing/accounts', end: true },
  { label: 'Account names', to: '/billing/accounts/settings', end: true },
  { label: 'Exceptions', to: '/billing/accounts/exceptions', end: true },
  { label: 'Control sheet', to: '/billing/accounts/control', end: true },
];

function AccountsHeader({ title, crumb, actions, subtitle }) {
  const { activeMembership } = useAuth();
  return <PageHeader breadcrumbs={[{ label: 'Billing', to: '/billing' }, { label: 'Accounts', to: '/billing/accounts' }, ...(crumb ? [{ label: crumb }] : [])]} title={title} subtitle={subtitle} tabs={billingTabs(activeMembership.roles)} subtabs={tallySubtabs} actions={actions} />;
}

export function TallyStatus({ status }) {
  const look = STATUS_LOOK[status] ?? { tone: 'neutral', label: status };
  return <StatusPill tone={look.tone}>{look.label}</StatusPill>;
}

/** Downloads one of a batch's files (the browser's download). */
async function downloadBatchFile(batchId, part) {
  const { blob, name } = await apiFile(`/tally/batches/${batchId}/file`, { query: { part } });
  downloadFile(blob, name);
}

const kindsText = (byKind) =>
  Object.entries(byKind ?? {})
    .map(([k, n]) => `${n} ${KIND_WORDS[k] ?? k}`)
    .join(', ');

// ---------- Batches: prepare one, and the list ----------

export function TallyBatchesPage() {
  const navigate = useNavigate();
  const list = useFetch('/tally/batches');
  const [to, setTo] = useState('');
  const pv = useFetch('/tally/preview', to ? { to } : undefined);
  const p = pv.data;
  useEffect(() => {
    if (!to && p?.to) setTo(p.to);
  }, [p, to]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const { batch } = await api('/tally/batches', { method: 'POST', body: { to } });
      navigate(`/billing/accounts/batches/${batch.id}`, { state: { flash: `Batch ${batch.number} made with ${batch.vouchers} entries. Download its files below and give them to the accountant.` } });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const blockers = p?.problems?.blockers ?? [];
  const warnings = p?.problems?.warnings ?? [];
  const total = (p?.entries ?? 0) + (p?.resend ?? 0);
  const s = list.data?.statuses ?? {};
  return (
    <>
      <AccountsHeader title="Accounts" subtitle="Entries for the accountant’s Tally, as files to import. Nothing connects to Tally; the files carry document numbers and amounts, never a patient’s name." />
      <div className="pf-content bill-page">
        {list.error && <Alert type="error">{list.error}</Alert>}
        <Alert type="error">{error || pv.error}</Alert>
        <section className="card bill-section" aria-labelledby="tally-prepare">
          <h2 id="tally-prepare">Prepare a batch</h2>
          <p className="hint">A batch holds every bill, receipt, pharmacy invoice, credit note and debit note up to the day you choose that has not been sent yet, and a reversing entry for anything that changed after it was sent. Choose yesterday or earlier: a day’s bills can still change until it is over.</p>
          <div className="form-grid">
            <Field label="Up to" id="tally-to" hint={p?.from ? `From ${formatDate(p.from)}${p.lastBatch ? ` (batch ${p.lastBatch.number} covered up to ${formatDate(p.lastBatch.to)})` : ' (the day the books start)'}` : undefined} keepHint>
              <input id="tally-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          {blockers.length > 0 && (
            <Alert type="error" icon={TriangleAlert}>
              <p>Before a batch can be made:</p>
              <ul>
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          )}
          {warnings.length > 0 && (
            <Alert type="warning">
              <ul>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          {p && !blockers.length && (
            <p>
              <strong>{total}</strong> {total === 1 ? 'entry' : 'entries'}
              {total ? ` (${kindsText(p.byKind)})` : ''}
              {p.resend ? `, of which ${p.resend} sent again after Tally refused ${p.resend === 1 ? 'it' : 'them'}` : ''}
              {total ? ` · debits ${rupees(p.amountPaise)}` : ''}
            </p>
          )}
          {p && !blockers.length && (p.newLedgers?.length > 0 || p.newVoucherTypes?.length > 0) && (
            <p className="hint">
              New in Tally with this batch, in the account names file: {[...(p.newVoucherTypes ?? []).map((n) => `${n} (voucher type)`), ...(p.newLedgers ?? []).map((l) => `${l.name} (${l.parent})`)].join(', ')}. The accountant imports that file first.
            </p>
          )}
          {p && !blockers.length && p.gstLedgers?.length > 0 && (
            <p className="hint">GST accounts the entries use, which the accountant creates in Tally with their GST details (Perinexa does not create them): {p.gstLedgers.join(', ')}.</p>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || pv.loading || blockers.length > 0 || !total} onClick={make}>
            <FileCode2 aria-hidden="true" /> {busy ? 'Preparing…' : 'Make the batch'}
          </button>
        </section>

        <section className="card bill-section" aria-labelledby="tally-batches">
          <h2 id="tally-batches">Batches</h2>
          {list.data && (
            <p className="hint">
              Entries so far: {Object.keys(STATUS_LOOK).filter((k) => s[k]).map((k) => `${s[k]} ${STATUS_WORDS[k]}`).join(', ') || 'none'}.
            </p>
          )}
          <DataTable
            caption="Tally batches"
            rows={list.data?.batches}
            loading={list.loading}
            onRowClick={(b) => navigate(`/billing/accounts/batches/${b.id}`)}
            emptyText="No batch yet."
            columns={[
              { key: 'number', header: 'Batch', render: (b) => <span className="tabular">{b.number}</span> },
              { key: 'period', header: 'Up to', render: (b) => formatDate(b.to) },
              { key: 'vouchers', header: 'Entries', align: 'right', render: (b) => <span className="tabular">{b.vouchers}</span> },
              { key: 'amount', header: 'Debits', align: 'right', render: (b) => <span className="tabular">{rupees(b.amountPaise)}</span> },
              { key: 'made', header: 'Made', render: (b) => `${formatDateTime(b.createdAt)}${b.createdByName ? ` by ${b.createdByName}` : ''}` },
              { key: 'imported', header: 'Imported', render: (b) => (b.imported ? <StatusPill tone="stable">Imported {formatDate(b.imported.at)}</StatusPill> : <StatusPill tone="due">Waiting</StatusPill>) },
            ]}
          />
        </section>
      </div>
    </>
  );
}

// ---------- One batch ----------

export function TallyBatchPage() {
  const { id } = useParams();
  const location = useLocation();
  const res = useFetch(`/tally/batches/${id}`);
  const [batch, setBatch] = useState(null);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const b = batch ?? res.data?.batch;
  const vouchers = res.data?.vouchers ?? [];
  const download = async (part) => {
    setBusy(part);
    setError(null);
    try {
      await downloadBatchFile(id, part);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const confirm = async () => {
    setBusy('imported');
    setError(null);
    try {
      const out = await api(`/tally/batches/${id}/imported`, { method: 'POST', body: {} });
      setBatch(out.batch);
      setFlash(`${out.count} ${out.count === 1 ? 'entry' : 'entries'} marked imported.`);
      res.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  if (res.error && !b) return <div className="pf-content"><Alert type="error">{res.error}</Alert></div>;
  if (!b) return <div className="pf-content"><p className="muted" aria-busy="true">Loading the batch…</p></div>;
  const waiting = res.data?.waiting ?? vouchers.filter((v) => v.status === 'exported' && v.batchId === b.id).length;
  return (
    <>
      <AccountsHeader
        title={`Batch ${b.number}`}
        crumb={b.number}
        subtitle={`${formatDate(b.from)} to ${formatDate(b.to)} · ${b.vouchers} ${b.vouchers === 1 ? 'entry' : 'entries'} · made ${formatDateTime(b.createdAt)}${b.createdByName ? ` by ${b.createdByName}` : ''}`}
        actions={
          <>
            {b.hasMastersFile && (
              <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => download('masters')}>
                <Download aria-hidden="true" /> {busy === 'masters' ? 'Preparing…' : 'Account names file'}
              </button>
            )}
            <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => download('vouchers')}>
              <Download aria-hidden="true" /> {busy === 'vouchers' ? 'Preparing…' : 'Entries file'}
            </button>
            <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => download('all')}>
              <Download aria-hidden="true" /> {busy === 'all' ? 'Preparing…' : 'Download for Tally (one file)'}
            </button>
          </>
        }
      />
      <div className="pf-content bill-page">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error">{error}</Alert>
        <section className="card bill-section" aria-labelledby="tally-how">
          <h2 id="tally-how">For the accountant</h2>
          <ol>
            <li>In Tally, open the company named under Account names. Under Import → Configuration, set “Overwrite voucher when a voucher with same GUID exists” to Yes, and for account names “Behaviour of import if master already exists” to Ignore duplicates (an account the accountant already has is left as it is).</li>
            <li>Import → Transactions, and choose the one file (Download for Tally){b.hasMastersFile ? ` – it brings the ${b.voucherTypes.length + b.masters.length} new account names first, then the entries` : ''}. Tally lists anything it refused under Import → Exceptions.</li>
            <li>Record what Tally refused under Exceptions here, then send it again in the next batch or skip it.</li>
          </ol>
          <p className="hint">
            If Tally does not take the one file, use the two separate files instead: {b.hasMastersFile ? 'first Import → Masters with the account names file, then ' : ''}Import → Transactions with the entries file.
          </p>
          <p className="hint">The same file can be downloaded again any time. Each entry carries Perinexa’s number and an identifier that, with the setting above, makes Tally overwrite rather than double an entry imported twice. An entry sent again after a refusal carries the account names as they are now. Downloads: one file {b.downloads.all ?? 0}, entries {b.downloads.vouchers}, account names {b.downloads.masters}.</p>
          {b.imported ? (
            <p>
              <StatusPill tone="stable">Imported</StatusPill> Confirmed by {b.imported.byName || 'the hospital admin'} on {formatDateTime(b.imported.at)}.
            </p>
          ) : (
            waiting > 0 && (
              <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={confirm}>
                <Check aria-hidden="true" /> {busy === 'imported' ? 'Saving…' : `Mark the whole batch imported (${waiting} waiting)`}
              </button>
            )
          )}
        </section>
        <VoucherTable vouchers={vouchers} shown={res.data?.shown} total={b.vouchers} onChanged={() => res.reload()} />
      </div>
    </>
  );
}

/** The entries of a batch or of a status, each openable to its lines, with the status actions. */
function VoucherTable({ vouchers, shown, total, onChanged, caption = 'Entries' }) {
  const [open, setOpen] = useState(null);
  const headingId = useId();
  return (
    <section className="card bill-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{caption}</h2>
      {shown != null && total != null && shown < total && <p className="hint">The first {shown} of {total} entries are shown.</p>}
      {!vouchers.length && <p className="muted">No entries.</p>}
      {vouchers.length > 0 && (
        <table className="bill-report">
          <thead>
            <tr>
              <th scope="col">Entry</th>
              <th scope="col">Kind</th>
              <th scope="col">Date</th>
              <th scope="col" className="num">Amount</th>
              <th scope="col">Status</th>
              <th scope="col">Batch</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.map((v) => (
              <VoucherRow key={v.id} v={v} open={open === v.id} onToggle={() => setOpen(open === v.id ? null : v.id)} onChanged={onChanged} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function VoucherRow({ v, open, onToggle, onChanged }) {
  return (
    <>
      <tr>
        <td>
          <button type="button" className="btn btn-link tabular" aria-expanded={open} onClick={onToggle}>
            {v.key}
          </button>
        </td>
        <td>{v.kindLabel ?? KIND_WORDS[v.kind]}</td>
        <td>{formatDate(v.date)}</td>
        <td className="num tabular">{rupees(v.amountPaise)}</td>
        <td>
          <TallyStatus status={v.status} />
        </td>
        <td className="tabular">{v.batchNumber || (v.status === 'exported' ? 'Next batch' : '')}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6}>
            <p className="hint">{v.narration}</p>
            <table className="bill-report">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col" className="num">Debit</th>
                  <th scope="col" className="num">Credit</th>
                </tr>
              </thead>
              <tbody>
                {v.lines.map((l, i) => (
                  <tr key={`${l.ledger}-${i}`}>
                    <td>{l.ledger}</td>
                    <td className="num tabular">{l.side === 'dr' ? rupees(l.paise) : ''}</td>
                    <td className="num tabular">{l.side === 'cr' ? rupees(l.paise) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {v.note && <p className="hint">Note: {v.note}</p>}
            <VoucherActions v={v} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

// What an entry's status may become (the server keeps the same rules).
const NEXT = {
  exported: [
    ['imported', 'Imported', Check],
    ['failed', 'Refused by Tally', X],
    ['skipped', 'Skip', SkipForward],
  ],
  failed: [
    ['exported', 'Send again', RotateCcw],
    ['skipped', 'Skip', SkipForward],
    ['imported', 'Imported after all', Check],
  ],
  skipped: [
    ['exported', 'Send again', RotateCcw],
    ['imported', 'Imported after all', Check],
  ],
  imported: [['failed', 'Tally refused it after all', X]],
};
const NEEDS_NOTE = { failed: 'What did Tally say? (its words from Import → Exceptions)', skipped: 'Why is it skipped? (for example: booked by hand)' };

export function VoucherActions({ v, onChanged }) {
  const [choice, setChoice] = useState(null);
  const [note, setNote] = useState('');
  const s = useSend(() => {
    setChoice(null);
    setNote('');
    onChanged?.();
  });
  const options = NEXT[v.status] ?? [];
  const go = (status) => {
    if (NEEDS_NOTE[status] && choice !== status) {
      setChoice(status);
      return;
    }
    s.send(`/tally/vouchers/${v.id}/status`, { status, note: NEEDS_NOTE[status] ? note.trim() : '' });
  };
  return (
    <div>
      <Alert type="error">{s.error}</Alert>
      {choice && (
        <Field label={NEEDS_NOTE[choice]} id={`tally-note-${v.id}`} error={s.fields.note}>
          <input id={`tally-note-${v.id}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
      <div className="row">
        {options.map(([status, label, Icon]) => (
          <button key={status} type="button" className="btn btn-secondary" disabled={s.busy || (choice === status && note.trim().length < 3)} onClick={() => go(status)}>
            <Icon aria-hidden="true" /> {choice === status ? `Save: ${label.toLowerCase()}` : label}
          </button>
        ))}
        {choice && (
          <button type="button" className="btn btn-secondary" onClick={() => setChoice(null)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Exceptions ----------

export function TallyExceptionsPage() {
  const failed = useFetch('/tally/vouchers', { status: 'failed' });
  const skipped = useFetch('/tally/vouchers', { status: 'skipped' });
  const waiting = useFetch('/tally/vouchers', { status: 'exported' });
  const reload = () => {
    failed.reload();
    skipped.reload();
    waiting.reload();
  };
  return (
    <>
      <AccountsHeader title="Exceptions" crumb="Exceptions" subtitle="Entries Tally refused, entries skipped on purpose, and entries still waiting for the accountant’s word." />
      <div className="pf-content bill-page">
        {(failed.error || skipped.error || waiting.error) && <Alert type="error">{failed.error || skipped.error || waiting.error}</Alert>}
        <p className="hint">Open an entry to see its lines and change what became of it. An entry sent again goes into the next batch’s file with the same identifier (Tally overwrites rather than doubles it, with the import setting named on the batch page) and with the account names as they are now – so correct a wrong name under Account names first.</p>
        <VoucherTable caption="Refused by Tally" vouchers={failed.data?.vouchers ?? []} onChanged={reload} />
        <VoucherTable caption="Skipped" vouchers={skipped.data?.vouchers ?? []} onChanged={reload} />
        <VoucherTable caption="Waiting for Tally" vouchers={waiting.data?.vouchers ?? []} onChanged={reload} />
      </div>
    </>
  );
}

// ---------- Account names ----------

const INCOME_GROUPS = [
  ['consultation', 'Consultation'],
  ['procedure', 'Procedure'],
  ['scan', 'Scan'],
  ['lab', 'Lab test'],
  ['inpatient', 'Inpatient (bed days)'],
  ['medicine', 'Medicine on a hospital bill (not through the pharmacy)'],
  ['other', 'Other'],
];
const MODES = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['card', 'Card'],
  ['insurance', 'Insurance or scheme (when the scheme has no account of its own)'],
];
const SINGLE = [
  ['patients', 'Patients (one shared account – never one per patient)'],
  ['counter', 'Pharmacy counter customers (walk-ins, without names)'],
  ['deposits', 'Patient deposits (held during a stay)'],
  ['discount', 'Discount allowed'],
  ['exemptIssues', 'Medicines issued to admitted patients, if booked as exempt'],
  ['purchaseReturns', 'Purchase returns (stock sent back to a supplier)'],
];
const GST = [
  ['outputCgst', 'Output CGST'],
  ['outputSgst', 'Output SGST'],
  ['inputCgst', 'Input CGST'],
  ['inputSgst', 'Input SGST'],
  ['inputIgst', 'Input IGST'],
];
const TYPES = [
  ['sales', 'Sales'],
  ['receipt', 'Receipt'],
  ['payment', 'Payment'],
  ['creditNote', 'Credit note'],
  ['debitNote', 'Debit note'],
  ['journal', 'Journal'],
];
const RATES = ['0', '5', '12', '18'];

export function TallySettingsPage() {
  const res = useFetch('/tally/settings');
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const s = useSend(() => {
    setSaved(true);
    setForm(null);
    res.reload();
  });
  const v = form ?? res.data?.settings;
  const change = (patch) => {
    setSaved(false);
    setForm({ ...v, ...patch });
  };
  const ledger = (k) => (e) => change({ ledgers: { ...v.ledgers, [k]: e.target.value } });
  const nested = (group, k) => (e) => change({ ledgers: { ...v.ledgers, [group]: { ...v.ledgers[group], [k]: e.target.value } } });
  const typeName = (k) => (e) => change({ voucherTypes: { ...v.voucherTypes, [k]: e.target.value } });
  const schemes = v?.ledgers?.schemes ?? [];
  const setScheme = (i, patch) => change({ ledgers: { ...v.ledgers, schemes: schemes.map((x, j) => (j === i ? { ...x, ...patch } : x)) } });
  const rates = v ? [...new Set([...RATES, ...Object.keys(v.ledgers.pharmacySales ?? {})])].sort((a, b) => Number(a) - Number(b)) : [];
  const save = () =>
    s.send(
      '/tally/settings',
      {
        companyName: v.companyName.trim(),
        booksFrom: v.booksFrom ? String(v.booksFrom).slice(0, 10) : null,
        inpatientIssues: v.inpatientIssues,
        ledgers: { ...v.ledgers, schemes: schemes.filter((x) => x.scheme?.trim() && x.ledger?.trim()).map((x) => ({ scheme: x.scheme.trim(), ledger: x.ledger.trim() })) },
        voucherTypes: v.voucherTypes,
      },
      null,
      'PUT',
    );
  return (
    <>
      <AccountsHeader title="Account names" crumb="Account names" subtitle="The accountant’s exact Tally names. Perinexa uses them letter for letter; a name that does not exist in Tally makes Tally refuse the entry." />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <Alert type="error">{s.error}</Alert>
        {saved && !form && <Alert type="success">Saved.</Alert>}
        {v && res.data?.canEdit === false && <Alert type="info">Only the hospital admin changes the account names. Tell the admin if a name here does not match Tally.</Alert>}
        {v && (
          <fieldset className="fieldset tally-names" disabled={res.data?.canEdit === false}>
            <section className="card bill-section narrow" aria-labelledby="tally-company">
              <h2 id="tally-company">The Tally company and the books</h2>
              <div className="form-grid">
                <Field label="Tally company name" id="tally-company-name" error={s.fields.companyName} hint="Exactly as it appears in Tally, so the entries never land in another company." keepHint>
                  <input id="tally-company-name" value={v.companyName} maxLength={150} onChange={(e) => change({ companyName: e.target.value })} />
                </Field>
                <Field label="Books start in Perinexa on" id="tally-books-from" error={s.fields.booksFrom} hint="Bills and invoices from this day on go to Tally; earlier ones the accountant has already entered by hand. On or after the Tally company’s “Books beginning from” date, or Tally refuses the earlier entries." keepHint>
                  <input id="tally-books-from" type="date" value={v.booksFrom ? String(v.booksFrom).slice(0, 10) : ''} onChange={(e) => change({ booksFrom: e.target.value || null })} />
                </Field>
                <Field label="Medicines issued to admitted patients" id="tally-issues" hint="As the invoice is printed (with GST), or as part of the exempt treatment – the accountant decides.">
                  <select id="tally-issues" value={v.inpatientIssues} onChange={(e) => change({ inpatientIssues: e.target.value })}>
                    <option value="taxable">Taxable pharmacy sale, with GST (as printed)</option>
                    <option value="exempt">Exempt, part of the treatment</option>
                  </select>
                </Field>
              </div>
            </section>

            <section className="card bill-section narrow" aria-labelledby="tally-income">
              <h2 id="tally-income">Income accounts (hospital bills, no GST)</h2>
              <div className="form-grid">
                {INCOME_GROUPS.map(([k, label]) => (
                  <Field key={k} label={label} id={`tally-income-${k}`}>
                    <input id={`tally-income-${k}`} value={v.ledgers.income?.[k] ?? ''} maxLength={100} onChange={nested('income', k)} />
                  </Field>
                ))}
              </div>
            </section>

            <section className="card bill-section narrow" aria-labelledby="tally-money">
              <h2 id="tally-money">Where the money lands</h2>
              <div className="form-grid">
                {MODES.map(([k, label]) => (
                  <Field key={k} label={label} id={`tally-mode-${k}`}>
                    <input id={`tally-mode-${k}`} value={v.ledgers.modes?.[k] ?? ''} maxLength={100} onChange={nested('modes', k)} />
                  </Field>
                ))}
              </div>
              <h3>Insurers and schemes with their own account</h3>
              <p className="hint">The scheme as reception types it on a payment (for example PM-JAY), and its Tally account. Any other scheme goes to the insurance account above.</p>
              {schemes.map((x, i) => (
                <div className="form-grid" key={i}>
                  <Field label="Scheme" id={`tally-scheme-${i}`}>
                    <input id={`tally-scheme-${i}`} value={x.scheme} maxLength={80} onChange={(e) => setScheme(i, { scheme: e.target.value })} />
                  </Field>
                  <Field label="Tally account" id={`tally-scheme-ledger-${i}`}>
                    <input id={`tally-scheme-ledger-${i}`} value={x.ledger} maxLength={100} onChange={(e) => setScheme(i, { ledger: e.target.value })} />
                  </Field>
                  <button type="button" className="btn btn-secondary" onClick={() => change({ ledgers: { ...v.ledgers, schemes: schemes.filter((_, j) => j !== i) } })}>
                    <X aria-hidden="true" /> Remove
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary" onClick={() => change({ ledgers: { ...v.ledgers, schemes: [...schemes, { scheme: '', ledger: '' }] } })}>
                <Plus aria-hidden="true" /> Add a scheme
              </button>
            </section>

            <section className="card bill-section narrow" aria-labelledby="tally-other">
              <h2 id="tally-other">Patients, deposits, discounts, pharmacy</h2>
              <div className="form-grid">
                {SINGLE.map(([k, label]) => (
                  <Field key={k} label={label} id={`tally-${k}`}>
                    <input id={`tally-${k}`} value={v.ledgers[k] ?? ''} maxLength={100} onChange={ledger(k)} />
                  </Field>
                ))}
                {rates.map((r) => (
                  <Field key={r} label={`Pharmacy sales at ${r}% GST`} id={`tally-psales-${r}`}>
                    <input id={`tally-psales-${r}`} value={v.ledgers.pharmacySales?.[r] ?? ''} placeholder={Number(r) === 0 ? 'Pharmacy sales exempt' : `Pharmacy sales ${r}%`} maxLength={100} onChange={(e) => change({ ledgers: { ...v.ledgers, pharmacySales: { ...v.ledgers.pharmacySales, [r]: e.target.value } } })} />
                  </Field>
                ))}
              </div>
            </section>

            <section className="card bill-section narrow" aria-labelledby="tally-gst">
              <h2 id="tally-gst">GST accounts</h2>
              <p className="hint">Perinexa never creates these in Tally: the accountant creates them with their GST details (rate, type of duty) and tells you their names.</p>
              <div className="form-grid">
                {GST.map(([k, label]) => (
                  <Field key={k} label={label} id={`tally-${k}`}>
                    <input id={`tally-${k}`} value={v.ledgers[k] ?? ''} maxLength={100} onChange={ledger(k)} />
                  </Field>
                ))}
              </div>
            </section>

            <section className="card bill-section narrow" aria-labelledby="tally-types">
              <h2 id="tally-types">Voucher types</h2>
              <p className="hint">Perinexa’s own voucher types in Tally, with Perinexa’s numbers, so the accountant’s own numbering is never touched. The account names file creates them.</p>
              <div className="form-grid">
                {TYPES.map(([k, label]) => (
                  <Field key={k} label={label} id={`tally-type-${k}`}>
                    <input id={`tally-type-${k}`} value={v.voucherTypes?.[k] ?? ''} maxLength={100} onChange={typeName(k)} />
                  </Field>
                ))}
              </div>
              {v.updatedByName && (
                <p className="hint">
                  Last changed by {v.updatedByName}, {formatDateTime(v.updatedAt)}.
                </p>
              )}
              {res.data?.canEdit !== false && (
                <button type="button" className="btn btn-primary" disabled={!form || s.busy} onClick={save}>
                  <Save aria-hidden="true" /> {s.busy ? 'Saving…' : 'Save'}
                </button>
              )}
            </section>
          </fieldset>
        )}
      </div>
    </>
  );
}

// ---------- The control sheet ----------

export function TallyControlPage() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const res = useFetch('/tally/control', { month });
  const d = res.data;
  const sum = (k) => (d?.rows ?? []).reduce((s, r) => s + r[k], 0);
  return (
    <>
      <AccountsHeader title="Control sheet" crumb="Control sheet" subtitle="Totals per account for a month, from the entries sent (waiting and imported). Compare with Tally before the GST return." />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <section className="card bill-section" aria-labelledby="tally-control">
          <h2 id="tally-control">Month</h2>
          <div className="form-grid">
            <Field label="Month" id="tally-month">
              <input id="tally-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            </Field>
          </div>
          {d && (
            <p className="hint">
              {d.entries} {d.entries === 1 ? 'entry' : 'entries'} dated in this month: {Object.keys(STATUS_LOOK).filter((k) => d.statuses?.[k]).map((k) => `${d.statuses[k]} ${STATUS_WORDS[k]}`).join(', ') || 'none'}. Refused and skipped entries are not in the totals.
            </p>
          )}
          {d && d.rows.length > 0 && (
            <table className="bill-report">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col" className="num">Debit</th>
                  <th scope="col" className="num">Credit</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.ledger}>
                    <td>{r.ledger}</td>
                    <td className="num tabular">{r.debitPaise ? rupees(r.debitPaise) : ''}</td>
                    <td className="num tabular">{r.creditPaise ? rupees(r.creditPaise) : ''}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Total</th>
                  <td className="num tabular">{rupees(sum('debitPaise'))}</td>
                  <td className="num tabular">{rupees(sum('creditPaise'))}</td>
                </tr>
              </tbody>
            </table>
          )}
          {d && !d.rows.length && <p className="muted">No entries dated in this month.</p>}
        </section>
      </div>
    </>
  );
}

// ---------- The mark on a bill or a pharmacy invoice (hospital admin) ----------

export function TallyMarks({ model, id }) {
  const res = useFetch(id ? '/tally/marks' : null, { model, id });
  const marks = res.data?.marks ?? [];
  if (!marks.length) return null;
  return (
    <p className="hint">
      Sent to Tally: {marks.map((m) => `${m.key} (${m.kindLabel ?? KIND_WORDS[m.kind]}, ${m.batchNumber || 'next batch'}, ${STATUS_LOOK[m.status]?.label ?? m.status})`).join(' · ')}. <Link to="/billing/accounts">Accounts</Link>
    </p>
  );
}
