import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { validateRequest } from '../../common/middleware/validate.middleware';
import {
  cancelOrderSchema,
  createOrderSchema,
  orderIdParamSchema,
  updateOrderStatusSchema,
} from './order.validation';
import { orderController } from './order.controller';
import { authenticate, requireRole } from '../auth/auth.middleware';

const router = Router();

// Order creation requires authentication (CUSTOMER or ADMIN)
router.post(
  '/',
  authenticate,
  validateRequest({ body: createOrderSchema }),
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
