import crypto from 'crypto';
import {
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
import { formatMoney } from '../../common/utils/money';
import { buildPaginationArgs, buildPaginationMeta } from '../../common/utils/pagination';
import { PaginatedResult } from '../../common/types/pagination';
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
import {
  CreateOrderInput,
  OrderDetailResponseView,
  OrderListItemView,
  OrderResponseView,
  OrderStatusHistoryResponseView,
} from './order.types';
import {
  canTransitionOrderStatus,
  isCancellableStatus,
  mergeAndSortOrderItems,
  OrderQueryInput,
} from './order.validation';
import { enqueueOrderCreated, enqueueOrderCancelled, enqueueOrderStatusChanged } from '../../queues/queues';


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
   * Resolves the Customer identity for the authenticated user.
   *
   * - If the user already has an associated Customer profile, returns its ID.
   * - If the user is an ADMIN with no Customer profile, one is auto-created.
   * - If the user is a CUSTOMER with no profile, throws CustomerNotFoundError.
   *
   * This is intentionally NOT inside the order transaction — the customer record
   * must exist before the transactional order creation begins.
   */
  public async resolveCustomerForUser(user: { id: string; role: UserRole }): Promise<string> {
    let customer = await this.orderRepo.findCustomerByUserId(user.id);

    if (!customer) {
      if (user.role === UserRole.ADMIN) {
        customer = await this.orderRepo.createCustomerForUser(user.id, 'Admin', 'User');
      } else {
        throw new CustomerNotFoundError(
          'Authenticated user does not have an associated customer profile'
        );
      }
    }

    return customer.id;
  }

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
      const result = await prisma.$transaction(async (tx) => {
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

        // Step D: Acquire row-level locks in a single statement & check availability
        //
        // N+1 FIX: one `SELECT ... WHERE "productId" = ANY(...) ORDER BY ... FOR UPDATE`
        // replaces one lock query per order line. The ORDER BY gives every concurrent
        // transaction the same lock order, so overlapping orders cannot deadlock.
        const lockedInventories = await this.inventoryRepo.lockByProductIds(tx, sortedProductIds);

        if (lockedInventories.size !== sortedProductIds.length) {
          const missingId = sortedProductIds.find((id) => !lockedInventories.has(id));
          throw new InventoryNotFoundError(
            `Inventory record not found for product "${missingId}"`
          );
        }

        for (const item of mergedItems) {
          const product = productMap.get(item.productId)!;
          const lockedInventory = lockedInventories.get(item.productId)!;

          // Calculate available stock: available = quantity - reservedQuantity
          const availableQuantity = lockedInventory.quantity - lockedInventory.reservedQuantity;

          if (item.quantity > availableQuantity) {
            throw new InsufficientStockError(`Insufficient stock for product ${product.name}`);
          }
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

        // Step H: Reserve stock — three set-based statements regardless of line count
        //
        // N+1 FIX: the previous implementation ran three queries per order line
        // (UPDATE inventory, INSERT reservation, INSERT movement) => 3N round-trips.
        // These are now one UPDATE, one createMany and one createMany => 3 queries total.
        const expiresAt = new Date(Date.now() + config.STOCK_RESERVATION_MINUTES * 60 * 1000);

        const updatedCount = await this.inventoryRepo.applyReservedQuantityDeltas(
          tx,
          preparedOrderItems.map((item) => ({ productId: item.productId, delta: item.quantity }))
        );
        if (updatedCount !== preparedOrderItems.length) {
          throw new InventoryNotFoundError('One or more inventory rows disappeared mid-transaction');
        }

        await this.orderRepo.createStockReservations(
          tx,
          preparedOrderItems.map((item) => ({
            orderId: createdOrder.id,
            productId: item.productId,
            quantity: item.quantity,
            status: ReservationStatus.ACTIVE,
            expiresAt,
          }))
        );

        await this.inventoryRepo.createMovements(
          tx,
          preparedOrderItems.map((item) => ({
            productId: item.productId,
            type: InventoryMovementType.RESERVATION,
            quantity: item.quantity,
            referenceType: 'ORDER',
            referenceId: createdOrder.id,
          }))
        );

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
   * Retrieves an order detail with a single, fully-projected query.
   *
   * N+1 avoidance
   * -------------
   * The classic failure mode is `order → customer → items → (per item) product`.
   * Instead the repository issues ONE projected query whose relation graph is
   * `order + customer(+user) + items(+product) + statusHistory`. Prisma resolves each
   * relation with a batched statement scoped to the page, so the number of round-trips is
   * constant regardless of how many items the order has.
   *
   * IDOR protection
   * ---------------
   * `customer.userId` is part of the projection, so ownership is verified against data we
   * already loaded — no second lookup, and no way to accidentally skip the check.
   */
  public async getOrderById(
    orderId: string,
    user: { id: string; role: UserRole }
  ): Promise<OrderDetailResponseView> {
    const order = await this.orderRepo.findDetailById(orderId);
    if (!order) {
      throw new OrderNotFoundError(`Order with ID "${orderId}" not found`);
    }

    if (user.role !== UserRole.ADMIN && order.customer.userId !== user.id) {
      throw new OrderAccessDeniedError('You do not have permission to access this order');
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: formatMoney(order.totalAmount),
      customerId: order.customerId,
      customer: {
        id: order.customer.id,
        firstName: order.customer.firstName,
        lastName: order.customer.lastName,
        phone: order.customer.phone,
        email: order.customer.user.email,
      },
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        productSku: item.product.sku,
        productSlug: item.product.slug,
        quantity: item.quantity,
        unitPrice: formatMoney(item.unitPrice),
        totalPrice: formatMoney(item.totalPrice),
      })),
      statusHistory: order.statusHistory.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        changedBy: entry.changedBy,
        reason: entry.reason,
        createdAt: entry.changedAt.toISOString(),
      })),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  /**
   * Paginated, filtered, searchable order listing.
   *
   * Authorization is enforced *before* any query is built:
   *  - CUSTOMER: `customerId` is resolved from the access token and forced into the WHERE
   *    clause, ignoring any `customerId` the client may have sent. A CUSTOMER therefore
   *    cannot read another customer's orders by manipulating query parameters.
   *  - ADMIN: may filter by `customerId` and additionally search customer email.
   *
   * Filtering, pagination, sorting and the total count all happen inside PostgreSQL.
   */
  public async listOrders(
    query: OrderQueryInput,
    user: { id: string; role: UserRole }
  ): Promise<PaginatedResult<OrderListItemView>> {
    const isAdmin = user.role === UserRole.ADMIN;

    // Server-side ownership scope — never taken from the request for CUSTOMER.
    let scopedCustomerId = query.customerId;
    if (!isAdmin) {
      const customer = await this.orderRepo.findCustomerByUserId(user.id);
      if (!customer) {
        throw new CustomerNotFoundError(
          'Authenticated user does not have an associated customer profile'
        );
      }
      scopedCustomerId = customer.id;
    }

    const { skip, take } = buildPaginationArgs(query.page, query.limit);

    const [rows, total] = await this.orderRepo.findManyForList({
      skip,
      take,
      customerId: scopedCustomerId,
      status: query.status,
      search: query.search,
      searchCustomerFields: isAdmin,
      fromDate: query.fromDate,
      toDate: query.toDate,
      minAmount: query.minAmount,
      maxAmount: query.maxAmount,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    const items: OrderListItemView[] = rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      totalAmount: formatMoney(row.totalAmount),
      customerId: row.customerId,
      itemCount: row.itemCount,
      customer: {
        id: row.customer.id,
        firstName: row.customer.firstName,
        lastName: row.customer.lastName,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    return {
      data: items,
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
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

      // Step 6: Lock all affected inventory rows in one statement and release reserved stock
      //
      // N+1 FIX: one `SELECT ... FOR UPDATE` + one set-based `UPDATE` + one `createMany`
      // replace 3 queries per distinct product.
      const lockedInventories = await this.inventoryRepo.lockByProductIds(tx, sortedProductIds);

      for (const productId of sortedProductIds) {
        if (!lockedInventories.has(productId)) {
          throw new InventoryNotFoundError(`Inventory record not found for product "${productId}"`);
        }

        const releaseQty = releaseMap.get(productId)!;
        const lockedInventory = lockedInventories.get(productId)!;

        if (lockedInventory.reservedQuantity < releaseQty) {
          throw new BusinessLogicError(
            `Inconsistent inventory state: reservedQuantity (${lockedInventory.reservedQuantity}) is less than release quantity (${releaseQty})`
          );
        }
      }

      // Physical quantity is NOT touched — only the reservation is released.
      const releasedCount = await this.inventoryRepo.applyReservedQuantityDeltas(
        tx,
        sortedProductIds.map((productId) => ({
          productId,
          delta: -releaseMap.get(productId)!,
        }))
      );
      if (releasedCount !== sortedProductIds.length) {
        throw new InventoryNotFoundError('One or more inventory rows disappeared mid-transaction');
      }

      await this.inventoryRepo.createMovements(
        tx,
        sortedProductIds.map((productId) => ({
          productId,
          type: InventoryMovementType.RELEASE,
          quantity: releaseMap.get(productId)!,
          referenceType: 'ORDER',
          referenceId: order.id,
        }))
      );

      // Step 7: Update stock reservations to RELEASED
      const now = new Date();
      const releasedReservations = await this.orderRepo.releaseStockReservations(
        tx,
        activeReservations.map((reservation) => reservation.id),
        now
      );
      if (releasedReservations !== activeReservations.length) {
        throw new StockReservationNotFoundError(
          `One or more active stock reservations for order "${order.id}" were already released`
        );
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

      const response = this.formatOrderResponse(updatedOrder);
      void enqueueOrderCancelled({ orderId: updatedOrder.id, customerId: order.customerId, reason });
      return response;
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

      const response = this.formatOrderResponse(updatedOrder);
      void enqueueOrderStatusChanged({ orderId: updatedOrder.id, newStatus: updatedOrder.status });
      return response;
    });
  }

  /**
   * Retrieves full chronological status history for an order with customer ownership protection.
   *
   * Only the ownership columns are read first (`select: { customerId: true }`) — loading
   * the whole order detail here would be wasted I/O, and loading nothing would be an IDOR hole.
   */
  public async getOrderHistory(
    orderId: string,
    user: { id: string; role: UserRole }
  ): Promise<OrderStatusHistoryResponseView[]> {
    const order = await this.orderRepo.findOwnershipById(orderId);
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

