import { Letterhead, LetterheadFooter } from '../../components/print/Letterhead.jsx';
import { PrintDocument, PrintFacts } from '../../components/print/PrintPreview.jsx';
import { formatDate, formatDateTime } from '../../components/ui.jsx';
import { BLANK_LABELS, PRINT_LABELS, bilingual, textParts } from './consentFormat.js';

// A consent form on paper: English with Marathi or Hindi next to it, clause by clause, so the patient reads
// her language and the doctor, the witness and a reviewer can check both line by line. Also used on the
// library's form page to show the wording (with its blanks labelled instead of filled in).

/** A label in English with the translation after it: "Signature / सही". */
export function PrintLabel({ label, lang }) {
  const [en, other] = bilingual(label, lang);
  return (
    <>
      {en}
      {other && (
        <>
          {' / '}
          <span lang={lang}>{other}</span>
        </>
      )}
    </>
  );
}

/**
 * One text with its blanks. values: the patient's details and what the doctor typed – an empty blank prints
 * as a line to fill in by hand. Without values (the library's form page) each blank shows what it will be.
 */
export function ConsentText({ text, values }) {
  return textParts(text).map((p, i) => {
    if (p.text !== undefined) return <span key={i}>{p.text}</span>;
    if (!values) {
      return (
        <span key={i} className="cf-blank">
          {BLANK_LABELS[p.blank]}
        </span>
      );
    }
    const v = values[p.blank];
    return v || v === 0 ? (
      // The patient number never breaks at its hyphen
      <strong key={i} className={p.blank === 'mrn' ? 'pdoc-nowrap' : undefined}>
        {v}
      </strong>
    ) : (
      <span key={i} className="pdoc-line" role="img" aria-label="blank line, to fill in by hand" />
    );
  });
}

/** The title in English, with the translation under it. lang: 'mr' | 'hi' | 'en' (English only). */
export function ConsentTitle({ form, lang }) {
  const second = lang !== 'en' ? lang : null;
  return (
    <>
      <h1 className="pdoc-title">{form.title.en}</h1>
      {second && (
        <p className="pdoc-title pdoc-title-2" lang={second}>
          {form.title[second]}
        </p>
      )}
    </>
  );
}

/** The numbered clauses, English on the left and the translation next to it (clauses have no ids: the order is theirs). */
export function ConsentClauses({ form, lang, values }) {
  const second = lang !== 'en' ? lang : null;
  return (
    <table className={`ptable pdoc-clauses ${second ? 'pdoc-two' : ''}`.trim()}>
      <tbody>
        {form.clauses.map((c, i) => (
          <tr key={i}>
            <td className="pdoc-num">{i + 1}.</td>
            <td lang="en">
              <ConsentText text={c.en} values={values} />
            </td>
            {second && (
              <td lang={second}>
                <ConsentText text={c[second]} values={values} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SignLine({ label, lang, value }) {
  return (
    <div className="pdoc-sig-line">
      <span className="pdoc-sig-label">
        <PrintLabel label={label} lang={lang} />:
      </span>
      {value ? <strong className="pdoc-sig-value">{value}</strong> : <span className="pdoc-sig-fill" />}
    </div>
  );
}

function SignBox({ title, lang, wide = false, children }) {
  return (
    <section className={`pdoc-sig ${wide ? 'pdoc-sig-wide' : ''}`.trim()}>
      <h2 className="pdoc-sig-title">
        <PrintLabel label={title} lang={lang} />
      </h2>
      <div className="pdoc-sig-lines">{children}</div>
    </section>
  );
}

// "Dr. Riley Demo · Reg. No. MH-12345 (Maharashtra Medical Council)"
const doctorLine = (doctor) => {
  if (!doctor) return '';
  const p = doctor.professional ?? {};
  const reg = p.registrationNumber ? ` · Reg. No. ${p.registrationNumber}${p.council ? ` (${p.council})` : ''}` : '';
  return `${doctor.name}${p.qualification ? `, ${p.qualification}` : ''}${reg}`;
};

/**
 * Who signs: the patient (or, for a newborn, a parent), a relative if she can't, a witness, the doctor, an interpreter.
 * An information form: the patient and two relatives who were informed (always, not only if she can't sign).
 */
function SignatureBoxes({ lang, patient, doctor, information }) {
  const L = PRINT_LABELS;
  const newborn = patient.careType === 'newborn';
  if (information) {
    const relative = (n) => (
      <SignBox key={n} title={L.relativeInformed} lang={lang}>
        <SignLine label={L.name} lang={lang} />
        <SignLine label={L.relationship} lang={lang} />
        <SignLine label={L.signatureOrThumb} lang={lang} />
        <SignLine label={L.dateTime} lang={lang} />
      </SignBox>
    );
    return (
      <div className="pdoc-sigs">
        {newborn ? (
          <SignBox title={L.parent} lang={lang}>
            <SignLine label={L.name} lang={lang} />
            <SignLine label={L.relationship} lang={lang} />
            <SignLine label={L.signatureOrThumb} lang={lang} />
            <SignLine label={L.dateTime} lang={lang} />
          </SignBox>
        ) : (
          <SignBox title={L.patient} lang={lang}>
            <SignLine label={L.name} lang={lang} value={patient.fullName} />
            <SignLine label={L.signatureOrThumb} lang={lang} />
            <SignLine label={L.dateTime} lang={lang} />
          </SignBox>
        )}
        {relative(1)}
        {relative(2)}
        <SignBox title={L.doctorInformed} lang={lang}>
          <SignLine label={L.name} lang={lang} value={doctorLine(doctor)} />
          <SignLine label={L.signature} lang={lang} />
          <SignLine label={L.dateTime} lang={lang} />
        </SignBox>
        <SignBox title={L.witness} lang={lang}>
          <SignLine label={L.name} lang={lang} />
          <SignLine label={L.signature} lang={lang} />
          <SignLine label={L.dateTime} lang={lang} />
        </SignBox>
        <SignBox title={L.interpreter} lang={lang}>
          <SignLine label={L.name} lang={lang} />
          <SignLine label={L.language} lang={lang} />
          <SignLine label={L.signature} lang={lang} />
        </SignBox>
      </div>
    );
  }
  return (
    <div className="pdoc-sigs">
      {newborn ? (
        <SignBox title={L.parent} lang={lang} wide>
          <SignLine label={L.name} lang={lang} />
          <SignLine label={L.relationship} lang={lang} />
          <SignLine label={L.signatureOrThumb} lang={lang} />
          <SignLine label={L.dateTime} lang={lang} />
        </SignBox>
      ) : (
        <>
          <SignBox title={L.patient} lang={lang}>
            <SignLine label={L.name} lang={lang} value={patient.fullName} />
            <SignLine label={L.signatureOrThumb} lang={lang} />
            <SignLine label={L.dateTime} lang={lang} />
          </SignBox>
          <SignBox title={L.relative} lang={lang}>
            <SignLine label={L.name} lang={lang} />
            <SignLine label={L.relationship} lang={lang} />
            <SignLine label={L.signatureOrThumb} lang={lang} />
            <SignLine label={L.dateTime} lang={lang} />
          </SignBox>
        </>
      )}
      <SignBox title={L.witness} lang={lang}>
        <SignLine label={L.name} lang={lang} />
        <SignLine label={L.signature} lang={lang} />
        <SignLine label={L.dateTime} lang={lang} />
      </SignBox>
      <SignBox title={L.doctor} lang={lang}>
        <SignLine label={L.name} lang={lang} value={doctorLine(doctor)} />
        <SignLine label={L.signature} lang={lang} />
        <SignLine label={L.dateTime} lang={lang} />
      </SignBox>
      <SignBox title={L.interpreter} lang={lang} wide>
        <SignLine label={L.name} lang={lang} />
        <SignLine label={L.language} lang={lang} />
        <SignLine label={L.signature} lang={lang} />
      </SignBox>
    </div>
  );
}

/**
 * The whole printed form. values: the blanks (patient, age, mrn, hospital, doctor, procedure, reason);
 * doctor: { name, professional } of the doctor who explains it, or null to leave the name blank.
 * A form that is not approved says DRAFT at the top of every page.
 */
export function ConsentPrintDocument({ form, lang, patient, letterhead, values, doctor, printedAt, printedByName }) {
  const newborn = patient.careType === 'newborn';
  const draft = form.status !== 'approved' ? 'DRAFT – not approved by the hospital. Not for use with patients until a doctor approves this form.' : null;
  const approval = form.status === 'approved' ? `approved by ${form.approvedByName} on ${formatDate(form.approvedAt)}` : 'draft';
  const footer = (
    <>
      <span>
        {form.title.en} · version {form.version} · {approval}
      </span>
      <span>
        {patient.fullName} · {patient.mrn} · printed {formatDateTime(printedAt)} by {printedByName}
      </span>
    </>
  );
  return (
    <PrintDocument draft={draft} footer={footer} className="pdoc-consent">
      <Letterhead letterhead={letterhead} />
      <ConsentTitle form={form} lang={lang} />
      <PrintFacts
        items={[
          [<PrintLabel key="name" label={newborn ? PRINT_LABELS.babyName : PRINT_LABELS.patientName} lang={lang} />, patient.fullName],
          newborn
            ? [<PrintLabel key="mother" label={PRINT_LABELS.mother} lang={lang} />, patient.motherInfo?.fullName ?? '']
            : [<PrintLabel key="age" label={PRINT_LABELS.age} lang={lang} />, values.age === '' || values.age == null ? '' : String(values.age)],
          [<PrintLabel key="no" label={PRINT_LABELS.patientNo} lang={lang} />, <span key="mrn" className="pdoc-tabular">{patient.mrn}</span>],
        ]}
      />
      <ConsentClauses form={form} lang={lang} values={values} />
      <SignatureBoxes lang={lang} patient={patient} doctor={doctor} information={form.kind === 'information'} />
      <LetterheadFooter letterhead={letterhead} />
    </PrintDocument>
  );
}
