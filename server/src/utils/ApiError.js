/**
 * Operational error carrying an HTTP status. Anything thrown that is NOT an
 * ApiError is treated as a bug by the error handler and its message is hidden
 * from the client.
 */
export default class ApiError extends Error {
  constructor(status, message, { code = undefined, details = undefined } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Invalid request.', opts) {
    return new ApiError(400, message, opts);
  }

  static unauthorized(message = 'You must be signed in to do that.', opts) {
    return new ApiError(401, message, opts);
  }

  static forbidden(message = 'You do not have permission to do that.', opts) {
    return new ApiError(403, message, opts);
  }

  static notFound(message = 'Not found.', opts) {
    return new ApiError(404, message, opts);
  }

  static conflict(message = 'That conflicts with the current state.', opts) {
    return new ApiError(409, message, opts);
  }

  static unprocessable(message = 'That cannot be processed.', opts) {
    return new ApiError(422, message, opts);
  }

  static tooMany(message = 'Too many requests. Please slow down.', opts) {
    return new ApiError(429, message, opts);
  }

  static notConfigured(message = 'That feature is not configured on this server.', opts) {
    return new ApiError(503, message, { code: 'NOT_CONFIGURED', ...opts });
  }
}
