import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, ErrorCode } from '../errors/app.error';
import { logger } from '../logger/logger';
import { config } from '../../config/env';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) {
    return _next(err);
  }

  // 1. Known operational AppErrors
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err }, `[AppError] ${err.message}`);
    } else {
      logger.warn(
        { err: { message: err.message, code: err.errorCode, details: err.details } },
        `[ClientError] ${err.message}`
      );
    }

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.errorCode,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
  }

  // 2. Zod validation errors
  if (err instanceof ZodError) {
    const formattedErrors = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    logger.warn({ issues: formattedErrors }, '[ValidationError] Request validation failed');

    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: formattedErrors,
      },
    });
  }

  // 3. Body-parser JSON syntax errors
  if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    err.type === 'entity.parse.failed'
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.BAD_REQUEST,
        message: 'Malformed JSON payload in request body',
      },
    });
  }

  // 4. Unexpected server errors
  logger.error({ err }, '[UnhandledError] Unexpected server error');

  return res.status(500).json({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message:
        config.NODE_ENV === 'production'
          ? 'Internal server error'
          : err.message || 'An unexpected error occurred',
    },
  });
};
