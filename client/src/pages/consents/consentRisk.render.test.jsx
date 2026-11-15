// A consent form on paper with the patient's high-risk factors (rendered to HTML, no browser): where the section
// stands, what it says in each language, and when the page says DRAFT. Fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsentPrintDocument, ConsentRiskSection } from './ConsentDocument.jsx';

const SECTION = {
  heading: { en: 'High-risk factors in this patient', mr: 'या रुग्णातील जोखमीचे घटक', hi: 'इस रोगी में जोखिम के कारक' },
  intro: { en: 'It has been explained to me that the following high-risk factors are present.', mr: 'मला समजावून सांगण्यात आले आहे.', hi: 'मुझे समझाया गया है।' },
  complications: { en: 'Possible complications', mr: 'संभाव्य गुंतागुंत', hi: 'संभावित जटिलताएँ' },
  other: { en: 'Other risk factors and their complications', mr: 'इतर जोखमीचे घटक व त्यांची गुंतागुंत', hi: 'अन्य जोखिम के कारक और उनकी जटिलताएँ' },
};
const CAESAREAN = {
  id: 'previous_caesarean',
  level: 'high',
  name: { en: 'Previous caesarean section', mr: 'आधीची सिझेरियन शस्त्रक्रिया', hi: 'पहले हुआ सिज़ेरियन ऑपरेशन' },
  complications: { en: 'the old scar on the uterus can open.', mr: 'गर्भाशयावरील जुना व्रण उघडू शकतो.', hi: 'बच्चेदानी का पुराना निशान खुल सकता है।' },
};
const OWN_RULE = { id: 'rule:rule_ab12', level: 'high', name: { en: 'IVF pregnancy', mr: '', hi: '' }, complications: null };
const risk = (over = {}) => ({ section: SECTION, rows: [CAESAREAN, OWN_RULE], other: 'Fibroid – more bleeding', version: 1, approved: false, ...over });

const FORM = {
  kind: 'consent',
  title: { en: 'General consent for admission and treatment', mr: 'दाखल होण्यासाठी संमती', hi: 'भर्ती के लिए सहमति' },
  status: 'approved',
  version: 2,
  approvedByName: 'Dr. Meera Sample',
  approvedAt: '2026-10-01T06:00:00.000Z',
  clauses: [{ en: 'I consent to the admission of {patient}.', mr: '{patient} यांना दाखल करण्यास मी संमती देते.', hi: 'मैं {patient} की भर्ती के लिए सहमति देती हूँ।' }],
};
const PATIENT = { fullName: 'Asha Sample', mrn: 'P-000001', careType: 'antenatal', currentAge: 38 };
const doc = (props) =>
  renderToStaticMarkup(
    <ConsentPrintDocument
      form={FORM}
      lang="mr"
      patient={PATIENT}
      letterhead={{ name: 'Sample Maternity Hospital' }}
      values={{ patient: PATIENT.fullName, age: 38, mrn: PATIENT.mrn }}
      doctor={null}
      printedAt={new Date('2026-11-14T06:00:00.000Z')}
      printedByName="Dr. Meera Sample"
      {...props}
    />,
  ).replace(/&#x27;/g, "'");
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe("a consent form with the patient's high-risk factors", () => {
  it('prints them before the clauses, each with its complications in both languages', () => {
    const out = doc({ risk: risk() });
    const words = text(out);
    expect(out.indexOf('pdoc-risk')).toBeGreaterThan(-1);
    expect(out.indexOf('High-risk factors in this patient')).toBeLessThan(out.indexOf('I consent to the admission of'));
    expect(words).toContain('High-risk factors in this patient / या रुग्णातील जोखमीचे घटक');
    expect(words).toContain('Previous caesarean section – Possible complications: the old scar on the uterus can open.');
    expect(words).toContain('आधीची सिझेरियन शस्त्रक्रिया – संभाव्य गुंतागुंत: गर्भाशयावरील जुना व्रण उघडू शकतो.');
    expect(words).toContain('Other risk factors and their complications : Fibroid – more bleeding');
    expect(words).toContain('इतर जोखमीचे घटक व त्यांची गुंतागुंत : Fibroid – more bleeding');
    // A rule of the hospital's own: its name as written, and a line to write the complications on
    expect((out.match(/IVF pregnancy/g) ?? []).length).toBe(2);
    expect((out.match(/class="pdoc-line"/g) ?? []).length).toBe(2);
  });

  it('prints English only when that was chosen, and in Hindi next to English', () => {
    const en = text(doc({ lang: 'en', risk: risk() }));
    expect(en).toContain('Previous caesarean section – Possible complications');
    expect(en).not.toMatch(/[ऀ-ॿ]/);
    expect(text(doc({ lang: 'hi', risk: risk() }))).toContain('पहले हुआ सिज़ेरियन ऑपरेशन – संभावित जटिलताएँ: बच्चेदानी का पुराना निशान खुल सकता है।');
  });

  it('says DRAFT while the wording of the risk factors is not approved, and not once it is', () => {
    expect(text(doc({ risk: risk() }))).toContain('DRAFT – the wording of the high-risk factors on this form is not approved by the hospital.');
    expect(text(doc({ risk: risk() }))).toContain('high-risk factors wording version 1 (draft)');
    const approved = text(doc({ risk: risk({ approved: true }) }));
    expect(approved).not.toContain('DRAFT');
    expect(approved).toContain('high-risk factors wording version 1 (approved)');
    // A draft form says so in its own words
    const draftForm = text(doc({ form: { ...FORM, status: 'draft' }, risk: risk({ approved: true }) }));
    expect(draftForm).toContain('DRAFT – not approved by the hospital.');
  });

  it('leaves the form as it was when no risk factor is printed', () => {
    const out = doc({});
    expect(out).not.toContain('pdoc-risk');
    expect(text(out)).not.toContain('DRAFT');
    expect(text(out)).not.toContain('high-risk factors wording');
    expect(renderToStaticMarkup(<ConsentRiskSection risk={{ section: SECTION, rows: [], other: '' }} lang="mr" />)).toBe('');
    expect(renderToStaticMarkup(<ConsentRiskSection risk={null} lang="mr" />)).toBe('');
  });
});
