// Why a patient comes (26 Oct 2026, the follow-up a patient was asked to come back for, and the reason marked when she
// checks in). A short fixed list – reception sees it, so never a diagnosis or a medical detail (the calendar's rule:
// reception never gets the medical reason for a visit). The note beside it is short and says so.

export const VISIT_PURPOSES = ['consultation', 'reports', 'test', 'procedure', 'prescription', 'other'];
export const PURPOSE_LABELS = {
  consultation: 'Follow-up consultation',
  reports: 'Show reports',
  test: 'Test or scan',
  procedure: 'Dressing or procedure',
  prescription: 'Prescription',
  other: 'Other',
};
export const PURPOSE_NOTE_MAX = 120;
