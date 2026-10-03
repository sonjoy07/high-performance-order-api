import { z } from 'zod';

export const inventoryParamSchema = z.object({
  productId: z.string().trim().min(1, 'Product ID is required'),
});

export const adjustStockTypeEnum = z.enum(['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT']);

export const adjustInventorySchema = z.object({
  quantity: z.coerce
    .number()
    .int('Quantity must be an integer')
    .positive('Quantity must be greater than zero'),
  type: adjustStockTypeEnum,
  reason: z.string().trim().max(255, 'Reason must not exceed 255 characters').optional(),
});

export const inventoryMovementQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'Limit must be at least 1')
      .max(100, 'Limit cannot exceed 100')
      .default(20),
    type: z.enum(['STOCK_IN', 'STOCK_OUT', 'RESERVATION', 'RELEASE', 'ADJUSTMENT']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return data.from <= data.to;
      }
      return true;
    },
    {
      message: '"from" date must be earlier than or equal to "to" date',
      path: ['from'],
    }
  );

export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;
export type InventoryMovementQueryInput = z.infer<typeof inventoryMovementQuerySchema>;
