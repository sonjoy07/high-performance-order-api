import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { categoryController } from './category.controller';
import { validateRequest } from '../../common/middleware/validate.middleware';
import { authenticate, requireRole } from '../auth/auth.middleware';
import {
  createCategorySchema,
  updateCategorySchema,
  categoryQuerySchema,
  categoryIdParamSchema,
} from './category.validation';

const router = Router();

/**
 * @swagger
 * /categories:
 *   get:
 *     tags: [Categories]
 *     summary: List all categories
 *     description: Returns a paginated list of categories. Public endpoint — no authentication required.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Filter by name or slug
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [name, createdAt], default: createdAt }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *     responses:
 *       200:
 *         description: Paginated list of categories
 *       400:
 *         description: Validation error
 */
router.get('/', validateRequest({ query: categoryQuerySchema }), categoryController.list);

/**
 * @swagger
 * /categories/{id}:
 *   get:
 *     tags: [Categories]
 *     summary: Get a category by ID
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Category found
 *       404:
 *         description: Category not found
 */
router.get('/:id', validateRequest({ params: categoryIdParamSchema }), categoryController.getById);

/**
 * @swagger
 * /categories:
 *   post:
 *     tags: [Categories]
 *     summary: Create a new category (Admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, slug]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Electronics
 *               slug:
 *                 type: string
 *                 example: electronics
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Category created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       409:
 *         description: Name or slug already exists
 */
router.post(
  '/',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ body: createCategorySchema }),
  categoryController.create
);

/**
 * @swagger
 * /categories/{id}:
 *   patch:
 *     tags: [Categories]
 *     summary: Update a category (Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Category updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       404:
 *         description: Category not found
 */
router.patch(
  '/:id',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: categoryIdParamSchema, body: updateCategorySchema }),
  categoryController.update
);

/**
 * @swagger
 * /categories/{id}:
 *   delete:
 *     tags: [Categories]
 *     summary: Delete a category (Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Category deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       404:
 *         description: Category not found
 *       409:
 *         description: Cannot delete — category has associated products
 */
router.delete(
  '/:id',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: categoryIdParamSchema }),
  categoryController.delete
);

export const categoryRouter = router;
