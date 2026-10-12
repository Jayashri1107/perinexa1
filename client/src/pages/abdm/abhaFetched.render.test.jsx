// Her records from other hospitals on the screen (rendered to HTML, no browser): the list of documents, the requests
// with each status as colour, icon and word, the practice buttons only in practice mode, and a document read-only
// with what was withheld and its files. Made-up data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentView, FetchedTable, RequestsList } from './AbhaFetched.jsx';

const html = (node) => renderToStaticMarkup(node).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const AT = '2026-10-05T06:00:00.000Z';

const DOCS = [
  { id: 'd1', hiType: 'DiagnosticReport', typeText: '', title: 'Diagnostic report', date: '2026-09-15T06:00:00Z', hospital: 'Sample Town Lab (practice)', receivedAt: AT, expiresAt: '2026-11-04T06:00:00Z', withheld: 0, files: 0, filesLeftOut: 0, practice: true },
  { id: 'd2', hiType: 'OPConsultation', typeText: '', title: 'Consultation report', date: '2026-08-26T05:00:00Z', hospital: 'Sample City Hospital (practice)', receivedAt: AT, expiresAt: '2026-11-04T06:00:00Z', withheld: 1, files: 1, filesLeftOut: 1, practice: true },
];

const REQUESTS = [
  { id: 'r1', at: AT, byName: 'Dr Sample', purpose: 'Care management', hiTypes: ['OPConsultation'], from: '2025-10-05T06:00:00Z', to: AT, days: 30, expiresAt: '2026-11-04T06:00:00Z', status: 'waiting', error: null, practice: true, hospitals: [] },
  {
    id: 'r2',
    at: AT,
    byName: 'Dr Sample',
    purpose: 'Care management',
    hiTypes: ['OPConsultation', 'DiagnosticReport'],
    from: '2025-10-05T06:00:00Z',
    to: AT,
    days: 30,
    expiresAt: '2026-11-04T06:00:00Z',
    status: 'granted',
    error: null,
    practice: true,
    hospitals: [
      { consentId: 'c1', hipName: 'Sample City Hospital (practice)', status: 'GRANTED', step: 'received', documents: 3, files: 1, filesLeftOut: 1, withheld: 1, failed: 0, expiresAt: '2026-11-04T06:00:00Z', canFetchAgain: false },
      { consentId: 'c2', hipName: 'Sample Town Lab (practice)', status: 'GRANTED', step: 'failed', error: 'Sample reason.', documents: 0, files: 0, filesLeftOut: 0, withheld: 0, failed: 0, expiresAt: '2026-11-04T06:00:00Z', canFetchAgain: true },
    ],
  },
];

describe('her records from other hospitals', () => {
  it('the documents received: date, type, hospital, title; "Part withheld" as colour, icon and word; files; practice ones marked', () => {
    const out = html(<FetchedTable documents={DOCS} />);
    const words = text(out);
    expect(words).toContain('15 Sep 2026 Lab or scan report Sample Town Lab (practice) Diagnostic report Practice – made up');
    expect(words).toContain('26 Aug 2026 Consultation Sample City Hospital (practice) Consultation report Practice – made up Part withheld 1 file to download');
    expect(out).toMatch(/<span class="pill pill-watch"><svg/);
    expect(out).toContain('aria-label="Read Consultation of 26 Aug 2026 from Sample City Hospital (practice)"');
    expect(text(html(<FetchedTable documents={[]} />))).toBe('No records from other hospitals yet.');
    // Not from practice mode: no practice mark; a document with no date of its own says so (never the day it came)
    const real = html(<FetchedTable documents={[{ ...DOCS[0], practice: false, date: null }]} />);
    expect(text(real)).toContain('Date not given Lab or scan report Sample Town Lab (practice) Diagnostic report');
    expect(text(real)).not.toContain('Practice – made up');
    expect(real).toContain('aria-label="Read Lab or scan report (date not given) from Sample Town Lab (practice)"');
  });

  it('the requests with her answer and each hospital; "Fetch again" for her doctor; practice buttons only in practice mode', () => {
    const out = html(<RequestsList requests={REQUESTS} canAsk practice />);
    const words = text(out);
    expect(words).toContain('Care management · practice Consultation · records of 5 Oct 2025 to 5 Oct 2026 · consent for 30 days · asked by Dr Sample');
    expect(words).toContain('Waiting for her answer');
    expect(words).toContain('Practice: she approves');
    expect(words).toContain('Practice: she refuses');
    expect(words).toContain('She agreed 2 hospitals answered. Records kept until 4 Nov 2026, then deleted.');
    expect(words).toContain('Sample City Hospital (practice) 3 documents received 1 file to download, 1 file not offered, 1 sentence withheld (PC-PNDT).');
    expect(words).toContain('Sample Town Lab (practice) Not received Sample reason. Fetch again');
    expect(words).toContain('Practice: she withdraws her consent');
    expect(words).toContain('Practice: her consent ends now');
    expect(out.match(/<span class="pill[^"]*"><svg/g)).toHaveLength(4); // every status has its icon
    // Another doctor (reads only), and outside practice mode: no buttons
    const reader = text(html(<RequestsList requests={REQUESTS} practice />));
    expect(reader).not.toContain('Fetch again');
    expect(reader).not.toContain('Practice:');
    expect(text(html(<RequestsList requests={REQUESTS} canAsk />))).not.toContain('Practice:');
    expect(text(html(<RequestsList requests={[]} />))).toBe('Nothing asked for yet.');
    expect(out).not.toMatch(/!/);
  });

  it('a document, read-only: its facts, its lines, where a sentence was withheld, its files and those not offered', () => {
    const doc = {
      ...DOCS[1],
      documentHospital: 'Sample City Hospital (practice)',
      authors: ['Dr Practice Sample'],
      nameInDocument: 'Sample Abha Mother',
      checksumOk: true,
      truncated: false,
      sections: [
        { title: 'Physical examination', lines: [{ text: 'Weight: 61 kg', withheld: 0, sub: false }, { text: 'Examination: Pallor present.', withheld: 1, sub: false }] },
        { title: 'Lab results', lines: [{ text: 'Complete blood count (CBC)', withheld: 0, sub: false }, { text: 'Haemoglobin: 10.1 g/dL (Low)', withheld: 0, sub: true }] },
      ],
      files: [{ id: 'f1', title: 'Practice report.pdf', contentType: 'application/pdf', size: 785 }],
      filesLeftOut: [{ title: 'Practice web page', contentType: 'text/html', why: 'type' }],
    };
    const out = html(<DocumentView document={doc} />);
    const words = text(out);
    // Made up in practice mode: said first, so it is never taken as hers
    expect(words).toMatch(/^Practice – made up by Perinexa's practice mode, not her records\. Do not act on it\. Read-only – as the other hospital sent it\. Not part of her records at this hospital, and never sent on\. Deleted on 4 Nov 2026, when her consent ends\./);
    expect(text(html(<DocumentView document={{ ...doc, practice: false }} />))).toMatch(/^Read-only – as the other hospital sent it\./);
    // The other hospital's own status of the document
    expect(text(html(<DocumentView document={{ ...doc, practice: false, documentStatus: 'entered-in-error' }} />))).toMatch(/^The other hospital marked this whole document as entered in error: it is not valid\. Do not act on it\./);
    expect(html(<DocumentView document={{ ...doc, practice: false, documentStatus: 'entered-in-error' }} />)).toContain('class="alert alert-error"');
    expect(words).toContain("1 sentence withheld: it may mention a baby's sex (PC-PNDT Act).");
    expect(words).toContain('Type Consultation Date 26 Aug 2026 Hospital Sample City Hospital (practice) Written by Dr Practice Sample Name in the document Sample Abha Mother');
    expect(words).toContain("Examination: Pallor present. A sentence was withheld here: it may mention a baby's sex (PC-PNDT Act).");
    expect(out).toContain('class="abha-doc-sub"');
    expect(words).toContain('Download Practice report.pdf PDF, 785 bytes');
    expect(words).toContain("Perinexa cannot look inside a file for words about a baby's sex.");
    expect(words).toContain('Practice web page: not a PDF, JPEG or PNG file – not offered, for safety');
    // Nothing from another system is put in as HTML
    expect(html(<DocumentView document={{ ...doc, sections: [{ title: 'Notes', lines: [{ text: '<b>Sample</b><script>x</script>', withheld: 0, sub: false }] }] }} />)).not.toContain('<script>');
    // A baby's record: no note about the baby's sex; a checksum that did not match is said
    expect(text(html(<DocumentView document={{ ...doc, checksumOk: false }} isBaby />))).not.toContain('Perinexa cannot look inside');
    expect(text(html(<DocumentView document={{ ...doc, checksumOk: false }} />))).toContain("The other hospital's check of this document did not match what arrived.");
  });
});
