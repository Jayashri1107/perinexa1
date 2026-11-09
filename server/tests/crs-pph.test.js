// Clinical Requirements Group B, item 15 (PX-OBG-12) – Build 15, the PPH chart as OBG-F-07 v1.0
// (docs/field_schemas/build15_pph.json). The schema's six acceptance tests (the sixth, the print, is in the website's
// tests: client/src/pages/inpatient/pph.test.jsx), and the rules around them: A1–A5, late entry, the second-person
// check on blood products, cumulative loss, the KPI rows. Fake sample data only.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as website from "../../client/src/pages/inpatient/pphRules.js";
import { createApp } from "../src/app.js";
import {
  ensureStandardTemplates,
  resetApprovalBackfill,
} from "../src/careplans/templatesService.js";
import * as server from "../src/clinical/pph.js";
import {
  carboprostBlock,
  contraindicationWarnings,
  cumulativeBlock,
  kpiFields,
  lossBand,
  nearMissCriteria,
  shockIndex,
  txaLateWarning,
  txaRepeatBlock,
  within15,
} from "../src/clinical/pph.js";
import { pphRows } from "../src/clinical/pphKpi.js";
import { AuditLog } from "../src/models/AuditLog.js";
import { CaseReview } from "../src/models/CaseReview.js";
import { Notification } from "../src/models/Notification.js";
import { PphChart } from "../src/models/PphChart.js";
import {
  PASSWORD,
  addMember,
  connectTestDb,
  createTenant,
  createUser,
  disconnectTestDb,
  loginAs,
  resetTestDb,
  samplePatient,
} from "./helpers.js";

const ROLES = {
  drA: "doctor",
  lead: "doctor",
  rmo: "rmo",
  nurse: "nurse",
  nurse2: "nurse",
  reception: "receptionist",
  quality: "quality",
  admin: "admin",
  director: "admin",
};
const at = (hhmm, day = 10) => new Date(`2026-11-${day}T${hhmm}:00.000Z`);
const iso = (hhmm, day) => at(hhmm, day).toISOString();
let app;
let hospital;
let other;
let people;
let sessions;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at("01:30"));
  await resetTestDb();
  resetApprovalBackfill();
  app = createApp();
  hospital = await createTenant("PPH Hospital");
  other = await createTenant("Other PPH Hospital");
  people = {};
  sessions = {};
  for (const [key, role] of Object.entries(ROLES)) {
    people[key] = await createUser({ name: `Sample ${key}` });
    await addMember(people[key], hospital, role);
  }
  people.otherDr = await createUser({ name: "Sample other doctor" });
  await addMember(people.otherDr, other, "doctor");
  await ensureStandardTemplates(hospital._id);
});
afterEach(() => vi.useRealTimers());

// Moving the clock forward: sign in again (the 30-minute inactivity sign-out)
const clock = (hhmm) => {
  vi.setSystemTime(at(hhmm));
  sessions = {};
};
const as = async (who) =>
  (sessions[who] ??= await loginAs(people[who], { app }));
async function admitted(over = {}) {
  const made = await (
    await as("drA")
  )
    .post("/api/patients")
    .send(
      samplePatient({
        careType: "postnatal",
        fullName: "Pph Mother",
        assignedDoctor: people.drA._id.toString(),
        ...over,
      }),
    );
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const p = made.body.patient;
  const a = (
    await (
      await as("rmo")
    )
      .post(`/api/patients/${p.id}/admissions`)
      .send({
        clientRequestId: randomUUID(),
        billingType: "cash",
        stayType: "anc",
        admittedAt: "2026-11-10T01:00:00.000Z",
        ward: "Labour ward",
        bed: "2",
        reason: "In labour",
      })
  ).body.admission;
  return { p, a };
}
const declare = async (who, p, a, over = {}) =>
  (await as(who))
    .post("/api/pph")
    .send({
      clientRequestId: randomUUID(),
      patientId: p.id,
      admissionId: a.id,
      ...over,
    });
const save = async (who, c, body) =>
  (await as(who)).put(`/api/pph/${c.id}`).send(body);
const line = async (who, c, body) =>
  (await as(who)).post(`/api/pph/${c.id}/lines`).send(body);
const signoff = async (who, c) =>
  (await as(who)).post(`/api/pph/${c.id}/signoff`).send({});
const header = (over = {}) => ({
  header: {
    loss_at_declaration_ml: 600,
    loss_method: "weighed_swabs",
    cause_4T: ["tone"],
    ...over,
  },
});
const PDF = Buffer.from("%PDF-1.4\n% sample paper chart\n").toString("base64");

describe("the PPH rules (OBG-F-07)", () => {
  it("the website has the same rules, word for word", () => {
    const body = (f) =>
      readFileSync(new URL(f, import.meta.url), "utf8")
        .replace(/\r\n/g, "\n")
        .replace(/^(\/\/.*\n)+/, "");
    expect(body("../../client/src/pages/inpatient/pphRules.js")).toBe(
      body("../src/clinical/pph.js"),
    );
    expect(website.BUNDLE).toEqual(server.BUNDLE);
    for (const ml of [0, 499, 500, 999, 1000, 1499, 1500])
      expect(website.lossBand(ml)).toEqual(server.lossBand(ml));
  });

  it("loss bands 500–999 / 1000–1499 / 1500 or more (severe); shock index 0.9 or more red", () => {
    expect(
      [400, 500, 999, 1000, 1499, 1500].map((ml) => lossBand(ml).key),
    ).toEqual([
      "under_500",
      "500_999",
      "500_999",
      "1000_1499",
      "1000_1499",
      "severe",
    ]);
    expect(lossBand(1500).words).toBe("Severe PPH – 1500 ml or more");
    expect(shockIndex(90, 120)).toEqual({ value: 0.75, band: "normal" });
    expect(shockIndex(108, 120)).toEqual({ value: 0.9, band: "red" });
    expect(shockIndex(100, null)).toBeNull();
  });

  it("A3, TXA, contraindications (warnings only), cumulative loss", () => {
    expect(carboprostBlock([at("02:00")], at("02:10"))).toMatch(
      /Less than 15 minutes/,
    );
    expect(carboprostBlock([at("02:00")], at("02:15"))).toBeNull();
    expect(
      carboprostBlock(
        Array.from(
          { length: 8 },
          (_, i) => new Date(at("02:00").getTime() + i * 20 * 60000),
        ),
        at("05:00"),
      ),
    ).toMatch(/9th dose/);
    expect(txaRepeatBlock(at("02:00"), at("02:20"))).toMatch(
      /first dose \+ 30 minutes/,
    );
    expect(txaRepeatBlock(at("02:00"), at("02:30"))).toBeNull();
    expect(txaLateWarning(at("01:00"), at("04:01"))).toMatch(
      /more than 3 hours/,
    );
    expect(txaLateWarning(at("01:00"), at("04:00"))).toBeNull();
    expect(contraindicationWarnings("carboprost", { asthma: true })[0]).toMatch(
      /Asthma.*Warning only/,
    );
    expect(
      contraindicationWarnings("ergometrine", { pre_eclampsia: true })[0],
    ).toMatch(/Pre-eclampsia recorded.*Warning only/);
    expect(contraindicationWarnings("ergometrine", {})).toEqual([]);
    const rows = [
      { at: at("02:15"), cumulative_loss_ml: 800 },
      { at: at("02:45"), cumulative_loss_ml: 1200 },
    ];
    expect(cumulativeBlock(rows, at("02:30"), 700)).toMatch(/can't go down/);
    expect(cumulativeBlock(rows, at("02:30"), 1300)).toMatch(
      /can't be more than the later row/,
    );
    expect(cumulativeBlock(rows, at("02:30"), 1000)).toBeNull();
    expect(within15(at("02:25"), at("02:10"))).toBe(true);
    expect(within15(at("02:26"), at("02:10"))).toBe(false);
  });

  it("the KPI fields and the near-miss criteria", () => {
    const ep = {
      header: { declared_at: at("02:10"), loss_method: "estimated" },
      bundle: {
        T_txa_1g_at: at("02:20"),
        I_iv_access_x2_at: at("02:12"),
        O_oxytocin_infusion_at: at("02:15"),
      },
      carboprost: [{ at: at("02:22") }],
      escalation: {},
      observations: [],
      outcome: { total_loss_ml: 1100 },
    };
    expect(kpiFields(ep)).toMatchObject({
      txa_within_15_min: true,
      second_uterotonic_within_15_min: true,
      bundle_complete_15_min: true,
      pph_category: "1000_1499",
      measured_loss: false,
    });
    expect(
      nearMissCriteria({
        ...ep,
        outcome: {
          total_loss_ml: 1600,
          disposition: "icu",
          units: { prbc: 2, ffp: 2 },
        },
        escalation: { hysterectomy_at: at("03:00") },
      }),
    ).toEqual(["loss_1500", "units_4", "hysterectomy", "icu"]);
  });
});

describe("the PPH chart (acceptance tests of build15_pph.json)", () => {
  it('1 – declare at 02:10, TXA 02:20, carboprost 02:22 → both "within 15 min" true', async () => {
    const { p, a } = await admitted();
    clock("02:10");
    const d = await declare("nurse", p, a);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    let c = d.body.chart;
    expect(c).toMatchObject({
      declared_at: iso("02:10"),
      header: { declared_by: { name: "Sample nurse" } },
      status: "open",
    });
    expect(
      (await (await as("nurse")).get(`/api/pph/current?patientId=${p.id}`))
        .body,
    ).toMatchObject({
      admissionId: a.id,
      open: { id: c.id, declared_at: iso("02:10") },
      canDeclare: false,
    });
    clock("02:20");
    c = (await save("nurse", c, { bundle: { T_txa_1g_at: iso("02:20") } })).body
      .chart;
    clock("02:22");
    c = (await line("nurse", c, { type: "carboprost", at: iso("02:22") })).body
      .chart;
    expect(c.within15.T_txa_1g_at).toBe(true);
    expect(c.carboprost[0].within15).toBe(true);
    expect(c.kpi).toMatchObject({
      txa_within_15_min: true,
      second_uterotonic_within_15_min: true,
      bundle_complete_15_min: false,
    });
    expect(c.late).toEqual([]); // typed live: no late entry
    expect((await declare("nurse", p, a)).status).toBe(409); // one open episode at a time
  });

  it("2 – total loss 1600 ml saved → F-19 near miss pre-filled, the Lead Obstetrician told, on the M&M list", async () => {
    expect(
      (
        await (
          await as("drA")
        )
          .put("/api/pph-reviews/settings")
          .send({
            leadObstetricianIds: [String(people.lead._id)],
            directorIds: [],
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await (
          await as("admin")
        )
          .put("/api/pph-reviews/settings")
          .send({
            leadObstetricianIds: [String(people.lead._id)],
            directorIds: [String(people.director._id)],
          })
      ).status,
    ).toBe(200);
    const { p, a } = await admitted();
    clock("02:10");
    const c = (await declare("rmo", p, a)).body.chart;
    clock("02:40");
    const s = await save("rmo", c, {
      ...header(),
      outcome: { total_loss_ml: 1600 },
    });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.chart.nearMiss).toMatchObject({
      criteria: ["loss_1500"],
      serial: 1,
    });
    expect(s.body.chart.loss).toMatchObject({ key: "severe" });
    const review = await CaseReview.findOne({ tenantId: hospital._id });
    expect(review).toMatchObject({
      kind: "near_miss",
      cause: "haemorrhage",
      status: "draft",
    });
    expect(review.summary).toMatch(
      /OBG-F-19 near-miss criteria met:\n- Total blood loss 1500 ml or more/,
    );
    const told = await Notification.find({
      tenantId: hospital._id,
      kind: "pph",
    }).lean();
    expect(told.map((n) => String(n.userId))).toEqual([
      String(people.lead._id),
    ]);
    expect(told[0].text).not.toMatch(/Pph Mother/);
    const mm = await (await as("quality")).get("/api/pph-reviews");
    expect(mm.body.episodes).toHaveLength(1);
    expect(mm.body.episodes[0]).toMatchObject({
      id: c.id,
      criteria: ["loss_1500"],
      review: { serial: 1 },
      overdue: false,
      patient: { fullName: "Pph Mother" },
    });
    // saving again does not start a second review
    await save("rmo", c, { outcome: { disposition: "icu" } });
    expect(await CaseReview.countDocuments({ tenantId: hospital._id })).toBe(1);
    expect(
      (await PphChart.findOne({ _id: c.id, tenantId: hospital._id })).nearMiss
        .criteria,
    ).toEqual(["loss_1500", "icu"]);
    expect(
      (
        await (
          await as("drA")
        )
          .post(`/api/pph-reviews/${c.id}/discussed`)
          .send({ note: "Sample M&M" })
      ).status,
    ).toBe(200);
    expect((await (await as("nurse")).get("/api/pph-reviews")).status).toBe(
      403,
    );
  });

  it("3 – a 9th carboprost dose is refused; a 2nd dose at +10 min is refused", async () => {
    const { p, a } = await admitted();
    const c = (await declare("nurse", p, a, { declared_at: iso("01:20") })).body
      .chart;
    expect(
      (await line("nurse", c, { type: "carboprost", at: iso("01:21") })).status,
    ).toBe(201);
    const tooSoon = await line("nurse", c, {
      type: "carboprost",
      at: iso("01:31"),
    });
    expect(tooSoon.status).toBe(400);
    expect(tooSoon.body.error.fields.at).toMatch(/Less than 15 minutes/);
    clock("04:30");
    for (let i = 1; i < 8; i += 1)
      expect(
        (
          await line("nurse", c, {
            type: "carboprost",
            at: new Date(at("01:21").getTime() + i * 16 * 60000).toISOString(),
          })
        ).status,
      ).toBe(201);
    const ninth = await line("nurse", c, {
      type: "carboprost",
      at: iso("04:00"),
    });
    expect(ninth.status).toBe(400);
    expect(ninth.body.error.fields.at).toMatch(/9th dose/);
    expect(
      (await PphChart.findOne({ _id: c.id, tenantId: hospital._id }))
        .carboprost,
    ).toHaveLength(8);
    expect(
      await AuditLog.countDocuments({
        tenantId: hospital._id,
        action: "PPH_DOSE_REFUSED",
      }),
    ).toBe(2);
  });

  it("4 – ergometrine on a patient with the pre-eclampsia flag shows a warning (not a block)", async () => {
    const { p, a } = await admitted();
    clock("02:10");
    const c = (await declare("nurse", p, a)).body.chart;
    const s = await save("nurse", c, {
      header: { risk_factors: ["pre_eclampsia"] },
      bundle: { O_ergometrine_at: iso("02:10") },
    });
    expect(s.status).toBe(200);
    expect(s.body.warnings[0]).toMatch(
      /Pre-eclampsia recorded – ergometrine is contraindicated/,
    );
    expect(s.body.chart.bundle.O_ergometrine_at).toBe(iso("02:10"));
    expect(s.body.chart.warningsShown[0]).toMatchObject({
      field: "bundle.O_ergometrine_at",
      byName: "Sample nurse",
    });
    // asthma on her record → carboprost warns
    const asthmatic = await admitted({
      fullName: "Asthma Mother",
      medical: { conditions: ["asthma"], allergies: "None known" },
    });
    const c2 = (await declare("nurse", asthmatic.p, asthmatic.a)).body.chart;
    const dose = await line("nurse", c2, {
      type: "carboprost",
      at: iso("02:10"),
    });
    expect(dose.status).toBe(201);
    expect(dose.body.warnings[0]).toMatch(/Asthma/);
  });

  it('5 – transcribed entries show "late entry" and need the paper scan before the consultant signs off; then A5 locks it', async () => {
    const { p, a } = await admitted();
    clock("06:00");
    const c = (await declare("nurse", p, a, { declared_at: iso("02:10") })).body
      .chart; // typed from the paper chart
    let s = await save("nurse", c, {
      ...header(),
      bundle: { T_txa_1g_at: iso("02:20"), O_misoprostol_800_at: iso("02:18") },
    });
    expect(s.body.chart.late.map((l) => l.label)).toEqual(
      expect.arrayContaining([
        "PPH declared",
        "Tranexamic acid",
        "Misoprostol",
        "Loss at declaration",
      ]),
    );
    s = (
      await line("nurse", c, {
        type: "obs",
        at: iso("02:30"),
        pulse: 118,
        sbp: 96,
        dbp: 60,
        cumulative_loss_ml: 900,
      })
    ).body;
    expect(s.chart.observations[0]).toMatchObject({
      late: true,
      shock: { value: 1.23, band: "red" },
    });
    await save("nurse", c, {
      outcome: { total_loss_ml: 950, disposition: "ward" },
    });
    expect((await signoff("nurse", c)).status).toBe(403); // the consultant (a doctor)
    const refused = await signoff("drA", c);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(
      /attach the scan of the paper OBG-F-07/,
    );
    const scan = await (
      await as("nurse")
    )
      .post(`/api/pph/${c.id}/scans`)
      .send({
        fileName: "obg-f-07.pdf",
        mediaType: "application/pdf",
        data: PDF,
      });
    expect(scan.status, JSON.stringify(scan.body)).toBe(201);
    const opened = await (
      await as("drA")
    ).get(`/api/pph/${c.id}/scans/${scan.body.chart.paperScans[0].fileId}`);
    expect(opened.headers["content-type"]).toMatch(/application\/pdf/);
    const signed = await signoff("drA", c);
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body.chart).toMatchObject({
      status: "closed",
      consultantSignoff: { byName: "Sample drA" },
      kpiLocked: true,
      kpi: {
        txa_within_15_min: true,
        second_uterotonic_within_15_min: true,
        pph_category: "500_999",
        measured_loss: true,
        total_loss_ml: 950,
      },
    });
    expect(
      (await save("nurse", c, { outcome: { total_loss_ml: 1000 } })).status,
    ).toBe(409);
    expect(
      (await line("nurse", c, { type: "hb", at: iso("03:00"), value: 8 }))
        .status,
    ).toBe(409);
  });
});

describe("the rest of the chart", () => {
  it("blood products need the second person (PX-X-06); the cumulative loss never goes down; total ≥ the last row", async () => {
    const { p, a } = await admitted();
    clock("02:10");
    const c = (await declare("nurse", p, a)).body.chart;
    await save("nurse", c, header());
    clock("02:30");
    const unit = {
      type: "PRBC",
      unit_number: "SAMPLE-0001",
      issued_at: iso("02:25"),
    };
    expect(
      (
        await line("nurse", c, {
          type: "obs",
          at: iso("02:30"),
          cumulative_loss_ml: 900,
          products: [unit],
        })
      ).body.error.fields["witness.email"],
    ).toMatch(/second person/);
    expect(
      (
        await line("nurse", c, {
          type: "obs",
          at: iso("02:30"),
          cumulative_loss_ml: 500,
        })
      ).body.error.fields.cumulative_loss_ml,
    ).toMatch(/can't go down – it was 600 ml/);
    const ok = await line("nurse", c, {
      type: "obs",
      at: iso("02:30"),
      cumulative_loss_ml: 900,
      products: [unit],
      witness: { email: people.nurse2.email, password: PASSWORD },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.chart.observations[0].products[0]).toMatchObject({
      type: "PRBC",
      unit_number: "SAMPLE-0001",
      two_person_check: { byName: "Sample nurse2", role: "Nurse" },
    });
    expect(ok.body.chart.productsCounted).toEqual({
      prbc: 1,
      ffp: 0,
      platelets: 0,
      cryo: 0,
    });
    expect(
      (await save("nurse", c, { outcome: { total_loss_ml: 800 } })).body.error
        .fields["outcome.total_loss_ml"],
    ).toMatch(/last cumulative loss \(900 ml\)/);
  });

  it("TXA repeat not before +30 min; TXA after 3 h warns; fibrinogen under 2 prompts cryo; declared_at edited with a reason", async () => {
    const { p, a } = await admitted();
    clock("05:00");
    const c = (await declare("rmo", p, a, { declared_at: iso("04:50") })).body
      .chart;
    await save("rmo", c, { header: { delivery_time: iso("01:30") } });
    const late = await save("rmo", c, {
      bundle: { T_txa_1g_at: iso("04:52") },
    });
    expect(late.body.warnings[0]).toMatch(/more than 3 hours after birth/);
    expect(
      (await save("rmo", c, { bundle: { T_txa_repeat_at: iso("05:00") } })).body
        .error.fields["bundle.T_txa_repeat_at"],
    ).toMatch(/first dose \+ 30 minutes/);
    expect(
      (await save("rmo", c, { labs: { fibrinogen_g_l: 1.6 } })).body.chart
        .prompts,
    ).toEqual(["Fibrinogen under 2 g/L – cryoprecipitate 2 pools."]);
    expect(
      (await save("rmo", c, { header: { declared_at: iso("04:45") } })).body
        .error.fields.declared_at_reason,
    ).toMatch(/Say why/);
    const moved = await save("rmo", c, {
      header: { declared_at: iso("04:45") },
      declared_at_reason: "Paper chart says 04:45",
    });
    expect(moved.body.chart.declaredAtChanges[0]).toMatchObject({
      from: iso("04:50"),
      to: iso("04:45"),
      reason: "Paper chart says 04:45",
    });
  });

  it("A4 – massive haemorrhage: the Director told by the bell, the blood bank pack request recorded; E set", async () => {
    await (
      await as("admin")
    )
      .put("/api/pph-reviews/settings")
      .send({
        leadObstetricianIds: [],
        directorIds: [String(people.director._id)],
      });
    const { p, a } = await admitted();
    clock("02:10");
    const c = (await declare("nurse", p, a)).body.chart;
    clock("02:30");
    const s = await save("drA", c, {
      escalation: { massive_haemorrhage_declared_at: iso("02:30") },
    });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.chart).toMatchObject({
      E_escalated: true,
      massive: {
        at: iso("02:30"),
        packRequestedAt: iso("02:30"),
        requestedByName: "Sample drA",
      },
    });
    const told = await Notification.find({
      tenantId: hospital._id,
      kind: "pph",
    }).lean();
    expect(told.map((n) => [String(n.userId), n.text])).toEqual([
      [
        String(people.director._id),
        "Massive obstetric haemorrhage declared – Labour ward, bed 2",
      ],
    ]);
    await save("drA", c, { escalation: { to_ot_at: iso("02:35") } });
    expect(
      await Notification.countDocuments({
        tenantId: hospital._id,
        kind: "pph",
      }),
    ).toBe(1); // once
  });

  it("copies the delivery from the delivery note; reception, another hospital and a baby have none; audit has ids only", async () => {
    const { p, a } = await admitted();
    clock("02:10");
    const c = (await declare("nurse", p, a)).body.chart;
    await save(
      "nurse",
      c,
      header({
        pulse_at_declaration: 110,
        systolic_at_declaration: 100,
        consultant: String(people.drA._id),
      }),
    );
    const list = await (
      await as("drA")
    ).get(`/api/pph?patientId=${p.id}&admissionId=${a.id}`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.charts[0]).toMatchObject({
      shock_index_at_declaration: { value: 1.1, band: "red" },
      header: { consultant: { name: "Sample drA" } },
    });
    expect(list.body.rules.form).toMatchObject({
      code: "OBG-F-07",
      footer: "OBG-F-07 · v1.0",
    });
    expect(list.body.staff.map((s) => s.name)).toContain("Sample nurse2");
    expect(
      (
        await save("nurse", c, {
          header: { consultant: String(people.reception._id) },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await (
          await as("reception")
        ).get(`/api/pph?patientId=${p.id}&admissionId=${a.id}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await (
          await as("otherDr")
        ).get(`/api/pph?patientId=${p.id}&admissionId=${a.id}`)
      ).status,
    ).toBe(404);
    expect(
      (await (await as("otherDr")).get("/api/pph-reviews")).body.episodes ?? [],
    ).toEqual([]);
    const audited = await AuditLog.find({
      tenantId: hospital._id,
      action: /^PPH_/,
    }).lean();
    expect(audited.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        "PPH_DECLARED",
        "PPH_CHART_SAVED",
        "PPH_CHART_VIEWED",
      ]),
    );
    for (const x of audited)
      expect(
        Object.keys(x.details).filter((k) =>
          [
            "loss_at_declaration_ml",
            "pulse_at_declaration",
            "cumulative_loss_ml",
            "value",
          ].includes(k),
        ),
      ).toEqual([]);
  });

  it("feeds the four OBG-A-05 rows", async () => {
    const { p, a } = await admitted();
    clock("02:10");
    const c = (await declare("nurse", p, a)).body.chart;
    clock("02:30");
    await save("nurse", c, {
      ...header({ delivery_mode: "vaginal" }),
      bundle: { T_txa_1g_at: iso("02:20"), O_misoprostol_800_at: iso("02:15") },
      outcome: { total_loss_ml: 1600 },
    });
    const rows = await pphRows(hospital._id, {
      start: new Date("2026-11-01T00:00:00Z"),
      end: new Date("2026-12-01T00:00:00Z"),
    });
    expect(rows.pphBundle15).toEqual({
      value: 100,
      numerator: 1,
      denominator: 1,
    });
    expect(rows.pphVaginal).toMatchObject({
      numerator: 1,
      denominator: 0,
      value: null,
    }); // no confirmed delivery note this month
    expect(rows.pphSevere).toMatchObject({ numerator: 1, denominator: 0 });
    expect(
      (
        await pphRows(other._id, {
          start: new Date("2026-11-01T00:00:00Z"),
          end: new Date("2026-12-01T00:00:00Z"),
        })
      ).pphBundle15.denominator,
    ).toBe(0);
  });
});
