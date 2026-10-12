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
import { packageWhen, testDef } from './labFormat.js';
import { PackageStatus, WHO_WORDS } from './TestPackagesPage.jsx';

// One test package: its tests, and for doctors: edit, copy, approve, and stop or start using it.

function ApproveDialog({ pkg, onDone, onOutdated, onCancel }) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const ref = useDialogFocus(onCancel);
  const approve = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/lab-packages/${pkg.id}/approve`, { method: 'POST', body: { confirm: confirmed, version: pkg.version } });
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
      if (err.status === 409) onOutdated(err.message);
    }
  };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="pkg-approve-title" onSubmit={approve}>
        <h2 id="pkg-approve-title">Approve for use in the hospital</h2>
        <p>
          You are approving <strong>{pkg.name}</strong> (version {pkg.version}).
        </p>
        <Alert type="error">{error}</Alert>
        <label className="checkbox">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            I am a doctor. I have checked the tests in this package{pkg.who === 'newborn' ? ' and the days of life it is offered for' : ''}, and I approve it for
            use in our hospital. The doctor ordering it still decides which tests each patient needs.
          </span>
        </label>
        <div className="row cp-dialog-actions">
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-positive" disabled={!confirmed || saving}>
            <CircleCheck aria-hidden="true" /> {saving ? 'Approving…' : 'Approve package'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function TestPackagePage() {
  const { activeMembership } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, error, reload } = useFetch(`/lab-packages/${id}`);
  const catalogue = useFetch('/lab/tests');
  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [actionError, setActionError] = useState(null);
  const [approving, setApproving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const p = data?.package;
  const crumbs = (last) => [KNOWLEDGE_CRUMB, { label: 'Test packages', to: '/test-packages' }, { label: last }];

  if (error && !p) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs('Not found')} title="Package not found" />
        <div className="pf-content">
          <div className="card narrow">
            <Alert type="error">{error}</Alert>
            <p>
              <Link to="/test-packages">Back to test packages</Link>
            </p>
          </div>
        </div>
      </>
    );
  }
  if (!p) return <FullPageSpinner />;

  const copy = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api('/lab-packages', { method: 'POST', body: { copyFrom: p.id } });
      navigate(`/test-packages/${res.package.id}`, { state: { flash: 'A copy was made as a new draft package. Change it as needed, then approve it.' } });
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const setActive = async (active) => {
    if (!active) {
      const ok = await confirm({
        title: `Stop using ${p.name}?`,
        text: 'It will no longer be offered when ordering tests. It is kept and can be used again later. Orders made from it do not change.',
        confirmLabel: 'Stop using',
      });
      if (!ok) return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api(`/lab-packages/${p.id}/active`, { method: 'PATCH', body: { active } });
      setFlash(active ? 'The package is in use again.' : 'The package is no longer offered when ordering tests.');
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
        breadcrumbs={crumbs(p.name)}
        title={p.name}
        badges={<PackageStatus pkg={p} />}
        tabs={knowledgeTabs(activeMembership.roles)}
        actions={
          p.canEdit && (
            <>
              {p.canApprove && p.status === 'draft' && p.isActive && (
                <button type="button" className="btn btn-positive" onClick={() => setApproving(true)}>
                  <CircleCheck aria-hidden="true" /> Approve
                </button>
              )}
              <Link to={`/test-packages/${p.id}/edit`} className="btn btn-secondary">
                <Pencil aria-hidden="true" /> Edit
              </Link>
              <button type="button" className="btn btn-secondary" onClick={copy} disabled={busy}>
                <Copy aria-hidden="true" /> Copy
              </button>
              {p.isActive ? (
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
        {p.status === 'draft' && (
          <Alert type="warning">
            <strong>Draft – not approved yet.</strong>{' '}
            {p.origin === 'built_in' && p.version === 1 ? 'The software developer prepared this package from published guidance; no doctor has checked it. ' : ''}
            A doctor checks the tests, then approves it.
          </Alert>
        )}
        <section className="card">
          <dl className="details">
            <div>
              <dt>For</dt>
              <dd>{WHO_WORDS[p.who]}</dd>
            </div>
            {p.who === 'newborn' && (
              <div>
                <dt>Day of life</dt>
                <dd>{packageWhen(p)} (the day of birth is day 0)</dd>
              </div>
            )}
            <div>
              <dt>Which patients</dt>
              <dd>{p.forWhom || (p.who === 'newborn' ? 'Every baby' : 'Every patient')}</dd>
            </div>
            <div>
              <dt>Approved</dt>
              <dd>{p.approvedByName ? `${p.approvedByName}, ${formatDateTime(p.approvedAt)} (version ${p.approvedVersion})${p.status === 'draft' ? ' – changed since' : ''}` : 'Not yet'}</dd>
            </div>
            <div>
              <dt>Last changed</dt>
              <dd>
                {formatDateTime(p.updatedAt)}
                {p.updatedByName ? ` by ${p.updatedByName}` : ''}
              </dd>
            </div>
            {p.about && (
              <div>
                <dt>Notes for doctors</dt>
                <dd className="pre-line">{p.about}</dd>
              </div>
            )}
          </dl>
        </section>
        <section className="card" aria-labelledby="pkg-tests-title">
          <h2 id="pkg-tests-title">Tests ({p.tests.length})</h2>
          <ul className="plain-list lab-package-tests">
            {p.tests.map((k) => {
              const t = testDef(catalogue.data, k);
              return (
                <li key={k}>
                  <strong>{t?.name ?? k}</strong>
                  {t?.sample && <span className="t-caption muted"> – {t.sample}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      {approving && (
        <ApproveDialog
          pkg={p}
          onCancel={() => setApproving(false)}
          onDone={() => {
            setApproving(false);
            setFlash('Package approved. It is no longer marked as a draft when ordering tests.');
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
