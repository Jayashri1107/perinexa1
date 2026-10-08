// The bill of a given prescription in a pop-up (owner, 8 Oct 2026): the same bill as printed, with Print (opens the
// printable page) and Close.
import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dispensingApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PrescriptionBill } from '../print/PrescriptionBillPrintPage.jsx';

export function BillPopup({ billId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    dispensingApi.bill(billId).then(setData).catch((err) => setError(err.message));
  }, [billId]);

  return (
    <Modal title={data ? `Bill ${data.bill.billNumber}` : 'Bill'} onClose={onClose} size="lg">
      <Alert type="error">{error}</Alert>
      {!data && !error && <Loader />}
      {data && (
        <>
          <div className="bill-popup print-sheet">
            <PrescriptionBill data={data} signatures={false} />
          </div>
          <div className="modal-foot inline">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
            <a className="btn btn-primary" href={`/hospital/print/prescription-bill/${billId}`} target="_blank" rel="noreferrer"><Printer size={16} aria-hidden /> Print</a>
          </div>
        </>
      )}
    </Modal>
  );
}
