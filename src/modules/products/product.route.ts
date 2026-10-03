import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { productController } from './product.controller';
import { validateRequest } from '../../common/middleware/validate.middleware';
import { authenticate, requireRole } from '../auth/auth.middleware';
import {
  createProductSchema,
  updateProductSchema,
  productQuerySchema,
  productIdParamSchema,
} from './product.validation';

const router = Router();

/**
 * @swagger
 * /products:
 *   get:
 *     tags: [Products]
 *     summary: List all products
 *     description: Returns a paginated, searchable, filterable list of active products. Public endpoint.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Full-text search on name, description, SKU
 *       - in: query
 *         name: categoryId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [name, price, createdAt], default: createdAt }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200:
 *         description: Paginated list of products
 *       400:
 *         description: Validation error
 */
router.get('/', validateRequest({ query: productQuerySchema }), productController.list);

/**
 * @swagger
 * /products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Get a product by ID
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Product details
 *       404:
 *         description: Product not found
 */
router.get('/:id', validateRequest({ params: productIdParamSchema }), productController.getById);

/**
 * @swagger
 * /products:
 *   post:
 *     tags: [Products]
 *     summary: Create a new product (Admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [categoryId, name, slug, sku, price]
 *             properties:
 *               categoryId:
 *                 type: string
 *                 format: uuid
 *               name:
 *                 type: string
 *                 example: Wireless Headphones
 *               slug:
 *                 type: string
 *                 example: wireless-headphones
 *               sku:
 *                 type: string
 *                 example: WH-001
 *               price:
 *                 type: number
 *                 example: 49.99
 *               description:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Product created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 */
router.post(
  '/',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ body: createProductSchema }),
  productController.create
);

/**
 * @swagger
 * /products/{id}:
 *   patch:
 *     tags: [Products]
 *     summary: Update a product (Admin only)
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
 *               name: { type: string }
 *               slug: { type: string }
 *               sku: { type: string }
 *               price: { type: number }
 *               description: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Product updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       404:
 *         description: Product not found
 */
router.patch(
  '/:id',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: productIdParamSchema, body: updateProductSchema }),
  productController.update
);

/**
 * @swagger
 * /products/{id}:
 *   delete:
 *     tags: [Products]
 *     summary: Delete a product (Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Product deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       404:
 *         description: Product not found
 */
router.delete(
  '/:id',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: productIdParamSchema }),
  productController.delete
);

export const productRouter = router;
