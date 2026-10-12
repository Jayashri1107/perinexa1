// PCPNDT Act: the sex of a baby must never be recorded or disclosed during a pregnancy. Free text that
// staff type into pregnancy records (and templates, and voice-entry words) is checked against these
// patterns. The website has an identical copy (client/src/pcpndtWords.js); a test checks they match.
// A word list can be spelled around, so staff training is still needed.

import { z } from 'zod';

export const FETAL_SEX_WORDS = /\b(?:boys?|girls?|males?|females?|sons?|daughters?|sex|gender|lad(?:ka|ke|ki|kiyan|kiyaan)|lar(?:ka|ke|ki))\b/i;
// case-sensitive: 46,XY · 46, XX · XY, and whole karyotypes such as 47,XXY or 69,XXY (not "10, X-ray" or a bare XXX)
export const KARYOTYPE = /(?:\b\d{2}\s*,\s*)?\bX[XY]\b|\b\d{2}\s*,\s*(?:X{2,3}Y{0,2}|XY{1,3})\b/;
export const SEX_SYMBOLS = /[♂♀]/;
export const mentionsFetalSex = (t) => Boolean(t) && (FETAL_SEX_WORDS.test(t) || KARYOTYPE.test(t) || SEX_SYMBOLS.test(t));

export const PCPNDT_MESSAGE =
  "Please remove words about the baby's sex – it must never be recorded in a pregnancy (PCPNDT Act). For the partner, write “partner” or “husband”.";

/** Free text for pregnancy records: trimmed, at most `max` characters, and nothing about the baby's sex. */
export const safeText = (label, max) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .refine((t) => !mentionsFetalSex(t), PCPNDT_MESSAGE);
