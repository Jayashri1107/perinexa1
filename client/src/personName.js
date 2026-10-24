// A person's name as it is typed (24 Oct 2026): every word starts with a capital letter while typing –
// "jayashri sable" → "Jayashri Sable" – the same rule the server saves with (server/src/utils/personName.js). Only the
// first letter of each word changes, so "McDonald" or "A.K." keep their capitals and "Walk-in" its small letter; "of"
// stays small inside a name ("Baby of Asha Patil"); Marathi and Hindi have no capitals and stay as typed. PURE.
const SMALL_WORDS = new Set(['of']);
export const capitalizeName = (value) =>
  typeof value === 'string'
    ? value.replace(/(^|\s)(\p{Ll})(\S*)/gu, (whole, before, letter, rest, offset) =>
        offset > 0 && SMALL_WORDS.has(`${letter}${rest}`) ? whole : before + letter.toLocaleUpperCase('en-IN') + rest,
      )
    : value;

/**
 * For a name box's onChange: capitalises what was typed in the box itself, keeping the cursor where it was (the text
 * keeps its length), then calls `handler` with the event – onChange={asName(set('fullName'))}.
 */
export const asName = (handler) => (e) => {
  const box = e.target;
  const next = capitalizeName(box.value);
  if (next !== box.value) {
    const { selectionStart, selectionEnd } = box;
    box.value = next;
    if (selectionStart != null) box.setSelectionRange(selectionStart, selectionEnd);
  }
  handler(e);
};
