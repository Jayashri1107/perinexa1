// Words of Calendar → Reminders: the plain label of each kind of message, and what "Send due reminders now" did.
import { describe, expect, it } from 'vitest';
import { GENERAL_KINDS, KIND_LABELS, hasDraftWording, messageAbout, runNotice } from './outboxFormat.js';

describe('messageAbout', () => {
  it('gives every kind a plain label; the general kinds never say what is due', () => {
    expect(messageAbout({ kind: 'appointment', dueOn: '2026-10-02T00:00:00.000Z' })).toBe('Appointment reminder · appointment 2 Oct 2026');
    expect(messageAbout({ kind: 'booked', dueOn: '2026-10-02T00:00:00.000Z' })).toBe('Appointment booked · appointment 2 Oct 2026');
    expect(messageAbout({ kind: 'moved', dueOn: '2026-10-02T00:00:00.000Z' })).toBe('Appointment moved · appointment 2 Oct 2026');
    expect(messageAbout({ kind: 'cancelled', dueOn: '2026-10-02T00:00:00.000Z' })).toBe('Appointment cancelled · appointment 2 Oct 2026');
    expect(messageAbout({ kind: 'care_due', dueOn: '2026-10-27T00:00:00.000Z', aboutOn: null })).toBe('Check-up or test due · can be sent until 27 Oct 2026');
    expect(messageAbout({ kind: 'missed', dueOn: '2026-10-27T00:00:00.000Z', aboutOn: '2026-10-20T00:00:00.000Z' })).toBe('Missed appointment · of 20 Oct 2026');
    // An answer from before kinds were sent reads as an appointment reminder
    expect(messageAbout({ dueOn: '2026-10-02T00:00:00.000Z' })).toBe('Appointment reminder · appointment 2 Oct 2026');
    for (const kind of GENERAL_KINDS) expect(KIND_LABELS[kind]).not.toMatch(/vaccin|scan|blood|pregnan|antenatal/i);
  });
});

describe('runNotice', () => {
  it('says what was added and what became of it, in one sentence', () => {
    expect(runNotice({ queued: 2, sent: 1, toSend: 1 })).toBe('Done: 2 new reminders for tomorrow; 1 sent, 1 to send by hand.');
    expect(runNotice({ queued: 1, missed: 1, careDue: 3, heldBack: 0, dropped: 0, sent: 0, failed: 2, toSend: 5 })).toBe(
      'Done: 1 new reminder for tomorrow, 1 for a missed appointment, 3 for check-ups or tests due; 0 sent, 5 to send by hand, 2 failed.',
    );
  });

  it('says when waiting messages were cancelled, and when a draft care plan held a message back', () => {
    expect(runNotice({ queued: 0, missed: 0, careDue: 0, heldBack: 2, dropped: 1, sent: 0, failed: 0, toSend: 0 })).toBe(
      'Done: 0 new reminders for tomorrow; 0 sent, 0 to send by hand. 1 waiting message was cancelled as no longer needed. 2 patients have something overdue but got no message: their care plan is still a draft (a doctor approves it in Clinic library → To approve).',
    );
  });

  it('says when the general messages wait for the morning', () => {
    expect(runNotice({ queued: 0, missed: 1, careDue: 1, heldBack: 0, dropped: 0, waiting: 2, sent: 0, failed: 0, toSend: 0 })).toBe(
      'Done: 0 new reminders for tomorrow, 1 for a missed appointment, 1 for a check-up or test due; 0 sent, 0 to send by hand. 2 messages for a check-up or test due or a missed appointment wait until the morning: these are not sent in the evening or at night.',
    );
    expect(runNotice({ queued: 0, waiting: 1, sent: 0, toSend: 0 })).toContain('1 message for a check-up or test due or a missed appointment waits until the morning');
  });
});

describe('hasDraftWording', () => {
  it('is true only when a message is in Marathi or Hindi', () => {
    expect(hasDraftWording([{ language: 'en' }])).toBe(false);
    expect(hasDraftWording([{ language: 'en' }, { language: 'mr' }])).toBe(true);
    expect(hasDraftWording([{ language: 'hi' }])).toBe(true);
    expect(hasDraftWording()).toBe(false);
  });
});
