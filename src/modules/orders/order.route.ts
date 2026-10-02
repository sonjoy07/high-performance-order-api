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

// Order listing. Declared BEFORE `/:orderId` so "orders" is never parsed as an order ID.
// Supports page/limit pagination, search, status, customerId, date range, amount range
// and whitelisted sorting — all resolved inside PostgreSQL.
router.get('/', authenticate, validateRequest({ query: orderQuerySchema }), orderController.listOrders);

// Order creation requires authentication (CUSTOMER or ADMIN)
router.post(
  '/',
  orderCreationRateLimiter,
  validateRequest({ body: createOrderSchema }),
  // idempotency handled by service,
  orderController.createOrder
);

// Order cancellation (Customer can cancel own order; Admin can cancel any order)
router.post(
  '/:orderId/cancel',
  authenticate,
  validateRequest({ params: orderIdParamSchema, body: cancelOrderSchema }),
  orderController.cancelOrder
);

// Order status update (Strictly restricted to ADMIN)
router.patch(
  '/:orderId/status',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: orderIdParamSchema, body: updateOrderStatusSchema }),
  orderController.updateOrderStatus
);

// Order status audit history (Customer can view own order history; Admin can view any)
router.get(
  '/:orderId/history',
  authenticate,
  validateRequest({ params: orderIdParamSchema }),
  orderController.getOrderHistory
);

// Order lookup requires authentication and verifies customer ownership (IDOR prevention)
router.get(
  '/:orderId',
  authenticate,
  validateRequest({ params: orderIdParamSchema }),
  orderController.getOrderById
);

// Backward-compatible alias for :id
router.get('/:id', authenticate, orderController.getOrderById);

export const orderRouter = router;
