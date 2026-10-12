// Her records in ABHA on the screen (rendered to HTML, no browser): the list with each record's status as colour,
// icon and word, tick boxes only for records that can be linked, what is never shared, and the consents with what was
// sent. Made-up data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsentsList, NeverShared, RecordsTable } from './AbhaRecords.jsx';
import { ConfidentialWords } from './ScanShare.jsx';

const html = (node) => renderToStaticMarkup(node).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const AT = '2026-10-05T06:00:00.000Z';

const ITEMS = [
  { reference: 'V-1', kind: 'visit', display: 'OPD visit on 21 Sep 2026', hiTypes: ['OPConsultation', 'Prescription'], state: 'ready', reason: null, link: null },
  { reference: 'L-2', kind: 'lab', display: 'Lab report of 22 Sep 2026', hiTypes: ['DiagnosticReport'], state: 'ready', reason: null, confidentialLeftOut: 1, link: { status: 'linked', via: 'hospital', byName: 'Dr Sample', at: AT } },
  { reference: 'L-3', kind: 'lab', display: 'Lab report of 23 Sep 2026', hiTypes: ['DiagnosticReport'], state: 'never', reason: 'confidential_test', link: null },
  { reference: 'V-4', kind: 'visit', display: 'OPD visit on 28 Sep 2026', hiTypes: ['OPConsultation'], state: 'not_yet', reason: 'visit_not_signed', link: null },
];

describe('her records in ABHA', () => {
  it('each record with its kind, date, type and status; a tick box only where it can be linked', () => {
    const out = html(<RecordsTable items={ITEMS} canLink chosen={['V-1']} />);
    const words = text(out);
    expect(words).toContain('OPD visit on 21 Sep 2026 Consultation, Prescription Can be linked');
    expect(words).toContain('Lab report of 22 Sep 2026 Lab report Linked Linked by Dr Sample, 5 Oct 2026.');
    expect(words).toContain('Never shared HIV test – confidential, never shared.');
    expect(words).toContain('Not yet The visit is not signed yet.');
    expect(out.match(/type="checkbox"/g)).toHaveLength(1); // only V-1 (L-2 is linked already)
    expect(out).toContain('aria-label="Choose OPD visit on 21 Sep 2026"');
    expect(out).toMatch(/checked=""/);
    // Every status is a pill with its icon
    expect(out.match(/class="pill pill-/g)).toHaveLength(4);
    expect(out.match(/<span class="pill[^"]*"><svg/g)).toHaveLength(4);
    expect(out).not.toMatch(/!/);
  });

  it('read-only for someone who may not link; an empty record says so', () => {
    expect(html(<RecordsTable items={ITEMS} canLink={false} />)).not.toContain('type="checkbox"');
    expect(text(html(<RecordsTable items={[]} canLink />))).toBe('No visits, lab reports or discharge summaries on her record yet.');
  });

  it('what is never shared is always on the screen', () => {
    const words = text(html(<NeverShared />));
    expect(words).toContain('Never shared through ABHA');
    expect(words).toContain('HIV tests (confidential), any record that mentions HIV, and – when HIV is among her known conditions – her visits and discharge summaries.');
    expect(words).toContain("The words that mark a record as about HIV are a draft list, to be checked by the hospital's doctor before use");
    expect(words).toContain("The doctor's private note");
    expect(words).toContain('Anything marked entered in error');
  });

  it('Hospital admin → ABDM shows the words that mark a record as about HIV, as a draft with its source', () => {
    const out = html(<ConfidentialWords list={{ draft: true, source: 'Sample Act – draft list', words: ['HIV (also HIV-1, HIV-2, HIV1/2)', 'RVD (retroviral disease)'] }} />);
    const words = text(out);
    expect(words).toContain('Words that mark a record as about HIV Draft');
    expect(out).toMatch(/<span class="pill pill-watch"><svg/);
    expect(words).toContain("This list is a draft, to be checked by the hospital's doctor before use. Source: Sample Act – draft list.");
    expect(words).toContain('RVD (retroviral disease)');
  });

  it('the consents with what was sent; the practice buttons only in practice mode', () => {
    const consents = [
      {
        id: 'c1',
        consentId: 'abc',
        status: 'GRANTED',
        hiu: 'Sample Clinic (practice)',
        purpose: 'Care management',
        hiTypes: ['OPConsultation', 'DiagnosticReport'],
        from: '2026-01-01T06:00:00Z',
        to: AT,
        expiresAt: '2026-11-04T06:00:00Z',
        records: 2,
        receivedAt: AT,
        practice: true,
        transfers: [{ id: 't1', at: AT, status: 'sent', records: 2, documents: 3, heldBack: 0, practice: true }],
      },
      { id: 'c2', consentId: 'def', status: 'REVOKED', hiu: '', purpose: '', hiTypes: [], from: null, to: null, expiresAt: null, records: 1, receivedAt: AT, practice: false, transfers: [{ id: 't2', at: AT, status: 'refused', refusal: 'consent_revoked', records: 0, documents: 0, heldBack: 0 }] },
    ];
    const words = text(html(<ConsentsList consents={consents} practiceButtons />));
    expect(words).toContain('Sample Clinic (practice) · Care management · practice');
    expect(words).toContain('Consultation, Lab report · records of 1 Jan 2026 to 5 Oct 2026 · until 4 Nov 2026 · 2 records');
    expect(words).toContain('Consent given');
    expect(words).toContain('Sent 2 records (3 documents).');
    expect(words).toContain('See what was received');
    expect(words).toContain('She withdraws the consent (practice)');
    expect(words).toContain('Another hospital or app');
    expect(words).toContain('Withdrawn');
    expect(words).toContain('Nothing sent The consent was withdrawn.');
    // Each request is a status: colour, icon and word
    const out = html(<ConsentsList consents={consents} />);
    expect(out).toMatch(/<span class="pill pill-stable"><svg[^>]*>.*?<\/svg>Sent<\/span>/);
    expect(out).toMatch(/<span class="pill pill-inactive"><svg[^>]*>.*?<\/svg>Nothing sent<\/span>/);
    const real = text(html(<ConsentsList consents={consents} />));
    expect(real).not.toContain('She withdraws');
    expect(real).not.toContain('asks again');
    expect(real).not.toContain('See what was received');
    expect(text(html(<ConsentsList consents={[]} />))).toMatch(/^No consent yet\./);
  });
});
