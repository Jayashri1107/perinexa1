// Words and looks for purchase orders and returns to a supplier.
import { Ban, CircleCheck, FilePen, PackageCheck, PackageOpen, Send, Undo2 } from 'lucide-react';

const ORDER_LOOKS = {
  draft: { tone: 'inactive', icon: FilePen, word: 'Draft' },
  sent: { tone: 'info', icon: Send, word: 'Sent' },
  part_received: { tone: 'pending', icon: PackageOpen, word: 'Part received' },
  received: { tone: 'active', icon: PackageCheck, word: 'Received' },
  cancelled: { tone: 'inactive', icon: Ban, word: 'Cancelled' },
};
export const orderLook = (o) => (o.closed ? { tone: 'inactive', icon: CircleCheck, word: 'Part received – closed' } : ORDER_LOOKS[o.status]);

export const RETURN_LOOKS = {
  returned: { tone: 'active', icon: Undo2, word: 'Returned' },
  cancelled: { tone: 'inactive', icon: Ban, word: 'Cancelled' },
};

export const ORDER_FILTERS = [
  { value: 'open', label: 'Open (sent, part received)' },
  { value: 'draft', label: 'Draft' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];
