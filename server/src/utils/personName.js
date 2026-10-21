// A person's name as it is saved, shown and printed: every word starts with a capital letter (21 Oct 2026) –
// "jayashri sable" → "Jayashri Sable". PURE. Only the first letter of each word changes; the rest stays as typed, so
// "McDonald", "D'Souza" and initials such as "A.K." keep their capitals. A word starts at the beginning, or after a
// space, a hyphen, an apostrophe or a full stop ("mary-ann o'brien" → "Mary-Ann O'Brien"). Scripts without capitals
// (Marathi, Hindi) are left as they are. Used on people's names only – never on medicine, hospital or business names.
export const capitalizeName = (value) =>
  typeof value === 'string' ? value.replace(/(^|[\s\-'’.])(\p{Ll})/gu, (_, before, letter) => before + letter.toLocaleUpperCase('en-IN')) : value;
