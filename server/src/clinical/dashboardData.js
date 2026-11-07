import { category1Late, decisionToDeliveryMinutes } from './caesarean.js';
import { robsonGroup } from './robson.js';
import { INDICATORS, count, rate } from './dashboards.js';
import { Admission } from '../models/Admission.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { ClinicalScore } from '../models/ClinicalScore.js';
import { DischargeChecklist } from '../models/DischargeChecklist.js';
import { Incident } from '../models/Incident.js';
import { MeowsEntry } from '../models/MeowsEntry.js';
import { meowsKpis } from './meowsKpi.js';
import { NewbornFollowUp } from '../models/NewbornFollowUp.js';
import { NicuAdmission } from '../models/NewbornCare.js';
import { Patient } from '../models/Patient.js';
import { Specimen } from '../models/Specimen.js';
import { TheatreCase } from '../models/TheatreCase.js';

// Works out the month's dashboard rows from the hospital's records (Clinical Requirements Group B, item 17). Every query
// names the hospital (tenantId); nothing is stored. Rows of a department not asked for are not worked out.

const DAY = 24 * 60 * 60 * 1000;
const inRange = (d, start, end) => {
  const t = new Date(d ?? NaN);
  return t >= start && t < end;
};

export async function departmentRows(tenantId, department, { start, end }, now = new Date()) {
  const v = {};
  if (department === 'obstetrics' || department === 'newborn') {
    const notes = (await ClinicalDocument.find({ tenantId, kind: 'delivery', status: 'signed' }, { content: 1 }).lean()).filter((d) => inRange(d.content?.deliveredAt, start, end)).map((d) => d.content);
    const babies = notes.flatMap((c) => c.babies ?? []);
    const live = babies.filter((b) => b.outcome === 'live');
    if (department === 'obstetrics') {
      const cs = notes.filter((c) => c.mode === 'lscs');
      const g1 = notes.filter((c) => robsonGroup(c) === 1);
      const cat1 = cs.filter((c) => String(c.csCategory) === '1' && decisionToDeliveryMinutes(c) != null);
      v.deliveries = count(notes.length);
      v.csRate = rate(cs.length, notes.length);
      v.csRobson1 = rate(g1.filter((c) => c.mode === 'lscs').length, g1.length);
      v.cat1In30 = rate(cat1.filter((c) => !category1Late(c)).length, cat1.length);
      v.pphRate = rate(notes.filter((c) => c.pph === 'yes').length, notes.length);
      v.majorPph = count(notes.filter((c) => Number(c.bloodLossMl) > 1000).length);
      v.stillbirths = rate(babies.filter((b) => b.outcome === 'stillbirth').length, babies.filter((b) => b.outcome).length, 'per1000');
      const meows = await MeowsEntry.find({ tenantId, at: { $gte: start, $lt: end }, cancelled: null }, { level: 1 }).lean();
      v.meowsTriggers = count(meows.filter((m) => m.level === 'trigger').length);
      Object.assign(v, await meowsKpis(tenantId, { start, end }, now));
      const scores = await ClinicalScore.find({ tenantId, on: { $gte: start, $lt: end }, cancelled: null }, { kind: 1, total: 1 }).lean();
      v.epdsScreened = count(scores.filter((s) => s.kind === 'epds').length);
      v.epdsLikely = count(scores.filter((s) => s.kind === 'epds' && s.total >= 13).length);
      v.vteAssessed = count(scores.filter((s) => s.kind === 'vte').length);
      const stays = await Admission.find({ tenantId, status: 'discharged', dischargedAt: { $gte: start, $lt: end } }, { patientId: 1 }).lean();
      const mothers = new Set((await Patient.find({ tenantId, _id: { $in: stays.map((s) => s.patientId) }, careType: { $in: ['antenatal', 'postnatal', 'abortion'] } }, { _id: 1 }).lean()).map((p) => String(p._id)));
      const motherStays = stays.filter((s) => mothers.has(String(s.patientId)));
      const done = await DischargeChecklist.countDocuments({ tenantId, admissionId: { $in: motherStays.map((s) => s._id) }, live: true, status: 'complete' });
      v.teachBack = rate(done, motherStays.length);
    } else {
      const weighed = live.filter((b) => b.weightGrams != null && b.weightGrams !== '');
      const bfRecorded = live.filter((b) => b.breastfedWithinHour === 'yes' || b.breastfedWithinHour === 'no');
      const apgar = live.filter((b) => b.apgar5 != null && b.apgar5 !== '');
      const nicuRecorded = live.filter((b) => b.nicu === 'yes' || b.nicu === 'no');
      v.liveBirths = count(live.length);
      v.lbw = rate(weighed.filter((b) => Number(b.weightGrams) < 2500).length, weighed.length);
      v.bf1h = rate(bfRecorded.filter((b) => b.breastfedWithinHour === 'yes').length, bfRecorded.length);
      v.apgarLow = rate(apgar.filter((b) => Number(b.apgar5) < 7).length, apgar.length);
      v.nicu = rate(nicuRecorded.filter((b) => b.nicu === 'yes').length, nicuRecorded.length);
      const born = await Patient.find({ tenantId, careType: 'newborn', 'newborn.birthAt': { $gte: start, $lt: end } }, { _id: 1 }).lean();
      const logs = await NewbornFollowUp.find({ tenantId, patientId: { $in: born.map((b) => b._id) } }, { records: 1 }).lean();
      const doneScreen = (key) => logs.filter((l) => l.records?.some((r) => r.kind === 'screen' && r.key === key && r.status === 'done')).length;
      v.cchdDone = rate(doneScreen('cchd'), born.length);
      const nicuList = await NicuAdmission.find({ tenantId, admittedAt: { $gte: start, $lt: end }, cancelled: null }, { outcome: 1 }).lean();
      v.nicuAdmissions = count(nicuList.length);
      v.nicuDeaths = count(nicuList.filter((n) => n.outcome?.result === 'died').length);
      v.hearingDone = rate(doneScreen('hearing'), born.length);
    }
  }
  if (department === 'theatre') {
    // listDate is the hospital's day as midnight UTC: it lies between the month's start and end in India time
    const inMonth = await TheatreCase.find({ tenantId, listDate: { $gte: start, $lt: end } }).lean();
    const done = inMonth.filter((c) => c.status === 'done');
    const wentAhead = inMonth.filter((c) => c.status === 'done' || c.status === 'in_theatre');
    const withAnaesthesia = done.filter((c) => c.anaesthesia);
    v.operations = count(done.length);
    v.whoComplete = rate(done.filter((c) => ['signIn', 'timeOut', 'signOut'].every((p) => c.checklist?.[p]?.confirmed)).length, done.length);
    v.emergencyOps = rate(wentAhead.filter((c) => c.urgency === 'emergency').length, wentAhead.length);
    v.countsWrong = count(inMonth.filter((c) => c.checklist?.signOut?.confirmed && c.checklist.signOut.answers?.counts === 'no').length);
    v.cancelledOps = count(inMonth.filter((c) => c.status === 'cancelled').length);
    v.gaRate = rate(withAnaesthesia.filter((c) => c.anaesthesia === 'general').length, withAnaesthesia.length);
  }
  if (department === 'safety') {
    const incidents = await Incident.find({ tenantId, occurredAt: { $gte: start, $lt: end } }, { severity: 1, review: 1, status: 1 }).lean();
    v.incidents = count(incidents.length);
    v.incidentsHarm = count(incidents.filter((i) => ['moderate', 'severe', 'death'].includes(i.review?.severity ?? i.severity)).length);
    v.incidentsClosed = rate(incidents.filter((i) => i.status === 'closed').length, incidents.length);
    v.specimensOverdue = count(await Specimen.countDocuments({ tenantId, status: 'sent', sentAt: { $lt: new Date(now.getTime() - 21 * DAY) } }));
  }
  return INDICATORS.filter((i) => i.department === department).map((i) => ({ key: i.key, ...(v[i.key] ?? count(null)) }));
}
