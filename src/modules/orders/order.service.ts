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
  BusinessLogicError,
  CustomerNotFoundError,
  IdempotencyKeyReusedError,
  InsufficientStockError,
  InventoryNotFoundError,
  OrderAccessDeniedError,
  OrderNotFoundError,
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
import {
  IdempotencyRepository,
  idempotencyRepository as defaultIdempotencyRepo,
} from '../idempotency/idempotency.repository';
import {
  IdempotencyService,
  idempotencyService as defaultIdempotencyService,
} from '../idempotency/idempotency.service';
import { OrderRepository, orderRepository as defaultOrderRepo } from './order.repository';
import { CreateOrderInput, OrderResponseView } from './order.types';
import { mergeAndSortOrderItems } from './order.validation';

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
      const customer = await prisma.customer.findUnique({
        where: { userId: user.id },
      });

      if (!customer || order.customerId !== customer.id) {
        throw new OrderAccessDeniedError(
          'You do not have permission to access this order'
        );
      }
    }

    return order;
  }
}

export const orderService = new OrderService();
