// Words and looks for lab orders and results.
import { ArrowDown, ArrowUp, Ban, CircleCheck, ClipboardList, FileCheck2, TestTube, TriangleAlert } from 'lucide-react';

const ORDER_LOOKS = {
  ordered: { tone: 'info', icon: ClipboardList, word: 'Ordered' },
  collected: { tone: 'info', icon: TestTube, word: 'Sample taken' },
  reported: { tone: 'pending', icon: FileCheck2, word: 'Results ready – to review' },
  reviewed: { tone: 'active', icon: CircleCheck, word: 'Reviewed' },
  cancelled: { tone: 'inactive', icon: Ban, word: 'Cancelled' },
};
export const orderLook = (status) => ORDER_LOOKS[status] ?? ORDER_LOOKS.ordered;

const FLAG_LOOKS = {
  low: { tone: 'danger', icon: ArrowDown, word: 'Low' },
  high: { tone: 'danger', icon: ArrowUp, word: 'High' },
  abnormal: { tone: 'danger', icon: TriangleAlert, word: 'Abnormal' },
  normal: { tone: 'active', icon: CircleCheck, word: 'Normal' },
};
export const flagLook = (flag) => FLAG_LOOKS[flag] ?? null;

// The worklist's views (the server's ?view=), with the statuses each holds.
export const LAB_VIEWS = [
  { value: 'collect', label: 'Sample to take' },
  { value: 'report', label: 'Results to enter' },
  { value: 'review', label: 'To review' },
  { value: 'done', label: 'Reviewed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// The same flag the server works out, to show it while typing.
export function flagFor(field, value) {
  if (value === '' || value == null) return '';
  if (field.type === 'number') {
    const t = String(value).trim().replace(/,/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(t)) return '';
    const n = Number(t);
    if (field.low != null && n < field.low) return 'low';
    if (field.high != null && n > field.high) return 'high';
    return field.low == null && field.high == null ? '' : 'normal';
  }
  if (field.type === 'choice') return field.abnormal?.includes(value) ? 'abnormal' : 'normal';
  return '';
}
