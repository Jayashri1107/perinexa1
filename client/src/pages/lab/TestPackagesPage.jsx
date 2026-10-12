import { CircleMinus, FilePlus2, TriangleAlert } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { knowledgeTabs } from '../../platform/modules.js';
import { packageWhen } from './labFormat.js';

// The hospital's test packages (Clinic library › Test packages): ready-made sets of lab tests ordered together on a
// patient's Lab tab – baby packages by day of life, and packages for adults (mostly the mother). Doctors, RMOs and
// nurses read them; doctors add, edit, copy, approve and stop using packages.

export const WHO_WORDS = { newborn: 'Baby', adult: 'Adult (mother)' };

/** Approved = stable; draft = watch: a doctor must check the tests before it is used without the draft label. */
export function PackageStatus({ pkg }) {
  return (
    <span className="row">
      {pkg.status === 'approved' ? (
        <StatusPill tone="stable" title={pkg.approvedByName ? `Approved by ${pkg.approvedByName} on ${formatDateTime(pkg.approvedAt)}` : undefined}>
          Approved · v{pkg.version}
        </StatusPill>
      ) : (
        <StatusPill tone="watch" icon={TriangleAlert}>
          Draft · v{pkg.version}
        </StatusPill>
      )}
      {!pkg.isActive && (
        <StatusPill tone="inactive" icon={CircleMinus}>
          Not in use
        </StatusPill>
      )}
    </span>
  );
}

export function TestPackagesPage() {
  const { activeMembership } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading } = useFetch('/lab-packages');

  const columns = [
    {
      key: 'name',
      header: 'Package',
      render: (p) => (
        <span className="name-cell-text">
          <Link to={`/test-packages/${p.id}`} className="cp-template-link">
            {p.name}
          </Link>
          {p.forWhom && <span className="t-caption muted">{p.forWhom}</span>}
        </span>
      ),
    },
    { key: 'who', header: 'For', width: 140, render: (p) => WHO_WORDS[p.who] ?? p.who },
    { key: 'when', header: 'Day of life', width: 130, render: (p) => packageWhen(p) || '—' },
    { key: 'tests', header: 'Tests', width: 90, className: 'tabular', render: (p) => p.tests.length },
    { key: 'status', header: 'Status', width: 210, render: (p) => <PackageStatus pkg={p} /> },
    { key: 'updated', header: 'Last changed', width: 160, render: (p) => formatDateTime(p.updatedAt) },
  ];
  const anyDraft = data?.packages.some((p) => p.isActive && p.status === 'draft');

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Clinic library', to: '/care-plans/templates' }, { label: 'Test packages' }]}
        title="Test packages"
        help="Ready-made sets of lab tests. On a patient's Lab tab, Order tests offers the packages for that patient – for a baby, those that fit the day of life first."
        tabs={knowledgeTabs(activeMembership.roles)}
        actions={
          data?.canEdit && (
            <Link to="/test-packages/new" className="btn btn-primary">
              <FilePlus2 aria-hidden="true" /> New package
            </Link>
          )
        }
      />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        {anyDraft && (
          <Alert type="warning">
            <strong>Draft packages have not been checked by a doctor.</strong> The built-in packages were prepared by the software developer from published
            guidance. A doctor checks the tests and the days of life, then approves each package. A draft is marked as a draft in the order form.
          </Alert>
        )}
        <DataTable
          caption="Test packages"
          columns={columns}
          rows={data?.packages}
          loading={loading}
          onRowClick={(p) => navigate(`/test-packages/${p.id}`)}
          rowClassName={(p) => (p.isActive ? '' : 'row-inactive')}
          emptyText="No test packages yet."
        />
      </div>
    </>
  );
}
