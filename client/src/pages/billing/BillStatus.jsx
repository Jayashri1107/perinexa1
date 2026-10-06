// A bill's status: colour + icon + word. A negative balance means money is owed back to the patient.
import { Ban, CircleCheck, Clock, Undo2 } from 'lucide-react';

export function BillStatus({ bill }) {
  if (bill.status === 'cancelled') return <span className="badge badge-inactive"><Ban size={14} aria-hidden /> Cancelled</span>;
  if (bill.balance < 0) return <span className="badge badge-pending"><Undo2 size={14} aria-hidden /> Refund due</span>;
  if (bill.status === 'paid') return <span className="badge badge-active"><CircleCheck size={14} aria-hidden /> Paid</span>;
  return <span className="badge badge-pending"><Clock size={14} aria-hidden /> {bill.paid > 0 ? 'Part paid' : 'Unpaid'}</span>;
}
