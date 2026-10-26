import mongoose from 'mongoose';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

export const notFoundHandler = (req, _res, next) => {
  next(ApiError.notFound(`No API route matches ${req.method} ${req.originalUrl}`));
};

/** Translates known error shapes into a stable client-facing envelope. */
export const errorHandler = (err, _req, res, _next) => {
  let status = 500;
  let message = 'Something went wrong on our end.';
  let code;
  let details;

  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
    code = err.code;
    details = err.details;
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 422;
    message = 'Some fields need attention.';
    code = 'VALIDATION_ERROR';
    details = Object.fromEntries(Object.entries(err.errors).map(([key, value]) => [key, value.message]));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = 'That identifier is not valid.';
    code = 'INVALID_ID';
  } else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    // body-parser rejected the payload. A malformed request body is the
    // caller's mistake, not a server fault, so it must not surface as a 500.
    status = 400;
    message = 'That request body is not valid JSON.';
    code = 'MALFORMED_JSON';
  } else if (err?.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'value';
    message =
      field === 'email'
        ? 'An account with that email already exists.'
        : `That ${field} is already in use.`;
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    message = 'That upload is too large.';
  }

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({
    error: {
      message,
      ...(code ? { code } : {}),
      ...(details ? { details } : {}),
      ...(env.isProd || status < 500 ? {} : { stack: err.stack }),
    },
  });
};
