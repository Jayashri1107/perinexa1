// Master data: one screen for every list in config.masterData.types, one tab per list.
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { masterDataApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormModal } from '../../components/form/FormModal.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { emptyMasterData, masterDataFields, masterDataToForm } from '../../forms/masterDataForm.js';
import { useForm } from '../../hooks/useForm.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { STATUS_FILTER } from '../../utils/filters.js';
import { activeStatus } from '../../utils/format.js';

export function MasterDataPage() {
  const { type } = useParams();
  const { masterDataTypes } = useAppConfig();
  const current = masterDataTypes.find((t) => t.key === type);
  if (!current) return <Navigate to={`/master-data/${masterDataTypes[0].key}`} replace />;
  // key: a new list starts with fresh state
  return <MasterDataList key={current.key} current={current} types={masterDataTypes} />;
}

function MasterDataList({ current, types }) {
  const api = useMemo(() => masterDataApi(current.key), [current.key]);
  const list = usePagedList(api.list);
  const form = useForm(emptyMasterData);
  const [dialog, setDialog] = useState(null); // 'add' | { item }
  const [error, setError] = useState('');

  const open = (next, values) => {
    form.reset(values);
    setDialog(next);
  };

  const save = async (values) => {
    if (dialog === 'add') await api.create(values);
    else await api.update(dialog.item.id, values);
    setDialog(null);
    list.reload();
  };

  const toggle = async (item) => {
    setError('');
    try {
      await api.setStatus(item.id, !item.isActive);
      list.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const columns = [
    { key: 'code', label: 'Code', className: 'nowrap' },
    { key: 'name', label: 'Name', render: (i) => <strong>{i.name}</strong> },
    { key: 'description', label: 'Description', render: (i) => i.description || '—' },
    { key: 'sortOrder', label: 'Order', className: 'num' },
    { key: 'status', label: 'Status', render: (i) => <StatusBadge status={activeStatus(i)} /> },
    {
      key: 'actions',
      label: '',
      className: 'actions',
      render: (i) => (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ item: i }, masterDataToForm(i))}>Edit</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(i)}>{i.isActive ? 'Deactivate' : 'Activate'}</button>
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Master data"
        subtitle="Shared lists used across the platform. Items are deactivated, never deleted."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => open('add', emptyMasterData)}>
            <Plus size={16} aria-hidden /> Add {current.singular.toLowerCase()}
          </button>
        }
      />
      <nav className="tabs" aria-label="Master data lists">
        {types.map((t) => (
          <NavLink key={t.key} to={`/master-data/${t.key}`} className="tab">{t.label}</NavLink>
        ))}
      </nav>
      <Alert type="error">{error}</Alert>
      <ListPanel list={list} columns={columns} filters={[STATUS_FILTER]} searchPlaceholder="Search by name or code" emptyText={`No ${current.label.toLowerCase()} yet.`} />
      {dialog && (
        <FormModal
          title={dialog === 'add' ? `Add ${current.singular.toLowerCase()}` : `Edit ${dialog.item.name}`}
          fields={masterDataFields({ isNew: dialog === 'add' })}
          form={form}
          onSubmit={save}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
