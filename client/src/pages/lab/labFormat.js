// Words and looks for lab orders and results.
import { ArrowDown, ArrowUp, Ban, CircleCheck, ClipboardList, FileCheck2, FlaskConical, PackageCheck, RotateCcw, TestTube, Truck, TriangleAlert } from 'lucide-react';

const ORDER_LOOKS = {
  ordered: { tone: 'info', icon: ClipboardList, word: 'Ordered' },
  collected: { tone: 'info', icon: TestTube, word: 'Sample taken' },
  reported: { tone: 'pending', icon: FileCheck2, word: 'Results ready – to review' },
  reviewed: { tone: 'active', icon: CircleCheck, word: 'Reviewed' },
  cancelled: { tone: 'inactive', icon: Ban, word: 'Cancelled' },
};
export const orderLook = (status) => ORDER_LOOKS[status] ?? ORDER_LOOKS.ordered;

// Where an order is in the lab (owner, 9 Oct 2026): a new sample needed after a rejection, a sample on its way from the
// ward, received and waiting, the test in progress, results waiting for the doctor's verification, finalized.
export function stageLook(o) {
  if (o.status === 'ordered' && o.recollect) return { tone: 'danger', icon: RotateCcw, word: 'New sample needed' };
  if (o.status === 'ordered') return { tone: 'info', icon: ClipboardList, word: 'Sample to take' };
  if (o.status === 'collected' && o.inProgress) return { tone: 'info', icon: FlaskConical, word: 'In progress' };
  if (o.status === 'collected' && !o.received) return { tone: 'pending', icon: Truck, word: 'On its way to the lab' };
  if (o.status === 'collected') return { tone: 'pending', icon: PackageCheck, word: 'Received – to start' };
  if (o.status === 'reported') return { tone: 'pending', icon: FileCheck2, word: 'Awaiting verification' };
  if (o.status === 'reviewed') return { tone: 'active', icon: CircleCheck, word: 'Finalized' };
  return orderLook(o.status);
}

const FLAG_LOOKS = {
  low: { tone: 'danger', icon: ArrowDown, word: 'Low' },
  high: { tone: 'danger', icon: ArrowUp, word: 'High' },
  abnormal: { tone: 'danger', icon: TriangleAlert, word: 'Abnormal' },
  normal: { tone: 'active', icon: CircleCheck, word: 'Normal' },
};
export const flagLook = (flag) => FLAG_LOOKS[flag] ?? null;

// The worklist's views (the server's ?view=), with the statuses each holds.
export const LAB_VIEWS = [
  { value: 'collect', label: 'Requests', icon: ClipboardList },
  { value: 'received', label: 'Sample tracking', icon: TestTube },
  { value: 'processing', label: 'In progress', icon: FlaskConical },
  { value: 'review', label: 'Awaiting verification', icon: FileCheck2 },
  { value: 'done', label: 'Finalized', icon: CircleCheck },
  { value: 'cancelled', label: 'Cancelled', icon: Ban },
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
