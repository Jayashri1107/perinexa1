// An error with an HTTP status code and a message that is safe to show to the user.
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
