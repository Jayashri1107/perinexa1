import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClearFilters, DataTable, FilterSelect, SearchInput, TablePagination } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, formatDateTime } from '../../components/ui.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { platformTabs } from '../../platform/modules.js';
import { CARE_TYPE_LABELS } from '../patients/patientFormat.js';

// Patients of every hospital (owner, 24 Oct 2026): identity only – name, patient number, hospital, type of care, who
// added her and when. Opening one opens her hospital first, so her record is seen and audited there as before.
// Super admins only (server: routes/platformPatients.js).

const DEFAULTS = { search: '', tenantId: '', careType: '', sort: '-createdAt', page: 1, limit: 25 };

export function PlatformPatientsPage() {
  const { platform, openHospital } = useAuth();
  const navigate = useNavigate();
  const [params, setParams, reset] = useListParams(DEFAULTS);
  const { data, error, loading } = useFetch('/platform/patients', params);
  const [openError, setOpenError] = useState(null);

  const open = async (p) => {
    setOpenError(null);
    try {
      await openHospital(p.tenantId);
      navigate(`/patients/${p.id}`);
    } catch (err) {
      setOpenError(err.message);
    }
  };

  const columns = [
    { key: 'fullName', header: 'Patient', sortKey: 'fullName', render: (p) => <span className="strong-name">{p.fullName}</span> },
    { key: 'mrn', header: 'Patient number', sortKey: 'mrn', width: 140, render: (p) => <span className="tabular">{p.mrn}</span> },
    { key: 'hospital', header: 'Hospital', render: (p) => p.hospital },
    { key: 'careType', header: 'Type of care', width: 170, render: (p) => CARE_TYPE_LABELS[p.careType] ?? p.careType },
    { key: 'addedBy', header: 'Added by', render: (p) => p.addedBy || '–' },
    { key: 'createdAt', header: 'Added', sortKey: 'createdAt', sortFirst: 'desc', width: 180, render: (p) => <span className="nowrap">{formatDateTime(p.createdAt)}</span> },
  ];
  const filtered = params.search || params.tenantId || params.careType;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Patients', to: '/platform/patients' }]}
        title="Patients"
        help="Every hospital's patients: name, number, hospital, type of care and who added her. Opening one opens her hospital; each list and record seen is in that hospital's audit log."
        tabs={platformTabs('patients', platform)}
      />
      <div className="pf-content">
        <Alert type="error">{error ?? openError}</Alert>
        <DataTable
          caption="Patients of every hospital"
          columns={columns}
          rows={data?.patients}
          loading={loading}
          sort={params.sort}
          onSort={(sort) => setParams({ sort })}
          onRowClick={open}
          emptyText={filtered ? 'No patients match these filters.' : 'No patients registered in any hospital yet.'}
          toolbar={
            <>
              <SearchInput value={params.search} onChange={(search) => setParams({ search })} placeholder="Name or patient number…" label="Search patients" />
              <FilterSelect
                label="Hospital"
                value={params.tenantId}
                onChange={(tenantId) => setParams({ tenantId })}
                allLabel="All hospitals"
                options={(data?.hospitals ?? []).map((h) => ({ value: h.id, label: h.name }))}
              />
              <FilterSelect
                label="Type of care"
                value={params.careType}
                onChange={(careType) => setParams({ careType })}
                allLabel="Any type of care"
                options={Object.entries(CARE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
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
                label="patients"
              />
            )
          }
        />
      </div>
    </>
  );
}
