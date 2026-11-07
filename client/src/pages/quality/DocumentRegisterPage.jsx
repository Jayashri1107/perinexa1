import { useState } from 'react';
import { BadgeCheck, CalendarClock, CircleSlash, FilePen, History } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { FormDialog } from './FormDialog.jsx';
import { useQualityTabs } from './qualityFormat.js';

// Clinical audit → Document register (Clinical Requirements Group C – PX-X-02): each controlled form of the hospital's
// manual that a Perinexa screen stands in for, with its versions. The quality lead or the admin records a version; a
// doctor approves it; it is in force from its day until a later approved version. Printouts carry the version in force
// on the record's day (PX-X-03).

export const VERSION_LOOK = {
  draft: { tone: 'due', icon: FilePen, word: 'Draft – to approve' },
  in_force: { tone: 'stable', icon: BadgeCheck, word: 'In force' },
  future: { tone: 'neutral', icon: CalendarClock, word: 'Approved – starts later' },
  superseded: { tone: 'inactive', icon: History, word: 'Superseded' },
  withdrawn: { tone: 'inactive', icon: CircleSlash, word: 'Withdrawn' },
};

function RecordDialog({ screens, onDone, onCancel }) {
  const [f, setF] = useState({ screen: '', code: '', title: '', version: '', effectiveFrom: '', reviewDue: '', note: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => {
    const v = e.target.value;
    // choosing the screen fills in the code and title known for it (the hospital may change them)
    if (k === 'screen' && screens[v]) setF({ ...f, screen: v, code: f.code || screens[v].code, title: f.title || screens[v].label });
    else setF({ ...f, [k]: v });
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api('/forms', { method: 'POST', body: f });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const fe = (k) => error?.fields?.[k];
  return (
    <FormDialog id="fr-add" title="Record a form version" submitLabel="Record the version" busy={busy} onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.fields ? null : error?.message}</Alert>
      <div className="form-grid">
        <Field label="Perinexa screen" id="fr-screen" error={fe('screen')}>
          <select id="fr-screen" value={f.screen} onChange={set('screen')}>
            <option value="">Choose…</option>
            {Object.entries(screens).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Code in the manual" id="fr-code" error={fe('code')}>
          <input id="fr-code" maxLength={30} value={f.code} onChange={set('code')} />
        </Field>
        <Field label="Title" id="fr-title" error={fe('title')}>
          <input id="fr-title" maxLength={150} value={f.title} onChange={set('title')} />
        </Field>
        <Field label="Version" id="fr-version" error={fe('version')}>
          <input id="fr-version" maxLength={20} value={f.version} placeholder="1.0" onChange={set('version')} />
        </Field>
        <Field label="In force from" id="fr-from" error={fe('effectiveFrom')}>
          <input id="fr-from" type="date" value={f.effectiveFrom} onChange={set('effectiveFrom')} />
        </Field>
        <Field label="Review due (optional)" id="fr-review" error={fe('reviewDue')}>
          <input id="fr-review" type="date" value={f.reviewDue} onChange={set('reviewDue')} />
        </Field>
        <Field label="Note" id="fr-note" error={fe('note')}>
          <input id="fr-note" maxLength={300} value={f.note} onChange={set('note')} />
        </Field>
      </div>
    </FormDialog>
  );
}

function WithdrawDialog({ version, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(`/forms/${version.id}/withdraw`, { method: 'POST', body: { reason } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog id="fr-withdraw" title={`Withdraw ${version.code} version ${version.version}`} submitLabel="Withdraw the draft" onSubmit={submit} onCancel={onCancel}>
      <Alert type="error">{error?.fields ? null : error?.message}</Alert>
      <Field label="Why it is withdrawn" id="fr-reason" error={error?.fields?.reason}>
        <input id="fr-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

export function DocumentRegisterPage() {
  const tabs = useQualityTabs();
  const { data, error, reload } = useFetch('/forms');
  const [adding, setAdding] = useState(false);
  const [withdrawing, setWithdrawing] = useState(null);
  const [message, setMessage] = useState(null);
  const approve = async (v) => {
    setMessage(null);
    try {
      await api(`/forms/${v.id}/approve`, { method: 'POST', body: {} });
      reload();
    } catch (err) {
      setMessage(err.message);
    }
  };
  const done = () => {
    setAdding(false);
    setWithdrawing(null);
    reload();
  };
  const screens = data?.rules.screens ?? {};
  return (
    <>
      <PageHeader
        title="Clinical audit"
        documentTitle="Document register"
        subtitle="The manual's controlled forms that Perinexa's screens stand in for, with each version. A doctor approves a version; printouts carry the version in force on the record's day."
        tabs={tabs}
        actions={
          data?.access.record && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              Record a form version
            </button>
          )
        }
      />
      <div className="pf-content stack">
        <Alert type="error">{error ?? message}</Alert>
        {data && <p className="hint">{data.rules.source}</p>}
        {data &&
          Object.entries(screens).map(([key, sc]) => {
            const list = data.versions.filter((v) => v.screen === key);
            return (
              <section key={key} className="card">
                <h2>{sc.label}</h2>
                {list.length === 0 && <p className="muted">{`Not in the register yet${sc.code ? ` (manual code ${sc.code})` : ''}. Its printouts say so.`}</p>}
                <ul className="pa-list">
                  {list.map((v) => {
                    const look = VERSION_LOOK[v.state];
                    return (
                      <li key={v.id}>
                        <StatusPill tone={look.tone} icon={look.icon}>
                          {look.word}
                        </StatusPill>
                        <strong>{`${v.code} · version ${v.version}`}</strong>
                        <span>
                          {[
                            v.title,
                            `from ${formatDate(v.effectiveFrom)}`,
                            v.reviewDue && `review due ${formatDate(v.reviewDue)}`,
                            v.note,
                            `recorded by ${v.recorded.byName}`,
                            v.approved && `approved by ${v.approved.byName}, ${formatDateTime(v.approved.at)}`,
                            v.withdrawn && `withdrawn by ${v.withdrawn.byName}: ${v.withdrawn.reason}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {v.reviewOverdue && <StatusPill tone="watch" icon={CalendarClock}>Review overdue</StatusPill>}
                        {v.state === 'draft' && data.access.approve && (
                          <button type="button" className="btn btn-secondary" onClick={() => approve(v)}>
                            Approve
                          </button>
                        )}
                        {v.state === 'draft' && data.access.record && (
                          <button type="button" className="btn btn-link" onClick={() => setWithdrawing(v)}>
                            Withdraw
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
      </div>
      {adding && <RecordDialog screens={screens} onDone={done} onCancel={() => setAdding(false)} />}
      {withdrawing && <WithdrawDialog version={withdrawing} onDone={done} onCancel={() => setWithdrawing(null)} />}
    </>
  );
}
