import { useState } from 'react';
import { CircleCheck, CircleMinus, Copy, Pencil, RotateCcw } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, formatDateTime, useConfirm, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KNOWLEDGE_CRUMB, knowledgeTabs } from '../../platform/modules.js';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { ConsentClauses, ConsentTitle } from './ConsentDocument.jsx';
import { ConsentFormStatus } from './ConsentFormsPage.jsx';
import { BLANK_LABELS, LANGUAGE_NAMES, PRINT_LANGUAGES, SUGGEST_LABELS, careTypesText, kindWords, listWords } from './consentFormat.js';

// One consent or information form: what it is for, its wording in English beside Marathi or Hindi (blanks labelled), and for
// doctors: edit, copy, approve, and stop or start using it.

function ApproveDialog({ form, onDone, onOutdated, onCancel }) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const langs = form.languages.map((l) => LANGUAGE_NAMES[l]);
  const missing = ['mr', 'hi'].filter((l) => !form.languages.includes(l)).map((l) => LANGUAGE_NAMES[l]);
  const approve = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/consent-forms/${form.id}/approve`, { method: 'POST', body: { confirm: confirmed, version: form.version } });
      onDone(res.form);
    } catch (err) {
      setError(err.message);
      setSaving(false);
      if (err.status === 409) onOutdated(err.message);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="cf-approve-title" onSubmit={approve}>
        <h2 id="cf-approve-title">Approve for use with patients</h2>
        <p>
          You are approving <strong>{form.title.en}</strong> (version {form.version}) in {listWords(langs)}. Once approved, it
          prints without the DRAFT label.
        </p>
        {missing.length > 0 && (
          <Alert type="info">
            The {listWords(missing)} text is not complete, so the form can't be printed in {missing.length > 1 ? 'those languages' : 'that language'}.
          </Alert>
        )}
        <Alert type="error">{error}</Alert>
        <label className="checkbox">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            I am a doctor. I have read every clause of this form in {listWords(langs)}. The wording, including the translations, has been checked for
            our hospital and legally reviewed where needed, and I approve it for use with patients.
          </span>
        </label>
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-positive" disabled={!confirmed || saving}>
            <CircleCheck aria-hidden="true" /> {saving ? 'Approving…' : 'Approve form'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ConsentFormDetailPage({ kind = 'consent' }) {
  const { activeMembership } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, error, reload } = useFetch(`/consent-forms/${id}`);
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [actionError, setActionError] = useState(null);
  const [approving, setApproving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState(null);
  const [confirm, confirmDialog] = useConfirm();
  const f = data?.form;
  const W = kindWords(f?.kind ?? kind);

  if (error && !f) {
    return (
      <>
        <PageHeader breadcrumbs={[KNOWLEDGE_CRUMB, { label: W.plural, to: W.base }, { label: 'Not found' }]} title="Form not found" />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="error">{error}</Alert>
            <p>
              <Link to={W.base}>Back to {W.many}</Link>
            </p>
          </div>
        </div>
      </>
    );
  }
  if (!f) return <FullPageSpinner />;

  const shown = lang && (lang === 'en' || f.languages.includes(lang)) ? lang : (['mr', 'hi'].find((l) => f.languages.includes(l)) ?? 'en');

  const copy = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api('/consent-forms', { method: 'POST', body: { copyFrom: f.id } });
      navigate(`${W.base}/${res.form.id}`, { state: { flash: 'A copy was made as a new draft form. Edit it as needed, then approve it.' } });
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active) => {
    if (!active) {
      const ok = await confirm({
        title: `Stop using ${f.title.en}?`,
        text: 'It will no longer be offered for patients. It is kept, with the record of every printout, and can be used again later.',
        confirmLabel: 'Stop using',
      });
      if (!ok) return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api(`/consent-forms/${f.id}/active`, { method: 'PATCH', body: { active } });
      setFlash(active ? 'The form is in use again.' : 'The form is no longer offered for patients.');
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[KNOWLEDGE_CRUMB, { label: W.plural, to: W.base }, { label: f.title.en }]}
        title={f.title.en}
        badges={<ConsentFormStatus form={f} />}
        tabs={knowledgeTabs(activeMembership.roles)}
        actions={
          f.canEdit && (
            <>
              {f.canApprove && f.status === 'draft' && f.isActive && (
                <button type="button" className="btn btn-positive" onClick={() => setApproving(true)}>
                  <CircleCheck aria-hidden="true" /> Approve
                </button>
              )}
              <Link to={`${W.base}/${f.id}/edit`} className="btn btn-secondary">
                <Pencil aria-hidden="true" /> Edit
              </Link>
              <button type="button" className="btn btn-secondary" onClick={copy} disabled={busy}>
                <Copy aria-hidden="true" /> Copy
              </button>
              {f.isActive ? (
                <button type="button" className="btn btn-link" onClick={() => setActive(false)} disabled={busy}>
                  <CircleMinus aria-hidden="true" /> Stop using
                </button>
              ) : (
                <button type="button" className="btn btn-link" onClick={() => setActive(true)} disabled={busy}>
                  <RotateCcw aria-hidden="true" /> Use again
                </button>
              )}
            </>
          )
        }
      />
      <div className="pf-content">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
        {f.status === 'draft' && (
          <Alert type="warning">
            <strong>Draft – not approved for use with patients.</strong>{' '}
            {f.origin === 'built_in' && f.version === 1
              ? 'This wording was prepared by the software developer and has not been legally reviewed. '
              : 'This version has not been approved yet. '}
            Check every clause in English and in the translations, then a doctor approves it.
          </Alert>
        )}

        <section className="card cf-meta">
          <dl className="details">
            <div>
              <dt>For</dt>
              <dd>{careTypesText(f.careTypes, CARE_TYPE_SHORT)}</dd>
            </div>
            <div>
              <dt>Suggested</dt>
              <dd>{SUGGEST_LABELS[f.suggestWhen] ?? f.suggestWhen}</dd>
            </div>
            <div>
              <dt>Languages</dt>
              <dd>{f.languages.map((l) => LANGUAGE_NAMES[l]).join(', ')}</dd>
            </div>
            {f.blanks.length > 0 && (
              <div>
                <dt>Filled in when printed</dt>
                <dd>{f.blanks.map((b) => BLANK_LABELS[b]).join(', ')}</dd>
              </div>
            )}
            <div>
              <dt>Approved</dt>
              <dd>
                {f.approvedByName
                  ? `${f.approvedByName}, ${formatDateTime(f.approvedAt)} (version ${f.approvedVersion})${f.status === 'draft' ? ' – changed since' : ''}`
                  : 'Not yet'}
              </dd>
            </div>
            <div>
              <dt>Last changed</dt>
              <dd>
                {formatDateTime(f.updatedAt)}
                {f.updatedByName ? ` by ${f.updatedByName}` : ''}
              </dd>
            </div>
            {f.description && (
              <div>
                <dt>Notes</dt>
                <dd>{f.description}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="card cf-wording" aria-labelledby="cf-wording-title">
          <div className="cf-wording-head">
            <h2 id="cf-wording-title">Wording</h2>
            <div className="segmented" role="group" aria-label="Show in">
              {PRINT_LANGUAGES.filter((l) => l.key === 'en' || f.languages.includes(l.key)).map((l) => (
                <button key={l.key} type="button" aria-pressed={shown === l.key} onClick={() => setLang(l.key)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <p className="hint help">As printed, English beside the translation. The highlighted words are filled in for each patient.</p>
          <div className="paper cf-paper pdoc">
            <ConsentTitle form={f} lang={shown} />
            <ConsentClauses form={f} lang={shown} values={null} />
          </div>
        </section>
      </div>
      {approving && (
        <ApproveDialog
          form={f}
          onCancel={() => setApproving(false)}
          onDone={() => {
            setApproving(false);
            setFlash('Form approved. It now prints without the DRAFT label.');
            reload();
          }}
          onOutdated={(message) => {
            setApproving(false);
            setActionError(message);
            reload();
          }}
        />
      )}
      {confirmDialog}
    </>
  );
}
