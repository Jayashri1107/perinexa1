// The PPH chart – postpartum haemorrhage management and blood-loss chart (Clinical Requirements Group B, item 15 –
// PX-OBG-12, Build 15). From the manual's field schema docs/field_schemas/build15_pph.json (OBG-F-07 v1.0, OBG-SOP-09
// §3–5, OBG-ALG-01), approved by the owner as clinical content (7 Nov 2026, through the developer): the fields, the
// E-MOTIVE bundle with its fixed doses, the loss bands, the shock index, the automations A1–A5 and the KPI fields.
// Paper first: the bedside one-tap "Declare PPH" stamps declared_at; the rest is typed in from the paper OBG-F-07
// (within 24 h, paper scanned) or live. The chart records, adds up, warns and blocks only where the schema says so.
// The website keeps the same tables (client/src/pages/inpatient/pphRules.js); a server test checks both copies.
// TODO (after Build 8 and Build 15 are merged): A2 "MEOWS frequency set to 5 min" – not wired here (the MEOWS chart
// belongs to Build 8).

export const PPH_FORM = {
  code: "OBG-F-07",
  version: "1.0",
  title: "PPH management and blood-loss chart",
  footer: "OBG-F-07 · v1.0",
};
export const PPH_SOURCE =
  "OBG-F-07 v1.0, OBG-SOP-09 §3–5, OBG-ALG-01 (field schema build15_pph.json, 6 Nov 2026) – approved by the owner, 7 Nov 2026";

export const DELIVERY_MODES = {
  vaginal: "Vaginal",
  instrumental: "Instrumental",
  lscs: "Caesarean (LSCS)",
};
export const LOSS_METHODS = {
  calibrated_drape: "Calibrated drape",
  weighed_swabs: "Weighed swabs",
  estimated: "Estimated",
};
export const PPH_CAUSES = {
  tone: "Tone",
  trauma: "Trauma",
  tissue: "Tissue",
  thrombin: "Thrombin",
};
export const RISK_FACTORS = {
  previous_pph: "Previous PPH",
  praevia_accreta: "Placenta praevia or accreta",
  multiple: "Multiple pregnancy",
  polyhydramnios: "Polyhydramnios",
  macrosomia: "Macrosomia",
  grand_multipara: "Grand multipara",
  fibroids: "Fibroids",
  anticoagulant: "On anticoagulants",
  coagulopathy: "Coagulopathy",
  pre_eclampsia: "Pre-eclampsia",
  prolonged_or_induced_labour: "Prolonged or induced labour",
  chorioamnionitis: "Chorioamnionitis",
  anaemia: "Anaemia",
  none: "None",
};
export const BLOODS_ITEMS = {
  cbc: "CBC",
  coag: "Coagulation",
  fibrinogen: "Fibrinogen",
  crossmatch_units: "Cross-match",
};
export const PLACENTA = {
  complete: "Complete",
  incomplete_explored: "Incomplete – explored",
  retained_mrop: "Retained – MROP",
  accreta: "Accreta",
};
export const PROCEDURES = {
  b_lynch: "B-Lynch suture",
  uterine_artery_ligation: "Uterine artery ligation",
  internal_iliac_ligation: "Internal iliac ligation",
  hysterectomy_subtotal: "Hysterectomy – subtotal",
  hysterectomy_total: "Hysterectomy – total",
  other: "Other",
};
export const PRODUCTS = {
  PRBC: "Packed red cells",
  FFP: "Fresh frozen plasma",
  platelets: "Platelets",
  cryo: "Cryoprecipitate",
};
export const DISPOSITIONS = {
  ward: "Ward",
  hdu: "HDU",
  icu: "ICU",
  transferred: "Transferred",
  death: "Death",
};

// The E-MOTIVE bundle (OBG-F-07): each item ticked with its time; "within 15 min of declared_at" worked out for each
// timed item. dose: printed beside it (schema doses, approved). kind: time | bool | number | enum | multi.
export const BUNDLE = [
  { letter: "M", title: "Massage" },
  {
    key: "M_uterine_massage_at",
    letter: "M",
    kind: "time",
    label: "Uterine massage",
  },
  {
    key: "M_bladder_emptied_at",
    letter: "M",
    kind: "time",
    label: "Bladder emptied",
  },
  {
    key: "M_bimanual_compression_at",
    letter: "M",
    kind: "time",
    label: "Bimanual compression",
  },
  { letter: "O", title: "Oxytocics" },
  {
    key: "O_oxytocin_10iu_im_at",
    letter: "O",
    kind: "time",
    label: "Oxytocin",
    dose: "10 IU IM",
  },
  {
    key: "O_oxytocin_infusion_at",
    letter: "O",
    kind: "time",
    label: "Oxytocin infusion",
    dose: "20–40 IU in 500 ml at 125–250 ml/h",
  },
  {
    key: "O_carboprost_doses",
    letter: "O",
    kind: "doses",
    label: "Carboprost",
    note: "Each dose at least 15 minutes after the one before; at most 8 doses",
  },
  { key: "O_ergometrine_at", letter: "O", kind: "time", label: "Ergometrine" },
  {
    key: "O_misoprostol_800_at",
    letter: "O",
    kind: "time",
    label: "Misoprostol",
    dose: "800 micrograms",
  },
  { letter: "T", title: "Tranexamic acid" },
  {
    key: "T_txa_1g_at",
    letter: "T",
    kind: "time",
    label: "Tranexamic acid",
    dose: "1 g",
    note: "Within 3 hours of birth",
  },
  {
    key: "T_txa_repeat_at",
    letter: "T",
    kind: "time",
    label: "Tranexamic acid – repeat",
    dose: "1 g",
    note: "Not before the first dose + 30 minutes",
  },
  { letter: "I", title: "IV access and investigations" },
  {
    key: "I_iv_access_x2_at",
    letter: "I",
    kind: "time",
    label: "Two IV lines",
  },
  { key: "I_bloods_sent_at", letter: "I", kind: "time", label: "Bloods sent" },
  {
    key: "I_bloods_items",
    letter: "I",
    kind: "multi",
    label: "Bloods",
    options: BLOODS_ITEMS,
  },
  {
    key: "I_crossmatch_units",
    letter: "I",
    kind: "number",
    label: "Units cross-matched",
    min: 0,
    max: 30,
  },
  {
    key: "I_crystalloid_ml",
    letter: "I",
    kind: "number",
    label: "Crystalloid (ml)",
    min: 0,
    max: 20000,
  },
  {
    key: "I_oxygen_started",
    letter: "I",
    kind: "bool",
    label: "Oxygen started",
  },
  { key: "I_catheter", letter: "I", kind: "bool", label: "Urinary catheter" },
  { key: "I_warming", letter: "I", kind: "bool", label: "Warming" },
  { letter: "V", title: "Vaginal examination" },
  {
    key: "V_placenta_complete",
    letter: "V",
    kind: "enum",
    label: "Placenta",
    options: PLACENTA,
  },
  {
    key: "V_genital_tract_inspected",
    letter: "V",
    kind: "bool",
    label: "Genital tract inspected",
  },
  { key: "V_repair_done", letter: "V", kind: "bool", label: "Repair done" },
  {
    key: "V_inversion_replaced_at",
    letter: "V",
    kind: "time",
    label: "Inversion replaced",
  },
];
export const BUNDLE_ITEMS = BUNDLE.filter((b) => b.key);
export const BUNDLE_TIME_KEYS = BUNDLE_ITEMS.filter(
  (b) => b.kind === "time",
).map((b) => b.key);

// Header and escalation fields with a time of their own (each is checked for late entry and shown with its time).
export const HEADER_TIME_KEYS = [
  "delivery_time",
  "help_called_at",
  "consultant_arrived_at",
  "anaesthetist_arrived_at",
  "blood_bank_informed_at",
];
export const ESCALATION_TIME_KEYS = [
  "massive_haemorrhage_declared_at",
  "to_ot_at",
  "laparotomy_at",
  "hysterectomy_at",
];
export const BALLOON_TIME_KEYS = ["inserted_at", "removed_at"];
// Fields that belong to the moment of declaration: their clinical time is declared_at.
export const DECLARATION_KEYS = [
  "loss_at_declaration_ml",
  "loss_method",
  "pulse_at_declaration",
  "systolic_at_declaration",
];

export const FIELD_LABELS = {
  declared_at: "PPH declared",
  delivery_time: "Delivery time",
  help_called_at: "Help called",
  consultant_arrived_at: "Consultant arrived",
  anaesthetist_arrived_at: "Anaesthetist arrived",
  blood_bank_informed_at: "Blood bank informed",
  loss_at_declaration_ml: "Loss at declaration",
  loss_method: "Loss method",
  pulse_at_declaration: "Pulse at declaration",
  systolic_at_declaration: "Systolic BP at declaration",
  massive_haemorrhage_declared_at: "Massive haemorrhage declared",
  to_ot_at: "To theatre",
  laparotomy_at: "Laparotomy",
  hysterectomy_at: "Hysterectomy",
  "balloon.inserted_at": "Balloon inserted",
  "balloon.removed_at": "Balloon removed",
  debrief_at: "Debrief",
  observation: "Observation row",
  carboprost: "Carboprost dose",
  hb: "Hb result",
  product: "Blood product issued",
  ...Object.fromEntries(BUNDLE_ITEMS.map((b) => [b.key, b.label])),
};

const MIN = 60 * 1000;
const t = (v) => (v == null || v === "" ? null : new Date(v).getTime());

// Within 15 minutes of declared_at (the KPI formula: item time − declared_at ≤ 15 min).
export const WITHIN_MIN = 15;
/** Is this time within 15 minutes of the declaration? null when either is missing. PURE. */
export function within15(at, declaredAt) {
  if (t(at) == null || t(declaredAt) == null) return null;
  return t(at) - t(declaredAt) <= WITHIN_MIN * MIN;
}

// Blood loss (OBG-F-07): 500–999 | 1000–1499 | 1500 or more (severe).
/** The PPH category of a blood loss: { key, band, words }, or null without an amount. PURE. */
export function lossBand(ml) {
  if (ml == null || ml === "" || !Number.isFinite(Number(ml))) return null;
  const v = Number(ml);
  if (v >= 1500)
    return {
      key: "severe",
      band: "red",
      words: "Severe PPH – 1500 ml or more",
    };
  if (v >= 1000)
    return { key: "1000_1499", band: "red", words: "PPH 1000–1499 ml" };
  if (v >= 500)
    return { key: "500_999", band: "yellow", words: "PPH 500–999 ml" };
  return { key: "under_500", band: "normal", words: "Under 500 ml" };
}
export const pphCategory = (ml) => lossBand(ml)?.key ?? null;

// Shock index = pulse ÷ systolic BP; 0.9 or more is red (OBG-F-07).
export const SHOCK_RED = 0.9;
/** The shock index (two decimals) and its band, or null without both readings. PURE. */
export function shockIndex(pulse, sbp) {
  if (
    pulse == null ||
    pulse === "" ||
    sbp == null ||
    sbp === "" ||
    !Number(sbp)
  )
    return null;
  const value = Math.round((Number(pulse) / Number(sbp)) * 100) / 100;
  return { value, band: value >= SHOCK_RED ? "red" : "normal" };
}

// A3 – carboprost: a dose less than 15 minutes from another, or a 9th dose, is refused.
export const CARBOPROST_MAX = 8;
export const CARBOPROST_INTERVAL_MIN = 15;
/** Why this carboprost dose is refused (A3), or null. doses: the times of the doses already recorded. PURE. */
export function carboprostBlock(doses, at) {
  const times = (doses ?? []).map(t).filter((x) => x != null);
  if (times.length >= CARBOPROST_MAX)
    return `A 9th dose of carboprost is not allowed – at most ${CARBOPROST_MAX} doses.`;
  const near = times.find(
    (d) => Math.abs(d - t(at)) < CARBOPROST_INTERVAL_MIN * MIN,
  );
  if (near != null)
    return `Less than ${CARBOPROST_INTERVAL_MIN} minutes from the carboprost dose before – each dose at least ${CARBOPROST_INTERVAL_MIN} minutes apart.`;
  return null;
}

// Tranexamic acid: the first dose within 3 hours of birth (a warning if later); the repeat not before first + 30 min.
export const TXA_WINDOW_MIN = 180;
export const TXA_REPEAT_MIN = 30;
/** Why the repeat dose is refused, or null. PURE. */
export function txaRepeatBlock(firstAt, repeatAt) {
  if (t(repeatAt) == null) return null;
  if (t(firstAt) == null)
    return "Record the first dose of tranexamic acid before the repeat.";
  if (t(repeatAt) - t(firstAt) < TXA_REPEAT_MIN * MIN)
    return `The repeat dose of tranexamic acid is not before the first dose + ${TXA_REPEAT_MIN} minutes.`;
  return null;
}
/** The tranexamic acid warning (first dose more than 3 hours after birth), or null. PURE. */
export function txaLateWarning(birthAt, firstAt) {
  if (t(birthAt) == null || t(firstAt) == null) return null;
  return t(firstAt) - t(birthAt) > TXA_WINDOW_MIN * MIN
    ? "Tranexamic acid more than 3 hours after birth – check the indication."
    : null;
}

// Contraindication checks – a warning, never a block. flags: { asthma, hypertension, pre_eclampsia, cardiac }.
/** The warnings for a medicine, from her flags. medicine: 'carboprost' | 'ergometrine'. PURE. */
export function contraindicationWarnings(medicine, flags = {}) {
  if (medicine === "carboprost" && flags.asthma)
    return [
      "Asthma is recorded – carboprost is contraindicated in asthma. Warning only: check before it is given.",
    ];
  if (medicine === "ergometrine") {
    const why = [
      flags.hypertension && "hypertension",
      flags.pre_eclampsia && "pre-eclampsia",
      flags.cardiac && "heart disease",
    ].filter(Boolean);
    if (why.length)
      return [
        `${why.join(", ").replace(/^./, (c) => c.toUpperCase())} recorded – ergometrine is contraindicated. Warning only: check before it is given.`,
      ];
  }
  return [];
}

// Labs: fibrinogen under 2 g/L → the cryoprecipitate prompt.
export const FIBRINOGEN_LOW = 2;
/** The prompt for a fibrinogen result, or null. PURE. */
export const fibrinogenPrompt = (g) =>
  g != null && g !== "" && Number(g) < FIBRINOGEN_LOW
    ? "Fibrinogen under 2 g/L – cryoprecipitate 2 pools."
    : null;

// Observation rows: cumulative loss never goes down.
/** Why this cumulative loss is refused, or null. rows: the other rows ({ at, cumulative_loss_ml }); floor: the loss at declaration. PURE. */
export function cumulativeBlock(rows, at, ml, floor = null) {
  if (ml == null || ml === "") return null;
  const v = Number(ml);
  const before = (rows ?? [])
    .filter((r) => r.cumulative_loss_ml != null && t(r.at) <= t(at))
    .map((r) => Number(r.cumulative_loss_ml));
  const after = (rows ?? [])
    .filter((r) => r.cumulative_loss_ml != null && t(r.at) > t(at))
    .map((r) => Number(r.cumulative_loss_ml));
  const low = Math.max(floor ?? 0, ...before);
  if (v < low)
    return `The cumulative loss can't go down – it was ${low} ml before this time.`;
  if (after.length && v > Math.min(...after))
    return `The cumulative loss can't be more than the later row's ${Math.min(...after)} ml.`;
  return null;
}
/** The latest cumulative loss of the rows (by time), or null. PURE. */
export function latestCumulative(rows) {
  const withLoss = (rows ?? [])
    .filter((r) => r.cumulative_loss_ml != null)
    .sort((a, b) => t(a.at) - t(b.at));
  return withLoss.length
    ? Number(withLoss[withLoss.length - 1].cumulative_loss_ml)
    : null;
}

// Late entry (PX-X-04): a field entered more than 60 minutes after its clinical time. A small local helper – to be
// unified with the shared late-entry helper Build 8 adds in server/src/utils/.
export const LATE_ENTRY_MIN = 60;
/** Was it entered late? PURE. */
export const isLateEntry = (clinicalAt, enteredAt) =>
  t(clinicalAt) != null &&
  t(enteredAt) != null &&
  t(enteredAt) - t(clinicalAt) > LATE_ENTRY_MIN * MIN;

// The episode, as plain data (ep): { header, bundle, carboprost: [{ at }], escalation, observations, outcome }.
const active = (list) => (list ?? []).filter((x) => !x.cancelled);
const sumUnits = (u) =>
  ["prbc", "ffp", "platelets", "cryo"].reduce(
    (a, k) => a + Number(u?.[k] ?? 0),
    0,
  );
const unitsTyped = (u) =>
  ["prbc", "ffp", "platelets", "cryo"].some(
    (k) => u?.[k] != null && u[k] !== "",
  );

/** The products given, counted from the observation rows: { prbc, ffp, platelets, cryo }. PURE. */
export function productsCounted(observations) {
  const out = { prbc: 0, ffp: 0, platelets: 0, cryo: 0 };
  const key = {
    PRBC: "prbc",
    FFP: "ffp",
    platelets: "platelets",
    cryo: "cryo",
  };
  for (const row of active(observations))
    for (const p of row.products ?? []) out[key[p.type]] += 1;
  return out;
}
/** The total loss: the outcome's, or else the latest cumulative loss, or else the loss at declaration. PURE. */
export function totalLossOf(ep) {
  const typed = ep.outcome?.total_loss_ml;
  if (typed != null && typed !== "") return Number(typed);
  return (
    latestCumulative(active(ep.observations)) ??
    (ep.header?.loss_at_declaration_ml != null
      ? Number(ep.header.loss_at_declaration_ml)
      : null)
  );
}
/** Units transfused: the outcome's when typed, else counted from the rows. PURE. */
export const unitsOf = (ep) =>
  unitsTyped(ep.outcome?.units)
    ? sumUnits(ep.outcome.units)
    : sumUnits(productsCounted(ep.observations));

/** E_escalated: set when any escalation field is filled. PURE. */
export function escalated(esc = {}) {
  const b = esc.balloon ?? {};
  return Boolean(
    ESCALATION_TIME_KEYS.some((k) => esc[k]) ||
    b.inserted_at ||
    b.volume_ml != null ||
    b.removed_at ||
    esc.procedures?.length,
  );
}

// A1 – the OBG-F-19 near-miss criteria.
export const NEAR_MISS = {
  loss_1500: "Total blood loss 1500 ml or more",
  units_4: "Four or more units of blood products",
  hysterectomy: "Peripartum hysterectomy",
  icu: "Admitted to ICU",
  transferred: "Transferred to another hospital",
  death: "Maternal death",
};
/** Which A1 criteria the episode meets (keys of NEAR_MISS, in order). PURE. */
export function nearMissCriteria(ep) {
  const out = [];
  const total = totalLossOf(ep);
  if (total != null && total >= 1500) out.push("loss_1500");
  if (unitsOf(ep) >= 4) out.push("units_4");
  if (ep.escalation?.hysterectomy_at) out.push("hysterectomy");
  const d = ep.outcome?.disposition;
  if (["icu", "transferred", "death"].includes(d)) out.push(d);
  return out;
}

/** The KPI fields (A5 on close; worked out live before). PURE. */
export function kpiFields(ep) {
  const declared = ep.header?.declared_at;
  const b = ep.bundle ?? {};
  const doses = active(ep.carboprost)
    .map((d) => t(d.at))
    .filter((x) => x != null);
  const uterotonics = [
    doses.length ? Math.min(...doses) : null,
    t(b.O_ergometrine_at),
    t(b.O_misoprostol_800_at),
  ].filter((x) => x != null);
  const txa = within15(b.T_txa_1g_at, declared) === true;
  const second = uterotonics.length
    ? within15(Math.min(...uterotonics), declared) === true
    : false;
  const total = totalLossOf(ep);
  return {
    txa_within_15_min: txa,
    second_uterotonic_within_15_min: second,
    bundle_complete_15_min:
      txa &&
      second &&
      within15(b.I_iv_access_x2_at, declared) === true &&
      within15(b.O_oxytocin_infusion_at, declared) === true,
    pph_category: pphCategory(total),
    measured_loss:
      Boolean(ep.header?.loss_method) && ep.header.loss_method !== "estimated",
    total_loss_ml: total,
    units_total: unitsOf(ep),
    near_miss: nearMissCriteria(ep),
  };
}

/** What still has to be filled in before the consultant signs off: { field: message }. PURE. */
export function missingForSignoff(ep) {
  const h = ep.header ?? {};
  const m = {};
  if (!h.declared_by?.name) m["header.declared_by"] = "Who declared the PPH";
  if (h.loss_at_declaration_ml == null || h.loss_at_declaration_ml === "")
    m["header.loss_at_declaration_ml"] = "Enter the loss at declaration";
  if (!h.loss_method)
    m["header.loss_method"] = "Choose how the loss was measured";
  if (!h.cause_4T?.length)
    m["header.cause_4T"] = "Tick the cause (the four Ts)";
  if (totalLossOf({ ...ep, header: {} }) == null)
    m["outcome.total_loss_ml"] = "Enter the total loss";
  return m;
}
