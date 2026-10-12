import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { ClearFilters, DataTable, FilterSelect, SearchInput, TablePagination, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { moduleByKey } from '../../platform/modules.js';

const DEFAULTS = { search: '', status: '', sort: 'name', page: 1, limit: 25 };
const crumbs = [{ label: 'Hospitals', to: '/platform/hospitals' }];

export function HospitalsListPage() {
  const navigate = useNavigate();
  const [params, setParams, reset] = useListParams(DEFAULTS);
  const { data, error, loading } = useFetch('/platform/tenants', params);

  const columns = [
    { key: 'name', header: 'Hospital', sortKey: 'name', render: (t) => <Link to={`/platform/hospitals/${t.id}`} className="plat-name-link">{t.name}</Link> },
    {
      key: 'status',
      header: 'Status',
      width: 140,
      render: (t) => (t.isActive ? <StatusPill tone="stable">Active</StatusPill> : <StatusPill tone="inactive">Deactivated</StatusPill>),
    },
    { key: 'members', header: 'Active staff', align: 'right', width: 120, render: (t) => formatNumber(t.members) },
    {
      key: 'admins',
      header: 'Admins',
      align: 'right',
      width: 130,
      render: (t) => (t.admins === 0 && t.isActive ? <StatusPill tone="watch">No admin</StatusPill> : formatNumber(t.admins)), // a deactivated hospital needs no admin
    },
    { key: 'createdAt', header: 'Created', sortKey: 'createdAt', sortFirst: 'desc', width: 180, render: (t) => <span className="nowrap">{formatDateTime(t.createdAt)}</span> },
  ];

  const filtered = params.search || params.status;

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title="Hospitals"
        help="Each hospital's data is kept completely separate from the others."
        tabs={moduleByKey('hospitals').tabs}
        actions={
          <Link to="/platform/hospitals/new" className="btn btn-primary">
            <Plus aria-hidden="true" /> New hospital
          </Link>
        }
      />
      <div className="pf-content">
        <Alert type="error">{error}</Alert>
        <DataTable
          caption="Hospitals"
          columns={columns}
          rows={data?.tenants}
          loading={loading}
          sort={params.sort}
          onSort={(sort) => setParams({ sort })}
          onRowClick={(t) => navigate(`/platform/hospitals/${t.id}`)}
          rowClassName={(t) => (t.isActive ? '' : 'row-inactive')}
          emptyText={filtered ? 'No hospitals match these filters.' : 'No hospitals yet. Create the first one with "New hospital".'}
          toolbar={
            <>
              <SearchInput value={params.search} onChange={(search) => setParams({ search })} placeholder="Search hospitals…" label="Search hospitals" />
              <FilterSelect
                label="Status"
                value={params.status}
                onChange={(status) => setParams({ status })}
                allLabel="Any status"
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Deactivated' },
                ]}
              />
              <ClearFilters show={Boolean(filtered)} onClick={reset} />
            </>
          }
          footer={
            data && (
              <TablePagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                limit={data.limit}
                onPage={(page) => setParams({ page })}
                onLimit={(limit) => setParams({ limit })}
                label="hospitals"
              />
            )
          }
        />
      </div>
    </>
  );
}

export function HospitalNewPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { tenant } = await api('/platform/tenants', { method: 'POST', body: { name } });
      navigate(`/platform/hospitals/${tenant.id}/staff`, {
        state: { flash: `${tenant.name} was created. Next, add its first admin with "Add person".` },
      });
    } catch (err) {
      setError(err.fields?.name ?? err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader breadcrumbs={[...crumbs, { label: 'New hospital' }]} title="New hospital" tabs={moduleByKey('hospitals').tabs} />
      <div className="pf-content">
        <form className="card form-card" onSubmit={onSubmit} noValidate>
          <h2>Hospital details</h2>
          <p className="hint help">After creating the hospital you'll add its first admin, who can then manage the hospital's own staff.</p>
          <Field label="Hospital name" id="hospital-name" error={error} hint="Must be unique. You can rename it later.">
            <input id="hospital-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside Demo Hospital" maxLength={150} autoFocus />
          </Field>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={submitting || !name.trim()}>
              {submitting ? 'Creating…' : 'Create hospital'}
            </button>
            <Link to="/platform/hospitals" className="btn btn-link">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
