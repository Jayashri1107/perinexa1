// The type of care said aloud on the New patient chooser (owner, 16 Oct 2026: "when I speak, that also gets selected").
// "Pregnancy, Asha Sample, 28 …" opens the antenatal form with the rest read into it. The type's own name wins
// ("antenatal", "gynaecology"); otherwise the words that point to one ("pregnant", "miscarriage", "IVF", "after
// delivery"). Newborn and a pregnancy type said together is never guessed: what was said in pregnancy care must never
// be read by the newborn rules (PCPNDT) – the person chooses.
import { CARE_TYPES } from './patientFormat.js';

const w = (words) => new RegExp(`\\b(?:${words})\\b`, 'i');

// The type's own name ("… care", "… patient" included)
const NAMED = {
  antenatal: w('ante\\s?natal|anc|pregnancy\\s+care'),
  postnatal: w('post\\s?natal|pnc|post\\s?partum'),
  infertility: w('infertility|fertility'),
  gynaecology: w('gyn(?:a?e)?(?:cology)?|gyna?ecological|gyne'),
  abortion: w('abortion\\s+care|pregnancy\\s+loss'),
  newborn: w('new\\s?born|neonate|neonatal'),
};
// Words that point to one, strongest first
const CLUES = [
  ['abortion', w('abortion|miscarriage|miscarried|mtp|ectopic|molar\\s+pregnancy|missed\\s+abortion|blighted\\s+ovum')],
  ['postnatal', w('after\\s+(?:her\\s+)?delivery|delivered|puerperium|puerperal|lscs\\s+done|post\\s+delivery')],
  ['newborn', w('baby\\s+of|b/o')],
  ['antenatal', w('pregnant|pregnancy|lmp|weeks?\\s+pregnant|primi(?:gravida)?|g\\d\\s?p\\d|edd')],
  ['infertility', w('ivf|iui|icsi|trying\\s+to\\s+conceive|ttc|not\\s+conceiving|unable\\s+to\\s+conceive')],
  ['gynaecology', w('white\\s+discharge|menopause|irregular\\s+periods|heavy\\s+periods|fibroid|pap\\s+smear')],
];
const NOT_PREGNANT = /\b(?:not|never)\s+(?:been\s+)?pregnant\b|\bno\s+pregnancy\b/gi;
const PREGNANCY_TYPES = ['antenatal', 'postnatal', 'infertility', 'abortion'];

/** What was said → { careType } (one found), { careType: null, candidates } (unclear) or { careType: null, candidates: [] }. */
export function careTypeFromSpeech(text) {
  const said = String(text ?? '').replace(NOT_PREGNANT, ' ');
  const named = CARE_TYPES.filter((t) => NAMED[t].test(said));
  const clues = CLUES.filter(([, rx]) => rx.test(said)).map(([t]) => t);
  const all = [...new Set([...named, ...clues])];
  // Newborn with any pregnancy type: the person chooses
  if (all.includes('newborn') && all.some((t) => PREGNANCY_TYPES.includes(t))) return { careType: null, candidates: all };
  if (named.length === 1) return { careType: named[0], candidates: named };
  if (named.length > 1) return { careType: null, candidates: named };
  return { careType: clues[0] ?? null, candidates: clues };
}

// "Pregnancy, Asha Sample …": the type of care said first is taken off before the form reads the rest (else it is
// read as part of her name). Only the type's own words, never a detail ("pregnant", "IVF", "miscarriage" stay).
const LEADING =
  /^\s*(?:(?:a|new)\s+)?(?:patient\s+)?(?:for\s+)?(?:ante\s?natal|anc|pregnancy|post\s?natal|pnc|post\s?partum|infertility|fertility|gyn(?:a?e)?(?:cology)?|gyne|abortion\s+care|pregnancy\s+loss|new\s?born|neonate)(?:\s+(?:care|patient|case|registration))?\s*[,.:;-]?\s*/i;
export const withoutCareTypeWords = (text) => String(text ?? '').replace(LEADING, '');
