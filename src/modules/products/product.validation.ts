import { z } from 'zod';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createProductSchema = z.object({
  categoryId: z.string().trim().min(1, 'Category ID is required'),
  name: z
    .string()
    .trim()
    .min(2, 'Product name must be at least 2 characters')
    .max(200, 'Product name must not exceed 200 characters'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Slug must be at least 2 characters')
    .max(200, 'Slug must not exceed 200 characters')
    .regex(slugRegex, 'Slug must be URL-friendly (lowercase letters, numbers, and hyphens only)'),
  description: z
    .string()
    .trim()
    .max(2000, 'Description must not exceed 2000 characters')
    .optional()
    .nullable(),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'SKU must be at least 2 characters')
    .max(50, 'SKU must not exceed 50 characters'),
  price: z.coerce.number().min(0, 'Price must be greater than or equal to 0'),
  isActive: z.boolean().default(true),
});

export const updateProductSchema = z
  .object({
    categoryId: z.string().trim().min(1, 'Category ID must not be empty').optional(),
    name: z
      .string()
      .trim()
      .min(2, 'Product name must be at least 2 characters')
      .max(200, 'Product name must not exceed 200 characters')
      .optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, 'Slug must be at least 2 characters')
      .max(200, 'Slug must not exceed 200 characters')
      .regex(slugRegex, 'Slug must be URL-friendly (lowercase letters, numbers, and hyphens only)')
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, 'Description must not exceed 2000 characters')
      .optional()
      .nullable(),
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .min(2, 'SKU must be at least 2 characters')
      .max(50, 'SKU must not exceed 50 characters')
      .optional(),
    price: z.coerce.number().min(0, 'Price must be greater than or equal to 0').optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const productQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'Limit must be at least 1')
      .max(100, 'Limit cannot exceed 100')
      .default(20),
    search: z.string().trim().optional(),
    categoryId: z.string().trim().optional(),
    minPrice: z.coerce.number().min(0, 'minPrice must be >= 0').optional(),
    maxPrice: z.coerce.number().min(0, 'maxPrice must be >= 0').optional(),
    isActive: z
      .preprocess((val) => {
        if (val === 'true' || val === true) return true;
        if (val === 'false' || val === false) return false;
        return val;
      }, z.boolean().optional())
      .optional(),
    sortBy: z.enum(['name', 'price', 'createdAt', 'updatedAt']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine(
    (data) => {
      if (data.minPrice !== undefined && data.maxPrice !== undefined) {
        return data.minPrice <= data.maxPrice;
      }
      return true;
    },
    {
      message: 'minPrice cannot be greater than maxPrice',
      path: ['minPrice'],
    }
  );

export const productIdParamSchema = z.object({
  id: z.string().trim().min(1, 'Product ID is required'),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;
