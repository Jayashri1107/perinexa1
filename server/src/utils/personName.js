// A person's name as it is saved, shown and printed: every word starts with a capital letter (21 Oct 2026) –
// "jayashri sable" → "Jayashri Sable". PURE. Only the first letter of each word (after a space) changes; the rest stays
// as typed, so "McDonald" or "A.K." keep their capitals and "Walk-in" its small letter. "of" stays small inside a name,
// so a newborn's "Baby of Asha Patil" reads as it should. Scripts without capitals (Marathi, Hindi) are left as they
// are. Used on people's names only – never on medicine, hospital or business names.
const SMALL_WORDS = new Set(['of']);

/**
 * A baby's name before the family gives one (9 Nov 2026): "B/O <mother's name>" – and for twins, triplets or more,
 * "B/O <mother's name> (Twin 1)", "(Triplet 2)", "(Baby 4)". At most 150 characters, as every name. PURE.
 */
export function babyOfName(motherName, index = 0, count = 1) {
  const kind = count === 2 ? 'Twin' : count === 3 ? 'Triplet' : 'Baby';
  const tail = count > 1 ? ` (${kind} ${index + 1})` : '';
  return `B/O ${String(motherName ?? '').trim()}`.slice(0, 150 - tail.length) + tail;
}
export const capitalizeName = (value) =>
  typeof value === 'string'
    ? value.replace(/(^|\s)(\p{Ll})(\S*)/gu, (whole, before, letter, rest, offset) =>
        offset > 0 && SMALL_WORDS.has(`${letter}${rest}`) ? whole : before + letter.toLocaleUpperCase('en-IN') + rest,
      )
    : value;
