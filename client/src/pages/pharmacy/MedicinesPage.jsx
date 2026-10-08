import { medicinesApi } from '../../api/index.js';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { emptyMedicine, emptyNewMedicine, medicineFields, medicineValues, newMedicineFields } from '../../forms/pharmacyForms.js';
import { STATUS_FILTER } from '../../utils/filters.js';
import { labelOf, toOptions } from '../../utils/format.js';
import { SimpleListPage } from './SimpleListPage.jsx';

export function MedicinesPage() {
  const { pharmacy } = useAppConfig();
  return (
    <SimpleListPage
      api={medicinesApi}
      noun="medicine"
      subtitle="The pharmacy's medicine list"
      searchPlaceholder="Brand or generic name"
      fields={medicineFields({ pharmacy })}
      empty={emptyMedicine(pharmacy)}
      addFields={newMedicineFields({ pharmacy })}
      addEmpty={emptyNewMedicine(pharmacy)}
      valuesOf={medicineValues}
      filters={[{ name: 'schedule', label: 'Schedule', options: toOptions(pharmacy.schedules) }, STATUS_FILTER]}
      columns={[
        { key: 'name', label: 'Medicine', render: (m) => (<><strong>{m.name}</strong> {m.strength}<span className="muted block small">{m.generic}</span></>) },
        { key: 'form', label: 'Form', render: (m) => labelOf(pharmacy.forms, m.form) },
        { key: 'schedule', label: 'Schedule', render: (m) => labelOf(pharmacy.schedules, m.schedule) },
        { key: 'gstRate', label: 'GST', className: 'num', render: (m) => `${m.gstRate}%` },
        { key: 'reorderLevel', label: 'Reorder at', className: 'num' },
      ]}
    />
  );
}
