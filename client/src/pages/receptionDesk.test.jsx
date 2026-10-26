// Reception's desk on Today (26 Oct 2026): what the search box carries into a new registration, and the To do list
// (rendered to HTML, no browser). Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DeskSearch, QueueBoard, TodoPanel, prefillFrom, queueCounts, queueWhen } from './ReceptionDesk.jsx';

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

describe('the live queue', () => {
  const who = (id, fullName) => ({ id, fullName, mrn: `P-00000${id}`, phone: '98765 43210', doctorName: 'Sample Doctor' });
  const rows = [
    { patient: who('1', 'Urgent Sample'), appointment: { kind: 'token', token: 3, doctorName: 'Sample Doctor' }, arrivedAt: '2026-10-26T05:00:00.000Z', arrivalMarked: true, visitStarted: false, queue: 'waiting', emergency: true, leftMarked: false },
    { patient: who('2', 'With Sample'), appointment: { kind: 'slot', start: '10:30', doctorName: 'Sample Doctor' }, arrivedAt: '2026-10-26T04:50:00.000Z', arrivalMarked: true, visitStarted: true, queue: 'with_doctor', emergency: false, leftMarked: false },
    { patient: who('3', 'Expected Sample'), appointment: { kind: 'slot', start: null, needsTime: true }, booked: true, arrivedAt: null, arrivalMarked: false, visitStarted: false, queue: 'expected', emergency: false, leftMarked: false },
    { patient: who('4', 'Done Sample'), appointment: null, booked: false, arrivedAt: '2026-10-26T04:00:00.000Z', arrivalMarked: true, visitStarted: true, queue: 'done', emergency: true, leftMarked: true },
  ];
  it('counts each state, and the emergencies still in the queue', () => {
    expect(queueCounts(rows)).toEqual({ all: 4, expected: 1, waiting: 1, with_doctor: 1, done: 1, emergency: 1 });
    expect(queueCounts([{ arrivedAt: null }, { arrivedAt: 'x' }])).toMatchObject({ expected: 1, waiting: 1 }); // older answers
  });
  it('her time: booked time, token, or what is missing', () => {
    expect(rows.map(queueWhen)).toEqual(['Token 3', '10:30 AM', 'No time yet', 'No booking']);
  });
  it('one row each with her state in words and the buttons for that state', () => {
    const shown = text(<QueueBoard rows={rows} onMark={() => {}} onUndo={() => {}} onFlag={() => {}} onSlip={() => {}} onRefresh={() => {}} />);
    expect(shown).toMatch(/queue 1 emergency/);
    expect(shown).toMatch(/4 All .*1 Expected .*1 Waiting .*1 With the doctor .*1 Done/);
    expect(shown).toMatch(/Urgent Sample .* Emergency Waiting Not an emergency Mark done Undo arrival Slip/);
    expect(shown).toMatch(/With Sample .* With the doctor Emergency Mark done/);
    expect(shown).toMatch(/Expected Sample .* Expected Mark arrived/);
    expect(shown).toMatch(/Done Sample .* Done Undo done/);
    expect(shown).not.toMatch(/Done Sample[^]*Emergency Done/); // done: no emergency mark any more
    expect(shown).toContain('refreshes every 30 seconds');
  });
  it('no buttons for those who may not mark arrivals', () => {
    expect(text(<QueueBoard rows={rows} canMark={false} onRefresh={() => {}} />)).not.toMatch(/Mark arrived|Mark done|Undo/);
  });
});
