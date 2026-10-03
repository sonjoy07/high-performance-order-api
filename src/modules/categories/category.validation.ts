import { z } from 'zod';
import {
  createSearchSchema,
  createSortBySchema,
  limitSchema,
  pageSchema,
  sortOrderSchema,
} from '../../common/validation/query.validation';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Category name must be at least 2 characters')
    .max(100, 'Category name must not exceed 100 characters'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Slug must be at least 2 characters')
    .max(100, 'Slug must not exceed 100 characters')
    .regex(slugRegex, 'Slug must be URL-friendly (lowercase letters, numbers, and hyphens only)'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must not exceed 500 characters')
    .optional()
    .nullable(),
});

export const updateCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Category name must be at least 2 characters')
      .max(100, 'Category name must not exceed 100 characters')
      .optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, 'Slug must be at least 2 characters')
      .max(100, 'Slug must not exceed 100 characters')
      .regex(slugRegex, 'Slug must be URL-friendly (lowercase letters, numbers, and hyphens only)')
      .optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Description must not exceed 500 characters')
      .optional()
      .nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const categoryQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
  search: createSearchSchema(),
  sortBy: createSortBySchema(['name', 'createdAt', 'updatedAt'] as const, 'createdAt'),
  sortOrder: sortOrderSchema,
});

export const categoryIdParamSchema = z.object({
  id: z.string().trim().min(1, 'Category ID is required'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CategoryQueryInput = z.infer<typeof categoryQuerySchema>;
