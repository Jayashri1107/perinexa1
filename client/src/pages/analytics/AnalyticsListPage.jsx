// The patients behind one Analytics number (doctors only). The address carries only opaque codes
// (?metric=A2&cell=c3), never a label, so the browser history never shows a diagnosis. The server works the list
// out with the same definition as the number, checks each patient again against the access rules, and records
// every page opened in the audit log (the ids of the patients on it, nothing about the number).
import { Lock } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { DataTable, TablePagination, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Avatar, StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { CARE_TYPE_SHORT, formatGestation } from '../patients/patientFormat.js';
import { RiskBadge } from '../patients/RiskCard.jsx';
import { FILTER_DEFAULTS, SECTIONS, analyticsParams, analyticsQuery, analyticsSearch, listDetailText } from './analyticsFormat.js';

const DEFAULTS = { metric: '', cell: '', back: 'overview', ...FILTER_DEFAULTS.doctor, page: 1, limit: 25 };

export function AnalyticsListPage() {
  const navigate = useNavigate();
  const [rawParams, setParams] = useListParams(DEFAULTS);
  const params = analyticsParams(rawParams, 'doctor'); // a hospital admin's period in a pasted link falls back to the default
  const back = SECTIONS.includes(params.back) ? params.back : 'overview';
  const backHref = `/analytics${back === 'overview' ? '' : `/${back}`}${analyticsSearch(params, 'doctor')}`;
  const query = { metric: params.metric, cell: params.cell, ...analyticsQuery(params, 'doctor'), page: params.page, limit: params.limit };
  const { data, error, loading } = useFetch('/analytics/list', query);

  const columns = [
    { key: 'mrn', header: 'Patient no.', width: 120, render: (p) => p.mrn },
    {
      key: 'fullName',
      header: 'Name',
      render: (p) => (
        <span className="name-cell">
          <Avatar name={p.fullName} seed={p.id} />
          <span className="name-cell-text">
            <strong className="patient-name">
              <Link to={`/patients/${p.id}`}>{p.fullName}</Link>
              {p.sensitive && (
                <StatusPill tone="brand" icon={Lock} title="Sensitive record">
                  Sensitive
                </StatusPill>
              )}
            </strong>
          </span>
        </span>
      ),
    },
    { key: 'age', header: 'Age', render: (p) => (p.currentAge != null && p.careType !== 'newborn' ? `${p.currentAge} yrs` : <span className="muted">—</span>) },
    { key: 'careType', header: 'Care', render: (p) => <StatusPill tone="neutral">{CARE_TYPE_SHORT[p.careType] ?? p.careType}</StatusPill> },
    {
      key: 'pregnancy',
      header: 'Pregnancy',
      render: (p) => {
        if (p.bornOn) return <>Born {formatDate(p.bornOn)}</>;
        if (!p.gestationalAge && !p.edd) return <span className="muted">—</span>;
        return (
          <>
            {p.gestationalAge && <strong className="ga-value">{formatGestation(p.gestationalAge)}</strong>}
            {p.edd && <div className="cell-sub">EDD {formatDate(p.edd)}</div>}
          </>
        );
      },
    },
    { key: 'risk', header: 'Risk', className: 'risk-cell', render: (p) => (p.riskLevel ? <RiskBadge level={p.riskLevel} /> : <span className="muted">—</span>) },
    { key: 'doctor', header: 'Doctor', className: 'wrap-cell', render: (p) => p.assignedDoctorName ?? <span className="muted">Not assigned</span> },
    ...(data?.detailLabel ? [{ key: 'detail', header: data.detailLabel, render: (p) => listDetailText(p.detail) }] : []),
  ];

  const subtitle = data
    ? [data.cellLabel, data.window === 'period' ? data.periodLabel : 'As of today', data.scope === 'mine' ? 'My patients' : 'Whole hospital'].filter(Boolean).join(' · ')
    : null;
  // On the Deliveries tab a number counts deliveries or babies: one row each, showing the mother – a mother of twins
  // has two rows, told apart by the last column. Each row needs its own key.
  const rows = error && !data ? [] : data?.patients?.map((p, i) => ({ ...p, rowKey: `${p.id}:${(data.page - 1) * data.limit + i}` }));
  const perEntry = Boolean(data?.patients?.some((p) => ['delivery', 'birth'].includes(p.detail?.type)));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Analytics', to: backHref }, { label: 'Patient list' }]}
        title={data?.title ?? 'Patient list'}
        documentTitle="Patient list"
        subtitle={subtitle}
      />
      <div className="pf-content an-list-page">
        <Alert type="info">Opening this list is recorded in the audit log.</Alert>
        <Alert type="error">{error}</Alert>
        {data?.restricted > 0 && (
          <p className="an-caption">{`${formatNumber(data.restricted)} more could not be listed because you can no longer open them.`}</p>
        )}
        {perEntry && <p className="an-caption">One row for each delivery or baby counted, showing the mother – a mother of twins has a row for each baby.</p>}
        <DataTable
          caption="Patients behind this number"
          columns={columns}
          rows={rows}
          rowKey="rowKey"
          loading={loading}
          onRowClick={(p) => navigate(`/patients/${p.id}`)}
          emptyText="No patients to list."
          footer={
            data && data.count > 0 && (
              <TablePagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.count}
                limit={data.limit}
                onPage={(page) => setParams({ page })}
                onLimit={(limit) => setParams({ limit })}
                label={perEntry ? 'rows' : 'patients'}
              />
            )
          }
        />
        <p>
          <Link to={backHref}>Back to Analytics</Link>
        </p>
      </div>
    </>
  );
}
