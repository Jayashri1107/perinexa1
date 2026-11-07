// Alerts that follow the patient (Clinical Requirements Group C – PX-X-13). DRAFT – the owner (a doctor) approves this
// list and its wording before real use. Each alert is shown on every screen of the patient (her record, her stay,
// her operation) beside the allergy and blood group, as colour + icon + words.
// Infection precautions: write the PRECAUTION (e.g. "contact precautions", "gloves for blood"), never the diagnosis –
// a test result and a diagnosis stay on the record under their neutral names.

export const ALERT_SOURCE = 'DRAFT – Perinexa list of patient alerts (PX-X-13), awaiting the owner’s approval';

export const ALERT_KINDS = {
  difficult_airway: { label: 'Difficult airway', hint: 'Known or expected difficult intubation – tell the anaesthetist.' },
  declines_blood: { label: 'Declines blood products', hint: 'She has said she does not accept blood or blood products. Record what she accepts in the note.' },
  infection_precautions: { label: 'Infection precautions', hint: 'Write the precaution to take, never the diagnosis or a test result.' },
  fall_risk: { label: 'Fall risk', hint: 'Help her when walking; bed low, rails up.' },
  needs_interpreter: { label: 'Needs an interpreter', hint: 'Write the language in the note.' },
  implant_device: { label: 'Implant or device', hint: 'For example a pacemaker or a metal implant – write which.' },
  other: { label: 'Other alert', hint: 'Write what staff must know, in a few words.' },
};
export const ALERT_KIND_KEYS = Object.keys(ALERT_KINDS);
