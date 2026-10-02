import {
  Customer,
  Order,
  OrderItem,
  OrderStatus,
  OrderStatusHistory,
  Prisma,
  ReservationStatus,
  StockReservation,
} from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../common/logger/logger';
import {
  toDateTimeFilter,
  toDecimalFilter,
} from '../../common/validation/query.validation';
import { buildStableOrderBy } from '../../common/utils/sorting';

export interface CreateOrderData {
  customerId: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: Prisma.Decimal;
  items: {
    productId: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    totalPrice: Prisma.Decimal;
  }[];
}

export interface CreateReservationData {
  orderId: string;
  productId: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: Date;
}

export interface CreateStatusHistoryData {
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedBy?: string | null;
  reason?: string | null;
}

// =========================================================================
// Read-model projections
// =========================================================================

/**
 * Column projection for the order list endpoint.
 *
 * Every column not listed here is never transferred over the wire. This matters because
 * `SELECT *` on `orders` would additionally ship `customerId` internals and force the
 * executor to widen the heap fetch; being explicit also makes the response contract
 * obvious and stable.
 *
 * N+1 / OVER-FETCH NOTE — WHY THERE IS NO `_count` HERE
 * ---------------------------------------------------
 * Prisma implements a relation `_count` as a LEFT JOIN against a *fully materialized*
 * derived table:
 *
 *   LEFT JOIN (SELECT "orderId", COUNT(*) FROM "order_items"
 *              WHERE 1=1 GROUP BY "orderId") AS aggr ON ...
 *
 * That derived table aggregates the ENTIRE `order_items` table on every list request —
 * measured at 148,738 rows on the Phase 11 dataset — to produce counts for at most
 * `MAX_LIMIT` (100) orders that are actually returned. The cost scaled with the table,
 * not with the page.
 *
 * The item count is therefore fetched separately, scoped to the page's ids only (see
 * {@link OrderRepository.countItemsForOrders}), which aggregates at most 100 keys via the
 * `order_items(orderId)` index. Still a fixed query count — still no N+1 — but bounded by
 * the page rather than the table.
 */
export const ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  totalAmount: true,
  customerId: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.OrderSelect;

/**
 * Column projection for the order detail endpoint.
 *
 * A single query resolves order + customer (+ the customer's user for the email and for the
 * ownership check) + items (+ their products) + status history. Relations are loaded by
 * Prisma with a fixed, bounded number of statements — the query count does **not** grow
 * with the number of rows returned, which is precisely what makes this N+1-free.
 *
 * `customer.userId` is selected so ownership can be verified without a follow-up lookup,
 * and is stripped from the serialized response by the service layer.
 */
export const ORDER_DETAIL_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  totalAmount: true,
  customerId: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      userId: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  },
  items: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      totalPrice: true,
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          slug: true,
        },
      },
    },
  },
  statusHistory: {
    orderBy: { changedAt: 'asc' },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      changedBy: true,
      reason: true,
      changedAt: true,
    },
  },
} satisfies Prisma.OrderSelect;

export type OrderListRow = Prisma.OrderGetPayload<{ select: typeof ORDER_LIST_SELECT }>;
export type OrderDetailRow = Prisma.OrderGetPayload<{ select: typeof ORDER_DETAIL_SELECT }>;

/** An `OrderListRow` plus the page-scoped line-item count. */
export type OrderListRowWithItemCount = OrderListRow & { itemCount: number };

/**
 * Attaches page-scoped item counts to the list rows.
 *
 * Orders with no items are absent from the grouped aggregate, so the map lookup must
 * fall back to 0 rather than yielding `undefined` (which would serialise as a missing
 * field instead of a zero).
 */
export function attachItemCounts(
  orders: OrderListRow[],
  itemCounts: Map<string, number>
): OrderListRowWithItemCount[] {
  return orders.map((order) => ({
    ...order,
    itemCount: itemCounts.get(order.id) ?? 0,
  }));
}

/**
 * Upper bound on how many matching customer ids an ADMIN order search will inline into
 * `customerId IN (...)`.
 *
 * Admin email search is the one place where a search term can legitimately match a very
 * large set of customers. Inlining every id would degrade into an oversized `IN` list, so
 * the term is capped and the truncation is logged rather than silently hiding matches.
 */
export const MAX_SEARCH_CUSTOMER_IDS = 500;

/** Parameters for the paginated, filtered order list query. */
export interface FindOrdersParams {
  skip: number;
  take: number;
  /** Server-resolved ownership scope. ALWAYS set for CUSTOMER requests. */
  customerId?: string;
  status?: OrderStatus;
  search?: string;
  /** When false, `search` never traverses into customer data. */
  searchCustomerFields: boolean;
  fromDate?: string;
  toDate?: string;
  minAmount?: string;
  maxAmount?: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export class OrderRepository {
  /**
   * Finds a customer by ID. Accepts an optional transaction client to guarantee transactional consistency.
   */
  public async findCustomerById(
    customerId: string,
    tx?: Prisma.TransactionClient
  ): Promise<Customer | null> {
    const client = tx ?? prisma;
    return client.customer.findUnique({
      where: { id: customerId },
    });
  }

  /**
   * Finds a customer by User ID.
   */
  public async findCustomerByUserId(
    userId: string,
    tx?: Prisma.TransactionClient
  ): Promise<Customer | null> {
    const client = tx ?? prisma;
    return client.customer.findUnique({
      where: { userId },
    });
  }

  /**
   * Creates an order with nested order items within an active transaction.
   */
  public async createOrder(
    tx: Prisma.TransactionClient,
    data: CreateOrderData
  ): Promise<Order & { items: OrderItem[] }> {
    return tx.order.create({
      data: {
        customerId: data.customerId,
        orderNumber: data.orderNumber,
        status: data.status,
        totalAmount: data.totalAmount,
        items: {
          create: data.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
          })),
        },
      },
      include: {
        items: true,
      },
    });
  }

  /**
   * Acquires a row-level lock on an order (SELECT ... FOR UPDATE) and fetches its items.
   */
  public async lockOrderById(
    tx: Prisma.TransactionClient,
    orderId: string
  ): Promise<(Order & { items: OrderItem[] }) | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "orders" WHERE id = ${orderId} FOR UPDATE
    `;
    if (!rows || rows.length === 0) {
      return null;
    }
    return tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
      },
    });
  }

  /**
   * Creates every stock reservation for an order in ONE statement (`createMany`).
   *
   * N+1 FIX: replaces one `createStockReservation` call per order line.
   */
  public async createStockReservations(
    tx: Prisma.TransactionClient,
    data: CreateReservationData[]
  ): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    const result = await tx.stockReservation.createMany({
      data: data.map((entry) => ({
        orderId: entry.orderId,
        productId: entry.productId,
        quantity: entry.quantity,
        status: entry.status,
        expiresAt: entry.expiresAt,
      })),
    });

    return result.count;
  }

  /**
   * Finds all ACTIVE stock reservations for a given order within a transaction.
   */
  public async findActiveReservations(
    tx: Prisma.TransactionClient,
    orderId: string
  ): Promise<StockReservation[]> {
    return tx.stockReservation.findMany({
      where: {
        orderId,
        status: ReservationStatus.ACTIVE,
      },
    });
  }

  /**
   * Releases every supplied reservation in ONE statement (`updateMany`).
   *
   * N+1 FIX: replaces one `releaseStockReservation` call per reservation row.
   * Returns the affected count so a partially-released cancellation cannot pass silently.
   */
  public async releaseStockReservations(
    tx: Prisma.TransactionClient,
    reservationIds: string[],
    releasedAt: Date = new Date()
  ): Promise<number> {
    if (reservationIds.length === 0) {
      return 0;
    }

    const result = await tx.stockReservation.updateMany({
      where: {
        id: { in: reservationIds },
        status: ReservationStatus.ACTIVE,
      },
      data: {
        status: ReservationStatus.RELEASED,
        releasedAt,
      },
    });

    return result.count;
  }

  /**
   * Updates an order's status within an active transaction.
   */
  public async updateOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
    status: OrderStatus
  ): Promise<Order & { items: OrderItem[] }> {
    return tx.order.update({
      where: { id: orderId },
      data: { status },
      include: {
        items: true,
      },
    });
  }

  /**
   * Creates an audit entry in the order status history within an active transaction.
   */
  public async createStatusHistory(
    tx: Prisma.TransactionClient,
    data: CreateStatusHistoryData
  ): Promise<OrderStatusHistory> {
    return tx.orderStatusHistory.create({
      data: {
        orderId: data.orderId,
        fromStatus: data.fromStatus,
        toStatus: data.toStatus,
        changedBy: data.changedBy ?? null,
        reason: data.reason ?? null,
      },
    });
  }

  /**
   * Retrieves full chronological status history for an order.
   */
  public async findStatusHistory(orderId: string): Promise<OrderStatusHistory[]> {
    return prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { changedAt: 'asc' },
    });
  }

  /**
   * Finds an order by its ID with nested order items.
   */
  public async findById(
    orderId: string,
    tx?: Prisma.TransactionClient
  ): Promise<(Order & { items: OrderItem[] }) | null> {
    const client = tx ?? prisma;
    return client.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
      },
    });
  }

  /**
   * Builds the SQL-equivalent `WHERE` clause for order listings.
   *
   * Exposed (and pure) so that the list query, the count query and the tests all operate
   * on *exactly* the same predicate — there is no way for the paginated rows and the
   * reported `total` to disagree.
   *
   * `searchCustomerIds` carries the pre-resolved customer ids for an ADMIN email search.
   * Passing them in (instead of letting Prisma traverse `customer.user.email`) is what
   * keeps the query indexed — see {@link findCustomerIdsMatchingEmail}.
   */
  public buildOrderWhere(
    params: FindOrdersParams,
    searchCustomerIds?: string[]
  ): Prisma.OrderWhereInput {
    const conditions: Prisma.OrderWhereInput[] = [];

    // ── Ownership / tenant scope (highest priority predicate) ────────────
    if (params.customerId) {
      conditions.push({ customerId: params.customerId });
    }

    if (params.status) {
      conditions.push({ status: params.status });
    }

    const createdAtFilter = toDateTimeFilter({ from: params.fromDate, to: params.toDate });
    if (createdAtFilter) {
      conditions.push({ createdAt: createdAtFilter });
    }

    const amountFilter = toDecimalFilter({ min: params.minAmount, max: params.maxAmount });
    if (amountFilter) {
      conditions.push({ totalAmount: amountFilter });
    }

    if (params.search) {
      const searchConditions: Prisma.OrderWhereInput[] = [
        { orderNumber: { contains: params.search, mode: 'insensitive' } },
      ];

      // Customer email is only searchable for ADMIN. For CUSTOMER requests the scope is
      // already pinned to their own customerId, so traversing into customer data would be
      // pointless work in the database.
      if (params.searchCustomerFields) {
        // An empty id list means "the term matched no customer". `in: []` is a valid
        // Prisma predicate that compiles to `FALSE`, so the OR degrades safely to an
        // order-number-only search instead of matching every customer.
        searchConditions.push({
          customerId: { in: searchCustomerIds ?? [] },
        });
      }

      conditions.push({ OR: searchConditions });
    }

    return conditions.length > 0 ? { AND: conditions } : {};
  }

  /**
   * Resolves the customer ids whose account email matches an ADMIN order search term.
   *
   * WHY THIS EXISTS — a measured fix, not a guess:
   *
   * Expressing the email search as a Prisma relation filter
   * (`customer: { is: { user: { is: { email: { contains } } } } }`) makes Prisma emit a
   * LEFT JOIN chain across `orders → customers → users`. PostgreSQL then has to drive the
   * scan from `orders`, so the `pg_trgm` index on `users.email` is unusable and the query
   * degrades to a 50k-row join. `EXPLAIN (ANALYZE)` on the perf dataset measured that
   * form at ~155 ms.
   *
   * Resolving the ids first turns it into one trigram-indexed lookup on `users` followed by
   * an indexed `customerId IN (...)` probe on `orders`.
   *
   * The `take` is one greater than the cap so a truncated result is detectable (and
   * reportable) rather than looking like a complete match set.
   */
  public async findCustomerIdsMatchingEmail(
    search: string,
    take: number = MAX_SEARCH_CUSTOMER_IDS + 1
  ): Promise<string[]> {
    const customers = await prisma.customer.findMany({
      where: { user: { is: { email: { contains: search, mode: 'insensitive' } } } },
      select: { id: true },
      take,
      orderBy: { id: 'asc' },
    });

    if (customers.length > MAX_SEARCH_CUSTOMER_IDS) {
      logger.warn(
        {
          search,
          matched: customers.length,
          cap: MAX_SEARCH_CUSTOMER_IDS,
        },
        'Admin order search: email term matched more customers than the id cap; results are truncated'
      );
    }

    return customers.slice(0, MAX_SEARCH_CUSTOMER_IDS).map((customer) => customer.id);
  }

  /**
   * Paginated, filtered, DB-side order listing.
   *
   * Every filter, the `LIMIT`/`OFFSET` and the `ORDER BY` are pushed into PostgreSQL —
   * the API never loads the full result set into Node.js to filter or paginate it.
   * Returns the page of rows plus the total match count in one transaction so the
   * page and the `total` share a consistent snapshot.
   */
  public async findManyForList(
    params: FindOrdersParams
  ): Promise<[OrderListRowWithItemCount[], number]> {
    // Resolve ADMIN email-search customer ids up front so the page and count queries use
    // an indexed `customerId IN (...)` probe instead of a Prisma-compiled join chain.
    const searchCustomerIds =
      params.search && params.searchCustomerFields
        ? await this.findCustomerIdsMatchingEmail(params.search)
        : undefined;

    const where = this.buildOrderWhere(params, searchCustomerIds);

    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: buildStableOrderBy<Prisma.OrderOrderByWithRelationInput>(
          params.sortBy,
          params.sortOrder
        ),
        select: ORDER_LIST_SELECT,
      }),
      prisma.order.count({ where }),
    ]);

    if (orders.length === 0) {
      return [[], total];
    }

    // Item counts for the returned page only — bounded by `take`, not by the table.
    const itemCounts = await this.countItemsForOrders(orders.map((order) => order.id));

    return [attachItemCounts(orders, itemCounts), total];
  }

  /**
   * Counts line items for a bounded set of orders in ONE statement.
   *
   * Scoped to `orderIds`, so the planner uses `order_items(orderId)` and aggregates at
   * most `MAX_LIMIT` groups — versus Prisma's relation `_count`, which aggregates every
   * row in `order_items` regardless of page size.
   */
  public async countItemsForOrders(orderIds: string[]): Promise<Map<string, number>> {
    if (orderIds.length === 0) {
      return new Map();
    }

    const grouped = await prisma.orderItem.groupBy({
      by: ['orderId'],
      where: { orderId: { in: orderIds } },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.orderId, row._count._all]));
  }

  /**
   * Single-query order detail (order + customer + items + products + status history).
   *
   * Used by `GET /api/v1/orders/:orderId`. Because the customer relation (including
   * `userId`) is part of the same projection, the IDOR ownership check costs zero
   * additional round-trips.
   */
  public async findDetailById(orderId: string): Promise<OrderDetailRow | null> {
    return prisma.order.findUnique({
      where: { id: orderId },
      select: ORDER_DETAIL_SELECT,
    });
  }

  /**
   * Fetches only the ownership columns for an order.
   * Used by the status-history endpoint, where the full detail projection would be wasted.
   */
  public async findOwnershipById(orderId: string): Promise<{ customerId: string } | null> {
    return prisma.order.findUnique({
      where: { id: orderId },
      select: { customerId: true },
    });
  }
}

export const orderRepository = new OrderRepository();
