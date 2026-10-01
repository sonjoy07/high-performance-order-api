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
  reason: string;
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
        reason: data.reason,
      },
    });
  }

  /**
   * Finds an order by its ID with nested order items.
   */
  public async findById(orderId: string): Promise<(Order & { items: OrderItem[] }) | null> {
    return prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
      },
    });
  }
}

export const orderRepository = new OrderRepository();
