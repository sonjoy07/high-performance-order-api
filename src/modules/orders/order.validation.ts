import { z } from 'zod';
import { CreateOrderItemInput } from './order.types';

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
