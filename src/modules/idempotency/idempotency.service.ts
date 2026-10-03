import { config } from '../../config/env';
import { IdempotencyKeyReusedError } from '../../common/errors/app.error';
import { CreateOrderItemInput } from '../orders/order.types';
import {
  IdempotencyRepository,
  idempotencyRepository as defaultIdempotencyRepo,
} from './idempotency.repository';
import {
  calculateRequestHash,
  createCanonicalOrderPayload,
  validateIdempotencyKey,
} from './idempotency.utils';
import { CanonicalOrderPayload, IdempotencyResult } from './idempotency.types';

export class IdempotencyService {
  constructor(private readonly repo: IdempotencyRepository = defaultIdempotencyRepo) {}

  /**
   * Validates the client header, canonicalizes payload, and computes the deterministic SHA-256 hash.
   */
  public prepareIdempotency(
    keyHeader: unknown,
    customerId: string,
    items: CreateOrderItemInput[]
  ): {
    key: string;
    canonicalPayload: CanonicalOrderPayload;
    requestHash: string;
  } {
    const key = validateIdempotencyKey(keyHeader);
    const canonicalPayload = createCanonicalOrderPayload(customerId, items);
    const requestHash = calculateRequestHash(canonicalPayload);

    return {
      key,
      canonicalPayload,
      requestHash,
    };
  }

  /**
   * Computes the expiration date based on the configured IDEMPOTENCY_KEY_TTL_HOURS.
   */
  public getExpirationDate(): Date {
    const ttlMs = config.IDEMPOTENCY_KEY_TTL_HOURS * 60 * 60 * 1000;
    return new Date(Date.now() + ttlMs);
  }

  /**
   * Checks for an existing idempotency record before transaction.
   * If expired, removes the stale record and returns null.
   * If hash matches and response is present, returns the cached response.
   * If hash differs, throws 409 IDEMPOTENCY_KEY_REUSED.
   */
  public async checkExisting<T>(
    customerId: string,
    key: string,
    requestHash: string
  ): Promise<IdempotencyResult<T> | null> {
    const existing = await this.repo.findByCustomerAndKey(customerId, key);
    if (!existing) {
      return null;
    }

    // Check expiration
    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.repo.deleteKey(existing.id);
      return null;
    }

    // Check for key misuse with different payload
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyKeyReusedError(
        'The idempotency key was already used with a different request'
      );
    }

    // If previous response is already persisted, return it
    if (existing.responseStatus !== null && existing.responseBody !== null) {
      return {
        isExisting: true,
        statusCode: existing.responseStatus,
        data: existing.responseBody as T,
      };
    }

    return null;
  }
}

export const idempotencyService = new IdempotencyService();
