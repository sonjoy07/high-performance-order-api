import { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { toDateTimeFilter } from '../../common/validation/query.validation';
import {
  ProductReportQueryInput,
  RevenueReportQueryInput,
} from './report.validation';

export interface DateRangeFilter {
  from?: string;
  to?: string;
}

export interface OrderFilters {
  from?: string;
  to?: string;
  status?: OrderStatus;
  includeCancelled?: boolean;
}

export interface StatusAggregateRow {
  status: OrderStatus;
  orderCount: number;
  totalAmount: Prisma.Decimal | null;
}

export interface ProductSalesRow {
  productId: string;
  productName: string;
  totalQuantitySold: bigint;
  totalRevenue: Prisma.Decimal;
}

/**
 * Builds the SQL-equivalent `WHERE` clause shared by every report.
 *
 * `includeCancelled === false` adds a single `status <> 'CANCELLED'` predicate, which
 * keeps cancelled revenue strictly out of successful revenue. Doing this in SQL (rather
 * than in JS after loading rows) means cancelled orders are never read at all.
 */
export function buildReportWhere(filters: OrderFilters): Prisma.OrderWhereInput {
  const conditions: Prisma.OrderWhereInput[] = [];

  if (filters.status) {
    conditions.push({ status: filters.status });
  }

  const createdAt = toDateTimeFilter({ from: filters.from, to: filters.to });
  if (createdAt) {
    conditions.push({ createdAt });
  }

  if (filters.includeCancelled === false) {
    conditions.push({ status: { not: OrderStatus.CANCELLED } });
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

export class ReportRepository {
  /**
   * Order summary aggregation — `GROUP BY status` with `COUNT` and `SUM`.
   *
   * A single grouped scan produces every figure the summary needs (total orders, revenue,
   * cancellation count, and the derived average). The average itself is computed as a
   * plain ratio of two aggregates rather than `AVG(totalAmount)`, because the business
   * rule for revenue excludes cancelled orders — averaging over a differently-filtered
   * row set would silently disagree with `totalRevenue`.
   *
   * Rows are collapsed into ONE row here; no order-level data is transferred.
   */
  public async getOrderSummary(
    filters: OrderFilters
  ): Promise<{
    totalOrders: number;
    cancelledOrders: number;
    realizedOrders: number;
    totalRevenue: Prisma.Decimal;
    cancelledRevenue: Prisma.Decimal;
    averageOrderValue: Prisma.Decimal;
  }> {
    const where = buildReportWhere(filters);

    const grouped = await prisma.order.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { totalAmount: true },
    });

    let totalOrders = 0;
    let cancelledOrders = 0;
    let realizedOrders = 0;
    let totalRevenue = new Prisma.Decimal(0);
    let cancelledRevenue = new Prisma.Decimal(0);

    for (const row of grouped) {
      const amount = row._sum.totalAmount ?? new Prisma.Decimal(0);
      totalOrders += row._count._all;

      if (row.status === OrderStatus.CANCELLED) {
        cancelledOrders = row._count._all;
        cancelledRevenue = amount;
      } else {
        realizedOrders += row._count._all;
        totalRevenue = totalRevenue.add(amount);
      }
    }

    const averageOrderValue =
      realizedOrders > 0
        ? totalRevenue.div(new Prisma.Decimal(realizedOrders))
        : new Prisma.Decimal(0);

    return {
      totalOrders,
      cancelledOrders,
      realizedOrders,
      totalRevenue,
      cancelledRevenue,
      averageOrderValue,
    };
  }

  /**
   * Order count per status — `GROUP BY status`.
   *
   * The GROUP BY runs entirely in PostgreSQL. The mapper below only flattens the result
   * into a stable object keyed by every `OrderStatus`, filling zeroes for absent rows so
   * clients can chart the response without null handling.
   */
  public async getStatusSummary(filters: DateRangeFilter): Promise<Record<string, number>> {
    const where = buildReportWhere({ ...filters, includeCancelled: true });

    const grouped = await prisma.order.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const summary: Record<string, number> = {};
    for (const status of Object.values(OrderStatus)) {
      summary[status] = 0;
    }

    for (const row of grouped) {
      summary[row.status] = row._count._all;
    }

    return summary;
  }

  /**
   * Revenue aggregation using `COUNT` + `SUM`.
   *
   * Two aggregates, never a row load:
   *  - realized  = orders whose status is not `CANCELLED`
   *  - cancelled = orders whose status is `CANCELLED`
   *
   * An explicit `status` filter is applied to *both* aggregates. That is deliberate: with
   * `status=SHIPPED` the cancelled aggregate correctly collapses to zero, whereas omitting
   * it would report every cancelled order regardless of the filter.
   *
   * `includeCancelled=false` (the default) reports **realized revenue** — money actually
   * collected. `includeCancelled=true` reports **gross order value** instead. Both variants
   * always break the cancelled portion out separately, so nothing is ever hidden.
   */
  public async getRevenueSummary(filters: RevenueReportQueryInput): Promise<{
    totalRevenue: Prisma.Decimal;
    orderCount: number;
    averageOrderValue: Prisma.Decimal;
    cancelledRevenue: Prisma.Decimal;
    cancelledOrderCount: number;
  }> {
    const createdAt = toDateTimeFilter({ from: filters.fromDate, to: filters.toDate });
    const statusCondition: Prisma.OrderWhereInput | undefined = filters.status
      ? { status: filters.status }
      : undefined;
    const statusFilter: Prisma.OrderWhereInput[] = statusCondition ? [statusCondition] : [];
    const dateFilter: Prisma.OrderWhereInput[] = createdAt ? [{ createdAt }] : [];

    const realizedWhere: Prisma.OrderWhereInput = {
      AND: [{ status: { not: OrderStatus.CANCELLED } }, ...statusFilter, ...dateFilter],
    };

    const cancelledWhere: Prisma.OrderWhereInput = {
      AND: [{ status: OrderStatus.CANCELLED }, ...statusFilter, ...dateFilter],
    };

    const [realized, cancelled] = await prisma.$transaction([
      prisma.order.aggregate({
        where: realizedWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.order.aggregate({
        where: cancelledWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
    ]);

    const realizedRevenue = realized._sum.totalAmount ?? new Prisma.Decimal(0);
    const cancelledRevenue = cancelled._sum.totalAmount ?? new Prisma.Decimal(0);
    const realizedCount = realized._count._all;

    const includeCancelled = filters.includeCancelled;
    const totalRevenue = includeCancelled
      ? realizedRevenue.add(cancelledRevenue)
      : realizedRevenue;
    const orderCount = includeCancelled ? realizedCount + cancelled._count._all : realizedCount;

    return {
      totalRevenue,
      orderCount,
      averageOrderValue:
        orderCount > 0 ? totalRevenue.div(new Prisma.Decimal(orderCount)) : new Prisma.Decimal(0),
      cancelledRevenue,
      cancelledOrderCount: cancelled._count._all,
    };
  }

  /**
   * Product sales aggregation.
   *
   * WHY RAW SQL HERE
   * ----------------
   * This report joins `order_items → orders → products` and groups by product while
   * filtering on the *parent* order's date range and status. Prisma's query builder
   * deliberately cannot express a `GROUP BY` across a join: `groupBy` only groups by
   * scalar fields of a single model, and relation traversal in `select` cannot be
   * aggregated. Doing this through Prisma would mean loading every order item into
   * Node.js and summing there — exactly the anti-pattern this phase removes.
   *
   * SAFETY
   * ------
   * The statement is composed with the `Prisma.sql` tagged template, so every runtime
   * value (date bounds, status enum, LIMIT) is sent as a bind parameter. No user input is
   * ever concatenated into SQL text. Static identifiers (`order_items`, `products`, ...)
   * are hard-coded because they are part of the schema, not of the request.
   *
   * Index support: `order_items(productId)` and `orders(createdAt)` / `orders(status)`
   * keep the filtered scan bounded; see README → Database Index Review.
   */
  public async getProductSales(
    filters: ProductReportQueryInput
  ): Promise<ProductSalesRow[]> {
    const createdAt = toDateTimeFilter({ from: filters.fromDate, to: filters.toDate });

    const conditions: Prisma.Sql[] = [];
    if (createdAt) {
      if (createdAt.gte) {
        conditions.push(Prisma.sql`o."createdAt" >= ${createdAt.gte}`);
      }
      if (createdAt.lte) {
        conditions.push(Prisma.sql`o."createdAt" <= ${createdAt.lte}`);
      }
    }
    if (filters.includeCancelled === false) {
      conditions.push(Prisma.sql`o.status <> ${OrderStatus.CANCELLED}::"OrderStatus"`);
    }

    const whereClause: Prisma.Sql =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    return prisma.$queryRaw<ProductSalesRow[]>`
      SELECT
        oi."productId"                       AS "productId",
        p.name                               AS "productName",
        SUM(oi.quantity)::bigint             AS "totalQuantitySold",
        COALESCE(SUM(oi."totalPrice"), 0)    AS "totalRevenue"
      FROM "order_items" oi
      INNER JOIN "orders"   o  ON o.id  = oi."orderId"
      INNER JOIN "products" p  ON p.id  = oi."productId"
      ${whereClause}
      GROUP BY oi."productId", p.name
      ORDER BY "totalRevenue" DESC, "totalQuantitySold" DESC, oi."productId" ASC
      LIMIT ${filters.limit}
    `;
  }
}

export const reportRepository = new ReportRepository();