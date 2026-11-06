// The theatre list and the WHO Surgical Safety Checklist (Clinical Requirements Group B, item 16 – PX-OT-01, PX-OT-02).
// The checklist is the WHO's published one (WHO Surgical Safety Checklist, 2009, and its Implementation Manual); it is
// marked DRAFT until it is compared with the manual page OBG-F-16 by the theatre lead, and needs the owner's approval
// before it goes to main. The second person who checks the counts comes with the base rules (PX-X-06, Group C): until
// then one person records them.
// Each item: kind 'check' (done: yes – or not applicable where na), 'question' (a fact: yes or no; a yes needs the
// note named in ifYes), or 'count' (correct: yes; a no needs a note – and is an incident to report).
// The website keeps the same lists (client/src/pages/theatre/whoRules.js); a server test checks both copies.

export const WHO_SOURCE = 'WHO Surgical Safety Checklist (2009) and Implementation Manual';

export const PHASES = {
  signIn: {
    label: 'Sign in – before induction of anaesthesia',
    items: [
      { key: 'identity', kind: 'check', label: 'The patient has confirmed her identity, the site, the procedure and consent' },
      { key: 'siteMarked', kind: 'check', na: true, label: 'Site marked' },
      { key: 'anaesthesiaCheck', kind: 'check', label: 'Anaesthesia machine and medicines check complete' },
      { key: 'oximeter', kind: 'check', label: 'Pulse oximeter on the patient and working' },
      { key: 'allergy', kind: 'question', label: 'Does she have a known allergy?', ifYes: 'Which allergy' },
      { key: 'airway', kind: 'question', label: 'Difficult airway or risk of aspiration?', ifYes: 'Equipment and help available – what' },
      { key: 'bloodLoss', kind: 'question', label: 'Risk of more than 500 mL blood loss?', ifYes: 'Two IV lines and fluids planned – what' },
    ],
  },
  timeOut: {
    label: 'Time out – before the skin incision',
    items: [
      { key: 'team', kind: 'check', label: 'Every team member has said their name and role' },
      { key: 'confirm', kind: 'check', label: 'Surgeon, anaesthetist and nurse confirm the patient, the site and the procedure' },
      { key: 'antibiotic', kind: 'check', na: true, label: 'Antibiotic prophylaxis given within the last 60 minutes' },
      { key: 'surgeonReview', kind: 'check', label: 'Surgeon: critical or unexpected steps, how long, expected blood loss' },
      { key: 'anaesthetistReview', kind: 'check', label: 'Anaesthetist: concerns about this patient' },
      { key: 'nursingReview', kind: 'check', label: 'Nursing: sterility confirmed (indicator results), equipment issues' },
      { key: 'imaging', kind: 'check', na: true, label: 'Essential imaging displayed' },
    ],
  },
  signOut: {
    label: 'Sign out – before the patient leaves theatre',
    items: [
      { key: 'procedureRecorded', kind: 'check', label: 'The name of the procedure is recorded' },
      { key: 'counts', kind: 'count', label: 'Instrument, swab and needle counts correct' },
      { key: 'specimen', kind: 'check', na: true, label: 'Specimen labelled with her name (and logged in Specimens)' },
      { key: 'equipment', kind: 'question', label: 'Any equipment problems to be addressed?', ifYes: 'What problem' },
      { key: 'recovery', kind: 'check', label: 'Surgeon, anaesthetist and nurse reviewed the key concerns for recovery' },
    ],
  },
};
export const PHASE_ORDER = ['signIn', 'timeOut', 'signOut'];
export const URGENCY = { elective: 'Elective', emergency: 'Emergency' };
export const ANAESTHESIA = { spinal: 'Spinal', epidural: 'Epidural', general: 'General', local: 'Local', other: 'Other' };
export const CASE_STATUS = { planned: 'Planned', in_theatre: 'In theatre', done: 'Done', cancelled: 'Cancelled' };

/** What is still needed before a phase can be confirmed: { 'answers.<key>' | 'notes.<key>': message }. PURE. */
export function missingInPhase(phase, answers = {}, notes = {}) {
  const out = {};
  for (const item of PHASES[phase].items) {
    const a = answers[item.key] ?? '';
    const note = (notes[item.key] ?? '').trim();
    if (!a) {
      out[`answers.${item.key}`] = 'Answer this';
      continue;
    }
    if (item.kind === 'check' && a === 'no') out[`answers.${item.key}`] = 'This must be done before you go on';
    if (item.kind === 'check' && a === 'na' && !item.na) out[`answers.${item.key}`] = 'Answer yes';
    if (item.kind !== 'check' && a === 'na') out[`answers.${item.key}`] = 'Answer yes or no';
    if (item.kind === 'question' && a === 'yes' && !note) out[`notes.${item.key}`] = item.ifYes;
    if (item.kind === 'count' && a === 'no' && !note) out[`notes.${item.key}`] = 'Counts not correct: write what was done (and report an incident)';
  }
  return out;
}
