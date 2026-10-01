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
   * Locks a single inventory row using PostgreSQL row-level locking (SELECT ... FOR UPDATE)
   * within an active transaction.
   */
  public async lockByProductId(
    tx: Prisma.TransactionClient,
    productId: string
  ): Promise<Inventory | null> {
    const rows = await tx.$queryRaw<Inventory[]>`
      SELECT id, "productId", quantity, "reservedQuantity", version, "createdAt", "updatedAt"
      FROM "inventories"
      WHERE "productId" = ${productId}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  /**
   * Atomically increments the reservedQuantity on an inventory row within an active transaction.
   */
  public async incrementReservedQuantity(
    tx: Prisma.TransactionClient,
    id: string,
    quantity: number
  ): Promise<Inventory> {
    return tx.inventory.update({
      where: { id },
      data: {
        reservedQuantity: { increment: quantity },
        version: { increment: 1 },
      },
    });
  }

  /**
   * Atomically decrements the reservedQuantity on an inventory row within an active transaction.
   */
  public async decrementReservedQuantity(
    tx: Prisma.TransactionClient,
    id: string,
    quantity: number
  ): Promise<Inventory> {
    return tx.inventory.update({
      where: { id },
      data: {
        reservedQuantity: { decrement: quantity },
        version: { increment: 1 },
      },
    });
  }

  /**
   * Records an inventory movement audit trail within an active transaction.
   */
  public async createMovement(
    tx: Prisma.TransactionClient,
    data: {
      productId: string;
      type: InventoryMovementType;
      quantity: number;
      referenceType: string;
      referenceId?: string | null;
    }
  ): Promise<InventoryMovement> {
    return tx.inventoryMovement.create({
      data: {
        productId: data.productId,
        type: data.type,
        quantity: data.quantity,
        referenceType: data.referenceType,
        referenceId: data.referenceId ?? null,
      },
    });
  }
}

export const inventoryRepository = new InventoryRepository();
