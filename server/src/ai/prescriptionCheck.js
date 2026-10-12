// The AI check of a prescription before it is printed or shared (Smart features, owner's request 2026-10-01): the
// saved prescription with the visit and the record, read by the fast model (gpt-5.4-mini by default) for mistakes a
// careful colleague would point out. It only asks: the doctor corrects or prints as it is. Never the patient's name,
// phone, address or number (ai/context.js).

import { patientContext, scrub } from './context.js';
import { askAI, strictObject } from './openai.js';

/** Which saved version of the visit is checked: a reprint without changes is not checked again. */
export const checkKey = (visit) => `${visit.prescription?.rev ?? 0}.${visit.details?.rev ?? 0}.${visit.vitals?.rev ?? 0}`;

const SCHEMA = strictObject({
  issues: {
    type: 'array',
    items: strictObject({
      severity: { type: 'string', enum: ['important', 'check'] },
      about: { type: 'string' },
      problem: { type: 'string' },
      suggestion: { type: 'string' },
    }),
  },
});

const rxLine = (it, i) =>
  `${i + 1}. ${[it.form, it.drug, it.strength].filter(Boolean).join(' ')} – dose ${it.dose || '?'}, ${it.frequencyText || it.frequency || '?'}${it.timing ? `, ${it.timing.replace(/_/g, ' ')}` : ''}${it.route ? `, ${it.route}` : ''}, for ${it.durationValue ? `${it.durationValue} ${it.durationUnit}` : it.durationUnit ? it.durationUnit.replace(/_/g, ' ') : 'no duration given'}${it.instructions ? ` (${it.instructions})` : ''}`;

/** Returns [{ severity, about, problem, suggestion }] – at most 6, most important first. */
export async function checkPrescription(req, patient, visit, ids) {
  const record = await patientContext(req, patient, { visits: 3 });
  const d = visit.details ?? {};
  const s = (t) => scrub(t, patient);
  const today = [
    `## This visit (${visit.visitOn.toISOString().slice(0, 10)}) – the prescription to check`,
    d.complaints && `Complaints: ${s(d.complaints)}`,
    d.diagnosis && `Diagnosis: ${s(d.diagnosis)}`,
    d.investigations && `Tests advised: ${s(d.investigations)}`,
    d.advice && `Advice: ${s(d.advice)}`,
    'Medicines:',
    ...(visit.prescription?.items ?? []).map(rxLine),
    visit.prescription?.notes && `General instructions: ${s(visit.prescription.notes)}`,
  ]
    .filter(Boolean)
    .join('\n');
  const answer = await askAI(req, {
    feature: 'prescription_check',
    ids,
    fast: true,
    maxTokens: 3000,
    instructions: [
      'You are a careful senior obstetrician and clinical pharmacist in India checking a colleague\'s prescription before it is printed for the patient. Indian brand names are normal.',
      'Point out only real problems a careful colleague would raise: a dose, strength, frequency or duration that looks wrong or unsafe; a missing dose or duration; the same medicine or ingredient twice;',
      'a medicine unsuitable at this stage of pregnancy (weeks) or while breastfeeding, or with her allergies or conditions; an important interaction;',
      'a clear mismatch between the findings or diagnosis and the treatment (e.g. Hb 8.5 recorded and no iron; raised BP and nothing for it); advice or tests that contradict the diagnosis.',
      'Do not comment on style, brand choice, or things that are a matter of preference; do not repeat the record back. If nothing needs attention, return no issues.',
      'severity "important" only for something that could harm the patient; otherwise "check". "about": the medicine or part concerned. Plain, short sentences. At most 6 issues.',
      'Never mention the sex of the fetus or baby.',
    ].join(' '),
    content: `${record}\n\n${today}`,
    schema: SCHEMA,
  });
  const order = { important: 0, check: 1 };
  return (answer.issues ?? []).slice(0, 6).sort((a, b) => order[a.severity] - order[b.severity]);
}
