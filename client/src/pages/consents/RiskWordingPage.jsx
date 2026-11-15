import { useState } from 'react';
import { CircleCheck, Lock, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { KNOWLEDGE_CRUMB, knowledgeTabs } from '../../platform/modules.js';
import { ConsentRiskSection } from './ConsentDocument.jsx';
import { PRINT_LANGUAGES } from './consentFormat.js';

// The wording of the high-risk factors printed on consent forms (Clinic library › Consent forms › High-risk
// factors): every risk factor with the complications it can lead to, as printed – English beside Marathi or
// Hindi. It is the built-in DRAFT wording: doctors, RMOs and nurses read it; a doctor approves it for the
// hospital, and until then every form that carries it says DRAFT. It holds no patient data.

function ApproveDialog({ wording, onDone, onOutdated, onCancel }) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const approve = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/consent-forms/risk-wording/approve', { method: 'POST', body: { confirm: confirmed, version: wording.version } });
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
      if (err.status === 409) onOutdated(err.message);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="cf-risk-approve-title" onSubmit={approve}>
        <h2 id="cf-risk-approve-title">Approve for use with patients</h2>
        <p>
          You are approving the wording of the <strong>high-risk factors and their complications</strong> (version {wording.version}) in English, Marathi and
          Hindi. Once approved, consent forms that carry it print without the DRAFT label for this wording.
        </p>
        <Alert type="error">{error}</Alert>
        <label className="checkbox">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            I am a doctor. I have read every risk factor and its complications in English, Marathi and Hindi. The medical content and the translations have
            been checked for our hospital, and I approve this wording for use with patients.
          </span>
        </label>
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-positive" disabled={!confirmed || saving}>
            <CircleCheck aria-hidden="true" /> {saving ? 'Approving…' : 'Approve wording'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function RiskWordingPage() {
  const { activeMembership } = useAuth();
  const { data, error, reload } = useFetch('/consent-forms/risk-wording');
  const [lang, setLang] = useState('mr');
  const [approving, setApproving] = useState(false);
  const [flash, setFlash] = useState(null);
  const [actionError, setActionError] = useState(null);
  const w = data?.wording;
  const crumbs = [KNOWLEDGE_CRUMB, { label: 'Consent forms', to: '/consent-forms' }, { label: 'High-risk factors' }];

  if (error && !w) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="High-risk factors on consent forms" />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="error">{error}</Alert>
            <p>
              <Link to="/consent-forms">Back to consent forms</Link>
            </p>
          </div>
        </div>
      </>
    );
  }
  if (!w) return <FullPageSpinner />;

  const privateNames = w.groups.filter((g) => g.private).map((g) => g.name.en);
  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title="High-risk factors on consent forms"
        badges={
          w.approved ? (
            <StatusPill tone="stable">Approved · v{w.version}</StatusPill>
          ) : (
            <StatusPill tone="watch" icon={TriangleAlert}>
              Draft · v{w.version}
            </StatusPill>
          )
        }
        help="When a consent form is printed for a patient, the doctor chooses which of her high-risk factors are printed on it. Each is printed with these complications."
        tabs={knowledgeTabs(activeMembership.roles)}
        actions={
          w.canApprove &&
          !w.approved && (
            <button type="button" className="btn btn-positive" onClick={() => setApproving(true)}>
              <CircleCheck aria-hidden="true" /> Approve
            </button>
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
        {w.approved ? (
          <Alert type="success">
            Approved by <strong>{w.approvedByName}</strong> on {formatDateTime(w.approvedAt)} (version {w.version}).
          </Alert>
        ) : (
          <Alert type="warning">
            <strong>Draft – not approved for use with patients.</strong> This wording was prepared by the software developer and has not been checked by a
            doctor. Read every risk factor and its complications in English and in the translations, then a doctor approves it. Until then, a consent form that
            carries it says DRAFT at the top of every page.
          </Alert>
        )}

        <section className="card cf-meta">
          <dl className="details">
            <div>
              <dt>Where the risk factors come from</dt>
              <dd>
                The reasons behind the patient's risk level (antenatal care). The high ones are ticked when a form is printed; the doctor can change that. A
                risk rule whose cut-off the hospital changed keeps these complications; a rule changed to check something else is treated as the hospital's
                own.
              </dd>
            </div>
            <div>
              <dt>Never printed</dt>
              <dd>
                <Lock aria-hidden="true" /> HIV status – a consent form is signed by relatives and witnesses. A line typed for the form that names HIV is
                refused too.
              </dd>
            </div>
            {privateNames.length > 0 && (
              <div>
                <dt>Private – the doctor is reminded</dt>
                <dd>{privateNames.join(', ')}: unticked by the doctor when the patient has not agreed that her relatives may know.</dd>
              </div>
            )}
            <div>
              <dt>The hospital's own risk rules</dt>
              <dd>Printed by the name the hospital gave the rule, with a line to write the complications by hand.</dd>
            </div>
          </dl>
        </section>

        <section className="card cf-wording" aria-labelledby="cf-risk-wording-title">
          <div className="cf-wording-head">
            <h2 id="cf-risk-wording-title">Wording</h2>
            <div className="segmented" role="group" aria-label="Show in">
              {PRINT_LANGUAGES.map((l) => (
                <button key={l.key} type="button" aria-pressed={lang === l.key} onClick={() => setLang(l.key)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <p className="hint help">As printed before the clauses of a consent form, English beside the translation. A patient's form shows only her own risk factors.</p>
          <div className="paper cf-paper pdoc">
            <ConsentRiskSection risk={{ section: w.section, rows: w.groups, other: '' }} lang={lang} />
          </div>
        </section>
      </div>
      {approving && (
        <ApproveDialog
          wording={w}
          onCancel={() => setApproving(false)}
          onDone={() => {
            setApproving(false);
            setFlash('Wording approved. Consent forms that carry it now print without the DRAFT label for it.');
            reload();
          }}
          onOutdated={(message) => {
            setApproving(false);
            setActionError(message);
            reload();
          }}
        />
      )}
    </>
  );
}
