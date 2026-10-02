import { OrderStatus } from '@prisma/client';
import { formatMoney } from '../../common/utils/money';
import {
  OrderReportQueryInput,
  ProductReportQueryInput,
  RevenueReportQueryInput,
} from './report.validation';
import {
  ProductSalesRow,
  ReportRepository,
  reportRepository as defaultReportRepo,
} from './report.repository';

/**
 * Reporting service.
 *
 * All aggregation happens in PostgreSQL. This layer only maps already-aggregated rows into
 * stable response shapes and formats monetary values as fixed-precision decimal strings.
 *
 * Caching decision: reports are deliberately NOT cached. Unlike the product/category
 * catalogue (which changes rarely), order aggregates change on every single order
 * mutation, so a cached report would need invalidation on the write path of every
 * endpoint plus a short TTL — trading correctness risk for a bounded, indexed aggregation.
 * If reporting later becomes hot enough to justify caching, the correct vehicle is a
 * periodic rollup table / materialized view, not per-request memoization.
 */

export interface OrderSummaryReportView {
  filters: {
    fromDate: string | null;
    toDate: string | null;
    status: OrderStatus | null;
    /** Business rule: cancelled orders are excluded from revenue and average order value. */
    includeCancelled: boolean;
  };
  totalOrders: number;
  realizedOrders: number;
  cancelledOrders: number;
  totalRevenue: string;
  cancelledRevenue: string;
  averageOrderValue: string;
}

export interface RevenueReportView {
  filters: {
    fromDate: string | null;
    toDate: string | null;
    status: OrderStatus | null;
    includeCancelled: boolean;
  };
  totalRevenue: string;
  orderCount: number;
  averageOrderValue: string;
  cancelledRevenue: string;
  cancelledOrderCount: number;
}

/**
 * Every `OrderStatus` key is always present (absent statuses report 0), so clients can
 * chart the response without null handling.
 */
export type StatusSummaryReportView = Record<string, number>;

export interface ProductSalesReportItem {
  productId: string;
  productName: string;
  totalQuantitySold: string;
  totalRevenue: string;
}

export interface ProductSalesReportView {
  filters: {
    fromDate: string | null;
    toDate: string | null;
    includeCancelled: boolean;
    limit: number;
  };
  count: number;
  items: ProductSalesReportItem[];
}

export class ReportService {
  constructor(private readonly repo: ReportRepository = defaultReportRepo) {}

  /**
   * Order summary report (`COUNT` / `SUM` / derived `AVG`, grouped by status in SQL).
   *
   * The grouped aggregation always spans *every* status so the response can break out the
   * cancelled subset (`cancelledOrders` / `cancelledRevenue`). Revenue and average order
   * value are then derived from the non-cancelled rows only, which is the business rule.
   * Excluding cancelled orders in SQL first would make the cancelled breakdown permanently
   * report zero.
   */
  public async getOrderSummary(query: OrderReportQueryInput): Promise<OrderSummaryReportView> {
    // Always include cancelled in the GROUP BY so the cancelled breakdown is populated;
    // realized revenue is still computed only from non-cancelled statuses below.
    const includeCancelled = true;

    const summary = await this.repo.getOrderSummary({
      from: query.fromDate,
      to: query.toDate,
      status: query.status,
      includeCancelled,
    });

    return {
      filters: {
        fromDate: query.fromDate ?? null,
        toDate: query.toDate ?? null,
        status: query.status ?? null,
        includeCancelled,
      },
      totalOrders: summary.totalOrders,
      realizedOrders: summary.realizedOrders,
      cancelledOrders: summary.cancelledOrders,
      totalRevenue: formatMoney(summary.totalRevenue),
      cancelledRevenue: formatMoney(summary.cancelledRevenue),
      averageOrderValue: formatMoney(summary.averageOrderValue),
    };
  }

  /**
   * Status aggregation report (`GROUP BY status`).
   * Always returns every `OrderStatus` key, defaulting to 0, so the shape is stable.
   */
  public async getStatusSummary(
    query: OrderReportQueryInput
  ): Promise<StatusSummaryReportView> {
    return this.repo.getStatusSummary({ from: query.fromDate, to: query.toDate });
  }

  /**
   * Revenue report.
   *
   * Business rule: `CANCELLED` orders represent money that was never collected, so with
   * the default `includeCancelled=false` the report returns **realized revenue** and a
   * realized average order value. `includeCancelled=true` switches `totalRevenue` /
   * `orderCount` / `averageOrderValue` to **gross order value**.
   *
   * Either way the cancelled portion is always broken out as `cancelledRevenue` /
   * `cancelledOrderCount`, so finance can reconcile the two from a single request and
   * cancellation volume is never silently hidden.
   */
  public async getRevenueReport(query: RevenueReportQueryInput): Promise<RevenueReportView> {
    const revenue = await this.repo.getRevenueSummary(query);

    return {
      filters: {
        fromDate: query.fromDate ?? null,
        toDate: query.toDate ?? null,
        status: query.status ?? null,
        includeCancelled: query.includeCancelled,
      },
      totalRevenue: formatMoney(revenue.totalRevenue),
      orderCount: revenue.orderCount,
      averageOrderValue: formatMoney(revenue.averageOrderValue),
      cancelledRevenue: formatMoney(revenue.cancelledRevenue),
      cancelledOrderCount: revenue.cancelledOrderCount,
    };
  }

  /**
   * Product sales / top products report.
   * The result set is always bounded by `limit` (max {@link MAX_LIMIT}).
   */
  public async getProductSalesReport(
    query: ProductReportQueryInput
  ): Promise<ProductSalesReportView> {
    const rows = await this.repo.getProductSales(query);

    return {
      filters: {
        fromDate: query.fromDate ?? null,
        toDate: query.toDate ?? null,
        includeCancelled: query.includeCancelled,
        limit: query.limit,
      },
      count: rows.length,
      items: rows.map((row: ProductSalesRow) => ({
        productId: row.productId,
        productName: row.productName,
        // bigint would not survive JSON.stringify — emit an exact decimal string.
        totalQuantitySold: row.totalQuantitySold.toString(),
        totalRevenue: formatMoney(row.totalRevenue),
      })),
    };
  }
}

export const reportService = new ReportService();