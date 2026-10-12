import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';

export function notFound(_req, _res, next) {
  next(new HttpError(404, 'Not found.', 'NOT_FOUND'));
}

// One place that turns every error into a clear, safe JSON response.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    return res.status(400).json({ error: { message: 'Please check the highlighted fields.', code: 'VALIDATION', fields } });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code, ...(err.fields ? { fields: err.fields } : {}) } });
  }

  // Someone else saved the same record at the same moment.
  if (err instanceof mongoose.Error.VersionError) {
    return res.status(409).json({ error: { message: 'This record was just changed by someone else. Please reload the page and try again.', code: 'CONFLICT' } });
  }

  if (err?.code === 11000) {
    const key = Object.keys(err.keyPattern ?? {}).join(',');
    const known = {
      email: ['email', 'A user with this email already exists.'],
      nameKey: ['name', 'A hospital with this name already exists.'],
      'tenantId,userId': ['email', 'This person is already a member of this hospital.'],
      // Pharmacy: two people gave the same barcode to two medicines at the same moment (routes/pharmacy.js checks first)
      'tenantId,barcodes': ['barcodes', 'This barcode is already on another medicine. A barcode belongs to one medicine only.'],
    };
    const [field, message] = known[key] ?? ['value', 'This value is already in use.'];
    return res.status(409).json({ error: { message, code: 'DUPLICATE', fields: { [field]: message } } });
  }

  // More data than this address accepts (the limits are set in app.js): said plainly, and not logged as a fault.
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'This is too large to send in one go. Please make it smaller and try again.', code: 'TOO_LARGE' } });
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'The request data was not valid JSON.', code: 'BAD_JSON' } });
  }

  // Unexpected problem: log the details on the server, but never leak them to the browser.
  console.error(err);
  res.status(500).json({ error: { message: 'Something went wrong on our side. Please try again.', code: 'SERVER_ERROR' } });
}
