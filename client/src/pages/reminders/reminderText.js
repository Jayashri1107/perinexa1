// Follow-up reminder messages (Smart features, step 3): the text staff copy into WhatsApp or an SMS, in
// English, Marathi or Hindi. Pure. Test names stay as written on the patient's copy of the care plan.
// The Marathi and Hindi wording must be checked by fluent speakers before real use (like docs/PRESCRIPTIONS.md).

import { timeLabel } from '../appointments/appointmentFormat.js';
import { patientWhat } from '../patients/carePlanPrintFormat.js';

export const REMINDER_LANGUAGES = { en: 'English', mr: 'मराठी', hi: 'हिंदी' };
const LOCALES = { en: 'en-IN', mr: 'mr-IN', hi: 'hi-IN' };

/** "12 October 2026" in the language (dates are date-only, stored as midnight UTC). */
export const reminderDate = (d, lang) => new Date(d).toLocaleDateString(LOCALES[lang] ?? 'en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const WORDS = {
  en: {
    hello: (name) => `Namaste ${name},`,
    from: (h) => `This is a reminder from ${h}.`,
    appointment: (d) => `Your next appointment: ${d}.`,
    visitWindow: (a, b) => `Your next check-up is due between ${a} and ${b}. Please come in that time.`,
    visitNow: 'Your check-up is due now. Please come as soon as you can.',
    items: 'Please also get these done:',
    overdue: '(overdue – as soon as possible)',
    by: (d) => `(by ${d})`,
    bring: 'Please bring your ANC card, reports and medicines.',
    danger: 'Come to the hospital at once if you have bleeding, leaking of water, a severe headache, blurred vision, fits, severe pain in the abdomen, fever, or if the baby moves less than usual.',
    call: (p) => `For any question, call ${p}.`,
  },
  mr: {
    hello: (name) => `नमस्कार ${name},`,
    from: (h) => `${h} कडून आठवण.`,
    appointment: (d) => `तुमची पुढील तपासणी: ${d}.`,
    visitWindow: (a, b) => `तुमची पुढील तपासणी ${a} ते ${b} या काळात आहे. कृपया त्या वेळेत या.`,
    visitNow: 'तुमची तपासणी आता करायची आहे. कृपया लवकरात लवकर या.',
    items: 'कृपया हे सुद्धा करून घ्या:',
    overdue: '(उशीर झाला आहे – लवकरात लवकर)',
    by: (d) => `(${d} पर्यंत)`,
    bring: 'येताना तुमचे गरोदरपणाचे कार्ड (ANC कार्ड), रिपोर्ट आणि औषधे घेऊन या.',
    danger: 'रक्तस्राव, पाणी जाणे, तीव्र डोकेदुखी, धूसर दिसणे, झटके, पोटात तीव्र दुखणे, ताप, किंवा बाळाची हालचाल नेहमीपेक्षा कमी जाणवल्यास लगेच रुग्णालयात या.',
    call: (p) => `काही प्रश्न असल्यास ${p} वर फोन करा.`,
  },
  hi: {
    hello: (name) => `नमस्ते ${name},`,
    from: (h) => `${h} की ओर से याद दिलाना।`,
    appointment: (d) => `आपकी अगली जाँच: ${d}।`,
    visitWindow: (a, b) => `आपकी अगली जाँच ${a} से ${b} के बीच है। कृपया उसी समय आएँ।`,
    visitNow: 'आपकी जाँच अभी होनी है। कृपया जल्द से जल्द आएँ।',
    items: 'कृपया ये भी करवा लें:',
    overdue: '(देर हो गई है – जल्द से जल्द)',
    by: (d) => `(${d} तक)`,
    bring: 'आते समय अपना गर्भावस्था कार्ड (ANC कार्ड), रिपोर्ट और दवाइयाँ साथ लाएँ।',
    danger: 'खून आना, पानी जाना, तेज़ सिरदर्द, धुंधला दिखना, दौरे, पेट में तेज़ दर्द, बुखार, या बच्चे की हलचल सामान्य से कम लगे तो तुरंत अस्पताल आएँ।',
    call: (p) => `कोई भी सवाल हो तो ${p} पर फ़ोन करें।`,
  },
};

const firstName = (full) => (full ?? '').trim().split(/\s+/)[0] ?? '';

/**
 * The reminder text. data: the answer of GET /patients/:id/reminder; lang: 'en' | 'mr' | 'hi'.
 * Leaves out what isn't known (no appointment, no plan); the pregnancy lines only for antenatal patients.
 */
export function reminderMessage(data, lang = 'en') {
  const w = WORDS[lang] ?? WORDS.en;
  const date = (d) => reminderDate(d, lang);
  const pregnant = data.patient.careType === 'antenatal';
  const lines = [w.hello(firstName(data.patient.fullName)), data.hospital.name ? w.from(data.hospital.name) : null];

  const v = data.plan?.nextVisit;
  // With a booked time (appointment booking): "12 Oct 2026, 10:30 AM"
  if (data.appointment) lines.push(w.appointment(`${date(data.appointment)}${data.appointmentTime ? `, ${timeLabel(data.appointmentTime)}` : ''}`));
  else if (v && ['overdue', 'due'].includes(v.status)) lines.push(w.visitNow);
  else if (v?.dueFrom && v?.dueBy) lines.push(w.visitWindow(date(v.dueFrom), date(v.dueBy)));

  const items = [...(data.plan?.overdue ?? []).map((it) => ({ ...it, late: true })), ...(data.plan?.due ?? [])];
  if (items.length) {
    lines.push('', w.items);
    for (const it of items) lines.push(`• ${patientWhat(it, data.patient.careType)} ${it.late ? w.overdue : it.dueBy ? w.by(date(it.dueBy)) : ''}`.trimEnd());
  }
  if (pregnant) lines.push('', w.bring, w.danger);
  if (data.hospital.phone) lines.push('', w.call(data.hospital.phone));
  return lines
    .filter((l) => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
