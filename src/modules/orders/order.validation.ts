import { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { CreateOrderItemInput } from './order.types';

/**
 * State Transition Matrix for Order Lifecycle.
 *
 * PENDING   -> CONFIRMED, CANCELLED
 * CONFIRMED -> PROCESSING, CANCELLED
 * PROCESSING -> SHIPPED
 * SHIPPED   -> DELIVERED
 * DELIVERED -> none (terminal)
 * CANCELLED -> none (terminal)
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

/**
 * Validates whether an order status transition is allowed by business rules.
 */
export function canTransitionOrderStatus(
  currentStatus: OrderStatus,
  nextStatus: OrderStatus
): boolean {
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus];
  return allowed ? allowed.includes(nextStatus) : false;
}

/**
 * Checks whether an order is eligible for cancellation (PENDING or CONFIRMED only).
 */
export function isCancellableStatus(status: OrderStatus): boolean {
  return status === OrderStatus.PENDING || status === OrderStatus.CONFIRMED;
}

export const orderIdParamSchema = z.object({
  orderId: z.string().uuid('Invalid order ID format. Must be a valid UUID.'),
});

export const cancelOrderSchema = z
  .object({
    reason: z.string().trim().max(255, 'Reason cannot exceed 255 characters').optional(),
  })
  .optional()
  .default({});

export const updateOrderStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus, {
    message: 'Invalid order status',
  }),
  reason: z.string().trim().max(255, 'Reason cannot exceed 255 characters').optional(),
});

export type CancelOrderSchemaInput = z.infer<typeof cancelOrderSchema>;
export type UpdateOrderStatusSchemaInput = z.infer<typeof updateOrderStatusSchema>;

export const createOrderSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID format. Must be a valid UUID.').optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid('Invalid product ID format. Must be a valid UUID.'),
        quantity: z
          .number()
          .int('Quantity must be an integer')
          .positive('Quantity must be greater than 0'),
      })
    )
    .min(1, 'Order must contain at least one item'),
});

export type CreateOrderSchemaInput = z.infer<typeof createOrderSchema>;

/**
 * Normalizes order items:
 * 1. Merges duplicate product IDs by summing their quantities.
 * 2. Sorts items deterministically by productId ascending to ensure global lock acquisition ordering.
 */
export function mergeAndSortOrderItems(items: CreateOrderItemInput[]): CreateOrderItemInput[] {
  const mergedMap = new Map<string, number>();

  for (const item of items) {
    const current = mergedMap.get(item.productId) ?? 0;
    mergedMap.set(item.productId, current + item.quantity);
  }

  return Array.from(mergedMap.entries())
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}
