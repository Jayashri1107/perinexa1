// Clinical Requirements Group B, item 14: the postnatal discharge checklist shows every check with Yes / No (and Not
// applicable only where allowed), every danger sign for the mother and the baby, and the teach-back. DRAFT, English
// only. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DANGER_SIGNS_BABY, DANGER_SIGNS_MOTHER, DISCHARGE_ITEMS } from './postnatalRules.js';

let current = null;
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: { checklist: current, earlier: [], access: { write: true } }, error: null, reload: () => {} }) }));
const { DischargeChecklistSection } = await import('./DischargeChecklist.jsx');
const html = (el) => renderToStaticMarkup(el);
const text = (m) => m.replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const mother = { id: 'p1', careType: 'postnatal' };

describe('the postnatal discharge checklist', () => {
  it('lists every check, every danger sign and the teach-back; Not applicable only for anti-D and the baby’s vaccines', () => {
    current = null;
    const out = html(<DischargeChecklistSection patient={mother} admissionId="a1" />);
    for (const i of DISCHARGE_ITEMS) expect(text(out)).toContain(i.label);
    for (const s of [...DANGER_SIGNS_MOTHER, ...DANGER_SIGNS_BABY]) expect(text(out)).toContain(s.label);
    expect(text(out)).toContain('said the danger signs back');
    expect(out.match(/Not applicable/g)).toHaveLength(2);
    expect(text(out)).toContain('English only until the Marathi and Hindi wording is approved');
    expect(text(out)).not.toMatch(/!/);
  });

  it('a completed checklist is locked and says who completed it', () => {
    current = { id: 'c1', rev: 2, status: 'complete', items: Object.fromEntries(DISCHARGE_ITEMS.map((i) => [i.key, 'yes'])), itemNotes: '', dangerSigns: [], teachBack: { done: true, by: 'mother', language: 'mr', note: '' }, followUpOn: '2026-11-13', savedByName: 'Sample nurse', completed: { byName: 'Sample nurse', at: '2026-11-10T06:00:00Z' } };
    const out = text(html(<DischargeChecklistSection patient={mother} admissionId="a1" />));
    expect(out).toContain('Complete – Sample nurse');
    expect(out).not.toContain('Mark complete');
    expect(out).toContain('Next postnatal visit');
  });

  it('is not shown on a baby’s or a gynaecology record', () => {
    expect(html(<DischargeChecklistSection patient={{ id: 'b', careType: 'newborn' }} admissionId="a1" />)).toBe('');
    expect(html(<DischargeChecklistSection patient={{ id: 'g', careType: 'gynaecology' }} admissionId="a1" />)).toBe('');
  });
});
