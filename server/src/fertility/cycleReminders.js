import { addDays, utcDay } from '../careplans/dates.js';
import { FertilityCycle } from '../models/FertilityCycle.js';

// Cycle reminders (fertility idea F5, the owner's go-ahead of 27 Oct 2026). Under the reminder rules every automatic
// message is GENERAL – the same fixed words for everyone, never what is due or why (reminders/reminderRules.js), since
// it may be read on a family phone. So:
//  - the scan days go as appointments booked from the cycle sheet (F7), with the usual appointment reminders;
//  - the pregnancy-test day counts as "a check-up or test is due" (the general message): from TEST_AFTER_DAYS after
//    the trigger, or the relations or IUI day, until a test result is written on the sheet, for TEST_DUE_WINDOW_DAYS.
// Injection times and medicine doses are not sent: they would say what the treatment is. Changing that is the
// owner's decision (the wording of a fertility message), not a setting here.

export const TEST_AFTER_DAYS = 14;
export const TEST_DUE_WINDOW_DAYS = 7;

/** The day her pregnancy test is due on this cycle, or null (no trigger and no timing day yet). */
export function testDueOn(cycle) {
  const from = cycle.timing?.on ?? cycle.trigger?.at ?? null;
  return from ? addDays(utcDay(from), TEST_AFTER_DAYS) : null;
}

/** The patients (id strings) whose open cycle's test day has come within the window, with no test result yet. */
export async function cycleTestDue(tenantId, patientIds, today) {
  if (!patientIds.length) return new Set();
  const cycles = await FertilityCycle.find(
    { tenantId, patientId: { $in: patientIds }, status: 'after_trigger', cancelled: null, 'outcome.test': '' },
    { patientId: 1, trigger: 1, timing: 1 },
  ).lean();
  const day = utcDay(today);
  return new Set(
    cycles
      .filter((c) => {
        const due = testDueOn(c);
        return due && due <= day && addDays(due, TEST_DUE_WINDOW_DAYS) > day;
      })
      .map((c) => String(c.patientId)),
  );
}
