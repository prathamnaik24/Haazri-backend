/**
 * Custom error class for operational errors with HTTP status codes.
 * Usage: throw new AppError('Not found', 404);
 *        throw new AppError('Already exists', 400, 'ORG_ALREADY_HAS_ROOT');
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = null) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;   // machine-readable code, e.g. 'ORG_ALREADY_HAS_ROOT'
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[Error] ${statusCode} - ${message}\nStack: ${err.stack}`);

  const body = {
    status: 'error',
    statusCode,
    message: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : message,
  };

  // Include machine-readable error code when present (always exposed, even in production)
  if (err.errorCode) {
    body.error = err.errorCode;
  }

  res.status(statusCode).json(body);
};

