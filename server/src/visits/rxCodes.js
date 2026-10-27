// The codes used by visits, prescriptions and the printed prescription designs (Feature 8). The website has
// the same lists with their words in English, Marathi and Hindi (client/src/pages/visits/rxFormat.js); a test
// checks that they match.

/** What a medicine is: printed before its name ("TAB.", "INJ." …). */
export const RX_FORMS = ['tab', 'cap', 'syrup', 'suspension', 'drops', 'inj', 'sachet', 'powder', 'pessary', 'suppository', 'cream', 'ointment', 'gel', 'lotion', 'spray', 'inhaler', 'other'];

/**
 * How often, in the Indian 1-0-1 style (morning – afternoon – night; the fourth place of 1-1-1-1 is the evening),
 * or in words. "custom": the doctor's own words (frequencyText).
 */
export const RX_FREQUENCIES = ['1-0-0', '0-1-0', '0-0-1', '1-0-1', '1-1-1', '1-1-1-1', 'sos', 'stat', 'weekly', 'alternate', 'custom'];

/** When to take it. */
export const RX_TIMINGS = ['', 'after_food', 'before_food', 'with_food', 'empty_stomach', 'bedtime'];

/** How it is given, when the form doesn't say it (e.g. an injection: IM or IV). */
export const RX_ROUTES = ['', 'oral', 'vaginal', 'rectal', 'im', 'iv', 'sc', 'sublingual', 'local'];

/** How long: a number of days, weeks or months, or until delivery, or continue until told otherwise. */
export const RX_DURATION_UNITS = ['', 'days', 'weeks', 'months', 'till_delivery', 'continue'];

// Measurements at a visit
export const URINE_GRADES = ['', 'nil', 'trace', '1+', '2+', '3+', '4+'];
export const PRESENTATIONS = ['', 'cephalic', 'breech', 'transverse', 'oblique', 'variable'];
export const FETAL_MOVEMENTS = ['', 'present', 'reduced', 'absent'];
export const OEDEMA_GRADES = ['', 'none', 'mild', 'moderate', 'severe'];

// ---------- Printed prescription designs (each doctor chooses one) ----------

/** The 10 designs, in the order the design page shows them. */
export const RX_DESIGNS = ['classic', 'letterhead', 'two_column', 'table', 'dose_chart', 'side_band', 'pregnancy', 'preprinted', 'half_page', 'minimal'];
/** Accent colours (print tokens --rx-* in the website's tokens.css). */
export const RX_ACCENTS = ['indigo', 'teal', 'maroon', 'green', 'charcoal'];
/** Print fonts: the Perinexa font, or a plain sans-serif or serif one. */
export const RX_FONTS = ['standard', 'sans', 'serif'];
/** Space between lines on the printed prescription. */
export const RX_LINE_SPACINGS = ['compact', 'standard', 'relaxed'];
/** Section titles a doctor may write in their own words (empty: the printed words in English and the chosen language). */
export const RX_TITLES = ['medicines', 'instructions', 'tests', 'advice', 'nextVisit'];
/** Parts of the visit the doctor can choose to print or leave out. The private note is never printed. */
// history: the history-taking sheet's lines, printed on every visit's page (docs/HISTORY_SHEET_LAYOUT.md section 10)
export const RX_SHOW = ['history', 'vitals', 'complaints', 'examination', 'diagnosis', 'investigations', 'advice', 'nextVisit', 'planItems', 'pregnancy', 'signature', 'rxSymbol'];
