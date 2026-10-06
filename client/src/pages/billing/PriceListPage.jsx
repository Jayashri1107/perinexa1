// The price list: reception reads it, the hospital admin keeps it.
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { priceListApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { FormModal } from '../../components/form/FormModal.jsx';
import { ListPanel } from '../../components/list/ListPanel.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { emptyPriceItem, priceItemFields } from '../../forms/billingForms.js';
import { useForm } from '../../hooks/useForm.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { STATUS_FILTER } from '../../utils/filters.js';
import { activeStatus, formatMoney, labelOf, toOptions } from '../../utils/format.js';
import { BillingFrame } from './BillingFrame.jsx';

export function PriceListPage() {
  const { billing } = useAppConfig();
  const { canAccess } = useAuth();
  const canEdit = canAccess('billingAdmin');
  const list = usePagedList(priceListApi.list);
  const form = useForm(emptyPriceItem(billing.priceGroups));
  const [dialog, setDialog] = useState(null); // 'add' | { item }
  const [error, setError] = useState('');

  const open = (next, values) => {
    form.reset(values);
    setDialog(next);
  };
  const save = async (values) => {
    if (dialog === 'add') await priceListApi.create(values);
    else await priceListApi.update(dialog.item.id, { name: values.name, group: values.group, price: values.price });
    setDialog(null);
    list.reload();
  };
  const toggle = async (item) => {
    setError('');
    try {
      await priceListApi.setStatus(item.id, !item.isActive);
      list.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const columns = [
    { key: 'code', label: 'Code', className: 'nowrap' },
    { key: 'name', label: 'Item', render: (i) => <strong>{i.name}</strong> },
    { key: 'group', label: 'Group', render: (i) => labelOf(billing.priceGroups, i.group) },
    { key: 'price', label: 'Price', className: 'num', render: (i) => formatMoney(i.price) },
    { key: 'status', label: 'Status', render: (i) => <StatusBadge status={activeStatus(i)} /> },
    ...(canEdit
      ? [{
          key: 'actions',
          label: '',
          className: 'actions',
          render: (i) => (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ item: i }, { name: i.name, group: i.group, price: i.price })}>Edit</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(i)}>{i.isActive ? 'Deactivate' : 'Activate'}</button>
            </>
          ),
        }]
      : []),
  ];

  return (
    <BillingFrame
      subtitle={canEdit ? 'What each service costs. Bills take their prices from here.' : 'What each service costs (kept by the hospital admin).'}
      actions={canEdit && (
        <button type="button" className="btn btn-primary" onClick={() => open('add', emptyPriceItem(billing.priceGroups))}>
          <Plus size={16} aria-hidden /> Add item
        </button>
      )}
    >
      <Alert type="error">{error}</Alert>
      <ListPanel list={list} columns={columns} filters={[{ name: 'group', label: 'Group', options: toOptions(billing.priceGroups) }, STATUS_FILTER]} searchPlaceholder="Name or code" emptyText="The price list is empty." />
      {dialog && (
        <FormModal
          title={dialog === 'add' ? 'Add price list item' : `Edit ${dialog.item.name}`}
          fields={priceItemFields({ groups: billing.priceGroups, isNew: dialog === 'add' })}
          form={form}
          onSubmit={save}
          onClose={() => setDialog(null)}
        />
      )}
    </BillingFrame>
  );
}
