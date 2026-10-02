import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import { OrderStatus, Prisma, UserRole } from '@prisma/client';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { orderRepository } from '../src/modules/orders/order.repository';
import { createTestAdmin, createTestCustomer, TestAuthUser } from './helpers/auth.helper';
import { formatMoney } from '../src/common/utils/money';

/**
 * Phase 11 — database query optimisation.
 *
 * Two distinct concerns are covered here:
 *
 *  1. BEHAVIOUR — search, filtering, pagination and sorting must be correct. This is what
 *     protects the API contract after the queries were rewritten to be DB-side.
 *
 *  2. N+1 REGRESSION GUARDS — the point of this phase was to remove per-row queries. Those
 *     are asserted structurally (a bounded number of repository round-trips regardless of
 *     page size or row count) rather than by timing. Measured timings live in
 *     `scripts/explain-analyze.ts` and `scripts/measure-queries.ts`; a test that asserted
 *     "faster than X ms" would be flaky on shared CI and would prove nothing about N+1.
 *
 * Every fixture is namespaced with a unique prefix and deleted afterwards, so these tests
 * are safe to run against a database that also holds the 50k-row performance dataset.
 */

const NAMESPACE = `p11-${Date.now()}`;
const EMAIL_DOMAIN = '@p11-test.example';

interface Fixtures {
  categoryId: string;
  productIds: string[];
  owner: TestAuthUser & { customer: { id: string } };
  other: TestAuthUser & { customer: { id: string } };
  admin: TestAuthUser;
  /** Anchored timestamps so date-range assertions are exact rather than "around now". */
  anchor: { sameTimestamp: Date; older: Date; newer: Date };
  orderIds: {
    ownerPending: string;
    ownerConfirmed: string;
    ownerCancelled: string;
    otherPending: string;
    expensive: string;
    cheap: string;
  };
}

let fixtures: Fixtures;

function money(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/**
 * Creates an order directly through Prisma.
 *
 * Deliberately bypassing the service: the list/report endpoints read whatever is in the
 * database, so seeding rows directly keeps these tests independent of the order lifecycle
 * state machine (and of the BullMQ queue, which cannot run without Redis).
 */
async function seedOrder(input: {
  customerId: string;
  productIds: string[];
  status: OrderStatus;
  totalAmount: string;
  createdAt: Date;
  itemCount?: number;
}): Promise<string> {
  const itemCount = input.itemCount ?? 1;

  const order = await prisma.order.create({
    data: {
      customerId: input.customerId,
      orderNumber: `${NAMESPACE}-${input.status}-${Math.random().toString(36).slice(2, 10)}`,
      status: input.status,
      totalAmount: money(input.totalAmount),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      items: {
        create: Array.from({ length: itemCount }, (_, index) => ({
          productId: input.productIds[index % input.productIds.length]!,
          quantity: 1,
          unitPrice: money('10.00'),
          totalPrice: money('10.00'),
        })),
      },
    },
  });

  return order.id;
}

beforeAll(async () => {
  const admin = await createTestAdmin();
  const owner = await createTestCustomer();
  const other = await createTestCustomer();

  const category = await prisma.category.create({
    data: {
      name: `${NAMESPACE} category`,
      slug: `${NAMESPACE}-category`,
    },
  });

  const products = await Promise.all(
    [
      { name: `${NAMESPACE} widget`, sku: `${NAMESPACE}-SKU-1`, price: '25.00', isActive: true },
      { name: `${NAMESPACE} gadget`, sku: `${NAMESPACE}-SKU-2`, price: '75.50', isActive: true },
      { name: `${NAMESPACE} retired part`, sku: `${NAMESPACE}-SKU-3`, price: '500.00', isActive: false },
    ].map((product) =>
      prisma.product.create({
        data: {
          categoryId: category.id,
          name: product.name,
          slug: `${product.sku}-slug`,
          sku: product.sku,
          price: money(product.price),
          isActive: product.isActive,
        },
      })
    )
  );

  const now = Date.now();
  const anchor = {
    sameTimestamp: new Date(now),
    older: new Date(now - 5 * 86_400_000),
    newer: new Date(now + 5 * 86_400_000),
  };

  const productIds = products.map((product) => product.id);

  const [ownerPending, ownerConfirmed, ownerCancelled, otherPending, expensive, cheap] =
    await Promise.all([
      seedOrder({
        customerId: owner.customer.id,
        productIds,
        status: OrderStatus.PENDING,
        totalAmount: '100.00',
        createdAt: anchor.sameTimestamp,
        itemCount: 3,
      }),
      seedOrder({
        customerId: owner.customer.id,
        productIds,
        status: OrderStatus.CONFIRMED,
        totalAmount: '200.00',
        createdAt: anchor.older,
      }),
      seedOrder({
        customerId: owner.customer.id,
        productIds,
        status: OrderStatus.CANCELLED,
        totalAmount: '400.00',
        createdAt: anchor.sameTimestamp,
      }),
      seedOrder({
        customerId: other.customer.id,
        productIds,
        status: OrderStatus.PENDING,
        totalAmount: '150.00',
        createdAt: anchor.sameTimestamp,
      }),
      seedOrder({
        customerId: owner.customer.id,
        productIds,
        status: OrderStatus.CONFIRMED,
        totalAmount: '999.99',
        createdAt: anchor.newer,
      }),
      seedOrder({
        customerId: owner.customer.id,
        productIds,
        status: OrderStatus.PENDING,
        totalAmount: '10.00',
        createdAt: anchor.newer,
      }),
    ]);

  fixtures = {
    categoryId: category.id,
    productIds,
    owner,
    other,
    admin,
    anchor,
    orderIds: {
      ownerPending,
      ownerConfirmed,
      ownerCancelled,
      otherPending,
      expensive,
      cheap,
    },
  };
}, 60_000);

afterAll(async () => {
  if (!fixtures) {
    return;
  }

  const orderIds = Object.values(fixtures.orderIds);

  await prisma.stockReservation.deleteMany({ where: { orderId: { in: orderIds } } });
  // Movements are attached by id, not by relation, and these fixtures never create any.
  await prisma.inventoryMovement.deleteMany({ where: { productId: { in: fixtures.productIds } } });
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { customerId: { in: customerIds() } } });
  await prisma.product.deleteMany({ where: { categoryId: fixtures.categoryId } });
  await prisma.category.deleteMany({ where: { id: fixtures.categoryId } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds() } } });
  await prisma.user.deleteMany({ where: { email: { contains: NAMESPACE } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
}, 60_000);

function customerIds(): string[] {
  return [fixtures.owner.customer.id, fixtures.other.customer.id];
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// =========================================================================
// Order listing
// =========================================================================

describe('Phase 11 — order list query behaviour', () => {
  it('returns the paginated envelope and scopes CUSTOMER requests to their own orders', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ page: 1, limit: 50 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      pagination: {
        page: 1,
        limit: 50,
      },
    });
    expect(typeof response.body.pagination.total).toBe('number');
    expect(response.body.pagination.totalPages).toBe(
      Math.ceil(response.body.pagination.total / 50)
    );

    const customerIdsInPage = new Set(
      response.body.data.map((order: { customerId: string }) => order.customerId)
    );

    // The other customer's order must never leak, and only the owner's id may appear.
    expect(customerIdsInPage.has(fixtures.other.customer.id)).toBe(false);
    for (const customerId of customerIdsInPage) {
      expect(customerId).toBe(fixtures.owner.customer.id);
    }
  });

  it('lets ADMIN see orders from every customer', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.admin.accessToken))
      .query({ customerId: fixtures.other.customer.id, limit: 50 });

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    for (const order of response.body.data) {
      expect(order.customerId).toBe(fixtures.other.customer.id);
    }
  });

  it('forces CUSTOMER ownership scope even when customerId is supplied', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ customerId: fixtures.other.customer.id, limit: 50 });

    expect(response.status).toBe(200);
    for (const order of response.body.data) {
      expect(order.customerId).toBe(fixtures.owner.customer.id);
    }
    expect(response.body.pagination.total).toBeGreaterThan(0);
  });

  it('applies a stable secondary id ordering when the sort column ties', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ sortBy: 'createdAt', sortOrder: 'desc', limit: 100 });

    expect(response.status).toBe(200);

    const rows = response.body.data as { id: string; createdAt: string }[];

    // Two fixtures share an identical createdAt, so ordering must still be deterministic
    // and must never repeat or drop a row.
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (let i = 1; i < rows.length; i += 1) {
      const previous = new Date(rows[i - 1]!.createdAt).getTime();
      const current = new Date(rows[i]!.createdAt).getTime();
      expect(previous).toBeGreaterThanOrEqual(current);

      if (previous === current) {
        expect(rows[i - 1]!.id > rows[i]!.id).toBe(true);
      }
    }
  });

  it('filters by status', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ status: 'CANCELLED', limit: 100 });

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    for (const order of response.body.data) {
      expect(order.status).toBe('CANCELLED');
    }
  });

  it('searches order numbers by substring for ADMIN', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.admin.accessToken))
      .query({ search: NAMESPACE, limit: 100 });

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThanOrEqual(6);
    for (const order of response.body.data) {
      expect(order.orderNumber).toContain(NAMESPACE);
    }
  });

  it('searches customer email for ADMIN via the indexed customer-id path', async () => {
    const emailLocalPart = fixtures.other.user.email.split('@')[0]!;

    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.admin.accessToken))
      .query({ search: emailLocalPart, limit: 100 });

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);

    for (const order of response.body.data) {
      expect(order.customerId).toBe(fixtures.other.customer.id);
    }
  });

  it('never lets CUSTOMER search reach into another customer via email', async () => {
    const emailLocalPart = fixtures.other.user.email.split('@')[0]!;

    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ search: emailLocalPart, limit: 100 });

    expect(response.status).toBe(200);

    for (const order of response.body.data) {
      expect(order.customerId).toBe(fixtures.owner.customer.id);
    }

    // The other customer's orders exist and match the term, but must be invisible here.
    expect(response.body.data.some((order: { id: string }) => order.id === fixtures.orderIds.otherPending)).toBe(
      false
    );
  });

  it('treats the toDate boundary as inclusive of the whole day', async () => {
    const dayOfAnchor = fixtures.anchor.sameTimestamp.toISOString().slice(0, 10);

    const inclusive = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ fromDate: dayOfAnchor, toDate: dayOfAnchor, limit: 100 });

    expect(inclusive.status).toBe(200);

    const ids = new Set((inclusive.body.data as { id: string }[]).map((row) => row.id));
    expect(ids.has(fixtures.orderIds.ownerPending)).toBe(true);
    expect(ids.has(fixtures.orderIds.ownerCancelled)).toBe(true);
    expect(ids.has(fixtures.orderIds.ownerConfirmed)).toBe(false);
    expect(ids.has(fixtures.orderIds.expensive)).toBe(false);

    // A range that ends before the anchor day must exclude it entirely.
    const previousDay = new Date(
      new Date(dayOfAnchor).getTime() - 86_400_000
    ).toISOString().slice(0, 10);

    const excluded = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ fromDate: previousDay, toDate: previousDay, limit: 100 });

    expect(excluded.status).toBe(200);
    expect(
      (excluded.body.data as { id: string }[]).map((row) => row.id)
    ).not.toContain(fixtures.orderIds.ownerPending);
  });

  it('rejects an impossible calendar date', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ fromDate: '2026-02-30' });

    expect(response.status).toBe(400);
  });

  it('filters on an exact decimal amount range, inclusive at both bounds', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ minAmount: '100.00', maxAmount: '400.00', limit: 100 });

    expect(response.status).toBe(200);

    const ids = new Set((response.body.data as { id: string }[]).map((row) => row.id));
    expect(ids.has(fixtures.orderIds.ownerPending)).toBe(true); // exactly 100.00
    expect(ids.has(fixtures.orderIds.ownerConfirmed)).toBe(true); // 200.00
    expect(ids.has(fixtures.orderIds.ownerCancelled)).toBe(true); // exactly 400.00
    expect(ids.has(fixtures.orderIds.cheap)).toBe(false); // 10.00
    expect(ids.has(fixtures.orderIds.expensive)).toBe(false); // 999.99
  });

  it('returns a per-row itemCount computed for the page only', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ limit: 100 });

    expect(response.status).toBe(200);

    const row = response.body.data.find(
      (order: { id: string }) => order.id === fixtures.orderIds.ownerPending
    );
    expect(row).toBeDefined();
    expect(row.itemCount).toBe(3);

    const single = response.body.data.find(
      (order: { id: string }) => order.id === fixtures.orderIds.ownerConfirmed
    );
    expect(single.itemCount).toBe(1);

    for (const order of response.body.data) {
      expect(typeof order.itemCount).toBe('number');
      expect(order.itemCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('caps the page size at MAX_LIMIT', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ limit: 500 });

    expect(response.status).toBe(400);
  });

  it('rejects a sortBy outside the whitelist', async () => {
    const response = await request(app)
      .get('/api/v1/orders')
      .set(auth(fixtures.owner.accessToken))
      .query({ sortBy: 'id) OR 1=1 --' });

    expect(response.status).toBe(400);
  });
});

// =========================================================================
// N+1 regression guards
// =========================================================================

describe('Phase 11 — N+1 regression guards', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('aggregates item counts in ONE call regardless of page size', async () => {
    const countSpy = jest.spyOn(orderRepository, 'countItemsForOrders');

    const small = await orderRepository.findManyForList({
      skip: 0,
      take: 1,
      customerId: fixtures.owner.customer.id,
      searchCustomerFields: false,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(countSpy).toHaveBeenCalledTimes(1);

    countSpy.mockClear();

    const large = await orderRepository.findManyForList({
      skip: 0,
      take: 100,
      customerId: fixtures.owner.customer.id,
      searchCustomerFields: false,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(countSpy).toHaveBeenCalledTimes(1);

    // The call receives the page ids — not the whole table.
    expect(countSpy.mock.calls[0]![0].length).toBe(large[0].length);
    expect(large[0].length).toBeGreaterThanOrEqual(small[0].length);
  });

  it('does not query for item counts when the page is empty', async () => {
    const countSpy = jest.spyOn(orderRepository, 'countItemsForOrders');

    const [rows, total] = await orderRepository.findManyForList({
      skip: 0,
      take: 20,
      customerId: fixtures.owner.customer.id,
      search: 'no-such-order-number-anywhere-zzz',
      searchCustomerFields: false,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(countSpy).not.toHaveBeenCalled();
  });

  it('resolves email-search customer ids with one bounded lookup', async () => {
    const emailLocalPart = fixtures.other.user.email.split('@')[0]!;
    const lookupSpy = jest.spyOn(orderRepository, 'findCustomerIdsMatchingEmail');

    await orderRepository.findManyForList({
      skip: 0,
      take: 20,
      search: emailLocalPart,
      searchCustomerFields: true,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(lookupSpy.mock.calls[0]![0]).toBe(emailLocalPart);
  });

  it('never traverses into customer data for a CUSTOMER-scoped search', async () => {
    const lookupSpy = jest.spyOn(orderRepository, 'findCustomerIdsMatchingEmail');

    await orderRepository.findManyForList({
      skip: 0,
      take: 20,
      customerId: fixtures.owner.customer.id,
      search: fixtures.other.user.email.split('@')[0]!,
      searchCustomerFields: false,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(lookupSpy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Products and categories
// =========================================================================

describe('Phase 11 — product and category query behaviour', () => {
  it('filters products by category', async () => {
    const response = await request(app)
      .get('/api/v1/products')
      .query({ categoryId: fixtures.categoryId, limit: 100 });

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBe(3);
    for (const product of response.body.data) {
      expect(product.categoryId).toBe(fixtures.categoryId);
    }
  });

  it('applies an inclusive exact-decimal price range', async () => {
    const response = await request(app)
      .get('/api/v1/products')
      .query({ minPrice: '25.00', maxPrice: '75.50', limit: 100 });

    expect(response.status).toBe(200);

    const prices = response.body.data
      .filter((product: { categoryId: string }) => product.categoryId === fixtures.categoryId)
      .map((product: { price: string }) => Number(product.price));

    expect(prices.sort((a: number, b: number) => a - b)).toEqual([25, 75.5]);
  });

  it('searches product name and sku substrings', async () => {
    const byName = await request(app)
      .get('/api/v1/products')
      .query({ search: `${NAMESPACE} widget` });

    expect(byName.status).toBe(200);
    expect(
      byName.body.data.some((product: { sku: string }) => product.sku === `${NAMESPACE}-SKU-1`)
    ).toBe(true);

    const bySku = await request(app).get('/api/v1/products').query({ search: `${NAMESPACE}-SKU-2` });

    expect(bySku.status).toBe(200);
    expect(
      bySku.body.data.some((product: { name: string }) => product.name === `${NAMESPACE} gadget`)
    ).toBe(true);
  });

  it('filters by isActive', async () => {
    const response = await request(app)
      .get('/api/v1/products')
      .query({ categoryId: fixtures.categoryId, isActive: 'false', limit: 100 });

    expect(response.status).toBe(200);
    for (const product of response.body.data) {
      expect(product.isActive).toBe(false);
    }
  });

  it('sorts products by an allowed field and paginates deterministically', async () => {
    const ascending = await request(app)
      .get('/api/v1/products')
      .query({ categoryId: fixtures.categoryId, sortBy: 'price', sortOrder: 'asc', limit: 100 });

    expect(ascending.status).toBe(200);

    const prices = ascending.body.data
      .filter((product: { categoryId: string }) => product.categoryId === fixtures.categoryId)
      .map((product: { price: number }) => Number(product.price));

    expect([...prices].sort((a: number, b: number) => a - b)).toEqual(prices);

    const page1 = await request(app)
      .get('/api/v1/products')
      .query({ categoryId: fixtures.categoryId, sortBy: 'price', sortOrder: 'asc', limit: 1 });

    const page2 = await request(app)
      .get('/api/v1/products')
      .query({
        categoryId: fixtures.categoryId,
        sortBy: 'price',
        sortOrder: 'asc',
        limit: 1,
        page: 2,
      });

    expect(page1.body.data[0].id).not.toBe(page2.body.data[0].id);
    expect(page1.body.pagination.total).toBe(page2.body.pagination.total);
  });

  it('rejects a product sortBy outside the whitelist', async () => {
    const response = await request(app).get('/api/v1/products').query({ sortBy: 'price); DROP' });

    expect(response.status).toBe(400);
  });

  it('searches and paginates categories', async () => {
    const response = await request(app)
      .get('/api/v1/categories')
      .query({ search: `${NAMESPACE} category`, limit: 100 });

    expect(response.status).toBe(200);
    expect(response.body.data.some((category: { id: string }) => category.id === fixtures.categoryId)).toBe(
      true
    );
  });
});

// =========================================================================
// Reports
// =========================================================================

describe('Phase 11 — reporting endpoints', () => {
  it('rejects unauthenticated access', async () => {
    const response = await request(app).get('/api/v1/reports/orders');
    expect(response.status).toBe(401);
  });

  it('rejects CUSTOMER access to every report', async () => {
    for (const path of [
      '/api/v1/reports/orders',
      '/api/v1/reports/orders/status-summary',
      '/api/v1/reports/revenue',
      '/api/v1/reports/products',
    ]) {
      const response = await request(app)
        .get(path)
        .set(auth(fixtures.owner.accessToken));

      expect(response.status).toBe(403);
    }
  });

  it('groups every status in the status summary, defaulting absent statuses to 0', async () => {
    const response = await request(app)
      .get('/api/v1/reports/orders/status-summary')
      .set(auth(fixtures.admin.accessToken));

    expect(response.status).toBe(200);

    const summary = response.body.data;
    for (const status of Object.values(OrderStatus)) {
      expect(summary).toHaveProperty(status);
      expect(typeof summary[status]).toBe('number');
    }
  });

  /**
   * Independently computes the aggregates the reports assert on.
   *
   * The expected values are derived from the database rather than hardcoded, because these
   * reports are GLOBAL aggregates: any other order in the database on the same day counts
   * too. Hardcoding would make the test pass only on an empty database, and would silently
   * start failing the moment the performance dataset is loaded.
   */
  async function expectedAggregates(from: Date, to: Date) {
    const row = await prisma.$queryRaw<
      {
        totalOrders: bigint;
        realizedOrders: bigint;
        cancelledOrders: bigint;
        realizedRevenue: Prisma.Decimal | null;
        cancelledRevenue: Prisma.Decimal | null;
      }[]
    >`
      SELECT
        COUNT(*)::bigint                                                              AS "totalOrders",
        COUNT(*) FILTER (WHERE status <> 'CANCELLED')::bigint                         AS "realizedOrders",
        COUNT(*) FILTER (WHERE status =  'CANCELLED')::bigint                         AS "cancelledOrders",
        COALESCE(SUM("totalAmount") FILTER (WHERE status <> 'CANCELLED'), 0)           AS "realizedRevenue",
        COALESCE(SUM("totalAmount") FILTER (WHERE status =  'CANCELLED'), 0)           AS "cancelledRevenue"
      FROM "orders"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
    `;

    const summary = row[0]!;

    return {
      totalOrders: Number(summary.totalOrders),
      realizedOrders: Number(summary.realizedOrders),
      cancelledOrders: Number(summary.cancelledOrders),
      realizedRevenue: formatMoney(summary.realizedRevenue),
      cancelledRevenue: formatMoney(summary.cancelledRevenue),
      averageOrderValue:
        Number(summary.realizedOrders) === 0
          ? formatMoney(new Prisma.Decimal(0))
          : formatMoney(
              new Prisma.Decimal(summary.realizedRevenue ?? 0).div(
                new Prisma.Decimal(Number(summary.realizedOrders))
              )
            ),
    };
  }

  /** The anchor day, as a half-open-friendly [00:00:00.000, 23:59:59.999] window. */
  function anchorDayBounds(): { from: Date; to: Date } {
    const day = fixtures.anchor.sameTimestamp.toISOString().slice(0, 10);
    return {
      from: new Date(`${day}T00:00:00.000Z`),
      to: new Date(`${day}T23:59:59.999Z`),
    };
  }

  it('reports realized revenue and a cancelled breakdown separately', async () => {
    const dayOfAnchor = fixtures.anchor.sameTimestamp.toISOString().slice(0, 10);
    const { from, to } = anchorDayBounds();
    const expected = await expectedAggregates(from, to);

    const response = await request(app)
      .get('/api/v1/reports/revenue')
      .set(auth(fixtures.admin.accessToken))
      .query({ fromDate: dayOfAnchor, toDate: dayOfAnchor, includeCancelled: 'false' });

    expect(response.status).toBe(200);

    const realized = response.body.data;
    expect(realized.filters.includeCancelled).toBe(false);

    // Realized revenue excludes cancelled orders...
    expect(realized.totalRevenue).toBe(expected.realizedRevenue);
    expect(realized.orderCount).toBe(expected.realizedOrders);
    expect(realized.averageOrderValue).toBe(expected.averageOrderValue);

    // ...while the cancelled portion is always broken out, never silently dropped.
    expect(realized.cancelledRevenue).toBe(expected.cancelledRevenue);
    expect(realized.cancelledOrderCount).toBe(expected.cancelledOrders);

    // And the two are genuinely different, so the assertion above is meaningful.
    expect(expected.cancelledOrders).toBeGreaterThan(0);
    expect(Number(realized.cancelledRevenue)).toBeGreaterThan(0);
  });

  it('switches to gross order value when includeCancelled is true', async () => {
    const dayOfAnchor = fixtures.anchor.sameTimestamp.toISOString().slice(0, 10);
    const { from, to } = anchorDayBounds();
    const expected = await expectedAggregates(from, to);

    const response = await request(app)
      .get('/api/v1/reports/revenue')
      .set(auth(fixtures.admin.accessToken))
      .query({ fromDate: dayOfAnchor, toDate: dayOfAnchor, includeCancelled: 'true' });

    expect(response.status).toBe(200);

    const gross = response.body.data;
    expect(gross.filters.includeCancelled).toBe(true);

    // Gross = realized + cancelled, over the same rows.
    expect(gross.orderCount).toBe(expected.realizedOrders + expected.cancelledOrders);
    expect(Number(gross.totalRevenue)).toBeCloseTo(
      Number(expected.realizedRevenue) + Number(expected.cancelledRevenue),
      2
    );

    // The cancelled breakdown is unchanged by the flag.
    expect(gross.cancelledRevenue).toBe(expected.cancelledRevenue);
    expect(gross.cancelledOrderCount).toBe(expected.cancelledOrders);
  });

  it('keeps the cancelled breakdown populated in the order summary', async () => {
    const dayOfAnchor = fixtures.anchor.sameTimestamp.toISOString().slice(0, 10);
    const { from, to } = anchorDayBounds();
    const expected = await expectedAggregates(from, to);

    const response = await request(app)
      .get('/api/v1/reports/orders')
      .set(auth(fixtures.admin.accessToken))
      .query({ fromDate: dayOfAnchor, toDate: dayOfAnchor });

    expect(response.status).toBe(200);

    const summary = response.body.data;

    // Every status is aggregated (includeCancelled is forced true internally) so the
    // cancelled figures can be broken out at all.
    expect(summary.filters.includeCancelled).toBe(true);
    expect(summary.totalOrders).toBe(expected.totalOrders);
    expect(summary.realizedOrders).toBe(expected.realizedOrders);
    expect(summary.cancelledOrders).toBe(expected.cancelledOrders);
    expect(summary.cancelledRevenue).toBe(expected.cancelledRevenue);

    // Revenue and AOV are realized-only, per the business rule.
    expect(summary.totalRevenue).toBe(expected.realizedRevenue);
    expect(summary.averageOrderValue).toBe(expected.averageOrderValue);

    expect(summary.totalOrders).toBe(summary.realizedOrders + summary.cancelledOrders);
  });

  it('bounds the product sales report and returns exact decimal strings', async () => {
    const response = await request(app)
      .get('/api/v1/reports/products')
      .set(auth(fixtures.admin.accessToken))
      .query({ limit: 5 });

    expect(response.status).toBe(200);

    const report = response.body.data;
    expect(report.filters.limit).toBe(5);
    expect(report.count).toBe(report.items.length);
    expect(report.count).toBeLessThanOrEqual(5);

    for (const item of report.items) {
      expect(typeof item.totalRevenue).toBe('string');
      expect(item.totalRevenue).toMatch(/^\d+\.\d{2}$/);
      expect(item.totalQuantitySold).toMatch(/^\d+$/);
    }

    const revenues = report.items.map((item: { totalRevenue: string }) =>
      Number(item.totalRevenue)
    );
    expect([...revenues].sort((a: number, b: number) => b - a)).toEqual(revenues);
  });

  it('rejects an out-of-range or reversed report date window', async () => {
    const reversed = await request(app)
      .get('/api/v1/reports/revenue')
      .set(auth(fixtures.admin.accessToken))
      .query({ fromDate: '2026-03-10', toDate: '2026-03-01' });

    expect(reversed.status).toBe(400);

    const impossible = await request(app)
      .get('/api/v1/reports/revenue')
      .set(auth(fixtures.admin.accessToken))
      .query({ fromDate: '2026-13-01' });

    expect(impossible.status).toBe(400);
  });

  it('rejects a report limit above MAX_LIMIT', async () => {
    const response = await request(app)
      .get('/api/v1/reports/products')
      .set(auth(fixtures.admin.accessToken))
      .query({ limit: 250 });

    expect(response.status).toBe(400);
  });
});

describe('Phase 11 — role guard sanity', () => {
  it('uses distinct roles for the admin and customer fixtures', () => {
    expect(fixtures.admin.user.role).toBe(UserRole.ADMIN);
    expect(fixtures.owner.user.role).toBe(UserRole.CUSTOMER);
  });
});
