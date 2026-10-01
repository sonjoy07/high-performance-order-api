import {
  Customer,
  Order,
  OrderItem,
  OrderStatus,
  OrderStatusHistory,
  Prisma,
  ReservationStatus,
  StockReservation,
} from '@prisma/client';
import { prisma } from '../../config/prisma';

export interface CreateOrderData {
  customerId: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: Prisma.Decimal;
  items: {
    productId: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    totalPrice: Prisma.Decimal;
  }[];
}

export interface CreateReservationData {
  orderId: string;
  productId: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: Date;
}

export interface CreateStatusHistoryData {
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedBy?: string | null;
  reason?: string | null;
}

export class OrderRepository {
  /**
   * Finds a customer by ID. Accepts an optional transaction client to guarantee transactional consistency.
   */
  public async findCustomerById(
    customerId: string,
    tx?: Prisma.TransactionClient
  ): Promise<Customer | null> {
    const client = tx ?? prisma;
    return client.customer.findUnique({
      where: { id: customerId },
    });
  }

  /**
   * Finds a customer by User ID.
   */
  public async findCustomerByUserId(
    userId: string,
    tx?: Prisma.TransactionClient
  ): Promise<Customer | null> {
    const client = tx ?? prisma;
    return client.customer.findUnique({
      where: { userId },
    });
  }

  /**
   * Creates an order with nested order items within an active transaction.
   */
  public async createOrder(
    tx: Prisma.TransactionClient,
    data: CreateOrderData
  ): Promise<Order & { items: OrderItem[] }> {
    return tx.order.create({
      data: {
        customerId: data.customerId,
        orderNumber: data.orderNumber,
        status: data.status,
        totalAmount: data.totalAmount,
        items: {
          create: data.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
          })),
        },
      },
      include: {
        items: true,
      },
    });
  }

  /**
   * Acquires a row-level lock on an order (SELECT ... FOR UPDATE) and fetches its items.
   */
  public async lockOrderById(
    tx: Prisma.TransactionClient,
    orderId: string
  ): Promise<(Order & { items: OrderItem[] }) | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "orders" WHERE id = ${orderId} FOR UPDATE
    `;
    if (!rows || rows.length === 0) {
      return null;
    }
    return tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
      },
    });
  }

  /**
   * Creates a stock reservation record associated with an order and product within an active transaction.
   */
  public async createStockReservation(
    tx: Prisma.TransactionClient,
    data: CreateReservationData
  ): Promise<StockReservation> {
    return tx.stockReservation.create({
      data: {
        orderId: data.orderId,
        productId: data.productId,
        quantity: data.quantity,
        status: data.status,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Finds all ACTIVE stock reservations for a given order within a transaction.
   */
  public async findActiveReservations(
    tx: Prisma.TransactionClient,
    orderId: string
  ): Promise<StockReservation[]> {
    return tx.stockReservation.findMany({
      where: {
        orderId,
        status: ReservationStatus.ACTIVE,
      },
    });
  }

  /**
   * Updates a stock reservation to RELEASED status and sets releasedAt timestamp.
   */
  public async releaseStockReservation(
    tx: Prisma.TransactionClient,
    reservationId: string,
    releasedAt: Date = new Date()
  ): Promise<StockReservation> {
    return tx.stockReservation.update({
      where: { id: reservationId },
      data: {
        status: ReservationStatus.RELEASED,
        releasedAt,
      },
    });
  }

  /**
   * Updates an order's status within an active transaction.
   */
  public async updateOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
    status: OrderStatus
  ): Promise<Order & { items: OrderItem[] }> {
    return tx.order.update({
      where: { id: orderId },
      data: { status },
      include: {
        items: true,
      },
    });
  }

  /**
   * Creates an audit entry in the order status history within an active transaction.
   */
  public async createStatusHistory(
    tx: Prisma.TransactionClient,
    data: CreateStatusHistoryData
  ): Promise<OrderStatusHistory> {
    return tx.orderStatusHistory.create({
      data: {
        orderId: data.orderId,
        fromStatus: data.fromStatus,
        toStatus: data.toStatus,
        changedBy: data.changedBy ?? null,
        reason: data.reason ?? null,
      },
    });
  }

  /**
   * Retrieves full chronological status history for an order.
   */
  public async findStatusHistory(orderId: string): Promise<OrderStatusHistory[]> {
    return prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { changedAt: 'asc' },
    });
  }

  /**
   * Finds an order by its ID with nested order items.
   */
  public async findById(
    orderId: string,
    tx?: Prisma.TransactionClient
  ): Promise<(Order & { items: OrderItem[] }) | null> {
    const client = tx ?? prisma;
    return client.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
      },
    });
  }
}

export const orderRepository = new OrderRepository();
