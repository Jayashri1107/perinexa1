// Billing forms. groups, modes: the server's lists (config.billing).
import { toOptions } from '../utils/format.js';

export const priceItemFields = ({ groups, isNew }) => [
  ...(isNew ? [{ name: 'code', label: 'Code', required: true, width: 'third', help: 'Short fixed code, e.g. CONS-NEW.' }] : []),
  { name: 'name', label: 'Name', required: true, width: isNew ? 'two-thirds' : 'full' },
  { name: 'group', label: 'Group', type: 'select', required: true, options: toOptions(groups), width: 'half' },
  { name: 'price', label: 'Price (₹)', type: 'number', required: true, width: 'half' },
];
export const emptyPriceItem = (groups) => ({ code: '', name: '', group: groups[0].key, price: '' });

const needsReference = (modes) => (v) => modes.find((m) => m.key === v.mode)?.needsReference;

export const paymentFields = ({ modes }) => [
  { name: 'mode', label: 'Paid by', type: 'select', required: true, options: toOptions(modes), width: 'half' },
  { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, width: 'half' },
  { name: 'reference', label: 'Reference (transaction, card slip or claim number)', required: true, showIf: needsReference(modes) },
];

export const refundFields = ({ modes }) => [
  ...paymentFields({ modes }).map((f) => (f.name === 'mode' ? { ...f, label: 'Refunded by' } : f)),
  { name: 'reason', label: 'Reason', required: true },
];

export const discountFields = [
  { name: 'mode', label: 'Discount as', type: 'select', required: true, options: [{ value: 'amount', label: 'Amount (₹)' }, { value: 'percent', label: 'Percent (%)' }], width: 'half' },
  { name: 'value', label: 'Value', type: 'number', required: true, width: 'half', help: '0 removes the discount.' },
  { name: 'reason', label: 'Reason', help: 'Not counted on pharmacy lines, which are priced at the counter.' },
];

export const cancelFields = [{ name: 'reason', label: 'Why is this bill cancelled?', type: 'textarea', rows: 2, required: true }];

export const billingSettingsFields = [
  { name: 'upiId', label: 'UPI ID', width: 'half', placeholder: 'hospital@okbank', help: 'Payment links on bills go to this account. Leave empty for no links.' },
  { name: 'payeeName', label: 'Name registered with the UPI ID', width: 'half' },
];

export const exportFields = [
  { name: 'from', label: 'From', type: 'date', required: true, width: 'half' },
  { name: 'to', label: 'To', type: 'date', required: true, width: 'half' },
];
