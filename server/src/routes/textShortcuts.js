import { Router } from 'express';
import { z } from 'zod';
import { TextShortcut } from '../models/TextShortcut.js';
import { HttpError } from '../utils/httpError.js';
import { mentionsFetalSex } from '../utils/pcpndt.js';
import { idParams, parse } from '../utils/validate.js';

// The logged-in person's own typing shortcuts ("My settings → Typing shortcuts", doctor ideas #3). Only their own
// are ever read or changed. A baby's sex is never written in a pregnancy (PCPNDT Act), so such text is never kept.

const MAX_SHORTCUTS = 300;

const shortcutSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .transform((k) => k.replace(/^\./, ''))
    .pipe(z.string().min(1, 'Type the shortcut, e.g. fu2').max(20, 'Keep the shortcut short').regex(/^[a-z0-9]+$/, 'Only letters and numbers (it is typed after a dot)')),
  text: z
    .string()
    .trim()
    .min(1, 'Type the text it becomes')
    .max(1000, 'At most 1000 characters')
    .refine((t) => !mentionsFetalSex(t), "This text can't be kept"),
});

export const textShortcutsRouter = Router();

textShortcutsRouter.get('/', async (req, res) => {
  res.json({ shortcuts: await TextShortcut.find({ userId: req.user._id }).sort({ key: 1 }) });
});

// Add a shortcut, or change the text of an existing one.
textShortcutsRouter.put('/', async (req, res) => {
  const data = parse(shortcutSchema, req.body);
  const known = await TextShortcut.exists({ userId: req.user._id, key: data.key });
  if (!known && (await TextShortcut.countDocuments({ userId: req.user._id })) >= MAX_SHORTCUTS) {
    throw new HttpError(400, `You can keep up to ${MAX_SHORTCUTS} shortcuts. Remove some you no longer use first.`, 'VALIDATION');
  }
  const shortcut = await TextShortcut.findOneAndUpdate({ userId: req.user._id, key: data.key }, { $set: { text: data.text } }, { upsert: true, new: true, runValidators: true });
  res.json({ shortcut });
});

textShortcutsRouter.delete('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const { deletedCount } = await TextShortcut.deleteOne({ _id: id, userId: req.user._id });
  if (!deletedCount) throw new HttpError(404, 'Shortcut not found.', 'NOT_FOUND');
  res.status(204).end();
});
