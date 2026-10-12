// What goes on a printed care plan (Feature 9) – fake sample data only.
import { describe, expect, it } from 'vitest';
import {
  DRAFT_PLAN_WORDS,
  PATIENT_COPY_LABELS,
  PATIENT_KIND_LABELS,
  PRINT_KINDS,
  PRINT_KIND_LABELS,
  PATIENT_KIND_WORDS,
  START_DAY_LABELS,
  choosableItems,
  hasContent,
  isToCome,
  joinWords,
  nextCheckUp,
  patientCopy,
  patientCopyTitle,
  patientDone,
  patientNote,
  patientWhat,
  patientWhatIn,
  patientWhen,
  plainWeeks,
  staffCopyGroups,
  staffDetails,
  staffWhen,
  startDayLabel,
  untranslatedCount,
} from './carePlanPrintFormat.js';

// Dates arrive from the server as ISO strings at UTC midnight. EDD 1 Mar 2027: 18 w 0 d on 28 Sep 2026.
const day = (s) => `${s}T00:00:00.000Z`;
const base = { today: day('2026-09-28'), edd: day('2027-03-01'), bookedOn: day('2026-09-17'), status: 'active' };
const item = (id, kind, status, extra = {}) => ({
  id,
  kind,
  status,
  name: `${kind} ${id}`,
  patientText: '',
  timing: { atBooking: false, fromWeek: 20, toWeek: 22, after: { key: null, weeks: null } },
  timingText: '20–22 w',
  due: { from: day('2026-10-12'), to: day('2026-10-26') },
  gaWindow: { from: { weeks: 20, days: 0 }, to: { weeks: 22, days: 0 } },
  done: null,
  notNeeded: null,
  ...extra,
});
const doneOn = (on) => ({ on: day(on), elsewhere: false, result: '', note: '', byName: 'Dr A' });

const items = [
  item('v1', 'visit', 'upcoming', { patientText: 'Check-up at about 20 weeks' }),
  item('v0', 'visit', 'overdue', { due: { from: day('2026-09-01'), to: day('2026-09-20') } }),
  item('s1', 'scan', 'upcoming', { due: { from: day('2026-10-26'), to: day('2026-11-15') }, patientText: 'Detailed ultrasound of baby (18–20 weeks)' }),
  item('s0', 'scan', 'done', { done: doneOn('2026-08-14') }),
  item('l1', 'investigation', 'due', { due: { from: day('2026-09-20'), to: day('2026-10-02') } }),
  item('t2', 'vaccination', 'waiting', { due: null, gaWindow: null, estimateFrom: day('2026-10-30') }),
  item('a1', 'advice', 'due', { patientText: 'Come to hospital at once for bleeding' }),
  item('a2', 'advice', 'not_applicable'),
  item('m1', 'medication', 'not_needed', { notNeeded: { reasonCode: 'declined', reason: '', byName: 'Dr A' } }),
  item('x1', 'investigation', 'not_applicable'),
  item('d1', 'scan', 'decide'),
  item('mv', 'visit', 'missed'),
];
const plan = { ...base, items };
const ids = (list) => list.map((i) => i.id);

describe('the patient copy', () => {
  it('prints only what is still to come, never items that need a decision, missed visits or items that do not apply', () => {
    expect(isToCome(items.find((i) => i.id === 'd1'))).toBe(false);
    expect(isToCome(items.find((i) => i.id === 'mv'))).toBe(false);
    expect(isToCome(items.find((i) => i.id === 'x1'))).toBe(false);
    const copy = patientCopy(plan);
    // by date: overdue visit (1 Sep), lab test (20 Sep), visit (12 Oct), scan (26 Oct), then the waiting injection (about 30 Oct)
    expect(ids(copy.schedule)).toEqual(['v0', 'l1', 'v1', 's1', 't2']);
    expect(copy.done).toEqual([]);
    expect(ids(copy.advice)).toEqual(['a1']);
    expect(hasContent(copy)).toBe(true);
  });

  it('prints the visit schedule or the sonography schedule alone', () => {
    expect(ids(patientCopy(plan, { scope: 'kinds', kinds: ['visit'] }).schedule)).toEqual(['v0', 'v1']);
    const scans = patientCopy(plan, { scope: 'kinds', kinds: ['scan'], includeDone: true });
    expect(ids(scans.schedule)).toEqual(['s1']);
    expect(ids(scans.done)).toEqual(['s0']);
    expect(scans.advice).toEqual([]);
  });

  it('prints hand-picked items, done ones included when chosen', () => {
    const copy = patientCopy(plan, { scope: 'items', ids: ['s1', 's0', 'a1'] });
    expect(ids(copy.schedule)).toEqual(['s1']);
    expect(ids(copy.done)).toEqual(['s0']);
    expect(ids(copy.advice)).toEqual(['a1']);
    expect(hasContent(patientCopy(plan, { scope: 'items', ids: [] }))).toBe(false);
  });

  it('offers still-to-come and done items to choose from', () => {
    const { toCome, done } = choosableItems(plan);
    expect(ids(toCome)).toEqual(['v0', 'l1', 'a1', 'v1', 's1', 't2']);
    expect(ids(done)).toEqual(['s0']);
  });

  it('names the copy after what it holds', () => {
    expect(patientCopyTitle({ scope: 'all' })).toBe('Pregnancy care plan');
    expect(patientCopyTitle({ scope: 'kinds', kinds: ['visit'] })).toBe('Visit schedule');
    expect(patientCopyTitle({ scope: 'kinds', kinds: ['scan'] })).toBe('Sonography (scan) schedule');
    expect(patientCopyTitle({ scope: 'kinds', kinds: ['scan', 'visit'] })).toBe('Visit and scan schedule');
    expect(patientCopyTitle({ scope: 'kinds', kinds: ['vaccination', 'investigation'] })).toBe('Pregnancy care plan: lab tests and vaccinations');
    expect(patientCopyTitle({ scope: 'kinds', kinds: PRINT_KINDS })).toBe('Pregnancy care plan');
    expect(patientCopyTitle({ scope: 'items', ids: ['s1'] })).toBe('Pregnancy care plan – selected items');
  });

  it('uses plain words and dates', () => {
    expect(patientWhat(items[0])).toBe('Check-up at about 20 weeks');
    expect(patientWhat(items[1])).toBe('visit v0'); // no patient text: the item's name
    expect(patientWhen(items[0])).toEqual({ when: '12–26 Oct 2026', weeks: '20–22 weeks' });
    expect(patientWhen(items[1])).toEqual({ when: 'As soon as possible', weeks: 'was due by 20 Sep 2026' });
    expect(patientWhen(items[5])).toEqual({ when: 'From about 30 Oct 2026', weeks: '' });
    expect(patientWhen({ ...items[5], estimateFrom: null })).toEqual({ when: 'Your doctor will tell you the date', weeks: '' });
    expect(patientWhen({ ...items[0], gaWindow: { from: { weeks: 36, days: 0 }, to: { weeks: 36, days: 6 } } }).weeks).toBe('36 weeks');
    expect(patientDone(items[3])).toBe('Done 14 Aug 2026');
    expect(patientDone({ ...items[0], done: { ...doneOn('2026-09-17'), elsewhere: true } })).toBe('Attended 17 Sep 2026 (elsewhere)');
  });

  it('gives the next check-up', () => {
    expect(nextCheckUp({ next: { visit: { dueFrom: day('2026-10-12'), dueBy: day('2026-10-26'), status: 'upcoming' } } })).toBe('Your next check-up: 12–26 Oct 2026.');
    expect(nextCheckUp({ next: { visit: { dueFrom: day('2026-09-01'), dueBy: day('2026-09-20'), status: 'overdue' } } })).toMatch(/due now/);
    expect(nextCheckUp({ next: { visit: null } })).toBe('');
  });

  it('has words for every type', () => {
    for (const k of PRINT_KINDS) {
      expect(PRINT_KIND_LABELS[k]).toBeTruthy();
      expect(PATIENT_KIND_WORDS[k]).toBeTruthy();
    }
    expect(joinWords(['a'])).toBe('a');
    expect(joinWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('the staff copy', () => {
  it('lists every item by stage, with the items that do not apply last', () => {
    const groups = staffCopyGroups(plan);
    const all = groups.flatMap((g) => ids(g.items));
    expect(all).toHaveLength(items.length);
    expect(groups.at(-1)).toMatchObject({ key: 'not_applicable', label: 'Does not apply to this patient' });
    expect(ids(groups.at(-1).items).sort()).toEqual(['a2', 'x1']);
  });

  it('gives the timing, dates and details', () => {
    expect(staffWhen(items[0])).toEqual(['20–22 w', '12–26 Oct 2026']);
    expect(staffWhen(items[5])).toEqual(['20–22 w', 'about 30 Oct 2026']);
    const detailed = {
      ...items[0],
      source: 'WHO contact 2',
      done: { ...doneOn('2026-10-14'), result: 'Hb 11.2', note: 'fasting' },
      note: { text: 'bring reports', byName: 'Dr A' },
      manualDate: { byName: 'Dr A', reason: 'travelling' },
      forceInclude: { byName: 'Dr B', reason: 'GDM in this pregnancy' },
      added: { byName: 'Dr A', reason: '' },
    };
    expect(staffDetails(detailed)).toEqual([
      'Result: Hb 11.2',
      'Note: fasting',
      'Note: bring reports (Dr A)',
      'Date moved by Dr A: travelling',
      'Included by Dr B: GDM in this pregnancy',
      'Added by Dr A',
      'Source: WHO contact 2',
    ]);
  });
});

// The patient copy in English with Marathi or Hindi (5 Oct 2026). The English is unchanged (the tests above), except the
// note at the end for a type of care other than pregnancy (see its test – new English, for the doctor to approve).
const DEVANAGARI = /[\u0900-\u097F]/;
describe('the patient copy in Marathi and Hindi', () => {
  it('has every fixed word in both languages, in Devanagari, with the English of the copy', () => {
    for (const table of [PATIENT_COPY_LABELS, PATIENT_KIND_LABELS, START_DAY_LABELS]) {
      for (const [key, w] of Object.entries(table)) {
        expect(Object.keys(w).sort(), key).toEqual(['en', 'hi', 'mr']);
        for (const lang of ['mr', 'hi']) expect(w[lang], `${key}.${lang}`).toMatch(DEVANAGARI);
      }
    }
    for (const k of PRINT_KINDS) expect(PATIENT_KIND_LABELS[k].en).toBe(PATIENT_KIND_WORDS[k]);
    expect(startDayLabel({ startWord: 'delivery' }).en).toBe('Delivered');
    expect(startDayLabel({ startWord: 'birth' }).mr).toBe('जन्मतारीख');
    expect(startDayLabel({}).en).toBe('Started');
    // pregnancy-loss care counts from the day she was seen, as on the Care plan tab (carePlanFormat.js basisText)
    expect(startDayLabel({ startWord: 'loss' }).en).toBe('Seen');
    expect(DRAFT_PLAN_WORDS.mr).toMatch(DEVANAGARI);
    expect(DRAFT_PLAN_WORDS.hi).toMatch(DEVANAGARI);
  });

  it('names the copy in her language', () => {
    expect(patientCopyTitle({ scope: 'all' }, 'antenatal', 'mr')).toBe('गरोदरपणातील काळजीची योजना');
    expect(patientCopyTitle({ scope: 'all' }, 'newborn', 'hi')).toBe('शिशु की देखभाल और टीकाकरण योजना');
    expect(patientCopyTitle({ scope: 'kinds', kinds: ['visit'] }, 'antenatal', 'hi')).toBe('जाँचों की समय-सारिणी');
    expect(patientCopyTitle({ scope: 'kinds', kinds: ['scan', 'visit'] }, 'antenatal', 'mr')).toBe('तपासणी व सोनोग्राफीचे वेळापत्रक');
    expect(patientCopyTitle({ scope: 'kinds', kinds: ['vaccination', 'investigation', 'medication'] }, 'postnatal', 'mr')).toBe(
      'प्रसूतीनंतरच्या काळजीची योजना: प्रयोगशाळेतील चाचण्या, लसीकरण व औषधे',
    );
    expect(patientCopyTitle({ scope: 'items', ids: ['s1'] }, 'antenatal', 'hi')).toBe('गर्भावस्था की देखभाल योजना – चुनी हुई बातें');
    // A type of care without a copy title of its own
    expect(patientCopyTitle({ scope: 'all' }, 'not_a_type_of_care', 'mr')).toBe('काळजीची योजना');
    expect(patientCopyTitle({ scope: 'all' }, 'not_a_type_of_care')).toBe('Care plan');
    // Pregnancy-loss care has its own title, which never names the loss – in any language
    expect(patientCopyTitle({ scope: 'all' }, 'abortion')).toBe('Follow-up care plan');
    expect(patientCopyTitle({ scope: 'all' }, 'abortion', 'mr')).toBe('पुढील काळजीची योजना');
    expect(patientCopyTitle({ scope: 'all' }, 'abortion', 'hi')).toBe('आगे की देखभाल की योजना');
    expect(joinWords(['a', 'b', 'c'], 'और')).toBe('a, b और c');
  });

  it('says when and what is done in her language; the dates keep their usual format', () => {
    expect(patientWhen(items[0], 'mr')).toEqual({ when: '12–26 Oct 2026', weeks: '20–22 आठवडे' });
    expect(patientWhen(items[0], 'hi')).toEqual({ when: '12–26 Oct 2026', weeks: '20–22 हफ़्ते' });
    expect(patientWhen(items[1], 'mr')).toEqual({ when: 'लवकरात लवकर', weeks: '20 Sep 2026 पर्यंत करायचे होते' });
    expect(patientWhen(items[1], 'hi')).toEqual({ when: 'जल्द से जल्द', weeks: '20 Sep 2026 तक होना था' });
    expect(patientWhen(items[5], 'mr')).toEqual({ when: 'सुमारे 30 Oct 2026 पासून', weeks: '' });
    expect(patientWhen({ ...items[5], estimateFrom: null }, 'hi')).toEqual({ when: 'तारीख़ आपके डॉक्टर बताएँगे', weeks: '' });
    expect(patientDone(items[3], 'mr')).toBe('14 Aug 2026 रोजी झाली');
    expect(patientDone(items[3], 'hi')).toBe('14 Aug 2026 को हुई');
    expect(patientDone({ ...items[0], done: { ...doneOn('2026-09-17'), elsewhere: true } }, 'mr')).toBe('17 Sep 2026 रोजी झाली (इतर ठिकाणी)');
    expect(patientDone({ ...item('t1', 'vaccination', 'done'), done: doneOn('2026-09-17') }, 'hi')).toBe('17 Sep 2026 को दिया गया');
    expect(patientDone(items[0], 'mr')).toBe('');
    expect(plainWeeks({ weeks: 24, days: 3 })).toBe('24 weeks 3 days');
    expect(plainWeeks({ weeks: 24, days: 3 }, 'mr')).toBe('24 आठवडे 3 दिवस');
    expect(plainWeeks({ weeks: 24, days: 3 }, 'hi')).toBe('24 हफ़्ते 3 दिन');
    expect(plainWeeks(null, 'hi')).toBe('');
    const next = { next: { visit: { dueFrom: day('2026-10-12'), dueBy: day('2026-10-26'), status: 'upcoming' } } };
    expect(nextCheckUp(next, 'mr')).toBe('तुमची पुढील तपासणी: 12–26 Oct 2026.');
    expect(nextCheckUp(next, 'hi')).toBe('आपकी अगली जाँच: 12–26 Oct 2026।');
    expect(nextCheckUp({ next: { visit: { ...next.next.visit, status: 'overdue' } } }, 'hi')).toMatch(/अभी होनी है/);
  });

  it('translates an item only while its English is word for word the built-in one; what staff typed prints as typed', () => {
    const builtIn = { ...items[2], key: 'scan_anomaly', origin: 'template' }; // 'Detailed ultrasound of baby (18–20 weeks)'
    expect(patientWhatIn(builtIn, 'mr')).toBe('बाळाची सविस्तर सोनोग्राफी (18–20 आठवडे)');
    expect(patientWhatIn({ ...builtIn, patientText: 'Detailed ultrasound of baby (bring the earlier report)' }, 'mr')).toBeNull();
    expect(patientWhatIn({ ...builtIn, origin: 'custom', key: 'custom_0a1b2c3d' }, 'hi')).toBeNull();
    expect(patientWhatIn(builtIn, 'en')).toBeNull();
    const plan2 = {
      ...plan,
      items: [
        builtIn,
        { ...items[0], key: 'visit_20', origin: 'template' }, // 'Check-up at about 20 weeks'
        { ...items[6], key: 'adv_danger', origin: 'template' }, // reworded by the hospital: English only
        item('c1', 'investigation', 'due', { origin: 'custom', key: 'custom_0a1b2c3d', patientText: 'Sample test typed by the doctor' }),
      ],
    };
    const copy = patientCopy(plan2);
    expect(untranslatedCount(copy, 'en')).toBe(0);
    expect(untranslatedCount(copy, 'mr')).toBe(2);
    expect(untranslatedCount(copy, 'hi')).toBe(2);
  });

  it('ends with the note for her type of care; the English of a pregnancy is unchanged', () => {
    const PREGNANCY_NOTE =
      'The dates are a guide worked out from your due date; your doctor may change them. Bring this sheet to every visit. Come to the hospital at once for bleeding, severe headache, blurred vision, fits, fever, leaking of water or reduced movements of the baby.';
    // A pregnancy: word for word the note every patient copy printed before (also a plan from before types of care)
    expect(patientNote({ ...base, careType: 'antenatal', items: [] })).toBe(PREGNANCY_NOTE);
    expect(patientNote({ ...base, items: [] })).toBe(PREGNANCY_NOTE);
    expect(patientNote({ ...base, careType: 'antenatal', items: [] }, 'mr')).toMatch(/^या तारखा तुमच्या प्रसूतीच्या अंदाजे तारखेवरून.*लगेच रुग्णालयात या\.$/);

    // After a delivery and for a baby: the danger signs of the plan's own danger-sign advice item, as the plan has them
    const advice = (key, patientText, extra = {}) => item(key, 'advice', 'due', { origin: 'template', key, patientText, ...extra });
    const PNC = 'Come at once for heavy bleeding, fever, bad-smelling discharge, severe headache or breathlessness';
    const postnatal = { ...base, careType: 'postnatal', items: [advice('pnc_adv_bf', 'Give only breast milk for the first 6 months'), advice('pnc_adv_danger', PNC)] };
    expect(patientNote(postnatal)).toBe(`The dates are a guide worked out from the day of delivery; your doctor may change them. Bring this sheet to every visit. ${PNC}.`);
    expect(patientNote(postnatal, 'mr')).toBe(
      'या तारखा प्रसूतीच्या दिवसावरून काढलेल्या आहेत; तुमचे डॉक्टर त्या बदलू शकतात. प्रत्येक तपासणीला हा कागद घेऊन या. जास्त रक्तस्राव, ताप, दुर्गंधीयुक्त स्राव, तीव्र डोकेदुखी किंवा धाप लागल्यास लगेच या.',
    );
    expect(patientNote(postnatal, 'hi')).toMatch(/तुरंत आएँ।$/);
    const NB = 'Come at once if the baby feeds poorly, breathes fast, is hot or cold, turns yellow or has fits';
    const newborn = { ...base, careType: 'newborn', items: [advice('nb_adv_danger', NB, { status: 'missed', done: doneOn('2026-09-20') })] };
    expect(patientNote(newborn)).toBe(`The dates are a guide worked out from the baby’s date of birth; your doctor may change them. Bring this sheet to every visit. ${NB}.`);

    // The doctor changed the danger signs in the template: the note says the doctor's words (in English, as typed);
    // Marathi and Hindi end with the general line
    const edited = 'Come at once for heavy bleeding, fever, fits, blurred vision or pain in the calf.';
    const reworded = { ...postnatal, items: [advice('pnc_adv_danger', edited)] };
    expect(patientNote(reworded)).toBe(`The dates are a guide worked out from the day of delivery; your doctor may change them. Bring this sheet to every visit. ${edited}`);
    expect(patientNote(reworded, 'mr')).toMatch(/घेऊन या\. आणीबाणीच्या वेळी लगेच रुग्णालयात जा\.$/);
    expect(patientNote(reworded, 'hi')).toMatch(/साथ लाएँ। आपात स्थिति में तुरंत अस्पताल जाएँ।$/);

    // No such item (a doctor's own protocol without it, "does not apply", "not needed", an item a doctor added with
    // that code's words): the general line
    const GENERAL = 'In an emergency, go to the hospital straight away.';
    for (const items of [
      [],
      [advice('pnc_adv_danger', PNC, { status: 'not_applicable' })],
      [advice('pnc_adv_danger', PNC, { status: 'not_needed', notNeeded: { reason: 'Sample reason' } })],
      [advice('pnc_adv_danger', '')],
      [advice('custom_0a1b2c3d', PNC, { origin: 'custom' })],
    ]) {
      expect(patientNote({ ...postnatal, items })).toBe(`The dates are a guide worked out from the day of delivery; your doctor may change them. Bring this sheet to every visit. ${GENERAL}`);
    }
    // Any other care: the general line – never the pregnancy's or a baby's danger signs
    for (const careType of ['gynaecology', 'infertility', 'abortion']) {
      const note = patientNote({ ...base, careType, items: [advice('nb_adv_danger', NB)] });
      expect(note, careType).toBe(`The dates are a guide worked out from the day this plan started; your doctor may change them. Bring this sheet to every visit. ${GENERAL}`);
      expect(patientNote({ ...base, careType, items: [] }, 'mr')).toMatch(/आणीबाणीच्या वेळी लगेच रुग्णालयात जा\.$/);
    }
    for (const plan of [postnatal, newborn, reworded, { ...base, careType: 'gynaecology', items: [] }]) {
      for (const lang of ['mr', 'hi']) {
        expect(patientNote(plan, lang), `${plan.careType}.${lang}`).toMatch(DEVANAGARI);
        expect(patientNote(plan, lang)).not.toMatch(/[A-Za-z]{3}/);
      }
    }
  });
});
