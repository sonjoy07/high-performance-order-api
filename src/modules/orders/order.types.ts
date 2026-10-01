import { OrderStatus } from '@prisma/client';

export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderInput {
  customerId: string;
  items: CreateOrderItemInput[];
}

export interface OrderItemResponseView {
  productId: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
}

export interface OrderResponseView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: string;
  items: OrderItemResponseView[];
}

export interface OrderStatusHistoryResponseView {
  id: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedBy: string | null;
  reason: string | null;
  createdAt: string;
}

export interface CancelOrderInput {
  orderId: string;
  reason?: string;
}

export interface UpdateOrderStatusInput {
  orderId: string;
  status: OrderStatus;
  reason?: string;
}
