import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { validateRequest } from '../../common/middleware/validate.middleware';
import {
  cancelOrderSchema,
  createOrderSchema,
  orderIdParamSchema,
  orderQuerySchema,
  updateOrderStatusSchema,
} from './order.validation';
import { orderController } from './order.controller';
import { orderCreationRateLimiter } from '../../common/middleware/rate-limit.middleware';
import { authenticate, requireRole } from '../auth/auth.middleware';

const router = Router();

/**
 * @swagger
 * /orders:
 *   get:
 *     tags: [Orders]
 *     summary: List orders
 *     description: |
 *       Returns a paginated list of orders.
 *       - CUSTOMER: sees only their own orders.
 *       - ADMIN: can see all orders and filter by customerId.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED] }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *         description: Admin only — filter by customer
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *         example: "2026-01-01"
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *         example: "2026-12-31"
 *       - in: query
 *         name: minAmount
 *         schema: { type: number }
 *       - in: query
 *         name: maxAmount
 *         schema: { type: number }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, totalAmount, status], default: createdAt }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200:
 *         description: Paginated order list
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticate, validateRequest({ query: orderQuerySchema }), orderController.listOrders);

/**
 * @swagger
 * /orders:
 *   post:
 *     tags: [Orders]
 *     summary: Create a new order
 *     description: |
 *       Creates a new order with transactional inventory reservation.
 *       Requires an Idempotency-Key header to prevent duplicate orders.
 *       Stock is reserved atomically using PostgreSQL row-level locks.
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema: { type: string }
 *         description: Unique key (UUID or string) to prevent duplicate order creation
 *         example: "550e8400-e29b-41d4-a716-446655440000"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, items]
 *             properties:
 *               customerId:
 *                 type: string
 *                 format: uuid
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [productId, quantity]
 *                   properties:
 *                     productId:
 *                       type: string
 *                       format: uuid
 *                     quantity:
 *                       type: integer
 *                       minimum: 1
 *     responses:
 *       201:
 *         description: Order created successfully
 *       200:
 *         description: Idempotent repeat — returns previously created order
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Insufficient stock or idempotency key conflict
 *       429:
 *         description: Rate limit exceeded
 */
router.post(
  '/',
  authenticate,
  orderCreationRateLimiter,
  validateRequest({ body: createOrderSchema }),
  orderController.createOrder
);

/**
 * @swagger
 * /orders/{orderId}/cancel:
 *   post:
 *     tags: [Orders]
 *     summary: Cancel an order
 *     description: |
 *       Cancels an order and releases all inventory reservations.
 *       - CUSTOMER: can only cancel their own PENDING or CONFIRMED orders.
 *       - ADMIN: can cancel any eligible order.
 *       Only PENDING and CONFIRMED orders can be cancelled.
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: Customer requested cancellation
 *     responses:
 *       200:
 *         description: Order cancelled — stock reservation released
 *       400:
 *         description: Invalid transition (e.g. cannot cancel a SHIPPED order)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — not your order
 *       404:
 *         description: Order not found
 */
router.post(
  '/:orderId/cancel',
  authenticate,
  validateRequest({ params: orderIdParamSchema, body: cancelOrderSchema }),
  orderController.cancelOrder
);

/**
 * @swagger
 * /orders/{orderId}/status:
 *   patch:
 *     tags: [Orders]
 *     summary: Update order status (Admin only)
 *     description: |
 *       Advances an order through the lifecycle. Valid transitions:
 *       PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
 *       PENDING → CANCELLED (delegates to cancel endpoint logic)
 *       CONFIRMED → CANCELLED (delegates to cancel endpoint logic)
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Order status updated
 *       400:
 *         description: Invalid status transition
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       404:
 *         description: Order not found
 */
router.patch(
  '/:orderId/status',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: orderIdParamSchema, body: updateOrderStatusSchema }),
  orderController.updateOrderStatus
);

/**
 * @swagger
 * /orders/{orderId}/history:
 *   get:
 *     tags: [Orders]
 *     summary: Get order status history
 *     description: Returns the chronological audit trail of all status transitions for an order.
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Status history array
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — not your order
 *       404:
 *         description: Order not found
 */
router.get(
  '/:orderId/history',
  authenticate,
  validateRequest({ params: orderIdParamSchema }),
  orderController.getOrderHistory
);

/**
 * @swagger
 * /orders/{orderId}:
 *   get:
 *     tags: [Orders]
 *     summary: Get an order by ID
 *     description: Returns full order details. CUSTOMER can only access their own orders (IDOR protection). ADMIN can access any order.
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Order details
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — not your order
 *       404:
 *         description: Order not found
 */
router.get(
  '/:orderId',
  authenticate,
  validateRequest({ params: orderIdParamSchema }),
  orderController.getOrderById
);

export const orderRouter = router;
