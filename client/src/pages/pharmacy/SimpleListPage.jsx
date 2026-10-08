// A pharmacy list with add / edit / activate in a dialog (Medicines, Suppliers). Only the pharmacist edits.
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../components/Alert.jsx';
import { FormModal } from '../../components/form/FormModal.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useForm } from '../../hooks/useForm.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { activeStatus } from '../../utils/format.js';
import { PharmacyFrame } from './PharmacyFrame.jsx';

// addFields / addEmpty: a different form when adding (e.g. a new medicine with its opening stock)
export function SimpleListPage({ api, subtitle, noun, columns, filters, fields, empty, valuesOf, searchPlaceholder, addFields = fields, addEmpty = empty }) {
  const { canAccess } = useAuth();
  const canEdit = canAccess('pharmacyCounter');
  const list = usePagedList(api.list);
  const form = useForm(empty);
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

  const allColumns = [
    ...columns,
    { key: 'status', label: 'Status', render: (i) => <StatusBadge status={activeStatus(i)} /> },
    ...(canEdit
      ? [{
          key: 'actions',
          label: '',
          className: 'actions',
          render: (i) => (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ item: i }, valuesOf(i))}>Edit</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(i)}>{i.isActive ? 'Deactivate' : 'Activate'}</button>
            </>
          ),
        }]
      : []),
  ];

  return (
    <PharmacyFrame
      subtitle={subtitle}
      actions={canEdit && (
        <button type="button" className="btn btn-primary" onClick={() => open('add', addEmpty)}>
          <Plus size={16} aria-hidden /> Add {noun}
        </button>
      )}
    >
      <Alert type="error">{error}</Alert>
      <ListPanel list={list} columns={allColumns} filters={filters} searchPlaceholder={searchPlaceholder} emptyText={`No ${noun}s yet.`} />
      {dialog && (
        <FormModal title={dialog === 'add' ? `Add ${noun}` : `Edit ${dialog.item.name}`} size="lg" fields={dialog === 'add' ? addFields : fields} form={form} onSubmit={save} onClose={() => setDialog(null)} />
      )}
    </PharmacyFrame>
  );
}
