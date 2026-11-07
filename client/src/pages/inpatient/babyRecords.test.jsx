// Clinical Requirements Group C (PX-X-14): the babies' records from a signed delivery note. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const data = {
  signed: true,
  babies: [
    { index: 0, outcome: 'live', sex: 'male', weightGrams: 2400, record: { id: 'b1', mrn: 'P-000031', fullName: 'First Baby of Birth Mother' } },
    { index: 1, outcome: 'live', sex: 'female', weightGrams: 2200, record: null },
    { index: 2, outcome: 'stillbirth', sex: '', weightGrams: 1900, record: null },
  ],
  linkedByHand: [{ id: 'b9', mrn: 'P-000040', fullName: 'Baby Sample', birthAt: null }],
  access: { create: true },
};
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data, error: null, loading: false, reload: () => {} }) }));
const { BabyRecords } = await import('./DocumentPage.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe("the babies' records from the delivery note", () => {
  it('links a made record, offers to make the next, nothing for a stillbirth, and warns of babies linked by hand', () => {
    const out = text(<BabyRecords documentId="d1" motherName="Birth Mother" />);
    expect(out).toContain('Baby 1 Live birth · Male · 2400 g First Baby of Birth Mother · P-000031');
    expect(out).toContain("Baby 2 Live birth · Female · 2200 g Make the baby's record");
    expect(out).toMatch(/Baby 3 Stillbirth · 1900 g (?!Make)/);
    expect(out).toContain('Already linked to Birth Mother by hand: Baby Sample · P-000040');
    expect(out).not.toMatch(/!/);
  });
});
