import { IdempotencyKey, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

export interface CreateIdempotencyKeyData {
  key: string;
  customerId: string;
  requestHash: string;
  expiresAt: Date;
}

export class IdempotencyRepository {
  /**
   * Finds an idempotency record by customer ID and key.
   */
  public async findByCustomerAndKey(
    customerId: string,
    key: string,
    tx?: Prisma.TransactionClient
  ): Promise<IdempotencyKey | null> {
    const client = tx ?? prisma;
    return client.idempotencyKey.findUnique({
      where: {
        customerId_key: {
          customerId,
          key,
        },
      },
    });
  }

  /**
   * Creates/claims an idempotency key record within an active transaction.
   */
  public async createKey(
    tx: Prisma.TransactionClient,
    data: CreateIdempotencyKeyData
  ): Promise<IdempotencyKey> {
    return tx.idempotencyKey.create({
      data: {
        key: data.key,
        customerId: data.customerId,
        requestHash: data.requestHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Stores the final HTTP status and response JSON payload within the active transaction before commit.
   */
  public async storeResponse(
    tx: Prisma.TransactionClient,
    customerId: string,
    key: string,
    responseStatus: number,
    responseBody: unknown
  ): Promise<IdempotencyKey> {
    return tx.idempotencyKey.update({
      where: {
        customerId_key: {
          customerId,
          key,
        },
      },
      data: {
        responseStatus,
        responseBody: responseBody as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Deletes an expired idempotency record.
   */
  public async deleteKey(id: string): Promise<void> {
    await prisma.idempotencyKey.delete({
      where: { id },
    });
  }
}

export const idempotencyRepository = new IdempotencyRepository();
