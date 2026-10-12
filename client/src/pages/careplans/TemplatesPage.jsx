import { useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Avatar, StatusPill, formatDateTime, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { knowledgeTabs } from '../../platform/modules.js';
import { CARE_TYPE_TEMPLATE_LABELS, defaultPill, myDefaultsNotInUse, notInUseText, templateOwnerLabel } from './templateFormat.js';

// Approved = stable (check); draft = watch (triangle): it must be reviewed before clinical use.
export function TemplateStatusBadge({ template: t }) {
  return t.status === 'approved' ? (
    <StatusPill tone="stable" title={`Approved by ${t.approvedByName} on ${formatDateTime(t.approvedAt)}`}>
      Approved · v{t.version}
    </StatusPill>
  ) : (
    <StatusPill tone="watch">Draft · v{t.version}</StatusPill>
  );
}

// Whose protocol it is, and – for a doctor's default – a marker: "My default", or "Default – not in use" (a draft …).
function KindCell({ template: t, meId }) {
  const pill = defaultPill(t, meId);
  return (
    <span className="cp-kind-cell">
      <span>{templateOwnerLabel(t, meId)}</span>
      {pill && (
        <StatusPill tone={pill.tone} icon={pill.icon} title={pill.title ?? undefined}>
          {pill.word}
        </StatusPill>
      )}
    </span>
  );
}

// Approver (staff) with an initials avatar; the date and, for a changed draft, the approved version below.
function ApprovedBy({ template: t }) {
  if (!t.approvedByName) return <span className="muted">Not yet</span>;
  return (
    <span className="name-cell">
      <Avatar name={t.approvedByName} />
      <span className="name-cell-text">
        <strong>{t.approvedByName}</strong>
        <span className="muted">
          {formatDateTime(t.approvedAt)}
          {t.status === 'draft' ? ` (v${t.approvedVersion})` : ''}
        </span>
      </span>
    </span>
  );
}

export function TemplatesPage() {
  const { activeMembership, user } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading } = useFetch('/care-plans/templates');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const isDoctor = hasRole(activeMembership, 'doctor');

  const newProtocol = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const { template } = await api('/care-plans/templates', { method: 'POST', body: { careType: 'antenatal' } });
      navigate(`/care-plans/templates/${template.id}/edit`);
    } catch (err) {
      setActionError(err.message);
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Template',
      className: 'cp-col-name',
      render: (t) => (
        <Link to={`/care-plans/templates/${t.id}`} className="cp-template-link">
          {t.name}
        </Link>
      ),
    },
    { key: 'type', header: 'Care', width: 120, render: (t) => CARE_TYPE_TEMPLATE_LABELS[t.careType] },
    { key: 'owner', header: 'Kind', width: 200, render: (t) => <KindCell template={t} meId={user.id} /> },
    { key: 'status', header: 'Status', width: 150, render: (t) => <TemplateStatusBadge template={t} /> },
    { key: 'items', header: 'Items', width: 80, align: 'right', render: (t) => t.itemCount },
    // Current plans built from it (a count only): active or paused plans of records in use
    { key: 'used', header: 'Current plans', width: 120, align: 'right', render: (t) => <span className="tabular">{t.usedBy ?? 0}</span> },
    { key: 'approved', header: 'Approved by', width: 220, render: (t) => <ApprovedBy template={t} /> },
    { key: 'updated', header: 'Last changed', width: 170, render: (t) => formatDateTime(t.updatedAt) },
  ];

  const anyDraft = data?.templates.some((t) => t.kind === 'standard' && t.status === 'draft');
  // The doctor's own defaults that new plans do not use now (a draft after an edit …): said here, not only on their page
  const notInUse = myDefaultsNotInUse(data?.templates, user.id);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Clinic library', to: '/care-plans/templates' }, { label: 'Care plans' }]}
        title="Care plans"
        help="The standard schedules of visits, tests, scans, vaccinations, medicines and advice used to build each patient's care plan."
        tabs={knowledgeTabs(activeMembership.roles)}
        actions={
          isDoctor && (
            <button type="button" className="btn btn-primary" onClick={newProtocol} disabled={busy}>
              <FilePlus2 aria-hidden="true" /> New protocol
            </button>
          )
        }
      />
      <div className="pf-content">
        <Alert type="error">{error ?? actionError}</Alert>
        {anyDraft && (
          <Alert type="warning">
            <strong>The hospital standard template is a draft.</strong> It was prepared from published guidance by the software developer and has not
            been checked by a doctor. A doctor must review and approve it before it is used for patients.
          </Alert>
        )}
        {notInUse.map((t) => (
          <Alert key={t.id} type="warning">
            {notInUseText(t)} <Link to={`/care-plans/templates/${t.id}`}>Open the protocol</Link>
          </Alert>
        ))}
        <p className="hint help cp-section-hint">
          Current plans: how many patients' care plans now use each template. A doctor can make one of their own approved protocols their default: new care
          plans of the patients assigned to them then start from it instead of the hospital standard template.
        </p>
        <DataTable
          caption="Care-plan templates"
          columns={columns}
          rows={data?.templates}
          loading={loading}
          onRowClick={(t) => navigate(`/care-plans/templates/${t.id}`)}
          emptyText="No templates yet."
        />
      </div>
    </>
  );
}
