import crypto from 'crypto';
import {
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../common/errors/app.error';
import { CreateOrderItemInput } from '../orders/order.types';
import { mergeAndSortOrderItems } from '../orders/order.validation';
import { CanonicalOrderPayload } from './idempotency.types';

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * Validates and normalizes the client-provided Idempotency-Key header.
 */
export function validateIdempotencyKey(keyHeader: unknown): string {
  if (keyHeader === undefined || keyHeader === null || keyHeader === '') {
    throw new IdempotencyKeyRequiredError('Idempotency-Key header is required');
  }

  const rawKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;

  if (typeof rawKey !== 'string') {
    throw new InvalidIdempotencyKeyError('Idempotency-Key header must be a string');
  }

  const trimmed = rawKey.trim();

  if (trimmed.length === 0) {
    throw new IdempotencyKeyRequiredError('Idempotency-Key header cannot be empty');
  }

  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new InvalidIdempotencyKeyError(
      `Idempotency-Key header cannot exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`
    );
  }

  return trimmed;
}

/**
 * Creates a deterministic, canonical representation of the order creation request.
 * Duplicates are merged and products are sorted alphabetically so equivalent orders yield identical hashes.
 */
export function createCanonicalOrderPayload(
  customerId: string,
  items: CreateOrderItemInput[]
): CanonicalOrderPayload {
  const normalizedItems = mergeAndSortOrderItems(items);

  return {
    customerId,
    items: normalizedItems.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
  };
}

/**
 * Calculates a SHA-256 hash of the canonical request payload.
 * Server-generated timestamps, order numbers, and random IDs are strictly excluded.
 */
export function calculateRequestHash(payload: CanonicalOrderPayload): string {
  const serialized = JSON.stringify(payload);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}
