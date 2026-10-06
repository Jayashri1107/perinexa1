import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hospitalsApi, masterDataApi } from '../../api/index.js';
import { FormModal } from '../../components/form/FormModal.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SectionTabs } from '../../components/SectionTabs.jsx';
import { HOSPITALS_TABS } from '../../config/navigation.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { TemporaryPasswordNotice } from '../../components/TemporaryPasswordNotice.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { emptyHospital, hospitalFields, hospitalPayload } from '../../forms/hospitalForm.js';
import { useForm } from '../../hooks/useForm.js';
import { useOptions } from '../../hooks/useOptions.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { activeStatus } from '../../utils/format.js';
import { STATUS_FILTER } from '../../utils/filters.js';

// startAdding: opened as the "New hospital" tab – the add dialog opens at once.
export function HospitalsPage({ startAdding = false }) {
  const { hospitalDepartmentType } = useAppConfig();
  const navigate = useNavigate();
  const list = usePagedList(hospitalsApi.list);
  const departments = useOptions(useCallback(() => masterDataApi(hospitalDepartmentType).options(), [hospitalDepartmentType]));
  const form = useForm(emptyHospital);
  const [adding, setAdding] = useState(startAdding);
  const closeAdd = () => {
    setAdding(false);
    if (startAdding) navigate('/hospitals');
  };
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
    closeAdd();
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
      <SectionTabs tabs={HOSPITALS_TABS} label="Hospitals" />
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
          onClose={closeAdd}
          submitLabel="Add hospital"
        />
      )}
      {created && <TemporaryPasswordNotice email={created.email} password={created.temporaryPassword} onClose={() => setCreated(null)} />}
    </>
  );
}
