const AppError = require('../errors/AppError');

/**
 * Lightweight request validator.
 * schema: { body?: fn, query?: fn, params?: fn }
 * Each fn receives the object and should return { value } or throw/return { error }.
 */
const validate = (schema = {}) => (req, res, next) => {
  try {
    for (const key of ['body', 'query', 'params']) {
      if (typeof schema[key] !== 'function') continue;

      const result = schema[key](req[key]);

      if (result?.error) {
        throw new AppError(result.error, 400);
      }

      if (result?.value !== undefined) {
        req[key] = result.value;
      }
    }

    next();
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 400));
  }
};

module.exports = validate;
