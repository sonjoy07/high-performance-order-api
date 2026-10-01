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
