import { useState } from "react";
import { Printer } from "lucide-react";
import { useFetch } from "../../hooks/useFetch.js";
import { formatDateTime, formatTime } from "../../components/ui.jsx";
import { Letterhead } from "../../components/print/Letterhead.jsx";
import {
  PrintDocument,
  PrintPreview,
} from "../../components/print/PrintPreview.jsx";
import {
  BUNDLE,
  DELIVERY_MODES,
  DISPOSITIONS,
  LOSS_METHODS,
  NEAR_MISS,
  PPH_CAUSES,
  PPH_FORM,
  PROCEDURES,
  RISK_FACTORS,
} from "./pphRules.js";

// The PPH chart printed as the manual's page OBG-F-07 v1.0 (Build 15): A4 portrait – the header, the E-MOTIVE
// three-column tick-with-time block, the observations table, then labs and outcome; the footer "OBG-F-07 · v1.0" on
// every page. The same layout as the paper chart, so a printout and the paper master read alike.

const words = (o, keys) => (keys ?? []).map((k) => o[k] ?? k).join(", ") || "—";
const tm = (v) => (v ? formatTime(v) : "—");
const yes = (v) => (v ? "Yes" : "—");
const val = (v, unit = "") => (v == null || v === "" ? "—" : `${v}${unit}`);
// The tick box of the paper form: a box with a tick (U+2713, a plain character, not an emoji) when done
const tick = (v) => (
  <span className="pph-box" aria-label={v ? "done" : "not done"}>
    {v ? "✓" : ""}
  </span>
);

/** The E-MOTIVE block in three columns: M + O | T + I | V + E. */
const COLUMNS = [
  ["M", "O"],
  ["T", "I"],
  ["V", "E"],
];

function bundleLine(item, c) {
  const b = c.bundle ?? {};
  if (item.kind === "doses") {
    const doses = (c.carboprost ?? []).filter((d) => !d.cancelled);
    return [
      tick(doses.length),
      `${item.label}`,
      doses.length ? doses.map((d) => formatTime(d.at)).join(", ") : "—",
    ];
  }
  const v = b[item.key];
  const label = item.dose ? `${item.label} ${item.dose}` : item.label;
  if (item.kind === "time")
    return [
      tick(v),
      label,
      v
        ? `${tm(v)}${c.within15?.[item.key] === true ? " (within 15 min)" : ""}`
        : "—",
    ];
  if (item.kind === "bool") return [tick(v), label, yes(v)];
  if (item.kind === "number")
    return [tick(v != null && v !== ""), label, val(v)];
  if (item.kind === "enum")
    return [tick(v), label, v ? (item.options[v] ?? v) : "—"];
  return [tick(v?.length), label, words(item.options, v)];
}

export function PphPrintSheet({ chart: c, patient, letterhead }) {
  const h = c.header ?? {};
  const o = c.outcome ?? {};
  const e = c.escalation ?? {};
  const labs = c.labs ?? {};
  const rows = (c.observations ?? []).filter((r) => !r.cancelled);
  const groups = BUNDLE.filter((b) => !b.key);
  return (
    <PrintDocument
      className="mp-doc pph-print"
      head={
        <div className="mp-head">
          <Letterhead letterhead={letterhead} />
          <div className="mp-formbox">
            <div className="mp-code">{PPH_FORM.code}</div>
            <div>{PPH_FORM.title}</div>
            <div>{`Version ${PPH_FORM.version}`}</div>
          </div>
        </div>
      }
      footer={
        <>
          <span>{`${patient.fullName ?? ""} · ${patient.mrn ?? ""}`}</span>
          <span className="pph-print-code">{PPH_FORM.footer}</span>
        </>
      }
    >
      <h1>PPH management and blood-loss chart</h1>
      <section className="pph-p-header" aria-label="Header">
        <table className="ptable pdoc-table pph-p-grid">
          <tbody>
            <tr>
              <th scope="row">Delivery</th>
              <td>{`${DELIVERY_MODES[h.delivery_mode] ?? "—"} · ${h.delivery_time ? formatDateTime(h.delivery_time) : "—"}`}</td>
              <th scope="row">PPH declared</th>
              <td>{`${c.declared_at ? formatDateTime(c.declared_at) : "—"} · ${h.declared_by?.name ?? "—"}`}</td>
            </tr>
            <tr>
              <th scope="row">Loss at declaration</th>
              <td>{`${val(h.loss_at_declaration_ml, " ml")} · ${LOSS_METHODS[h.loss_method] ?? "—"}`}</td>
              <th scope="row">Shock index</th>
              <td>
                {c.shock_index_at_declaration
                  ? `${c.shock_index_at_declaration.value} (pulse ${h.pulse_at_declaration} / SBP ${h.systolic_at_declaration})`
                  : "—"}
              </td>
            </tr>
            <tr>
              <th scope="row">Help called</th>
              <td>{tm(h.help_called_at)}</td>
              <th scope="row">Blood bank informed</th>
              <td>{tm(h.blood_bank_informed_at)}</td>
            </tr>
            <tr>
              <th scope="row">Consultant</th>
              <td>{`${h.consultant?.name ?? "—"} · arrived ${tm(h.consultant_arrived_at)}`}</td>
              <th scope="row">Anaesthetist</th>
              <td>{`${h.anaesthetist?.name ?? "—"} · arrived ${tm(h.anaesthetist_arrived_at)}`}</td>
            </tr>
            <tr>
              <th scope="row">Cause (4 Ts)</th>
              <td>{words(PPH_CAUSES, h.cause_4T)}</td>
              <th scope="row">Recorder</th>
              <td>{h.recorder?.name ?? "—"}</td>
            </tr>
            <tr>
              <th scope="row">Risk factors</th>
              <td colSpan={3}>{words(RISK_FACTORS, h.risk_factors)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <h2>E-MOTIVE bundle</h2>
      <section className="pph-p-emotive" aria-label="E-MOTIVE bundle">
        {COLUMNS.map((letters) => (
          <div key={letters.join("")} className="pph-p-col">
            {letters.map((letter) => {
              const g = groups.find((x) => x.letter === letter);
              const items = BUNDLE.filter((b) => b.key && b.letter === letter);
              return (
                <div key={letter} className="pph-p-letter">
                  <h3>
                    {letter === "E"
                      ? "E – Escalation"
                      : `${letter} – ${g?.title ?? ""}`}
                  </h3>
                  <table className="ptable pdoc-table">
                    <tbody>
                      {letter === "E" ? (
                        <>
                          <tr>
                            <td>{tick(c.E_escalated)}</td>
                            <td>Massive haemorrhage declared</td>
                            <td>{tm(e.massive_haemorrhage_declared_at)}</td>
                          </tr>
                          <tr>
                            <td>{tick(e.to_ot_at)}</td>
                            <td>To theatre</td>
                            <td>{tm(e.to_ot_at)}</td>
                          </tr>
                          <tr>
                            <td>{tick(e.balloon?.inserted_at)}</td>
                            <td>{`Balloon${e.balloon?.volume_ml != null ? ` ${e.balloon.volume_ml} ml` : ""}`}</td>
                            <td>{`${tm(e.balloon?.inserted_at)} – ${tm(e.balloon?.removed_at)}`}</td>
                          </tr>
                          <tr>
                            <td>{tick(e.laparotomy_at)}</td>
                            <td>Laparotomy</td>
                            <td>{tm(e.laparotomy_at)}</td>
                          </tr>
                          <tr>
                            <td>{tick(e.procedures?.length)}</td>
                            <td
                              colSpan={2}
                            >{`${words(PROCEDURES, e.procedures)}${e.procedures_other ? ` (${e.procedures_other})` : ""}`}</td>
                          </tr>
                          <tr>
                            <td>{tick(e.hysterectomy_at)}</td>
                            <td>Hysterectomy</td>
                            <td>{tm(e.hysterectomy_at)}</td>
                          </tr>
                        </>
                      ) : (
                        items.map((item) => {
                          const [t, label, value] = bundleLine(item, c);
                          return (
                            <tr key={item.key}>
                              <td>{t}</td>
                              <td>{label}</td>
                              <td>{value}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <h2>Observations</h2>
      <table className="ptable pdoc-table pph-p-obs">
        <thead>
          <tr>
            {[
              "Time",
              "Pulse",
              "BP",
              "RR",
              "SpO2",
              "Urine ml",
              "Cum. loss ml",
              "Crystalloid ml",
              "Colloid ml",
              "Products (unit no.)",
              "Temp",
              "Notes",
            ].map((x) => (
              <th key={x} scope="col">
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatTime(r.at)}</td>
              <td>{val(r.pulse)}</td>
              <td>{r.sbp != null ? `${r.sbp}/${r.dbp}` : "—"}</td>
              <td>{val(r.rr)}</td>
              <td>{val(r.spo2)}</td>
              <td>{val(r.urine_ml)}</td>
              <td>{val(r.cumulative_loss_ml)}</td>
              <td>{val(r.crystalloid_ml)}</td>
              <td>{val(r.colloid_ml)}</td>
              <td>
                {r.products
                  .map((p) => `${p.type} ${p.unit_number}`)
                  .join(", ") || "—"}
              </td>
              <td>{val(r.temp)}</td>
              <td>{r.notes || "—"}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={12}>—</td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="pph-p-end" aria-label="Labs and outcome">
        <div>
          <h2>Labs</h2>
          <table className="ptable pdoc-table">
            <tbody>
              <tr>
                <th scope="row">Hb</th>
                <td>
                  {(c.hb_series ?? [])
                    .filter((x) => !x.cancelled)
                    .map((x) => `${x.value} (${formatTime(x.at)})`)
                    .join(", ") || "—"}
                </td>
              </tr>
              <tr>
                <th scope="row">Platelets · INR · APTT</th>
                <td>{`${val(labs.platelets)} · ${val(labs.inr)} · ${val(labs.aptt)}`}</td>
              </tr>
              <tr>
                <th scope="row">Fibrinogen (g/L)</th>
                <td>{`${val(labs.fibrinogen_g_l)}${(c.prompts ?? []).length ? ` – ${c.prompts.join(" ")}` : ""}`}</td>
              </tr>
              <tr>
                <th scope="row">Calcium · Lactate</th>
                <td>{`${val(labs.calcium)} · ${val(labs.lactate)}`}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2>Outcome</h2>
          <table className="ptable pdoc-table">
            <tbody>
              <tr>
                <th scope="row">Total loss</th>
                <td>{`${val(c.totalLossMl, " ml")}${c.loss ? ` – ${c.loss.words}` : ""}`}</td>
              </tr>
              <tr>
                <th scope="row">Units PRBC · FFP · platelets · cryo</th>
                <td>
                  {["prbc", "ffp", "platelets", "cryo"]
                    .map((k) => val(o.units?.[k]))
                    .join(" · ")}
                </td>
              </tr>
              <tr>
                <th scope="row">Disposition</th>
                <td>{DISPOSITIONS[o.disposition] ?? "—"}</td>
              </tr>
              <tr>
                <th scope="row">Debrief</th>
                <td>
                  {o.debrief_done
                    ? `Done · ${o.debrief_by?.name ?? "—"} · ${tm(o.debrief_at)}`
                    : "—"}
                </td>
              </tr>
              <tr>
                <th scope="row">Near miss (OBG-F-19)</th>
                <td>
                  {c.nearMiss ? words(NEAR_MISS, c.nearMiss.criteria) : "—"}
                </td>
              </tr>
              <tr>
                <th scope="row">Consultant sign-off</th>
                <td>
                  {c.consultantSignoff
                    ? `${c.consultantSignoff.byName} · ${formatDateTime(c.consultantSignoff.at)}`
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      {(c.late ?? []).length > 0 && (
        <p className="pph-p-late">{`Late entry (typed more than 60 minutes after the time): ${c.late.map((l) => l.label).join(", ")}. Paper chart scanned: ${c.paperScans?.length ? "yes" : "no"}.`}</p>
      )}
    </PrintDocument>
  );
}

/** "Print OBG-F-07" and its preview. title: never a patient's name (it can print in the browser's header). */
export function PphPrint({ chart, patient }) {
  const [open, setOpen] = useState(false);
  const lh = useFetch(open ? "/tenant/settings/letterhead" : null);
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen(true)}
      >
        <Printer aria-hidden="true" /> Print OBG-F-07
      </button>
      {open && (
        <PrintPreview
          title="PPH chart OBG-F-07"
          hint="A4 portrait, as the manual's page OBG-F-07."
          onClose={() => setOpen(false)}
          docKey={lh.data ? `pph-${chart.id}` : null}
          pageNumbers
        >
          {lh.data && (
            <PphPrintSheet
              chart={chart}
              patient={patient}
              letterhead={lh.data.letterhead}
            />
          )}
        </PrintPreview>
      )}
    </>
  );
}
