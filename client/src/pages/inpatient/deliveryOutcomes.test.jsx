// Delivery and newborn outcomes on the delivery note (5 Oct 2026): the doctor's postpartum haemorrhage answer with
// what the blood loss suggests, and per baby the kind of stillbirth, breastfeeding within one hour and NICU or SNCU
// admission. Rendered to HTML (no browser). Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DocContent, DocForm, toContent, toForm } from './DocumentPage.jsx';
import { emptyBaby } from './docFields.js';
import { babyOutcomeWords, pphHint, pphSuggested, pphThresholdMl, tidyBaby } from './deliveryOutcomes.js';

const html = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noop = () => {};

describe('postpartum haemorrhage: suggested from the blood loss, never decided by the app', () => {
  it('500 mL after a vaginal birth, 1000 mL after a caesarean, nothing for "other" or without a mode', () => {
    expect(['normal', 'vacuum', 'forceps', 'lscs', 'other', ''].map(pphThresholdMl)).toEqual([500, 500, 500, 1000, null, null]);
    expect([pphSuggested('normal', '499'), pphSuggested('normal', '500'), pphSuggested('lscs', '999'), pphSuggested('lscs', '1000')]).toEqual([false, true, false, true]);
    expect([pphSuggested('other', '2000'), pphSuggested('normal', ''), pphSuggested('normal', 'a lot')]).toEqual([null, null, null]);
  });

  it('the hint says what the blood loss suggests, that the doctor decides, and that the amounts are a draft with their source', () => {
    expect(pphHint('normal', '650')).toMatch(/^A blood loss of 650 mL after a vaginal birth suggests postpartum haemorrhage \(500 mL or more\)\. You decide – nothing is ticked by itself\./);
    expect(pphHint('lscs', '800')).toMatch(/^A blood loss of 800 mL after a caesarean is below 1,000 mL\./);
    expect(pphHint('lscs', '')).toMatch(/^Enter the blood loss to see what it suggests \(1,000 mL or more after a caesarean\)\./);
    expect(pphHint('other', '1500')).toMatch(/^No suggestion for "Other"/);
    expect(pphHint('', '')).toMatch(/^Choose the mode of delivery/);
    for (const h of [pphHint('normal', '650'), pphHint('', '')]) expect(h).toMatch(/DRAFT for a doctor to check\. Source: WHO recommendations on postpartum haemorrhage \(2012\)/);
    expect(pphHint('normal', '650')).not.toMatch(/!/);
  });
});

describe('the delivery note form', () => {
  const form = (over = {}) => ({ ...toForm('delivery', {}), mode: 'normal', bloodLossMl: '700', ...over });

  it('asks the doctor about heavy bleeding beside the blood loss, with "Not recorded" as the start', () => {
    const out = html(<DocForm kind="delivery" form={form()} setForm={noop} fields={{}} />);
    const words = text(out);
    expect(words).toContain('Heavy bleeding after delivery (postpartum haemorrhage) (optional)');
    expect(out).toMatch(/<select id="doc-pph"[^>]*><option value="" selected="">Not recorded<\/option><option value="yes">Yes – heavy bleeding \(PPH\)<\/option><option value="no">No<\/option><\/select>/);
    expect(words).toContain('A blood loss of 700 mL after a vaginal birth suggests postpartum haemorrhage (500 mL or more). You decide – nothing is ticked by itself.');
  });

  it('per baby: breastfeeding within one hour and the NICU or SNCU for a baby born alive; the kind of stillbirth for a stillbirth', () => {
    const babies = [
      { ...emptyBaby(), outcome: 'live', breastfedWithinHour: 'no', nicu: 'yes' },
      { ...emptyBaby(), outcome: 'stillbirth', stillbirthType: 'fresh' },
    ];
    const out = html(<DocForm kind="delivery" form={form({ babies })} setForm={noop} fields={{}} />);
    const words = text(out);
    expect(out).toContain('id="b-breastfedWithinHour-0"');
    expect(out).toContain('id="b-nicu-0"');
    expect(out).not.toContain('id="b-stillbirthType-0"');
    expect(out).toContain('id="b-stillbirthType-1"');
    expect(out).not.toContain('id="b-breastfedWithinHour-1"');
    expect(out).not.toContain('id="b-nicu-1"');
    expect(words).toContain('Breastfed within one hour of birth');
    expect(words).toContain('Not applicable: for example the baby went to the NICU at once.');
    expect(words).toContain('Admitted to the NICU or SNCU');
    expect(words).toContain('Fresh: the baby died during labour. Macerated: before labour.');
    expect(out).toMatch(/<option value="fresh" selected="">Fresh \(died during labour\)<\/option>/);
    expect(out.match(/btn-primary/g) ?? []).toHaveLength(0); // the page's one primary button is "Save draft"
  });

  it('keeps the new answers through the form and back; a note from before them reads as "not recorded"', () => {
    const content = { deliveredAt: '2026-10-01T05:30:00.000Z', mode: 'lscs', bloodLossMl: 1200, pph: 'yes', babies: [{ outcome: 'live', sex: 'female', apgar1: 6, apgar5: 8, breastfedWithinHour: 'not_applicable', nicu: 'yes', stillbirthType: '' }] };
    const back = toContent('delivery', toForm('delivery', content));
    expect(back.pph).toBe('yes');
    expect(back.babies[0]).toMatchObject({ outcome: 'live', breastfedWithinHour: 'not_applicable', nicu: 'yes', stillbirthType: '' });
    const old = toContent('delivery', toForm('delivery', { mode: 'normal', babies: [{ outcome: 'live', sex: 'male' }] }));
    expect(old.pph).toBe('');
    expect(old.babies[0]).toMatchObject({ stillbirthType: '', breastfedWithinHour: '', nicu: '' });
  });

  it('an answer that does not fit the outcome is cleared (as the server does)', () => {
    expect(tidyBaby({ ...emptyBaby(), outcome: 'stillbirth', breastfedWithinHour: 'yes', nicu: 'no', stillbirthType: 'macerated' })).toMatchObject({ breastfedWithinHour: '', nicu: '', stillbirthType: 'macerated' });
    expect(tidyBaby({ ...emptyBaby(), outcome: 'live', stillbirthType: 'fresh', nicu: 'yes' })).toMatchObject({ stillbirthType: '', nicu: 'yes' });
  });
});

describe('the confirmed delivery note and its printout', () => {
  it('reads the answers as words; nothing is said when nothing was answered', () => {
    const words = text(
      html(
        <DocContent
          kind="delivery"
          content={{ mode: 'normal', bloodLossMl: 650, pph: 'yes', babies: [{ outcome: 'live', sex: 'female', breastfedWithinHour: 'yes', nicu: 'no' }, { outcome: 'stillbirth', sex: 'male', stillbirthType: 'macerated' }] }}
        />,
      ),
    );
    expect(words).toContain('Heavy bleeding after delivery (postpartum haemorrhage) Yes – heavy bleeding (PPH)');
    expect(words).toContain('Baby 1: Live birth · Female · Breastfed within one hour: yes · Admitted to the NICU or SNCU: no');
    expect(words).toContain('Baby 2: Stillbirth · Male · Macerated stillbirth');
    expect(babyOutcomeWords({ outcome: 'live' })).toEqual([]);
    expect(text(html(<DocContent kind="delivery" content={{ mode: 'normal', pph: '', babies: [{ outcome: 'live' }] }} />))).not.toContain('haemorrhage');
  });
});
