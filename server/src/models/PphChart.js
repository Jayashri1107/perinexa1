import mongoose from "mongoose";
import {
  BLOODS_ITEMS,
  DELIVERY_MODES,
  DISPOSITIONS,
  LOSS_METHODS,
  NEAR_MISS,
  PLACENTA,
  PPH_CAUSES,
  PROCEDURES,
  PRODUCTS,
  RISK_FACTORS,
} from "../clinical/pph.js";
import { tenantScoped } from "../utils/tenantScope.js";

// One PPH episode (Clinical Requirements Group B, item 15 – PX-OBG-12, Build 15; the fields of OBG-F-07 v1.0 as in
// docs/field_schemas/build15_pph.json, named as there): one per declaration, on her stay. Header, the E-MOTIVE bundle,
// escalation, observation rows (with blood products and their second-person check), labs, outcome, consultant
// sign-off and the scan of the paper chart. Every timed field keeps when it was typed (entryLog – late entry, PX-X-04).
// Lines are never changed or deleted – one typed by mistake is marked "entered in error"; the episode likewise. Once
// signed off (A5) it is closed: the KPI fields are kept and nothing is changed again.
// Episodes of the earlier DRAFT chart (6 Nov 2026, fake data only) keep recognisedAt and none of the new fields.

const { ObjectId } = mongoose.Schema.Types;
const T = { type: Date, default: null };
const N = { type: Number, default: null };
const B = { type: Boolean, default: false };
const person = {
  type: new mongoose.Schema(
    { id: { type: ObjectId, ref: "User" }, name: String },
    { _id: false },
  ),
  default: null,
};
const stamp = {
  by: { type: ObjectId, ref: "User" },
  byName: String,
  enteredAt: Date,
};
const cancel = {
  type: new mongoose.Schema(
    { reason: String, by: ObjectId, byName: String, at: Date },
    { _id: false },
  ),
  default: null,
};
const choice = (o) => ({
  type: String,
  enum: [...Object.keys(o), ""],
  default: "",
});
const many = (o) => ({
  type: [{ type: String, enum: Object.keys(o) }],
  default: [],
});
const check = new mongoose.Schema(
  { by: ObjectId, byName: String, role: String, at: Date },
  { _id: false },
);

const headerSchema = new mongoose.Schema(
  {
    delivery_mode: choice(DELIVERY_MODES),
    delivery_time: T,
    declared_at: { type: Date, required: true },
    declared_by: person,
    loss_at_declaration_ml: N,
    loss_method: choice(LOSS_METHODS),
    pulse_at_declaration: N, // shock_index_at_declaration = pulse ÷ systolic, worked out
    systolic_at_declaration: N,
    help_called_at: T,
    consultant: person,
    consultant_arrived_at: T,
    anaesthetist: person,
    anaesthetist_arrived_at: T,
    blood_bank_informed_at: T,
    cause_4T: many(PPH_CAUSES),
    risk_factors: many(RISK_FACTORS),
    recorder: person,
  },
  { _id: false },
);
const bundleSchema = new mongoose.Schema(
  {
    M_uterine_massage_at: T,
    M_bladder_emptied_at: T,
    M_bimanual_compression_at: T,
    O_oxytocin_10iu_im_at: T,
    O_oxytocin_infusion_at: T,
    O_ergometrine_at: T,
    O_misoprostol_800_at: T,
    T_txa_1g_at: T,
    T_txa_repeat_at: T,
    I_iv_access_x2_at: T,
    I_bloods_sent_at: T,
    I_bloods_items: many(BLOODS_ITEMS),
    I_crossmatch_units: N,
    I_crystalloid_ml: N,
    I_oxygen_started: B,
    I_catheter: B,
    I_warming: B,
    V_placenta_complete: choice(PLACENTA),
    V_genital_tract_inspected: B,
    V_repair_done: B,
    V_inversion_replaced_at: T,
  },
  { _id: false },
);
const escalationSchema = new mongoose.Schema(
  {
    massive_haemorrhage_declared_at: T,
    to_ot_at: T,
    balloon: {
      type: new mongoose.Schema(
        { inserted_at: T, volume_ml: N, removed_at: T },
        { _id: false },
      ),
      default: () => ({}),
    },
    laparotomy_at: T,
    procedures: many(PROCEDURES),
    procedures_other: { type: String, maxlength: 200, default: "" },
    hysterectomy_at: T,
  },
  { _id: false },
);
const productSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.keys(PRODUCTS), required: true },
    unit_number: { type: String, maxlength: 40, required: true },
    issued_at: T,
    two_person_check: check,
  },
  { _id: false },
);
const observationSchema = new mongoose.Schema({
  at: { type: Date, required: true },
  pulse: N,
  sbp: N,
  dbp: N,
  rr: N,
  spo2: N,
  urine_ml: N,
  cumulative_loss_ml: N,
  crystalloid_ml: N,
  colloid_ml: N,
  temp: N,
  notes: { type: String, maxlength: 300, default: "" },
  products: { type: [productSchema], default: [] },
  cancelled: cancel,
  ...stamp,
});
const labsSchema = new mongoose.Schema(
  { platelets: N, inr: N, aptt: N, fibrinogen_g_l: N, calcium: N, lactate: N },
  { _id: false },
);
const units = new mongoose.Schema(
  { prbc: N, ffp: N, platelets: N, cryo: N },
  { _id: false },
);
const outcomeSchema = new mongoose.Schema(
  {
    total_loss_ml: N,
    units: { type: units, default: () => ({}) },
    disposition: choice(DISPOSITIONS),
    debrief_done: B,
    debrief_by: person,
    debrief_at: T,
  },
  { _id: false },
);
const fileSchema = new mongoose.Schema(
  {
    fileId: ObjectId,
    fileName: String,
    mediaType: String,
    size: Number,
    byName: String,
    at: Date,
  },
  { _id: false },
);

const chartSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: "Patient", required: true },
    admissionId: { type: ObjectId, ref: "Admission", required: true },
    form: { type: String, default: "OBG-F-07 v1.0" },
    header: { type: headerSchema, default: null },
    declaredAtChanges: {
      type: [
        new mongoose.Schema(
          { from: Date, to: Date, reason: String, byName: String, at: Date },
          { _id: false },
        ),
      ],
      default: [],
    },
    bundle: { type: bundleSchema, default: () => ({}) },
    carboprost: {
      type: [
        new mongoose.Schema({
          at: { type: Date, required: true },
          warnings: { type: [String], default: [] },
          cancelled: cancel,
          ...stamp,
        }),
      ],
      default: [],
    },
    escalation: { type: escalationSchema, default: () => ({}) },
    observations: { type: [observationSchema], default: [] },
    hb_series: {
      type: [
        new mongoose.Schema({
          at: { type: Date, required: true },
          value: Number,
          cancelled: cancel,
          ...stamp,
        }),
      ],
      default: [],
    },
    labs: { type: labsSchema, default: () => ({}) },
    outcome: { type: outcomeSchema, default: () => ({}) },
    // When each timed field was typed, and by whom (the latest per field counts) – late entry, PX-X-04
    entryLog: {
      type: [
        new mongoose.Schema(
          { field: String, clinicalAt: Date, enteredAt: Date, byName: String },
          { _id: false },
        ),
      ],
      default: [],
    },
    // The warnings shown when a medicine was recorded (contraindications, TXA after 3 h) – recorded as shown
    warningsShown: {
      type: [
        new mongoose.Schema(
          { field: String, text: String, byName: String, at: Date },
          { _id: false },
        ),
      ],
      default: [],
    },
    paperScans: { type: [fileSchema], default: [] },
    consultantSignoff: {
      type: new mongoose.Schema(
        { by: ObjectId, byName: String, at: Date },
        { _id: false },
      ),
      default: null,
    },
    // A1: the near-miss record (OBG-F-19) started, the Lead Obstetrician told, on the M&M list
    nearMiss: {
      type: new mongoose.Schema(
        {
          at: Date,
          criteria: {
            type: [{ type: String, enum: Object.keys(NEAR_MISS) }],
            default: [],
          },
          caseReviewId: ObjectId,
          serial: Number,
          notified: Number,
        },
        { _id: false },
      ),
      default: null,
    },
    mm: {
      type: new mongoose.Schema(
        {
          addedAt: Date,
          reviewBy: Date,
          discussedAt: Date,
          discussedByName: String,
          note: String,
        },
        { _id: false },
      ),
      default: null,
    },
    // A4: the Director told, and the blood bank's massive-transfusion pack request
    massive: {
      type: new mongoose.Schema(
        {
          at: Date,
          notified: Number,
          packRequestedAt: Date,
          requestedByName: String,
        },
        { _id: false },
      ),
      default: null,
    },
    // A5: the KPI fields worked out when the episode was closed
    kpi: { type: mongoose.Schema.Types.Mixed, default: null },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    source: { type: String, required: true },
    createdByName: { type: String, required: true },
    cancelled: cancel,
    clientRequestId: { type: String, required: true, maxlength: 64 },
    recognisedAt: { type: Date, default: undefined }, // the earlier DRAFT chart only
  },
  { timestamps: true },
);
chartSchema.plugin(tenantScoped);
chartSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
chartSchema.index({ tenantId: 1, admissionId: 1, createdAt: -1 });
chartSchema.index({ tenantId: 1, "header.declared_at": 1 });
chartSchema.index({ tenantId: 1, "mm.addedAt": -1 });

export const PphChart = mongoose.model("PphChart", chartSchema);

// Who is told (A1, A4), named by the hospital admin: the Lead Obstetrician(s) and the Director(s). Until they are
// named, the quality lead gets A1 and the hospital admin gets A4.
const settingsSchema = new mongoose.Schema(
  {
    leadObstetricianIds: {
      type: [{ type: ObjectId, ref: "User" }],
      default: [],
    },
    directorIds: { type: [{ type: ObjectId, ref: "User" }], default: [] },
    updatedByName: { type: String, default: "" },
  },
  { timestamps: true },
);
settingsSchema.plugin(tenantScoped);
settingsSchema.index(
  { tenantId: 1 },
  { unique: true, name: "tenantId_unique" },
); // one per hospital
export const PphSettings = mongoose.model("PphSettings", settingsSchema);
