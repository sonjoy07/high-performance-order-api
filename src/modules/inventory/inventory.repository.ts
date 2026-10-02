import { Inventory, InventoryMovement, InventoryMovementType, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

export interface FindMovementsParams {
  productId: string;
  skip: number;
  take: number;
  type?: InventoryMovementType;
  from?: Date;
  to?: Date;
}

export interface StockAdjustmentData {
  productId: string;
  newQuantity: number;
  movementType: InventoryMovementType;
  movementQuantity: number;
  reason?: string | null;
}

export interface ReservedQuantityDelta {
  productId: string;
  /** Signed change applied to `reservedQuantity` (negative to release). */
  delta: number;
}

export interface MovementInput {
  productId: string;
  type: InventoryMovementType;
  quantity: number;
  referenceType: string;
  referenceId?: string | null;
}

/** Columns returned by the locked inventory projection. */
const LOCKED_INVENTORY_COLUMNS = Prisma.sql`
  id, "productId", quantity, "reservedQuantity", version, "createdAt", "updatedAt"
`;

export class InventoryRepository {
  public async findByProductId(productId: string): Promise<Inventory | null> {
    return prisma.inventory.findUnique({
      where: { productId },
    });
  }

  public async findMovements(params: FindMovementsParams): Promise<[InventoryMovement[], number]> {
    const where: Prisma.InventoryMovementWhereInput = {
      productId: params.productId,
    };

    if (params.type) {
      where.type = params.type;
    }

    if (params.from || params.to) {
      where.createdAt = {
        ...(params.from ? { gte: params.from } : {}),
        ...(params.to ? { lte: params.to } : {}),
      };
    }

    const [movements, total] = await prisma.$transaction([
      prisma.inventoryMovement.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          productId: true,
          type: true,
          quantity: true,
          referenceType: true,
          referenceId: true,
          createdAt: true,
        },
      }),
      prisma.inventoryMovement.count({ where }),
    ]);

    return [movements, total];
  }

  /**
   * Executes an atomic stock adjustment with PostgreSQL row-level locking (SELECT ... FOR UPDATE).
   * Concurrently competing transactions will wait for the lock to be released, ensuring serializability
   * and preventing stale reads, overselling, and lost updates.
   */
  public async executeLockedAdjustment(
    productId: string,
    calculateNewState: (current: Inventory) => {
      newQuantity: number;
      movementQuantity: number;
      movementType: InventoryMovementType;
      reason?: string | null;
    }
  ): Promise<Inventory> {
    return prisma.$transaction(async (tx) => {
      // 1. Lock the inventory row exclusively for the duration of this transaction
      const rows = await tx.$queryRaw<Inventory[]>`
        SELECT id, "productId", quantity, "reservedQuantity", version, "createdAt", "updatedAt"
        FROM "inventories"
        WHERE "productId" = ${productId}
        FOR UPDATE
      `;

      const currentInventory = rows[0];
      if (!currentInventory) {
        throw new Error('INVENTORY_ROW_NOT_FOUND');
      }

      // 2. Compute state transition and validate business constraints with fresh locked values
      const { newQuantity, movementQuantity, movementType, reason } =
        calculateNewState(currentInventory);

      // 3. Atomically update inventory quantity and increment optimistic version
      const updatedInventory = await tx.inventory.update({
        where: { id: currentInventory.id },
        data: {
          quantity: newQuantity,
          version: { increment: 1 },
        },
      });

      // 4. Create audit trail ledger record
      await tx.inventoryMovement.create({
        data: {
          productId,
          type: movementType,
          quantity: movementQuantity,
          referenceType: 'MANUAL_ADJUSTMENT',
          referenceId: reason ?? null,
        },
      });

      return updatedInventory;
    });
  }

  /**
   * Locks many inventory rows in ONE statement (`SELECT ... FOR UPDATE`).
   *
   * N+1 FIX
   * ------
   * The previous implementation called `lockByProductId` once per order line, so an order
   * with N distinct products issued N round-trips that each returned a single row. This
   * method issues a single `WHERE "productId" = ANY(...)` statement regardless of N.
   *
   * DEADLOCK SAFETY
   * ---------------
   * Two concurrent orders containing overlapping products must not deadlock. `ORDER BY
   * "productId"` guarantees a single global lock order, and PostgreSQL places the
   * `LockRows` node above the `Sort`, so rows are locked in that sorted order rather than
   * in physical scan order. Callers must therefore pass `productIds` already de-duplicated;
   * sorting is applied here so no caller can get it wrong.
   *
   * A missing row is reported by the caller comparing `rows.length` against the requested
   * id count, because `FOR UPDATE` returns no row (and never null-padding) for absent keys.
   */
  public async lockByProductIds(
    tx: Prisma.TransactionClient,
    productIds: string[]
  ): Promise<Map<string, Inventory>> {
    const uniqueIds = Array.from(new Set(productIds)).sort((a, b) => a.localeCompare(b));

    if (uniqueIds.length === 0) {
      return new Map();
    }

    const rows = await tx.$queryRaw<Inventory[]>`
      SELECT ${LOCKED_INVENTORY_COLUMNS}
      FROM "inventories"
      WHERE "productId" = ANY(${uniqueIds}::text[])
      ORDER BY "productId"
      FOR UPDATE
    `;

    return new Map(rows.map((row) => [row.productId, row]));
  }

  /**
   * Applies signed `reservedQuantity` deltas to many inventory rows in ONE statement.
   *
   * N+1 FIX
   * ------
   * Replaces the per-item `incrementReservedQuantity` / `decrementReservedQuantity` calls.
   * The set-based `UPDATE ... FROM (VALUES ...)` keeps the arithmetic atomic per row (the
   * read-modify-write happens inside PostgreSQL, never in Node.js), so it is still safe
   * against lost updates even without relying on the earlier lock.
   *
   * The affected-row count is returned so the caller can detect a missing inventory row
   * instead of silently skipping it.
   */
  public async applyReservedQuantityDeltas(
    tx: Prisma.TransactionClient,
    deltas: ReservedQuantityDelta[]
  ): Promise<number> {
    if (deltas.length === 0) {
      return 0;
    }

    const values = deltas.map((entry) => Prisma.sql`(${entry.productId}, ${entry.delta}::integer)`);

    return tx.$executeRaw`
      UPDATE "inventories" AS i
      SET "reservedQuantity" = i."reservedQuantity" + v.delta,
          "version"           = i."version" + 1,
          "updatedAt"         = NOW()
      FROM (VALUES ${Prisma.join(values)}) AS v(product_id, delta)
      WHERE i."productId" = v.product_id
    `;
  }

  /**
   * Records many inventory movements in ONE statement (`createMany`).
   * Replaces the per-item `createMovement` call in order create/cancel flows.
   */
  public async createMovements(
    tx: Prisma.TransactionClient,
    movements: MovementInput[]
  ): Promise<number> {
    if (movements.length === 0) {
      return 0;
    }

    const result = await tx.inventoryMovement.createMany({
      data: movements.map((movement) => ({
        productId: movement.productId,
        type: movement.type,
        quantity: movement.quantity,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId ?? null,
      })),
    });

    return result.count;
  }
}

export const inventoryRepository = new InventoryRepository();
