import { kpiFields, nearMissCriteria } from "./pph.js";
import { rate } from "./dashboards.js";
import { ClinicalDocument } from "../models/ClinicalDocument.js";
import { PphChart } from "../models/PphChart.js";

// The four OBG-A-05 rows the PPH chart feeds (Build 15 – docs/field_schemas/build15_pph.json, kpi_feeds), for the
// monthly dashboards (dashboardData.js). Every query names the hospital (tenantId). Deliveries: the delivery notes
// confirmed by a doctor and delivered in the month; PPH episodes: declared in the month, not entered in error. An
// episode's KPI fields are the ones kept at sign-off (A5), or worked out live while it is open.

const VAGINAL = ["normal", "vacuum", "forceps"];
const inRange = (d, start, end) => {
  const t = new Date(d ?? NaN);
  return t >= start && t < end;
};

export async function pphRows(tenantId, { start, end }) {
  const notes = (
    await ClinicalDocument.find(
      { tenantId, kind: "delivery", status: "signed" },
      { admissionId: 1, content: 1 },
    ).lean()
  ).filter((d) => inRange(d.content?.deliveredAt, start, end));
  const episodes = await PphChart.find({
    tenantId,
    cancelled: null,
    "header.declared_at": { $gte: start, $lt: end },
  }).lean();
  const kpi = episodes.map((e) => ({ e, k: e.kpi ?? kpiFields(e) }));
  // Births with measured blood loss recorded: a blood loss on the note, and no PPH episode of that stay estimated
  const estimated = new Set(
    (
      await PphChart.find(
        {
          tenantId,
          cancelled: null,
          admissionId: { $in: notes.map((n) => n.admissionId) },
          "header.loss_method": "estimated",
        },
        { admissionId: 1 },
      ).lean()
    ).map((e) => String(e.admissionId)),
  );
  const measured = notes.filter(
    (n) =>
      n.content?.bloodLossMl != null &&
      n.content.bloodLossMl !== "" &&
      !estimated.has(String(n.admissionId)),
  );
  const vaginal = notes.filter((n) => VAGINAL.includes(n.content?.mode));
  const lscs = notes.filter((n) => n.content?.mode === "lscs");
  const total = (k) => k.total_loss_ml ?? 0;
  return {
    pphMeasuredLoss: rate(measured.length, notes.length),
    pphVaginal: rate(
      kpi.filter(
        ({ e, k }) =>
          ["vaginal", "instrumental"].includes(e.header?.delivery_mode) &&
          total(k) >= 500,
      ).length,
      vaginal.length,
    ),
    pphLscs: rate(
      kpi.filter(
        ({ e, k }) => e.header?.delivery_mode === "lscs" && total(k) >= 1000,
      ).length,
      lscs.length,
    ),
    pphBundle15: rate(
      kpi.filter(
        ({ k }) => k.txa_within_15_min && k.second_uterotonic_within_15_min,
      ).length,
      episodes.length,
    ),
    pphSevere: rate(
      episodes.filter(
        (e) =>
          (e.nearMiss?.criteria?.length ?? 0) > 0 ||
          nearMissCriteria(e).length > 0,
      ).length,
      notes.length,
      "per1000",
    ),
  };
}
