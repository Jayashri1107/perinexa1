import { CalendarDays, Moon, Sun, Sunrise, Sunset } from 'lucide-react';
import { PrintDocument } from '../../components/print/PrintPreview.jsx';
import { formatDate, formatDateTime } from '../../components/ui.jsx';
import {
  RX_LABELS,
  SLOTS,
  SLOT_WORDS,
  TIMING_WORDS,
  doseSlots,
  doseText,
  durationShort,
  frequencyText,
  instructionLine,
  medicineName,
  pregnancyCheckText,
  vitalsText,
} from './rxFormat.js';

// A prescription on paper, in one of the 10 designs (Feature 8). Every design uses the same parts – the doctor,
// the clinic, the patient, the visit's findings, the medicines, advice, next visit and signature – and the
// doctor's own choices: accent colour, text size, paper, the language of the instructions, what to print.
// Used for printing (VisitPage) and for the previews on the design page (PrescriptionDesignPage).
//
// Props: design (the doctor's design), letterhead, doctor { name, professional }, patient { fullName, ageText,
// mrn, careType, allergies? } (allergies: the line to print – always printed when given, in every design), visit { visitOn, ga, vitals, details, items, notes }, pregnancy (antenatal: { lmp, edd,
// eddSource, gpla, bloodGroup, risk } or null), nextDue [{ text, when }] (care-plan items due by the next visit),
// planLabel (the care plan's Draft label, or null), printedAt, printedByName, and copy: 'prescription', or
// 'summary' – the visit summary, when no medicines are given: the same page titled "Visit summary", without the
// medicines and their instructions.

const SLOT_ICONS = { morning: Sunrise, afternoon: Sun, evening: Sunset, night: Moon };
const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const weekday = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const gaText = (ga) => (ga ? `${ga.weeks} w ${ga.days} d` : '');

/** "Advice / सल्ला" – a patient-facing label, with the translation when the design prints one. */
function Bi({ label, lang }) {
  return (
    <>
      {label.en}
      {lang !== 'en' && (
        <>
          {' / '}
          <span lang={lang}>{label[lang]}</span>
        </>
      )}
    </>
  );
}

// ---------- Parts ----------

function DoctorBlock({ doctor, specialities, big = true }) {
  const p = doctor?.professional ?? {};
  return (
    <div className="rx-doctor">
      <div className={big ? 'rx-doctor-name' : 'rx-strong'}>{doctor?.name || 'Doctor'}</div>
      {p.qualification && <div>{p.qualification}</div>}
      {p.registrationNumber && (
        <div className="rx-small">
          Reg. No. {p.registrationNumber}
          {p.council ? ` (${p.council})` : ''}
        </div>
      )}
      {specialities && <div className="rx-small rx-accent-text">{specialities}</div>}
    </div>
  );
}

function ClinicBlock({ letterhead: lh, timings, className = 'rx-clinic' }) {
  const contact = [lh.phone && `Phone ${lh.phone}`, lh.email].filter(Boolean).join(' · ');
  return (
    <div className={className}>
      <div className="rx-clinic-name">{lh.name}</div>
      {lh.tagline && <div className="rx-small">{lh.tagline}</div>}
      {lh.address && <div className="rx-small rx-pre">{lh.address}</div>}
      {contact && <div className="rx-small">{contact}</div>}
      {timings && <div className="rx-small">Timings: {timings}</div>}
      {lh.registrationNumber && <div className="rx-small">Reg. No. {lh.registrationNumber}</div>}
    </div>
  );
}

function PatientLine({ patient, visit, pregnancy, d }) {
  return (
    <div className="rx-patient">
      <span>
        <b>Name:</b> {patient.fullName}
      </span>
      {patient.ageText && (
        <span>
          <b>Age:</b> {patient.ageText}
        </span>
      )}
      <span>
        <b>Patient no.:</b> {patient.mrn}
      </span>
      <span>
        <b>Date:</b> {formatDate(visit.visitOn)}
      </span>
      {d.show.pregnancy && pregnancy && visit.ga && (
        <span>
          <b>Pregnancy:</b> {gaText(visit.ga)}
          {pregnancy.edd ? ` · EDD ${formatDate(pregnancy.edd)}` : ''}
        </span>
      )}
      {patient.allergies && (
        <span className="rx-allergies">
          <b>Allergies:</b> {patient.allergies}
        </span>
      )}
    </div>
  );
}

function PatientBox({ patient, visit, pregnancy, d }) {
  const cells = [
    ['Name', patient.fullName],
    ['Age', patient.ageText],
    ['Patient no.', patient.mrn],
    ['Date', formatDate(visit.visitOn)],
    ...(d.show.pregnancy && pregnancy && visit.ga ? [['Pregnancy', `${gaText(visit.ga)}${pregnancy.edd ? ` · EDD ${formatDate(pregnancy.edd)}` : ''}`]] : []),
    ['Allergies', patient.allergies],
  ].filter(([, v]) => has(v));
  return (
    <dl className="rx-patient-box">
      {cells.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Vital signs, the pregnancy check, complaints, findings and diagnosis – each only when chosen and written. */
function Findings({ visit, d, skip = [] }) {
  const det = visit.details ?? {};
  const vitals = d.show.vitals && !skip.includes('vitals') ? vitalsText(visit.vitals) : '';
  const check = d.show.examination && !skip.includes('check') ? pregnancyCheckText(det) : '';
  const rows = [
    vitals && ['Vitals', vitals],
    d.show.complaints && has(det.complaints) && ['C/o', det.complaints],
    d.show.examination && (has(det.examination) || check) && ['O/E', [check, det.examination].filter(has).join(' · ')],
    d.show.diagnosis && has(det.diagnosis) && ['Diagnosis', det.diagnosis],
  ].filter(Boolean);
  if (!rows.length) return null;
  return (
    <div className="rx-findings">
      {rows.map(([k, v]) => (
        <p key={k} className="rx-line">
          <b>{k}:</b> <span className="rx-pre">{v}</span>
        </p>
      ))}
    </div>
  );
}

function Medicine({ item, d }) {
  return (
    <li className="rx-med">
      <div className="rx-med-name">{medicineName(item, d)}</div>
      <div>{instructionLine(item, 'en')}</div>
      {d.language !== 'en' && <div lang={d.language}>{instructionLine(item, d.language)}</div>}
      {has(item.instructions) && <div className="rx-med-note">{item.instructions}</div>}
    </li>
  );
}

function Medicines({ visit, d }) {
  if (!visit.items?.length) return <p className="rx-line rx-muted">No medicines prescribed.</p>;
  return (
    <ol className="rx-meds">
      {visit.items.map((it) => (
        <Medicine key={it.id} item={it} d={d} />
      ))}
    </ol>
  );
}

function RxBlock({ visit, d, summary }) {
  if (summary) return null;
  return (
    <div className="rx-rx">
      {d.show.rxSymbol && (
        <div className="rx-symbol" aria-hidden="true">
          ℞
        </div>
      )}
      <Medicines visit={visit} d={d} />
    </div>
  );
}

function MedicineTable({ visit, d, summary }) {
  const lang = d.language;
  if (summary) return null;
  if (!visit.items?.length) return <p className="rx-line rx-muted">No medicines prescribed.</p>;
  return (
    <table className="ptable rx-table">
      <thead>
        <tr>
          <th scope="col" className="rx-col-no">
            #
          </th>
          <th scope="col">
            <Bi label={RX_LABELS.medicine} lang={lang} />
          </th>
          <th scope="col">
            <Bi label={RX_LABELS.dose} lang={lang} />
          </th>
          <th scope="col">
            <Bi label={RX_LABELS.howOften} lang={lang} />
          </th>
          <th scope="col">
            <Bi label={RX_LABELS.food} lang={lang} />
          </th>
          <th scope="col">
            <Bi label={RX_LABELS.howLong} lang={lang} />
          </th>
        </tr>
      </thead>
      <tbody>
        {visit.items.map((it, i) => (
          <tr key={it.id}>
            <td className="rx-col-no">{i + 1}</td>
            <td>
              <span className="rx-med-name">{medicineName(it, d)}</span>
              {has(it.instructions) && <span className="rx-block rx-med-note">{it.instructions}</span>}
            </td>
            <td className={doseText(it).length <= 10 ? 'rx-nowrap' : undefined}>
              {doseText(it)}
              {lang !== 'en' && doseText(it, lang) !== doseText(it) && (
                <span className="rx-block" lang={lang}>
                  {doseText(it, lang)}
                </span>
              )}
            </td>
            <td>
              {frequencyText(it, 'en')}
              {lang !== 'en' && (
                <span className="rx-block" lang={lang}>
                  {frequencyText(it, lang)}
                </span>
              )}
            </td>
            <td>
              {TIMING_WORDS[it.timing]?.en ?? ''}
              {lang !== 'en' && it.timing && (
                <span className="rx-block" lang={lang}>
                  {TIMING_WORDS[it.timing][lang]}
                </span>
              )}
            </td>
            <td>
              {durationShort(it, 'en')}
              {lang !== 'en' && it.durationUnit && (
                <span className="rx-block" lang={lang}>
                  {durationShort(it, lang)}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DoseChart({ visit, d, summary }) {
  const lang = d.language;
  if (summary) return null;
  if (!visit.items?.length) return <p className="rx-line rx-muted">No medicines prescribed.</p>;
  return (
    <table className="ptable rx-chart">
      <thead>
        <tr>
          <th scope="col" className="rx-chart-med">
            <Bi label={RX_LABELS.medicine} lang={lang} />
          </th>
          {SLOTS.map((s) => {
            const Icon = SLOT_ICONS[s];
            return (
              <th key={s} scope="col" className="rx-chart-slot">
                <Icon aria-hidden="true" />
                <span className="rx-block">{SLOT_WORDS[s].en}</span>
                {lang !== 'en' && (
                  <span className="rx-block" lang={lang}>
                    {SLOT_WORDS[s][lang]}
                  </span>
                )}
              </th>
            );
          })}
          <th scope="col">
            <Bi label={RX_LABELS.food} lang={lang} />
          </th>
          <th scope="col">
            <Bi label={RX_LABELS.howLong} lang={lang} />
          </th>
        </tr>
      </thead>
      <tbody>
        {visit.items.map((it) => {
          const slots = doseSlots(it);
          return (
            <tr key={it.id}>
              <td className="rx-chart-med">
                <span className="rx-med-name">{medicineName(it, d)}</span>
                {has(it.instructions) && <span className="rx-block rx-med-note">{it.instructions}</span>}
              </td>
              {slots ? (
                slots.map((dose, i) => (
                  <td key={SLOTS[i]} className="rx-chart-dose">
                    {dose || '—'}
                  </td>
                ))
              ) : (
                <td colSpan={4} className="rx-chart-words">
                  {[doseText(it), frequencyText(it, 'en')].filter(Boolean).join(' · ')}
                  {lang !== 'en' && (
                    <span className="rx-block" lang={lang}>
                      {frequencyText(it, lang)}
                    </span>
                  )}
                </td>
              )}
              <td>
                {TIMING_WORDS[it.timing]?.en ?? ''}
                {lang !== 'en' && it.timing && (
                  <span className="rx-block" lang={lang}>
                    {TIMING_WORDS[it.timing][lang]}
                  </span>
                )}
              </td>
              <td>
                {durationShort(it, 'en')}
                {lang !== 'en' && it.durationUnit && (
                  <span className="rx-block" lang={lang}>
                    {durationShort(it, lang)}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RxNotes({ visit, d, summary }) {
  if (summary || !has(visit.notes)) return null;
  return (
    <section className="rx-section">
      <div className="rx-section-title">
        <Bi label={RX_LABELS.instructions} lang={d.language} />
      </div>
      <p className="rx-pre">{visit.notes}</p>
    </section>
  );
}

function Tests({ visit, d }) {
  const t = visit.details?.investigations;
  if (!d.show.investigations || !has(t)) return null;
  return (
    <section className="rx-section">
      <div className="rx-section-title">
        <Bi label={RX_LABELS.tests} lang={d.language} />
      </div>
      <p className="rx-pre">{t}</p>
    </section>
  );
}

function Advice({ visit, d }) {
  const a = visit.details?.advice;
  if (!d.show.advice || !has(a)) return null;
  return (
    <section className="rx-section">
      <div className="rx-section-title">
        <Bi label={RX_LABELS.advice} lang={d.language} />
      </div>
      <p className="rx-pre">{a}</p>
    </section>
  );
}

function NextVisit({ visit, d, nextDue, planLabel, boxed = true }) {
  const det = visit.details ?? {};
  const due = d.show.planItems ? nextDue : [];
  if (!d.show.nextVisit || (!det.nextVisitOn && !due.length)) return null;
  const long = due.length > 8;
  return (
    <section className={[boxed ? 'rx-next' : 'rx-section', long ? 'rx-next-long' : ''].filter(Boolean).join(' ')}>
      <div className="rx-section-title">
        <CalendarDays aria-hidden="true" /> <Bi label={RX_LABELS.nextVisit} lang={d.language} />
        {det.nextVisitOn && (
          <span className="rx-next-date">
            : {weekday(det.nextVisitOn)}, {formatDate(det.nextVisitOn)}
          </span>
        )}
        {has(det.nextVisitNote) && <span> – {det.nextVisitNote}</span>}
      </div>
      {due.length > 0 && (
        <div className="rx-due">
          <span className="rx-small">
            <Bi label={RX_LABELS.dueByNext} lang={d.language} />
            {planLabel ? ` (care plan: ${planLabel})` : ''}:
          </span>
          <ul className={due.length >= 4 ? 'rx-due-list rx-due-cols' : 'rx-due-list'}>
            {due.map((x) => (
              <li key={`${x.text}-${x.when}`}>
                {x.text}
                {x.when ? ` – ${x.when}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** "Visit summary" under the patient's details, in place of the medicines. */
function SummaryTitle({ d, summary }) {
  if (!summary) return null;
  return (
    <p className="rx-title rx-summary-title">
      <Bi label={RX_LABELS.summary} lang={d.language} />
    </p>
  );
}

function SignatureRow({ doctor, d }) {
  const p = doctor?.professional ?? {};
  if (!d.show.signature && !d.footerNote) return null;
  return (
    <div className="rx-sign-row">
      <div className="rx-footnote rx-pre">{d.footerNote}</div>
      {d.show.signature && (
        <div className="rx-sign">
          <div className="rx-sign-line" />
          <div className="rx-strong">{doctor?.name}</div>
          {p.qualification && <div className="rx-small">{p.qualification}</div>}
          {p.registrationNumber && <div className="rx-small">Reg. No. {p.registrationNumber}</div>}
        </div>
      )}
    </div>
  );
}

function VitalsBoxes({ visit, d, withCheck = false }) {
  const v = visit.vitals ?? {};
  const det = visit.details ?? {};
  const boxes = [
    d.show.vitals && has(v.bpSystolic) && has(v.bpDiastolic) && ['BP', `${v.bpSystolic}/${v.bpDiastolic}`],
    d.show.vitals && has(v.pulse) && ['Pulse', `${v.pulse}/min`],
    d.show.vitals && has(v.weightKg) && ['Weight', `${v.weightKg} kg`],
    d.show.vitals && has(v.temperatureF) && ['Temp', `${v.temperatureF} °F`],
    d.show.vitals && has(v.spo2) && ['SpO2', `${v.spo2}%`],
    d.show.vitals && has(v.hb) && ['Hb', `${v.hb} g/dL`],
    withCheck && d.show.examination && has(det.fundalHeightCm) && ['Fundal ht', `${det.fundalHeightCm} cm`],
    withCheck && d.show.examination && has(det.fetalHeartRate) && ['FHR', `${det.fetalHeartRate}/min`],
  ].filter(Boolean);
  if (!boxes.length) return null;
  return (
    <div className="rx-boxes">
      {boxes.map(([k, val]) => (
        <div key={k} className="rx-box">
          <span className="rx-box-label">{k}</span>
          <span className="rx-box-value">{val}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- The 10 designs ----------

function Classic(c) {
  return (
    <>
      <header className="rx-head rx-head-split">
        <DoctorBlock doctor={c.doctor} specialities={c.d.specialities} />
        <ClinicBlock letterhead={c.letterhead} timings={c.d.timings} />
      </header>
      <PatientLine {...c} />
      <SummaryTitle {...c} />
      <Findings {...c} />
      <RxBlock {...c} />
      <RxNotes {...c} />
      <Tests {...c} />
      <Advice {...c} />
      <NextVisit {...c} />
      <SignatureRow {...c} />
    </>
  );
}

function Letterhead(c) {
  const lh = c.letterhead;
  const p = c.doctor?.professional ?? {};
  return (
    <>
      <header className="rx-head rx-head-centre">
        <ClinicBlock letterhead={lh} timings={c.d.timings} className="rx-clinic rx-clinic-centre" />
      </header>
      <p className="rx-doctor-line">
        <span className="rx-strong">{c.doctor?.name}</span>
        {p.qualification ? `, ${p.qualification}` : ''}
        {p.registrationNumber ? ` · Reg. No. ${p.registrationNumber}` : ''}
        {c.d.specialities ? ` · ${c.d.specialities}` : ''}
      </p>
      <PatientBox {...c} />
      <SummaryTitle {...c} />
      <Findings {...c} />
      {!c.summary && <p className="rx-title">Prescription</p>}
      <RxBlock {...c} />
      <RxNotes {...c} />
      <Tests {...c} />
      <Advice {...c} />
      <NextVisit {...c} />
      <SignatureRow {...c} />
      {lh.footer && <p className="rx-lh-footer">{lh.footer}</p>}
    </>
  );
}

function TwoColumn(c) {
  const det = c.visit.details ?? {};
  const vitals = c.d.show.vitals ? vitalsText(c.visit.vitals) : '';
  const check = c.d.show.examination ? pregnancyCheckText(det) : '';
  const notes = [
    vitals && ['Vitals', vitals],
    c.d.show.complaints && has(det.complaints) && ['C/o', det.complaints],
    c.d.show.examination && (check || has(det.examination)) && ['O/E', [check, det.examination].filter(has).join(' · ')],
    c.d.show.investigations && has(det.investigations) && ['Tests advised', det.investigations],
    c.d.show.diagnosis && has(det.diagnosis) && ['Diagnosis', det.diagnosis],
  ].filter(Boolean);
  return (
    <>
      <header className="rx-head rx-head-split">
        <DoctorBlock doctor={c.doctor} specialities={c.d.specialities} />
        <ClinicBlock letterhead={c.letterhead} timings={c.d.timings} />
      </header>
      <PatientLine {...c} />
      <SummaryTitle {...c} />
      <div className="rx-cols">
        <aside className="rx-col-notes">
          {notes.map(([k, v]) => (
            <section key={k}>
              <div className="rx-col-title">{k}</div>
              <p className="rx-pre">{v}</p>
            </section>
          ))}
        </aside>
        <div className="rx-col-main">
          <RxBlock {...c} />
          <RxNotes {...c} />
          <Advice {...c} />
          <NextVisit {...c} />
        </div>
      </div>
      <SignatureRow {...c} />
    </>
  );
}

function Table(c) {
  // A long list of what is due goes across the page under the advice (in the half beside it, it runs over the page)
  const wide = c.d.show.planItems && c.nextDue.length >= 4;
  return (
    <>
      <header className="rx-head rx-head-split">
        <DoctorBlock doctor={c.doctor} specialities={c.d.specialities} />
        <ClinicBlock letterhead={c.letterhead} timings={c.d.timings} />
      </header>
      <PatientBox {...c} />
      <SummaryTitle {...c} />
      <VitalsBoxes {...c} />
      <Findings {...c} skip={['vitals']} />
      <MedicineTable {...c} />
      <RxNotes {...c} />
      {wide ? (
        <>
          <Tests {...c} />
          <Advice {...c} />
          <NextVisit {...c} />
        </>
      ) : (
        <div className="rx-pair">
          <div>
            <Tests {...c} />
            <Advice {...c} />
          </div>
          <NextVisit {...c} />
        </div>
      )}
      <SignatureRow {...c} />
    </>
  );
}

function DoseChartDesign(c) {
  return (
    <>
      <header className="rx-head rx-head-split">
        <DoctorBlock doctor={c.doctor} specialities={c.d.specialities} />
        <ClinicBlock letterhead={c.letterhead} timings={c.d.timings} />
      </header>
      <PatientLine {...c} />
      <SummaryTitle {...c} />
      <Findings {...c} />
      <DoseChart {...c} />
      <RxNotes {...c} />
      <Tests {...c} />
      <Advice {...c} />
      <NextVisit {...c} />
      <SignatureRow {...c} />
    </>
  );
}

function SideBand(c) {
  const lh = c.letterhead;
  const specialities = (c.d.specialities ?? '')
    .split(/[·,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="rx-band-layout">
      <aside className="rx-band">
        <DoctorBlock doctor={c.doctor} />
        {specialities.length > 0 && (
          <ul className="rx-band-list">
            {specialities.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
        {c.d.timings && (
          <p className="rx-small">
            <b>Timings</b>
            <span className="rx-block">{c.d.timings}</span>
          </p>
        )}
        {lh.phone && (
          <p className="rx-small">
            <b>Phone</b>
            <span className="rx-block">{lh.phone}</span>
          </p>
        )}
      </aside>
      <div className="rx-band-main">
        <div className="rx-band-clinic">
          <div className="rx-clinic-name">{lh.name}</div>
          {lh.address && <div className="rx-small rx-pre">{lh.address}</div>}
        </div>
        <PatientLine {...c} />
        <SummaryTitle {...c} />
        <Findings {...c} />
        <RxBlock {...c} />
        <RxNotes {...c} />
        <Tests {...c} />
        <Advice {...c} />
        <NextVisit {...c} />
        <SignatureRow {...c} />
      </div>
    </div>
  );
}

function PregnancyCard(c) {
  const pr = c.pregnancy;
  const cells = pr
    ? [
        ['LMP', pr.lmp ? formatDate(pr.lmp) : '—'],
        ['EDD', pr.edd ? `${formatDate(pr.edd)}${pr.eddSource ? ` (${pr.eddSource})` : ''}` : '—'],
        ['Weeks', gaText(c.visit.ga) || '—'],
        ['G P L A', pr.gpla || '—'],
        ['Blood group', pr.bloodGroup || '—'],
        ['Risk', pr.risk || '—'],
      ]
    : [];
  return (
    <>
      <header className="rx-head rx-head-split">
        <DoctorBlock doctor={c.doctor} specialities={c.d.specialities} />
        <ClinicBlock letterhead={c.letterhead} timings={c.d.timings} />
      </header>
      <PatientLine {...c} d={{ ...c.d, show: { ...c.d.show, pregnancy: false } }} />
      <SummaryTitle {...c} />
      {c.d.show.pregnancy && pr && (
        <dl className="rx-preg">
          {cells.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <VitalsBoxes {...c} withCheck />
      <Findings {...c} skip={['vitals']} />
      <RxBlock {...c} />
      <RxNotes {...c} />
      <NextVisit {...c} />
      <Tests {...c} />
      <Advice {...c} />
      <SignatureRow {...c} />
    </>
  );
}

function Preprinted(c) {
  return (
    <>
      <PatientLine {...c} />
      <SummaryTitle {...c} />
      <Findings {...c} />
      <RxBlock {...c} />
      <RxNotes {...c} />
      <Tests {...c} />
      <Advice {...c} />
      <NextVisit {...c} />
      <SignatureRow {...c} />
    </>
  );
}

function HalfPage(c) {
  const p = c.doctor?.professional ?? {};
  return (
    <>
      <header className="rx-head rx-head-one">
        <span className="rx-clinic-name">{c.letterhead.name}</span>
        <span className="rx-small">
          <span className="rx-strong">{c.doctor?.name}</span>
          {p.qualification ? `, ${p.qualification}` : ''}
          {p.registrationNumber ? ` · Reg. No. ${p.registrationNumber}` : ''}
        </span>
      </header>
      <PatientLine {...c} />
      <SummaryTitle {...c} />
      <Findings {...c} />
      <RxBlock {...c} />
      <RxNotes {...c} />
      <NextVisit {...c} boxed={false} />
      <Tests {...c} />
      <Advice {...c} />
      <SignatureRow {...c} />
    </>
  );
}

function Minimal(c) {
  const lang = c.d.language;
  return (
    <>
      <header className="rx-head rx-head-min">
        <ClinicBlock letterhead={c.letterhead} timings={c.d.timings} className="rx-clinic rx-clinic-min" />
        <DoctorBlock doctor={c.doctor} specialities={c.d.specialities} big={false} />
      </header>
      <div className="rx-min-patient">
        <div className="rx-min-name">{c.patient.fullName}</div>
        <div className="rx-small">
          {[c.patient.ageText, c.patient.mrn, formatDate(c.visit.visitOn), c.d.show.pregnancy && c.pregnancy && gaText(c.visit.ga)].filter(Boolean).join(' · ')}
        </div>
        {c.patient.allergies && (
          <div className="rx-small rx-allergies">
            <b>Allergies:</b> {c.patient.allergies}
          </div>
        )}
      </div>
      <SummaryTitle {...c} />
      <Findings {...c} />
      {!c.summary && (
        <div className="rx-min-label">
          <Bi label={RX_LABELS.medicines} lang={lang} />
        </div>
      )}
      {c.summary ? null : c.visit.items?.length ? (
        <ol className="rx-min-meds">
          {c.visit.items.map((it) => (
            <li key={it.id}>
              <div className="rx-med-name">{medicineName(it, c.d)}</div>
              <div className="rx-chips">
                {[doseText(it), frequencyText(it, 'en'), TIMING_WORDS[it.timing]?.en, durationShort(it, 'en')]
                  .filter(Boolean)
                  .map((x) => (
                    <span key={x} className="rx-chip">
                      {x}
                    </span>
                  ))}
              </div>
              {lang !== 'en' && (
                <div className="rx-small" lang={lang}>
                  {instructionLine(it, lang)}
                </div>
              )}
              {has(it.instructions) && <div className="rx-med-note">{it.instructions}</div>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="rx-line rx-muted">No medicines prescribed.</p>
      )}
      <RxNotes {...c} />
      <Tests {...c} />
      <Advice {...c} />
      <NextVisit {...c} />
      <SignatureRow {...c} />
    </>
  );
}

const LAYOUTS = {
  classic: Classic,
  letterhead: Letterhead,
  two_column: TwoColumn,
  table: Table,
  dose_chart: DoseChartDesign,
  side_band: SideBand,
  pregnancy: PregnancyCard,
  preprinted: Preprinted,
  half_page: HalfPage,
  minimal: Minimal,
};

/** The printed page for the paper and margins of a design (PrintPreview's `page`). */
export function rxPage(d) {
  if (d.design === 'preprinted') return { size: d.paper, margin: `${d.marginTopMm}mm 12mm ${d.marginBottomMm}mm 12mm` };
  if (d.design === 'half_page' || d.paper === 'A5') return { size: 'A5', margin: '8mm' };
  return null;
}

export function RxDocument({ design: d, letterhead, doctor, patient, visit, pregnancy = null, nextDue = [], planLabel = null, printedAt, printedByName, copy = 'prescription' }) {
  const Layout = LAYOUTS[d.design] ?? Classic;
  const a5 = d.design === 'half_page' || d.paper === 'A5';
  const summary = copy === 'summary';
  const className = ['rx', `rx-${d.design}`, `rx-accent-${d.accent}`, `rx-size-${d.textSize}`, a5 ? 'rx-a5' : '', summary ? 'rx-summary' : ''].filter(Boolean).join(' ');
  // On every page, also on a pre-printed pad (above the pad's own footer): a second page names the patient too.
  const footer = (
    <>
      <span>
        {patient.fullName} · {patient.mrn}
      </span>
      <span>
        Printed {formatDateTime(printedAt)}
        {printedByName ? ` by ${printedByName}` : ''}
      </span>
    </>
  );
  return (
    <PrintDocument footer={footer} className={className}>
      <Layout d={d} letterhead={letterhead} doctor={doctor} patient={patient} visit={visit} pregnancy={pregnancy} nextDue={nextDue} planLabel={planLabel} summary={summary} />
    </PrintDocument>
  );
}
