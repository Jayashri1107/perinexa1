// Billing → Reports (owner, 27 Oct 2026): the hospital's "OPD IPD MIS reports" – the same list as its old billing
// software, each for a range of days. Every report is a table: { title, columns, rows, totals }, where a column is
// { key, label, money? } (money: paise, totalled). Only billing and front-desk facts: who, when, how much – never a
// diagnosis, a test result or why a record was closed.
import { hospitalDayStart, hospitalToday, isoDay, timeIn, toHospitalDate, addDays, daysBetween } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { Bill } from '../models/Bill.js';
import { FollowUp } from '../models/FollowUp.js';
import { Patient, currentAge } from '../models/Patient.js';
import { Visit } from '../models/Visit.js';
import { PURPOSE_LABELS } from '../appointments/visitPurpose.js';
import { GROUP_LABELS, GROUPS, MODE_LABELS, PAYMENT_MODES } from './billingRules.js';
import { billViews, userNames } from './billingService.js';
import { liveLines, totals } from './money.js';

const KIND = { opd: 'OPD', ipd: 'IPD' };
const PAY_KIND = { payment: 'Payment', deposit: 'Advance', refund: 'Refund' };
const ADMISSION_TYPE = { planned: 'Planned', emergency: 'Emergency', day_care: 'Day care' };
const BILL_STATUS = { open: 'Open', cancelled: 'Cancelled' };
const day = (t) => (t ? isoDay(toHospitalDate(t)) : '');
const col = (key, label, money = false) => ({ key, label, ...(money ? { money: true } : {}) });

/** The reports, by group, as the menu shows them. */
export const MIS_REPORTS = [
  {
    group: 'OPD MIS',
    reports: [
      ['opd-daily-collection', 'OPD daily collection'],
      ['opd-billing-summary', 'OPD billing summary'],
      ['doctorwise-visits', 'Doctorwise visit details'],
      ['reference-doctor', 'Reference doctor'],
      ['opd-refund', 'OPD refund'],
      ['datewise-bills', 'Datewise bills'],
      ['opd-credit-bills', 'OPD credit bills'],
      ['followup-datewise', 'OPD follow-up datewise'],
      ['registration', 'Registration'],
      ['appointment-list', 'Appointment list'],
    ],
  },
  {
    group: 'IPD MIS',
    reports: [
      ['admission-list', 'Admission list'],
      ['admission-ref-doctor', 'Admission list ref. doctorwise'],
      ['discharge-typewise', 'Discharge typewise'],
      ['advance-report', 'Advance report'],
      ['ipd-daily-collection', 'IPD daily collection'],
      ['ipd-admitted-now', 'IPD admission list (in hospital now)'],
      ['discharge-register', 'Discharge register'],
    ],
  },
  {
    group: 'Collection MIS',
    reports: [
      ['daily-collection', 'Daily collection'],
      ['group-wise', 'Group wise summary'],
      ['service-wise', 'Service wise report'],
      ['credit-report', 'Credit report'],
    ],
  },
];
export const MIS_KEYS = MIS_REPORTS.flatMap((g) => g.reports.map(([k]) => k));
const TITLE = Object.fromEntries(MIS_REPORTS.flatMap((g) => g.reports));

/** Every payment, advance or refund in the range: [{ bill, p }] by time; kind: 'opd' | 'ipd' | null (both). */
async function moneyIn(tenantId, from, to, kind) {
  const bills = await Bill.find({ tenantId, 'payments.at': { $gte: from, $lt: to }, ...(kind ? { kind } : {}) }).lean();
  const out = [];
  for (const b of bills) for (const p of b.payments ?? []) if (p.at >= from && p.at < to) out.push({ bill: b, p });
  return { bills, list: out.sort((a, b) => a.p.at - b.p.at) };
}

/** The patients of these ids (in this hospital): name, number, phone, age, referred by. */
async function patientsOf(tenantId, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const list = await Patient.find({ tenantId, _id: { $in: unique } }, { fullName: 1, mrn: 1, phone: 1, ageYears: 1, ageRecordedOn: 1, createdAt: 1, careType: 1, referredBy: 1, assignedDoctor: 1 }).lean();
  return new Map(list.map((p) => [String(p._id), p]));
}

const paymentRows = async (req, list) => {
  const views = new Map((await billViews(req.tenantId, [...new Map(list.map(({ bill }) => [String(bill._id), bill])).values()], { full: false })).map((v) => [v.id, v]));
  return list.map(({ bill, p }, i) => {
    const v = views.get(String(bill._id));
    const amount = p.kind === 'refund' ? -p.amountPaise : p.amountPaise;
    return { sr: i + 1, date: day(p.at), time: timeIn(p.at), receipt: p.receipt, bill: bill.number, kind: KIND[bill.kind], mrn: v?.patient?.mrn ?? '', patient: v?.patient?.fullName ?? '', doctor: v?.doctorName ?? '', what: PAY_KIND[p.kind], mode: MODE_LABELS[p.mode], amount, by: p.byName ?? '' };
  });
};
const PAYMENT_COLUMNS = [col('sr', 'Sr.'), col('date', 'Date'), col('time', 'Time'), col('receipt', 'Receipt'), col('bill', 'Bill'), col('mrn', 'Reg. no.'), col('patient', 'Patient'), col('doctor', 'Consultant'), col('what', 'Kind'), col('mode', 'Mode'), col('amount', 'Amount', true), col('by', 'By')];

/** Bills as rows: bill, date, OPD/IPD, patient, total, paid, balance, status. */
async function billRows(req, bills) {
  const views = await billViews(req.tenantId, bills, { full: false });
  const today = hospitalToday(req.now);
  return views.map((v, i) => ({
    sr: i + 1,
    bill: v.number,
    date: v.date,
    kind: KIND[v.kind],
    mrn: v.patient?.mrn ?? '',
    patient: v.patient?.fullName ?? '',
    doctor: v.doctorName,
    total: v.total,
    discount: v.discount,
    paid: v.paid,
    balance: v.balance,
    status: v.cancelled ? 'Cancelled' : v.balance > 0 ? 'Due' : v.balance < 0 ? 'To give back' : 'Settled',
    days: daysBetween(new Date(`${v.date}T00:00:00Z`), today),
  }));
}

/** One report for the days from–to (both included). */
export async function misReport(req, key, fromDay, toDay) {
  const tenantId = req.tenantId;
  const [from, to] = [hospitalDayStart(fromDay), hospitalDayStart(addDays(toDay, 1))];
  const inRange = { $gte: from, $lt: to };
  const dayRange = { $gte: fromDay, $lte: toDay }; // fields kept as a day (midnight UTC)
  let columns;
  let rows;
  switch (key) {
    case 'opd-daily-collection':
    case 'ipd-daily-collection':
    case 'daily-collection': {
      if (key === 'daily-collection') {
        // One line a day: the money by mode, the refunds and the net
        const { list } = await moneyIn(tenantId, from, to, null);
        const byDay = new Map();
        for (const { p } of list) {
          const d = day(p.at);
          const r = byDay.get(d) ?? { date: d, receipts: 0, ...Object.fromEntries(PAYMENT_MODES.map((m) => [m, 0])), refunds: 0, net: 0 };
          r.receipts += 1;
          if (p.kind === 'refund') r.refunds -= p.amountPaise;
          else r[p.mode] += p.amountPaise;
          r.net += p.kind === 'refund' ? -p.amountPaise : p.amountPaise;
          byDay.set(d, r);
        }
        columns = [col('date', 'Date'), col('receipts', 'Receipts'), ...PAYMENT_MODES.map((m) => col(m, MODE_LABELS[m], true)), col('refunds', 'Refunds', true), col('net', 'Net', true)];
        rows = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
        break;
      }
      const { list } = await moneyIn(tenantId, from, to, key === 'opd-daily-collection' ? 'opd' : 'ipd');
      columns = PAYMENT_COLUMNS;
      rows = await paymentRows(req, list);
      break;
    }
    case 'opd-refund':
    case 'advance-report': {
      const kind = key === 'opd-refund' ? 'refund' : 'deposit';
      const { list } = await moneyIn(tenantId, from, to, key === 'opd-refund' ? 'opd' : null);
      columns = PAYMENT_COLUMNS;
      rows = (await paymentRows(req, list.filter(({ p }) => p.kind === kind))).map((r, i) => ({ ...r, sr: i + 1 }));
      break;
    }
    case 'opd-billing-summary': {
      // One line a day: OPD bills made, charged, discount, net, collected and still due
      const bills = await Bill.find({ tenantId, kind: 'opd', status: { $ne: 'cancelled' }, on: dayRange }).lean();
      const byDay = new Map();
      for (const b of bills) {
        const t = totals(b);
        const d = isoDay(b.on);
        const r = byDay.get(d) ?? { date: d, bills: 0, charged: 0, discount: 0, net: 0, paid: 0, due: 0 };
        r.bills += 1;
        r.charged += t.subtotal;
        r.discount += t.discount;
        r.net += t.total;
        r.paid += t.paid;
        r.due += Math.max(0, t.balance);
        byDay.set(d, r);
      }
      columns = [col('date', 'Date'), col('bills', 'Bills'), col('charged', 'Charged', true), col('discount', 'Discount', true), col('net', 'Net', true), col('paid', 'Paid', true), col('due', 'Due', true)];
      rows = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
      break;
    }
    case 'doctorwise-visits': {
      // Per doctor: visits started (counts only – never what was found) and the consultations charged
      const visits = await Visit.find({ tenantId, status: 'active', visitOn: dayRange }, { createdBy: 1, createdByName: 1 }).lean();
      const bills = await Bill.find({ tenantId, status: { $ne: 'cancelled' }, 'lines.added.at': inRange }, { lines: 1 }).lean();
      const byDoctor = new Map();
      const of = (id, name) => byDoctor.get(String(id)) ?? { id: String(id), doctor: name ?? '', visits: 0, newConsults: 0, followUps: 0, amount: 0 };
      for (const v of visits) {
        const r = of(v.createdBy, v.createdByName);
        r.visits += 1;
        byDoctor.set(r.id, r);
      }
      for (const b of bills) {
        for (const l of liveLines(b)) {
          if (l.group !== 'consultation' || !l.doctorId || !(l.added?.at >= from && l.added?.at < to)) continue;
          const r = of(l.doctorId);
          if (l.key === 'consult_follow') r.followUps += l.qty ?? 1;
          else r.newConsults += l.qty ?? 1;
          r.amount += l.amountPaise;
          byDoctor.set(r.id, r);
        }
      }
      const names = await userNames([...byDoctor.keys()]);
      columns = [col('doctor', 'Doctor'), col('visits', 'Visits'), col('newConsults', 'New consultations'), col('followUps', 'Follow-up consultations'), col('amount', 'Consultation amount', true)];
      rows = [...byDoctor.values()].map((r) => ({ ...r, doctor: names.get(r.id) ?? r.doctor ?? 'Doctor' })).sort((a, b) => b.amount - a.amount || b.visits - a.visits);
      break;
    }
    case 'reference-doctor':
    case 'admission-ref-doctor': {
      // Per referring doctor (as written on the record): patients registered – or admitted – in the range
      let ids;
      if (key === 'reference-doctor') ids = (await Patient.find({ tenantId, createdAt: inRange }, { _id: 1 }).lean()).map((p) => p._id);
      else ids = (await Admission.find({ tenantId, admittedAt: inRange }, { patientId: 1 }).lean()).map((a) => a.patientId);
      const patients = await patientsOf(tenantId, ids);
      const byRef = new Map();
      for (const id of ids) {
        const p = patients.get(String(id));
        if (!p) continue;
        const ref = p.referredBy?.trim() || 'Not noted';
        const r = byRef.get(ref) ?? { referredBy: ref, count: 0, patients: [] };
        r.count += 1;
        r.patients.push(p.mrn);
        byRef.set(ref, r);
      }
      columns = [col('referredBy', 'Referred by'), col('count', key === 'reference-doctor' ? 'Patients registered' : 'Admissions'), col('mrns', 'Reg. nos.')];
      rows = [...byRef.values()].sort((a, b) => b.count - a.count).map((r) => ({ referredBy: r.referredBy, count: r.count, mrns: r.patients.join(', ') }));
      break;
    }
    case 'datewise-bills': {
      const bills = await Bill.find({ tenantId, on: dayRange }).sort({ on: 1, number: 1 }).lean();
      columns = [col('sr', 'Sr.'), col('date', 'Date'), col('bill', 'Bill'), col('kind', 'OPD / IPD'), col('mrn', 'Reg. no.'), col('patient', 'Patient'), col('doctor', 'Consultant'), col('total', 'Net', true), col('paid', 'Paid', true), col('balance', 'Balance', true), col('status', 'Status')];
      rows = await billRows(req, bills);
      break;
    }
    case 'opd-credit-bills':
    case 'credit-report': {
      // Bills with money still to come: OPD bills of the range, or every open bill (the credit report)
      const filter = key === 'opd-credit-bills' ? { tenantId, kind: 'opd', status: 'open', on: dayRange } : { tenantId, status: 'open' };
      const bills = (await Bill.find(filter).sort({ on: 1 }).limit(5000).lean()).filter((b) => totals(b).balance > 0);
      columns = [col('sr', 'Sr.'), col('date', 'Bill date'), col('bill', 'Bill'), col('kind', 'OPD / IPD'), col('mrn', 'Reg. no.'), col('patient', 'Patient'), col('total', 'Net', true), col('paid', 'Paid', true), col('balance', 'Due', true), col('days', 'Days')];
      rows = await billRows(req, bills);
      break;
    }
    case 'followup-datewise': {
      const list = await FollowUp.find({ tenantId, from: dayRange, status: { $ne: 'cancelled' } }).sort({ from: 1 }).lean();
      const patients = await patientsOf(tenantId, list.map((f) => f.patientId));
      const doctors = await userNames(list.map((f) => f.doctorId));
      columns = [col('sr', 'Sr.'), col('date', 'From'), col('mrn', 'Reg. no.'), col('patient', 'Patient'), col('phone', 'Phone'), col('doctor', 'Doctor'), col('purpose', 'For'), col('status', 'Status')];
      rows = list.map((f, i) => {
        const p = patients.get(String(f.patientId));
        return { sr: i + 1, date: isoDay(f.from), mrn: p?.mrn ?? '', patient: p?.fullName ?? '', phone: p?.phone ?? '', doctor: doctors.get(String(f.doctorId)) ?? '', purpose: PURPOSE_LABELS[f.purpose] ?? '', status: f.status === 'came' ? 'Came' : f.booked ? 'Booked' : 'Not booked' };
      });
      break;
    }
    case 'registration': {
      const list = await Patient.find({ tenantId, createdAt: inRange }, { fullName: 1, mrn: 1, phone: 1, ageYears: 1, ageRecordedOn: 1, createdAt: 1, careType: 1, referredBy: 1, assignedDoctor: 1, city: 1 }).sort({ createdAt: 1 }).lean();
      const doctors = await userNames(list.map((p) => p.assignedDoctor));
      columns = [col('sr', 'Sr.'), col('date', 'Date'), col('time', 'Time'), col('mrn', 'Reg. no.'), col('patient', 'Patient'), col('age', 'Age'), col('phone', 'Phone'), col('city', 'City'), col('doctor', 'Doctor'), col('referredBy', 'Referred by')];
      rows = list.map((p, i) => ({ sr: i + 1, date: day(p.createdAt), time: timeIn(p.createdAt), mrn: p.mrn, patient: p.fullName, age: p.careType === 'newborn' ? '' : (currentAge(p, req.now) ?? ''), phone: p.phone ?? '', city: p.city ?? '', doctor: doctors.get(String(p.assignedDoctor)) ?? '', referredBy: p.referredBy ?? '' }));
      break;
    }
    case 'appointment-list': {
      const list = await Appointment.find({ tenantId, on: dayRange }).sort({ on: 1, start: 1, token: 1 }).lean();
      const patients = await patientsOf(tenantId, list.map((a) => a.patientId));
      const doctors = await userNames(list.map((a) => a.doctorId));
      columns = [col('sr', 'Sr.'), col('date', 'Date'), col('time', 'Time / token'), col('mrn', 'Reg. no.'), col('patient', 'Patient'), col('phone', 'Phone'), col('doctor', 'Doctor'), col('type', 'Type'), col('status', 'Status')];
      rows = list.map((a, i) => {
        const p = a.patientId ? patients.get(String(a.patientId)) : null;
        return {
          sr: i + 1,
          date: isoDay(a.on),
          time: a.kind === 'token' ? `Token ${a.token}` : (a.start ?? 'Needs a time'),
          mrn: p?.mrn ?? '',
          patient: p?.fullName ?? a.guest?.name ?? '',
          phone: p?.phone ?? a.guest?.phone ?? '',
          doctor: doctors.get(String(a.doctorId)) ?? '',
          type: a.kind === 'token' ? 'Walk-in' : a.visitType === 'new' ? 'New' : 'Follow-up',
          status: a.status === 'cancelled' ? 'Cancelled' : 'Booked',
        };
      });
      break;
    }
    case 'admission-list':
    case 'ipd-admitted-now':
    case 'discharge-register': {
      const filter = key === 'admission-list' ? { tenantId, admittedAt: inRange } : key === 'ipd-admitted-now' ? { tenantId, status: 'admitted' } : { tenantId, status: 'discharged', dischargedAt: inRange };
      const list = await Admission.find(filter).sort({ [key === 'discharge-register' ? 'dischargedAt' : 'admittedAt']: 1 }).limit(5000).lean();
      const patients = await patientsOf(tenantId, list.map((a) => a.patientId));
      const doctors = await userNames(list.map((a) => a.admittedBy));
      const now = req.now ?? new Date();
      columns = [col('sr', 'Sr.'), col('ipdNo', 'IPD no.'), col('admitted', 'Admitted'), col('mrn', 'Reg. no.'), col('patient', 'Patient'), col('age', 'Age'), col('doctor', 'Admitted by'), col('type', 'Type'), col('ward', 'Ward / bed'), col('discharged', 'Discharged'), col('days', 'Days')];
      rows = list.map((a, i) => {
        const p = patients.get(String(a.patientId));
        return {
          sr: i + 1,
          ipdNo: a.ipdNo ?? '',
          admitted: `${day(a.admittedAt)} ${timeIn(a.admittedAt)}`,
          mrn: p?.mrn ?? '',
          patient: p?.fullName ?? '',
          age: p && p.careType !== 'newborn' ? (currentAge(p, now) ?? '') : '',
          doctor: doctors.get(String(a.admittedBy)) ?? a.admittedByName ?? '',
          type: ADMISSION_TYPE[a.admissionType] ?? '',
          ward: [a.ward, a.bed].filter(Boolean).join(' · '),
          discharged: a.dischargedAt ? `${day(a.dischargedAt)} ${timeIn(a.dischargedAt)}` : 'In hospital',
          days: Math.max(1, daysBetween(toHospitalDate(a.admittedAt), toHospitalDate(a.dischargedAt ?? now))),
        };
      });
      break;
    }
    case 'discharge-typewise': {
      // By how she was admitted (planned, emergency, day care) – the hospital records no other kind of discharge here
      const list = await Admission.find({ tenantId, status: 'discharged', dischargedAt: inRange }, { admissionType: 1, mlc: 1 }).lean();
      const byType = new Map();
      for (const a of list) {
        const type = ADMISSION_TYPE[a.admissionType] ?? 'Not noted';
        const r = byType.get(type) ?? { type, count: 0, mlc: 0 };
        r.count += 1;
        if (a.mlc) r.mlc += 1;
        byType.set(type, r);
      }
      columns = [col('type', 'Admission type'), col('count', 'Discharges'), col('mlc', 'Medico-legal')];
      rows = [...byType.values()].sort((a, b) => b.count - a.count);
      break;
    }
    case 'group-wise':
    case 'service-wise': {
      const bills = await Bill.find({ tenantId, status: { $ne: 'cancelled' }, 'lines.added.at': inRange }, { lines: 1 }).lean();
      const by = new Map();
      for (const b of bills) {
        for (const l of liveLines(b)) {
          if (!(l.added?.at >= from && l.added?.at < to)) continue;
          const k = key === 'group-wise' ? l.group : `${l.group}|${l.name}`;
          const r = by.get(k) ?? { group: GROUP_LABELS[l.group] ?? 'Other', service: l.name, count: 0, amount: 0, order: GROUPS.indexOf(l.group) };
          r.count += l.qty ?? 1;
          r.amount += l.amountPaise;
          by.set(k, r);
        }
      }
      columns = key === 'group-wise' ? [col('group', 'Group'), col('count', 'Services'), col('amount', 'Amount', true)] : [col('group', 'Group'), col('service', 'Service'), col('count', 'Count'), col('amount', 'Amount', true)];
      rows = [...by.values()].sort((a, b) => a.order - b.order || b.amount - a.amount);
      break;
    }
    default:
      return null;
  }
  const totalsRow = Object.fromEntries(columns.filter((c) => c.money).map((c) => [c.key, rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)]));
  return { key, title: TITLE[key], from: isoDay(fromDay), to: isoDay(toDay), columns, rows, totals: totalsRow };
}
