import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { validateRequest } from '../../common/middleware/validate.middleware';
import { authenticate, requireRole } from '../auth/auth.middleware';
import { reportController } from './report.controller';
import {
  orderReportQuerySchema,
  productReportQuerySchema,
  revenueReportQuerySchema,
} from './report.validation';

const router = Router();

/**
 * Reporting endpoints.
 *
 * Every route is ADMIN-only: aggregates expose cross-customer revenue and product
 * performance, which no CUSTOMER may observe.
 */

// More specific paths are registered first so they are never shadowed.
router.get(
  '/orders/status-summary',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ query: orderReportQuerySchema }),
  reportController.statusSummary
);

router.get(
  '/orders',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ query: orderReportQuerySchema }),
  reportController.orderSummary
);

router.get(
  '/revenue',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ query: revenueReportQuerySchema }),
  reportController.revenue
);

router.get(
  '/products',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ query: productReportQuerySchema }),
  reportController.products
);

export const reportRouter = router;