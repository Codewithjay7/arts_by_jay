import { ZodError } from 'zod';
import ApiError from '../utils/ApiError.js';

const flatten = (error) =>
  Object.fromEntries(
    error.issues.map((issue) => [issue.path.join('.') || '_', issue.message]),
  );

/**
 * Validates and REPLACES the given request part with the parsed result, so
 * handlers only ever see known, coerced fields. Unknown keys are stripped,
 * which is what stops a client from posting `role: "admin"` into a profile
 * update and having it reach the database.
 */
const validate = (schema, part = 'body') => (req, _res, next) => {
  try {
    req[part] = schema.parse(req[part] ?? {});
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      next(ApiError.unprocessable('Some fields need attention.', {
        code: 'VALIDATION_ERROR',
        details: flatten(err),
      }));
      return;
    }
    next(err);
  }
};

export default validate;
export const validateBody = (schema) => validate(schema, 'body');
export const validateQuery = (schema) => validate(schema, 'query');
export const validateParams = (schema) => validate(schema, 'params');
