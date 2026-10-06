// An error with an HTTP status and a short code the website can act on.
// extra: more data the screen needs to act on the error (for example the possible duplicates of a patient).
export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', fields = undefined, extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }
}

export const notFoundError = (what) => new HttpError(404, `${what} not found.`, 'NOT_FOUND');

export const fieldError = (field, message, code = 'VALIDATION') => new HttpError(400, message, code, { [field]: message });
