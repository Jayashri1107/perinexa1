// Inpatient documents (Version 2): form ↔ content, and how a document reads (rendered to HTML, no browser).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocContent, DocPrintDocument, toContent, toForm } from './DocumentPage.jsx';
import { DISCHARGE_FIELD_WORDS, DISCHARGE_WORDS } from './dischargeWords.js';
import { DOC_FIELDS } from './docFields.js';
import { docStatusLook } from './inpatientFormat.js';

const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('inpatient documents', () => {
  it('every kind keeps what was written through the form and back', () => {
    const discharge = {
      dischargedAt: '2026-10-03T05:30:00.000Z',
      finalDiagnosis: 'Delivered by LSCS',
      course: '',
      procedures: 'LSCS',
      conditionAtDischarge: 'Well',
      medicines: [{ drug: 'Iron', form: 'tab', strength: '', dose: '1', frequency: '1-0-0', frequencyText: '', timing: 'after_food', route: '', durationValue: 30, durationUnit: 'days', instructions: '' }],
      advice: 'Rest',
      followUpOn: '2026-10-10',
      followUpNote: 'Stitch check',
    };
    const back = toContent('discharge', toForm('discharge', discharge));
    expect(back).toMatchObject({ dischargedAt: '2026-10-03T05:30:00.000Z', followUpOn: '2026-10-10', finalDiagnosis: 'Delivered by LSCS' });
    expect(back.medicines).toEqual([expect.objectContaining({ drug: 'Iron', frequency: '1-0-0', durationValue: 30, durationUnit: 'days' })]);
    for (const kind of Object.keys(DOC_FIELDS)) expect(Object.keys(toContent(kind, toForm(kind, {})))).toEqual(DOC_FIELDS[kind].map((f) => f.key));
  });

  it('reads as words: the delivery with the baby, the discharge with its medicines', () => {
    const delivery = text(<DocContent kind="delivery" content={{ deliveredAt: '2026-10-01T05:30:00.000Z', mode: 'lscs', indication: 'Fetal distress', bloodLossMl: 600, babies: [{ sex: 'female', weightGrams: 3100, apgar1: 8, apgar5: 9, outcome: 'live' }] }} />);
    expect(delivery).toContain('Caesarean section (LSCS)');
    expect(delivery).toContain('Live birth · Female · 3100 g · Apgar 8/9');
    expect(delivery).toContain('600 ml');
    const discharge = text(<DocContent kind="discharge" content={{ finalDiagnosis: 'Delivered', medicines: [{ drug: 'Iron', form: 'tab', dose: '1', frequency: '1-0-0', durationValue: 30, durationUnit: 'days' }] }} />);
    expect(discharge).toContain('Medicines on discharge');
    expect(discharge).toMatch(/1\. .*Iron/i);
    expect(text(<DocContent kind="round" content={{}} />)).toContain('Nothing written yet.');
  });

  it('the status: a draft that a doctor must confirm says so', () => {
    expect(docStatusLook({ kind: 'delivery', status: 'draft' }).word).toBe('Draft – waiting for a doctor');
    expect(docStatusLook({ kind: 'round', status: 'draft' }).word).toBe('Draft');
    expect(docStatusLook({ kind: 'discharge', status: 'signed' }).word).toBe('Confirmed');
    expect(docStatusLook({ kind: 'round', status: 'signed' }).word).toBe('Signed');
  });
});

// The printed discharge card in English with Marathi or Hindi (5 Oct 2026); every other document stays in English.
describe('the printed discharge card in Marathi or Hindi', () => {
  const DEVANAGARI = /[\u0900-\u097F]/;
  const patient = { fullName: 'Sample Mother', mrn: 'P-000003', currentAge: 27, careType: 'postnatal' };
  const admission = { admittedAt: '2026-10-01T02:00:00.000Z', dischargedAt: '2026-10-04T05:30:00.000Z', ward: 'Postnatal ward', bed: '3' };
  const card = {
    kind: 'discharge',
    status: 'signed',
    signed: { byName: 'Dr. Meera Sample', at: '2026-10-04T05:30:00.000Z' },
    additions: [{ id: 'x1', text: 'Sample correction typed by the doctor', byName: 'Dr. Meera Sample', at: '2026-10-04T06:00:00.000Z' }],
    content: {
      dischargedAt: '2026-10-04T05:30:00.000Z',
      finalDiagnosis: 'Sample diagnosis typed by the doctor',
      advice: 'Sample advice typed by the doctor',
      followUpOn: '2026-10-11',
      medicines: [{ drug: 'Iron', form: 'tab', dose: '1', frequency: '1-0-1', timing: 'after_food', durationValue: 30, durationUnit: 'days', instructions: 'Sample own instruction' }],
    },
  };
  const page = (document) => ({ document, admission, signer: { name: 'Dr. Meera Sample', professional: { registrationNumber: 'MMC-000000' } } });
  const html = (document, lang) =>
    renderToStaticMarkup(<DocPrintDocument patient={patient} page={page(document)} letterhead={{ name: 'Sample Hospital' }} printedAt={new Date('2026-10-05T06:00:00Z')} printedByName="Sample nurse" lang={lang} />);
  const inLang = (markup, lang) => [...markup.matchAll(new RegExp(`<([a-z0-9]+)[^>]*lang="${lang}"[^>]*>(.*?)</\\1>`, 'g'))].map((m) => m[2].replace(/<[^>]+>/g, ''));

  it('has a Marathi and a Hindi word for every part of the card', () => {
    for (const f of DOC_FIELDS.discharge) {
      expect(DISCHARGE_FIELD_WORDS[f.key]?.en, f.key).toBe(f.label);
      for (const lang of ['mr', 'hi']) expect(DISCHARGE_FIELD_WORDS[f.key][lang], `${f.key}.${lang}`).toMatch(DEVANAGARI);
    }
    for (const [key, w] of Object.entries(DISCHARGE_WORDS)) for (const lang of ['mr', 'hi']) expect(w[lang], `${key}.${lang}`).toMatch(DEVANAGARI);
  });

  it('prints the card’s own words and each medicine’s dose, timing and duration in Hindi; what the doctor wrote as typed', () => {
    const out = html(card, 'hi');
    expect(out).not.toContain('lang="mr"');
    const hindi = inLang(out, 'hi');
    expect(hindi).toEqual(expect.arrayContaining(['डिस्चार्ज कार्ड (अस्पताल से छुट्टी)', 'आयु', 'अंतिम निदान', 'घर पर लेने की दवाइयाँ', 'सलाह', 'दोबारा जाँच की तारीख़', 'सुधार और जोड़']));
    expect(hindi.some((t) => t.startsWith('1 गोली · 1-0-1') && t.includes('30 दिन तक'))).toBe(true);
    const words = text(<DocPrintDocument patient={patient} page={page(card)} letterhead={{ name: 'Sample Hospital' }} printedAt={new Date('2026-10-05T06:00:00Z')} printedByName="Sample nurse" lang="hi" />);
    expect(words).toContain('Final diagnosis / अंतिम निदान Sample diagnosis typed by the doctor');
    expect(words).toContain('Sample advice typed by the doctor');
    expect(words).toContain('(Sample own instruction)');
    expect(words).toContain('Sample correction typed by the doctor');
    expect(words).toContain('Bed 3 / बिस्तर 3');
    for (const typed of ['Sample diagnosis', 'Sample advice', 'Sample own instruction', 'Sample correction', 'Postnatal ward']) expect(hindi.join(' ')).not.toContain(typed);
  });

  it('a draft card says it is a draft in both languages; in English only, nothing changes', () => {
    const draft = { ...card, status: 'draft', signed: null, additions: [] };
    const out = html(draft, 'mr');
    expect(inLang(out, 'mr')).toEqual(expect.arrayContaining(['मसुदा – डॉक्टरांनी अजून निश्चित केलेले नाही.', 'अजून सही झालेली नाही.']));
    expect(html(card, 'en')).not.toMatch(DEVANAGARI);
    expect(html(draft, 'en')).not.toMatch(DEVANAGARI);
  });

  it('every other document is a staff document: English only, whatever is asked', () => {
    const round = { kind: 'round', status: 'signed', signed: { byName: 'Sample rmo', at: '2026-10-02T05:00:00.000Z' }, additions: [], content: { at: '2026-10-02T05:00:00.000Z', assessment: 'Stable' } };
    expect(html(round, 'mr')).not.toMatch(DEVANAGARI);
    expect(html({ ...round, kind: 'admission', content: { reason: 'Sample' } }, 'hi')).not.toMatch(DEVANAGARI);
  });
});
