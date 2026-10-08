// Pieces shared by the printed bill and the printed payment receipt.
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ageText, formatDate, formatDateTime, labelOf } from '../../utils/format.js';

/** "Dr. Ram Sharma, MBBS, MD · Reg. no. 12345 (Maharashtra Medical Council)" from the doctor's own profile. */
export function doctorText(context, fallbackName) {
  const d = context?.doctor;
  if (!d) return fallbackName || '—';
  const reg = d.registrationNumber ? ` · Reg. no. ${d.registrationNumber}${d.council ? ` (${d.council})` : ''}` : '';
  return `${d.name}${d.qualification ? `, ${d.qualification}` : ''}${reg}`;
}

/** The patient, her consultant and what the bill was for (her stay, or her visit), as a two-column table. */
export function BillInfo({ bill, context, numberLabel, number, date }) {
  const { patients: patientSettings } = useAppConfig();
  const p = bill.patient ?? {};
  const stay = context?.stay;
  const rows = [
    [numberLabel, <strong key="n">{number}</strong>, 'Date', formatDateTime(date)],
    ['Patient', <strong key="p">{p.name}</strong>, 'Patient no.', p.patientNumber],
    ['Age / sex', [p.birthDate && ageText(p.birthDate, p.birthDateApprox), p.sex && labelOf(patientSettings.sexes, p.sex)].filter(Boolean).join(' / ') || '—', 'Mobile', p.phone || '—'],
    ['Consultant', doctorText(context, bill.doctorName), 'Type', context?.kind === 'ipd' ? 'Inpatient (IPD)' : 'Outpatient (OPD)'],
  ];
  if (stay) {
    rows.push(['Admission no.', stay.admissionNumber || '—', 'Ward / bed', [stay.ward, stay.bed].filter(Boolean).join(' / ') || '—']);
    rows.push(['Admitted', formatDate(stay.admittedAt), 'Discharged', stay.dischargedAt ? formatDate(stay.dischargedAt) : 'In hospital']);
  } else if (context?.visitOn) {
    rows.push(['Visit date', formatDate(context.visitOn), '', '']);
  }
  return (
    <table className="print-info">
      <tbody>
        {rows.map(([a, b, c, d], i) => (
          <tr key={i}><th>{a}</th><td>{b}</td><th>{c}</th><td>{d}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

/** Who made it and who printed it, and when (the audit trail on paper). */
export function GeneratedBy({ createdByName }) {
  const { user, roles } = useAuth();
  const { roleLabel } = useAppConfig();
  return (
    <p className="small muted">
      {createdByName && `Bill made by ${createdByName} · `}
      Printed by {user?.name}{roles?.length ? ` (${roles.map(roleLabel).join(', ')})` : ''} on {formatDateTime(new Date())} · This is a computer-generated document.
    </p>
  );
}

export function Signatures() {
  return (
    <div className="print-sign-row">
      <p className="print-sign">&nbsp;<br />Patient / attendant</p>
      <p className="print-sign">&nbsp;<br />Billing executive</p>
      <p className="print-sign">&nbsp;<br />Authorised signatory</p>
      <p className="print-sign">&nbsp;<br />Hospital stamp</p>
    </div>
  );
}
