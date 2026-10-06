import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { HttpError } from '../core/httpError.js';

// Which unique index broke → which form field and message. Each model's unique fields are listed once here.
const DUPLICATE_MESSAGES = {
  email: ['email', 'A user with this email already exists.'],
  nameKey: ['name', 'A hospital with this name already exists.'],
  code: ['code', 'This code is already in use.'],
  'type,code': ['code', 'This code is already used in this list.'],
  'hospitalId,userId': ['email', 'This person is already a member of this hospital.'],
  'hospitalId,doctorId': ['doctorId', 'This doctor already has OPD timings here. Reload the page.'],
  isPrimary: ['accountType', 'There is already a main super admin.'],
  'hospitalId,code': ['code', 'This code is already in use in this hospital.'],
  'hospitalId,nameKey': ['name', 'This name is already on the list.'],
  'hospitalId,supplierId,invoiceNumber': ['invoiceNumber', 'This invoice of this supplier is already recorded.'],
};

export function notFound(_req, _res, next) {
  next(new HttpError(404, 'Not found.', 'NOT_FOUND'));
}

// One place that turns every error into a clear, safe JSON answer.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
    return res.status(400).json({ error: { message: 'Please check the highlighted fields.', code: 'VALIDATION', fields } });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { message: err.message, code: err.code, ...(err.fields && { fields: err.fields }), ...err.extra },
    });
  }

  if (err instanceof mongoose.Error.VersionError) {
    return res.status(409).json({ error: { message: 'This record was just changed by someone else. Please reload and try again.', code: 'CONFLICT' } });
  }

  if (err?.code === 11000) {
    const key = Object.keys(err.keyPattern ?? {}).join(',');
    const [field, message] = DUPLICATE_MESSAGES[key] ?? ['value', 'This value is already in use.'];
    return res.status(409).json({ error: { message, code: 'DUPLICATE', fields: { [field]: message } } });
  }

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'This is too large to send in one go.', code: 'TOO_LARGE' } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'The request data was not valid JSON.', code: 'BAD_JSON' } });
  }

  // Unexpected: details stay in the server log, never in the browser.
  console.error(err);
  res.status(500).json({ error: { message: 'Something went wrong on our side. Please try again.', code: 'SERVER_ERROR' } });
}
