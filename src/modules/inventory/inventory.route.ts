import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { inventoryController } from './inventory.controller';
import { validateRequest } from '../../common/middleware/validate.middleware';
import { authenticate, requireRole } from '../auth/auth.middleware';
import {
  inventoryParamSchema,
  adjustInventorySchema,
  inventoryMovementQuerySchema,
} from './inventory.validation';

const router = Router();

/**
 * @swagger
 * /inventory/{productId}:
 *   get:
 *     tags: [Inventory]
 *     summary: Get inventory for a product (Admin only)
 *     description: Returns current quantity, reservedQuantity, and available stock for the given product.
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Inventory details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 productId: { type: string }
 *                 quantity: { type: integer, description: Physical stock }
 *                 reservedQuantity: { type: integer, description: Reserved by active orders }
 *                 availableQuantity: { type: integer, description: quantity - reservedQuantity }
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       404:
 *         description: Inventory not found for product
 */
router.get(
  '/:productId',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: inventoryParamSchema }),
  inventoryController.getByProductId
);

/**
 * @swagger
 * /inventory/{productId}/adjust:
 *   post:
 *     tags: [Inventory]
 *     summary: Adjust stock for a product (Admin only)
 *     description: |
 *       Performs a stock adjustment. Supported types:
 *       - STOCK_IN — adds physical stock
 *       - STOCK_OUT — removes physical stock (fails if insufficient)
 *       - ADJUSTMENT — sets stock to an absolute value
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, quantity]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [STOCK_IN, STOCK_OUT, ADJUSTMENT]
 *                 example: STOCK_IN
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 50
 *               reason:
 *                 type: string
 *                 example: Received new shipment
 *     responses:
 *       200:
 *         description: Stock adjusted successfully
 *       400:
 *         description: Validation error or insufficient stock
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       404:
 *         description: Product not found
 */
router.post(
  '/:productId/adjust',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: inventoryParamSchema, body: adjustInventorySchema }),
  inventoryController.adjustStock
);

/**
 * @swagger
 * /inventory/{productId}/movements:
 *   get:
 *     tags: [Inventory]
 *     summary: Get inventory movement history for a product (Admin only)
 *     description: Returns a paginated audit trail of all stock movements (STOCK_IN, STOCK_OUT, RESERVATION, RELEASE, ADJUSTMENT).
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [STOCK_IN, STOCK_OUT, RESERVATION, RELEASE, ADJUSTMENT] }
 *     responses:
 *       200:
 *         description: Paginated inventory movements
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       404:
 *         description: Product not found
 */
router.get(
  '/:productId/movements',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: inventoryParamSchema, query: inventoryMovementQuerySchema }),
  inventoryController.getMovements
);

export const inventoryRouter = router;
