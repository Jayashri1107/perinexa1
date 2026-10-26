// Reception's desk on Today (26 Oct 2026): what the search box carries into a new registration, and the To do list
// (rendered to HTML, no browser). Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DeskSearch, TodoPanel, prefillFrom } from './ReceptionDesk.jsx';

const text = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('reception desk', () => {
  it('a phone number typed in the search box becomes her phone, words her name, a patient number nothing', () => {
    expect(prefillFrom('98765 43210')).toEqual({ phone: '98765 43210' });
    expect(prefillFrom('+91 98765-43210')).toEqual({ phone: '+91 98765-43210' });
    expect(prefillFrom('asha sample')).toEqual({ fullName: 'asha sample' });
    expect(prefillFrom('P-000012')).toEqual({});
    expect(prefillFrom('  ')).toEqual({});
  });

  it('the search box comes first and asks for the phone, name or patient number', () => {
    expect(renderToStaticMarkup(<MemoryRouter><DeskSearch onArrive={() => {}} onSaved={() => {}} /></MemoryRouter>)).toContain('placeholder="Phone, name or patient number"');
  });

  it('To do lists only the jobs with someone in them, with their counts; nothing waiting says so', () => {
    const busy = text(<TodoPanel calls={5} incomplete={[{ patient: { id: '1' } }, { patient: { id: '2' } }]} toCollect={1} onSaved={() => {}} />);
    expect(busy).toContain('Calls to make');
    expect(busy).toMatch(/Details missing .* 2/);
    expect(busy).toContain('Payments to collect');
    expect(busy).not.toContain('Discharges');
    expect(busy).not.toContain('Tomorrow');
    expect(text(<TodoPanel onSaved={() => {}} />)).toContain('Nothing waiting.');
  });
});
