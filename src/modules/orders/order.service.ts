import crypto from 'crypto';
import {
  Inventory,
  InventoryMovementType,
  OrderStatus,
  Prisma,
  ReservationStatus,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { config } from '../../config/env';
import { logger } from '../../common/logger/logger';
import {
  AppError,
  BusinessLogicError,
  CustomerNotFoundError,
  InsufficientStockError,
  InventoryNotFoundError,
  ProductNotFoundError,
} from '../../common/errors/app.error';
import {
  InventoryRepository,
  inventoryRepository as defaultInventoryRepo,
} from '../inventory/inventory.repository';
import {
  ProductRepository,
  productRepository as defaultProductRepo,
} from '../products/product.repository';
import { OrderRepository, orderRepository as defaultOrderRepo } from './order.repository';
import { CreateOrderInput, OrderResponseView } from './order.types';
import { mergeAndSortOrderItems } from './order.validation';

export class OrderService {
  constructor(
    private readonly orderRepo: OrderRepository = defaultOrderRepo,
    private readonly productRepo: ProductRepository = defaultProductRepo,
    private readonly inventoryRepo: InventoryRepository = defaultInventoryRepo
  ) {}

  /**
   * Generates a robust, collision-resistant unique order number.
   * Format: ORD-YYYYMMDD-XXXXXXXX (8 uppercase hex characters = 4.29 billion possibilities/day).
   */
  public generateOrderNumber(): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `ORD-${dateStr}-${randomHex}`;
  }

  /**
   * Coordinates the complete order creation and stock reservation workflow inside ONE PostgreSQL transaction.
   *
   * Transaction Flow:
   * 1. Normalize items: Merge duplicates and sort product IDs deterministically (Deadlock Prevention).
   * 2. BEGIN TRANSACTION
   * 3. Validate customer exists.
   * 4. Verify products exist and retrieve historical catalog prices.
   * 5. Lock inventory rows using SELECT ... FOR UPDATE in deterministic order.
   * 6. Validate stock availability (availableQuantity = quantity - reservedQuantity).
   * 7. Calculate total order amount with Decimal precision.
   * 8. Create Order and OrderItems (storing unitPrice at creation time).
   * 9. Increment reservedQuantity (physical stock is preserved).
   * 10. Create StockReservation records with configured expiration time.
   * 11. Create InventoryMovement records (type: RESERVATION, referenceType: ORDER).
   * 12. Create OrderStatusHistory record (fromStatus: null, toStatus: PENDING).
   * 13. COMMIT TRANSACTION
   */
  public async createOrder(input: CreateOrderInput): Promise<OrderResponseView> {
    // 1. Normalize and merge duplicate product IDs, then sort deterministically by productId
    const mergedItems = mergeAndSortOrderItems(input.items);
    const sortedProductIds = mergedItems.map((item) => item.productId);

    try {
      return await prisma.$transaction(async (tx) => {
        // Step A: Validate customer exists
        const customer = await this.orderRepo.findCustomerById(input.customerId, tx);
        if (!customer) {
          throw new CustomerNotFoundError(`Customer with ID "${input.customerId}" not found`);
        }

        // Step B: Verify products exist & retrieve historical prices
        const products = await this.productRepo.findByIds(sortedProductIds, tx);
        const productMap = new Map(products.map((p) => [p.id, p]));

        for (const item of mergedItems) {
          const product = productMap.get(item.productId);
          if (!product) {
            throw new ProductNotFoundError(`Product with ID "${item.productId}" not found`);
          }
          if (!product.isActive) {
            throw new BusinessLogicError(
              `Product "${product.name}" is inactive and cannot be ordered`
            );
          }
        }

        // Step C: Acquire row-level locks deterministically in sorted order & check availability
        const lockedInventories = new Map<string, Inventory>();

        for (const item of mergedItems) {
          const product = productMap.get(item.productId)!;

          // PostgreSQL row-level lock
          const lockedInventory = await this.inventoryRepo.lockByProductId(tx, item.productId);
          if (!lockedInventory) {
            throw new InventoryNotFoundError(
              `Inventory record not found for product "${product.name}"`
            );
          }

          // Calculate available stock: available = quantity - reservedQuantity
          const availableQuantity = lockedInventory.quantity - lockedInventory.reservedQuantity;

          if (item.quantity > availableQuantity) {
            throw new InsufficientStockError(`Insufficient stock for product ${product.name}`);
          }

          lockedInventories.set(item.productId, lockedInventory);
        }

        // Step D: Calculate exact order totals using arbitrary-precision Decimals
        let totalAmount = new Prisma.Decimal(0);
        const preparedOrderItems = mergedItems.map((item) => {
          const product = productMap.get(item.productId)!;
          const unitPrice = new Prisma.Decimal(product.price);
          const quantityDecimal = new Prisma.Decimal(item.quantity);
          const totalPrice = unitPrice.mul(quantityDecimal);
          totalAmount = totalAmount.add(totalPrice);

          return {
            productId: item.productId,
            quantity: item.quantity,
            unitPrice,
            totalPrice,
          };
        });

        // Step E: Generate unique order number
        const orderNumber = this.generateOrderNumber();

        // Step F: Create Order and OrderItems
        const createdOrder = await this.orderRepo.createOrder(tx, {
          customerId: input.customerId,
          orderNumber,
          status: OrderStatus.PENDING,
          totalAmount,
          items: preparedOrderItems,
        });

        // Step G: Update reservedQuantity, create StockReservations, and create InventoryMovements
        const expiresAt = new Date(Date.now() + config.STOCK_RESERVATION_MINUTES * 60 * 1000);

        for (const item of preparedOrderItems) {
          const lockedInventory = lockedInventories.get(item.productId)!;

          // 1. Increment reservedQuantity in Inventory (quantity remains unchanged)
          await this.inventoryRepo.incrementReservedQuantity(tx, lockedInventory.id, item.quantity);

          // 2. Create StockReservation
          await this.orderRepo.createStockReservation(tx, {
            orderId: createdOrder.id,
            productId: item.productId,
            quantity: item.quantity,
            status: ReservationStatus.ACTIVE,
            expiresAt,
          });

          // 3. Create InventoryMovement audit record
          await this.inventoryRepo.createMovement(tx, {
            productId: item.productId,
            type: InventoryMovementType.RESERVATION,
            quantity: item.quantity,
            referenceType: 'ORDER',
            referenceId: createdOrder.id,
          });
        }

        // Step H: Create OrderStatusHistory record
        await this.orderRepo.createStatusHistory(tx, {
          orderId: createdOrder.id,
          fromStatus: null,
          toStatus: OrderStatus.PENDING,
          reason: 'Order created',
        });

        logger.info(
          {
            orderId: createdOrder.id,
            orderNumber: createdOrder.orderNumber,
            customerId: createdOrder.customerId,
            itemsCount: createdOrder.items.length,
            totalAmount: createdOrder.totalAmount.toString(),
          },
          'Order created and stock reserved successfully'
        );

        // Format clean API response
        return {
          id: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          status: createdOrder.status,
          totalAmount: createdOrder.totalAmount.toFixed(2),
          items: createdOrder.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice.toFixed(2),
            totalPrice: item.totalPrice.toFixed(2),
          })),
        };
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error(
        { error, customerId: input.customerId },
        'Unexpected error during order creation'
      );
      throw error;
    }
  }
}

export const orderService = new OrderService();
