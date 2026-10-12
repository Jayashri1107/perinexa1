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
