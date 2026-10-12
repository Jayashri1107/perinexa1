// The patient copy of the care plan on paper (rendered to HTML, no browser), in English and with Marathi or Hindi
// under the English (5 Oct 2026). Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PatientCopy } from './CarePlanPrint.jsx';

const day = (s) => `${s}T00:00:00.000Z`;
const item = (id, kind, extra = {}) => ({
  id,
  kind,
  status: 'upcoming',
  name: `${kind} ${id}`,
  patientText: '',
  origin: 'template',
  key: id,
  timing: { atBooking: false, fromWeek: 20, toWeek: 22, after: { key: null, weeks: null } },
  timingText: '20–22 w',
  due: { from: day('2026-10-12'), to: day('2026-10-26') },
  gaWindow: { from: { weeks: 20, days: 0 }, to: { weeks: 22, days: 0 } },
  done: null,
  notNeeded: null,
  ...extra,
});
const PLAN = {
  careType: 'antenatal',
  status: 'active',
  today: day('2026-10-05'),
  edd: day('2027-03-01'),
  gestationToday: { weeks: 19, days: 0 },
  next: { visit: { dueFrom: day('2026-10-12'), dueBy: day('2026-10-26'), status: 'upcoming' } },
  items: [
    item('visit_20', 'visit', { patientText: 'Check-up at about 20 weeks' }),
    item('scan_anomaly', 'scan', { patientText: 'Detailed ultrasound of baby (18–20 weeks)', due: { from: day('2026-10-19'), to: day('2026-10-26') } }),
    // A built-in item whose wording a doctor changed in the template: printed as typed
    item('lab_urine', 'investigation', { patientText: 'Urine test (bring a morning sample)' }),
    // An item a doctor added to this plan, with the very words of a built-in item: printed as typed
    item('custom_0a1b2c3d', 'investigation', { origin: 'custom', patientText: 'Blood group test' }),
    item('adv_fmc', 'advice', { status: 'due', patientText: 'Count your baby’s movements every day' }),
    item('lab_hiv', 'investigation', { status: 'done', patientText: 'HIV test', done: { on: day('2026-09-17'), elsewhere: false, result: 'Sample result', note: 'Sample note' } }),
  ],
};
const PATIENT = { fullName: 'Sample Mother', mrn: 'P-000003', currentAge: 28, careType: 'antenatal', assignedDoctorName: 'Dr. Meera Sample' };
const ADVICE = 'Sample advice typed by the doctor: rest after lunch';
const html = (lang, options = {}) =>
  renderToStaticMarkup(<PatientCopy patient={PATIENT} plan={PLAN} options={{ scope: 'all', kinds: [], ids: [], includeDone: true, advice: ADVICE, ...options }} lang={lang} />)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
// Tags removed (not replaced by spaces): words read as on paper
const text = (markup) => markup.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const DEVANAGARI = /[ऀ-ॿ]/;
// What is printed in a language, in the order of the page
const inLang = (markup, lang) => [...markup.matchAll(new RegExp(`<([a-z0-9]+)[^>]*lang="${lang}"[^>]*>(.*?)</\\1>`, 'g'))].map((m) => text(m[2]));

describe('the patient copy of the care plan', () => {
  it('in English only: no Marathi or Hindi anywhere, as before', () => {
    const out = html('en');
    expect(out).not.toMatch(DEVANAGARI);
    const words = text(out);
    expect(words).toContain('Pregnancy care plan');
    expect(words).toContain('What is planned');
    expect(words).toContain('Your next check-up: 12–26 Oct 2026.');
    expect(words).toContain(`From your doctor: ${ADVICE}`);
  });

  it('in Marathi: the page’s words and the unchanged built-in items under the English, in Marathi', () => {
    const out = html('mr');
    expect(out).not.toContain('lang="hi"');
    const marathi = inLang(out, 'mr');
    // The title, the labels and the table headings
    expect(marathi).toEqual(expect.arrayContaining(['गरोदरपणातील काळजीची योजना', 'नाव', 'वय', 'प्रसूतीची अंदाजे तारीख (EDD)', 'पुढे काय करायचे आहे', 'केव्हा', 'काय', 'सल्ला']));
    expect(text(out)).toContain('Weeks of pregnancy today / आज गरोदरपणाचे आठवडे');
    expect(text(out)).toContain('19 weeks 0 days / 19 आठवडे 0 दिवस');
    expect(text(out)).toContain('28 yrs / 28 वर्षे');
    // The built-in items nobody reworded, and their weeks and dates
    expect(marathi).toEqual(expect.arrayContaining(['सुमारे 20 आठवड्यांची तपासणी', 'बाळाची सविस्तर सोनोग्राफी (18–20 आठवडे)', 'बाळाच्या हालचाली रोज मोजा', 'एचआयव्ही (HIV) तपासणी', '20–22 आठवडे']));
    expect(marathi).toContain('तुमची पुढील तपासणी: 12–26 Oct 2026.');
    expect(marathi).toContain('17 Sep 2026 रोजी झाली');
    // Reworded or added by a doctor: printed as typed, with no translation of other words
    expect(marathi).not.toContain('लघवीची तपासणी');
    expect(marathi).not.toContain('रक्तगटाची तपासणी');
    expect(text(out)).toContain('Urine test (bring a morning sample)');
    expect(text(out)).toContain('Blood group test');
    // The doctor's advice prints as typed, after a bilingual label
    expect(text(out)).toContain(`From your doctor / तुमच्या डॉक्टरांचा सल्ला: ${ADVICE}`);
    // The note at the end, in both languages
    expect(text(out)).toContain('Bring this sheet to every visit.');
    expect(marathi.at(-1)).toMatch(/^या तारखा तुमच्या प्रसूतीच्या अंदाजे तारखेवरून/);
    // Nothing for staff: never the result or the note of a done item
    expect(text(out)).not.toMatch(/Sample result|Sample note/);
  });

  it('prints "—" for the weeks of pregnancy today when they are not known, in English and in Marathi', () => {
    const unknown = { ...PLAN, gestationToday: null };
    for (const lang of ['en', 'mr']) {
      const out = text(renderToStaticMarkup(<PatientCopy patient={PATIENT} plan={unknown} options={{ scope: 'all', kinds: [], ids: [], includeDone: false, advice: '' }} lang={lang} />));
      expect(out, lang).toMatch(lang === 'en' ? /Weeks of pregnancy today—/ : /Weeks of pregnancy today \/ आज गरोदरपणाचे आठवडे—/);
    }
  });

  it('in English after a delivery and for a baby: the dates count from the delivery or the birth, and the danger signs are the plan’s own', () => {
    const PNC = 'Come at once for heavy bleeding, fever, bad-smelling discharge, severe headache or breathlessness';
    const NB = 'Come at once if the baby feeds poorly, breathes fast, is hot or cold, turns yellow or has fits';
    const copyOf = (careType, items, patient = PATIENT) =>
      renderToStaticMarkup(
        <PatientCopy
          patient={{ ...patient, careType }}
          plan={{ careType, status: 'active', today: day('2026-10-05'), startOn: day('2026-10-01'), dayZero: day('2026-10-01'), next: null, items }}
          options={{ scope: 'all', kinds: [], ids: [], includeDone: false, advice: '' }}
          lang="en"
        />,
      ).replace(/&#x27;/g, "'");
    const advice = (key, patientText) => item(key, 'advice', { status: 'due', patientText });
    const postnatal = text(copyOf('postnatal', [item('pnc_visit_1', 'visit', { patientText: 'Check-up 1 week after delivery' }), advice('pnc_adv_danger', PNC)]));
    expect(postnatal).toContain('The dates are a guide worked out from the day of delivery; your doctor may change them. Bring this sheet to every visit.');
    expect(postnatal).toContain(`Bring this sheet to every visit. ${PNC}.`);
    expect(postnatal).not.toMatch(/due date|reduced movements/);
    expect(postnatal).not.toMatch(DEVANAGARI);
    // A hospital that changed the danger signs in its template: the note says the same as the Advice box
    const edited = 'Come at once for heavy bleeding, fever, fits, blurred vision or pain in the calf';
    const own = copyOf('postnatal', [advice('pnc_adv_danger', edited)]);
    expect(text(own)).toContain(`Bring this sheet to every visit. ${edited}.`);
    expect(text(own)).not.toContain(PNC);
    const newborn = text(copyOf('newborn', [advice('nb_adv_danger', NB)], { ...PATIENT, newborn: { birthAt: day('2026-10-01') } }));
    expect(newborn).toContain(`The dates are a guide worked out from the baby’s date of birth; your doctor may change them. Bring this sheet to every visit. ${NB}.`);
    expect(newborn).not.toMatch(/due date|reduced movements/);
    // Gynaecology: the general line, no danger signs of a pregnancy
    const gynae = text(copyOf('gynaecology', [item('gyn_visit', 'visit', { patientText: 'Sample check-up' })]));
    expect(gynae).toContain('The dates are a guide worked out from the day this plan started; your doctor may change them. Bring this sheet to every visit. In an emergency, go to the hospital straight away.');
    expect(gynae).not.toMatch(/due date|reduced movements/);
  });

  it('in Marathi for pregnancy-loss care: never names the loss, and its items print in English (merge of 5 Oct 2026)', () => {
    const STAFF_NAME = 'Sample staff name of an item a doctor added';
    const out = renderToStaticMarkup(
      <PatientCopy
        patient={{ ...PATIENT, careType: 'abortion' }}
        plan={{
          careType: 'abortion',
          startWord: 'loss',
          status: 'active',
          today: day('2026-10-05'),
          startOn: day('2026-10-01'),
          dayZero: day('2026-10-01'),
          next: null,
          items: [
            item('loss_hb', 'investigation', { patientText: 'Blood test for haemoglobin' }),
            // added by a doctor with no words for her: the neutral words, never its staff name
            item('custom_0a1b2c3e', 'investigation', { origin: 'custom', name: STAFF_NAME, patientText: '' }),
          ],
        }}
        options={{ scope: 'all', kinds: [], ids: [], includeDone: false, advice: '' }}
        lang="mr"
      />,
    ).replace(/&#x27;/g, "'");
    const words = text(out);
    const marathi = inLang(out, 'mr');
    expect(words).toContain('Follow-up care plan');
    expect(marathi[0]).toBe('पुढील काळजीची योजना');
    expect(words).toContain('Seen / तपासणीची तारीख');
    expect(words).toContain('Check-up or test – your doctor will explain');
    expect(words).not.toContain(STAFF_NAME);
    // The pregnancy-loss template has no Marathi yet: its item prints in English only
    expect(words).toContain('Blood test for haemoglobin');
    expect(marathi.join(' ')).not.toContain('हिमोग्लोबिन');
    expect(words).toContain('The dates are a guide worked out from the day this plan started; your doctor may change them. Bring this sheet to every visit. In an emergency, go to the hospital straight away.');
    expect(words).not.toMatch(/due date|reduced movements/);
  });

  it('in Hindi: the same, in Hindi', () => {
    const out = html('hi', { scope: 'kinds', kinds: ['scan'] });
    expect(out).not.toContain('lang="mr"');
    const hindi = inLang(out, 'hi');
    expect(text(out)).toContain('Sonography (scan) schedule');
    expect(hindi[0]).toBe('सोनोग्राफ़ी की समय-सारिणी');
    expect(hindi).toContain('शिशु की विस्तृत सोनोग्राफ़ी (18–20 हफ़्ते)');
    // Only scans were chosen: no check-up line, no other item
    expect(text(out)).not.toContain('Your next check-up');
    expect(hindi).not.toContain('लगभग 20 हफ़्ते पर जाँच');
  });
});
