// Clinical Requirements Group A, items 1 and 2: the delivery note asks for the Robson details and, for a caesarean, its
// category and times, and shows what is worked out from them (category 1 over 30 minutes in red). Rendered to HTML
// (no browser). Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DeliveryAudit, DocForm, toForm } from './DocumentPage.jsx';
import { intervalWords, robsonWords } from './robson.js';

const html = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noop = () => {};
const baby = { sex: 'female', weightGrams: '3000', apgar1: '', apgar5: '', outcome: 'live', stillbirthType: '', breastfedWithinHour: '', nicu: '', notes: '' };
const form = (over = {}) => ({ ...toForm('delivery', {}), deliveredAt: '2026-11-08T11:00', mode: 'normal', gestationWeeks: '39', labourOnset: 'spontaneous', parity: 'nullipara', presentation: 'cephalic', bloodLossMl: '300', babies: [baby], ...over });

describe('the delivery note: Robson group and caesarean times', () => {
  it('shows the caesarean fields only for a caesarean, and a previous caesarean only for a multiparous woman', () => {
    const normal = text(html(<DocForm kind="delivery" form={form()} setForm={noop} fields={{}} groupA />));
    expect(normal).not.toContain('Category of the caesarean');
    expect(normal).not.toContain('Previous caesarean');
    expect(normal).toContain('Parity');
    expect(normal).toContain('Measured blood loss – ml');
    expect(normal).not.toContain('Measured blood loss (optional)');
    const cs = text(html(<DocForm kind="delivery" form={form({ mode: 'lscs', parity: 'multipara' })} setForm={noop} fields={{}} groupA />));
    expect(cs).toContain('Category of the caesarean');
    expect(cs).toContain('Time of the decision to deliver');
    expect(cs).toContain('Time of the skin incision (optional)');
    expect(cs).toContain('Previous caesarean');
  });

  it('an older draft keeps the fields optional', () => {
    expect(text(html(<DocForm kind="delivery" form={form()} setForm={noop} fields={{}} />))).toContain('Measured blood loss (optional)');
  });

  it('works out the Robson group, or says what it still needs', () => {
    expect(robsonWords(form())).toBe('Robson group 1 – Nulliparous, single cephalic, 37 weeks or more, spontaneous labour');
    expect(robsonWords(form({ parity: '', presentation: '' }))).toBe('Robson group: needs parity, the presentation');
    expect(text(html(<DeliveryAudit form={form()} />))).toContain('Robson group 1');
  });

  it('category 1 delivered 40 minutes after the decision is shown in red with words, not colour alone', () => {
    const late = form({ mode: 'lscs', csCategory: '1', decisionAt: '2026-11-08T10:20' });
    expect(intervalWords({ ...late, deliveredAt: '2026-11-08T05:30:00.000Z', decisionAt: '2026-11-08T04:50:00.000Z' })).toMatchObject({ minutes: 40, red: true });
    const out = html(<DeliveryAudit form={late} />);
    expect(out).toContain('pill-high');
    expect(text(out)).toContain('Over 30 minutes Decision to delivery: 40 minutes (target 30 minutes or less for category 1)');
    const ok = html(<DeliveryAudit form={form({ mode: 'lscs', csCategory: '1', decisionAt: '2026-11-08T10:40' })} />);
    expect(ok).toContain('pill-stable');
    expect(text(ok)).toContain('Within target');
    expect(text(out)).not.toMatch(/!/);
  });
});
