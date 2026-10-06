export const masterDataFields = ({ isNew }) => [
  ...(isNew ? [{ name: 'code', label: 'Code', required: true, width: 'third', help: 'Short fixed code. Cannot be changed later.' }] : []),
  { name: 'name', label: 'Name', required: true, width: isNew ? 'two-thirds' : 'full' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'sortOrder', label: 'Order in lists', type: 'number', width: 'third', help: 'Lower numbers come first.' },
];

export const emptyMasterData = { code: '', name: '', description: '', sortOrder: 0 };

export const masterDataToForm = (item) => ({ name: item.name, description: item.description ?? '', sortOrder: item.sortOrder ?? 0 });
