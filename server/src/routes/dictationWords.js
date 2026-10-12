import { Router } from 'express';
import { z } from 'zod';
import { DictationWord } from '../models/DictationWord.js';
import { CONDITIONS, PAST_COMPLICATIONS } from '../models/Patient.js';
import { HttpError } from '../utils/httpError.js';
import { mentionsFetalSex } from '../utils/pcpndt.js';
import { idParams, parse } from '../utils/validate.js';

// The logged-in person's own voice-entry words ("My settings → Voice words"). Only their own words are ever
// read or changed. A meaning is one of a fixed set (a tick box, or a short label for "Other conditions" or the
// notes), so nothing else – and no patient details – can be stored here. The website's answers to its checks
// ("value:ageYears=28") hold a patient's value and are never accepted.

const MAX_WORDS = 500;
// Words that must never be learned: they would change a result or a "no" ("known" → ignore would hide "known
// reactive"), or a correction. A number is a patient's value, never a word. (The same list is in the website's
// obgyTerms.js.)
const BLOCKED_WORDS = new Set(['no', 'not', 'non', 'none', 'nil', 'known', 'on', 'positive', 'negative', 'reactive', 'sorry']);
// The phrase is already in lower case here; it is split on anything that is not a letter, so "no." or "non/reactive" is caught too
const isBlocked = (phrase) => /\d/.test(phrase) || phrase.split(/[^a-z]+/).some((w) => BLOCKED_WORDS.has(w));
const LABEL = "[A-Za-z0-9 ()/.,+'&-]{1,60}";
const MEANING = new RegExp(
  `^(?:condition:(?:${CONDITIONS.join('|')})|past:(?:${PAST_COMPLICATIONS.join('|')})|other:${LABEL}|note:${LABEL}|bloodgroup|scanedd|height-ftin|height-feet|ignore)$`,
);

const wordSchema = z.object({
  phrase: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Say which word')
    .max(40, 'Keep it to a short word or phrase')
    .regex(/^[a-z0-9][a-z0-9 .+/'-]*$/, "Only letters, numbers, spaces and . + / ' - are allowed")
    .refine((p) => p.split(/\s+/).length <= 4, 'Keep it to at most 4 words')
    .refine((p) => !isBlocked(p), "This word can't be kept: it could change a result or a “no”, or it has a number")
    // A baby's sex is never recorded in a pregnancy (PCPNDT Act), so such words are never kept either.
    // The phrase is already in lower case, so it is checked in upper case too (the "XY" / "XX" pattern needs it).
    .refine((p) => !mentionsFetalSex(p.toUpperCase()), "This word can't be kept"),
  meaning: z
    .string()
    .trim()
    .regex(MEANING, 'Please choose what the word means')
    // A note is free text that goes into the notes, so it is checked too ("other:" labels are built-in terms,
    // such as "Male factor infertility", and are left alone)
    .refine((m) => !m.startsWith('note:') || !mentionsFetalSex(m), "This meaning can't be kept"),
});

export const dictationWordsRouter = Router();

dictationWordsRouter.get('/', async (req, res) => {
  const words = await DictationWord.find({ userId: req.user._id }).sort({ phrase: 1 });
  res.json({ words });
});

// Add a word, or change what an existing one means.
dictationWordsRouter.put('/', async (req, res) => {
  const data = parse(wordSchema, req.body);
  const known = await DictationWord.exists({ userId: req.user._id, phrase: data.phrase });
  if (!known && (await DictationWord.countDocuments({ userId: req.user._id })) >= MAX_WORDS) {
    throw new HttpError(400, `You can keep up to ${MAX_WORDS} words. Remove some you no longer use first.`, 'VALIDATION');
  }
  const word = await DictationWord.findOneAndUpdate(
    { userId: req.user._id, phrase: data.phrase },
    { $set: { meaning: data.meaning } },
    { upsert: true, new: true, runValidators: true },
  );
  res.json({ word });
});

dictationWordsRouter.delete('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const { deletedCount } = await DictationWord.deleteOne({ _id: id, userId: req.user._id });
  if (!deletedCount) throw new HttpError(404, 'Word not found.', 'NOT_FOUND');
  res.status(204).end();
});
