// "Dr." in front of a doctor's name (13 Nov 2026): a person with the doctor role in any hospital has the title stored in
// their name, so every screen, list, bill and print shows "Dr. Asha Rao" without each having to add it. Given when the
// doctor role is given (models/Membership.js) and kept when the name is edited (models/User.js); doctors from before are
// given it at start-up (users/doctorTitles.js). Taking the doctor role away leaves the name as it is.
// Only the doctor role – not RMOs (developer's choice, 13 Nov 2026). PURE: no database.

const NAME_MAX = 100; // User.name maxlength
const TITLE_RX = /^dr\b\.?\s*/i;

/** "Asha Rao", "dr asha rao", "DR. Asha Rao" → "Dr. Asha Rao"; "Dr. Asha Rao" stays. Empty stays empty. */
export const withDoctorTitle = (name) => {
  const plain = String(name ?? '').trim();
  if (!plain) return plain;
  const rest = plain.replace(TITLE_RX, '').trim();
  return `Dr. ${rest || plain}`.slice(0, NAME_MAX);
};

/** Is the name already written "Dr. …" exactly as withDoctorTitle writes it? */
export const hasDoctorTitle = (name) => withDoctorTitle(name) === String(name ?? '').trim();
