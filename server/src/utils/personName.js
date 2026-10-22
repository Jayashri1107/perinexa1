// A person's name as it is saved, shown and printed: every word starts with a capital letter (21 Oct 2026) –
// "jayashri sable" → "Jayashri Sable". PURE. Only the first letter of each word (after a space) changes; the rest stays
// as typed, so "McDonald" or "A.K." keep their capitals and "Walk-in" its small letter. "of" stays small inside a name,
// so a newborn's "Baby of Asha Patil" reads as it should. Scripts without capitals (Marathi, Hindi) are left as they
// are. Used on people's names only – never on medicine, hospital or business names.
const SMALL_WORDS = new Set(['of']);
export const capitalizeName = (value) =>
  typeof value === 'string'
    ? value.replace(/(^|\s)(\p{Ll})(\S*)/gu, (whole, before, letter, rest, offset) =>
        offset > 0 && SMALL_WORDS.has(`${letter}${rest}`) ? whole : before + letter.toLocaleUpperCase('en-IN') + rest,
      )
    : value;
