export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  CONFLICT = 'CONFLICT',
  BAD_REQUEST = 'BAD_REQUEST',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  DATABASE_ERROR = 'DATABASE_ERROR',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    errorCode: string,
    message: string,
    isOperational = true,
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    this.details = details;

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(400, ErrorCode.VALIDATION_ERROR, message, true, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, ErrorCode.UNAUTHENTICATED, message, true);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Access forbidden') {
    super(403, ErrorCode.FORBIDDEN, message, true);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, ErrorCode.RESOURCE_NOT_FOUND, message, true);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(409, ErrorCode.CONFLICT, message, true);
  }
}

export class BusinessLogicError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, ErrorCode.UNPROCESSABLE_ENTITY, message, true, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, ErrorCode.BAD_REQUEST, message, true, details);
  }
}

export class DatabaseError extends AppError {
  constructor(message = 'Database operation failed', details?: unknown) {
    super(500, ErrorCode.DATABASE_ERROR, message, false, details);
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Internal server error') {
    super(500, ErrorCode.INTERNAL_SERVER_ERROR, message, false);
  }
}
