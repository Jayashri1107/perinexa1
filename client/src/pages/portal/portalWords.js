// The patient portal in English, Marathi or Hindi (5 Oct 2026): every fixed word and sentence of the portal, the
// language switch, and the server's refusals in her language (by their code). Dates, times and numbers keep their
// usual format. Care-plan items: the built-in wording is translated (careplans/itemTranslations.js); an item a
// doctor added or reworded is shown as typed, in English.
//
// ⚠️ DRAFT – the Marathi and Hindi wording must be checked by fluent speakers before patients use it
// (docs/TRANSLATIONS_TO_CHECK.md).

import { portalItemTranslation } from '../careplans/itemTranslations.js';

export const PORTAL_LANGUAGES = ['en', 'mr', 'hi'];
/** The switch at the top: each language in its own script. */
export const PORTAL_LANGUAGE_NAMES = { en: 'English', mr: 'मराठी', hi: 'हिंदी' };

export const PORTAL_WORDS = {
  en: {
    pageTitle: 'Your care · Perinexa',
    language: 'Language',
    draftNote: '',
    loading: 'Loading…',
    dismiss: 'Dismiss message',
    // Sign in
    signInTitle: 'Your care at the hospital',
    signInIntro: 'Sign in with the code on the paper the hospital gave you.',
    code: 'Code',
    codeHint: 'e.g. ABCD-EFGH-JKLM',
    digits: 'Last 4 digits of your mobile number',
    signingIn: 'Signing in…',
    signIn: 'Sign in',
    sharedDevice: 'On a shared phone or computer, sign out when you finish.',
    timedOut: 'You were signed out after 15 minutes without use.',
    signedOut: 'You are signed out.',
    // Her care
    signOut: 'Sign out',
    nextAppointment: 'Your next appointment',
    noAppointment: 'No appointment is booked.',
    callToBook: 'Please call the hospital to book one.',
    comingUp: 'Coming up in your care plan',
    checkUp: 'Check-up',
    nothingElse: 'Nothing else is due in the next 8 weeks.',
    doctorDecides: 'Your doctor decides what is needed; dates may change at your next visit.',
    questions: 'Questions, or need to change the date?',
    call: (hospital) => `Call ${hospital}`,
    callJoin: ' on ',
    stop: '.',
    emergency: 'In an emergency, go to the hospital straight away.',
    kinds: { investigation: 'Test', scan: 'Scan', vaccination: 'Vaccination', visit: 'Check-up' },
    item: 'Item',
    // Booking
    cancelling: 'Cancelling…',
    yesCancel: 'Yes, cancel my appointment',
    keepIt: 'Keep it',
    cancelAppointment: 'Cancel this appointment',
    callToBookOnline: 'To book an appointment, please call the hospital.',
    bookWith: (doctor) => `Book an appointment with ${doctor}`,
    day: 'Day',
    noFreeTime: 'No free time on this day. Please choose another day.',
    doctorOnLeave: (doctor, dates) => `${doctor} is on leave: ${dates}. No bookings on these days.`,
    onLeaveDay: (doctor) => `${doctor} is on leave on this day. Please choose another day.`,
    time: 'Time',
    booking: 'Booking…',
    bookAt: (when) => `Book ${when}`,
    book: 'Book',
  },
  mr: {
    pageTitle: 'तुमची काळजी · Perinexa',
    language: 'भाषा',
    draftNote: 'मराठी शब्द अजून तपासले जात आहेत. काही समजले नाही तर English निवडा किंवा रुग्णालयाला फोन करा.',
    loading: 'उघडत आहे…',
    dismiss: 'संदेश बंद करा',
    signInTitle: 'रुग्णालयातील तुमची काळजी',
    signInIntro: 'रुग्णालयाने दिलेल्या कागदावरील कोड वापरून आत या.',
    code: 'कोड',
    codeHint: 'उदा. ABCD-EFGH-JKLM',
    digits: 'तुमच्या मोबाइल नंबरचे शेवटचे 4 अंक',
    signingIn: 'आत येत आहे…',
    signIn: 'आत या',
    sharedDevice: 'इतरांसोबत वापरल्या जाणाऱ्या फोनवर किंवा संगणकावर, काम झाल्यावर बाहेर पडा.',
    timedOut: '15 मिनिटे वापर न झाल्याने तुम्ही बाहेर पडलात.',
    signedOut: 'तुम्ही बाहेर पडला आहात.',
    signOut: 'बाहेर पडा',
    nextAppointment: 'तुमची पुढील भेट',
    noAppointment: 'कोणतीही भेट ठरलेली नाही.',
    callToBook: 'भेट ठरवण्यासाठी कृपया रुग्णालयाला फोन करा.',
    comingUp: 'तुमच्या काळजीच्या योजनेत पुढे',
    checkUp: 'तपासणी',
    nothingElse: 'पुढील 8 आठवड्यांत दुसरे काही करायचे नाही.',
    doctorDecides: 'काय आवश्यक आहे ते तुमचे डॉक्टर ठरवतात; पुढील भेटीत तारखा बदलू शकतात.',
    questions: 'काही प्रश्न आहेत, किंवा तारीख बदलायची आहे?',
    call: (hospital) => `${hospital} ला फोन करा`,
    callJoin: ': ',
    stop: '.',
    emergency: 'आणीबाणीच्या वेळी लगेच रुग्णालयात जा.',
    kinds: { investigation: 'चाचणी', scan: 'सोनोग्राफी', vaccination: 'लसीकरण', visit: 'तपासणी' },
    item: 'बाब',
    cancelling: 'रद्द करत आहे…',
    yesCancel: 'हो, माझी भेट रद्द करा',
    keepIt: 'भेट ठेवा',
    cancelAppointment: 'ही भेट रद्द करा',
    callToBookOnline: 'भेट ठरवण्यासाठी कृपया रुग्णालयाला फोन करा.',
    bookWith: (doctor) => `${doctor} यांची भेट ठरवा`,
    day: 'दिवस',
    noFreeTime: 'या दिवशी वेळ उपलब्ध नाही. कृपया दुसरा दिवस निवडा.',
    doctorOnLeave: (doctor, dates) => `${doctor} रजेवर आहेत: ${dates}. या दिवसांत भेट ठरवता येणार नाही.`,
    onLeaveDay: (doctor) => `${doctor} या दिवशी रजेवर आहेत. कृपया दुसरा दिवस निवडा.`,
    time: 'वेळ',
    booking: 'भेट ठरवत आहे…',
    bookAt: (when) => `${when} ही भेट ठरवा`,
    book: 'भेट ठरवा',
  },
  hi: {
    pageTitle: 'आपकी देखभाल · Perinexa',
    language: 'भाषा',
    draftNote: 'हिंदी शब्द अभी जाँचे जा रहे हैं। कुछ समझ न आए तो English चुनें या अस्पताल को फ़ोन करें।',
    loading: 'खुल रहा है…',
    dismiss: 'संदेश बंद करें',
    signInTitle: 'अस्पताल में आपकी देखभाल',
    signInIntro: 'अस्पताल ने जो काग़ज़ दिया है, उस पर लिखे कोड से अंदर आएँ।',
    code: 'कोड',
    codeHint: 'जैसे ABCD-EFGH-JKLM',
    digits: 'आपके मोबाइल नंबर के आख़िरी 4 अंक',
    signingIn: 'अंदर आ रहे हैं…',
    signIn: 'अंदर आएँ',
    sharedDevice: 'साझा फ़ोन या कंप्यूटर पर, काम पूरा होने पर बाहर निकलें।',
    timedOut: '15 मिनट तक इस्तेमाल न होने के कारण आपको बाहर कर दिया गया।',
    signedOut: 'आप बाहर निकल चुके हैं।',
    signOut: 'बाहर निकलें',
    nextAppointment: 'आपकी अगली मुलाक़ात',
    noAppointment: 'कोई मुलाक़ात तय नहीं है।',
    callToBook: 'मुलाक़ात तय करने के लिए कृपया अस्पताल को फ़ोन करें।',
    comingUp: 'आपकी देखभाल योजना में आगे',
    checkUp: 'जाँच',
    nothingElse: 'अगले 8 हफ़्तों में और कुछ नहीं करना है।',
    doctorDecides: 'क्या ज़रूरी है, यह आपके डॉक्टर तय करते हैं; अगली मुलाक़ात पर तारीख़ें बदल सकती हैं।',
    questions: 'कोई सवाल है, या तारीख़ बदलनी है?',
    call: (hospital) => `${hospital} को फ़ोन करें`,
    callJoin: ': ',
    stop: '।',
    emergency: 'आपात स्थिति में तुरंत अस्पताल जाएँ।',
    kinds: { investigation: 'टेस्ट', scan: 'सोनोग्राफ़ी', vaccination: 'टीकाकरण', visit: 'जाँच' },
    item: 'बात',
    cancelling: 'रद्द हो रहा है…',
    yesCancel: 'हाँ, मेरी मुलाक़ात रद्द करें',
    keepIt: 'मुलाक़ात रखें',
    cancelAppointment: 'यह मुलाक़ात रद्द करें',
    callToBookOnline: 'मुलाक़ात तय करने के लिए कृपया अस्पताल को फ़ोन करें।',
    bookWith: (doctor) => `${doctor} से मुलाक़ात तय करें`,
    day: 'दिन',
    noFreeTime: 'इस दिन कोई समय ख़ाली नहीं है। कृपया कोई और दिन चुनें।',
    doctorOnLeave: (doctor, dates) => `${doctor} छुट्टी पर हैं: ${dates}। इन दिनों मुलाक़ात तय नहीं हो सकती।`,
    onLeaveDay: (doctor) => `${doctor} इस दिन छुट्टी पर हैं। कृपया कोई और दिन चुनें।`,
    time: 'समय',
    booking: 'मुलाक़ात तय हो रही है…',
    bookAt: (when) => `${when} की मुलाक़ात तय करें`,
    book: 'मुलाक़ात तय करें',
  },
};

/** The words of the portal in a language (English when the language is not known). */
export const portalWords = (lang) => PORTAL_WORDS[lang] ?? PORTAL_WORDS.en;

// The server's refusals, by code, in Marathi and Hindi. In English the server's own message is shown.
const ERRORS = {
  mr: {
    NETWORK: 'रुग्णालयाच्या सर्व्हरशी संपर्क होत नाही. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा.',
    PORTAL_LOGIN_FAILED: 'कोड किंवा 4 अंक बरोबर नाहीत. रुग्णालयाने दिलेला कागद तपासा, किंवा रुग्णालयाला फोन करा.',
    PORTAL_LOCKED: 'चुकीच्या प्रयत्नांमुळे हा कोड काही वेळासाठी बंद झाला आहे. कृपया रुग्णालयाला फोन करा.',
    RATE_LIMITED: 'खूप जास्त प्रयत्न झाले. कृपया 15 मिनिटे थांबा, किंवा रुग्णालयाला फोन करा.',
    PORTAL_SIGNED_OUT: 'कृपया पुन्हा आत या.',
    SLOT_TAKEN: 'ही वेळ आत्ताच दुसऱ्या कोणी घेतली. कृपया दुसरी वेळ निवडा.',
    BOOKING_OFF: 'ऑनलाइन भेट ठरवता येत नाही. कृपया रुग्णालयाला फोन करा.',
    ALREADY_BOOKED: 'तुमची भेट आधीच ठरलेली आहे. ती बदलण्यासाठी रुग्णालयाला फोन करा.',
    NOT_CANCELLABLE: 'ही भेट इथे रद्द करता येत नाही. कृपया रुग्णालयाला फोन करा.',
    BOOKING_DAYS: 'कृपया उद्यापासून पुढील 30 दिवसांतील एखादा दिवस निवडा.',
    OTHER: 'काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा, किंवा रुग्णालयाला फोन करा.',
  },
  hi: {
    NETWORK: 'अस्पताल के सर्वर से संपर्क नहीं हो पा रहा है। कृपया थोड़ी देर बाद फिर से कोशिश करें।',
    PORTAL_LOGIN_FAILED: 'कोड या 4 अंक सही नहीं हैं। अस्पताल का दिया काग़ज़ देखें, या अस्पताल को फ़ोन करें।',
    PORTAL_LOCKED: 'ग़लत कोशिशों के कारण यह कोड कुछ समय के लिए बंद है। कृपया अस्पताल को फ़ोन करें।',
    RATE_LIMITED: 'बहुत ज़्यादा कोशिशें हो गईं। कृपया 15 मिनट रुकें, या अस्पताल को फ़ोन करें।',
    PORTAL_SIGNED_OUT: 'कृपया फिर से अंदर आएँ।',
    SLOT_TAKEN: 'यह समय अभी-अभी किसी और ने ले लिया। कृपया कोई और समय चुनें।',
    BOOKING_OFF: 'ऑनलाइन मुलाक़ात तय नहीं हो सकती। कृपया अस्पताल को फ़ोन करें।',
    ALREADY_BOOKED: 'आपकी मुलाक़ात पहले से तय है। उसे बदलने के लिए अस्पताल को फ़ोन करें।',
    NOT_CANCELLABLE: 'यह मुलाक़ात यहाँ रद्द नहीं हो सकती। कृपया अस्पताल को फ़ोन करें।',
    BOOKING_DAYS: 'कृपया कल से अगले 30 दिनों में से कोई दिन चुनें।',
    OTHER: 'कुछ ग़लत हो गया। कृपया फिर से कोशिश करें, या अस्पताल को फ़ोन करें।',
  },
};

/**
 * A refusal or failure in her language. err: { message, code } from the portal's requests (code 'NETWORK' when the
 * server could not be reached). In English the server's own message; in Marathi or Hindi the translation of a known
 * code, else a general "something went wrong" (never an English sentence she may not read). booking: a refusal of a
 * booking request, where a VALIDATION refusal is about the day.
 */
export function portalError(err, lang, { booking = false } = {}) {
  const words = ERRORS[lang];
  if (!words) return err?.message ?? '';
  const code = booking && err?.code === 'VALIDATION' ? 'BOOKING_DAYS' : err?.code;
  return (code && words[code]) || words.OTHER;
}

/**
 * A care-plan item in the portal ({ builtIn, text }) in her language: a built-in item's unchanged wording translated,
 * else as typed (an item a doctor added or reworded stays in English).
 */
export const portalItemText = (item, lang) => portalItemTranslation(item, lang) ?? item?.text ?? '';

/** Whether an item is shown as typed (in English) although another language was chosen. */
export const isTypedText = (item, lang) => lang !== 'en' && !portalItemTranslation(item, lang);

// This phone or computer's choice (only the language – nothing about her).
const KEY = 'perinexa:portalLanguage';
export function rememberedPortalLanguage() {
  try {
    const lang = localStorage.getItem(KEY);
    return PORTAL_LANGUAGES.includes(lang) ? lang : null;
  } catch {
    return null;
  }
}
export function rememberPortalLanguage(lang) {
  try {
    if (PORTAL_LANGUAGES.includes(lang)) localStorage.setItem(KEY, lang);
  } catch {
    /* storage unavailable: the choice lasts until the page is closed */
  }
}

/**
 * The language the portal shows: what was chosen on this phone or computer; otherwise, once she is signed in, the
 * language recorded for her messages; otherwise English.
 */
export const portalLanguage = (remembered, recorded) => remembered ?? (PORTAL_LANGUAGES.includes(recorded) ? recorded : 'en');

/**
 * The paper with her portal code (Patient → Reminders and portal → Print it for her), in English with Marathi or
 * Hindi under it. hospital: the hospital's name, or null; address: the portal's web address (both as they are).
 */
export const PORTAL_SLIP_WORDS = {
  en: {
    title: (hospital) => `Your care at ${hospital ?? 'the hospital'} – online`,
    forWhom: 'For',
    open: ['Open ', ' and sign in with:'],
    digits: 'and the last 4 digits of your mobile number. You will see your next appointment and what is due in your care plan.',
    keep: 'Keep this paper safe. The code works for 90 days. If you lose it, ask the hospital for a new one – the old one then stops working.',
  },
  mr: {
    title: (hospital) => `${hospital ? `${hospital} मधील` : 'रुग्णालयातील'} तुमची काळजी – ऑनलाइन`,
    forWhom: 'नाव',
    open: ['', ' हा पत्ता उघडा आणि हे वापरून आत या:'],
    digits: 'आणि तुमच्या मोबाइल नंबरचे शेवटचे 4 अंक. तुम्हाला तुमची पुढील भेट आणि तुमच्या काळजीच्या योजनेत पुढे काय करायचे आहे ते दिसेल.',
    keep: 'हा कागद सांभाळून ठेवा. हा कोड 90 दिवस चालतो. कागद हरवल्यास रुग्णालयाकडून नवीन कोड घ्या – मग जुना कोड बंद होतो.',
  },
  hi: {
    title: (hospital) => `${hospital ? `${hospital} में` : 'अस्पताल में'} आपकी देखभाल – ऑनलाइन`,
    forWhom: 'नाम',
    open: ['', ' खोलें और इससे अंदर आएँ:'],
    digits: 'और आपके मोबाइल नंबर के आख़िरी 4 अंक। आपको अपनी अगली मुलाक़ात और अपनी देखभाल योजना में आगे क्या करना है, यह दिखेगा।',
    keep: 'यह काग़ज़ सँभालकर रखें। यह कोड 90 दिन तक चलता है। काग़ज़ खो जाए तो अस्पताल से नया कोड लें – तब पुराना कोड बंद हो जाता है।',
  },
};
