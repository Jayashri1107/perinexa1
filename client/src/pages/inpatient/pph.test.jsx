// Clinical Requirements Group B, item 15 – Build 15, the PPH chart as OBG-F-07 v1.0: the transcription screen (late
// entry, within 15 minutes, the schema's doses, warnings not blocks), the banner clock, and acceptance test 6 – the
// print matches the OBG-F-07 master (A4 portrait; header, E-MOTIVE three-column block, observations, labs/outcome; footer
// "OBG-F-07 · v1.0"). Fake sample data only.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const chart = {
  id: "c1",
  form: "OBG-F-07 v1.0",
  draftChart: false,
  declared_at: "2026-11-10T02:10:00.000Z",
  header: {
    delivery_mode: "vaginal",
    delivery_time: "2026-11-10T01:40:00.000Z",
    declared_by: { id: "u1", name: "Sample nurse" },
    loss_at_declaration_ml: 600,
    loss_method: "weighed_swabs",
    pulse_at_declaration: 118,
    systolic_at_declaration: 96,
    cause_4T: ["tone"],
    risk_factors: ["pre_eclampsia"],
    consultant: { id: "u2", name: "Sample doctor" },
  },
  shock_index_at_declaration: { value: 1.23, band: "red" },
  declaredAtChanges: [],
  bundle: {
    T_txa_1g_at: "2026-11-10T02:20:00.000Z",
    O_ergometrine_at: "2026-11-10T02:12:00.000Z",
    I_oxygen_started: true,
    V_placenta_complete: "complete",
  },
  within15: {
    T_txa_1g_at: true,
    O_ergometrine_at: true,
    M_uterine_massage_at: null,
  },
  carboprost: [
    {
      id: "d1",
      at: "2026-11-10T02:22:00.000Z",
      within15: true,
      warnings: [],
      byName: "Sample nurse",
      late: true,
      cancelled: null,
    },
  ],
  escalation: { balloon: {}, procedures: [] },
  E_escalated: false,
  observations: [
    {
      id: "o1",
      at: "2026-11-10T02:30:00.000Z",
      pulse: 118,
      sbp: 96,
      dbp: 60,
      cumulative_loss_ml: 900,
      products: [
        {
          type: "PRBC",
          unit_number: "SAMPLE-0001",
          two_person_check: { byName: "Sample nurse2", role: "Nurse" },
        },
      ],
      shock: { value: 1.23, band: "red" },
      byName: "Sample nurse",
      late: true,
      cancelled: null,
      notes: "",
    },
  ],
  hb_series: [],
  labs: { fibrinogen_g_l: 1.6 },
  outcome: { total_loss_ml: 950, units: { prbc: 1 }, disposition: "ward" },
  totalLossMl: 950,
  loss: { key: "500_999", band: "yellow", words: "PPH 500–999 ml" },
  productsCounted: { prbc: 1, ffp: 0, platelets: 0, cryo: 0 },
  prompts: ["Fibrinogen under 2 g/L – cryoprecipitate 2 pools."],
  warnings: {
    carboprost: [],
    ergometrine: [
      "Pre-eclampsia recorded – ergometrine is contraindicated. Warning only: check before it is given.",
    ],
    txa: null,
  },
  warningsShown: [],
  late: [
    { field: "header.declared_at", label: "PPH declared" },
    { field: "carboprost:d1", label: "Carboprost dose" },
  ],
  lateFields: ["header.declared_at", "bundle.T_txa_1g_at"],
  paperScans: [],
  missing: {},
  kpi: { txa_within_15_min: true, second_uterotonic_within_15_min: true },
  kpiLocked: false,
  nearMiss: null,
  mm: null,
  massive: null,
  consultantSignoff: null,
  status: "open",
  cancelled: null,
  access: { write: true, sign: true },
};
vi.mock("../../hooks/useFetch.js", () => ({
  useFetch: () => ({
    data: {
      charts: [chart],
      access: { start: true, write: true, sign: true },
      staff: [{ id: "u1", name: "Sample nurse", roles: ["nurse"] }],
    },
    error: null,
    reload: () => {},
  }),
}));
const { PphChartSection, bodyFrom, formFrom, minutesSince } =
  await import("./PphChart.jsx");
const { PphPrintSheet } = await import("./PphPrint.jsx");
const { AlgorithmContent } = await import("./PphBanner.jsx");
const text = (el) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("the PPH chart (OBG-F-07)", () => {
  it("shows the F-07 sections, the schema doses, within 15 min, late entry, the warning and the cryo prompt", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PphChartSection
          patient={{ id: "p1", careType: "postnatal" }}
          admissionId="a1"
        />
      </MemoryRouter>,
    );
    const out = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const part of [
      "Header",
      "E-MOTIVE bundle",
      "Escalation",
      "Labs",
      "Outcome",
      "Observations",
    ])
      expect(out).toContain(part);
    expect(out).toContain("Oxytocin – 10 IU IM");
    expect(out).toContain(
      "Oxytocin infusion – 20–40 IU in 500 ml at 125–250 ml/h",
    );
    expect(out).toContain("Misoprostol – 800 micrograms");
    expect(out).toContain("Tranexamic acid – 1 g");
    expect(out).toContain("Within 15 min");
    expect(out).toContain("Late entry");
    expect(out).toContain(
      "Pre-eclampsia recorded – ergometrine is contraindicated. Warning only",
    );
    expect(out).toContain("Fibrinogen under 2 g/L – cryoprecipitate 2 pools.");
    expect(out).toContain("PPH 500–999 ml");
    expect(out).toContain("1.23 · 0.9 or more – red");
    expect(out).toContain(
      "The scan of the paper chart is needed before sign-off",
    );
    expect(out).toContain("checked by Sample nurse2");
    expect(out).not.toContain("Declare PPH"); // one open episode at a time
    expect(out).not.toMatch(/!/);
    expect((html.match(/btn-primary/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("form values go back as the request body; declared_at only when changed", () => {
    const f = formFrom(chart);
    const body = bodyFrom(f, chart);
    expect(body.header.declared_at).toBeUndefined();
    expect(body.bundle.T_txa_1g_at).toBe("2026-11-10T02:20:00.000Z");
    expect(body.header.consultant).toBe("u2");
    const moved = bodyFrom(
      {
        ...f,
        header: { ...f.header, declared_at: "2026-11-10T07:00" },
        declared_at_reason: "Paper says so",
      },
      chart,
    );
    expect(moved.declared_at_reason).toBe("Paper says so");
    expect(
      minutesSince(
        "2026-11-10T02:10:00.000Z",
        new Date("2026-11-10T02:33:30.000Z").getTime(),
      ),
    ).toBe(23);
  });

  it("the ALG-01 card is read-only with the schema doses", () => {
    const html = renderToStaticMarkup(<AlgorithmContent />);
    const out = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(out).toContain("Oxytocin – 10 IU IM");
    expect(out).toContain("at least 15 minutes between doses, at most 8 doses");
    expect(html).not.toMatch(/<input|<select|<textarea/);
  });
});

describe("acceptance test 6 – the print matches the OBG-F-07 master", () => {
  const sheet = () =>
    renderToStaticMarkup(
      <PphPrintSheet
        chart={chart}
        patient={{ fullName: "Pph Mother", mrn: "MRN-1" }}
        letterhead={{ name: "Sample Hospital" }}
      />,
    );

  it('A4 portrait, the form box and the footer "OBG-F-07 · v1.0"', () => {
    const html = sheet();
    expect(html).toContain("OBG-F-07 · v1.0");
    expect(html).toMatch(
      /mp-formbox.*OBG-F-07.*PPH management and blood-loss chart.*Version 1\.0/,
    );
    expect(html).toMatch(/<tfoot>.*OBG-F-07 · v1\.0.*<\/tfoot>/); // repeats on every page
    const css = readFileSync(
      new URL("../../styles/print.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/@page \{ size: A4; margin: 12mm; \}/); // A4, portrait by default
    // Landscape is only for a page that asks for it (the MEOWS chart, OBG-F-05): never the default, never this sheet
    expect(css).not.toMatch(/@page \{[^}]*landscape/);
    expect(html).not.toMatch(/landscape/);
  });

  it("in the order of the paper page: header, E-MOTIVE in three columns, observations, then labs and outcome", () => {
    const html = sheet();
    const order = [
      'aria-label="Header"',
      'aria-label="E-MOTIVE bundle"',
      "<h2>Observations</h2>",
      "<h2>Labs</h2>",
      "<h2>Outcome</h2>",
    ].map((x) => html.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect((html.match(/class="pph-p-col"/g) ?? []).length).toBe(3);
    for (const letter of [
      "M – Massage",
      "O – Oxytocics",
      "T – Tranexamic acid",
      "I – IV access and investigations",
      "V – Vaginal examination",
      "E – Escalation",
    ])
      expect(html).toContain(letter);
    const out = text(
      <PphPrintSheet
        chart={chart}
        patient={{ fullName: "Pph Mother", mrn: "MRN-1" }}
        letterhead={{ name: "Sample Hospital" }}
      />,
    );
    expect(out).toContain("PRBC SAMPLE-0001");
    expect(out).toContain("Oxytocin 10 IU IM");
    expect(out).toContain("Late entry");
    expect(out).not.toMatch(/!/);
  });
});
