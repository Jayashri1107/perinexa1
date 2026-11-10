// What goes on a printed care plan (Feature 9). Pure functions of the PlanView the Care plan tab already has:
// the server works out every item's status; these only choose, order and word the items.
//  - Patient copy: plain words, what is still to come (the complete plan, some types – e.g. only the visit or
//    the sonography schedule – or hand-picked items), optionally what is already done, advice, and the
//    doctor's own advice.
//  - Staff copy: every item with its timing, status, guideline source, result and notes.
//  - The patient copy in English with Marathi or Hindi next to it (5 Oct 2026): every function that words the patient
//    copy takes a language ('en' – the default, as before but for the note at the end, see patientNote – 'mr' or
//    'hi'). Items are translated only while their English wording is still exactly the built-in one
//    (careplans/itemTranslations.js); what staff typed prints as typed. Dates and numbers keep their usual format.
//    ⚠️ DRAFT – the Marathi and Hindi wording here must be checked by fluent speakers (docs/TRANSLATIONS_TO_CHECK.md).
import { formatDate } from '../../components/ui.jsx';
import { planItemText } from '../careplans/itemTranslations.js';
import { DONE_WORDS, isAntenatalPlan, itemState, stageOf, stagesOf, startOf, windowText } from './carePlanFormat.js';

const W = (en, mr, hi) => ({ en, mr, hi });
const pick = (byLang, lang) => byLang[lang] ?? byLang.en;

/** The types of item, in the order the Print dialog and the printout list them. */
export const PRINT_KINDS = ['visit', 'scan', 'investigation', 'vaccination', 'medication', 'advice'];

/** The types as the doctor picks them in the Print dialog. */
export const PRINT_KIND_LABELS = {
  visit: 'Visits (check-ups)',
  scan: 'Scans (sonography)',
  investigation: 'Lab tests',
  vaccination: 'Vaccinations and injections',
  medication: 'Medicines',
  advice: 'Advice',
};

/** Each item's type in plain words, on the patient copy. */
export const PATIENT_KIND_WORDS = {
  visit: 'Check-up',
  scan: 'Ultrasound (sonography)',
  investigation: 'Test',
  vaccination: 'Injection',
  medication: 'Medicine',
  advice: 'Advice',
};
/** The same in each language ({ en, mr, hi }), for the patient copy with Marathi or Hindi. */
export const PATIENT_KIND_LABELS = {
  visit: W(PATIENT_KIND_WORDS.visit, 'तपासणी', 'जाँच'),
  scan: W(PATIENT_KIND_WORDS.scan, 'सोनोग्राफी', 'सोनोग्राफ़ी'),
  investigation: W(PATIENT_KIND_WORDS.investigation, 'चाचणी', 'टेस्ट'),
  vaccination: W(PATIENT_KIND_WORDS.vaccination, 'इंजेक्शन', 'इंजेक्शन'),
  medication: W(PATIENT_KIND_WORDS.medication, 'औषध', 'दवा'),
  advice: W(PATIENT_KIND_WORDS.advice, 'सल्ला', 'सलाह'),
};

/** The fixed words of the patient copy ({ en, mr, hi }). */
export const PATIENT_COPY_LABELS = {
  name: W('Name', 'नाव', 'नाम'),
  age: W('Age', 'वय', 'आयु'),
  patientNo: W('Patient no.', 'रुग्ण क्रमांक', 'रोगी क्रमांक'),
  edd: W('Due date (EDD)', 'प्रसूतीची अंदाजे तारीख (EDD)', 'प्रसव की अनुमानित तारीख़ (EDD)'),
  weeksToday: W('Weeks of pregnancy today', 'आज गरोदरपणाचे आठवडे', 'आज गर्भावस्था के हफ़्ते'),
  doctor: W('Doctor', 'डॉक्टर', 'डॉक्टर'),
  planned: W('What is planned', 'पुढे काय करायचे आहे', 'आगे क्या करना है'),
  when: W('When', 'केव्हा', 'कब'),
  what: W('What', 'काय', 'क्या'),
  alreadyDone: W('Already done', 'आधीच झालेले', 'जो हो चुका है'),
  done: W('Done', 'झाले', 'हुआ'),
  advice: W('Advice', 'सल्ला', 'सलाह'),
  fromDoctor: W('From your doctor', 'तुमच्या डॉक्टरांचा सल्ला', 'आपके डॉक्टर की सलाह'),
};
/** The label of the day a plan other than a pregnancy counts from (its startWord): "Delivered 28 Sep 2026". */
export const START_DAY_LABELS = {
  delivery: W('Delivered', 'प्रसूतीची तारीख', 'प्रसव की तारीख़'),
  birth: W('Born', 'जन्मतारीख', 'जन्म की तारीख़'),
  start: W('Started', 'सुरू झाल्याची तारीख', 'शुरू होने की तारीख़'),
  // pregnancy-loss care: the day she was seen (carePlanFormat.js START_LABELS.loss) – never names the loss
  loss: W('Seen', 'तपासणीची तारीख', 'जाँच की तारीख़'),
};
export const startDayLabel = (plan) => START_DAY_LABELS[plan?.startWord] ?? START_DAY_LABELS.start;

/** "24 weeks 3 days" (weeks of pregnancy today, in plain words), in a language. */
export function plainWeeks(ga, lang = 'en') {
  if (!ga) return '';
  return pick(
    { en: `${ga.weeks} weeks ${ga.days} days`, mr: `${ga.weeks} आठवडे ${ga.days} दिवस`, hi: `${ga.weeks} हफ़्ते ${ga.days} दिन` },
    lang,
  );
}

// Words for the title of a copy with only some types.
const TITLE_WORDS = { visit: 'check-ups', scan: 'scans', investigation: 'lab tests', vaccination: 'vaccinations', medication: 'medicines', advice: 'advice' };
const TITLE_WORDS_IN = {
  en: TITLE_WORDS,
  mr: { visit: 'तपासण्या', scan: 'सोनोग्राफी', investigation: 'प्रयोगशाळेतील चाचण्या', vaccination: 'लसीकरण', medication: 'औषधे', advice: 'सल्ला' },
  hi: { visit: 'जाँचें', scan: 'सोनोग्राफ़ी', investigation: 'लैब टेस्ट', vaccination: 'टीकाकरण', medication: 'दवाइयाँ', advice: 'सलाह' },
};
const AND_WORDS = { en: 'and', mr: 'व', hi: 'और' };

// Still to come: open items with a date (or waiting for the item they are timed after). Items that need a
// doctor's decision first, missed visits and items that do not apply are never printed for the patient.
const TO_COME = ['overdue', 'due', 'upcoming', 'waiting'];
export const isToCome = (item) => itemState(item) === 'open' && TO_COME.includes(item.status);
const isDone = (item) => itemState(item) === 'done';

const time = (d) => (d ? new Date(d).getTime() : Infinity);
const byStart = (a, b) => time(startOf(a)) - time(startOf(b)) || a.name.localeCompare(b.name);
const byDoneOn = (a, b) => time(a.done?.on) - time(b.done?.on) || a.name.localeCompare(b.name);

/** "a, b and c" ("a, b व c" in Marathi, "a, b और c" in Hindi: and = AND_WORDS[lang]). */
export const joinWords = (words, and = 'and') => (words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} ${and} ${words[words.length - 1]}`);

/** The Print dialog's "Choose items" list: { toCome, done } – still to come by date, then done (oldest first). */
export function choosableItems(plan) {
  const items = plan?.items ?? [];
  return { toCome: items.filter(isToCome).sort(byStart), done: items.filter(isDone).sort(byDoneOn) };
}

/**
 * The patient copy's content: { schedule, done, advice }.
 * - scope 'all': everything still to come; 'kinds': only those types; 'items': only the chosen item ids.
 * - schedule: items still to come (not advice), by date; done: items already done – when includeDone is set,
 *   or chosen one by one; advice: advice items (their plain text) that are still to come or given.
 */
export function patientCopy(plan, { scope = 'all', kinds = [], ids = [], includeDone = false } = {}) {
  const items = plan?.items ?? [];
  const chosen = new Set(ids);
  const wanted = (it) => (scope === 'kinds' ? kinds.includes(it.kind) : scope === 'items' ? chosen.has(it.id) : true);
  const withDone = scope === 'items' || includeDone;
  return {
    schedule: items.filter((it) => it.kind !== 'advice' && isToCome(it) && wanted(it)).sort(byStart),
    done: withDone ? items.filter((it) => it.kind !== 'advice' && isDone(it) && wanted(it)).sort(byDoneOn) : [],
    advice: items.filter((it) => it.kind === 'advice' && (isToCome(it) || isDone(it)) && wanted(it)).sort(byStart),
  };
}

/** Whether the patient copy has anything to print (besides the doctor's own advice). */
export const hasContent = (copy) => copy.schedule.length + copy.done.length + copy.advice.length > 0;

/** The printout's title: "Visit schedule", "Sonography (scan) schedule", "Pregnancy care plan" … */
// The patient copy's title for each type of care (plain words for the patient), in each language.
const COPY_TITLES = {
  antenatal: W('Pregnancy care plan', 'गरोदरपणातील काळजीची योजना', 'गर्भावस्था की देखभाल योजना'),
  postnatal: W('Care plan after delivery', 'प्रसूतीनंतरच्या काळजीची योजना', 'प्रसव के बाद की देखभाल योजना'),
  newborn: W('Baby’s care and vaccination plan', 'बाळाची काळजी व लसीकरणाची योजना', 'शिशु की देखभाल और टीकाकरण योजना'),
  gynaecology: W('Care plan', 'काळजीची योजना', 'देखभाल योजना'),
  infertility: W('Fertility care plan', 'गर्भधारणेसाठी काळजीची योजना', 'गर्भधारण के लिए देखभाल योजना'),
  // never names the loss on the patient's copy, in any language
  abortion: W('Follow-up care plan', 'पुढील काळजीची योजना', 'आगे की देखभाल की योजना'),
};
const COPY_TITLE_DEFAULT = W('Care plan', 'काळजीची योजना', 'देखभाल योजना');
const SCHEDULE_TITLES = {
  visit: W('Visit schedule', 'तपासण्यांचे वेळापत्रक', 'जाँचों की समय-सारिणी'),
  scan: W('Sonography (scan) schedule', 'सोनोग्राफीचे वेळापत्रक', 'सोनोग्राफ़ी की समय-सारिणी'),
  both: W('Visit and scan schedule', 'तपासणी व सोनोग्राफीचे वेळापत्रक', 'जाँच और सोनोग्राफ़ी की समय-सारिणी'),
};
const SELECTED_WORDS = W('selected items', 'निवडक बाबी', 'चुनी हुई बातें');

export function patientCopyTitle({ scope = 'all', kinds = [] } = {}, careType = 'antenatal', lang = 'en') {
  const base = pick(COPY_TITLES[careType] ?? COPY_TITLE_DEFAULT, lang);
  if (scope === 'items') return `${base} – ${pick(SELECTED_WORDS, lang)}`;
  const k = PRINT_KINDS.filter((x) => kinds.includes(x));
  if (scope !== 'kinds' || k.length === 0 || k.length === PRINT_KINDS.length) return base;
  if (k.length === 1 && k[0] === 'visit') return pick(SCHEDULE_TITLES.visit, lang);
  if (k.length === 1 && k[0] === 'scan') return pick(SCHEDULE_TITLES.scan, lang);
  if (k.length === 2 && k.includes('visit') && k.includes('scan')) return pick(SCHEDULE_TITLES.both, lang);
  const words = pick(TITLE_WORDS_IN, lang);
  return `${base}: ${joinWords(
    k.map((x) => words[x]),
    pick(AND_WORDS, lang),
  )}`;
}

/**
 * Words the patient reads for an item of pregnancy-loss care that has none of its own (one a doctor added): its staff
 * name may name the loss, which must never be on her copy, in the portal or in a message (the server's portal uses the
 * same words – careplans/plansService.js PATIENT_FALLBACK_LOSS).
 */
export const PATIENT_FALLBACK_LOSS = 'Check-up or test – your doctor will explain';

/**
 * What an item is, in the patient's words: its patient text, or its name when the template has none – except in
 * pregnancy-loss care (careType 'abortion'), where it is PATIENT_FALLBACK_LOSS instead of the name.
 */
export const patientWhat = (item, careType = null) => item.patientText?.trim() || (careType === 'abortion' ? PATIENT_FALLBACK_LOSS : item.name);

/**
 * The item in Marathi or Hindi for the patient, or null when it prints as typed (in English): only a built-in item
 * whose English wording is unchanged has a translation – never an item a doctor added or reworded.
 */
export const patientWhatIn = (item, lang) => planItemText(item, lang);

/** How many of the items on this copy print in English only, in this language (0 for English). */
export function untranslatedCount(copy, lang) {
  if (lang !== 'mr' && lang !== 'hi') return 0;
  return [...copy.schedule, ...copy.done, ...copy.advice].filter((it) => !patientWhatIn(it, lang)).length;
}

const WHEN_WORDS = {
  en: { asap: 'As soon as possible', wasDue: (d) => `was due by ${d}`, fromAbout: (d) => `From about ${d}`, doctorTells: 'Your doctor will tell you the date', weeks: (w) => `${w} weeks` },
  mr: { asap: 'लवकरात लवकर', wasDue: (d) => `${d} पर्यंत करायचे होते`, fromAbout: (d) => `सुमारे ${d} पासून`, doctorTells: 'तारीख तुमचे डॉक्टर सांगतील', weeks: (w) => `${w} आठवडे` },
  hi: { asap: 'जल्द से जल्द', wasDue: (d) => `${d} तक होना था`, fromAbout: (d) => `लगभग ${d} से`, doctorTells: 'तारीख़ आपके डॉक्टर बताएँगे', weeks: (w) => `${w} हफ़्ते` },
};

// "18–20 weeks" / "36 weeks" from the item's window in gestation (no days: plain words for the patient).
function weeksWords(gw, lang) {
  if (!gw?.from) return '';
  const a = gw.from.weeks;
  const b = gw.to?.weeks ?? a;
  return pick(WHEN_WORDS, lang).weeks(a === b ? a : `${a}–${b}`);
}

/**
 * When, for the patient: { when, weeks } – e.g. { when: '12–26 Oct 2026', weeks: '18–20 weeks' }.
 * Overdue: "As soon as possible (was due by …)"; waiting for another item: "From about …". The dates keep their
 * usual format in every language.
 */
export function patientWhen(item, lang = 'en') {
  const w = pick(WHEN_WORDS, lang);
  if (item.status === 'overdue') return { when: w.asap, weeks: item.due?.to ? w.wasDue(formatDate(item.due.to)) : '' };
  if (item.status === 'waiting') {
    return { when: item.estimateFrom ? w.fromAbout(formatDate(item.estimateFrom)) : w.doctorTells, weeks: '' };
  }
  return { when: item.due ? windowText(item.due.from, item.due.to) : '', weeks: weeksWords(item.gaWindow, lang) };
}

// "Attended 3 Sep 2026" in Marathi and Hindi: the date first, then what happened (in the gender of the item's type).
const DONE_IN = {
  mr: { visit: (d) => `${d} रोजी झाली`, investigation: (d) => `${d} रोजी झाली`, scan: (d) => `${d} रोजी झाली`, vaccination: (d) => `${d} रोजी दिले`, medication: (d) => `${d} पासून सुरू`, advice: (d) => `${d} रोजी दिला` },
  hi: { visit: (d) => `${d} को हुई`, investigation: (d) => `${d} को हुआ`, scan: (d) => `${d} को हुई`, vaccination: (d) => `${d} को दिया गया`, medication: (d) => `${d} से शुरू`, advice: (d) => `${d} को दी गई` },
};
const DONE_DEFAULT = { mr: (d) => `${d} रोजी झाले`, hi: (d) => `${d} को हुआ` };
const ELSEWHERE = W(' (elsewhere)', ' (इतर ठिकाणी)', ' (कहीं और)');

/** "Done 12 Aug 2026", "Attended 3 Sep 2026", "Given …" (+ " (elsewhere)"); "3 Sep 2026 रोजी झाली" … */
export function patientDone(item, lang = 'en') {
  const d = item.done;
  if (!d) return '';
  const date = formatDate(d.on);
  const words = lang === 'mr' || lang === 'hi' ? (DONE_IN[lang][item.kind] ?? DONE_DEFAULT[lang])(date) : `${DONE_WORDS[item.kind] ?? 'Done'} ${date}`;
  return `${words}${d.elsewhere ? pick(ELSEWHERE, lang) : ''}`;
}

const NEXT_WORDS = {
  en: { now: 'Your next check-up is due now – please come as soon as possible.', on: (w) => `Your next check-up: ${w}.` },
  mr: { now: 'तुमची पुढील तपासणी आता करायची आहे – कृपया लवकरात लवकर या.', on: (w) => `तुमची पुढील तपासणी: ${w}.` },
  hi: { now: 'आपकी अगली जाँच अभी होनी है – कृपया जल्द से जल्द आएँ।', on: (w) => `आपकी अगली जाँच: ${w}।` },
};

/** The next check-up line for the patient copy, or '' (only when a visit is due or coming). */
export function nextCheckUp(plan, lang = 'en') {
  const v = plan?.next?.visit;
  if (!v) return '';
  const w = pick(NEXT_WORDS, lang);
  if (v.status === 'overdue') return w.now;
  return w.on(windowText(v.dueFrom, v.dueBy));
}

// The note at the end of the patient copy: the dates are a guide (worked out from which day), bring the sheet, and
// when to come to the hospital at once.
//  - Pregnancy: the note every patient copy printed before 5 Oct 2026, word for word.
//  - After a delivery and for a baby: the dates' starting day, and the danger signs of the plan's own danger-sign
//    advice item (pnc_adv_danger, nb_adv_danger) in the words the plan has – so the note always says what the
//    doctor's template says, never a list kept here. In Marathi or Hindi only while those words are the built-in ones
//    (planItemText); otherwise that language ends with the general line below.
//  - Any other care (gynaecology, fertility, pregnancy loss), and a plan without that item: the general line of the
//    patient portal, "In an emergency, go to the hospital straight away."
// Until 5 Oct 2026 every patient copy – a baby's too – ended with the pregnancy note ("worked out from your due date
// … reduced movements of the baby"): the English for the other types of care is new, for the doctor to approve.
const NOTES = {
  antenatal: W(
    'The dates are a guide worked out from your due date; your doctor may change them. Bring this sheet to every visit. Come to the hospital at once for bleeding, severe headache, blurred vision, fits, fever, leaking of water or reduced movements of the baby.',
    'या तारखा तुमच्या प्रसूतीच्या अंदाजे तारखेवरून काढलेल्या आहेत; तुमचे डॉक्टर त्या बदलू शकतात. प्रत्येक तपासणीला हा कागद घेऊन या. रक्तस्राव, तीव्र डोकेदुखी, धूसर दिसणे, झटके, ताप, पाणी जाणे किंवा बाळाची हालचाल कमी झाल्यास लगेच रुग्णालयात या.',
    'ये तारीख़ें आपकी प्रसव की अनुमानित तारीख़ से निकाली गई हैं; आपके डॉक्टर इन्हें बदल सकते हैं। हर जाँच पर यह काग़ज़ साथ लाएँ। ख़ून आना, तेज़ सिरदर्द, धुंधला दिखना, दौरे, बुख़ार, पानी जाना या शिशु की हलचल कम होने पर तुरंत अस्पताल आएँ।',
  ),
  postnatal: W(
    'The dates are a guide worked out from the day of delivery; your doctor may change them. Bring this sheet to every visit.',
    'या तारखा प्रसूतीच्या दिवसावरून काढलेल्या आहेत; तुमचे डॉक्टर त्या बदलू शकतात. प्रत्येक तपासणीला हा कागद घेऊन या.',
    'ये तारीख़ें प्रसव के दिन से निकाली गई हैं; आपके डॉक्टर इन्हें बदल सकते हैं। हर जाँच पर यह काग़ज़ साथ लाएँ।',
  ),
  newborn: W(
    'The dates are a guide worked out from the baby’s date of birth; your doctor may change them. Bring this sheet to every visit.',
    'या तारखा बाळाच्या जन्मतारखेवरून काढलेल्या आहेत; तुमचे डॉक्टर त्या बदलू शकतात. प्रत्येक तपासणीला हा कागद घेऊन या.',
    'ये तारीख़ें शिशु की जन्म की तारीख़ से निकाली गई हैं; आपके डॉक्टर इन्हें बदल सकते हैं। हर जाँच पर यह काग़ज़ साथ लाएँ।',
  ),
  other: W(
    'The dates are a guide worked out from the day this plan started; your doctor may change them. Bring this sheet to every visit.',
    'या तारखा ही योजना सुरू झाल्याच्या दिवसावरून काढलेल्या आहेत; तुमचे डॉक्टर त्या बदलू शकतात. प्रत्येक तपासणीला हा कागद घेऊन या.',
    'ये तारीख़ें इस योजना के शुरू होने के दिन से निकाली गई हैं; आपके डॉक्टर इन्हें बदल सकते हैं। हर जाँच पर यह काग़ज़ साथ लाएँ।',
  ),
};
// The same words as the patient portal's (portal/portalWords.js `emergency`)
const EMERGENCY = W('In an emergency, go to the hospital straight away.', 'आणीबाणीच्या वेळी लगेच रुग्णालयात जा.', 'आपात स्थिति में तुरंत अस्पताल जाएँ।');
/** The built-in danger-sign advice item of a type of care whose note names its danger signs. */
export const DANGER_SIGN_ITEMS = { postnatal: 'pnc_adv_danger', newborn: 'nb_adv_danger' };

const withStop = (text, lang) => (/[.?।]$/.test(text) ? text : `${text}${lang === 'hi' ? '।' : '.'}`);

/** The plan's danger-sign advice item for the note: from the template, with patient words, not "does not apply" or "not needed". */
function dangerSignItem(plan) {
  const key = DANGER_SIGN_ITEMS[plan?.careType];
  if (!key) return null;
  return (plan.items ?? []).find((it) => it.origin === 'template' && it.key === key && it.patientText && it.status !== 'not_applicable' && itemState(it) !== 'not_needed') ?? null;
}

/** The note at the end of the patient copy of this plan, in a language. */
export function patientNote(plan, lang = 'en') {
  if (isAntenatalPlan(plan)) return pick(NOTES.antenatal, lang);
  const item = dangerSignItem(plan);
  const danger = item ? (lang === 'en' ? item.patientText.trim() : planItemText(item, lang)) : null;
  return `${pick(NOTES[plan.careType] ?? NOTES.other, lang)} ${withStop(danger || pick(EMERGENCY, lang), lang)}`;
}

/** The Draft band of a patient copy in Marathi or Hindi, printed after the English band. */
export const DRAFT_PLAN_WORDS = W('', 'मसुदा – डॉक्टरांनी अजून मंजूर केलेले नाही.', 'ड्राफ़्ट – डॉक्टर ने अभी मंज़ूरी नहीं दी है।');

// ---------- Patient copy as a month-by-month table (10 Nov 2026, docs/PLAN_TABLE_LAYOUT.md) ----------
// A second layout of the patient copy, for pregnancy plans only, laid out like the owner's "9-Month Pregnancy Plan"
// sample sheet (Anandi Hospital): the facts, "Special care needed", one row for each month of pregnancy with a column
// for each type of item, "Today:" in this month, the delivery plan and the doctor's remarks typed at printing, the
// danger signs, three reminders and the closing line.
// Wording approved by the owner on 10 Nov 2026 (the plain words for the risk reasons, the danger signs, the reminders and
// the closing line). The Marathi and Hindi stay listed for a fluent speaker's check (docs/TRANSLATIONS_TO_CHECK.md).

/** The months of pregnancy as on the owner's sample sheet: [month, from week, to week]. Month 9 runs on to 42 w 6 d. */
export const PREGNANCY_MONTHS = [
  [1, 0, 4],
  [2, 5, 8],
  [3, 9, 13],
  [4, 14, 17],
  [5, 18, 22],
  [6, 23, 27],
  [7, 28, 31],
  [8, 32, 35],
  [9, 36, 42],
];

/** The table's columns, in order, with the item types each one holds. */
export const TABLE_COLUMNS = [
  { key: 'visit', kinds: ['visit'] },
  { key: 'scan', kinds: ['scan'] },
  { key: 'test', kinds: ['investigation'] },
  { key: 'medicine', kinds: ['vaccination', 'medication'] },
  { key: 'advice', kinds: ['advice'] },
];

/** The fixed words of the table page ({ en, mr, hi }). Marathi and Hindi: for the fluent-speaker check. */
export const TABLE_LABELS = {
  title: W('9-Month Pregnancy Plan', 'गरोदरपणाचा ९ महिन्यांचा तपासणी प्रवास', '९ महीने की गर्भावस्था योजना'),
  month: W('Month', 'महिना', 'महीना'),
  visit: W('Visit dates', 'भेटी', 'जाँच की तारीख़ें'),
  scan: W('Scans', 'सोनोग्राफी', 'सोनोग्राफ़ी'),
  test: W('Tests', 'तपासण्या', 'टेस्ट'),
  medicine: W('Medicines & vaccines', 'औषधे व लसी', 'दवाइयाँ और टीके'),
  advice: W('Advice', 'सल्ला', 'सलाह'),
  today: W('Today', 'आज', 'आज'),
  beforeRegistration: W('Before registration', 'नोंदणीपूर्वी', 'पंजीकरण से पहले'),
  wk: W('wk', 'आठवडे', 'हफ़्ते'),
  obstetricScore: W('Obstetric score', 'प्रसूती इतिहास', 'प्रसूति इतिहास'),
  lmp: W('LMP', 'शेवटची पाळी', 'आख़िरी माहवारी'),
  bloodGroup: W('Blood group', 'रक्तगट', 'ब्लड ग्रुप'),
  mobile: W('Mobile', 'मोबाइल', 'मोबाइल'),
  fromLmp: W('LMP', 'पाळीवरून', 'माहवारी से'),
  fromScan: W('scan', 'सोनोग्राफीवरून', 'सोनोग्राफ़ी से'),
  specialCare: W('Special care needed', 'विशेष काळजी', 'विशेष देखभाल'),
  deliveryPlan: W('Delivery plan', 'प्रसूतीची योजना', 'प्रसव की योजना'),
  remarks: W('Doctor’s remarks', 'डॉक्टरांची टिप्पणी', 'डॉक्टर की टिप्पणी'),
  danger: W('Danger signs – come to hospital immediately', 'धोक्याची लक्षणे – त्वरित रुग्णालयात या', 'ख़तरे के लक्षण – तुरंत अस्पताल आएँ'),
  date: W('Date', 'तारीख', 'तारीख़'),
  rmo: W('RMO', 'आरएमओ', 'आरएमओ'),
  consultant: W('Consultant', 'सल्लागार डॉक्टर', 'परामर्शदाता डॉक्टर'),
};

/** The danger signs of the sample sheet, in its order (two columns on paper). Approved by the owner, 10 Nov 2026. */
export const DANGER_SIGNS = [
  W('Bleeding from vagina', 'योनीमार्गातून रक्तस्राव', 'योनि से ख़ून आना'),
  W('Leaking of water', 'पाणी जाणे', 'पानी जाना'),
  W('Baby moving less', 'बाळाची हालचाल कमी होणे', 'शिशु की हलचल कम होना'),
  W('Severe headache / blurred vision', 'तीव्र डोकेदुखी / धूसर दिसणे', 'तेज़ सिरदर्द / धुंधला दिखना'),
  W('Swelling of face or hands', 'चेहरा / हातांवर सूज', 'चेहरे या हाथों पर सूजन'),
  W('Severe pain in abdomen', 'पोटात तीव्र दुखणे', 'पेट में तेज़ दर्द'),
  W('Fever', 'ताप', 'बुख़ार'),
  W('Fits / convulsions', 'झटके येणे', 'दौरे / झटके'),
  W('Breathlessness', 'दम लागणे', 'साँस फूलना'),
  W('Continuous vomiting', 'सतत उलट्या', 'लगातार उल्टी'),
];

/** The three standing reminders of the sample sheet. Approved by the owner, 10 Nov 2026. */
export const PLAN_REMINDERS = [
  W('From 28 weeks count baby movements daily – at least 10 in 2 hours.', '२८ आठवड्यांनंतर रोज बाळाच्या हालचाली मोजा – २ तासांत किमान १० हालचाली.', '२८ हफ़्ते के बाद रोज़ शिशु की हलचल गिनें – २ घंटे में कम से कम १०।'),
  W('Take iron and calcium tablets daily, at different times.', 'लोह व कॅल्शियमच्या गोळ्या रोज, वेगवेगळ्या वेळी घ्या.', 'आयरन और कैल्शियम की गोलियाँ रोज़, अलग-अलग समय पर लें।'),
  W('Bring this plan and all reports to every visit.', 'प्रत्येक भेटीला ही योजना व सर्व रिपोर्ट्स सोबत आणा.', 'हर जाँच पर यह योजना और सभी रिपोर्ट साथ लाएँ।'),
];

/** The closing line of the sample sheet. Approved by the owner, 10 Nov 2026. */
export const TABLE_NOTE = W(
  'Dates are approximate target dates; the doctor may change the plan at any visit. Fetal sex is not disclosed (PC-PNDT Act).',
  'तारखा अंदाजे आहेत; डॉक्टर कोणत्याही भेटीत योजना बदलू शकतात. गर्भाचे लिंग सांगितले जात नाही (PC-PNDT कायदा).',
  'तारीख़ें अनुमानित हैं; डॉक्टर किसी भी जाँच पर योजना बदल सकते हैं। गर्भ का लिंग नहीं बताया जाता (PC-PNDT अधिनियम)।',
);

/**
 * "Special care needed": her risk reasons in plain words for a paper the family reads. Only the reasons listed here
 * print; the others never do – an infection needing specialist care (it may be HIV: the neutral-name rule), a mental
 * health condition, tuberculosis, a stillbirth or newborn death before. Several reasons with the same plain words print
 * once. The words and the list approved by the owner, 10 Nov 2026.
 */
export const SPECIAL_CARE_WORDS = {
  age: W('Mother’s age (under 18 or over 35)', 'आईचे वय (१८ पेक्षा कमी किंवा ३५ पेक्षा जास्त)', 'माँ की उम्र (१८ से कम या ३५ से ज़्यादा)'),
  bmi30: W('High body weight', 'जास्त वजन', 'ज़्यादा वज़न'),
  bmi40: W('High body weight', 'जास्त वजन', 'ज़्यादा वज़न'),
  height: W('Short height', 'कमी उंची', 'कम लंबाई'),
  hb7: W('Anaemia', 'रक्तक्षय (ॲनिमिया)', 'ख़ून की कमी (एनीमिया)'),
  hb10: W('Anaemia', 'रक्तक्षय (ॲनिमिया)', 'ख़ून की कमी (एनीमिया)'),
  rhneg: W('Rh-negative blood group', 'Rh-निगेटिव्ह रक्तगट', 'Rh-नेगेटिव ब्लड ग्रुप'),
  isoimmunisation: W('Rh antibodies in an earlier pregnancy', 'मागील गरोदरपणात Rh प्रतिपिंडे', 'पिछली गर्भावस्था में Rh एंटीबॉडी'),
  cs1: W('Previous caesarean', 'यापूर्वी सिझेरियन', 'पहले सिज़ेरियन'),
  cs2: W('Two or more previous caesareans', 'यापूर्वी दोन किंवा अधिक सिझेरियन', 'पहले दो या अधिक सिज़ेरियन'),
  uterine: W('Earlier operation on the womb', 'गर्भाशयावर यापूर्वी शस्त्रक्रिया', 'गर्भाशय का पहले ऑपरेशन'),
  grand: W('Four or more births before', 'यापूर्वी चार किंवा अधिक प्रसूती', 'पहले चार या अधिक प्रसव'),
  past: W('A problem in an earlier pregnancy', 'मागील गरोदरपणात त्रास', 'पिछली गर्भावस्था में समस्या'),
  multiple: W('Twins or more', 'जुळी किंवा अधिक बाळे', 'जुड़वाँ या अधिक बच्चे'),
  praevia: W('Low-lying placenta', 'वार खाली असणे', 'आँवल नीचे होना'),
  bleeding: W('Bleeding in this pregnancy', 'या गरोदरपणात रक्तस्राव', 'इस गर्भावस्था में ख़ून आना'),
  chronic_htn: W('High blood pressure', 'उच्च रक्तदाब', 'हाई ब्लड प्रेशर'),
  pih: W('High blood pressure', 'उच्च रक्तदाब', 'हाई ब्लड प्रेशर'),
  bp140: W('High blood pressure', 'उच्च रक्तदाब', 'हाई ब्लड प्रेशर'),
  bp160: W('High blood pressure', 'उच्च रक्तदाब', 'हाई ब्लड प्रेशर'),
  diabetes: W('Diabetes (high sugar)', 'मधुमेह (साखर)', 'मधुमेह (शुगर)'),
  gdm: W('Diabetes (high sugar)', 'मधुमेह (साखर)', 'मधुमेह (शुगर)'),
  thyroid: W('Thyroid problem', 'थायरॉईडचा त्रास', 'थायरॉइड की समस्या'),
  asthma: W('Asthma', 'दमा', 'दमा'),
  heart: W('Heart problem', 'हृदयाचा आजार', 'दिल की बीमारी'),
  renal: W('Kidney problem', 'मूत्रपिंडाचा आजार', 'गुर्दे की बीमारी'),
  liver: W('Liver problem', 'यकृताचा आजार', 'लिवर की बीमारी'),
  epilepsy: W('Fits (epilepsy)', 'फिट्स (अपस्मार)', 'मिर्गी'),
  thrombophilia: W('Blood clotting problem', 'रक्त गोठण्याचा त्रास', 'ख़ून जमने की समस्या'),
  autoimmune: W('Autoimmune illness', 'ऑटोइम्यून आजार', 'ऑटोइम्यून बीमारी'),
};

/** Her risk reasons for "Special care needed", in a language: plain words, listed ones only, each once. */
export function specialCareWords(reasons, lang = 'en') {
  const out = [];
  for (const r of reasons ?? []) {
    const words = SPECIAL_CARE_WORDS[r?.key];
    if (!words) continue;
    const w = pick(words, lang);
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

const DEVANAGARI = '०१२३४५६७८९';
/** Numbers in Devanagari digits for Marathi and Hindi ("महिना ३"), as on the sample; English keeps 0–9. */
export const localDigits = (text, lang = 'en') => (lang === 'mr' || lang === 'hi' ? String(text).replace(/[0-9]/g, (d) => DEVANAGARI[d]) : String(text));

/** The month (1–9) a week of pregnancy falls in; before week 0 → 1, after month 9 → 9; null when not a number. */
export function monthOfWeek(week) {
  if (!Number.isFinite(week)) return null;
  const m = PREGNANCY_MONTHS.find(([, , to]) => week <= to);
  return m ? m[0] : 9;
}

const DAY = 24 * 60 * 60 * 1000;
const addDaysTo = (d, n) => new Date(new Date(d).getTime() + n * DAY);
// The week of pregnancy on a day, counted from the plan's day zero (the LMP).
const weekOn = (plan, d) => (d && plan?.dayZero ? Math.floor((new Date(d).getTime() - new Date(plan.dayZero).getTime()) / (7 * DAY)) : null);
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "07 Dec" – a day on the table, without the year (as on the sample). */
export function shortDate(d) {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, '0')} ${SHORT_MONTHS[x.getUTCMonth()]}`;
}

/** The month an item belongs in: where its window starts, else its estimated or due date; null when nothing is known. */
export function itemMonth(item, plan) {
  if (item.gaWindow?.from) return monthOfWeek(item.gaWindow.from.weeks);
  const d = item.estimateFrom ?? item.due?.from ?? null;
  return d ? monthOfWeek(weekOn(plan, d)) : null;
}

/** Whether the patient copy can be printed as the month table: pregnancy plans only (never pregnancy-loss care). */
export const canPrintMonthTable = (plan) => isAntenatalPlan(plan) && plan?.careType !== 'abortion' && Boolean(plan?.dayZero);

const emptyCells = () => Object.fromEntries(TABLE_COLUMNS.map((c) => [c.key, []]));

/**
 * The month table: [{ month, fromWeek, toWeek, from, to, current, beforeRegistration, today: { column: [items] },
 * cells: { column: [items] } }]. options as patientCopy (scope, kinds, ids) plus fromToday:
 * - "Today" (this month only): what is due now or overdue, and what is still to come from a month that has passed –
 *   never dropped by itself – in its own column, as the sample's "Today:" lines.
 * - fromToday (the default): only what is still to come, from this month on.
 * - otherwise: all nine months, the months before registration marked, and done items too (with their date).
 * Done, not needed, does not apply, missed visits and items waiting for a doctor's decision are never "still to
 * come" (the same as the list layout).
 */
export function monthTable(plan, { scope = 'all', kinds = [], ids = [], fromToday = true } = {}) {
  const items = plan?.items ?? [];
  const chosen = new Set(ids);
  const wanted = (it) => (scope === 'kinds' ? kinds.includes(it.kind) : scope === 'items' ? chosen.has(it.id) : true);
  const current = monthOfWeek(plan?.gestationToday?.weeks ?? 0) ?? 1;
  const bookedMonth = plan?.bookedAt ? monthOfWeek(plan.bookedAt.weeks) : null;
  const rows = PREGNANCY_MONTHS.map(([month, fromWeek, toWeek]) => ({
    month,
    fromWeek,
    toWeek,
    from: plan?.dayZero ? addDaysTo(plan.dayZero, 7 * fromWeek) : null,
    to: plan?.dayZero ? addDaysTo(plan.dayZero, 7 * toWeek + 6) : null,
    current: month === current,
    beforeRegistration: bookedMonth != null && month < bookedMonth,
    today: emptyCells(),
    cells: emptyCells(),
  }));
  const columnOf = (it) => TABLE_COLUMNS.find((c) => c.kinds.includes(it.kind))?.key;
  for (const it of items) {
    const col = columnOf(it);
    if (!col || !wanted(it)) continue;
    const toCome = isToCome(it);
    if (!toCome && !(isDone(it) && !fromToday)) continue;
    let month = itemMonth(it, plan) ?? current;
    const late = toCome && month < current;
    if (late) month = current;
    const row = rows[month - 1];
    if (toCome && (late || it.status === 'overdue' || (row.current && it.status === 'due'))) row.today[col].push(it);
    else row.cells[col].push(it);
  }
  for (const row of rows) {
    for (const c of TABLE_COLUMNS) {
      row.today[c.key].sort(byStart);
      row.cells[c.key].sort((a, b) => (isDone(a) === isDone(b) ? byStart(a, b) : isDone(a) ? -1 : 1));
    }
  }
  return fromToday ? rows.filter((r) => r.month >= current) : rows;
}

const rowItems = (r) => TABLE_COLUMNS.flatMap((c) => [...r.today[c.key], ...r.cells[c.key]]);

/** Whether the month table has any item to print. */
export const tableHasContent = (rows) => rows.some((r) => rowItems(r).length > 0);

/** How many items of the table print in English only, in this language (0 for English). */
export function tableUntranslatedCount(rows, lang) {
  if (lang !== 'mr' && lang !== 'hi') return 0;
  return rows.flatMap(rowItems).filter((it) => it.kind !== 'visit' && !patientWhatIn(it, lang)).length;
}

/** "Month 5" in a language ("महिना ५"). */
export const monthWords = (month, lang = 'en') => localDigits(`${pick(TABLE_LABELS.month, lang)} ${month}`, lang);

/** "18–22 wk" for a month row (month 9 reads 36–40), in a language. */
export const monthWeeks = (row, lang = 'en') => localDigits(`${row.fromWeek}–${row.month === 9 ? 40 : row.toWeek} ${pick(TABLE_LABELS.wk, lang)}`, lang);

/** "10 Aug–13 Sep": a month row's dates. */
export const monthDates = (row) => (row.from ? `${shortDate(row.from)}–${shortDate(row.to)}` : '');

/** The day on a line of the table: the day it was done, about when (waiting), or the start of its window ("07 Dec"). */
export function tableLineDate(item) {
  if (isDone(item)) return shortDate(item.done?.on);
  return shortDate(item.status === 'waiting' ? item.estimateFrom : item.due?.from);
}

/** Whether an item on the table has been done (printed with a tick instead of an empty box). */
export const tableItemDone = (item) => isDone(item);

/** The facts at the top of the table page that the list does not have: obstetric score, LMP, blood group, mobile. */
export function tableFacts(patient) {
  const o = patient?.obstetric;
  const score = o && [o.gravida, o.para, o.living, o.abortions].some((v) => v != null) ? `G${o.gravida ?? '?'} P${o.para ?? '?'} L${o.living ?? '?'} A${o.abortions ?? '?'}` : '';
  return { score, lmp: patient?.pregnancy?.lmp ?? null, bloodGroup: patient?.medical?.bloodGroup ?? '', mobile: patient?.phone ?? '' };
}

/** The weeks a line added in a month row starts with: that month's weeks, not before today's week in this month. */
export function addWeeksForRow(row, plan) {
  const today = plan?.gestationToday?.weeks ?? 0;
  const toWeek = row.month === 9 ? 40 : row.toWeek;
  const fromWeek = row.current ? Math.min(Math.max(row.fromWeek, today), toWeek) : row.fromWeek;
  return { fromWeek, toWeek };
}

/** The item type a line added in a column starts with. */
export const addKindForColumn = (col) => TABLE_COLUMNS.find((c) => c.key === col)?.kinds[0] ?? '';

// ---------- Staff copy ----------

/** Every item, grouped by stage of pregnancy like the All view, with the items that do not apply last. */
export function staffCopyGroups(plan) {
  const items = plan?.items ?? [];
  const applies = items.filter((it) => it.status !== 'not_applicable');
  const groups = stagesOf(plan).map((s) => ({ key: s.key, label: s.label, items: applies.filter((it) => stageOf(it, plan) === s.key).sort(byStart) })).filter(
    (g) => g.items.length,
  );
  const notApplicable = items.filter((it) => it.status === 'not_applicable').sort(byStart);
  if (notApplicable.length) groups.push({ key: 'not_applicable', label: 'Does not apply to this patient', items: notApplicable });
  return groups;
}

/** The staff copy's "When": the timing ("11–13 w") and the dates, as on the Care plan tab. */
export function staffWhen(item) {
  const dates = item.due ? windowText(item.due.from, item.due.to) : item.estimateFrom ? `about ${formatDate(item.estimateFrom)}` : '';
  return [item.timingText, dates].filter(Boolean);
}

/** The staff copy's details: guideline source, result, notes, and who moved, included or added it (and why). */
export function staffDetails(item) {
  const out = [];
  if (item.done?.result) out.push(`Result: ${item.done.result}`);
  if (item.done?.note) out.push(`Note: ${item.done.note}`);
  if (item.note?.text) out.push(`Note: ${item.note.text} (${item.note.byName})`);
  if (item.manualDate) out.push(`Date moved by ${item.manualDate.byName}${item.manualDate.reason ? `: ${item.manualDate.reason}` : ''}`);
  if (item.forceInclude) out.push(`Included by ${item.forceInclude.byName}: ${item.forceInclude.reason}`);
  if (item.added) out.push(`Added by ${item.added.byName}${item.added.reason ? `: ${item.added.reason}` : ''}`);
  if (item.source) out.push(`Source: ${item.source}`);
  return out;
}
