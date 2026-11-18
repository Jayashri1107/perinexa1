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

// Fertility treatment (before a pregnancy): the PCPNDT Act also forbids choosing the sex of a child before conception
// (owner's decision of 17 Nov 2026, health check M6). The pregnancy list above cannot be used here: a fertility plan
// rightly says "male factor", "male infertility", "sexual health" and a karyotype such as 47,XXY (the male work-up).
// So this list is narrower: words for a child of one sex, and sex selection itself. DRAFT until the owner has read it.
export const SEX_SELECTION_WORDS =
  /\b(?:boys?|girls?|sons?|daughters?|lad(?:ka|ke|ki|kiyan|kiyaan)|lar(?:ka|ke|ki))\b|\b(?:male|female)\s+(?:child|children|baby|babies|issue|offspring|fo?etus(?:es)?|embryos?)\b|\b(?:sex|gender)\s*(?:-\s*)?(?:selection|selective|determination|preference|choice)\b|\bsex\s+of\s+(?:the\s+|a\s+|her\s+)?(?:child|baby|fo?etus|embryos?)\b|\bgender\b/i;
// The approved library's own phrases (fertility/protocols.js: IVF and donor cautions, fertility preservation)
const LIBRARY_PHRASES = /\bno sex selection\b|\bmen and boys\b|\bwomen and girls\b/gi;
export const mentionsSexSelection = (t) => Boolean(t) && SEX_SELECTION_WORDS.test(String(t).replace(LIBRARY_PHRASES, ' '));

export const SEX_SELECTION_MESSAGE =
  'Please remove words about the sex of a future child – choosing it is not allowed (PCPNDT Act). Clinical words such as “male factor” are fine.';

/** Free text for fertility plans and cycle sheets: trimmed, at most `max` characters, no sex selection. */
export const fertilityText = (label, max) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .refine((t) => !mentionsSexSelection(t), SEX_SELECTION_MESSAGE);
