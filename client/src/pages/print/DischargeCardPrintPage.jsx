// A signed discharge card for printing or saving as PDF (the print dialog's "Save as PDF") – laid out as the hospital's
// own printed discharge card (owner, 9 Oct 2026): A4, the letterhead with its logo, DISCHARGE CARD and the date; name,
// age / sex, consultant, D.O.A., D.O.D., room, Reg. no. and IPD no.; then ruled boxes: Diagnosis · History /
// complaints · O/E · Course in the hospital · Surgery / procedure · Investigation · Blood investigation (report – the
// lab results of the stay) · Condition at discharge · Advice / suggested investigations beside Advice on discharge (the
// medicines) · Follow-up, with the notes for the patient. It reads only the signed card (GET /hospital/discharges/:id),
// for her doctor, nurses and reception alike.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { dischargesApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { ageText, formatDate, formatDateTime, labelOf } from '../../utils/format.js';
import { rxLine } from '../visits/visitFormat.js';
import { wardParts } from '../../components/FloorTag.jsx';
import { DocTitle, Letterhead, PrintFrame } from './PrintFrame.jsx';

// The saved file's name, e.g. "Discharge_Card_P-000001_2026-10-07" (no patient name: file names end up in many places).
const fileTitle = (d) => `Discharge_Card_${d.patient.patientNumber}_${new Date(d.card.content?.dischargedAt ?? d.card.signed?.at ?? Date.now()).toISOString().slice(0, 10)}`;
const FLAG_WORDS = { low: 'Low', high: 'High', abnormal: 'Abnormal' };

// One labelled line of the header ("Name : ____"), the value written on the line.
function Line({ label, children, grow = 1 }) {
  return (
    <span className="dc-field" style={{ flexGrow: grow }}>
      <span className="dc-label">{label} :</span>
      <span className="dc-value">{children || ' '}</span>
    </span>
  );
}

// A ruled box with its heading, and the text as written (line breaks kept).
function Box({ title, children, className = '' }) {
  return (
    <section className={`dc-box ${className}`}>
      <h3 className="dc-head">{title} :</h3>
      <div className="dc-body">{children}</div>
    </section>
  );
}
const Text = ({ value }) => (value ? <p className="pre">{value}</p> : <p className="dc-empty">—</p>);

export function DischargeCardPrintPage() {
  const { cardId } = useParams();
  const { patients: patientSettings } = useAppConfig();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    dischargesApi.card(cardId).then(setData).catch((err) => setError(err.message));
  }, [cardId]);
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const { patient, card, letterhead = {} } = data;
  const stay = data.stay ?? {};
  const c = card.content ?? {};
  const age = patient.birthDate ? ageText(patient.birthDate, patient.birthDateApprox) : '';
  const sex = patient.sex ? labelOf(patientSettings.sexes, patient.sex) : '';
  const consultant = [data.consultant, data.consultantQualification].filter(Boolean).join(', ');
  // "G3 – General ward" (the bed first, as a room number; the floor is left out to keep the line short)
  const room = [stay.bed, wardParts(stay.ward).name].filter(Boolean).join(' – ');
  const advice = [
    c.diet && `Diet: ${c.diet}`,
    c.activity && `Activity: ${c.activity}`,
    c.woundCare && `Wound care: ${c.woundCare}`,
    c.otherInstructions,
  ].filter(Boolean);
  const followUp = [
    c.followUpOn && `Review on ${formatDate(c.followUpOn)}`,
    c.followUpDoctorName && `with ${c.followUpDoctorName}`,
    c.followUpDepartment && `(${c.followUpDepartment})`,
  ].filter(Boolean).join(' ');

  return (
    <PrintFrame ready title={fileTitle(data)} footer={letterhead.footer} size="A4">
      <div className="dc">
        <Letterhead letterhead={letterhead} hospitalName={data.hospitalName} />
        <DocTitle right={<Line label="Date">{formatDate(c.dischargedAt ?? card.signed?.at)}</Line>}>DISCHARGE CARD</DocTitle>

        <div className="dc-fields">
          <div className="dc-row"><Line label="Name" grow={3}><strong>{patient.name}</strong></Line><Line label="Age / Sex" grow={1.6}>{[age, sex].filter(Boolean).join(' / ')}</Line></div>
          <div className="dc-row"><Line label="Name of Consultant">{consultant}</Line></div>
          <div className="dc-row">
            <Line label="D.O.A.">{formatDate(stay.admittedAt)}</Line>
            <Line label="D.O.D.">{formatDate(c.dischargedAt ?? stay.dischargedAt)}</Line>
            <Line label="Room No.">{room}</Line>
          </div>
          <div className="dc-row"><Line label="Reg. No.">{patient.patientNumber}</Line><Line label="IPD No.">{stay.admissionNumber}</Line></div>
        </div>

        <Box title="DIAGNOSIS" className="dc-short">
          <Text value={c.finalDiagnosis} />
          {c.admissionDiagnosis && c.admissionDiagnosis !== c.finalDiagnosis && <p className="small">At admission: {c.admissionDiagnosis}</p>}
        </Box>
        <section className="dc-box">
          <h3 className="dc-head">HISTORY / COMPLAINTS :</h3>
          <div className="dc-body"><Text value={c.chiefComplaint} /></div>
          <h3 className="dc-head dc-sub">O/E :</h3>
          <div className="dc-body"><Text value={c.importantFindings} /></div>
          <h3 className="dc-head dc-sub">COURSE IN THE HOSPITAL :</h3>
          <div className="dc-body"><Text value={c.course} /></div>
        </section>
        <Box title="SURGERY / PROCEDURE"><Text value={c.procedures} /></Box>

        <Box title="INVESTIGATION"><Text value={c.investigations} /></Box>
        <Box title="BLOOD INVESTIGATION (REPORT)">
          {data.labResults?.length ? (
            <table className="dc-lab">
              <tbody>
                {data.labResults.flatMap((o) =>
                  o.tests.map((t, i) => (
                    <tr key={`${o.orderNumber}-${i}`}>
                      <th>{t.name}<span className="dc-date">{formatDate(o.reportedAt)}</span></th>
                      <td>
                        {t.values.map((v) => `${v.name !== t.name ? `${v.name} ` : ''}${v.value}${v.unit ? ` ${v.unit}` : ''}${FLAG_WORDS[v.flag] ? ` (${FLAG_WORDS[v.flag]})` : ''}`).join('; ')}
                        {t.text && `${t.values.length ? ' · ' : ''}${t.text}`}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          ) : (
            <p className="dc-empty">No lab results during the stay.</p>
          )}
        </Box>

        <Box title="CONDITION AT DISCHARGE" className="dc-short"><Text value={c.conditionAtDischarge} /></Box>
        <div className="dc-two">
          <section className="dc-col">
            <h3 className="dc-colhead">ADVICE / SUGGESTED INVESTIGATIONS</h3>
            {advice.length ? <ul className="dc-list">{advice.map((a, i) => <li key={i} className="pre">{a}</li>)}</ul> : <p className="dc-empty">—</p>}
          </section>
          <section className="dc-col">
            <h3 className="dc-colhead">ADVICE ON DISCHARGE</h3>
            {c.medicines?.length ? <ol className="dc-list dc-rx">{c.medicines.map((m, i) => <li key={i}>{rxLine(m)}</li>)}</ol> : <p className="dc-empty">—</p>}
          </section>
        </div>

        <section className="dc-follow">
          <h3 className="dc-head">FOLLOW-UP :</h3>
          {(followUp || c.followUpInstructions) && <p><strong>{followUp}</strong>{c.followUpInstructions && ` – ${c.followUpInstructions}`}</p>}
          <ol className="dc-notes">
            {c.warningSigns && <li>If you have symptoms like these, consult your doctor immediately: {c.warningSigns}</li>}
            {letterhead.phone && <li>In case of emergency or any other query please contact on {letterhead.phone}</li>}
          </ol>
          <p className="dc-handed">All investigation reports have been handed over to the patient at the time of discharge.</p>
        </section>

        {card.additions.length > 0 && (
          <section className="dc-box">
            <h3 className="dc-head">CORRECTIONS AND ADDITIONS :</h3>
            <div className="dc-body">{card.additions.map((a, i) => <p key={i} className="small">{a.text} – {a.byName}, {formatDateTime(a.at)}</p>)}</div>
          </section>
        )}

        <div className="print-sign-row dc-sign">
          <p className="print-sign"><strong>{card.signed?.byName}</strong><br />Finalized {formatDate(card.signed?.at)}<br />Doctor’s signature</p>
          <p className="print-sign">&nbsp;<br />&nbsp;<br />Patient / relative</p>
          <p className="print-sign">&nbsp;<br />&nbsp;<br />Hospital stamp</p>
        </div>
      </div>
    </PrintFrame>
  );
}
