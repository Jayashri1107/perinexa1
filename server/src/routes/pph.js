import { Router } from "express";
import { z } from "zod";
import { verifyWitness, witnessSchema, witnessView } from "../auth/witness.js";
import {
  BALLOON_TIME_KEYS,
  BLOODS_ITEMS,
  BUNDLE,
  BUNDLE_ITEMS,
  BUNDLE_TIME_KEYS,
  DECLARATION_KEYS,
  DELIVERY_MODES,
  DISPOSITIONS,
  ESCALATION_TIME_KEYS,
  FIELD_LABELS,
  HEADER_TIME_KEYS,
  LOSS_METHODS,
  NEAR_MISS,
  PLACENTA,
  PPH_CAUSES,
  PPH_FORM,
  PPH_SOURCE,
  PROCEDURES,
  PRODUCTS,
  RISK_FACTORS,
  carboprostBlock,
  contraindicationWarnings,
  cumulativeBlock,
  escalated,
  fibrinogenPrompt,
  isLateEntry,
  kpiFields,
  lossBand,
  missingForSignoff,
  nearMissCriteria,
  productsCounted,
  shockIndex,
  totalLossOf,
  txaLateWarning,
  txaRepeatBlock,
  within15,
} from "../clinical/pph.js";
import { Admission } from "../models/Admission.js";
import { CaseReview } from "../models/CaseReview.js";
import { ClinicalDocument } from "../models/ClinicalDocument.js";
import { nextNumber } from "../models/Counter.js";
import { Membership, hasRole } from "../models/Membership.js";
import { Patient } from "../models/Patient.js";
import { PphChart, PphSettings } from "../models/PphChart.js";
import { User } from "../models/User.js";
import { notify } from "../notifications/notify.js";
import { findingsView } from "../patients/pregnancyFindings.js";
import { audit } from "../utils/audit.js";
import { HttpError } from "../utils/httpError.js";
import { assertNotHidden, departmentListed, patientAccess } from "../utils/patientAccess.js";
import { findPatientById } from "../utils/patientLookup.js";
import { safeText } from "../utils/pcpndt.js";
import {
  fileUploadSchema,
  findFile,
  sendFile,
  storeFile,
} from "../utils/storedFiles.js";
import { objectId, parse } from "../utils/validate.js";

// The PPH chart (Clinical Requirements Group B, item 15 – Build 15, OBG-F-07 v1.0; rules in clinical/pph.js): /api/pph.
//  - GET /current?patientId=: for the banner – her current stay, an open episode (declared_at for the clock), may declare;
//  - GET /?patientId=&admissionId=: the stay's episodes, newest first, with everything worked out;
//  - POST /: "Declare PPH" – one tap stamps declared_at (now) and declared_by; or a declared_at typed from the paper;
//  - PUT /:id: the transcription screen – any of header, bundle, escalation, labs, outcome (only the fields sent);
//  - POST /:id/lines: an observation row (blood products need the second person, PX-X-06), a carboprost dose (A3), an Hb;
//  - POST /:id/lines/:lineId/cancel, POST /:id/cancel: entered in error, with a reason (never changed or deleted);
//  - POST /:id/scans, GET /:id/scans/:fileId: the scan of the paper OBG-F-07 (needed before sign-off after a late entry);
//  - POST /:id/signoff: the consultant signs off – A5 works out the KPI fields and the episode is locked.
// A1 (near miss) and A4 (massive haemorrhage) run on every save. Nurses, her doctor and RMOs write it; those who may see
// her medical details read it. Not on a baby's record. The audit log gets ids and the parts saved – never values.
// /api/pph-reviews (pphReviewsRouter): the M&M list of A1 episodes and who is told (Lead Obstetrician, Director).

export const pphRouter = Router();
export const pphReviewsRouter = Router();
const ROLES = ["doctor", "rmo", "nurse"];
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const forbidden = (m) => new HttpError(403, m, "FORBIDDEN");
const conflict = (m) => new HttpError(409, m, "CONFLICT");
const notFound = () =>
  new HttpError(404, "This PPH chart was not found.", "NOT_FOUND");
const invalid = (fields, message = "Please check the highlighted fields.") =>
  Object.assign(new HttpError(400, message, "VALIDATION"), { fields });
const blocked = (field, message) =>
  Object.assign(new HttpError(400, message, "BLOCKED"), {
    fields: { [field]: message },
  });

const empty = (v) => (v === "" || v === undefined ? null : v);
const dt = z
  .preprocess(
    empty,
    z.union([
      z.null(),
      z.iso
        .datetime("Please enter a valid date and time")
        .transform((v) => new Date(v)),
    ]),
  )
  .optional();
const reqTime = (label) =>
  z.iso
    .datetime(`${label}: please enter a valid date and time`)
    .transform((v) => new Date(v));
const num = (label, min, max, int = false) => {
  let n = z.coerce
    .number(`${label} must be a number`)
    .min(min, `${label} looks too low – please check`)
    .max(max, `${label} looks too high – please check`);
  if (int) n = n.int(`${label}: a whole number`);
  return z.preprocess(empty, z.union([z.null(), n])).optional();
};
const pick = (o) => z.enum([...Object.keys(o), ""]).optional();
const many = (o) =>
  z
    .array(z.enum(Object.keys(o)))
    .max(Object.keys(o).length)
    .optional();
const ref = z.preprocess(empty, z.union([z.null(), objectId])).optional();

pphRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES))
    throw forbidden("The PPH chart is for doctors, RMOs and nurses.");
  next();
});

const mayView = (req, p) => patientAccess(req, p).view.has("pregnancy");
const mayWrite = (req, p) => {
  const a = patientAccess(req, p);
  return a.editClinical || a.recordVitals;
};
const maySign = (req, p) =>
  hasRole(req.membership, "doctor") && patientAccess(req, p).editClinical;
const nowOf = (req) => req.now ?? new Date();
const stamp = (req) => ({
  by: req.user._id,
  byName: req.user.name,
  enteredAt: nowOf(req),
});
const cancelView = (c) =>
  c ? { reason: c.reason, byName: c.byName, at: c.at } : null;
const isOpen = (c) => c.status === "open" && !c.cancelled;

async function load(req, patientId, admissionId) {
  // Another department's patient is "not found" for a doctor (departments, 9 Nov 2026)
  const patient = assertNotHidden(req, await findPatientById(req.tenantId, patientId));
  if (!mayView(req, patient))
    throw forbidden("You can't see this patient's medical details.");
  if (patient.careType === "newborn")
    throw invalid({
      patientId: "The PPH chart is for the mother, not a baby.",
    });
  const admission = await Admission.findOne({
    _id: admissionId,
    tenantId: req.tenantId,
    patientId: patient._id,
  });
  if (!admission)
    throw new HttpError(404, "This stay was not found.", "NOT_FOUND");
  return { patient, admission };
}
async function loadChart(req) {
  const { id } = parse(z.object({ id: objectId }).passthrough(), req.params);
  const chart = await PphChart.findOne({ _id: id, tenantId: req.tenantId });
  if (!chart) throw notFound();
  const { patient, admission } = await load(
    req,
    chart.patientId,
    chart.admissionId,
  );
  return { chart, patient, admission };
}
const ids = (patient, admission, extra = {}) => ({
  patientId: String(patient._id),
  mrn: patient.mrn,
  admissionId: String(admission._id),
  ...extra,
});

/** Her flags for the contraindication warnings (from her record and this episode). */
function flagsOf(patient, chart) {
  const conditions = patient.medical?.conditions ?? [];
  const findings = new Set(
    findingsView(patient)
      .filter((f) => f.current)
      .map((f) => f.key),
  );
  return {
    asthma: conditions.includes("asthma"),
    hypertension:
      conditions.includes("hypertension") || findings.has("hypertension"),
    pre_eclampsia: (chart?.header?.risk_factors ?? []).includes(
      "pre_eclampsia",
    ),
    cardiac: conditions.includes("heart_disease"),
  };
}

/** The hospital's active doctors, RMOs and nurses: { id, name, roles }. */
async function clinicalStaff(tenantId) {
  const members = await Membership.find(
    { tenantId, isActive: true, roles: { $in: ROLES } },
    { userId: 1, roles: 1 },
  ).lean();
  const users = await User.find(
    { _id: { $in: members.map((m) => m.userId) }, isActive: true },
    { name: 1 },
  )
    .sort({ name: 1 })
    .lean();
  const roles = new Map(
    members.map((m) => [
      String(m.userId),
      m.roles.filter((r) => ROLES.includes(r)),
    ]),
  );
  return users.map((u) => ({
    id: String(u._id),
    name: u.name,
    roles: roles.get(String(u._id)) ?? [],
  }));
}

// ---------- Late entry (PX-X-04): a small local helper, to be unified with Build 8's shared one ----------
/** Every late entry of the episode: { field, label, clinicalAt, enteredAt, byName }. */
function lateEntries(c) {
  const latest = new Map();
  for (const e of c.entryLog ?? []) latest.set(e.field, e);
  const out = [...latest.values()]
    .filter((e) => e.clinicalAt && isLateEntry(e.clinicalAt, e.enteredAt))
    .map((e) => ({
      field: e.field,
      label:
        FIELD_LABELS[
          e.field.replace(/^(header|bundle|escalation|outcome)\./, "")
        ] ?? e.field,
      clinicalAt: e.clinicalAt,
      enteredAt: e.enteredAt,
      byName: e.byName,
    }));
  const lines = [
    ...c.observations
      .filter((o) => !o.cancelled)
      .map((o) => ["observation", o]),
    ...c.carboprost.filter((o) => !o.cancelled).map((o) => ["carboprost", o]),
    ...c.hb_series.filter((o) => !o.cancelled).map((o) => ["hb", o]),
  ];
  for (const [kind, l] of lines)
    if (isLateEntry(l.at, l.enteredAt))
      out.push({
        field: `${kind}:${l._id}`,
        label: FIELD_LABELS[kind],
        clinicalAt: l.at,
        enteredAt: l.enteredAt,
        byName: l.byName,
      });
  for (const o of c.observations.filter((x) => !x.cancelled))
    for (const p of o.products)
      if (p.issued_at && isLateEntry(p.issued_at, o.enteredAt))
        out.push({
          field: `product:${o._id}:${p.unit_number}`,
          label: FIELD_LABELS.product,
          clinicalAt: p.issued_at,
          enteredAt: o.enteredAt,
          byName: o.byName,
        });
  return out.sort((a, b) => new Date(a.clinicalAt) - new Date(b.clinicalAt));
}
const lateKeys = (c) => new Set(lateEntries(c).map((e) => e.field));

/** The episode as plain data for the rules in clinical/pph.js. */
const plain = (c) => ({
  header: c.header?.toObject?.() ?? c.header ?? {},
  bundle: c.bundle?.toObject?.() ?? c.bundle ?? {},
  carboprost: c.carboprost,
  escalation: c.escalation?.toObject?.() ?? c.escalation ?? {},
  observations: c.observations,
  outcome: c.outcome?.toObject?.() ?? c.outcome ?? {},
});

function view(c, patient) {
  const ep = plain(c);
  const h = ep.header ?? {};
  const declared = h.declared_at ?? c.recognisedAt ?? null;
  const late = lateKeys(c);
  const total = totalLossOf(ep);
  const flags = flagsOf(patient, c);
  const carbo = c.carboprost.map((d) => ({
    id: String(d._id),
    at: d.at,
    within15: within15(d.at, declared),
    warnings: d.warnings,
    byName: d.byName,
    enteredAt: d.enteredAt,
    late: late.has(`carboprost:${d._id}`),
    cancelled: cancelView(d.cancelled),
  }));
  return {
    id: String(c._id),
    form: c.form,
    draftChart: !c.header, // the earlier DRAFT chart (6 Nov 2026)
    declared_at: declared,
    header: {
      ...h,
      declared_by: h.declared_by?.name
        ? { id: String(h.declared_by.id), name: h.declared_by.name }
        : null,
      consultant: h.consultant?.name
        ? { id: String(h.consultant.id), name: h.consultant.name }
        : null,
      anaesthetist: h.anaesthetist?.name
        ? { id: String(h.anaesthetist.id), name: h.anaesthetist.name }
        : null,
      recorder: h.recorder?.name
        ? { id: String(h.recorder.id), name: h.recorder.name }
        : null,
    },
    shock_index_at_declaration: shockIndex(
      h.pulse_at_declaration,
      h.systolic_at_declaration,
    ),
    declaredAtChanges: c.declaredAtChanges.map((x) => ({
      from: x.from,
      to: x.to,
      reason: x.reason,
      byName: x.byName,
      at: x.at,
    })),
    bundle: ep.bundle,
    within15: Object.fromEntries(
      BUNDLE_TIME_KEYS.map((k) => [k, within15(ep.bundle?.[k], declared)]),
    ),
    carboprost: carbo,
    escalation: ep.escalation,
    E_escalated: escalated(ep.escalation),
    observations: c.observations
      .slice()
      .sort((a, b) => new Date(a.at) - new Date(b.at))
      .map((o) => ({
        id: String(o._id),
        ...Object.fromEntries(
          [
            "at",
            "pulse",
            "sbp",
            "dbp",
            "rr",
            "spo2",
            "urine_ml",
            "cumulative_loss_ml",
            "crystalloid_ml",
            "colloid_ml",
            "temp",
            "notes",
          ].map((k) => [k, o[k]]),
        ),
        shock: shockIndex(o.pulse, o.sbp),
        products: o.products.map((p) => ({
          type: p.type,
          unit_number: p.unit_number,
          issued_at: p.issued_at,
          two_person_check: witnessView(p.two_person_check),
        })),
        byName: o.byName,
        enteredAt: o.enteredAt,
        late: late.has(`observation:${o._id}`),
        cancelled: cancelView(o.cancelled),
      })),
    hb_series: c.hb_series.map((x) => ({
      id: String(x._id),
      at: x.at,
      value: x.value,
      byName: x.byName,
      late: late.has(`hb:${x._id}`),
      cancelled: cancelView(x.cancelled),
    })),
    labs: c.labs?.toObject?.() ?? c.labs ?? {},
    outcome: {
      ...ep.outcome,
      debrief_by: ep.outcome?.debrief_by?.name
        ? {
            id: String(ep.outcome.debrief_by.id),
            name: ep.outcome.debrief_by.name,
          }
        : null,
    },
    totalLossMl: total,
    loss: lossBand(total),
    productsCounted: productsCounted(c.observations),
    prompts: [fibrinogenPrompt(c.labs?.fibrinogen_g_l)].filter(Boolean),
    warnings: {
      carboprost: contraindicationWarnings("carboprost", flags),
      ergometrine: contraindicationWarnings("ergometrine", flags),
      txa: txaLateWarning(h.delivery_time, ep.bundle?.T_txa_1g_at),
    },
    warningsShown: c.warningsShown.map((w) => ({
      field: w.field,
      text: w.text,
      byName: w.byName,
      at: w.at,
    })),
    flags,
    late: lateEntries(c),
    lateFields: [...late].filter((k) => k.includes(".")),
    paperScans: c.paperScans.map((f) => ({
      fileId: String(f.fileId),
      fileName: f.fileName,
      mediaType: f.mediaType,
      size: f.size,
      byName: f.byName,
      at: f.at,
    })),
    missing: missingForSignoff(ep),
    kpi: c.kpi ?? kpiFields(ep),
    kpiLocked: Boolean(c.kpi),
    nearMiss: c.nearMiss
      ? {
          at: c.nearMiss.at,
          criteria: c.nearMiss.criteria,
          caseReviewId: c.nearMiss.caseReviewId
            ? String(c.nearMiss.caseReviewId)
            : null,
          serial: c.nearMiss.serial,
        }
      : null,
    mm: c.mm
      ? {
          addedAt: c.mm.addedAt,
          reviewBy: c.mm.reviewBy,
          discussedAt: c.mm.discussedAt,
          discussedByName: c.mm.discussedByName,
        }
      : null,
    massive: c.massive
      ? {
          at: c.massive.at,
          packRequestedAt: c.massive.packRequestedAt,
          requestedByName: c.massive.requestedByName,
        }
      : null,
    consultantSignoff: c.consultantSignoff
      ? { byName: c.consultantSignoff.byName, at: c.consultantSignoff.at }
      : null,
    status: c.status,
    createdByName: c.createdByName,
    createdAt: c.createdAt,
    cancelled: cancelView(c.cancelled),
  };
}
function accessOf(req, patient, chart) {
  const open = isOpen(chart);
  return {
    write: mayWrite(req, patient) && open,
    sign: maySign(req, patient) && open,
  };
}
async function answer(
  req,
  res,
  chart,
  patient,
  { status = 200, warnings = [] } = {},
) {
  res
    .status(status)
    .json({
      chart: view(chart, patient),
      access: accessOf(req, patient, chart),
      warnings,
    });
}

const RULES = {
  form: PPH_FORM,
  source: PPH_SOURCE,
  deliveryModes: DELIVERY_MODES,
  lossMethods: LOSS_METHODS,
  causes: PPH_CAUSES,
  riskFactors: RISK_FACTORS,
  bundle: BUNDLE,
  bloodsItems: BLOODS_ITEMS,
  placenta: PLACENTA,
  procedures: PROCEDURES,
  products: PRODUCTS,
  dispositions: DISPOSITIONS,
  nearMiss: NEAR_MISS,
};

// ---------- Reading ----------
pphRouter.get("/current", async (req, res) => {
  const q = parse(z.object({ patientId: objectId }).strict(), req.query);
  const patient = assertNotHidden(req, await findPatientById(req.tenantId, q.patientId)); // departments, 9 Nov 2026
  if (!mayView(req, patient) || patient.careType === "newborn")
    return res.json({ admissionId: null, open: null, canDeclare: false });
  const stay = await Admission.findOne(
    { tenantId: req.tenantId, patientId: patient._id, status: "admitted" },
    { _id: 1 },
  ).lean();
  if (!stay)
    return res.json({ admissionId: null, open: null, canDeclare: false });
  const open = await PphChart.findOne(
    {
      tenantId: req.tenantId,
      admissionId: stay._id,
      status: "open",
      cancelled: null,
    },
    { "header.declared_at": 1, recognisedAt: 1 },
  )
    .sort({ createdAt: -1 })
    .lean();
  res.json({
    admissionId: String(stay._id),
    open: open
      ? {
          id: String(open._id),
          declared_at: open.header?.declared_at ?? open.recognisedAt ?? null,
        }
      : null,
    canDeclare: !open && mayWrite(req, patient),
  });
});

pphRouter.get("/", async (req, res) => {
  const q = parse(
    z.object({ patientId: objectId, admissionId: objectId }).strict(),
    req.query,
  );
  const { patient, admission } = await load(req, q.patientId, q.admissionId);
  const charts = await PphChart.find({
    tenantId: req.tenantId,
    admissionId: admission._id,
  }).sort({ createdAt: -1, _id: -1 });
  await audit(req, "PPH_CHART_VIEWED", {
    details: ids(patient, admission, { count: charts.length }),
  });
  res.json({
    charts: charts.map((c) => ({
      ...view(c, patient),
      access: accessOf(req, patient, c),
    })),
    access: {
      start: mayWrite(req, patient) && admission.status === "admitted",
      write: mayWrite(req, patient),
      sign: maySign(req, patient),
    },
    staff: await clinicalStaff(req.tenantId),
    rules: RULES,
  });
});

const notFuture = (req, at, field) => {
  if (at && at.getTime() > nowOf(req).getTime() + 5 * MIN)
    throw invalid({ [field]: "The time can't be in the future." });
};

/** The delivery on this stay (the delivery note): { delivery_mode, delivery_time }, or {} when none. */
async function deliveryOf(req, admission) {
  const note = await ClinicalDocument.findOne(
    {
      tenantId: req.tenantId,
      admissionId: admission._id,
      kind: "delivery",
      status: { $ne: "cancelled" },
    },
    { content: 1 },
  )
    .sort({ createdAt: -1 })
    .lean();
  const c = note?.content ?? {};
  const mode =
    {
      normal: "vaginal",
      vacuum: "instrumental",
      forceps: "instrumental",
      lscs: "lscs",
    }[c.mode] ?? "";
  return {
    delivery_mode: mode,
    delivery_time: c.deliveredAt ? new Date(c.deliveredAt) : null,
  };
}

// ---------- Declare PPH (one tap; A2 starts the banner clock) ----------
pphRouter.post("/", async (req, res) => {
  const b = parse(
    z
      .object({
        clientRequestId: z.uuid("Please reload the page and try again"),
        patientId: objectId,
        admissionId: objectId,
        declared_at: reqTime("PPH declared").optional(),
      })
      .strict(),
    req.body,
  );
  const { patient, admission } = await load(req, b.patientId, b.admissionId);
  if (!mayWrite(req, patient))
    throw forbidden("Only nurses, her doctor and RMOs write the PPH chart.");
  const again = await PphChart.findOne({
    tenantId: req.tenantId,
    clientRequestId: b.clientRequestId,
  });
  if (again) return answer(req, res, again, patient);
  if (admission.status !== "admitted")
    throw conflict(
      "She has been discharged: no PPH can be declared on this stay.",
    );
  if (
    await PphChart.exists({
      tenantId: req.tenantId,
      admissionId: admission._id,
      status: "open",
      cancelled: null,
    })
  )
    throw conflict("A PPH is already declared and open on this stay.");
  const now = nowOf(req);
  const declaredAt = b.declared_at ?? now;
  notFuture(req, declaredAt, "declared_at");
  if (declaredAt < admission.admittedAt)
    throw invalid({
      declared_at: "The time is before she was admitted – please check it.",
    });
  const chart = new PphChart({
    tenantId: req.tenantId,
    patientId: patient._id,
    admissionId: admission._id,
    header: {
      ...(await deliveryOf(req, admission)),
      declared_at: declaredAt,
      declared_by: { id: req.user._id, name: req.user.name },
      recorder: { id: req.user._id, name: req.user.name },
    },
    entryLog: [
      {
        field: "header.declared_at",
        clinicalAt: declaredAt,
        enteredAt: now,
        byName: req.user.name,
      },
    ],
    source: PPH_SOURCE,
    createdByName: req.user.name,
    clientRequestId: b.clientRequestId,
  });
  await chart.save();
  // TODO (after Build 8 and Build 15 are merged): A2 – set the MEOWS frequency of this stay to 5 minutes.
  await audit(req, "PPH_DECLARED", {
    details: ids(patient, admission, {
      chartId: String(chart._id),
      typedFromPaper: Boolean(b.declared_at),
    }),
  });
  return answer(req, res, chart, patient, { status: 201 });
});

// ---------- The transcription screen (OBG-F-07): save any part ----------
const bundleShape = Object.fromEntries(
  BUNDLE_ITEMS.filter((i) => i.kind !== "doses").map((i) => [
    i.key,
    i.kind === "time"
      ? dt
      : i.kind === "bool"
        ? z.boolean().optional()
        : i.kind === "number"
          ? num(i.label, i.min, i.max, true)
          : i.kind === "enum"
            ? pick(i.options)
            : many(i.options),
  ]),
);
const saveBody = z
  .object({
    header: z
      .object({
        delivery_mode: pick(DELIVERY_MODES),
        delivery_time: dt,
        declared_at: reqTime("PPH declared").optional(),
        declared_by: ref,
        loss_at_declaration_ml: num("Loss at declaration", 0, 10000, true),
        loss_method: pick(LOSS_METHODS),
        pulse_at_declaration: num("Pulse", 20, 250, true),
        systolic_at_declaration: num("Systolic BP", 30, 260, true),
        help_called_at: dt,
        consultant: ref,
        consultant_arrived_at: dt,
        anaesthetist: ref,
        anaesthetist_arrived_at: dt,
        blood_bank_informed_at: dt,
        cause_4T: many(PPH_CAUSES),
        risk_factors: many(RISK_FACTORS),
        recorder: ref,
      })
      .strict()
      .optional(),
    bundle: z.object(bundleShape).strict().optional(),
    escalation: z
      .object({
        massive_haemorrhage_declared_at: dt,
        to_ot_at: dt,
        balloon: z
          .object({
            inserted_at: dt,
            volume_ml: num("Balloon volume", 0, 2000, true),
            removed_at: dt,
          })
          .strict()
          .optional(),
        laparotomy_at: dt,
        procedures: many(PROCEDURES),
        procedures_other: safeText("Other procedure", 200).optional(),
        hysterectomy_at: dt,
      })
      .strict()
      .optional(),
    labs: z
      .object({
        platelets: num("Platelets", 0, 2000, true),
        inr: num("INR", 0.5, 15),
        aptt: num("APTT", 10, 300, true),
        fibrinogen_g_l: num("Fibrinogen", 0, 15),
        calcium: num("Calcium", 0.5, 5),
        lactate: num("Lactate", 0, 30),
      })
      .strict()
      .optional(),
    outcome: z
      .object({
        total_loss_ml: num("Total loss", 0, 20000, true),
        units: z
          .object({
            prbc: num("PRBC units", 0, 100, true),
            ffp: num("FFP units", 0, 100, true),
            platelets: num("Platelet units", 0, 100, true),
            cryo: num("Cryo units", 0, 100, true),
          })
          .strict()
          .optional(),
        disposition: pick(DISPOSITIONS),
        debrief_done: z.boolean().optional(),
        debrief_by: ref,
        debrief_at: dt,
      })
      .strict()
      .optional(),
    declared_at_reason: safeText("Reason", 300).optional(),
  })
  .strict();

const PERSON_KEYS = {
  header: ["declared_by", "consultant", "anaesthetist", "recorder"],
  outcome: ["debrief_by"],
};
const TIME_KEYS = {
  header: HEADER_TIME_KEYS,
  bundle: BUNDLE_TIME_KEYS,
  escalation: ESCALATION_TIME_KEYS,
  outcome: ["debrief_at"],
};
const same = (a, b) =>
  a instanceof Date || b instanceof Date
    ? (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null)
    : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

pphRouter.put("/:id", async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!mayWrite(req, patient))
    throw forbidden("Only nurses, her doctor and RMOs write the PPH chart.");
  if (!isOpen(chart))
    throw conflict(
      "This PPH chart is closed: it was signed off and is locked.",
    );
  if (!chart.header)
    throw conflict(
      "This is the earlier DRAFT chart: declare a new PPH to use OBG-F-07.",
    );
  const b = parse(saveBody, req.body);
  const now = nowOf(req);
  const log = (field, clinicalAt) =>
    chart.entryLog.push({
      field,
      clinicalAt,
      enteredAt: now,
      byName: req.user.name,
    });
  const staff = new Map(
    (await clinicalStaff(req.tenantId)).map((s) => [s.id, s]),
  );
  const warnings = [];
  const parts = [];

  // declared_at: editable with a reason
  if (
    b.header?.declared_at &&
    !same(b.header.declared_at, chart.header.declared_at)
  ) {
    if (!b.declared_at_reason || b.declared_at_reason.length < 5)
      throw invalid({
        declared_at_reason:
          "Say why the declaration time is changed (at least 5 characters).",
      });
    notFuture(req, b.header.declared_at, "header.declared_at");
    if (b.header.declared_at < admission.admittedAt)
      throw invalid({
        "header.declared_at":
          "The time is before she was admitted – please check it.",
      });
    chart.declaredAtChanges.push({
      from: chart.header.declared_at,
      to: b.header.declared_at,
      reason: b.declared_at_reason,
      byName: req.user.name,
      at: now,
    });
    chart.header.declared_at = b.header.declared_at;
    log("header.declared_at", b.header.declared_at);
  }
  for (const section of ["header", "bundle", "escalation", "labs", "outcome"]) {
    const input = b[section];
    if (!input) continue;
    parts.push(section);
    const target = chart[section];
    for (const [key, raw] of Object.entries(input)) {
      if (key === "declared_at" || raw === undefined) continue;
      let value = raw;
      if (PERSON_KEYS[section]?.includes(key)) {
        if (value) {
          const s = staff.get(String(value));
          if (!s)
            throw invalid({
              [`${section}.${key}`]:
                "Choose a doctor, RMO or nurse of this hospital.",
            });
          value = { id: s.id, name: s.name };
        }
        const was = target[key]?.id ? String(target[key].id) : null;
        if (was !== (value?.id ?? null)) target[key] = value;
        continue;
      }
      if (section === "escalation" && key === "balloon") {
        for (const [bk, bv] of Object.entries(value)) {
          if (bv === undefined || same(bv, target.balloon?.[bk])) continue;
          if (BALLOON_TIME_KEYS.includes(bk) && bv) {
            notFuture(req, bv, `escalation.balloon.${bk}`);
            log(`escalation.balloon.${bk}`, bv);
          }
          target.balloon[bk] = bv;
        }
        continue;
      }
      if (section === "outcome" && key === "units") {
        for (const [uk, uv] of Object.entries(value))
          if (uv !== undefined) target.units[uk] = uv;
        continue;
      }
      if (same(value, target[key])) continue;
      if (TIME_KEYS[section]?.includes(key) && value) {
        notFuture(req, value, `${section}.${key}`);
        log(`${section}.${key}`, value);
      }
      if (
        section === "header" &&
        DECLARATION_KEYS.includes(key) &&
        value != null &&
        value !== ""
      )
        log(`header.${key}`, chart.header.declared_at);
      target[key] = value;
    }
  }

  // The rules on what was saved
  const bundle = chart.bundle;
  const repeat = txaRepeatBlock(bundle.T_txa_1g_at, bundle.T_txa_repeat_at);
  if (repeat) throw blocked("bundle.T_txa_repeat_at", repeat);
  if (b.bundle?.T_txa_1g_at) {
    const w = txaLateWarning(chart.header.delivery_time, bundle.T_txa_1g_at);
    if (w) warnings.push({ field: "bundle.T_txa_1g_at", text: w });
  }
  if (b.bundle?.O_ergometrine_at)
    for (const w of contraindicationWarnings(
      "ergometrine",
      flagsOf(patient, chart),
    ))
      warnings.push({ field: "bundle.O_ergometrine_at", text: w });
  const rows = chart.observations.filter((o) => !o.cancelled);
  const final = rows
    .filter((r) => r.cumulative_loss_ml != null)
    .sort((x, y) => x.at - y.at)
    .pop();
  if (
    chart.outcome.total_loss_ml != null &&
    final &&
    chart.outcome.total_loss_ml < final.cumulative_loss_ml
  )
    throw invalid({
      "outcome.total_loss_ml": `The total loss can't be less than the last cumulative loss (${final.cumulative_loss_ml} ml).`,
    });
  for (const w of warnings)
    chart.warningsShown.push({ ...w, byName: req.user.name, at: now });

  await automations(req, chart, patient, admission);
  await chart.save();
  await audit(req, "PPH_CHART_SAVED", {
    details: ids(patient, admission, { chartId: String(chart._id), parts }),
  });
  return answer(req, res, chart, patient, {
    warnings: warnings.map((w) => w.text),
  });
});

// ---------- Lines: observation rows, carboprost doses, Hb ----------
const productBody = z
  .object({
    type: z.enum(Object.keys(PRODUCTS), "Choose the product"),
    unit_number: safeText("Unit number", 40).refine(
      (v) => v.length >= 2,
      "Enter the unit number",
    ),
    issued_at: dt,
  })
  .strict();
const lineBody = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("obs"),
      at: reqTime("Time"),
      pulse: num("Pulse", 20, 250, true),
      sbp: num("Systolic BP", 30, 260, true),
      dbp: num("Diastolic BP", 10, 160, true),
      rr: num("Breathing rate", 4, 80, true),
      spo2: num("SpO2", 50, 100, true),
      urine_ml: num("Urine", 0, 5000, true),
      cumulative_loss_ml: num("Cumulative loss", 0, 20000, true),
      crystalloid_ml: num("Crystalloid", 0, 20000, true),
      colloid_ml: num("Colloid", 0, 10000, true),
      temp: num("Temperature", 30, 43),
      notes: safeText("Notes", 300).default(""),
      products: z.array(productBody).max(10).default([]),
      witness: witnessSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("carboprost"), at: reqTime("Time") }).strict(),
  z
    .object({
      type: z.literal("hb"),
      at: reqTime("Time"),
      value: z.coerce
        .number("Hb must be a number")
        .min(1, "Hb looks too low – please check")
        .max(25, "Hb looks too high – please check"),
    })
    .strict(),
]);

pphRouter.post("/:id/lines", async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!mayWrite(req, patient))
    throw forbidden("Only nurses, her doctor and RMOs write the PPH chart.");
  if (!isOpen(chart))
    throw conflict(
      "This PPH chart is closed: it was signed off and is locked.",
    );
  if (!chart.header)
    throw conflict(
      "This is the earlier DRAFT chart: declare a new PPH to use OBG-F-07.",
    );
  const b = parse(lineBody, req.body);
  notFuture(req, b.at, "at");
  if (b.at < admission.admittedAt)
    throw invalid({
      at: "The time is before she was admitted – please check it.",
    });
  const warnings = [];
  if (b.type === "carboprost") {
    const why = carboprostBlock(
      chart.carboprost.filter((d) => !d.cancelled).map((d) => d.at),
      b.at,
    );
    if (why) {
      await audit(req, "PPH_DOSE_REFUSED", {
        details: ids(patient, admission, {
          chartId: String(chart._id),
          rule: "A3",
        }),
      });
      throw blocked("at", why);
    }
    warnings.push(
      ...contraindicationWarnings("carboprost", flagsOf(patient, chart)),
    );
    chart.carboprost.push({ at: b.at, warnings, ...stamp(req) });
    for (const w of warnings)
      chart.warningsShown.push({
        field: "bundle.O_carboprost_doses",
        text: w,
        byName: req.user.name,
        at: nowOf(req),
      });
  }
  if (b.type === "hb")
    chart.hb_series.push({ at: b.at, value: b.value, ...stamp(req) });
  if (b.type === "obs") {
    const { type, witness, products, ...row } = b;
    const readings = [
      "pulse",
      "sbp",
      "dbp",
      "rr",
      "spo2",
      "urine_ml",
      "cumulative_loss_ml",
      "crystalloid_ml",
      "colloid_ml",
      "temp",
    ];
    if (readings.every((k) => row[k] == null) && !products.length && !row.notes)
      throw invalid({ pulse: "Enter at least one reading" });
    if ((row.sbp == null) !== (row.dbp == null))
      throw invalid({ sbp: "Enter both blood pressure numbers" });
    const others = chart.observations.filter((o) => !o.cancelled);
    const floor =
      chart.header.loss_at_declaration_ml != null &&
      b.at >= chart.header.declared_at
        ? chart.header.loss_at_declaration_ml
        : null;
    const why = cumulativeBlock(others, b.at, row.cumulative_loss_ml, floor);
    if (why) throw invalid({ cumulative_loss_ml: why });
    let check = null;
    if (products.length) {
      for (const p of products) notFuture(req, p.issued_at, "products");
      if (!witness)
        throw invalid({
          "witness.email":
            "Blood products need the second person’s check: they type their own email and password.",
        });
      check = await verifyWitness(req, witness, { purpose: "blood_product" });
    }
    chart.observations.push({
      ...row,
      products: products.map((p) => ({ ...p, two_person_check: check })),
      ...stamp(req),
    });
  }
  await automations(req, chart, patient, admission);
  await chart.save();
  await audit(req, "PPH_CHART_LINE_ADDED", {
    details: ids(patient, admission, {
      chartId: String(chart._id),
      line: b.type,
      ...(b.type === "obs" && b.products.length
        ? { products: b.products.length }
        : {}),
    }),
  });
  return answer(req, res, chart, patient, { status: 201, warnings });
});

const reasonBody = z
  .object({
    reason: safeText("Reason", 300).refine(
      (t) => t.trim().length >= 5,
      "Please say why (at least 5 characters).",
    ),
  })
  .strict();
pphRouter.post("/:id/lines/:lineId/cancel", async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!mayWrite(req, patient))
    throw forbidden("Only nurses, her doctor and RMOs write the PPH chart.");
  if (!isOpen(chart))
    throw conflict(
      "This PPH chart is closed: it was signed off and is locked.",
    );
  const { lineId } = parse(
    z.object({ id: objectId, lineId: objectId }),
    req.params,
  );
  const { reason } = parse(reasonBody, req.body);
  const line =
    chart.observations.id(lineId) ??
    chart.carboprost.id(lineId) ??
    chart.hb_series.id(lineId);
  if (!line) throw new HttpError(404, "This line was not found.", "NOT_FOUND");
  if (line.cancelled) throw conflict("Already marked as entered in error.");
  line.cancelled = {
    reason,
    by: req.user._id,
    byName: req.user.name,
    at: nowOf(req),
  };
  await chart.save();
  await audit(req, "PPH_CHART_LINE_CANCELLED", {
    details: ids(patient, admission, { chartId: String(chart._id) }),
  });
  return answer(req, res, chart, patient);
});

// ---------- The scan of the paper OBG-F-07 ----------
pphRouter.post("/:id/scans", async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!mayWrite(req, patient))
    throw forbidden("Only nurses, her doctor and RMOs write the PPH chart.");
  if (!isOpen(chart))
    throw conflict(
      "This PPH chart is closed: it was signed off and is locked.",
    );
  const body = parse(fileUploadSchema, req.body);
  const file = await storeFile(req, {
    patientId: patient._id,
    kind: "pph_paper_scan",
    ownerId: chart._id,
    body,
  });
  chart.paperScans.push({
    fileId: file._id,
    fileName: file.fileName,
    mediaType: file.mediaType,
    size: file.size,
    byName: req.user.name,
    at: nowOf(req),
  });
  await chart.save();
  await audit(req, "PPH_SCAN_ADDED", {
    details: ids(patient, admission, {
      chartId: String(chart._id),
      fileId: String(file._id),
    }),
  });
  return answer(req, res, chart, patient, { status: 201 });
});

pphRouter.get("/:id/scans/:fileId", async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  const { fileId } = parse(
    z.object({ id: objectId, fileId: objectId }),
    req.params,
  );
  const file = await findFile(req, {
    kind: "pph_paper_scan",
    ownerId: chart._id,
    fileId,
  });
  await audit(req, "PPH_SCAN_OPENED", {
    details: ids(patient, admission, { chartId: String(chart._id), fileId }),
  });
  sendFile(res, file);
});

// ---------- Consultant sign-off: A5 works out the KPI fields and locks the episode ----------
pphRouter.post("/:id/signoff", async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!maySign(req, patient))
    throw forbidden(
      "The consultant signs off the PPH chart (a doctor who may edit her record).",
    );
  if (!isOpen(chart)) throw conflict("This PPH chart is already signed off.");
  if (!chart.header)
    throw conflict(
      "This is the earlier DRAFT chart: it cannot be signed off as OBG-F-07.",
    );
  parse(z.object({}).strict(), req.body);
  const missing = missingForSignoff(plain(chart));
  if (Object.keys(missing).length)
    throw invalid(missing, "Fill in the required fields before sign-off.");
  if (lateEntries(chart).length && !chart.paperScans.length)
    throw Object.assign(
      conflict(
        "Late entries: attach the scan of the paper OBG-F-07 before sign-off.",
      ),
      { fields: { paperScan: "Attach the scan of the paper chart" } },
    );
  await automations(req, chart, patient, admission);
  const now = nowOf(req);
  chart.consultantSignoff = {
    by: req.user._id,
    byName: req.user.name,
    at: now,
  };
  chart.kpi = { ...kpiFields(plain(chart)), computedAt: now };
  chart.status = "closed";
  await chart.save();
  await audit(req, "PPH_SIGNED_OFF", {
    details: ids(patient, admission, { chartId: String(chart._id) }),
  });
  return answer(req, res, chart, patient);
});

pphRouter.post("/:id/cancel", async (req, res) => {
  const { chart, patient, admission } = await loadChart(req);
  if (!mayWrite(req, patient))
    throw forbidden("Only nurses, her doctor and RMOs write the PPH chart.");
  if (!isOpen(chart))
    throw conflict(
      "This PPH chart is closed: it was signed off and is locked.",
    );
  const { reason } = parse(reasonBody, req.body);
  chart.cancelled = {
    reason,
    by: req.user._id,
    byName: req.user.name,
    at: nowOf(req),
  };
  await chart.save();
  await audit(req, "PPH_CHART_CANCELLED", {
    details: ids(patient, admission, { chartId: String(chart._id) }),
  });
  return answer(req, res, chart, patient);
});

// ---------- Automations A1 and A4 (run before each save) ----------
async function settingsOf(tenantId) {
  return (
    (await PphSettings.findOne({ tenantId }).lean()) ?? {
      leadObstetricianIds: [],
      directorIds: [],
    }
  );
}
const place = (admission) =>
  [admission.ward, admission.bed && `bed ${admission.bed}`]
    .filter(Boolean)
    .join(", ") || "her stay";

async function automations(req, chart, patient, admission) {
  const now = nowOf(req);
  const ep = plain(chart);
  // A1: OBG-F-19 near-miss record pre-filled, Lead Obstetrician told, on the M&M list
  const criteria = nearMissCriteria(ep);
  if (criteria.length && !chart.nearMiss) {
    const summary = [
      "Pre-filled by Perinexa from the PPH chart (OBG-F-07) – OBG-F-19 near-miss criteria met:",
      ...criteria.map((k) => `- ${NEAR_MISS[k]}`),
      `Total blood loss: ${totalLossOf(ep) ?? "not recorded"} ml. Causes: ${(ep.header.cause_4T ?? []).map((k) => PPH_CAUSES[k]).join(", ") || "not recorded"}.`,
    ].join("\n");
    const review = await CaseReview.create({
      tenantId: req.tenantId,
      serial: await nextNumber(req.tenantId, "case_review"),
      kind: "near_miss",
      patientId: patient._id,
      eventAt: ep.header.declared_at,
      summary,
      criteria: [
        criteria.includes("hysterectomy") && "hysterectomy",
        productsCounted(ep.observations).prbc >= 5 && "transfusion",
      ].filter(Boolean),
      cause: "haemorrhage",
      started: {
        by: req.user._id,
        byName: `Perinexa (PPH chart, ${req.user.name})`,
        at: now,
      },
    });
    await audit(req, "CASE_REVIEW_STARTED", {
      target: patient,
      details: {
        reviewId: String(review._id),
        serial: review.serial,
        kind: "near_miss",
        patientId: String(patient._id),
        automatic: true,
        source: "pph_chart",
      },
    });
    const s = await settingsOf(req.tenantId);
    const notified = await notify(
      req,
      s.leadObstetricianIds.length
        ? { userIds: s.leadObstetricianIds }
        : { roles: ["quality"] },
      {
        kind: "pph",
        text: `PPH near-miss criteria met (${place(admission)}) – near-miss review ${review.serial} started; on the M&M list`,
        link: "/clinical-audit/pph-reviews",
      },
    );
    chart.nearMiss = {
      at: now,
      criteria,
      caseReviewId: review._id,
      serial: review.serial,
      notified,
    };
    chart.mm = { addedAt: now, reviewBy: new Date(now.getTime() + 7 * DAY) };
    await audit(req, "PPH_NEAR_MISS_STARTED", {
      details: ids(patient, admission, {
        chartId: String(chart._id),
        reviewId: String(review._id),
        criteria,
      }),
    });
  } else if (chart.nearMiss) {
    const more = criteria.filter((k) => !chart.nearMiss.criteria.includes(k));
    if (more.length)
      chart.nearMiss.criteria = [...chart.nearMiss.criteria, ...more];
  }
  // A4: massive haemorrhage declared – the Director told (the notification bell), the blood bank pack request recorded
  if (chart.escalation?.massive_haemorrhage_declared_at && !chart.massive) {
    const s = await settingsOf(req.tenantId);
    const notified = await notify(
      req,
      s.directorIds.length ? { userIds: s.directorIds } : { roles: ["admin"] },
      {
        kind: "pph",
        text: `Massive obstetric haemorrhage declared – ${place(admission)}`,
        link: `/patients/${patient._id}/stays/${admission._id}`,
      },
    );
    chart.massive = {
      at: chart.escalation.massive_haemorrhage_declared_at,
      notified,
      packRequestedAt: now,
      requestedByName: req.user.name,
    };
    await audit(req, "PPH_MASSIVE_DECLARED", {
      details: ids(patient, admission, { chartId: String(chart._id) }),
    });
  }
}

// ---------- /api/pph-reviews: the M&M list and who is told ----------
const REVIEW_ROLES = ["doctor", "rmo", "quality"];
pphReviewsRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...REVIEW_ROLES, "admin"))
    throw forbidden(
      "PPH reviews are for doctors, RMOs, the quality lead and the hospital admin.",
    );
  next();
});

pphReviewsRouter.get("/", async (req, res) => {
  if (!hasRole(req.membership, ...REVIEW_ROLES))
    throw forbidden("The M&M list is for doctors, RMOs and the quality lead.");
  const all = await PphChart.find({
    tenantId: req.tenantId,
    mm: { $ne: null },
    cancelled: null,
  })
    .sort({ "mm.addedAt": -1 })
    .limit(200)
    .lean();
  const patients = new Map(
    (
      await Patient.find(
        { tenantId: req.tenantId, _id: { $in: all.map((c) => c.patientId) } },
        { fullName: 1, mrn: 1, assignedDoctor: 1, department: 1, departmentReferrals: 1, babyDepartments: 1 },
      ).lean()
    ).map((p) => [String(p._id), p]),
  );
  // Episodes of another department's patients are left out for a doctor (departments, 9 Nov 2026)
  const list = all.filter((c) => {
    const p = patients.get(String(c.patientId));
    return !p || departmentListed(req, p);
  });
  const now = nowOf(req);
  await audit(req, "PPH_MM_LIST_VIEWED", { details: { count: list.length } });
  res.json({
    episodes: list.map((c) => {
      const p = patients.get(String(c.patientId));
      return {
        id: String(c._id),
        patient: p
          ? { id: String(p._id), fullName: p.fullName, mrn: p.mrn }
          : null,
        admissionId: String(c.admissionId),
        declared_at: c.header?.declared_at ?? null,
        criteria: c.nearMiss?.criteria ?? [],
        review: c.nearMiss?.caseReviewId
          ? { id: String(c.nearMiss.caseReviewId), serial: c.nearMiss.serial }
          : null,
        addedAt: c.mm.addedAt,
        reviewBy: c.mm.reviewBy,
        overdue: !c.mm.discussedAt && new Date(c.mm.reviewBy) < now,
        discussedAt: c.mm.discussedAt ?? null,
        discussedByName: c.mm.discussedByName ?? null,
        status: c.status,
      };
    }),
    rules: { nearMiss: NEAR_MISS },
    canDiscuss: hasRole(req.membership, "doctor"),
  });
});

pphReviewsRouter.post("/:id/discussed", async (req, res) => {
  if (!hasRole(req.membership, "doctor"))
    throw forbidden("A doctor marks an episode discussed at the M&M meeting.");
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { note } = parse(
    z.object({ note: safeText("Note", 300).default("") }).strict(),
    req.body,
  );
  const chart = await PphChart.findOne({
    _id: id,
    tenantId: req.tenantId,
    mm: { $ne: null },
  });
  if (!chart) throw notFound();
  // Another department's patient: not found (departments, 9 Nov 2026)
  const owner = await Patient.findOne(
    { _id: chart.patientId, tenantId: req.tenantId },
    { assignedDoctor: 1, department: 1, departmentReferrals: 1, babyDepartments: 1 },
  ).lean();
  if (owner && !departmentListed(req, owner)) throw notFound();
  if (chart.mm.discussedAt) throw conflict("Already marked discussed.");
  chart.mm.discussedAt = nowOf(req);
  chart.mm.discussedByName = req.user.name;
  chart.mm.note = note;
  await chart.save();
  await audit(req, "PPH_MM_DISCUSSED", {
    details: { chartId: String(chart._id), patientId: String(chart.patientId) },
  });
  res.json({ ok: true });
});

async function membersNamed(tenantId) {
  const members = await Membership.find(
    { tenantId, isActive: true },
    { userId: 1, roles: 1 },
  ).lean();
  const users = await User.find(
    { _id: { $in: members.map((m) => m.userId) }, isActive: true },
    { name: 1 },
  )
    .sort({ name: 1 })
    .lean();
  return users.map((u) => ({ id: String(u._id), name: u.name }));
}
pphReviewsRouter.get("/settings", async (req, res) => {
  const s = await settingsOf(req.tenantId);
  const people = await membersNamed(req.tenantId);
  const named = (list) =>
    list.map((id) => people.find((p) => p.id === String(id))).filter(Boolean);
  res.json({
    leadObstetricians: named(s.leadObstetricianIds),
    directors: named(s.directorIds),
    people: hasRole(req.membership, "admin") ? people : [],
    canEdit: hasRole(req.membership, "admin"),
    updatedByName: s.updatedByName ?? "",
  });
});

pphReviewsRouter.put("/settings", async (req, res) => {
  if (!hasRole(req.membership, "admin"))
    throw forbidden("The hospital admin names who is told.");
  const b = parse(
    z
      .object({
        leadObstetricianIds: z.array(objectId).max(10),
        directorIds: z.array(objectId).max(10),
      })
      .strict(),
    req.body,
  );
  const people = new Set((await membersNamed(req.tenantId)).map((p) => p.id));
  for (const [field, list] of Object.entries(b))
    if (list.some((id) => !people.has(id)))
      throw invalid({ [field]: "Choose active staff of this hospital." });
  await PphSettings.updateOne(
    { tenantId: req.tenantId },
    {
      $set: {
        leadObstetricianIds: [...new Set(b.leadObstetricianIds)],
        directorIds: [...new Set(b.directorIds)],
        updatedByName: req.user.name,
      },
    },
    { upsert: true },
  );
  await audit(req, "PPH_SETTINGS_CHANGED", {
    details: {
      leads: b.leadObstetricianIds.length,
      directors: b.directorIds.length,
    },
  });
  res.json({ ok: true });
});
