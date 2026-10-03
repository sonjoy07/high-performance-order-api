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
 * @swagger
 * /reports/orders/status-summary:
 *   get:
 *     tags: [Reports]
 *     summary: Order status breakdown (Admin only)
 *     description: Returns a count of orders grouped by status for the given date range.
 *     parameters:
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *         example: "2026-01-01"
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *         example: "2026-12-31"
 *     responses:
 *       200:
 *         description: Status summary
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   status: { type: string }
 *                   count: { type: integer }
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 */
router.get(
  '/orders/status-summary',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ query: orderReportQuerySchema }),
  reportController.statusSummary
);

/**
 * @swagger
 * /reports/orders:
 *   get:
 *     tags: [Reports]
 *     summary: Order summary report (Admin only)
 *     description: Returns aggregated order metrics — total orders, total revenue, average order value, cancelled count — for the given date range.
 *     parameters:
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *         example: "2026-01-01"
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *         example: "2026-12-31"
 *     responses:
 *       200:
 *         description: Order summary metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalOrders: { type: integer }
 *                 totalRevenue: { type: string, description: "Decimal string" }
 *                 averageOrderValue: { type: string, description: "Decimal string" }
 *                 cancelledOrders: { type: integer }
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 */
router.get(
  '/orders',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ query: orderReportQuerySchema }),
  reportController.orderSummary
);

/**
 * @swagger
 * /reports/revenue:
 *   get:
 *     tags: [Reports]
 *     summary: Revenue report (Admin only)
 *     description: Returns revenue broken down by day or month for the given date range.
 *     parameters:
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *         example: "2026-01-01"
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *         example: "2026-12-31"
 *       - in: query
 *         name: groupBy
 *         schema: { type: string, enum: [day, month], default: day }
 *     responses:
 *       200:
 *         description: Revenue time series
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 */
router.get(
  '/revenue',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ query: revenueReportQuerySchema }),
  reportController.revenue
);

/**
 * @swagger
 * /reports/products:
 *   get:
 *     tags: [Reports]
 *     summary: Product sales report (Admin only)
 *     description: Returns per-product sales metrics — units sold, revenue — sorted by revenue descending.
 *     parameters:
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *         example: "2026-01-01"
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *         example: "2026-12-31"
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *         description: Top N products
 *     responses:
 *       200:
 *         description: Product sales list
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 */
router.get(
  '/products',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ query: productReportQuerySchema }),
  reportController.products
);

export const reportRouter = router;