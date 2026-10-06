import { CircleCheck, Undo2 } from 'lucide-react';

export function SaleStatus({ sale }) {
  if (sale.status === 'completed') return <span className="badge badge-active"><CircleCheck size={14} aria-hidden /> Completed</span>;
  return <span className="badge badge-pending"><Undo2 size={14} aria-hidden /> {sale.status === 'returned' ? 'Returned' : 'Part returned'}</span>;
}
