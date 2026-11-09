import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BillingLabel, StayTypeLabel, groupByDepartment, startStayType } from './AdmissionLabels.jsx';

describe('colour labels for billing and admission type (owner, 9 Nov 2026)', () => {
  it('groups by department (no department last) and sorts ANC, Delivered, PNC, Other, then by admission time', () => {
    const stays = [
      { admissionId: '1', department: '', stayType: 'anc', admittedAt: '2026-11-09T01:00:00Z' },
      { admissionId: '2', department: 'Paediatrics', stayType: 'other', admittedAt: '2026-11-09T01:00:00Z' },
      { admissionId: '3', department: 'Obstetrics & Gynaecology', stayType: 'pnc', admittedAt: '2026-11-09T01:00:00Z' },
      { admissionId: '4', department: 'Obstetrics & Gynaecology', stayType: 'anc', admittedAt: '2026-11-09T03:00:00Z' },
      { admissionId: '5', department: 'Obstetrics & Gynaecology', stayType: 'anc', admittedAt: '2026-11-09T02:00:00Z' },
      { admissionId: '6', department: 'Obstetrics & Gynaecology', stayType: 'delivered', admittedAt: '2026-11-09T00:00:00Z' },
    ];
    const groups = groupByDepartment(stays);
    expect(groups.map((g) => g.department)).toEqual(['Obstetrics & Gynaecology', 'Paediatrics', '']);
    expect(groups[0].stays.map((s) => s.admissionId)).toEqual(['5', '4', '6', '3']);
  });

  it('each label is a word with an icon, never colour alone; unknown types show nothing', () => {
    const html = (el) => renderToStaticMarkup(el);
    for (const [el, word, tone] of [
      [<BillingLabel type="insurance" />, 'Insurance', 'pill-due'],
      [<BillingLabel type="cash" />, 'Cash', 'pill-stable'],
      [<BillingLabel type="package" />, 'Package', 'pill-admitted'],
      [<StayTypeLabel type="anc" />, 'ANC', 'pill-teal'],
      [<StayTypeLabel type="delivered" />, 'Delivered', 'pill-stable'],
    ]) {
      const out = html(el);
      expect(out).toContain(word);
      expect(out).toContain('<svg');
      expect(out).toContain(tone);
    }
    expect(html(<BillingLabel type="self" />)).toBe('');
    expect(html(<StayTypeLabel type={null} />)).toBe('');
  });

  it('a baby starts as Other; anyone else is chosen', () => {
    expect(startStayType('newborn')).toBe('other');
    expect(startStayType('antenatal')).toBe('');
  });
});
