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

  // Category & Product Domain Errors
  CATEGORY_NOT_FOUND = 'CATEGORY_NOT_FOUND',
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  DUPLICATE_CATEGORY = 'DUPLICATE_CATEGORY',
  DUPLICATE_PRODUCT = 'DUPLICATE_PRODUCT',
  DUPLICATE_SKU = 'DUPLICATE_SKU',
  INVALID_CATEGORY = 'INVALID_CATEGORY',
  CATEGORY_HAS_PRODUCTS = 'CATEGORY_HAS_PRODUCTS',

  // Inventory Domain Errors
  INVENTORY_NOT_FOUND = 'INVENTORY_NOT_FOUND',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  INVENTORY_BELOW_RESERVED_STOCK = 'INVENTORY_BELOW_RESERVED_STOCK',
  INVALID_STOCK_ADJUSTMENT = 'INVALID_STOCK_ADJUSTMENT',

  // Customer & Order Domain Errors
  CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND',
  INVALID_ORDER = 'INVALID_ORDER',
  ORDER_CREATION_FAILED = 'ORDER_CREATION_FAILED',

  // Idempotency Domain Errors
  IDEMPOTENCY_KEY_REQUIRED = 'IDEMPOTENCY_KEY_REQUIRED',
  INVALID_IDEMPOTENCY_KEY = 'INVALID_IDEMPOTENCY_KEY',
  IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED',

  // Authentication & Authorization Domain Errors
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_ACCESS_TOKEN = 'INVALID_ACCESS_TOKEN',
  ACCESS_TOKEN_EXPIRED = 'ACCESS_TOKEN_EXPIRED',
  INVALID_REFRESH_TOKEN = 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_EXPIRED = 'REFRESH_TOKEN_EXPIRED',
  REVOKED_REFRESH_TOKEN = 'REVOKED_REFRESH_TOKEN',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  ORDER_ACCESS_DENIED = 'ORDER_ACCESS_DENIED',
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',

  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Order Lifecycle & Cancellation Domain Errors
  ORDER_CANCELLATION_NOT_ALLOWED = 'ORDER_CANCELLATION_NOT_ALLOWED',
  ORDER_STATUS_TRANSITION_NOT_ALLOWED = 'ORDER_STATUS_TRANSITION_NOT_ALLOWED',
  ORDER_ALREADY_CANCELLED = 'ORDER_ALREADY_CANCELLED',
  STOCK_RESERVATION_NOT_FOUND = 'STOCK_RESERVATION_NOT_FOUND',
  INVALID_ORDER_STATUS = 'INVALID_ORDER_STATUS',
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

// ==========================================
// Category & Product Domain Errors
// ==========================================

export class CategoryNotFoundError extends AppError {
  constructor(message = 'Category not found') {
    super(404, ErrorCode.CATEGORY_NOT_FOUND, message, true);
  }
}

export class ProductNotFoundError extends AppError {
  constructor(message = 'Product not found') {
    super(404, ErrorCode.PRODUCT_NOT_FOUND, message, true);
  }
}

export class DuplicateCategoryError extends AppError {
  constructor(message = 'Category already exists') {
    super(409, ErrorCode.DUPLICATE_CATEGORY, message, true);
  }
}

export class DuplicateProductError extends AppError {
  constructor(message = 'Product with this slug already exists') {
    super(409, ErrorCode.DUPLICATE_PRODUCT, message, true);
  }
}

export class DuplicateSkuError extends AppError {
  constructor(message = 'Product with this SKU already exists') {
    super(409, ErrorCode.DUPLICATE_SKU, message, true);
  }
}

export class InvalidCategoryError extends AppError {
  constructor(message = 'Invalid category') {
    super(400, ErrorCode.INVALID_CATEGORY, message, true);
  }
}

export class CategoryHasProductsError extends AppError {
  constructor(message = 'Cannot delete category with associated products') {
    super(409, ErrorCode.CATEGORY_HAS_PRODUCTS, message, true);
  }
}

// ==========================================
// Inventory Domain Errors
// ==========================================

export class InventoryNotFoundError extends AppError {
  constructor(message = 'Inventory record not found') {
    super(404, ErrorCode.INVENTORY_NOT_FOUND, message, true);
  }
}

export class InsufficientStockError extends AppError {
  constructor(message = 'Insufficient stock') {
    super(409, ErrorCode.INSUFFICIENT_STOCK, message, true);
  }
}

export class InventoryBelowReservedStockError extends AppError {
  constructor(message = 'Cannot adjust inventory below reserved stock quantity') {
    super(409, ErrorCode.INVENTORY_BELOW_RESERVED_STOCK, message, true);
  }
}

export class InvalidStockAdjustmentError extends AppError {
  constructor(message = 'Invalid stock adjustment') {
    super(400, ErrorCode.INVALID_STOCK_ADJUSTMENT, message, true);
  }
}

// ==========================================
// Customer & Order Domain Errors
// ==========================================

export class CustomerNotFoundError extends AppError {
  constructor(message = 'Customer not found') {
    super(404, ErrorCode.CUSTOMER_NOT_FOUND, message, true);
  }
}

export class InvalidOrderError extends AppError {
  constructor(message = 'Invalid order data', details?: unknown) {
    super(400, ErrorCode.INVALID_ORDER, message, true, details);
  }
}

export class OrderCreationFailedError extends AppError {
  constructor(message = 'Failed to create order', details?: unknown) {
    super(500, ErrorCode.ORDER_CREATION_FAILED, message, false, details);
  }
}

// ==========================================
// Idempotency Domain Errors
// ==========================================

export class IdempotencyKeyRequiredError extends AppError {
  constructor(message = 'Idempotency-Key header is required') {
    super(400, ErrorCode.IDEMPOTENCY_KEY_REQUIRED, message, true);
  }
}

export class InvalidIdempotencyKeyError extends AppError {
  constructor(message = 'Idempotency-Key header must be between 1 and 255 characters') {
    super(400, ErrorCode.INVALID_IDEMPOTENCY_KEY, message, true);
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor(message = 'The idempotency key was already used with a different request') {
    super(409, ErrorCode.IDEMPOTENCY_KEY_REUSED, message, true);
  }
}

// ==========================================
// Authentication & Authorization Domain Errors
// ==========================================

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Invalid email or password') {
    super(401, ErrorCode.INVALID_CREDENTIALS, message, true);
  }
}

export class EmailAlreadyExistsError extends AppError {
  constructor(message = 'User with this email already exists') {
    super(409, ErrorCode.EMAIL_ALREADY_EXISTS, message, true);
  }
}

export class InvalidAccessTokenError extends AppError {
  constructor(message = 'Invalid access token') {
    super(401, ErrorCode.INVALID_ACCESS_TOKEN, message, true);
  }
}

export class AccessTokenExpiredError extends AppError {
  constructor(message = 'Access token has expired') {
    super(401, ErrorCode.ACCESS_TOKEN_EXPIRED, message, true);
  }
}

export class InvalidRefreshTokenError extends AppError {
  constructor(message = 'Invalid refresh token') {
    super(401, ErrorCode.INVALID_REFRESH_TOKEN, message, true);
  }
}

export class RefreshTokenExpiredError extends AppError {
  constructor(message = 'Refresh token has expired') {
    super(401, ErrorCode.REFRESH_TOKEN_EXPIRED, message, true);
  }
}

export class RevokedRefreshTokenError extends AppError {
  constructor(message = 'Refresh token has been revoked') {
    super(401, ErrorCode.REVOKED_REFRESH_TOKEN, message, true);
  }
}

export class UserNotFoundError extends AppError {
  constructor(message = 'User not found') {
    super(404, ErrorCode.USER_NOT_FOUND, message, true);
  }
}

export class OrderAccessDeniedError extends AppError {
  constructor(message = 'You do not have permission to access this order') {
    super(403, ErrorCode.ORDER_ACCESS_DENIED, message, true);
  }
}

export class OrderNotFoundError extends AppError {
  constructor(message = 'Order not found') {
    super(404, ErrorCode.ORDER_NOT_FOUND, message, true);
  }
}

export class OrderCancellationNotAllowedError extends AppError {
  constructor(message = 'Order cannot be cancelled in its current status') {
    super(422, ErrorCode.ORDER_CANCELLATION_NOT_ALLOWED, message, true);
  }
}

export class OrderStatusTransitionNotAllowedError extends AppError {
  constructor(message = 'Order status transition is not allowed') {
    super(422, ErrorCode.ORDER_STATUS_TRANSITION_NOT_ALLOWED, message, true);
  }
}

export class OrderAlreadyCancelledError extends AppError {
  constructor(message = 'Order has already been cancelled') {
    super(409, ErrorCode.ORDER_ALREADY_CANCELLED, message, true);
  }
}

export class StockReservationNotFoundError extends AppError {
  constructor(message = 'Stock reservation not found') {
    super(404, ErrorCode.STOCK_RESERVATION_NOT_FOUND, message, true);
  }
}

export class InvalidOrderStatusError extends AppError {
  constructor(message = 'Invalid order status') {
    super(400, ErrorCode.INVALID_ORDER_STATUS, message, true);
  }
}
