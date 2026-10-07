// Picks a new patient's details out of what was said (or typed), in the browser – simple rules, not AI, nothing sent
// anywhere. Understands sentences such as:
//   "Name Asha Patil, 28 years, female, phone 98765 43210, from Pune, pregnant, last period 5 August, doctor Mehta,
//    agrees to reminders"
// Returns { values: the fields it is sure of, understood: [{ label, text }] }. Staff check every field before saving.
// PC-PNDT: nothing about a baby's sex before birth is read here (this is the patient's own sex).

const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// Words that start another detail: a name or a city ends before them.
const STOP = '(?=,|\\.|\\b(?:age|aged|years?|yrs|year old|phone|mobile|number|contact|from|lives|living|city|village|lmp|last|period|female|male|woman|man|girl|boy|doctor|dr|pregnant|pregnancy|antenatal|postnatal|newborn|baby|gynae|gyne|infertility|miscarriage|abortion|agrees|whatsapp|reminders?|abha)\\b|$)';

// "twenty eight" → "28", "double five" → "55", spoken digits joined.
function wordsToDigits(text) {
  let t = ` ${text.toLowerCase()} `;
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g, (_, a, b) => String(NUMBER_WORDS[a] + NUMBER_WORDS[b]));
  t = t.replace(/\b(double|triple)\s+(\w+)\b/g, (_, k, w) => (w in NUMBER_WORDS && NUMBER_WORDS[w] < 10 ? String(NUMBER_WORDS[w]).repeat(k === 'double' ? 2 : 3) : `${k} ${w}`));
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, (w) => String(NUMBER_WORDS[w]));
  return t.replace(/\s+/g, ' ').trim();
}

const title = (s) => s.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// "5 august", "august 5th", "5/8/2026" → "2026-08-05" (the year: this one, or last year if that date is ahead).
function dateFrom(text) {
  const now = new Date();
  const guessYear = (m, d) => (new Date(now.getFullYear(), m - 1, d) > now ? now.getFullYear() - 1 : now.getFullYear());
  let m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:\\s+(\\d{4}))?`).exec(text);
  if (m) {
    const month = MONTHS.findIndex((x) => x.startsWith(m[2].slice(0, 3))) + 1;
    return iso(m[3] ? Number(m[3]) : guessYear(month, Number(m[1])), month, Number(m[1]));
  }
  m = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`).exec(text);
  if (m) {
    const month = MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3))) + 1;
    return iso(m[3] ? Number(m[3]) : guessYear(month, Number(m[2])), month, Number(m[2]));
  }
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(text);
  if (m) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

export function patientFromSpeech(raw, { careTypes, doctors }) {
  const text = wordsToDigits(raw);
  const values = {};
  const understood = [];
  const take = (key, value, label, shown = value) => {
    if (value === null || value === undefined || value === '') return;
    values[key] = value;
    understood.push({ key, label, text: String(shown) });
  };

  // Name: after "name (is)" / "patient", else the words before the first detail at the start
  let m = new RegExp(`\\bname(?:\\s+is)?\\s+([a-z][a-z .'-]{1,80}?)\\s*${STOP}`).exec(text) ?? new RegExp(`\\b(?:patient(?:\\s+is)?|this is)\\s+([a-z][a-z .'-]{1,80}?)\\s*${STOP}`).exec(text);
  if (m) take('name', title(m[1]), 'Name');

  m = /\b(?:age(?:d)?\s*(?:is)?\s*)(\d{1,3})\b|\b(\d{1,3})\s*(?:years?|yrs)(?:\s*old)?\b/.exec(text);
  const age = m && Number(m[1] ?? m[2]);
  if (age && age < 120) take('ageYears', age, 'Age', `${age} years`);

  // Phone: 10 digits (spaces allowed), an optional +91 / 0 in front
  const digits = text.replace(/(\d)[\s-]+(?=\d)/g, '$1');
  m = /(?:\+?91|0)?([6-9]\d{9})\b/.exec(digits);
  if (m) take('phone', m[1], 'Phone');
  m = /\babha(?:\s+number)?\s*(?:is)?\s*(\d{14})\b/.exec(digits);
  if (m) take('abhaNumber', m[1], 'ABHA number');

  if (/\b(female|woman|lady|girl)\b/.test(text)) take('sex', 'female', 'Sex', 'Female');
  else if (/\b(male|man|boy|gentleman)\b/.test(text)) take('sex', 'male', 'Sex', 'Male');

  m = new RegExp(`\\b(?:from|lives in|living in|resident of|city|village)\\s+([a-z][a-z ]{1,40}?)\\s*${STOP}`).exec(text);
  if (m) take('address.city', title(m[1]), 'City / village');

  const CARE = [
    [/\b(pregnan\w*|antenatal|anc|expecting)\b/, 'antenatal'],
    [/\b(postnatal|after delivery|delivered)\b/, 'postnatal'],
    [/\b(newborn|new born|baby)\b/, 'newborn'],
    [/\b(miscarriage|abortion|pregnancy loss)\b/, 'pregnancy_loss'],
    [/\b(infertility|trying to conceive)\b/, 'infertility'],
    [/\b(gynae\w*|gyne\w*|gynecology)\b/, 'gynaecology'],
  ];
  const care = CARE.find(([re]) => re.test(text));
  if (care && careTypes.some((c) => c.key === care[1])) take('careType', care[1], 'Type of care', careTypes.find((c) => c.key === care[1]).label);

  m = /\b(?:lmp|last (?:menstrual )?period)(?:\s+(?:was|on|is))?\s+(.{3,30})/.exec(text);
  const lmp = m && dateFrom(m[1]);
  if (lmp) take('lmp', lmp, 'Last period (LMP)', new Date(`${lmp}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));

  m = /\b(?:doctor|dr\.?)\s+([a-z]+(?:\s+[a-z]+)?)/.exec(text);
  if (m) {
    const said = m[1].toLowerCase();
    const doctor = doctors.find((d) => d.label.toLowerCase().split(/\s+/).some((w) => w.length > 2 && said.split(' ').includes(w)));
    if (doctor) take('assignedDoctorId', doctor.value, 'Her doctor', doctor.label);
  }

  if (/\b(agrees?|yes)\b.{0,20}\b(reminders?|messages?|whatsapp|sms)\b|\b(reminders?|whatsapp|sms)\b.{0,10}\byes\b/.test(text)) take('consentMessages', true, 'Reminders', 'Agrees');

  return { values, understood };
}
