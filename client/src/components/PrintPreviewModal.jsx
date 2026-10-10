import { Printer } from 'lucide-react';
import { useRef } from 'react';
import { Modal } from './Modal.jsx';

// A printout in a pop-up (owner, 10 Oct 2026): the print page (e.g. /hospital/print/discharge-card/:id) shown inside the
// page instead of a new tab, with Print (the browser's print dialog for just that sheet – also "Save as PDF") and Close.
// The print page sees it is inside a pop-up and does not open the print dialog by itself (PrintFrame).
export function PrintPreviewModal({ title, src, onClose }) {
  const frame = useRef(null);
  const print = () => frame.current?.contentWindow?.print();
  return (
    <Modal
      title={title}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={print}><Printer size={16} aria-hidden /> Print</button>
        </>
      }
    >
      <iframe ref={frame} src={src} title={title} className="print-preview" />
    </Modal>
  );
}
