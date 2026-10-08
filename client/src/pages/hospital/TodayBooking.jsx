// The front desk's three bookings at the top of Today (owner, 8 Oct 2026):
//  + Book appointment – the appointment form opens at once (Appointments → Day, ?book=1);
//  Book lab – choose the patient, then the tests: the order goes straight to the lab's worklist ("booked by reception")
//    and her doctor is told;
//  Book ultrasound – Obstetric or Gynaecology: the appointment form opens with that visit type chosen.
import { ChevronDown, FlaskConical, Plus, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { patientsApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PatientPicker } from '../../components/PatientPicker.jsx';
import { LabOrderDialog } from '../lab/LabOrderDialog.jsx';

const searchPatients = (text) => patientsApi.list({ search: text, limit: 10, status: 'active' }).then((r) => ({ items: r.items }));
const ULTRASOUND = [
  { type: 'usg_obstetric', label: 'Obstetric', hint: 'Pregnancy scan' },
  { type: 'usg_gynaecology', label: 'Gynaecology', hint: 'Pelvic scan' },
];

function UltrasoundMenu({ onChoose }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => (e.type === 'keydown' ? e.key === 'Escape' : !box.current?.contains(e.target)) && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="book-menu" ref={box}>
      <button type="button" className="book-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="book-btn-icon tone-teal" aria-hidden><ScanLine size={20} /></span>
        <span className="book-btn-text"><strong>Book ultrasound</strong><span>Obstetric or gynaecology</span></span>
        <ChevronDown size={16} aria-hidden className="book-chevron" />
      </button>
      {open && (
        <ul className="book-menu-list" role="menu">
          {ULTRASOUND.map((u) => (
            <li key={u.type} role="none">
              <button type="button" role="menuitem" onClick={() => onChoose(u.type)}>
                <strong>{u.label}</strong>
                <span className="muted small">{u.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TodayBooking() {
  const navigate = useNavigate();
  const [labFor, setLabFor] = useState(null); // 'choose' | patient
  const [patient, setPatient] = useState(null);
  const [notice, setNotice] = useState('');

  const closeLab = () => {
    setLabFor(null);
    setPatient(null);
  };

  return (
    <>
      <div className="today-book">
        <button type="button" className="book-btn book-btn-primary" onClick={() => navigate('/hospital/appointments?book=1')}>
          <span className="book-btn-icon" aria-hidden><Plus size={20} /></span>
          <span className="book-btn-text"><strong>Book appointment</strong><span>With a doctor, any day</span></span>
        </button>
        <button type="button" className="book-btn" onClick={() => { setNotice(''); setLabFor('choose'); }}>
          <span className="book-btn-icon tone-amber" aria-hidden><FlaskConical size={20} /></span>
          <span className="book-btn-text"><strong>Book lab</strong><span>Tests go straight to the lab</span></span>
        </button>
        <UltrasoundMenu onChoose={(type) => navigate(`/hospital/appointments?book=1&type=${type}`)} />
      </div>
      <Alert type="success">{notice}</Alert>

      {labFor === 'choose' && (
        <Modal title="Book lab tests – choose the patient" onClose={closeLab}>
          <PatientPicker search={searchPatients} value={patient} onChange={setPatient} />
          <div className="modal-foot inline">
            <button type="button" className="btn btn-ghost" onClick={closeLab}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!patient} onClick={() => setLabFor(patient)}>Choose tests</button>
          </div>
        </Modal>
      )}
      {labFor && labFor !== 'choose' && (
        <LabOrderDialog
          reception
          patient={labFor}
          who={labFor.careType === 'newborn' ? 'newborn' : 'adult'}
          onClose={closeLab}
          onBooked={(r) => {
            setNotice(`Booked ${r.order.orderNumber} for ${r.patient.name} (${r.patient.patientNumber}): ${r.order.tests.join(', ')}. It is on the lab's list.`);
            closeLab();
          }}
        />
      )}
    </>
  );
}
