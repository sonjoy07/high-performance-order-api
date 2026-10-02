import crypto from 'crypto';
import {
  Inventory,
  InventoryMovementType,
  Order,
  OrderItem,
  OrderStatus,
  Prisma,
  ReservationStatus,
  UserRole,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { config } from '../../config/env';
import { logger } from '../../common/logger/logger';
import {
  AppError,
  AuthorizationError,
  BusinessLogicError,
  CustomerNotFoundError,
  IdempotencyKeyReusedError,
  InsufficientStockError,
  InventoryNotFoundError,
  OrderAccessDeniedError,
  OrderAlreadyCancelledError,
  OrderCancellationNotAllowedError,
  OrderNotFoundError,
  OrderStatusTransitionNotAllowedError,
  ProductNotFoundError,
  StockReservationNotFoundError,
} from '../../common/errors/app.error';
import {
  InventoryRepository,
  inventoryRepository as defaultInventoryRepo,
} from '../inventory/inventory.repository';
import {
  ProductRepository,
  productRepository as defaultProductRepo,
} from '../products/product.repository';
import {
  IdempotencyRepository,
  idempotencyRepository as defaultIdempotencyRepo,
} from '../idempotency/idempotency.repository';
import {
  IdempotencyService,
  idempotencyService as defaultIdempotencyService,
} from '../idempotency/idempotency.service';
import { OrderRepository, orderRepository as defaultOrderRepo } from './order.repository';
import { CreateOrderInput, OrderResponseView, OrderStatusHistoryResponseView } from './order.types';
import {
  canTransitionOrderStatus,
  isCancellableStatus,
  mergeAndSortOrderItems,
} from './order.validation';
import {
  enqueueOrderCreated,
  enqueueOrderCancelled,
  enqueueOrderStatusChanged,
} from '../../queues/queues';


export interface CreateOrderResult {
  statusCode: number;
  data: OrderResponseView;
}

export class OrderService {
  constructor(
    private readonly orderRepo: OrderRepository = defaultOrderRepo,
    private readonly productRepo: ProductRepository = defaultProductRepo,
    private readonly inventoryRepo: InventoryRepository = defaultInventoryRepo,
    private readonly idempotencyRepo: IdempotencyRepository = defaultIdempotencyRepo,
    private readonly idempotencyService: IdempotencyService = defaultIdempotencyService
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
   * Coordinates idempotent order creation and stock reservation inside ONE PostgreSQL transaction.
   *
   * Idempotency & Transaction Flow:
   * 1. Validate Idempotency-Key header & compute deterministic request hash (SHA-256).
   * 2. Check for existing completed idempotency record:
   *    - If same key + same hash: return stored response (replay).
   *    - If same key + different hash: throw 409 IDEMPOTENCY_KEY_REUSED.
   * 3. Normalize items: Merge duplicate products and sort product IDs deterministically (Deadlock Prevention).
   * 4. BEGIN TRANSACTION
   *    - Step A: Claim idempotency key row.
   *    - Step B: Validate customer exists.
   *    - Step C: Verify products exist and retrieve historical catalog prices.
   *    - Step D: Lock inventory rows using SELECT ... FOR UPDATE in deterministic order.
   *    - Step E: Validate stock availability (availableQuantity = quantity - reservedQuantity).
   *    - Step F: Calculate total order amount with Decimal precision.
   *    - Step G: Create Order and OrderItems (freezing unitPrice at order creation time).
   *    - Step H: Increment reservedQuantity (physical stock is preserved).
   *    - Step I: Create StockReservation records with configured expiration time.
   *    - Step J: Create InventoryMovement records (type: RESERVATION, referenceType: ORDER).
   *    - Step K: Create OrderStatusHistory record (fromStatus: null, toStatus: PENDING).
   *    - Step L: Store response body & status in idempotency record.
   * 5. COMMIT TRANSACTION
   */
  public async createOrder(
    input: CreateOrderInput,
    idempotencyKeyHeader: unknown
  ): Promise<CreateOrderResult> {
    // 1. Validate header, canonicalize payload, and compute deterministic request hash
    const { key, requestHash } = this.idempotencyService.prepareIdempotency(
      idempotencyKeyHeader,
      input.customerId,
      input.items
    );

    // 2. Fast-path check: Check if an identical request was already successfully processed
    const existing = await this.idempotencyService.checkExisting<OrderResponseView>(
      input.customerId,
      key,
      requestHash
    );
    if (existing) {
      logger.info(
        { customerId: input.customerId, key, orderId: existing.data.id },
        'Idempotent request replay: returning previously stored order response'
      );
      return {
        statusCode: existing.statusCode,
        data: existing.data,
      };
    }

    // 3. Normalize and merge duplicate product IDs, then sort deterministically by productId
    const mergedItems = mergeAndSortOrderItems(input.items);
    const sortedProductIds = mergedItems.map((item) => item.productId);
    const idempotencyExpiresAt = this.idempotencyService.getExpirationDate();

    try {
      return await prisma.$transaction(async (tx) => {
        // Step A: Validate customer exists
        const customer = await this.orderRepo.findCustomerById(input.customerId, tx);
        if (!customer) {
          throw new CustomerNotFoundError(`Customer with ID "${input.customerId}" not found`);
        }

        // Step B: Claim/insert the idempotency record inside the transaction
        await this.idempotencyRepo.createKey(tx, {
          key,
          customerId: input.customerId,
          requestHash,
          expiresAt: idempotencyExpiresAt,
        });

        // Step C: Verify products exist & retrieve historical prices
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

        // Step D: Acquire row-level locks deterministically in sorted order & check availability
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

        // Step E: Calculate exact order totals using arbitrary-precision Decimals
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

        // Step F: Generate unique order number
        const orderNumber = this.generateOrderNumber();

        // Step G: Create Order and OrderItems
        const createdOrder = await this.orderRepo.createOrder(tx, {
          customerId: input.customerId,
          orderNumber,
          status: OrderStatus.PENDING,
          totalAmount,
          items: preparedOrderItems,
        });

        // Step H: Update reservedQuantity, create StockReservations, and create InventoryMovements
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

        // Step I: Create OrderStatusHistory record
        await this.orderRepo.createStatusHistory(tx, {
          orderId: createdOrder.id,
          fromStatus: null,
          toStatus: OrderStatus.PENDING,
          reason: 'Order created',
        });

        const responseData: OrderResponseView = {
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

        // Step J: Persist response data into the claimed idempotency record
        await this.idempotencyRepo.storeResponse(tx, input.customerId, key, 201, responseData);

        logger.info(
          {
            orderId: createdOrder.id,
            orderNumber: createdOrder.orderNumber,
            customerId: createdOrder.customerId,
            itemsCount: createdOrder.items.length,
            totalAmount: createdOrder.totalAmount.toString(),
            idempotencyKey: key,
          },
          'Order created and stock reserved successfully'
        );

        return {
          statusCode: 201,
          data: responseData,
        };
      });

      // ── Post-commit: enqueue ORDER_CREATED background event ──────────────
      // This runs AFTER the transaction has committed. If enqueueing fails, the
      // order is still successfully created — the failure is logged but not surfaced
      // to the client. See README for the Transactional Outbox Pattern limitation.
      void enqueueOrderCreated({
        orderId: result.data.id,
        customerId: input.customerId,
        orderNumber: result.data.orderNumber,
        totalAmount: result.data.totalAmount,
      });

      return result;
    } catch (error) {
      // Handle race condition: Another concurrent transaction claimed this key
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        logger.info(
          { customerId: input.customerId, key },
          'Concurrent duplicate request detected via unique constraint (P2002). Polling for committed response...'
        );

        // Poll briefly for the winning transaction's committed response
        for (let attempt = 0; attempt < 10; attempt++) {
          const committed = await this.idempotencyService.checkExisting<OrderResponseView>(
            input.customerId,
            key,
            requestHash
          );
          if (committed) {
            return {
              statusCode: committed.statusCode,
              data: committed.data,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // If after polling, the record exists with a different hash
        const existingKey = await this.idempotencyRepo.findByCustomerAndKey(input.customerId, key);
        if (existingKey && existingKey.requestHash !== requestHash) {
          throw new IdempotencyKeyReusedError(
            'The idempotency key was already used with a different request'
          );
        }
      }

      if (error instanceof AppError) {
        throw error;
      }

      logger.error(
        { error, customerId: input.customerId, idempotencyKey: key },
        'Unexpected error during idempotent order creation'
      );
      throw error;
    }
  }

  /**
   * Helper to format an Order model with its items into the standard API response representation.
   */
  public formatOrderResponse(order: Order & { items: OrderItem[] }): OrderResponseView {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: new Prisma.Decimal(order.totalAmount).toFixed(2),
      items: order.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: new Prisma.Decimal(item.unitPrice).toFixed(2),
        totalPrice: new Prisma.Decimal(item.totalPrice).toFixed(2),
      })),
    };
  }

  /**
   * Retrieves an order by ID with ownership verification.
   * If customer, order.customerId must match customer.id (enforces IDOR protection).
   * Admins can access any order.
   */
  public async getOrderById(
    orderId: string,
    user: { id: string; role: UserRole }
  ): Promise<Order & { items: OrderItem[] }> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(`Order with ID "${orderId}" not found`);
    }

    if (user.role !== UserRole.ADMIN) {
      const customer = await this.orderRepo.findCustomerByUserId(user.id);

      if (!customer || order.customerId !== customer.id) {
        throw new OrderAccessDeniedError('You do not have permission to access this order');
      }
    }

    return order;
  }

  /**
   * Transaction-safe order cancellation and stock reservation release workflow.
   *
   * Flow:
   * 1. Acquire PostgreSQL row lock on order (SELECT ... FOR UPDATE).
   * 2. Authorize requester (Customer must own order; Admin can cancel any eligible order).
   * 3. Validate order status:
   *    - If already CANCELLED -> 409 ORDER_ALREADY_CANCELLED
   *    - If not cancellable (e.g. PROCESSING, SHIPPED, DELIVERED) -> 422 ORDER_CANCELLATION_NOT_ALLOWED
   * 4. Retrieve active stock reservations for this order.
   * 5. Sort product IDs deterministically to eliminate deadlock risk.
   * 6. Acquire row locks on inventories in sorted order.
   * 7. Decrement reservedQuantity (physical stock is preserved!).
   * 8. Create InventoryMovement records (type: RELEASE).
   * 9. Transition stock reservations to RELEASED with releasedAt timestamp.
   * 10. Update order status to CANCELLED.
   * 11. Create OrderStatusHistory audit entry.
   */
  public async cancelOrder(
    orderId: string,
    user: { id: string; role: UserRole },
    reason?: string
  ): Promise<OrderResponseView> {
    return await prisma.$transaction(async (tx) => {
      // Step 1: Lock order row exclusively for this transaction
      const order = await this.orderRepo.lockOrderById(tx, orderId);
      if (!order) {
        throw new OrderNotFoundError(`Order with ID "${orderId}" not found`);
      }

      // Step 2: Ownership verification (IDOR protection)
      if (user.role !== UserRole.ADMIN) {
        const customer = await this.orderRepo.findCustomerByUserId(user.id, tx);
        if (!customer || order.customerId !== customer.id) {
          throw new OrderAccessDeniedError('You do not have permission to cancel this order');
        }
      }

      // Step 3: Validate order status
      if (order.status === OrderStatus.CANCELLED) {
        throw new OrderAlreadyCancelledError('Order has already been cancelled');
      }

      if (!isCancellableStatus(order.status)) {
        throw new OrderCancellationNotAllowedError(
          `Order cannot be cancelled from status "${order.status}". Only PENDING or CONFIRMED orders can be cancelled.`
        );
      }

      // Step 4: Retrieve active stock reservations
      const activeReservations = await this.orderRepo.findActiveReservations(tx, order.id);
      if (activeReservations.length === 0) {
        throw new StockReservationNotFoundError(
          `No active stock reservations found for order "${order.id}"`
        );
      }

      // Step 5: Group quantity by productId and sort deterministically
      const releaseMap = new Map<string, number>();
      for (const res of activeReservations) {
        const current = releaseMap.get(res.productId) ?? 0;
        releaseMap.set(res.productId, current + res.quantity);
      }

      const sortedProductIds = Array.from(releaseMap.keys()).sort((a, b) => a.localeCompare(b));

      // Step 6: Acquire row locks on inventories in sorted order and release reserved stock
      for (const productId of sortedProductIds) {
        const releaseQty = releaseMap.get(productId)!;
        const lockedInventory = await this.inventoryRepo.lockByProductId(tx, productId);
        if (!lockedInventory) {
          throw new InventoryNotFoundError(`Inventory record not found for product "${productId}"`);
        }

        if (lockedInventory.reservedQuantity < releaseQty) {
          throw new BusinessLogicError(
            `Inconsistent inventory state: reservedQuantity (${lockedInventory.reservedQuantity}) is less than release quantity (${releaseQty})`
          );
        }

        // Decrement reservedQuantity (physical quantity is NOT touched)
        await this.inventoryRepo.decrementReservedQuantity(tx, lockedInventory.id, releaseQty);

        // Record RELEASE movement audit trail
        await this.inventoryRepo.createMovement(tx, {
          productId,
          type: InventoryMovementType.RELEASE,
          quantity: releaseQty,
          referenceType: 'ORDER',
          referenceId: order.id,
        });
      }

      // Step 7: Update stock reservations to RELEASED
      const now = new Date();
      for (const res of activeReservations) {
        await this.orderRepo.releaseStockReservation(tx, res.id, now);
      }

      // Step 8: Update order status to CANCELLED
      const updatedOrder = await this.orderRepo.updateOrderStatus(
        tx,
        order.id,
        OrderStatus.CANCELLED
      );

      // Step 9: Create audit entry in OrderStatusHistory
      await this.orderRepo.createStatusHistory(tx, {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: OrderStatus.CANCELLED,
        changedBy: user.id,
        reason: reason ?? 'Order cancelled',
      });

      logger.info(
        {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          previousStatus: order.status,
          userId: user.id,
          role: user.role,
        },
        'Order cancelled and reserved stock successfully released'
      );

      return this.formatOrderResponse(updatedOrder);
    });
  }

  /**
   * Updates an order's status with centralized state machine validation.
   * If transitioning to CANCELLED, delegates to the full cancellation & reservation release workflow.
   * Only ADMIN users can invoke general status updates.
   */
  public async updateOrderStatus(
    orderId: string,
    nextStatus: OrderStatus,
    user: { id: string; role: UserRole },
    reason?: string
  ): Promise<OrderResponseView> {
    if (user.role !== UserRole.ADMIN) {
      throw new AuthorizationError('Only administrators can update order status');
    }

    // Cancellation requires releasing reserved stock and logging inventory movements
    if (nextStatus === OrderStatus.CANCELLED) {
      return this.cancelOrder(orderId, user, reason);
    }

    return await prisma.$transaction(async (tx) => {
      // Step 1: Acquire row-level lock on order
      const order = await this.orderRepo.lockOrderById(tx, orderId);
      if (!order) {
        throw new OrderNotFoundError(`Order with ID "${orderId}" not found`);
      }

      // Step 2: Validate state transition against centralized matrix
      if (!canTransitionOrderStatus(order.status, nextStatus)) {
        throw new OrderStatusTransitionNotAllowedError(
          `Cannot transition order status from "${order.status}" to "${nextStatus}"`
        );
      }

      // Step 3: Update order status
      const updatedOrder = await this.orderRepo.updateOrderStatus(tx, order.id, nextStatus);

      // Step 4: Create audit entry in OrderStatusHistory
      await this.orderRepo.createStatusHistory(tx, {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: nextStatus,
        changedBy: user.id,
        reason: reason ?? `Status updated to ${nextStatus}`,
      });

      logger.info(
        {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          fromStatus: order.status,
          toStatus: nextStatus,
          adminUserId: user.id,
        },
        'Order status updated successfully'
      );

      return this.formatOrderResponse(updatedOrder);
    });
  }

  /**
   * Retrieves full chronological status history for an order with customer ownership protection.
   */
  public async getOrderHistory(
    orderId: string,
    user: { id: string; role: UserRole }
  ): Promise<OrderStatusHistoryResponseView[]> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(`Order with ID "${orderId}" not found`);
    }

    if (user.role !== UserRole.ADMIN) {
      const customer = await this.orderRepo.findCustomerByUserId(user.id);
      if (!customer || order.customerId !== customer.id) {
        throw new OrderAccessDeniedError('You do not have permission to access this order history');
      }
    }

    const history = await this.orderRepo.findStatusHistory(orderId);

    return history.map((entry) => ({
      id: entry.id,
      orderId: entry.orderId,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      changedBy: entry.changedBy,
      reason: entry.reason,
      createdAt: entry.changedAt.toISOString(),
    }));
  }
}

export const orderService = new OrderService();
