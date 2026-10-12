// Makes client/src/pages/patients/realWordGuard.js (plan 2.5). Run it by hand, from the project folder, after changing
// the words the app knows (TERMS says/to, EXTRA_VOCAB, SAME_SPELLING or COMMON_WORDS in obgyTerms.js), how words are
// matched by sound (the "Matching words by sound" part of indianEnglish.js, and its number words), the "Did you mean"
// part of dictation.js, the words about the baby's sex (pcpndtWords.js), testdata/commonWords.txt,
// testdata/indianNames.txt or this script:
//
//   node client/scripts/make-word-guard.mjs
//
// It makes two lists:
//  - REAL_WORDS: the ordinary English words, Indian names and places that sound like a word the app knows, so voice
//    entry never "corrects" them by sound, and never asks "Did you mean …?" about them without a clinical word before.
//  - DICTATION_WORDS: everyday dictation words that fill nothing. A word heard that is nearly as close to one of them
//    as to a word the app knows is never changed by sound ("cephalis" may be cephalic).
// It needs the dictionary files of a Mac (/usr/share/dict/web2 and propernames). The file it makes keeps a short hash
// of what the lists depend on; a test (indianEnglish.test.js) says when that has changed, without needing the
// dictionary, so `npm test` works on Windows and Linux. Nothing about any patient is read or written.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { closestWord } from '../src/pages/patients/dictation.js';
import { changedBySound, soundVocabulary } from '../src/pages/patients/indianEnglish.js';
import { COMMON_WORDS, SAME_SPELLING, TERMS } from '../src/pages/patients/obgyTerms.js';
import { FETAL_SEX_WORDS, KARYOTYPE, SEX_SYMBOLS } from '../src/pcpndtWords.js';

const PATIENTS = new URL('../src/pages/patients/', import.meta.url);
const DICTIONARY = ['/usr/share/dict/web2', '/usr/share/dict/propernames'];
export const SOUND_START = '// ---------- Matching words by sound (plan 2.3 step 9 and 2.5) ----------';
export const SOUND_END = '// ---------- end of matching words by sound ----------';
export const TYPO_START = '// ---------- Did you mean (a word misheard or mistyped) ----------';
export const TYPO_END = '// ---------- end of did you mean ----------';

// Words said in Indian clinics that are not in the 1934 dictionary (web2)
const MODERN_WORDS = (
  'okay ok online offline email emails whatsapp mobile mobiles laptop computer internet website app apps software download ' +
  'prepone preponed prepones postpone upgrade update updated sonography ultrasound selfie cellphone smartphone teleconsult ' +
  'aadhaar aadhar ration pincode taluka tehsil panchayat anganwadi asha sevika dai auto rickshaw metro flyover township ' +
  'nagar colony chawl society bungalow flat tower apartment complex sector phase chowk naka bazaar mandi ' +
  'ji sir madam bhai didi behen bahu beti beta saas sasur devar jethani nanad mummy papa ' +
  'haan nahi achha theek bas yaar arre matlab abhi kal parson pehle baad mein hai tha thi hoga hogi ' +
  'tablet tablets syrup injection drip saline cannula catheter bottle strip sachet capsule capsules ointment'
).split(' ');
// Everyday words of OBGY dictation and scan reports that are not in testdata/commonWords.txt or COMMON_WORDS
const MORE_DICTATION_WORDS = 'conception condition abdomen opposite twice grams soft tender placement pleasant eclipse fabric perhaps collapse premium therapy hepatic level'.split(' ');

const text = (url) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
const listOf = (url) =>
  text(url)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
const slice = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end) + end.length);

/**
 * The hash of what the lists depend on: the sound-matching and "Did you mean" code, the words matched to (TERMS says,
 * EXTRA_VOCAB, number and month words) and which terms are results, SAME_SPELLING, COMMON_WORDS, the words about the
 * baby's sex, the word lists and this script.
 */
export function guardHash() {
  const { words, phrases } = soundVocabulary();
  const parts = [
    slice(text(new URL('indianEnglish.js', PATIENTS)), SOUND_START, SOUND_END),
    slice(text(new URL('dictation.js', PATIENTS)), TYPO_START, TYPO_END),
    JSON.stringify([...words.values()].map((e) => [e.plain, e.word, e.meaning, e.kind]).sort()),
    JSON.stringify(phrases.map((p) => [p.said, p.fixed, p.meaning, p.kind]).sort()),
    JSON.stringify(TERMS.map((t) => [t.to, t.says, Boolean(t.result)])),
    JSON.stringify(SAME_SPELLING),
    JSON.stringify([...COMMON_WORDS].sort()),
    String([FETAL_SEX_WORDS, KARYOTYPE, SEX_SYMBOLS]),
    text(new URL('testdata/commonWords.txt', PATIENTS)),
    text(new URL('testdata/indianNames.txt', PATIENTS)),
    text(new URL(import.meta.url)),
  ];
  return createHash('sha256').update(parts.join('\n\u0000\n')).digest('hex').slice(0, 16);
}

const plainOf = (w) =>
  String(w)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z]/g, '');
// A list of words as it is written in the file: lines of at most 112 characters
function setOf(list) {
  const lines = [];
  for (const w of list) {
    if (!lines.length || lines.at(-1).length + w.length + 1 > 112) lines.push(w);
    else lines[lines.length - 1] += ` ${w}`;
  }
  return `new Set(\n  [\n${lines.map((l) => `    '${l}',`).join('\n')}\n  ]\n    .join(' ')\n    .split(' '),\n)`;
}

function main() {
  const missing = DICTIONARY.filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`Needs the Mac dictionary files: ${missing.join(', ')}`);

  const words = new Set();
  const add = (w) => {
    const plain = plainOf(w);
    if (plain.length >= 4) words.add(plain);
  };
  // The dictionary, with the endings it leaves out (-s, -es, -ed, -ing, -er, -ly)
  const forms = (w) => {
    if (/(?:s|x|z|ch|sh)$/.test(w)) return [`${w}es`];
    if (/[^aeiou]y$/.test(w)) return [`${w.slice(0, -1)}ies`, `${w.slice(0, -1)}ied`, `${w}ing`, `${w.slice(0, -1)}ier`, `${w.slice(0, -1)}ily`];
    if (/e$/.test(w)) return [`${w}s`, `${w}d`, `${w.slice(0, -1)}ing`, `${w}r`, `${w}ly`];
    return [`${w}s`, `${w}ed`, `${w}ing`, `${w}er`, `${w}ly`];
  };
  for (const w of text(DICTIONARY[0]).split('\n')) {
    add(w);
    forms(w.toLowerCase()).forEach(add);
  }
  for (const w of text(DICTIONARY[1]).split('\n')) add(w);
  const commonWords = listOf(new URL('testdata/commonWords.txt', PATIENTS));
  for (const w of [...commonWords, ...listOf(new URL('testdata/indianNames.txt', PATIENTS)), ...COMMON_WORDS, ...MODERN_WORDS]) add(w);

  // Changed by sound, or asked about as a slip ("Did you mean …?", for words of 5 letters or more)
  const guard = [...words].filter((w) => changedBySound(w) || (w.length >= 5 && closestWord(w))).sort();

  // The everyday dictation words, without the words the app knows (and their -s forms)
  const vocab = soundVocabulary().words;
  const known = (w) => vocab.has(w) || (/s$/.test(w) && vocab.has(w.slice(0, -1))) || (/es$/.test(w) && vocab.has(w.slice(0, -2)));
  const everyday = [...new Set([...COMMON_WORDS, ...commonWords, ...MORE_DICTATION_WORDS].map(plainOf))].filter((w) => w.length >= 4 && !known(w)).sort();

  const out =
    '// Made by client/scripts/make-word-guard.mjs – do not change by hand. To make it again: node client/scripts/make-word-guard.mjs\n' +
    `export const GUARD_HASH = '${guardHash()}';\n` +
    '// The ordinary English words (the web2 dictionary with its -s/-es/-ed/-ing/-er/-ly forms, its proper names, and\n' +
    '// newer words), Indian names and places, and common dictation words that sound like a word the app knows, or look\n' +
    '// like a slip for one: matching by sound never changes them, and "Did you mean …?" needs a clinical word before\n' +
    `// them (plan 2.5). ${guard.length} of ${words.size} words.\n` +
    `export const REAL_WORDS = ${setOf(guard)};\n` +
    '// Everyday dictation words that fill nothing (COMMON_WORDS, testdata/commonWords.txt and a few more), without the\n' +
    `// words the app knows: a word heard nearly as close to one of them is never changed by sound. ${everyday.length} words.\n` +
    `export const DICTATION_WORDS = ${setOf(everyday)};\n`;
  writeFileSync(new URL('realWordGuard.js', PATIENTS), out);
  console.log(`realWordGuard.js: ${guard.length} guarded words, ${everyday.length} dictation words, ${Buffer.byteLength(out)} bytes`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
