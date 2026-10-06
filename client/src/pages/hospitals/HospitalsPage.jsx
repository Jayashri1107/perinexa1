import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hospitalsApi, masterDataApi } from '../../api/index.js';
import { FormModal } from '../../components/form/FormModal.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { TemporaryPasswordNotice } from '../../components/TemporaryPasswordNotice.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { emptyHospital, hospitalFields, hospitalPayload } from '../../forms/hospitalForm.js';
import { useForm } from '../../hooks/useForm.js';
import { useOptions } from '../../hooks/useOptions.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { activeStatus } from '../../utils/format.js';
import { STATUS_FILTER } from '../../utils/filters.js';

export function HospitalsPage() {
  const { hospitalDepartmentType } = useAppConfig();
  const navigate = useNavigate();
  const list = usePagedList(hospitalsApi.list);
  const departments = useOptions(useCallback(() => masterDataApi(hospitalDepartmentType).options(), [hospitalDepartmentType]));
  const form = useForm(emptyHospital);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState(null);

  const columns = [
    { key: 'code', label: 'Code', className: 'nowrap' },
    { key: 'name', label: 'Hospital', render: (h) => <strong>{h.name}</strong> },
    { key: 'city', label: 'City', render: (h) => h.address?.city || '—' },
    { key: 'departments', label: 'Departments', render: (h) => h.departments.map((d) => d.name).join(', ') || '—' },
    { key: 'staffCount', label: 'Staff', className: 'num' },
    { key: 'adminCount', label: 'Admins', className: 'num' },
    { key: 'status', label: 'Status', render: (h) => <StatusBadge status={activeStatus(h)} /> },
  ];

  const openAdd = () => {
    form.reset(emptyHospital);
    setAdding(true);
  };

  const onSubmit = async (values) => {
    const result = await hospitalsApi.create(hospitalPayload(values, true));
    setAdding(false);
    list.reload();
    if (result.admin?.temporaryPassword) setCreated(result.admin);
    else navigate(`/hospitals/${result.hospital.id}`);
  };

  return (
    <>
      <PageHeader
        title="Hospitals"
        subtitle="Every hospital on the platform, with its departments and staff"
        actions={
          <button type="button" className="btn btn-primary" onClick={openAdd}>
            <Plus size={16} aria-hidden /> Add hospital
          </button>
        }
      />
      <ListPanel
        list={list}
        columns={columns}
        searchPlaceholder="Search by name, code or city"
        filters={[STATUS_FILTER, { name: 'departmentId', label: 'Department', options: departments }]}
        emptyText="No hospitals found."
        onRowClick={(h) => navigate(`/hospitals/${h.id}`)}
      />
      {adding && (
        <FormModal
          title="Add hospital"
          size="lg"
          fields={hospitalFields({ departments, isNew: true })}
          form={form}
          onSubmit={onSubmit}
          onClose={() => setAdding(false)}
          submitLabel="Add hospital"
        />
      )}
      {created && <TemporaryPasswordNotice email={created.email} password={created.temporaryPassword} onClose={() => setCreated(null)} />}
    </>
  );
}
