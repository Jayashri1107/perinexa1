// Shared building blocks for checking what the browser sends.
import mongoose from 'mongoose';
import { z } from 'zod';

export const parse = (schema, data) => schema.parse(data ?? {});

// An empty box (or a hidden field sent as "") counts as "not given".
export const optional = (schema) =>
  z.preprocess((v) => (v === '' || v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v), schema.optional());

export const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

export const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

export const idParams = z.object({ id: objectId });

export const name = (label = 'Name', max = 100) =>
  z.string().trim().min(2, `${label} must be at least 2 characters`).max(max, `${label} is too long`);

export const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));

export const optionalText = (max) => z.string().trim().max(max, 'This is too long').default('');

export const statusBody = z.object({ isActive: z.boolean('isActive must be true or false') });

// Text typed into a search box is used as plain text, never as a pattern.
export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const containsText = (text) => new RegExp(escapeRegex(text), 'i');
