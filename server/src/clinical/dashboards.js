// Monthly dashboards (Clinical Requirements Group B, item 17 – PX-X-09, PX-OBG-32, PX-NEO-18, PX-ANA-08). Each row is
// added only when Perinexa already records its fields (the specification's rule); a row is worked out from the records
// of the month, never typed. DRAFT definitions from standard sources until the manual pages OBG-A-05, NEO-A-05 and
// ANA-A-06 are given and the department leads confirm them; targets are each hospital's own, set by its leads.
// Sources: WHO Robson Implementation Manual (2017); NICE NG192 (2021); WHO/UNICEF Every Newborn indicators (2015);
// MoHFW India – LaQshya (2017) labour room and maternity OT quality indicators; WHO Surgical Safety Checklist (2009).

export const DASHBOARD_SOURCE =
  'WHO Robson Implementation Manual (2017); NICE NG192 (2021); WHO/UNICEF Every Newborn indicators (2015); MoHFW LaQshya quality indicators (2017); WHO Surgical Safety Checklist (2009)';

export const DEPARTMENTS = { obstetrics: 'Obstetrics', newborn: 'Newborn', theatre: 'Theatre and anaesthesia', safety: 'Safety' };

// unit: count | percent | per1000. better: 'higher' or 'lower' (for a target). adminHidden: kept from a hospital admin
// (a small count can point to a family – as in Analytics).
export const INDICATORS = [
  { key: 'deliveries', department: 'obstetrics', unit: 'count', label: 'Deliveries', definition: 'Delivery notes confirmed by a doctor this month.' },
  { key: 'csRate', department: 'obstetrics', unit: 'percent', better: 'lower', label: 'Caesarean rate', definition: 'Caesareans ÷ deliveries.' },
  { key: 'csRobson1', department: 'obstetrics', unit: 'percent', better: 'lower', label: 'Caesarean rate in Robson group 1', definition: 'Caesareans ÷ women in Robson group 1 (WHO 2017).' },
  { key: 'cat1In30', department: 'obstetrics', unit: 'percent', better: 'higher', label: 'Category 1 caesareans delivered within 30 minutes', definition: 'Category 1 caesareans with decision-to-delivery 30 minutes or less ÷ category 1 caesareans with both times recorded (NICE NG192).' },
  { key: 'pphRate', department: 'obstetrics', unit: 'percent', better: 'lower', label: 'Postpartum haemorrhage', definition: 'Deliveries where the doctor answered PPH yes ÷ deliveries.' },
  { key: 'majorPph', department: 'obstetrics', unit: 'count', better: 'lower', label: 'Measured blood loss over 1000 mL', definition: 'Delivery notes with a measured blood loss over 1000 mL.' },
  // OBG-A-05 rows fed by the PPH chart (Build 15, OBG-F-07 – clinical/pphKpi.js); targets as in the schema, set by the hospital
  { key: 'pphMeasuredLoss', department: 'obstetrics', unit: 'percent', better: 'higher', label: 'Births with measured blood loss recorded', definition: 'Deliveries with a blood loss on the delivery note and no PPH episode of that stay with the loss estimated ÷ deliveries (OBG-A-05; target 100%).' },
  { key: 'pphVaginal', department: 'obstetrics', unit: 'percent', better: 'lower', label: 'PPH 500 ml or more after a vaginal birth', definition: 'PPH episodes after a vaginal or instrumental birth with a total loss of 500 ml or more ÷ vaginal births (OBG-A-05; track, 10% or less).' },
  { key: 'pphLscs', department: 'obstetrics', unit: 'percent', better: 'lower', label: 'PPH 1000 ml or more after a caesarean', definition: 'PPH episodes after a caesarean with a total loss of 1000 ml or more ÷ caesareans (OBG-A-05; track, 6% or less).' },
  { key: 'pphBundle15', department: 'obstetrics', unit: 'percent', better: 'higher', label: 'PPH with TXA and a second uterotonic within 15 minutes', definition: 'PPH episodes with tranexamic acid and a second uterotonic (carboprost, ergometrine or misoprostol) each within 15 minutes of the declaration ÷ PPH episodes (OBG-A-05; target 90% or more).' },
  { key: 'pphSevere', department: 'obstetrics', unit: 'per1000', better: 'lower', label: 'Severe PPH, transfusion of 4 units or more, or peripartum hysterectomy', definition: 'PPH episodes meeting the near-miss criteria (A1: 1500 ml or more, 4 units or more, hysterectomy, ICU, transfer or death) ÷ deliveries, per 1000 (OBG-A-05; track, each reviewed within 7 days).' },
  { key: 'meowsTriggers', department: 'obstetrics', unit: 'count', label: 'MEOWS triggers', definition: 'MEOWS observation sets that were a trigger (one red or two amber; before OBG-F-05, one red or two yellow).' },
  // OBG-A-05 rows fed by the MEOWS chart (OBG-F-05 – clinical/meowsKpi.js); the page's target is in brackets
  { key: 'meows4hFirst24h', department: 'obstetrics', unit: 'percent', better: 'higher', label: 'MEOWS completed 4-hourly in the first 24 h postnatal', definition: 'Postnatal MEOWS charts with no overdue observation in the first 24 h after birth ÷ postnatal MEOWS charts whose first 24 h began this month (OBG-A-05 target 95% or more).' },
  { key: 'meowsSepsisAbx1h', department: 'obstetrics', unit: 'percent', better: 'higher', label: 'Suspected sepsis: antibiotics within 1 h of trigger', definition: 'MEOWS triggers with the sepsis pathway chosen and the first antibiotic within 60 minutes ÷ triggers with the sepsis pathway (OBG-A-05 target 90% or more).' },
  { key: 'meowsSevereHtn30', department: 'obstetrics', unit: 'percent', better: 'higher', label: 'Severe hypertension treated within 30 min', definition: 'Hypertensive emergencies on the MEOWS chart (systolic 160 or more, or diastolic 110 or more) with an antihypertensive within 30 minutes ÷ hypertensive emergencies (OBG-A-05 target 95% or more).' },
  { key: 'teachBack', department: 'obstetrics', unit: 'percent', better: 'higher', label: 'Discharged with danger-sign teach-back', definition: 'Mothers discharged this month whose discharge checklist was completed (teach-back done) ÷ mothers discharged.' },
  { key: 'epdsScreened', department: 'obstetrics', unit: 'count', label: 'EPDS done', definition: 'EPDS recorded this month (not entered in error).' },
  { key: 'epdsLikely', department: 'obstetrics', unit: 'count', label: 'EPDS 13 or more', definition: 'EPDS with a total of 13 or more.', adminHidden: true },
  { key: 'vteAssessed', department: 'obstetrics', unit: 'count', label: 'VTE risk assessments', definition: 'VTE risk scores recorded this month.' },
  { key: 'stillbirths', department: 'obstetrics', unit: 'per1000', better: 'lower', label: 'Stillbirth rate', definition: 'Stillbirths ÷ all babies born, per 1000.', adminHidden: true },
  { key: 'liveBirths', department: 'newborn', unit: 'count', label: 'Live births', definition: 'Babies born alive on the delivery notes confirmed this month.' },
  { key: 'lbw', department: 'newborn', unit: 'percent', better: 'lower', label: 'Low birth weight (under 2500 g)', definition: 'Live births under 2500 g ÷ live births with a weight.' },
  { key: 'bf1h', department: 'newborn', unit: 'percent', better: 'higher', label: 'Breastfed within one hour', definition: 'Live births breastfed within the hour ÷ live births where it was recorded (not "not applicable").' },
  { key: 'apgarLow', department: 'newborn', unit: 'percent', better: 'lower', label: 'Apgar under 7 at 5 minutes', definition: 'Live births with Apgar under 7 at 5 minutes ÷ live births with a 5-minute Apgar.' },
  { key: 'nicu', department: 'newborn', unit: 'percent', label: 'Admitted to NICU or SNCU', definition: 'Live births admitted to the NICU or SNCU ÷ live births where it was recorded.' },
  { key: 'nicuAdmissions', department: 'newborn', unit: 'count', label: 'NICU or SNCU admissions (register)', definition: 'Admissions in the NICU / SNCU register this month (not entered in error).' },
  { key: 'nicuDeaths', department: 'newborn', unit: 'count', better: 'lower', label: 'Deaths in the NICU or SNCU', definition: 'Admissions of this month whose outcome is death.', adminHidden: true },
  { key: 'cchdDone', department: 'newborn', unit: 'percent', better: 'higher', label: 'Pulse oximetry (CCHD) screen done', definition: "Babies registered as born this month whose pulse oximetry is recorded done ÷ those babies." },
  { key: 'hearingDone', department: 'newborn', unit: 'percent', better: 'higher', label: 'Hearing screen done', definition: 'Babies registered as born this month whose hearing screen is recorded done ÷ those babies.' },
  { key: 'operations', department: 'theatre', unit: 'count', label: 'Operations done', definition: 'Operations on the theatre list this month that were done.' },
  { key: 'whoComplete', department: 'theatre', unit: 'percent', better: 'higher', label: 'WHO checklist complete', definition: 'Operations done with sign in, time out and sign out all confirmed ÷ operations done.' },
  { key: 'emergencyOps', department: 'theatre', unit: 'percent', label: 'Emergency operations', definition: 'Emergency operations ÷ operations that went ahead (in theatre or done).' },
  { key: 'countsWrong', department: 'theatre', unit: 'count', better: 'lower', label: 'Counts not correct at sign out', definition: 'Sign outs where the instrument, swab and needle counts were not correct.' },
  { key: 'cancelledOps', department: 'theatre', unit: 'count', better: 'lower', label: 'Operations taken off the list', definition: 'Operations on this month’s list taken off it.' },
  { key: 'gaRate', department: 'theatre', unit: 'percent', label: 'General anaesthesia', definition: 'Operations done under general anaesthesia ÷ operations done with the anaesthesia recorded.' },
  { key: 'incidents', department: 'safety', unit: 'count', label: 'Incidents reported', definition: 'Incidents that happened this month (reported by staff or by Perinexa).' },
  { key: 'incidentsHarm', department: 'safety', unit: 'count', better: 'lower', label: 'Incidents with moderate or worse harm', definition: 'Incidents this month with moderate harm, severe harm or death (the lead’s degree of harm where reviewed).' },
  { key: 'incidentsClosed', department: 'safety', unit: 'percent', better: 'higher', label: 'Incidents closed', definition: 'Incidents this month that are closed ÷ incidents this month.' },
  { key: 'specimensOverdue', department: 'safety', unit: 'count', better: 'lower', label: 'Histopathology reports overdue (now)', definition: 'Specimens sent more than 21 days ago with no report yet – as it is today.' },
];

/** A rate row from its numerator and denominator (null value when the denominator is 0). PURE. */
export function rate(n, d, unit = 'percent') {
  if (!d) return { value: null, numerator: n, denominator: d };
  const f = unit === 'per1000' ? 1000 : 100;
  return { value: Math.round((n / d) * f * 10) / 10, numerator: n, denominator: d };
}
export const count = (n) => ({ value: n, numerator: null, denominator: null });

/** Against the target: 'met', 'missed', or null (no target, no value, or a row with no better direction). PURE. */
export function againstTarget(indicator, value, target) {
  if (target == null || value == null || !indicator.better) return null;
  return (indicator.better === 'higher' ? value >= target : value <= target) ? 'met' : 'missed';
}
