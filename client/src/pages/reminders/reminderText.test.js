import { describe, expect, it } from 'vitest';
import { reminderDate, reminderMessage } from './reminderText.js';

const DATA = {
  patient: { id: 'p1', fullName: 'Meera Testcase', phone: '9876543210', careType: 'antenatal' },
  hospital: { name: 'Sunrise Hospital', phone: '020 1234 5678' },
  appointment: '2026-10-12T00:00:00.000Z',
  plan: {
    nextVisit: { name: 'Antenatal visit 3', dueFrom: '2026-10-05T00:00:00.000Z', dueBy: '2026-10-19T00:00:00.000Z', status: 'upcoming' },
    overdue: [{ kind: 'investigation', name: 'Blood group and Rh', patientText: 'Blood group test', dueBy: '2026-09-20T00:00:00.000Z' }],
    due: [{ kind: 'scan', name: 'Anomaly scan (18–22 weeks)', patientText: '', dueBy: '2026-10-26T00:00:00.000Z' }],
  },
};

describe('reminderMessage', () => {
  it('English: the appointment the doctor set, what is due, what to bring, danger signs and the phone', () => {
    const text = reminderMessage(DATA, 'en');
    expect(text).toContain('Namaste Meera,');
    expect(text).toContain('This is a reminder from Sunrise Hospital.');
    expect(text).toContain('Your next appointment: 12 October 2026.');
    expect(text).toContain('• Blood group test (overdue – as soon as possible)');
    expect(text).toContain('• Anomaly scan (18–22 weeks) (by 26 October 2026)');
    expect(text).toContain('ANC card');
    expect(text).toContain('baby moves less');
    expect(text.endsWith('For any question, call 020 1234 5678.')).toBe(true);
  });

  it('without an appointment: the care plan\'s visit window, or "due now"', () => {
    expect(reminderMessage({ ...DATA, appointment: null }, 'en')).toContain('Your next check-up is due between 5 October 2026 and 19 October 2026.');
    const now = { ...DATA, appointment: null, plan: { ...DATA.plan, nextVisit: { ...DATA.plan.nextVisit, status: 'overdue' } } };
    expect(reminderMessage(now, 'en')).toContain('Your check-up is due now.');
  });

  it('Marathi and Hindi', () => {
    const mr = reminderMessage(DATA, 'mr');
    expect(mr).toContain('नमस्कार Meera,');
    expect(mr).toContain('Sunrise Hospital कडून आठवण.');
    expect(mr).toContain(`तुमची पुढील तपासणी: ${reminderDate(DATA.appointment, 'mr')}.`);
    expect(mr).toContain('(उशीर झाला आहे – लवकरात लवकर)');
    const hi = reminderMessage(DATA, 'hi');
    expect(hi).toContain('नमस्ते Meera,');
    expect(hi).toContain('(देर हो गई है – जल्द से जल्द)');
  });

  it('leaves out what is not known, and the pregnancy lines for other patients', () => {
    const plain = reminderMessage({ ...DATA, patient: { ...DATA.patient, careType: 'gynaecology' }, plan: null, hospital: { name: 'Sunrise Hospital', phone: '' } }, 'en');
    expect(plain).toBe('Namaste Meera,\nThis is a reminder from Sunrise Hospital.\nYour next appointment: 12 October 2026.');
  });
});
