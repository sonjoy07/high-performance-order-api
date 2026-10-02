/**
 * Measures the SQL statement count and wall-clock latency of the Phase 11 read paths.
 *
 * This is the complement to `scripts/explain-analyze.ts`:
 *  - `explain-analyze.ts` answers "is this statement efficient?".
 *  - this script answers "how many statements does this request cost?".
 *
 * The N+1 work in this phase was about the second question, so it needs to be measurable
 * rather than asserted. Every operation is invoked through the real repository code (not
 * re-typed SQL), and statements are counted from Prisma's real `query` event.
 *
 * Usage:
 *   npm run perf:queries
 *   npm run perf:queries -- --iterations 20 --warmup 5
 *
 * Results are printed for the developer to interpret. Nothing is asserted as pass/fail
 * here — the regression guard for statement counts lives in the integration tests, which
 * can fail a build. This tool exists to show the numbers.
 */
import dotenv from 'dotenv';
import type { Prisma } from '@prisma/client';
import type { prisma as prismaSingleton } from '../src/config/prisma';
import type { FindOrdersParams } from '../src/modules/orders/order.repository';

dotenv.config();

/**
 * The exact type of the application's Prisma singleton.
 *
 * Taken from the module itself rather than re-declared, so the shim below stays tied to
 * the real client.
 */
type AppPrismaClient = typeof prismaSingleton;

/**
 * Narrows the client to just the `query` event.
 *
 * `createPrismaClient()` declares its return type as `PrismaClient`, which drops the
 * event-name overloads that Prisma infers from the configured log levels — so `$on` on
 * the exported singleton types as `never` even though the event really does fire. The
 * cast is confined to this one call and verified at runtime by the statement counts this
 * script prints.
 */
type QueryEventSource = {
  $on(eventType: 'query', callback: (event: Prisma.QueryEvent) => void): void;
};

const args = process.argv.slice(2);

function argValue(name: string, fallback: number): number {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || args[index + 1] === undefined) {
    return fallback;
  }
  const parsed = Number(args[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const ITERATIONS = argValue('iterations', 10);
const WARMUP = argValue('warmup', 2);

const now = (): number => performance.now();

interface StatementRecorder {
  readonly count: number;
  reset: () => void;
}

/**
 * Counts statements emitted by the application's Prisma singleton.
 *
 * Note this counts *statements*, not repository method calls. Prisma may issue more than
 * one statement for a single method call (for example a relation select), which is
 * exactly the kind of hidden cost this tool exists to surface.
 */
function createStatementRecorder(prisma: AppPrismaClient): StatementRecorder {
  let count = 0;

  (prisma as unknown as QueryEventSource).$on('query', () => {
    count += 1;
  });

  return {
    get count() {
      return count;
    },
    reset() {
      count = 0;
    },
  };
}

interface Measurement {
  name: string;
  detail: string;
  statements: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

async function measure(
  recorder: StatementRecorder,
  measurements: Measurement[],
  name: string,
  detail: string,
  operation: () => Promise<unknown>
): Promise<void> {
  for (let i = 0; i < WARMUP; i += 1) {
    await operation();
  }

  const durations: number[] = [];
  let statements = 0;

  for (let i = 0; i < ITERATIONS; i += 1) {
    recorder.reset();
    const startedAt = now();
    await operation();
    durations.push(now() - startedAt);
    statements = recorder.count;
  }

  const total = durations.reduce((sum, value) => sum + value, 0);

  measurements.push({
    name,
    detail,
    statements,
    avgMs: total / durations.length,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
  });
}

interface Fixtures {
  customerId: string;
  emailSearch: string;
  categoryId: string;
  orderId: string;
  orderIds: string[];
}

/** Resolves realistic ids from the live dataset so nothing is measured against an empty set. */
async function resolveFixtures(
  prisma: AppPrismaClient
): Promise<{ fixtures: Fixtures; tableRows: { table_name: string; rows: string }[] }> {
  // Derived from an existing order rather than "newest customer": the perf seed and the
  // functional seed coexist in this database, and the newest customer may have no orders,
  // which would silently measure an empty page.
  const anchorOrder = await prisma.order.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, customerId: true },
  });

  const customer = anchorOrder
    ? await prisma.customer.findUnique({
        where: { id: anchorOrder.customerId },
        include: { user: { select: { email: true } } },
      })
    : null;

  const pageIds = anchorOrder
    ? (
        await prisma.order.findMany({
          where: { customerId: anchorOrder.customerId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 20,
          select: { id: true },
        })
      ).map((order) => order.id)
    : [];

  const category = await prisma.category.findFirst({ orderBy: { id: 'asc' } });

  const tableRows = await prisma.$queryRaw<{ table_name: string; rows: string }[]>`
    SELECT relname AS table_name, n_live_tup::text AS rows
    FROM pg_stat_user_tables
    WHERE relname IN ('orders','order_items','order_status_history','inventory_movements','products','customers','inventories')
    ORDER BY relname
  `;

  return {
    fixtures: {
      customerId: anchorOrder?.customerId ?? '',
      emailSearch: customer?.user.email.split('@')[0]?.slice(0, 8) ?? '',
      categoryId: category?.id ?? '',
      orderId: anchorOrder?.id ?? '',
      orderIds: pageIds,
    },
    tableRows,
  };
}

async function main(): Promise<void> {
  // `query` events only fire when the client was constructed with the `query` log level,
  // and the level is resolved once at construction time. The env var must therefore be set
  // BEFORE `src/config/prisma` is evaluated, which is why the imports below are dynamic.
  process.env.PRISMA_LOG_QUERIES = 'true';
  // The app logger pins itself to `debug` in development, which would interleave every
  // statement with the results table. `test` keeps query events enabled while silencing it.
  process.env.NODE_ENV = 'test';

  const { prisma } = await import('../src/config/prisma');
  const { orderRepository, MAX_SEARCH_CUSTOMER_IDS } = await import(
    '../src/modules/orders/order.repository'
  );
  const { productRepository } = await import('../src/modules/products/product.repository');
  const { categoryRepository } = await import('../src/modules/categories/category.repository');

  const { fixtures, tableRows } = await resolveFixtures(prisma);

  console.log('Dataset (from pg_stat_user_tables — approximate)');
  for (const row of tableRows) {
    console.log(`  ${row.table_name.padEnd(22)} ~${Number(row.rows).toLocaleString()} rows`);
  }
  console.log(`\niterations=${ITERATIONS} warmup=${WARMUP} take=20\n`);

  if (!fixtures.customerId || fixtures.orderIds.length === 0) {
    throw new Error(
      'No usable fixtures found. Run `npm run db:seed` or `npm run db:seed:perf` first.'
    );
  }

  const recorder = createStatementRecorder(prisma);
  const measurements: Measurement[] = [];

  const baseParams: FindOrdersParams = {
    skip: 0,
    take: 20,
    customerId: fixtures.customerId,
    searchCustomerFields: false,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  };

  await measure(
    recorder,
    measurements,
    'orders.list (CUSTOMER)',
    'customerId scope, page 1',
    () => orderRepository.findManyForList(baseParams)
  );

  await measure(
    recorder,
    measurements,
    'orders.list (ADMIN)',
    'no customer scope, page 1',
    () => orderRepository.findManyForList({ ...baseParams, customerId: undefined })
  );

  await measure(
    recorder,
    measurements,
    'orders.search orderNumber (ADMIN)',
    'trigram substring on orderNumber',
    () =>
      orderRepository.findManyForList({
        ...baseParams,
        customerId: undefined,
        search: 'ORD',
      })
  );

  await measure(
    recorder,
    measurements,
    'orders.search email (ADMIN)',
    `id probe, capped at ${MAX_SEARCH_CUSTOMER_IDS} ids`,
    () =>
      orderRepository.findManyForList({
        ...baseParams,
        customerId: undefined,
        search: fixtures.emailSearch,
        searchCustomerFields: true,
      })
  );

  await measure(
    recorder,
    measurements,
    'orders.detail',
    'order + customer + items + history',
    () => orderRepository.findDetailById(fixtures.orderId)
  );

  await measure(
    recorder,
    measurements,
    'orders.itemCounts',
    `page-scoped, ${fixtures.orderIds.length} ids`,
    () => orderRepository.countItemsForOrders(fixtures.orderIds)
  );

  await measure(
    recorder,
    measurements,
    'products.list',
    'page 1',
    () =>
      productRepository.findMany({
        skip: 0,
        take: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })
  );

  await measure(
    recorder,
    measurements,
    'products.list byCategory',
    'categoryId scoped, page 1',
    () =>
      productRepository.findMany({
        skip: 0,
        take: 20,
        categoryId: fixtures.categoryId,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })
  );

  await measure(
    recorder,
    measurements,
    'categories.list',
    'page 1',
    () =>
      categoryRepository.findMany({
        skip: 0,
        take: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })
  );

  console.log('Read-path measurements (real repository code via the real Prisma client)');
  console.log('='.repeat(80));
  console.log(
    'operation'.padEnd(34) +
      'statements'.padStart(11) +
      'avg ms'.padStart(10) +
      'min ms'.padStart(10) +
      'max ms'.padStart(10)
  );
  console.log('-'.repeat(80));

  for (const m of measurements) {
    console.log(
      m.name.padEnd(34) +
        String(m.statements).padStart(11) +
        m.avgMs.toFixed(3).padStart(10) +
        m.minMs.toFixed(3).padStart(10) +
        m.maxMs.toFixed(3).padStart(10)
    );
  }

  console.log('-'.repeat(80));
  for (const m of measurements) {
    console.log(`  ${m.name} — ${m.detail}`);
  }

  console.log(
    '\nStatement counts must stay constant as page size and data volume grow. If a count\n' +
      'tracks the number of rows returned, that is an N+1 regression.'
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import('../src/config/prisma');
    await prisma.$disconnect();
  });
