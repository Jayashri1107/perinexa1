// The words of an automatic reminder (Version 2). Deliberately minimal: a phone is often shared, so the message
// never says the patient's name, why she comes, or anything about a pregnancy – only the hospital, the date and
// the phone number to call. Fixed wording with blanks only, as Indian SMS rules (DLT) and WhatsApp templates
// need. DRAFT: the Marathi and Hindi wording must be checked by fluent speakers before use.
// Since 4 Oct 2026 also two general messages: "a check-up or test is due" (a care-plan item is overdue) and "we
// missed you" (a booked appointment nobody came to). They never name what is due.

export const REMINDER_LANGUAGES = ['en', 'mr', 'hi'];
export const CHANNELS = ['sms', 'whatsapp'];

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  mr: ['जाने', 'फेब्रु', 'मार्च', 'एप्रि', 'मे', 'जून', 'जुलै', 'ऑग', 'सप्टें', 'ऑक्टो', 'नोव्हें', 'डिसें'],
  hi: ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुला', 'अग', 'सितं', 'अक्टू', 'नवं', 'दिसं'],
};
const dateWords = (day, lang) => `${day.getUTCDate()} ${MONTHS[lang][day.getUTCMonth()]} ${day.getUTCFullYear()}`;

/** "17:30" → "5:30 PM" (the same in every language: how times are written on Indian SMS). */
export function timeWords(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The appointment reminder: hospital, day, phone, and how to stop. With a booked time (appointment booking) also
 * the time and the doctor's name – never why she comes.
 */
export function appointmentMessage({ hospital, phone, day, time = null, doctor = null, lang = 'en' }) {
  const d = dateWords(day, lang);
  const call = phone ? phone : '';
  const at = time ? timeWords(time) : '';
  if (lang === 'mr') return `${hospital}: आपली भेट ${d} रोजी${at ? ` ${at} वाजता${doctor ? ` ${doctor} यांच्याकडे` : ''}` : ''} आहे.${call ? ` बदलासाठी ${call} वर फोन करा.` : ''} संदेश थांबवण्यासाठी STOP पाठवा.`;
  if (lang === 'hi') return `${hospital}: आपकी मुलाक़ात ${d} को${at ? ` ${at} बजे${doctor ? ` ${doctor} के साथ` : ''}` : ''} है।${call ? ` बदलने के लिए ${call} पर फ़ोन करें।` : ''} संदेश रोकने के लिए STOP भेजें।`;
  return `${hospital}: your appointment is on ${d}${at ? ` at ${at}${doctor ? ` with ${doctor}` : ''}` : ''}.${call ? ` To change it, call ${call}.` : ''} Reply STOP to stop these messages.`;
}

/**
 * "Something is due" (4 Oct 2026): a care-plan item is overdue and nothing is booked. ONE general wording for
 * everyone – a mother's overdue test and a baby's overdue vaccination read the same – so the message never names
 * the item and never says why, and it never says WHOSE check-up it is ("your …"): a baby's message goes to a parent's
 * phone, who would read "your check-up" as her own. Blanks: the hospital and its phone number only.
 * DRAFT: the Marathi and Hindi wording must be checked by fluent speakers before use.
 */
export function careDueMessage({ hospital, phone, lang = 'en' }) {
  const call = phone ? phone : '';
  if (lang === 'mr') return `${hospital}: तपासणीची किंवा चाचणीची वेळ झाली आहे.${call ? ` वेळ घेण्यासाठी ${call} वर फोन करा.` : ' वेळ घेण्यासाठी रुग्णालयाशी संपर्क करा.'} संदेश थांबवण्यासाठी STOP पाठवा.`;
  if (lang === 'hi') return `${hospital}: जाँच या टेस्ट का समय हो गया है।${call ? ` समय लेने के लिए ${call} पर फ़ोन करें।` : ' समय लेने के लिए अस्पताल से संपर्क करें।'} संदेश रोकने के लिए STOP भेजें।`;
  return `A check-up or test is due at ${hospital}.${call ? ` Please call ${call} to book.` : ' Please contact the hospital to book.'} Reply STOP to stop these messages.`;
}

/**
 * "We missed you" (4 Oct 2026): a booked appointment passed and nobody came. The hospital, the day of the
 * appointment and the phone number – never the doctor, the visit type or why she was coming.
 * DRAFT: the Marathi and Hindi wording must be checked by fluent speakers before use.
 */
export function missedMessage({ hospital, phone, day, lang = 'en' }) {
  const d = dateWords(day, lang);
  const call = phone ? phone : '';
  if (lang === 'mr') return `${hospital}: ${d} रोजीच्या भेटीला आपण येऊ शकला नाहीत.${call ? ` पुन्हा वेळ घेण्यासाठी ${call} वर फोन करा.` : ' पुन्हा वेळ घेण्यासाठी रुग्णालयाशी संपर्क करा.'} संदेश थांबवण्यासाठी STOP पाठवा.`;
  if (lang === 'hi') return `${hospital}: ${d} की मुलाक़ात में आप नहीं आ पाए।${call ? ` फिर से समय लेने के लिए ${call} पर फ़ोन करें।` : ' फिर से समय लेने के लिए अस्पताल से संपर्क करें।'} संदेश रोकने के लिए STOP भेजें।`;
  return `${hospital}: we missed you at your appointment on ${d}.${call ? ` To book again, call ${call}.` : ' Please contact the hospital to book again.'} Reply STOP to stop these messages.`;
}

// The kinds of message sent when an appointment changes (appointment booking).
export const CHANGE_KINDS = ['booked', 'moved', 'cancelled'];

/** A booking, a move or a cancellation: hospital, day, time, doctor and phone – never why she comes. */
export function appointmentChangeMessage({ kind, hospital, phone, day, time, doctor, lang = 'en' }) {
  const d = dateWords(day, lang);
  const at = timeWords(time);
  const call = phone ? phone : '';
  if (lang === 'mr') {
    const stop = ' संदेश थांबवण्यासाठी STOP पाठवा.';
    if (kind === 'cancelled') return `${hospital}: ${d} रोजी ${at} वाजताची आपली भेट रद्द झाली आहे.${call ? ` पुन्हा वेळ घेण्यासाठी ${call} वर फोन करा.` : ''}${stop}`;
    const lead = kind === 'moved' ? 'आपली भेट आता' : 'आपली भेट';
    return `${hospital}: ${lead} ${d} रोजी ${at} वाजता ${doctor} यांच्याकडे ठरली आहे.${call ? ` बदलासाठी ${call} वर फोन करा.` : ''}${stop}`;
  }
  if (lang === 'hi') {
    const stop = ' संदेश रोकने के लिए STOP भेजें।';
    if (kind === 'cancelled') return `${hospital}: ${d} को ${at} बजे की आपकी मुलाक़ात रद्द हो गई है।${call ? ` फिर से समय लेने के लिए ${call} पर फ़ोन करें।` : ''}${stop}`;
    const lead = kind === 'moved' ? 'आपकी मुलाक़ात अब' : 'आपकी मुलाक़ात';
    return `${hospital}: ${lead} ${d} को ${at} बजे ${doctor} के साथ तय है।${call ? ` बदलने के लिए ${call} पर फ़ोन करें।` : ''}${stop}`;
  }
  const stop = ' Reply STOP to stop these messages.';
  if (kind === 'cancelled') return `${hospital}: your appointment on ${d} at ${at} is cancelled.${call ? ` To book again, call ${call}.` : ''}${stop}`;
  const lead = kind === 'moved' ? 'your appointment has moved to' : 'your appointment is booked for';
  return `${hospital}: ${lead} ${d} at ${at} with ${doctor}.${call ? ` To change it, call ${call}.` : ''}${stop}`;
}

/**
 * The queue time (owner, 17 Oct 2026 – docs/WHATSAPP_DESK_PLAN.md), sent on WhatsApp when she gets a walk-in token or
 * arrives for her booking: her token (or booked time), how many are before her and about when she goes in – never
 * her name or why she came. eta: "11:40" (hospital time); ahead: patients waiting before her.
 * DRAFT: the Marathi and Hindi wording must be checked by fluent speakers before use.
 */
export function queueMessage({ hospital, doctor, token = null, start = null, ahead, eta, lang = 'en' }) {
  const at = timeWords(eta);
  if (lang === 'mr') {
    const who = token ? `आपला टोकन क्रमांक ${token} आहे` : `आपली ${timeWords(start)} ची भेट नोंदली आहे`;
    return `${hospital}: ${who} (${doctor}). आपल्या आधी ${ahead} रुग्ण आहेत. साधारण ${at} वाजता आपला क्रमांक येईल. वेळ थोडी बदलू शकते.`;
  }
  if (lang === 'hi') {
    const who = token ? `आपका टोकन नंबर ${token} है` : `आपकी ${timeWords(start)} की मुलाक़ात दर्ज है`;
    return `${hospital}: ${who} (${doctor})। आपसे पहले ${ahead} मरीज़ हैं। लगभग ${at} बजे आपकी बारी आएगी। समय थोड़ा बदल सकता है।`;
  }
  const who = token ? `your token is ${token}` : `you are checked in for ${timeWords(start)}`;
  return `${hospital}: ${who} with ${doctor}. ${ahead === 0 ? 'You are next.' : `${ahead} ${ahead === 1 ? 'patient is' : 'patients are'} before you.`} Expected time about ${at} – it may change a little.`;
}
