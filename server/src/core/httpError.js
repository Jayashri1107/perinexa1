// An error with an HTTP status and a short code the website can act on.
export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', fields = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const notFoundError = (what) => new HttpError(404, `${what} not found.`, 'NOT_FOUND');

export const fieldError = (field, message, code = 'VALIDATION') => new HttpError(400, message, code, { [field]: message });
