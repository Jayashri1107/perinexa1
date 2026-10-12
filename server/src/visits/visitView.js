// What the website receives about visits (pure, no database). Never staff ids; the doctor's private note only
// for those who may see doctors' notes (not nurses).

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k] ?? null]));
const text = (v) => v ?? '';
const who = (part) => ({ rev: part?.rev ?? 0, byName: part?.byName ?? null, at: part?.at ?? null });

const VITALS = ['weightKg', 'bpSystolic', 'bpDiastolic', 'pulse', 'temperatureF', 'spo2', 'hb'];
const VITALS_TEXT = ['urineAlbumin', 'urineSugar'];
const DETAILS = ['fundalHeightCm', 'fetalHeartRate', 'nextVisitOn'];
const DETAILS_TEXT = ['complaints', 'presentation', 'fetalMovements', 'oedema', 'examination', 'diagnosis', 'investigations', 'advice', 'nextVisitNote'];
const RX_TEXT = ['drug', 'form', 'strength', 'dose', 'frequency', 'frequencyText', 'timing', 'route', 'durationUnit', 'instructions'];
const texts = (obj, keys) => Object.fromEntries(keys.map((k) => [k, text(obj?.[k])]));

export const rxItemView = (it) => ({ id: String(it._id), ...texts(it, RX_TEXT), durationValue: it.durationValue ?? null });

// Who signed the visit and when (never their id).
const signedView = (visit) => (visit.signed ? { byName: visit.signed.byName, role: visit.signed.role, at: visit.signed.at } : null);

/** The whole visit, for its page. notes: whether the private note may be shown. */
export function visitView(visit, { notes }) {
  const v = visit.vitals ?? {};
  const d = visit.details ?? {};
  const p = visit.prescription ?? {};
  return {
    id: String(visit._id),
    visitOn: visit.visitOn,
    careType: visit.careType,
    status: visit.status,
    cancelled: visit.cancelled ? { reason: visit.cancelled.reason, byName: visit.cancelled.byName, at: visit.cancelled.at } : null,
    signed: signedView(visit),
    additions: (visit.additions ?? []).map((x) => ({ id: String(x._id), text: x.text, byName: x.byName, at: x.at })),
    vitals: { ...pick(v, VITALS), ...texts(v, VITALS_TEXT), ...who(v) },
    details: { ...pick(d, DETAILS), ...texts(d, DETAILS_TEXT), ...(notes ? { privateNote: text(d.privateNote) } : {}), ...who(d) },
    prescription: {
      items: (p.items ?? []).map(rxItemView),
      notes: text(p.notes),
      warningReasons: (p.warningReasons ?? []).map((w) => ({ key: w.key, level: w.level, title: w.title, medicines: [...(w.medicines ?? [])], reason: w.reason })),
      ...who(p),
    },
    createdByName: visit.createdByName,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
  };
}

/** One row of the patient's visit list. */
export function visitSummary(visit, { notes }) {
  const v = visit.vitals ?? {};
  const d = visit.details ?? {};
  const items = visit.prescription?.items ?? [];
  return {
    id: String(visit._id),
    visitOn: visit.visitOn,
    status: visit.status,
    cancelledReason: visit.cancelled?.reason ?? null,
    signed: signedView(visit),
    bp: v.bpSystolic != null && v.bpDiastolic != null ? `${v.bpSystolic}/${v.bpDiastolic}` : null,
    weightKg: v.weightKg ?? null,
    diagnosis: text(d.diagnosis),
    medicines: items.slice(0, 6).map((it) => it.drug),
    medicineCount: items.length,
    prescribedByName: items.length ? (visit.prescription.byName ?? null) : null,
    nextVisitOn: d.nextVisitOn ?? null,
    ...(notes ? { hasPrivateNote: Boolean(d.privateNote) } : {}),
    createdByName: visit.createdByName,
    createdAt: visit.createdAt,
  };
}
