import { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import {
  createCountLimitSchema,
  createStatusSchema,
  dateRangeFields,
  refineDateRange,
} from '../../common/validation/query.validation';

/**
 * Query contracts for the ADMIN reporting endpoints.
 *
 * Reports are intentionally read-only aggregations. Every filter is pushed into
 * PostgreSQL (`WHERE`), and every aggregate (`COUNT` / `SUM` / `AVG` / `GROUP BY`) is
 * evaluated by the database — Node.js only maps the already-aggregated rows into a
 * response shape.
 */

export const DEFAULT_TOP_PRODUCT_LIMIT = 10;

/** Filters shared by `/reports/orders`, `/reports/revenue` and `/reports/orders/status-summary`. */
export const orderReportQuerySchema = z
  .object({
    ...dateRangeFields,
    status: createStatusSchema(OrderStatus).optional(),
  })
  .superRefine((data, ctx) => {
    refineDateRange(data, ctx);
  });

export type OrderReportQueryInput = z.infer<typeof orderReportQuerySchema>;

/**
 * Revenue report filters.
 *
 * `includeCancelled` defaults to **false**: cancelled orders represent money that was
 * never collected, so folding them into revenue would overstate performance. See
 * README → Reporting for the full business rule.
 */
export const revenueReportQuerySchema = z
  .object({
    ...dateRangeFields,
    status: createStatusSchema(OrderStatus).optional(),
    includeCancelled: z
      .preprocess((val) => {
        if (val === 'true' || val === true) return true;
        if (val === 'false' || val === false) return false;
        return val;
      }, z.boolean())
      .default(false),
  })
  .superRefine((data, ctx) => {
    refineDateRange(data, ctx);
  });

export type RevenueReportQueryInput = z.infer<typeof revenueReportQuerySchema>;

/** Product sales / top products filters. `limit` is capped at MAX_LIMIT (100). */
export const productReportQuerySchema = z
  .object({
    ...dateRangeFields,
    includeCancelled: z
      .preprocess((val) => {
        if (val === 'true' || val === true) return true;
        if (val === 'false' || val === false) return false;
        return val;
      }, z.boolean())
      .default(false),
    limit: createCountLimitSchema(DEFAULT_TOP_PRODUCT_LIMIT),
  })
  .superRefine((data, ctx) => {
    refineDateRange(data, ctx);
  });

export type ProductReportQueryInput = z.infer<typeof productReportQuerySchema>;