import { useFetch } from '../hooks/useFetch.js';
import { useListParams } from '../hooks/useListParams.js';
import { AUDIT_LABELS, auditPill, describeAudit, doneBy } from './auditFormat.js';
import { ClearFilters, DataTable, DateFilter, FilterSelect, SearchInput, TablePagination } from './DataTable.jsx';
import { Alert, StatusPill, formatDateTime } from './ui.jsx';

const DEFAULTS = { search: '', category: '', action: '', tenant: '', from: '', to: '', page: 1, limit: 25 };
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Dates are picked in the viewer's own time zone and sent to the server as exact moments.
const startOfDay = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const endOfDay = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

/**
 * Audit log table.
 * - endpoint: "/platform/audit-logs" (everything) or "/tenant/audit-logs" (one hospital)
 * - category: fixed event group ("security", "access", "sessions", "patients")
 * - categories: [{ value, label }] – instead of a fixed one, a "Type" filter to choose the group (the audit log pages)
 * - tenantId / userId: fixed filters (e.g. on a hospital's or a person's Activity tab)
 * - showHospital: show the Hospital column and filter
 */
export function AuditLogView({ endpoint, category: fixedCategory = '', categories = null, tenantId = '', userId = '', showHospital = false }) {
  const [params, setParams, reset] = useListParams(DEFAULTS);
  const category = fixedCategory || (categories?.some((c) => c.value === params.category) ? params.category : '');
  const hospitals = useFetch(showHospital && !tenantId ? '/platform/tenants' : null, { limit: 100, sort: 'name' });

  const { data, error, loading } = useFetch(endpoint, {
    category,
    userId,
    tenantId: tenantId || params.tenant,
    action: params.action,
    search: params.search,
    from: startOfDay(params.from),
    to: endOfDay(params.to),
    page: params.page,
    limit: params.limit,
  });

  const hospitalColumn = showHospital && !tenantId;
  const columns = [
    { key: 'when', header: 'When', width: 180, render: (e) => <span className="nowrap tabular">{formatDateTime(e.createdAt)}</span> },
    {
      key: 'event',
      header: 'Event',
      // Colour + icon + word; only events that need attention get a status colour (see auditPill).
      render: (e) => <StatusPill {...auditPill(e.action)}>{AUDIT_LABELS[e.action] ?? e.action}</StatusPill>,
    },
    ...(hospitalColumn ? [{ key: 'hospital', header: 'Hospital', render: (e) => e.tenantName ?? <span className="muted">Platform</span> }] : []),
    { key: 'actor', header: 'Done by', render: (e) => doneBy(e) ?? <span className="muted">Unknown</span> },
    { key: 'target', header: 'Affected user', render: (e) => e.targetEmail ?? <span className="muted">—</span> },
    { key: 'details', header: 'Details', className: 'wrap', render: (e) => describeAudit(e) || <span className="muted">—</span> },
    { key: 'ip', header: 'IP address', render: (e) => <span className="muted tabular">{e.ip ?? '—'}</span> },
  ];

  const filtered = params.search || category !== fixedCategory || params.action || params.tenant || params.from || params.to;

  return (
    <>
      <Alert type="error">{error && `Couldn't load the audit log. ${error}`}</Alert>
      <DataTable
        caption="Audit log"
        columns={columns}
        rows={data?.entries}
        loading={loading}
        emptyText={filtered ? 'No events match these filters.' : 'No events recorded yet.'}
        toolbar={
          <>
            <SearchInput value={params.search} onChange={(search) => setParams({ search })} placeholder="Search by email…" label="Search by email" />
            {categories && (
              <FilterSelect label="Type" value={category} onChange={(c) => setParams({ category: c, action: '' })} allLabel="All types" options={categories} />
            )}
            <FilterSelect
              label="Event"
              value={params.action}
              onChange={(action) => setParams({ action })}
              allLabel="All events"
              options={(data?.actions ?? []).map((a) => ({ value: a, label: AUDIT_LABELS[a] ?? a }))}
            />
            {hospitalColumn && (
              <FilterSelect
                label="Hospital"
                value={params.tenant}
                onChange={(tenant) => setParams({ tenant })}
                allLabel="All hospitals"
                options={(hospitals.data?.tenants ?? []).map((t) => ({ value: t.id, label: t.name }))}
              />
            )}
            <DateFilter label="From" value={params.from} max={params.to || today()} onChange={(from) => setParams({ from })} />
            <DateFilter label="To" value={params.to} min={params.from} max={today()} onChange={(to) => setParams({ to })} />
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
              label="events"
            />
          )
        }
      />
    </>
  );
}
