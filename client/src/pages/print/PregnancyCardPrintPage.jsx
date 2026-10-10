// The pregnancy card for the patient to keep (owner, 10 Oct 2026): A4 with the hospital's letterhead, PREGNANCY CARD;
// name, age, Reg. No., blood group, G / P, LMP, EDD and weeks on the day printed; her scans and vaccinations with when
// they are due, their dates and the day each was done (blank to write in by hand otherwise); and a line to bring the
// card to every visit. Items the doctor decides on ("only if twins" …) show what they depend on; items that do not
// apply to her are left out. Marked DRAFT while the antenatal care plan is not approved. No fetal-sex information
// exists to print (PC-PNDT).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { pregnancyApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { ageText, formatDate } from '../../utils/format.js';
import { onlyWhenText, weeksText, whenText } from '../pregnancy/pregnancyFormat.js';
import { DocTitle, Letterhead, PrintFrame } from './PrintFrame.jsx';

const KINDS = [
  ['scan', 'SCANS (SONOGRAPHY)'],
  ['vaccination', 'VACCINATIONS'],
];
const HIDDEN = ['not_applicable', 'not_needed'];

export function PregnancyCardPrintPage() {
  const { patientId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    pregnancyApi.card(patientId).then(setData).catch((err) => setError(err.message));
  }, [patientId]);
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { patient: p, print } = data;
  const gp = p.gravida != null ? `G${p.gravida}${p.para != null ? ` P${p.para}` : ''}` : '—';

  return (
    <PrintFrame ready title={`Pregnancy_Card_${p.patientNumber}`} footer={print.letterhead?.footer} size="A4">
      <Letterhead letterhead={print.letterhead} hospitalName={print.hospitalName} />
      <DocTitle right={data.draft ? 'DRAFT' : formatDate(new Date())}>PREGNANCY CARD</DocTitle>

      <table className="print-table">
        <tbody>
          <tr>
            <th scope="row">Name</th><td><strong>{p.name}</strong></td>
            <th scope="row">Age</th><td>{p.birthDate ? ageText(p.birthDate, p.birthDateApprox) : '—'}</td>
          </tr>
          <tr>
            <th scope="row">Reg. No.</th><td>{p.patientNumber}</td>
            <th scope="row">Blood group</th><td>{p.bloodGroup || '—'}</td>
          </tr>
          <tr>
            <th scope="row">LMP</th><td>{p.lmp ? formatDate(p.lmp) : '—'}</td>
            <th scope="row">G / P</th><td>{gp}</td>
          </tr>
          <tr>
            <th scope="row">EDD</th><td><strong>{p.edd ? formatDate(p.edd) : '—'}</strong></td>
            <th scope="row">Weeks on {formatDate(new Date())}</th><td>{weeksText(data.weeksToday)}</td>
          </tr>
        </tbody>
      </table>

      {KINDS.map(([kind, title]) => {
        const rows = data.items.filter((i) => i.kind === kind && !HIDDEN.includes(i.status));
        if (!rows.length) return null;
        return (
          <section key={kind} className="top-gap-sm">
            <h3>{title}</h3>
            <table className="print-table">
              <thead>
                <tr><th>{kind === 'scan' ? 'Scan' : 'Vaccine'}</th><th>When</th><th>Due between</th><th>Done on</th></tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.key}>
                    <td>{i.patientText || i.name}{onlyWhenText(i) && <span className="block small">Only {onlyWhenText(i)}</span>}</td>
                    <td>{whenText(i, data.items)}</td>
                    <td>{i.window ? `${formatDate(i.window.from)} – ${formatDate(i.window.to)}` : '—'}</td>
                    <td>{i.done ? formatDate(i.done.on) : <span className="pc-blank">&nbsp;</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      <p className="top-gap-sm"><strong>Please bring this card to every visit.</strong> Your doctor may change these dates for you.</p>
      {data.draft && <p className="small">DRAFT – the hospital&apos;s schedule is not yet approved by a doctor.</p>}
    </PrintFrame>
  );
}
