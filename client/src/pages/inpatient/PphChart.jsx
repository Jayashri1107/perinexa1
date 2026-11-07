import { useEffect, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Droplet,
  FileWarning,
  Lock,
  TriangleAlert,
} from "lucide-react";
import { api, newRequestId } from "../../api.js";
import { DateTimeInput } from "../../components/DateTimeInput.jsx";
import {
  fileBody,
  fileProblem,
  fileSize,
} from "../../components/fileUpload.js";
import {
  Alert,
  Field,
  StatusPill,
  formatDateTime,
  formatTime,
} from "../../components/ui.jsx";
import { useFetch } from "../../hooks/useFetch.js";
import { FormDialog } from "../quality/FormDialog.jsx";
import { PphPrint } from "./PphPrint.jsx";
import {
  BUNDLE,
  DELIVERY_MODES,
  DISPOSITIONS,
  LOSS_METHODS,
  NEAR_MISS,
  PPH_CAUSES,
  PPH_FORM,
  PPH_SOURCE,
  PROCEDURES,
  PRODUCTS,
  RISK_FACTORS,
} from "./pphRules.js";

// The PPH chart of a stay (Clinical Requirements Group B, item 15 – Build 15, OBG-F-07 v1.0). Paper first: "Declare
// PPH" (here or on the patient banner) stamps the time; the screen below is laid out like the paper OBG-F-07 for typing
// it in afterwards (within 24 h, the paper scanned) – or live. Times typed more than 60 minutes after the event show
// "Late entry"; the consultant signs off only once the paper scan is attached. Sign-off locks the chart (A5).
// TODO (after Build 8 and Build 15 are merged): A2 "MEOWS frequency set to 5 min" on declaration.

const pad = (n) => String(n).padStart(2, "0");
export const toLocal = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const nowLocal = () => toLocal(new Date());
const iso = (v) => (v ? new Date(v).toISOString() : null);
const str = (v) => (v == null ? "" : String(v));
const LOOK = {
  red: { tone: "high", icon: TriangleAlert, word: "Red" },
  yellow: { tone: "watch", icon: CircleAlert, word: "Amber" },
  normal: { tone: "stable", icon: CircleCheck, word: "Normal" },
};
/** Minutes since a time (whole minutes, never below 0). */
export const minutesSince = (v, now = Date.now()) =>
  Math.max(0, Math.floor((now - new Date(v).getTime()) / 60000));

/** The minutes since declaration, counting while it is shown (A2 – the banner clock). */
export function DeclaredClock({ at }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <StatusPill tone="high" icon={Clock}>
      {`PPH declared ${formatTime(at)} · ${minutesSince(at, now)} min`}
    </StatusPill>
  );
}

const HEADER_KEYS = [
  "delivery_mode",
  "delivery_time",
  "declared_at",
  "declared_by",
  "loss_at_declaration_ml",
  "loss_method",
  "pulse_at_declaration",
  "systolic_at_declaration",
  "help_called_at",
  "consultant",
  "consultant_arrived_at",
  "anaesthetist",
  "anaesthetist_arrived_at",
  "blood_bank_informed_at",
  "cause_4T",
  "risk_factors",
  "recorder",
];
const PEOPLE = ["declared_by", "consultant", "anaesthetist", "recorder"];
const TIMES = [
  "delivery_time",
  "declared_at",
  "help_called_at",
  "consultant_arrived_at",
  "anaesthetist_arrived_at",
  "blood_bank_informed_at",
];
const ESC_TIMES = [
  "massive_haemorrhage_declared_at",
  "to_ot_at",
  "laparotomy_at",
  "hysterectomy_at",
];
const LAB_KEYS = [
  "platelets",
  "inr",
  "aptt",
  "fibrinogen_g_l",
  "calcium",
  "lactate",
];
const UNIT_KEYS = ["prbc", "ffp", "platelets", "cryo"];

/** The form's values from the chart (strings for inputs). */
export function formFrom(c) {
  const h = c.header ?? {};
  const header = Object.fromEntries(
    HEADER_KEYS.map((k) => [
      k,
      PEOPLE.includes(k)
        ? (h[k]?.id ?? "")
        : TIMES.includes(k)
          ? toLocal(k === "declared_at" ? c.declared_at : h[k])
          : Array.isArray(h[k])
            ? h[k]
            : str(h[k]),
    ]),
  );
  const bundle = Object.fromEntries(
    BUNDLE.filter((b) => b.key && b.kind !== "doses").map((b) => {
      const v = c.bundle?.[b.key];
      return [
        b.key,
        b.kind === "time"
          ? toLocal(v)
          : b.kind === "bool"
            ? Boolean(v)
            : b.kind === "multi"
              ? (v ?? [])
              : str(v),
      ];
    }),
  );
  const e = c.escalation ?? {};
  const escalation = {
    ...Object.fromEntries(ESC_TIMES.map((k) => [k, toLocal(e[k])])),
    balloon: {
      inserted_at: toLocal(e.balloon?.inserted_at),
      volume_ml: str(e.balloon?.volume_ml),
      removed_at: toLocal(e.balloon?.removed_at),
    },
    procedures: e.procedures ?? [],
    procedures_other: e.procedures_other ?? "",
  };
  const labs = Object.fromEntries(LAB_KEYS.map((k) => [k, str(c.labs?.[k])]));
  const o = c.outcome ?? {};
  const outcome = {
    total_loss_ml: str(o.total_loss_ml),
    units: Object.fromEntries(UNIT_KEYS.map((k) => [k, str(o.units?.[k])])),
    disposition: o.disposition ?? "",
    debrief_done: Boolean(o.debrief_done),
    debrief_by: o.debrief_by?.id ?? "",
    debrief_at: toLocal(o.debrief_at),
  };
  return { header, bundle, escalation, labs, outcome, declared_at_reason: "" };
}

/** The request body from the form (times back to ISO; declared_at only when it was changed). */
export function bodyFrom(f, c) {
  const header = Object.fromEntries(
    Object.entries(f.header)
      .filter(([k]) => k !== "declared_at")
      .map(([k, v]) => [k, TIMES.includes(k) ? iso(v) : v]),
  );
  const changed =
    f.header.declared_at && f.header.declared_at !== toLocal(c.declared_at);
  if (changed) header.declared_at = iso(f.header.declared_at);
  const bundle = Object.fromEntries(
    BUNDLE.filter((b) => b.key && b.kind !== "doses").map((b) => [
      b.key,
      b.kind === "time" ? iso(f.bundle[b.key]) : f.bundle[b.key],
    ]),
  );
  const e = f.escalation;
  const escalation = {
    ...Object.fromEntries(ESC_TIMES.map((k) => [k, iso(e[k])])),
    balloon: {
      inserted_at: iso(e.balloon.inserted_at),
      volume_ml: e.balloon.volume_ml,
      removed_at: iso(e.balloon.removed_at),
    },
    procedures: e.procedures,
    procedures_other: e.procedures_other,
  };
  const outcome = { ...f.outcome, debrief_at: iso(f.outcome.debrief_at) };
  return {
    header,
    bundle,
    escalation,
    labs: f.labs,
    outcome,
    ...(changed ? { declared_at_reason: f.declared_at_reason } : {}),
  };
}

function LatePill({ show }) {
  if (!show) return null;
  return (
    <StatusPill tone="watch" icon={FileWarning}>
      Late entry
    </StatusPill>
  );
}
function WithinPill({ value }) {
  if (value == null) return null;
  return value ? (
    <StatusPill tone="stable" icon={CircleCheck}>
      Within 15 min
    </StatusPill>
  ) : (
    <StatusPill tone="watch" icon={CircleAlert}>
      After 15 min
    </StatusPill>
  );
}
function Warn({ items }) {
  return (items ?? []).filter(Boolean).map((w) => (
    <p key={w} className="pph-warn">
      <TriangleAlert aria-hidden="true" /> {w}
    </p>
  ));
}

function Checks({ legend, options, value, onChange, disabled, error }) {
  return (
    <fieldset className="fieldset">
      <legend>{legend}</legend>
      <div className="check-grid">
        {Object.entries(options).map(([k, w]) => (
          <label key={k} className="check">
            <input
              type="checkbox"
              disabled={disabled}
              checked={value.includes(k)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, k]
                    : value.filter((x) => x !== k),
                )
              }
            />{" "}
            {w}
          </label>
        ))}
      </div>
      {error && <p className="field-error">{error}</p>}
    </fieldset>
  );
}

/** The F-07 form: header, E-MOTIVE, escalation, labs, outcome – one Save. */
function F07Form({ chart: c, staff, canWrite, onSaved }) {
  const [f, setF] = useState(() => formFrom(c));
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(formFrom(c)), [c]);
  const fe = (k) => error?.fields?.[k];
  const late = new Set(c.lateFields ?? []);
  const set = (section, key) => (e) =>
    setF({
      ...f,
      [section]: {
        ...f[section],
        [key]: e?.target
          ? e.target.type === "checkbox"
            ? e.target.checked
            : e.target.value
          : e,
      },
    });
  const setBalloon = (key) => (e) =>
    setF({
      ...f,
      escalation: {
        ...f.escalation,
        balloon: { ...f.escalation.balloon, [key]: e.target.value },
      },
    });
  const setUnit = (key) => (e) =>
    setF({
      ...f,
      outcome: {
        ...f.outcome,
        units: { ...f.outcome.units, [key]: e.target.value },
      },
    });
  const dis = !canWrite;
  const declaredChanged =
    f.header.declared_at && f.header.declared_at !== toLocal(c.declared_at);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api(`/pph/${c.id}`, {
        method: "PUT",
        body: bodyFrom(f, c),
      });
      setError(null);
      setWarnings(res.warnings ?? []);
      onSaved();
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  const time = (section, key, label, extra = null) => (
    <Field
      label={label}
      id={`pph-${c.id}-${key}`}
      error={fe(`${section}.${key}`)}
    >
      <DateTimeInput
        id={`pph-${c.id}-${key}`}
        value={f[section][key]}
        onChange={set(section, key)}
      />
      <span className="row pph-tags">
        <LatePill show={late.has(`${section}.${key}`)} />
        {extra}
      </span>
    </Field>
  );
  const number = (section, key, label) => (
    <Field
      label={label}
      id={`pph-${c.id}-${key}`}
      error={fe(`${section}.${key}`)}
    >
      <input
        id={`pph-${c.id}-${key}`}
        inputMode="decimal"
        disabled={dis}
        value={f[section][key]}
        onChange={set(section, key)}
      />
    </Field>
  );
  const select = (section, key, label, options) => (
    <Field
      label={label}
      id={`pph-${c.id}-${key}`}
      error={fe(`${section}.${key}`)}
    >
      <select
        id={`pph-${c.id}-${key}`}
        disabled={dis}
        value={f[section][key]}
        onChange={set(section, key)}
      >
        <option value="">Choose…</option>
        {Object.entries(options).map(([k, w]) => (
          <option key={k} value={k}>
            {w}
          </option>
        ))}
      </select>
    </Field>
  );
  const person = (section, key, label, roles) => (
    <Field
      label={label}
      id={`pph-${c.id}-${key}`}
      error={fe(`${section}.${key}`)}
    >
      <select
        id={`pph-${c.id}-${key}`}
        disabled={dis}
        value={f[section][key]}
        onChange={set(section, key)}
      >
        <option value="">Choose…</option>
        {staff
          .filter((s) => !roles || s.roles.some((r) => roles.includes(r)))
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>
    </Field>
  );

  const groups = BUNDLE.filter((b) => !b.key);
  return (
    <form className="stack pph-f07" onSubmit={save}>
      <Alert type="error">{error?.message}</Alert>
      {warnings.length > 0 && (
        <Alert type="warning">
          <Warn items={warnings} />
        </Alert>
      )}
      <fieldset className="fieldset pph-sec" disabled={dis}>
        <legend>Header</legend>
        <div className="form-grid">
          {select("header", "delivery_mode", "Delivery mode", DELIVERY_MODES)}
          {time("header", "delivery_time", "Delivery time")}
          {time("header", "declared_at", "PPH declared")}
          {declaredChanged && (
            <Field
              label="Why the declaration time is changed"
              id={`pph-${c.id}-why`}
              error={fe("declared_at_reason")}
            >
              <input
                id={`pph-${c.id}-why`}
                maxLength={300}
                value={f.declared_at_reason}
                onChange={(e) =>
                  setF({ ...f, declared_at_reason: e.target.value })
                }
              />
            </Field>
          )}
          {person("header", "declared_by", "Declared by")}
          <Field
            label="Loss at declaration (ml)"
            id={`pph-${c.id}-lad`}
            error={fe("header.loss_at_declaration_ml")}
          >
            <input
              id={`pph-${c.id}-lad`}
              inputMode="numeric"
              value={f.header.loss_at_declaration_ml}
              onChange={set("header", "loss_at_declaration_ml")}
            />
            <LatePill show={late.has("header.loss_at_declaration_ml")} />
          </Field>
          {select("header", "loss_method", "Loss method", LOSS_METHODS)}
          {number(
            "header",
            "pulse_at_declaration",
            "Pulse at declaration (/min)",
          )}
          {number(
            "header",
            "systolic_at_declaration",
            "Systolic BP at declaration (mmHg)",
          )}
          <div className="pph-si">
            <span className="ca-cat-label">Shock index at declaration</span>
            {c.shock_index_at_declaration ? (
              <StatusPill
                tone={LOOK[c.shock_index_at_declaration.band].tone}
                icon={LOOK[c.shock_index_at_declaration.band].icon}
              >{`${c.shock_index_at_declaration.value} · ${c.shock_index_at_declaration.band === "red" ? "0.9 or more – red" : "under 0.9"}`}</StatusPill>
            ) : (
              <span className="muted">Pulse ÷ systolic BP</span>
            )}
          </div>
          {time("header", "help_called_at", "Help called")}
          {person("header", "consultant", "Consultant", ["doctor"])}
          {time("header", "consultant_arrived_at", "Consultant arrived")}
          {person("header", "anaesthetist", "Anaesthetist", ["doctor"])}
          {time("header", "anaesthetist_arrived_at", "Anaesthetist arrived")}
          {time("header", "blood_bank_informed_at", "Blood bank informed")}
          {person("header", "recorder", "Recorder")}
        </div>
        <Checks
          legend="Cause (the four Ts)"
          options={PPH_CAUSES}
          value={f.header.cause_4T}
          onChange={set("header", "cause_4T")}
          disabled={dis}
          error={fe("header.cause_4T")}
        />
        <Checks
          legend="Risk factors"
          options={RISK_FACTORS}
          value={f.header.risk_factors}
          onChange={set("header", "risk_factors")}
          disabled={dis}
        />
      </fieldset>

      <fieldset className="fieldset pph-sec" disabled={dis}>
        <legend>E-MOTIVE bundle – each with its time</legend>
        <div className="pph-emotive">
          {groups.map((g) => (
            <div key={g.letter} className="pph-letter">
              <h3>{`${g.letter} – ${g.title}`}</h3>
              {BUNDLE.filter((b) => b.key && b.letter === g.letter).map((b) => {
                if (b.kind === "doses")
                  return (
                    <CarboprostDoses
                      key={b.key}
                      chart={c}
                      canWrite={canWrite}
                      onSaved={onSaved}
                    />
                  );
                const label = b.dose ? `${b.label} – ${b.dose}` : b.label;
                const warn =
                  b.key === "O_ergometrine_at"
                    ? c.warnings?.ergometrine
                    : b.key === "T_txa_1g_at" && c.warnings?.txa
                      ? [c.warnings.txa]
                      : null;
                if (b.kind === "time")
                  return (
                    <div key={b.key}>
                      {time(
                        "bundle",
                        b.key,
                        label,
                        <WithinPill value={c.within15?.[b.key]} />,
                      )}
                      {b.note && <p className="hint">{b.note}</p>}
                      <Warn items={warn} />
                    </div>
                  );
                if (b.kind === "bool")
                  return (
                    <label key={b.key} className="check">
                      <input
                        type="checkbox"
                        disabled={dis}
                        checked={f.bundle[b.key]}
                        onChange={set("bundle", b.key)}
                      />{" "}
                      {b.label}
                    </label>
                  );
                if (b.kind === "number")
                  return (
                    <div key={b.key}>{number("bundle", b.key, b.label)}</div>
                  );
                if (b.kind === "enum")
                  return (
                    <div key={b.key}>
                      {select("bundle", b.key, b.label, b.options)}
                    </div>
                  );
                return (
                  <Checks
                    key={b.key}
                    legend={b.label}
                    options={b.options}
                    value={f.bundle[b.key]}
                    onChange={set("bundle", b.key)}
                    disabled={dis}
                  />
                );
              })}
            </div>
          ))}
          <div className="pph-letter">
            <h3>E – Escalation</h3>
            <p>
              {c.E_escalated ? (
                <StatusPill tone="high" icon={TriangleAlert}>
                  Escalated
                </StatusPill>
              ) : (
                <span className="muted">
                  Set when an escalation field is filled.
                </span>
              )}
            </p>
          </div>
        </div>
      </fieldset>

      <fieldset className="fieldset pph-sec" disabled={dis}>
        <legend>Escalation</legend>
        <div className="form-grid">
          {time(
            "escalation",
            "massive_haemorrhage_declared_at",
            "Massive haemorrhage declared",
          )}
          {time("escalation", "to_ot_at", "To theatre")}
          <Field
            label="Balloon inserted"
            id={`pph-${c.id}-bin`}
            error={fe("escalation.balloon.inserted_at")}
          >
            <DateTimeInput
              id={`pph-${c.id}-bin`}
              value={f.escalation.balloon.inserted_at}
              onChange={setBalloon("inserted_at")}
            />
          </Field>
          <Field
            label="Balloon volume (ml)"
            id={`pph-${c.id}-bvol`}
            error={fe("escalation.balloon.volume_ml")}
          >
            <input
              id={`pph-${c.id}-bvol`}
              inputMode="numeric"
              value={f.escalation.balloon.volume_ml}
              onChange={setBalloon("volume_ml")}
            />
          </Field>
          <Field
            label="Balloon removed"
            id={`pph-${c.id}-bout`}
            error={fe("escalation.balloon.removed_at")}
          >
            <DateTimeInput
              id={`pph-${c.id}-bout`}
              value={f.escalation.balloon.removed_at}
              onChange={setBalloon("removed_at")}
            />
          </Field>
          {time("escalation", "laparotomy_at", "Laparotomy")}
          {time("escalation", "hysterectomy_at", "Hysterectomy")}
        </div>
        <Checks
          legend="Procedures"
          options={PROCEDURES}
          value={f.escalation.procedures}
          onChange={set("escalation", "procedures")}
          disabled={dis}
        />
        {f.escalation.procedures.includes("other") && (
          <Field
            label="Other procedure"
            id={`pph-${c.id}-pother`}
            error={fe("escalation.procedures_other")}
          >
            <input
              id={`pph-${c.id}-pother`}
              maxLength={200}
              value={f.escalation.procedures_other}
              onChange={set("escalation", "procedures_other")}
            />
          </Field>
        )}
        {c.massive && (
          <p className="pph-note">{`Massive haemorrhage: the Director was told (notification bell); blood bank pack request recorded ${formatDateTime(c.massive.packRequestedAt)} by ${c.massive.requestedByName}. See ANA-ALG-06 (massive haemorrhage) in the manual.`}</p>
        )}
      </fieldset>

      <fieldset className="fieldset pph-sec" disabled={dis}>
        <legend>Labs</legend>
        <div className="form-grid">
          {number("labs", "platelets", "Platelets (×10⁹/L)")}
          {number("labs", "inr", "INR")}
          {number("labs", "aptt", "APTT (s)")}
          {number("labs", "fibrinogen_g_l", "Fibrinogen (g/L)")}
          {number("labs", "calcium", "Calcium (mmol/L)")}
          {number("labs", "lactate", "Lactate (mmol/L)")}
        </div>
        <Warn items={c.prompts} />
      </fieldset>

      <fieldset className="fieldset pph-sec" disabled={dis}>
        <legend>Outcome</legend>
        <div className="form-grid">
          {number("outcome", "total_loss_ml", "Total loss (ml)")}
          {UNIT_KEYS.map((k) => (
            <Field
              key={k}
              label={`Units – ${k === "prbc" ? "PRBC" : k === "ffp" ? "FFP" : k === "cryo" ? "cryo" : "platelets"}`}
              id={`pph-${c.id}-u-${k}`}
              hint={`From the rows: ${c.productsCounted?.[k] ?? 0}`}
              keepHint
            >
              <input
                id={`pph-${c.id}-u-${k}`}
                inputMode="numeric"
                value={f.outcome.units[k]}
                onChange={setUnit(k)}
              />
            </Field>
          ))}
          {select("outcome", "disposition", "Disposition", DISPOSITIONS)}
          <label className="check">
            <input
              type="checkbox"
              checked={f.outcome.debrief_done}
              onChange={set("outcome", "debrief_done")}
            />{" "}
            Debrief done
          </label>
          {person("outcome", "debrief_by", "Debrief by")}
          {time("outcome", "debrief_at", "Debrief at")}
        </div>
      </fieldset>
      {canWrite && (
        <div className="row">
          <button type="submit" className="btn btn-secondary" disabled={busy}>
            {busy ? "Saving…" : "Save the chart"}
          </button>
        </div>
      )}
    </form>
  );
}

function CarboprostDoses({ chart: c, canWrite, onSaved }) {
  const [at, setAt] = useState(nowLocal);
  const [error, setError] = useState(null);
  const doses = c.carboprost ?? [];
  const add = async () => {
    try {
      await api(`/pph/${c.id}/lines`, {
        method: "POST",
        body: { type: "carboprost", at: iso(at) },
      });
      setError(null);
      onSaved();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <div className="pph-doses">
      <strong>Carboprost</strong>
      <p className="hint">
        Each dose at least 15 minutes after the one before; at most 8 doses.
      </p>
      <Warn items={c.warnings?.carboprost} />
      <ol>
        {doses.map((d) => (
          <li key={d.id} className={d.cancelled ? "ca-empty" : undefined}>
            {d.cancelled ? <s>{formatDateTime(d.at)}</s> : formatDateTime(d.at)}{" "}
            <WithinPill value={d.cancelled ? null : d.within15} />{" "}
            <LatePill show={d.late && !d.cancelled} />
            {canWrite && !d.cancelled && (
              <CancelLine chart={c} lineId={d.id} onDone={onSaved} />
            )}
          </li>
        ))}
      </ol>
      {canWrite && (
        <div className="row">
          <Field
            label="Dose given at"
            id={`pph-${c.id}-carbo`}
            error={error?.fields?.at}
          >
            <DateTimeInput
              id={`pph-${c.id}-carbo`}
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </Field>
          <button type="button" className="btn btn-secondary" onClick={add}>
            Add the dose
          </button>
        </div>
      )}
    </div>
  );
}

function CancelLine({ chart, lineId, onDone }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-link btn-sm"
        onClick={() => setOpen(true)}
      >
        Entered in error
      </button>
      {open && (
        <ReasonDialog
          title="Mark this line as entered in error"
          path={`/pph/${chart.id}/lines/${lineId}/cancel`}
          onDone={() => {
            setOpen(false);
            onDone();
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

const EMPTY_ROW = () => ({
  at: nowLocal(),
  pulse: "",
  sbp: "",
  dbp: "",
  rr: "",
  spo2: "",
  urine_ml: "",
  cumulative_loss_ml: "",
  crystalloid_ml: "",
  colloid_ml: "",
  temp: "",
  notes: "",
});
const ROW_FIELDS = [
  ["pulse", "Pulse"],
  ["sbp", "Systolic BP"],
  ["dbp", "Diastolic BP"],
  ["rr", "RR"],
  ["spo2", "SpO2 %"],
  ["urine_ml", "Urine ml"],
  ["cumulative_loss_ml", "Cumulative loss ml"],
  ["crystalloid_ml", "Crystalloid ml"],
  ["colloid_ml", "Colloid ml"],
  ["temp", "Temp °C"],
];

function ObservationRows({ chart: c, canWrite, onSaved }) {
  const [f, setF] = useState(EMPTY_ROW);
  const [products, setProducts] = useState([]);
  const [witness, setWitness] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = c.observations ?? [];
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        type: "obs",
        ...f,
        at: iso(f.at),
        products: products.map((p) => ({ ...p, issued_at: iso(p.issued_at) })),
      };
      if (products.length) body.witness = witness;
      await api(`/pph/${c.id}/lines`, { method: "POST", body });
      setF(EMPTY_ROW());
      setProducts([]);
      setWitness({ email: "", password: "" });
      setError(null);
      onSaved();
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };
  return (
    <section className="stack pph-sec" aria-label="Observations">
      <h3>Observations – every 5 to 15 minutes until stable</h3>
      <div className="an-table-wrap">
        <table className="ca-table pph-obs">
          <thead>
            <tr>
              <th scope="col">Time</th>
              {ROW_FIELDS.map(([, w]) => (
                <th key={w} scope="col">
                  {w}
                </th>
              ))}
              <th scope="col">Products</th>
              <th scope="col">Notes</th>
              <th scope="col">Typed by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.cancelled ? "ca-empty" : undefined}>
                <td data-label="Time">
                  {formatTime(r.at)} <LatePill show={r.late && !r.cancelled} />
                </td>
                {ROW_FIELDS.map(([k, w]) => (
                  <td key={k} data-label={w}>
                    {r[k] ?? "–"}
                  </td>
                ))}
                <td data-label="Products">
                  {r.products
                    .map(
                      (p) =>
                        `${p.type} ${p.unit_number}${p.two_person_check ? ` (checked by ${p.two_person_check.byName})` : ""}`,
                    )
                    .join(", ") || "–"}
                </td>
                <td data-label="Notes">
                  {r.notes}
                  {r.shock && !r.cancelled && (
                    <StatusPill
                      tone={LOOK[r.shock.band].tone}
                      icon={LOOK[r.shock.band].icon}
                    >{`Shock index ${r.shock.value} · ${LOOK[r.shock.band].word}`}</StatusPill>
                  )}
                  {r.cancelled && (
                    <span className="ca-group-words">{`Entered in error: ${r.cancelled.reason}`}</span>
                  )}
                </td>
                <td data-label="Typed by">
                  {r.byName}
                  {canWrite && !r.cancelled && (
                    <CancelLine chart={c} lineId={r.id} onDone={onSaved} />
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={ROW_FIELDS.length + 4} className="muted">
                  No rows yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canWrite && (
        <form className="stack" onSubmit={add}>
          <Alert type="error">{error?.message}</Alert>
          <div className="form-grid">
            <Field
              label="Time"
              id={`pph-${c.id}-rat`}
              error={error?.fields?.at}
            >
              <DateTimeInput
                id={`pph-${c.id}-rat`}
                value={f.at}
                onChange={(e) => setF({ ...f, at: e.target.value })}
              />
            </Field>
            {ROW_FIELDS.map(([k, w]) => (
              <Field
                key={k}
                label={w}
                id={`pph-${c.id}-r-${k}`}
                error={error?.fields?.[k]}
              >
                <input
                  id={`pph-${c.id}-r-${k}`}
                  inputMode="decimal"
                  value={f[k]}
                  onChange={(e) => setF({ ...f, [k]: e.target.value })}
                />
              </Field>
            ))}
            <Field
              label="Notes"
              id={`pph-${c.id}-r-notes`}
              error={error?.fields?.notes}
            >
              <input
                id={`pph-${c.id}-r-notes`}
                maxLength={300}
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
              />
            </Field>
          </div>
          {products.map((p, i) => (
            <div key={i} className="form-grid pph-product">
              <Field label="Product" id={`pph-${c.id}-p${i}-t`}>
                <select
                  id={`pph-${c.id}-p${i}-t`}
                  value={p.type}
                  onChange={(e) =>
                    setProducts(
                      products.map((x, j) =>
                        j === i ? { ...x, type: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {Object.entries(PRODUCTS).map(([k, w]) => (
                    <option key={k} value={k}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Unit number" id={`pph-${c.id}-p${i}-n`}>
                <input
                  id={`pph-${c.id}-p${i}-n`}
                  maxLength={40}
                  value={p.unit_number}
                  onChange={(e) =>
                    setProducts(
                      products.map((x, j) =>
                        j === i ? { ...x, unit_number: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Issued at" id={`pph-${c.id}-p${i}-at`}>
                <DateTimeInput
                  id={`pph-${c.id}-p${i}-at`}
                  value={p.issued_at}
                  onChange={(e) =>
                    setProducts(
                      products.map((x, j) =>
                        j === i ? { ...x, issued_at: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
              <button
                type="button"
                className="btn btn-link"
                onClick={() => setProducts(products.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          {products.length > 0 && (
            <div className="form-grid">
              <p className="hint">
                Blood products: a second person checks each unit (PX-X-06) and
                types their own email and password.
              </p>
              <Field
                label="Second person’s email"
                id={`pph-${c.id}-w-e`}
                error={error?.fields?.["witness.email"]}
              >
                <input
                  id={`pph-${c.id}-w-e`}
                  type="email"
                  autoComplete="off"
                  value={witness.email}
                  onChange={(e) =>
                    setWitness({ ...witness, email: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Second person’s password"
                id={`pph-${c.id}-w-p`}
                error={error?.fields?.["witness.password"]}
              >
                <input
                  id={`pph-${c.id}-w-p`}
                  type="password"
                  autoComplete="new-password"
                  value={witness.password}
                  onChange={(e) =>
                    setWitness({ ...witness, password: e.target.value })
                  }
                />
              </Field>
            </div>
          )}
          <div className="row">
            <button
              type="button"
              className="btn btn-link"
              onClick={() =>
                setProducts([
                  ...products,
                  { type: "PRBC", unit_number: "", issued_at: f.at },
                ])
              }
            >
              Add a blood product
            </button>
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              {busy ? "Saving…" : "Add the row"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function HbSeries({ chart: c, canWrite, onSaved }) {
  const [f, setF] = useState({ at: nowLocal(), value: "" });
  const [error, setError] = useState(null);
  const add = async () => {
    try {
      await api(`/pph/${c.id}/lines`, {
        method: "POST",
        body: { type: "hb", at: iso(f.at), value: f.value },
      });
      setF({ at: nowLocal(), value: "" });
      setError(null);
      onSaved();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <section className="stack pph-sec" aria-label="Hb series">
      <h3>Hb series</h3>
      <p>
        {(c.hb_series ?? []).map((x) => (
          <span key={x.id} className={x.cancelled ? "ca-empty" : undefined}>
            {x.cancelled ? (
              <s>{`${x.value} g/dL at ${formatTime(x.at)}`}</s>
            ) : (
              `${x.value} g/dL at ${formatTime(x.at)}`
            )}{" "}
            <LatePill show={x.late && !x.cancelled} />
            {canWrite && !x.cancelled && (
              <CancelLine chart={c} lineId={x.id} onDone={onSaved} />
            )}{" "}
          </span>
        ))}
        {!(c.hb_series ?? []).length && (
          <span className="muted">None yet.</span>
        )}
      </p>
      {canWrite && (
        <div className="row">
          <Field label="Time" id={`pph-${c.id}-hbat`} error={error?.fields?.at}>
            <DateTimeInput
              id={`pph-${c.id}-hbat`}
              value={f.at}
              onChange={(e) => setF({ ...f, at: e.target.value })}
            />
          </Field>
          <Field
            label="Hb (g/dL)"
            id={`pph-${c.id}-hb`}
            error={error?.fields?.value}
          >
            <input
              id={`pph-${c.id}-hb`}
              inputMode="decimal"
              value={f.value}
              onChange={(e) => setF({ ...f, value: e.target.value })}
            />
          </Field>
          <button type="button" className="btn btn-secondary" onClick={add}>
            Add Hb
          </button>
        </div>
      )}
    </section>
  );
}

function PaperScan({ chart: c, canWrite, onSaved }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await api(`/pph/${c.id}/scans`, {
        method: "POST",
        body: await fileBody(file),
      });
      setError(null);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  return (
    <div className="stack">
      <strong>Scan of the paper OBG-F-07</strong>
      {(c.paperScans ?? []).map((s) => (
        <a
          key={s.fileId}
          href={`/api/pph/${c.id}/scans/${s.fileId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="t-caption"
        >
          {`${s.fileName} (${fileSize(s.size)}) – ${s.byName}, ${formatDateTime(s.at)}`}
        </a>
      ))}
      {!(c.paperScans ?? []).length && (
        <span className="muted">No scan attached.</span>
      )}
      <Alert type="error">{error}</Alert>
      {canWrite && (
        <label className="btn btn-secondary">
          {busy ? "Attaching…" : "Attach the scan (PDF or photo)"}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            hidden
            onChange={upload}
            disabled={busy}
          />
        </label>
      )}
    </div>
  );
}

function SignOff({ chart: c, access, onSaved }) {
  const [error, setError] = useState(null);
  const late = c.late ?? [];
  const missing = Object.values(c.missing ?? {});
  const sign = async () => {
    try {
      await api(`/pph/${c.id}/signoff`, { method: "POST", body: {} });
      setError(null);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <section className="stack pph-sec" aria-label="Consultant sign-off">
      <h3>Late entry and consultant sign-off</h3>
      {late.length > 0 ? (
        <>
          <p>
            <StatusPill
              tone="watch"
              icon={FileWarning}
            >{`Late entry – ${late.length}`}</StatusPill>{" "}
            Typed more than 60 minutes after the time:{" "}
            {late.map((l) => l.label).join(", ")}. The scan of the paper chart
            is needed before sign-off.
          </p>
        </>
      ) : (
        <p className="muted">No late entry.</p>
      )}
      <PaperScan chart={c} canWrite={access.write} onSaved={onSaved} />
      {c.consultantSignoff ? (
        <p>
          <StatusPill
            tone="stable"
            icon={Lock}
          >{`Signed off by ${c.consultantSignoff.byName}, ${formatDateTime(c.consultantSignoff.at)} – locked`}</StatusPill>
        </p>
      ) : (
        <>
          {missing.length > 0 && (
            <p className="hint">{`Before sign-off: ${missing.join("; ")}.`}</p>
          )}
          <Alert type="error">{error}</Alert>
          {access.sign && (
            <div className="row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={sign}
              >
                Sign off and lock (consultant)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ReasonDialog({ title, path, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api(path, { method: "POST", body: { reason } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog
      id="pph-reason"
      title={title}
      submitLabel="Mark as entered in error"
      onSubmit={submit}
      onCancel={onCancel}
    >
      <p>It stays on the chart, struck through, with your reason.</p>
      <Alert type="error">{error?.message}</Alert>
      <Field label="Why" id="pph-why" error={error?.fields?.reason}>
        <input
          id="pph-why"
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

function Summary({ chart: c }) {
  const open = c.status === "open" && !c.cancelled;
  const kpi = c.kpi ?? {};
  return (
    <div className="ca-cats pph-sum">
      <div className="ca-cat">
        <span className="ca-cat-label">Blood loss</span>
        <span className="ca-cat-value">
          {c.totalLossMl != null ? `${c.totalLossMl} ml` : "–"}
        </span>
        {c.loss && (
          <StatusPill
            tone={LOOK[c.loss.band].tone}
            icon={LOOK[c.loss.band].icon}
          >
            {c.loss.words}
          </StatusPill>
        )}
      </div>
      <div className="ca-cat">
        <span className="ca-cat-label">Declared</span>
        {open && c.declared_at ? (
          <DeclaredClock at={c.declared_at} />
        ) : (
          <span className="ca-cat-value">
            {c.declared_at ? formatDateTime(c.declared_at) : "–"}
          </span>
        )}
      </div>
      <div className="ca-cat">
        <span className="ca-cat-label">
          TXA and second uterotonic within 15 min
        </span>
        <StatusPill
          tone={
            kpi.txa_within_15_min && kpi.second_uterotonic_within_15_min
              ? "stable"
              : "watch"
          }
          icon={
            kpi.txa_within_15_min && kpi.second_uterotonic_within_15_min
              ? CircleCheck
              : CircleAlert
          }
        >
          {`TXA ${kpi.txa_within_15_min ? "yes" : "no"} · second uterotonic ${kpi.second_uterotonic_within_15_min ? "yes" : "no"}${c.kpiLocked ? " (kept at sign-off)" : ""}`}
        </StatusPill>
      </div>
      {c.nearMiss && (
        <div className="ca-cat">
          <span className="ca-cat-label">Near miss (OBG-F-19)</span>
          <StatusPill
            tone="high"
            icon={TriangleAlert}
          >{`Review ${c.nearMiss.serial} started · ${c.nearMiss.criteria.map((k) => NEAR_MISS[k]).join("; ")}`}</StatusPill>
          <span className="hint">
            {c.mm
              ? `On the M&M list – review by ${formatDateTime(c.mm.reviewBy)}`
              : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function Episode({ chart: c, patient, staff, reload }) {
  const [cancelling, setCancelling] = useState(false);
  const access = c.access ?? { write: false, sign: false };
  if (c.draftChart)
    return (
      <div className="pph-chart stack ca-empty">
        <strong>{`Earlier DRAFT chart${c.declared_at ? `, ${formatDateTime(c.declared_at)}` : ""}`}</strong>
        <p className="muted">
          Started before OBG-F-07 was given (fake data only). Kept as it was;
          declare a new PPH to use OBG-F-07.
        </p>
      </div>
    );
  return (
    <div className={`pph-chart stack ${c.cancelled ? "ca-empty" : ""}`.trim()}>
      <div className="item-editor-head">
        <strong>{`OBG-F-07 · declared ${formatDateTime(c.declared_at)} by ${c.header?.declared_by?.name ?? "–"}`}</strong>
        <span className="row">
          {c.cancelled ? (
            <StatusPill tone="inactive">{`Entered in error: ${c.cancelled.reason}`}</StatusPill>
          ) : c.status === "closed" ? (
            <StatusPill tone="stable" icon={Lock}>
              Signed off – locked
            </StatusPill>
          ) : (
            <StatusPill tone="due" icon={Droplet}>
              Open
            </StatusPill>
          )}
          <PphPrint chart={c} patient={patient} />
        </span>
      </div>
      <Summary chart={c} />
      <F07Form
        chart={c}
        staff={staff}
        canWrite={access.write}
        onSaved={reload}
      />
      <ObservationRows chart={c} canWrite={access.write} onSaved={reload} />
      <HbSeries chart={c} canWrite={access.write} onSaved={reload} />
      {!c.cancelled && <SignOff chart={c} access={access} onSaved={reload} />}
      {access.write && (
        <div className="row">
          <button
            type="button"
            className="btn btn-link"
            onClick={() => setCancelling(true)}
          >
            Declared by mistake
          </button>
        </div>
      )}
      {cancelling && (
        <ReasonDialog
          title="Mark this PPH chart as entered in error"
          path={`/pph/${c.id}/cancel`}
          onDone={() => {
            setCancelling(false);
            reload();
          }}
          onCancel={() => setCancelling(false)}
        />
      )}
    </div>
  );
}

/** "Declare PPH": one tap stamps the time now. */
export async function declarePph(patientId, admissionId) {
  return api("/pph", {
    method: "POST",
    body: { clientRequestId: newRequestId(), patientId, admissionId },
  });
}

/** Typing in a paper chart afterwards: the declaration time from the paper. */
function TranscribeDialog({ patient, admissionId, onDone, onCancel }) {
  const [at, setAt] = useState("");
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState(null);
  const submit = async () => {
    try {
      await api("/pph", {
        method: "POST",
        body: {
          clientRequestId: requestId,
          patientId: patient.id,
          admissionId,
          declared_at: iso(at),
        },
      });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <FormDialog
      id="pph-transcribe"
      title="Type in a paper OBG-F-07"
      submitLabel="Start the transcription"
      onSubmit={submit}
      onCancel={onCancel}
    >
      <p>
        Within 24 hours of the event. Times typed more than 60 minutes after
        they happened show as late entry; attach the scan of the paper before
        the consultant signs off.
      </p>
      <Alert type="error">{error?.message}</Alert>
      <Field
        label="PPH declared (from the paper)"
        id="pph-tr-at"
        error={error?.fields?.declared_at}
      >
        <DateTimeInput
          id="pph-tr-at"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

export function PphChartSection({ patient, admissionId }) {
  const skip = patient.careType === "newborn";
  const { data, error, reload } = useFetch(skip ? null : "/pph", {
    patientId: patient.id,
    admissionId,
  });
  const [transcribing, setTranscribing] = useState(false);
  const [problem, setProblem] = useState(null);
  if (skip) return null;
  const hasOpen = data?.charts.some((c) => c.status === "open" && !c.cancelled);
  const declare = async () => {
    try {
      await declarePph(patient.id, admissionId);
      setProblem(null);
      reload();
    } catch (err) {
      setProblem(err.message);
    }
  };
  return (
    <section className="card" aria-labelledby="pph-title">
      <div className="item-editor-head">
        <h2 id="pph-title">{`PPH chart (${PPH_FORM.code})`}</h2>
        {data?.access.start && !hasOpen && (
          <span className="row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={declare}
            >
              <Droplet aria-hidden="true" /> Declare PPH
            </button>
            <button
              type="button"
              className="btn btn-link"
              onClick={() => setTranscribing(true)}
            >
              Type in a paper chart
            </button>
          </span>
        )}
      </div>
      <Alert type="error">{error ?? problem}</Alert>
      {data && !data.charts.length && (
        <p className="muted">
          No PPH on this stay. Declare PPH stamps the time now; the rest can be
          typed in from the paper OBG-F-07 afterwards.
        </p>
      )}
      <div className="stack">
        {(data?.charts ?? []).map((c) => (
          <Episode
            key={c.id}
            chart={c}
            patient={patient}
            staff={data.staff ?? []}
            reload={reload}
          />
        ))}
      </div>
      <p className="muted small">{`Source: ${PPH_SOURCE}. Doses shown are those of OBG-F-07; contraindication checks are warnings only.`}</p>
      {transcribing && (
        <TranscribeDialog
          patient={patient}
          admissionId={admissionId}
          onCancel={() => setTranscribing(false)}
          onDone={() => {
            setTranscribing(false);
            reload();
          }}
        />
      )}
    </section>
  );
}
