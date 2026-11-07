import { useState } from "react";
import { Link } from "react-router-dom";
import { Droplet } from "lucide-react";
import { useDialogFocus } from "../../components/ui.jsx";
import { useFetch } from "../../hooks/useFetch.js";
import { DeclaredClock, declarePph } from "./PphChart.jsx";
import {
  BUNDLE,
  CARBOPROST_INTERVAL_MIN,
  CARBOPROST_MAX,
  FIBRINOGEN_LOW,
  LATE_ENTRY_MIN,
  PPH_FORM,
  TXA_REPEAT_MIN,
} from "./pphRules.js";

// The PPH part of the patient banner (Build 15, A2): "Declare PPH" in one tap while she is admitted (it stamps the time
// now and starts the clock), then the minutes since declaration, the ALG-01 card (read-only, one tap) and the way to
// her chart. Shown only to those who may write her chart; nothing for a baby.
// TODO (after Build 8 and Build 15 are merged): A2 "MEOWS frequency set to 5 min".

/** The read-only card: the E-MOTIVE bundle of OBG-F-07 with its doses and rules. */
export function AlgorithmCard({ onClose }) {
  const ref = useDialogFocus(onClose);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className="modal pph-alg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pph-alg-title"
      >
        <AlgorithmContent />
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** What the card says (no inputs). */
export function AlgorithmContent() {
  const groups = BUNDLE.filter((b) => !b.key);
  return (
    <>
      <h2 id="pph-alg-title">PPH – E-MOTIVE bundle (OBG-ALG-01)</h2>
      <p className="hint">{`Read-only, from ${PPH_FORM.code} v${PPH_FORM.version}. All within 15 minutes of declaring PPH.`}</p>
      {groups.map((g) => (
        <section key={g.letter}>
          <h3>{`${g.letter} – ${g.title}`}</h3>
          <ul>
            {BUNDLE.filter(
              (b) =>
                b.key &&
                b.letter === g.letter &&
                (b.kind === "time" || b.kind === "doses"),
            ).map((b) => (
              <li key={b.key}>
                {[b.label, b.dose, b.note].filter(Boolean).join(" – ")}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h3>E – Escalation</h3>
        <ul>
          <li>
            Massive haemorrhage: declare it on the chart – the Director is told
            and the blood bank pack request recorded (ANA-ALG-06).
          </li>
          <li>
            Theatre, balloon tamponade, laparotomy, compression sutures,
            ligation, hysterectomy.
          </li>
        </ul>
      </section>
      <ul className="hint">
        <li>{`Carboprost: at least ${CARBOPROST_INTERVAL_MIN} minutes between doses, at most ${CARBOPROST_MAX} doses. Asthma: warning.`}</li>
        <li>
          Ergometrine: hypertension, pre-eclampsia or heart disease – warning.
        </li>
        <li>{`Tranexamic acid within 3 hours of birth; the repeat not before the first + ${TXA_REPEAT_MIN} minutes.`}</li>
        <li>{`Fibrinogen under ${FIBRINOGEN_LOW} g/L: cryoprecipitate 2 pools.`}</li>
        <li>{`Typed more than ${LATE_ENTRY_MIN} minutes after the event: late entry – scan the paper chart.`}</li>
      </ul>
    </>
  );
}

export function PphBanner({ patient }) {
  const skip = !patient?.id || patient.careType === "newborn";
  const { data, reload } = useFetch(skip ? null : "/pph/current", {
    patientId: patient?.id,
  });
  const [card, setCard] = useState(false);
  const [problem, setProblem] = useState(null);
  if (skip || !data?.admissionId) return null;
  const declare = async () => {
    try {
      await declarePph(patient.id, data.admissionId);
      setProblem(null);
      reload();
    } catch (err) {
      setProblem(err.message);
    }
  };
  return (
    <>
      {data.open ? (
        <>
          <DeclaredClock at={data.open.declared_at} />
          <button
            type="button"
            className="btn btn-link"
            onClick={() => setCard(true)}
          >
            ALG-01 card
          </button>
          <Link
            className="btn btn-link"
            to={`/patients/${patient.id}/stays/${data.admissionId}`}
          >
            Open the PPH chart
          </Link>
        </>
      ) : (
        data.canDeclare && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={declare}
          >
            <Droplet aria-hidden="true" /> Declare PPH
          </button>
        )
      )}
      {problem && <span className="field-error">{problem}</span>}
      {card && <AlgorithmCard onClose={() => setCard(false)} />}
    </>
  );
}
