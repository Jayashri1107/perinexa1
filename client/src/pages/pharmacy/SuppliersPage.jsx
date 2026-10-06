import { suppliersApi } from '../../api/index.js';
import { emptySupplier, supplierFields, supplierValues } from '../../forms/pharmacyForms.js';
import { STATUS_FILTER } from '../../utils/filters.js';
import { SimpleListPage } from './SimpleListPage.jsx';

export function SuppliersPage() {
  return (
    <SimpleListPage
      api={suppliersApi}
      noun="supplier"
      subtitle="Who the pharmacy buys from"
      searchPlaceholder="Name or GSTIN"
      fields={supplierFields}
      empty={emptySupplier}
      valuesOf={supplierValues}
      filters={[STATUS_FILTER]}
      columns={[
        { key: 'name', label: 'Supplier', render: (s) => <strong>{s.name}</strong> },
        { key: 'gstin', label: 'GSTIN', render: (s) => s.gstin || '—' },
        { key: 'drugLicence', label: 'Drug licence', render: (s) => s.drugLicence || '—' },
        { key: 'phone', label: 'Phone', render: (s) => s.phone || '—' },
      ]}
    />
  );
}
