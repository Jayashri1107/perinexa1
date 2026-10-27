// Patient lists behind a number (Analytics specification, section 3.6). Doctors only.
//
// One definition per number (rule R4): a list runs the SAME compute() as the card, with the same "visible to
// this doctor" filter (rule R8), so its count is exactly the number the doctor clicked. The cell's patients,
// their order and the detail column all come from that one computation.
//
// Names and record numbers are read here only, and only for the patients on the requested page. Each of them
// is checked again against the patient-access rules on its fresh copy (a record may have become sensitive in
// between); one that fails is left out and counted in `restricted`. A list row is built from a fixed whitelist:
// never a newborn field (other than the date of birth), notes, the risk override, medical or obstetric details, or
// any pregnancy field other than the EDD and gestation.
//
// A cell of the Deliveries tab counts deliveries and babies, not patients (facts.js unitKey): its list has one row
// per delivery or baby, each showing the patient it belongs to (the mother) – so a woman with twins, or with two
// deliveries in the period, has two rows, told apart by the detail column. Every other list has one row per patient.

import { gestationalAge, currentAge, Patient } from '../models/Patient.js';
import { User } from '../models/User.js';
import { hospitalToday, isoDay, toHospitalDate } from '../careplans/dates.js';
import { refreshDueRisks } from '../careplans/templatesService.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess, projectPatient } from '../utils/patientAccess.js';
import { buildContext, computeMetric } from './compute.js';
import { patientOfUnit } from './facts.js';
import { loadHospital, windowFromOf } from './load.js';
import { parsePeriod } from './period.js';
import { REFRESH_RISK_SECTIONS, cellByCode, cellWindow, globalCellId, metricById, needsOf, splitGlobal } from './registry.js';
import { visibleSet } from './visibility.js';

export const NOT_LISTABLE_MESSAGE = "This number can't be opened as a list.";
export const LISTS_FOR_DOCTORS_MESSAGE = 'Patient lists are only for doctors.';

const notListable = () => new HttpError(400, NOT_LISTABLE_MESSAGE, 'NOT_LISTABLE');

const time = (v) => (v == null ? null : new Date(v).getTime());
const gaDays = (d) => (d?.type === 'ga' && d.weeks != null ? d.weeks * 7 + d.days : null);

/**
 * List orders named by the cards (`list.order`). Each gives a sort value from what is already loaded: the
 * loaded patient row (`fields` lists the fields it reads, all in load.js PATIENT_FIELDS), the card's detail for
 * that patient, or the card's own order map (`due`, E4). dir 1 = ascending, -1 = descending. Patients without
 * a value come last; ties are broken by the date the record was made, then its id.
 */
export const LIST_ORDERS = {
  gaDesc: { dir: -1, fields: [], value: ({ detail }) => gaDays(detail) }, // gestation today, furthest first
  gaAsc: { dir: 1, fields: [], value: ({ detail }) => gaDays(detail) }, // gestation at birth, earliest first
  // due date: antenatal records only (a pregnancy that ended may still have dates stored); the others come last
  eddAsc: { dir: 1, fields: ['pregnancy.effectiveEdd', 'careType'], value: ({ patient }) => (patient?.careType === 'antenatal' ? time(patient?.pregnancy?.effectiveEdd) : null) },
  lastVisitAsc: { dir: 1, fields: [], value: ({ detail }) => (detail?.type === 'lastVisit' ? detail.on : null) },
  lastVisitDesc: { dir: -1, fields: [], value: ({ detail }) => (detail?.type === 'lastVisit' ? detail.on : null) },
  bookedDesc: { dir: -1, fields: [], value: ({ detail }) => (detail?.type === 'booked' ? detail.on : null) },
  createdDesc: { dir: -1, fields: ['createdAt'], value: ({ patient }) => time(patient?.createdAt) },
  bornDesc: { dir: -1, fields: ['newborn.birthAt'], value: ({ patient }) => time(patient?.newborn?.birthAt) },
  bpDesc: { dir: -1, fields: [], value: ({ detail }) => (detail?.type === 'bp' ? detail.sys * 1000 + detail.dia : null) },
  hbAsc: { dir: 1, fields: [], value: ({ detail }) => (detail?.type === 'hb' ? detail.value : null) },
  gramsAsc: { dir: 1, fields: [], value: ({ detail }) => (detail?.type === 'grams' ? detail.value : null) },
  itemsDesc: { dir: -1, fields: [], value: ({ detail }) => (detail?.type === 'items' ? detail.count : null) },
  dueAsc: { dir: 1, fields: [], value: ({ due }) => due ?? null }, // E4: the due date of the item counted
  // Deliveries tab: the latest delivery first (the babies of one delivery then in their order on the note)
  deliveredDesc: { dir: -1, fields: [], value: ({ detail }) => (['delivery', 'birth'].includes(detail?.type) ? detail.on : null) },
  diedDesc: { dir: -1, fields: [], value: ({ detail }) => (detail?.type === 'death' ? detail.on : null) }, // the latest death first
  // Fertility tab: the latest cycle or plan to end first
  endedDesc: { dir: -1, fields: [], value: ({ detail }) => (['cycle', 'plan'].includes(detail?.type) ? detail.on : null) },
};
// The tie-breakers read these loaded fields too.
export const LIST_TIE_FIELDS = ['createdAt', '_id'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The ids of a cell in list order (a delivery's or a baby's entry reads its patient's fields: facts.js unitKey). */
export function sortIds(ids, { orderKey, byId, details, due }) {
  const order = LIST_ORDERS[orderKey];
  if (!order) throw new Error(`Unknown analytics list order: ${orderKey}`);
  const rows = [...ids].map((id) => {
    const patient = byId.get(patientOfUnit(id)) ?? null;
    return { id, value: order.value({ patient, detail: details?.get(id) ?? null, due: due?.get(id) ?? null }), created: time(patient?.createdAt) ?? 0 };
  });
  rows.sort((a, b) => {
    if (a.value == null || b.value == null) {
      if (a.value == null && b.value != null) return 1;
      if (b.value == null && a.value != null) return -1;
    } else {
      const c = cmp(a.value, b.value) * order.dir;
      if (c) return c;
    }
    return a.created - b.created || cmp(a.id, b.id);
  });
  return rows.map((r) => r.id);
}

// What each row key needs the doctor's access to include (null = always: who the patient is, and the access
// flags). A key whose field the doctor may not see is dropped from the row.
const ROW_KEYS = {
  id: null,
  mrn: null,
  fullName: null,
  careType: null,
  currentAge: 'currentAge',
  assignedDoctorName: 'assignedDoctorName',
  sensitive: 'sensitive',
  gestationalAge: 'pregnancy',
  edd: 'pregnancy',
  riskLevel: 'risk',
  bornOn: 'newborn',
  detail: 'pregnancy',
};
export const LIST_ROW_KEYS = [...Object.keys(ROW_KEYS), 'access'];

// The fields read for the patients on a page (full documents: the access rules read them). Of the newborn
// details only the birth time.
const LIST_FIELDS = '_id tenantId mrn fullName ageYears ageRecordedOn careType assignedDoctor sensitive pregnancy.effectiveEdd risk.level newborn.birthAt createdAt';

/** The page's patients, fresh from the database, in this hospital only. */
const fetchPatients = (tenantId, ids) => Patient.find({ tenantId, _id: { $in: ids } }).select(LIST_FIELDS);
/** Doctors' names by id (the same query the Patients list uses). */
async function fetchDoctorNames(ids) {
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }, { name: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

/** One list row: the whitelist, then only the keys this doctor may see. */
function rowJSON(row, access, { detail, doctorName, now }) {
  const edd = row.pregnancy?.effectiveEdd ?? null;
  const ga = row.careType === 'antenatal' ? gestationalAge(row, now) : null;
  const full = {
    id: String(row._id),
    mrn: row.mrn,
    fullName: row.fullName,
    careType: row.careType,
    currentAge: currentAge(row, now),
    assignedDoctorName: row.assignedDoctor ? (doctorName ?? null) : null,
    sensitive: Boolean(row.sensitive),
    gestationalAge: ga ? { weeks: ga.weeks, days: ga.days } : null,
    edd: isoDay(edd),
    riskLevel: row.risk?.level ?? null,
    bornOn: row.careType === 'newborn' && row.newborn?.birthAt ? isoDay(toHospitalDate(row.newborn.birthAt)) : null,
    detail: detail ?? null,
  };
  const out = {};
  for (const [key, needs] of Object.entries(ROW_KEYS)) if (needs === null || access.view.has(needs)) out[key] = full[key];
  out.access = projectPatient({}, access).access;
  return out;
}

/**
 * One page of a cell's patients. `ids`: the cell's Set (visible, in scope); `byId`: the loaded rows (for the
 * order); `details`, `due`: the card's detail and order maps. The fetches can be replaced in tests.
 * Returns { count, restricted, total, page, limit, totalPages, patients }: count is the cell's number, and
 * total + restricted === count. A cell of deliveries or babies has one row per entry (see the header).
 */
export async function listPage(req, { ids, byId, details, due, orderKey, now, page, limit }, { fetchRows = fetchPatients, fetchNames = fetchDoctorNames } = {}) {
  const sorted = sortIds(ids, { orderKey, byId, details, due });
  const count = sorted.length;
  const pageIds = sorted.slice((page - 1) * limit, page * limit);
  const patientIds = [...new Set(pageIds.map(patientOfUnit))]; // each patient fetched once
  const fresh = new Map((patientIds.length ? await fetchRows(req.tenantId, patientIds) : []).map((r) => [String(r._id), r]));
  const kept = [];
  let restricted = 0;
  for (const id of pageIds) {
    const row = fresh.get(patientOfUnit(id));
    const access = row ? patientAccess(req, row) : null;
    // A record that can no longer be opened (or is gone) is never listed: it is counted, nothing more.
    if (!row || !access.view.has('pregnancy')) {
      restricted += 1;
      continue;
    }
    kept.push({ id, row, access });
  }
  const names = await fetchNames([...new Set(kept.map((k) => k.row.assignedDoctor).filter(Boolean).map(String))]);
  const patients = kept.map(({ id, row, access }) =>
    rowJSON(row, access, { detail: details?.get(id) ?? null, doctorName: row.assignedDoctor ? names.get(String(row.assignedDoctor)) : null, now }),
  );
  return { count, restricted, total: count - restricted, page, limit, totalPages: Math.max(1, Math.ceil(count / limit)), patients };
}

/**
 * The patients behind one number, for a doctor. q (already validated by the route): { metric, cell, period,
 * from, to, scope, careType, page, limit }. Answers 400 NOT_LISTABLE for a card or cell that opens no list.
 */
export async function listCell(req, q) {
  const metric = metricById(q.metric);
  if (!metric?.list || !metric.audiences.includes('doctor')) throw notListable();
  // A card with a fixed set of cells is checked here, before any risk refresh or load (§3.6: validate first).
  // Cards whose cells depend on the data are checked again below, once the data is loaded.
  if (typeof metric.cells !== 'function' && !cellByCode(metric, q.cell, null)) throw notListable();
  const today = hospitalToday(req.now);
  const period = parsePeriod(q, { audience: 'doctor', today });
  const careType = metric.section === 'overview' ? q.careType : 'all';

  // Exactly what the card's page does: risk levels brought up to date first where the page does it, the same
  // rows, the same visibility and scope.
  if (REFRESH_RISK_SECTIONS.includes(metric.section)) await refreshDueRisks(req.tenantId, req.now);
  const data = await loadHospital(req.tenantId, {
    now: req.now,
    today,
    windowFrom: windowFromOf(period, today),
    periodFrom: period.from,
    periodTo: period.to,
    needs: needsOf([metric.id]).concat('patients'),
  });
  const visible = visibleSet(req, data.patients);
  const ctx = buildContext(data, { now: req.now, today, period, scope: q.scope, careType, audience: 'doctor', userId: req.user._id, visible });
  computeMetric(ctx, metric.id);

  const def = cellByCode(metric, q.cell, ctx);
  if (!def) throw notListable();
  // A cell shared with another card (DQ "no EDD" is A2's) lists that card's patients, in its order.
  const [sourceId, sourceKey] = splitGlobal(globalCellId(metric, def.key, ctx));
  const source = metricById(sourceId);
  const result = computeMetric(ctx, sourceId);
  const ids = result.cells[sourceKey];
  if (!(ids instanceof Set)) throw notListable();
  const listDef = source.list ?? metric.list;

  const pageOut = await listPage(req, {
    ids,
    byId: ctx.byId,
    details: result.details,
    due: result.order.get(sourceKey) ?? null,
    orderKey: listDef.order,
    now: req.now,
    page: q.page,
    limit: q.limit,
  });
  const cellWin = cellWindow(metric, def);
  return {
    metric: metric.id,
    cell: def.code,
    section: metric.section,
    title: metric.title,
    cellLabel: def.label,
    window: cellWin,
    periodLabel: cellWin === 'period' ? period.label : null,
    scope: q.scope,
    detailLabel: listDef.detailLabel ?? null,
    ...pageOut,
  };
}
