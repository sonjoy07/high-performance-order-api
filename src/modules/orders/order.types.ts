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

// =========================================================================
// Query / reporting response views
// =========================================================================

export interface OrderListCustomerView {
  id: string;
  firstName: string;
  lastName: string;
}

/** Row shape returned by `GET /api/v1/orders`. */
export interface OrderListItemView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  /** Fixed 2-decimal string — never a JSON number, to avoid float round-tripping. */
  totalAmount: string;
  customerId: string;
  itemCount: number;
  customer: OrderListCustomerView;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetailCustomerView extends OrderListCustomerView {
  phone: string | null;
  email: string;
}

export interface OrderDetailItemView {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  productSlug: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
}

export interface OrderDetailStatusHistoryView {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedBy: string | null;
  reason: string | null;
  createdAt: string;
}

/**
 * Row shape returned by `GET /api/v1/orders/:orderId`.
 *
 * Resolved with a single query (order + customer + items + products + status history)
 * and an explicit projection, so no `passwordHash`, user row or unrelated column is
 * ever read from PostgreSQL.
 */
export interface OrderDetailResponseView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: string;
  customerId: string;
  customer: OrderDetailCustomerView;
  items: OrderDetailItemView[];
  statusHistory: OrderDetailStatusHistoryView[];
  createdAt: string;
  updatedAt: string;
}
