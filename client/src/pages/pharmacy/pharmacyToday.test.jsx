// The pharmacist's Today, compact (26 Oct 2026): the numbers as one row of small cards, each with its value, a short
// name and what it means for screen readers and on pointing at it; the quick actions on their own. Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const DATA = {
  '/pharmacy/invoices': { invoices: [{ kind: 'sale', netPaise: 30000 }, { kind: 'issue', netPaise: 500 }] },
  '/pharmacy/reports/alerts': { low: [], days: 90, expiring: [{ expired: false }, { expired: false }] },
  '/pharmacy/inpatients': { inpatients: [{}, {}] },
  '/pharmacy/orders': { orders: [] },
};
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: (path) => ({ data: DATA[path], error: null, loading: false, reload: () => {} }) }));
const { PharmacyActions, PharmacyToday } = await import('./PharmacyToday.jsx');
const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe("the pharmacist's Today, compact", () => {
  it('seven small cards in one row: value and short name, the meaning for screen readers', () => {
    const shown = text(<PharmacyToday />);
    expect(shown).toMatch(/₹300(\.00)? Sold today 1 invoice/);
    expect(shown).toMatch(/1 Issued to wards ₹5(\.00)? on the patients' bills/);
    expect(shown).toMatch(/2 In the wards .* 0 Low stock .* 2 Expiring soon Batches expiring within 90 days 0 Expired .* 0 Orders due/);
    expect(renderToStaticMarkup(<MemoryRouter><PharmacyToday /></MemoryRouter>).match(/class="ph-stat( is-[a-z]+)?"/g)).toHaveLength(7);
  });

  it('the quick actions on their own, for the toolbar', () => {
    expect(text(<PharmacyActions />)).toMatch(/Sell at the counter Issue to ward Receive a delivery Stock/);
  });
});
