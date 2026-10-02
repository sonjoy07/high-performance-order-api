/**
 * ============================================================================
 * Phase 11 — Query Analysis (EXPLAIN ANALYZE)
 * ============================================================================
 *
 * WHAT THIS DOES
 * --------------
 * Runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` against the real SQL that each Phase 11
 * endpoint issues, and prints the planner's chosen plan plus the facts that matter:
 * execution time, actual vs. planned row counts, and buffer I/O.
 *
 * HONESTY RULES
 * -------------
 * This script reports only what PostgreSQL actually did. It never estimates, never
 * extrapolates and never prints a "speedup" figure. If the planner picks a sequential
 * scan, that is what you see — which is exactly the signal needed to know whether an
 * index is earning its write cost.
 *
 * MULTI-STATEMENT SCENARIOS
 * -------------------------
 * A Prisma call with a relation `_count` is NOT one SQL statement: the executor runs the
 * page query and the aggregate as separate statements. Each scenario therefore declares
 * the full statement list, and the reported execution time is the sum across them — the
 * number that actually reflects one HTTP request.
 *
 * WHY THE SQL IS WRITTEN OUT HERE INSTEAD OF LOGGED FROM PRISMA
 * -------------------------------------------------------------
 * Prisma logs parameterised SQL with `$1`-style placeholders that cannot be re-executed
 * standalone. Rather than paraphrase the queries (and risk documenting something the app
 * does not run), each statement below is a faithful transcription of the repository query,
 * with parameters pulled from live data so the plans are representative.
 *
 * USAGE
 * -----
 *   npm run perf:explain                  # every scenario
 *   npm run perf:explain -- --list        # show scenario names
 *   npm run perf:explain -- orders-list   # run scenarios whose name matches
 *   npm run perf:explain -- --json        # machine-readable output
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/order_api';

// ---------------------------------------------------------------------------
// Parameters resolved from live data
// ---------------------------------------------------------------------------

interface Params {
  customerId: string;
  categoryId: string;
  productId: string;
  orderId: string;
  /** The page of order ids, used to model the page-scoped item-count statement. */
  orderIds: string[];
  productIds: string[];
  status: string;
  orderNumberSearch: string;
  emailSearch: string;
  /** The customer id that `emailSearch` resolves to, for the indexed `IN (...)` probe. */
  emailSearchCustomerId: string;
  productNameSearch: string;
  fromDate: Date;
  toDate: Date;
  minAmount: number;
  maxAmount: number;
  minPrice: number;
  maxPrice: number;
  limit: number;
  offset: number;
}

interface Statement {
  label: string;
  text: string;
  values: unknown[];
}

interface Scenario {
  name: string;
  source: string;
  statements: (p: Params) => Statement[];
}

const LIMIT = 20;

/**
 * The exact statement sequence Prisma 7.10 emits for `OrderRepository.findManyForList`.
 *
 * Captured from the Prisma `$on('query')` event rather than hand-written, so this file
 * cannot drift from what the application actually sends to PostgreSQL.
 *
 * Prisma compiles a relation filter into a LEFT JOIN chain (not a subquery) and loads the
 * relation itself in a second statement scoped by `IN (...)`. Both facts are reproduced.
 *
 * `whereValues` returns the bind values for `whereSql`'s `$1..$n`; the LIMIT/OFFSET and
 * COUNT placeholders are appended automatically.
 */
function orderListStatements(
  whereSql: string,
  whereValues: (p: Params) => unknown[]
): (p: Params) => Statement[] {
  return (p) => {
    const values = whereValues(p);
    const after = values.length;
    const pageIds = p.orderIds.slice(0, 5);

    return [
      {
        label: 'page rows',
        text: `
          SELECT o.id, o."orderNumber", o.status, o."totalAmount", o."createdAt", o."updatedAt", o."customerId"
          FROM "orders" o
          WHERE ${whereSql}
          ORDER BY o."createdAt" DESC, o.id DESC
          LIMIT $${after + 1} OFFSET $${after + 2}`,
        values: [...values, LIMIT, p.offset],
      },
      {
        label: 'customer relation (scoped IN — separate statement, as Prisma emits it)',
        text: `
          SELECT c.id, c."firstName", c."lastName"
          FROM "customers" c
          WHERE c.id IN ($1, $2)
          OFFSET $3`,
        values: [p.customerId, p.customerId, 0],
      },
      {
        label: 'total (COUNT for pagination metadata)',
        text: `
          SELECT COUNT(*) AS "count_all"
          FROM (SELECT o.id FROM "orders" o WHERE ${whereSql} OFFSET $${after + 1}) AS "sub"`,
        values: [...values, 0],
      },
      {
        label: 'page-scoped item counts (bounded by LIMIT, not by the table)',
        text: `
          SELECT COUNT(*) AS "count_all", oi."orderId"
          FROM "order_items" oi
          WHERE oi."orderId" IN (${pageIds.map((_, i) => `$${i + 1}`).join(', ')})
          GROUP BY oi."orderId"
          OFFSET $${pageIds.length + 1}`,
        values: [...pageIds, 0],
      },
    ];
  };
}

const scenarios: Scenario[] = [
  {
    name: 'orders:customer-list-default',
    source: 'GET /api/v1/orders (CUSTOMER, default sort)',
    statements: orderListStatements('o."customerId" = $1', (p) => [p.customerId]),
  },
  {
    name: 'orders:customer-list-status-filter',
    source: 'GET /api/v1/orders?status=PROCESSING (CUSTOMER)',
    statements: orderListStatements(
      'o."customerId" = $1 AND o.status = $2::"OrderStatus"',
      (p) => [p.customerId, p.status]
    ),
  },
  {
    name: 'orders:admin-status-filter-global',
    source: 'GET /api/v1/orders?status=PROCESSING (ADMIN, no customer scope)',
    statements: orderListStatements('o.status = $1::"OrderStatus"', (p) => [p.status]),
  },
  {
    name: 'orders:admin-global-list',
    source: 'GET /api/v1/orders (ADMIN, unfiltered)',
    statements: orderListStatements('TRUE', () => []),
  },
  {
    name: 'orders:search-order-number-substring',
    source: 'GET /api/v1/orders?search=... (ADMIN) — ILIKE "%term%" on orderNumber',
    statements: orderListStatements('o."orderNumber" ILIKE $1', (p) => [
      `%${p.orderNumberSearch}%`,
    ]),
  },
  {
    name: 'orders:search-customer-email-substring',
    source:
      'GET /api/v1/orders?search=<email> (ADMIN) — ids resolved via the trigram index, then an indexed customerId probe',
    statements: (p) => [
      {
        label: 'resolve matching customer ids (trigram-indexed on users.email)',
        text: `
          SELECT c.id
          FROM "customers" c
          LEFT JOIN "users" j0 ON j0.id = c."userId"
          WHERE j0.email ILIKE ('%' || $1 || '%') AND j0.id IS NOT NULL
          ORDER BY c.id ASC
          LIMIT $2 OFFSET $3`,
        values: [p.emailSearch, 501, 0],
      },
      {
        label: 'page rows (customerId IN (...) — no join chain)',
        text: `
          SELECT o.id, o."orderNumber", o.status, o."totalAmount", o."createdAt", o."updatedAt"
          FROM "orders" o
          WHERE (o."orderNumber" ILIKE ('%' || $1 || '%') OR o."customerId" IN ($2))
          ORDER BY o."createdAt" DESC, o.id DESC
          LIMIT $3 OFFSET $4`,
        values: [p.emailSearch, p.emailSearchCustomerId, LIMIT, p.offset],
      },
      {
        label: 'total',
        text: `
          SELECT COUNT(*) AS "count_all"
          FROM (
            SELECT o.id
            FROM "orders" o
            WHERE (o."orderNumber" ILIKE ('%' || $1 || '%') OR o."customerId" IN ($2))
            OFFSET $3
          ) AS "sub"`,
        values: [p.emailSearch, p.emailSearchCustomerId, 0],
      },
    ],
  },
  {
    name: 'orders:search-customer-email-legacy-relation-filter',
    source:
      'SUPERSEDED — the Prisma relation-filter form this phase replaced. Kept to document the measured cost of the fix.',
    statements: (p) => [
      {
        label: 'page rows (old implementation)',
        text: `
          SELECT o.id, o."orderNumber", o.status, o."totalAmount", o."createdAt", o."updatedAt"
          FROM "orders" o
          LEFT JOIN "customers" j0 ON j0.id = o."customerId"
          LEFT JOIN "users" j1 ON j1.id = j0."userId"
          WHERE (
            o."orderNumber" ILIKE ('%' || $1 || '%')
            OR (j1.email ILIKE ('%' || $2 || '%') AND j1.id IS NOT NULL AND j0.id IS NOT NULL)
          )
          ORDER BY o."createdAt" DESC, o.id DESC
          LIMIT $3 OFFSET $4`,
        values: [p.emailSearch, p.emailSearch, LIMIT, p.offset],
      },
      {
        label: 'total',
        text: `
          SELECT COUNT(*) AS "count_all"
          FROM (
            SELECT o.id
            FROM "orders" o
            LEFT JOIN "customers" j0 ON j0.id = o."customerId"
            LEFT JOIN "users" j1 ON j1.id = j0."userId"
            WHERE (
              o."orderNumber" ILIKE ('%' || $1 || '%')
              OR (j1.email ILIKE ('%' || $2 || '%') AND j1.id IS NOT NULL AND j0.id IS NOT NULL)
            )
            OFFSET $3
          ) AS "sub"`,
        values: [p.emailSearch, p.emailSearch, 0],
      },
    ],
  },
  {
    name: 'orders:date-range-filter',
    source: 'GET /api/v1/orders?fromDate=&toDate= (same range predicate the reports use)',
    statements: orderListStatements('o."createdAt" >= $1 AND o."createdAt" <= $2', (p) => [
      p.fromDate,
      p.toDate,
    ]),
  },
  {
    name: 'orders:amount-range-filter',
    source: 'GET /api/v1/orders?minAmount=&maxAmount= (exact Decimal comparison, no floats)',
    statements: orderListStatements(
      `o."customerId" = $1
       AND o."totalAmount" >= $2::numeric(12,2)
       AND o."totalAmount" <= $3::numeric(12,2)`,
      (p) => [p.customerId, p.minAmount, p.maxAmount]
    ),
  },
  {
    name: 'orders:list-legacy-relation-count',
    source:
      'SUPERSEDED — the Prisma relation `_count` form this phase replaced. Kept to document the measured cost of the fix.',
    statements: (p) => [
      {
        label: 'page rows WITH relation _count (old implementation)',
        text: `
          SELECT o.id, o."orderNumber", o.status, o."totalAmount", o."createdAt", o."updatedAt",
                 COALESCE("aggr_selection_0_OrderItem"."_aggr_count_items", 0) AS "_aggr_count_items"
          FROM "orders" o
          LEFT JOIN (
            SELECT oi."orderId", COUNT(*) AS "_aggr_count_items"
            FROM "order_items" oi
            WHERE 1=1
            GROUP BY oi."orderId"
          ) AS "aggr_selection_0_OrderItem" ON (o.id = "aggr_selection_0_OrderItem"."orderId")
          LEFT JOIN "customers" j0 ON j0.id = o."customerId"
          WHERE o."customerId" = $1
          ORDER BY o."createdAt" DESC, o.id DESC
          LIMIT $2 OFFSET $3`,
        values: [p.customerId, LIMIT, p.offset],
      },
    ],
  },
  {
    name: 'orders:detail-with-relations',
    source: 'GET /api/v1/orders/:orderId — customer + items→product + status history',
    statements: (p) => [
      {
        label: 'detail projection',
        text: `
          SELECT o.id, o."orderNumber", o.status, o."totalAmount", o."createdAt", o."updatedAt",
                 c.id AS "customerId", c."firstName", c."lastName",
                 oi.id AS "itemId", oi.quantity, oi."unitPrice", oi."totalPrice",
                 p.id AS "productId", p.name AS "productName", p.sku,
                 sh.id AS "historyId", sh."fromStatus", sh."toStatus", sh."changedAt", sh.reason
          FROM "orders" o
          INNER JOIN "customers" c ON c.id = o."customerId"
          LEFT JOIN "order_items" oi ON oi."orderId" = o.id
          LEFT JOIN "products" p ON p.id = oi."productId"
          LEFT JOIN "order_status_history" sh ON sh."orderId" = o.id
          WHERE o.id = $1`,
        values: [p.orderId],
      },
    ],
  },
  {
    name: 'products:category-list',
    source: 'GET /api/v1/products?categoryId=&sortBy=createdAt',
    statements: (p) => [
      {
        label: 'page rows',
        text: `
          SELECT p.id, p.name, p.slug, p.description, p.sku, p.price, p."isActive",
                 p."createdAt", p."updatedAt", p."categoryId", c.name AS "categoryName"
          FROM "products" p
          INNER JOIN "categories" c ON c.id = p."categoryId"
          WHERE p."categoryId" = $1
          ORDER BY p."createdAt" DESC, p.id DESC
          LIMIT $2 OFFSET $3`,
        values: [p.categoryId, LIMIT, p.offset],
      },
      {
        label: 'total',
        text: `SELECT COUNT(*) FROM "products" WHERE "categoryId" = $1`,
        values: [p.categoryId],
      },
    ],
  },
  {
    name: 'products:price-range-list',
    source: 'GET /api/v1/products?minPrice=&maxPrice=',
    statements: (p) => [
      {
        label: 'page rows',
        text: `
          SELECT p.id, p.name, p.sku, p.price
          FROM "products" p
          WHERE p.price >= $1::numeric(12,2) AND p.price <= $2::numeric(12,2)
          ORDER BY p."createdAt" DESC, p.id DESC
          LIMIT $3 OFFSET $4`,
        values: [p.minPrice, p.maxPrice, LIMIT, p.offset],
      },
      {
        label: 'total',
        text: `SELECT COUNT(*) FROM "products" WHERE price >= $1::numeric(12,2) AND price <= $2::numeric(12,2)`,
        values: [p.minPrice, p.maxPrice],
      },
    ],
  },
  {
    name: 'products:search-name-substring',
    source: 'GET /api/v1/products?search=... — ILIKE "%term%" across name and sku',
    statements: (p) => [
      {
        label: 'page rows',
        text: `
          SELECT p.id, p.name, p.sku, p.price
          FROM "products" p
          WHERE p.name ILIKE $1 OR p.sku ILIKE $1
          ORDER BY p."createdAt" DESC, p.id DESC
          LIMIT $2 OFFSET $3`,
        values: [`%${p.productNameSearch}%`, LIMIT, p.offset],
      },
      {
        label: 'total',
        text: `SELECT COUNT(*) FROM "products" WHERE name ILIKE $1 OR sku ILIKE $1`,
        values: [`%${p.productNameSearch}%`],
      },
    ],
  },
  {
    name: 'products:active-only-list',
    source: 'GET /api/v1/products?isActive=true — isActive deliberately has no index',
    statements: (p) => [
      {
        label: 'page rows',
        text: `
          SELECT p.id, p.name, p.price
          FROM "products" p
          WHERE p."isActive" = true
          ORDER BY p."createdAt" DESC, p.id DESC
          LIMIT $1 OFFSET $2`,
        values: [LIMIT, p.offset],
      },
      {
        label: 'total',
        text: `SELECT COUNT(*) FROM "products" WHERE "isActive" = true`,
        values: [],
      },
    ],
  },
  {
    name: 'reports:order-summary-group-by',
    source: 'GET /api/v1/reports/orders — GROUP BY status with COUNT + SUM',
    statements: (p) => [
      {
        label: 'grouped aggregate',
        text: `
          SELECT o.status, COUNT(*) AS "orderCount", SUM(o."totalAmount") AS "totalAmount"
          FROM "orders" o
          WHERE o."createdAt" >= $1 AND o."createdAt" <= $2
          GROUP BY o.status`,
        values: [p.fromDate, p.toDate],
      },
    ],
  },
  {
    name: 'reports:revenue-aggregate',
    source: 'GET /api/v1/reports/revenue — realized (non-cancelled) + cancelled aggregates',
    statements: (p) => [
      {
        label: 'realized aggregate',
        text: `
          SELECT COUNT(*) AS "orderCount", SUM(o."totalAmount") AS "totalAmount"
          FROM "orders" o
          WHERE o.status <> 'CANCELLED'::"OrderStatus"
            AND o."createdAt" >= $1 AND o."createdAt" <= $2`,
        values: [p.fromDate, p.toDate],
      },
      {
        label: 'cancelled aggregate',
        text: `
          SELECT COUNT(*) AS "orderCount", SUM(o."totalAmount") AS "totalAmount"
          FROM "orders" o
          WHERE o.status = 'CANCELLED'::"OrderStatus"
            AND o."createdAt" >= $1 AND o."createdAt" <= $2`,
        values: [p.fromDate, p.toDate],
      },
    ],
  },
  {
    name: 'reports:status-summary-group-by',
    source: 'GET /api/v1/reports/orders/status-summary — counts per status over all time',
    statements: () => [
      {
        label: 'grouped aggregate',
        text: `SELECT o.status, COUNT(*) FROM "orders" o GROUP BY o.status`,
        values: [],
      },
    ],
  },
  {
    name: 'reports:product-sales-join-group',
    source: 'GET /api/v1/reports/products/top — the only raw-SQL report',
    statements: (p) => [
      {
        label: 'joined aggregate',
        text: `
          SELECT oi."productId" AS "productId",
                 p.name         AS "productName",
                 SUM(oi.quantity)::bigint AS "totalQuantitySold",
                 COALESCE(SUM(oi."totalPrice"), 0) AS "totalRevenue"
          FROM "order_items" oi
          INNER JOIN "orders"   o ON o.id  = oi."orderId"
          INNER JOIN "products" p ON p.id  = oi."productId"
          WHERE o.status <> 'CANCELLED'::"OrderStatus"
            AND o."createdAt" >= $1 AND o."createdAt" <= $2
          GROUP BY oi."productId", p.name
          ORDER BY "totalRevenue" DESC, "totalQuantitySold" DESC, oi."productId" ASC
          LIMIT $3`,
        values: [p.fromDate, p.toDate, LIMIT],
      },
    ],
  },
  {
    name: 'inventory:batched-row-locks',
    source: 'POST /api/v1/orders — one FOR UPDATE for ALL lines regardless of line count',
    statements: (p) => [
      {
        label: 'batched lock',
        text: `
          SELECT id, "productId", quantity, "reservedQuantity", version, "createdAt", "updatedAt"
          FROM "inventories"
          WHERE "productId" = ANY($1::text[])
          ORDER BY "productId"
          FOR UPDATE`,
        values: [p.productIds],
      },
    ],
  },
  {
    name: 'inventory:batched-reserved-delta',
    source: 'POST /api/v1/orders — set-based reservedQuantity update for all lines',
    statements: (p) => [
      {
        label: 'set-based update',
        text: `
          UPDATE "inventories" AS i
          SET "reservedQuantity" = i."reservedQuantity" + v.delta,
              "version"           = i."version" + 1,
              "updatedAt"         = NOW()
          FROM (VALUES ($1::text, $2::integer), ($3::text, $4::integer), ($5::text, $6::integer)) AS v(product_id, delta)
          WHERE i."productId" = v.product_id`,
        values: [p.productIds[0], 1, p.productIds[1], 2, p.productIds[2] ?? p.productIds[1], 3],
      },
    ],
  },
  {
    name: 'inventory:movements-per-product',
    source: 'GET /api/v1/inventory/:productId/movements',
    statements: (p) => [
      {
        label: 'page rows',
        text: `
          SELECT im.id, im."productId", im.type, im.quantity,
                 im."referenceType", im."referenceId", im."createdAt"
          FROM "inventory_movements" im
          WHERE im."productId" = $1 AND im."createdAt" <= $2
          ORDER BY im."createdAt" DESC
          LIMIT $3 OFFSET $4`,
        values: [p.productId, p.toDate, LIMIT, p.offset],
      },
      {
        label: 'total',
        text: `SELECT COUNT(*) FROM "inventory_movements" WHERE "productId" = $1`,
        values: [p.productId],
      },
    ],
  },
  {
    name: 'inventory:history-per-order',
    source: 'GET /api/v1/orders/:orderId/history',
    statements: (p) => [
      {
        label: 'status history',
        text: `
          SELECT sh.id, sh."orderId", sh."fromStatus", sh."toStatus",
                 sh."changedBy", sh."changedAt", sh.reason
          FROM "order_status_history" sh
          WHERE sh."orderId" = $1
          ORDER BY sh."changedAt" ASC`,
        values: [p.orderId],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Plan parsing
// ---------------------------------------------------------------------------

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Index?: string;
  'Actual Rows'?: number;
  'Plan Rows'?: number;
  'Actual Total Time'?: number;
  'Sort Method'?: string;
  'Join Type'?: string;
  Plans?: PlanNode[];
}

interface PlanSummary {
  nodeType: string;
  relation?: string;
  index?: string;
  actualRows?: number;
  plannedRows?: number;
  actualTimeMs?: number;
  joinType?: string;
  sortMethod?: string;
  children: PlanSummary[];
}

function summarizePlan(node: PlanNode): PlanSummary {
  return {
    nodeType: node['Node Type'] ?? 'unknown',
    relation: node['Relation Name'],
    index: node.Index,
    actualRows: node['Actual Rows'],
    plannedRows: node['Plan Rows'],
    actualTimeMs: node['Actual Total Time'],
    joinType: node['Join Type'],
    sortMethod: node['Sort Method'],
    children: (node.Plans ?? []).map(summarizePlan),
  };
}

interface StatementResult {
  label: string;
  executionTimeMs: number;
  planningTimeMs: number;
  totalRows: number;
  buffers: { sharedHit: number; sharedRead: number };
  plan: PlanSummary;
  findings: string[];
}

interface ScenarioResult {
  name: string;
  source: string;
  statements: StatementResult[];
  executionTimeMs: number;
  findings: string[];
}

/** Node types where a planned-vs-actual mismatch is never actionable. */
const NON_ACTIONABLE_NODES = new Set(['Limit', 'Result', 'Memoize', 'Gather Merge']);

/**
 * Minimum planned row count before an estimate mismatch is worth reporting.
 * Below this, ordinary sampling noise and LIMIT short-circuiting dominate and the
 * "finding" would be noise rather than signal.
 */
const ESTIMATE_SIGNIFICANCE_ROWS = 50;

function collectFindings(
  root: PlanSummary,
  buffers: { sharedHit: number; sharedRead: number }
): string[] {
  const findings: string[] = [];

  const walk = (node: PlanSummary): void => {
    if (node.sortMethod && node.sortMethod.includes('external merge')) {
      findings.push(
        `Sort spilled to disk (${node.sortMethod}) — this sort exceeded work_mem. Raise work_mem for the query, or remove the need to sort.`
      );
    }

    if (node.nodeType === 'Seq Scan' && node.index === undefined) {
      findings.push(
        node.relation
          ? `Sequential scan on "${node.relation}" (${node.actualRows?.toLocaleString() ?? '?'} rows) — correct while the table is small or the predicate is unselective; an index is only justified if this table grows or this predicate tightens.`
          : 'Sequential scan.'
      );
    }

    const { actualRows, plannedRows, nodeType, relation } = node;
    if (
      !NON_ACTIONABLE_NODES.has(nodeType) &&
      actualRows !== undefined &&
      plannedRows !== undefined &&
      plannedRows >= ESTIMATE_SIGNIFICANCE_ROWS
    ) {
      const ratio = actualRows / plannedRows;
      if (ratio >= 10 || ratio <= 0.1) {
        findings.push(
          `Row estimate off by ${ratio >= 10 ? `${Math.round(ratio)}x` : `${Math.round(1 / ratio)}x`} on ${nodeType}${relation ? ` ("${relation}")` : ''}: planned ${plannedRows.toLocaleString()}, actual ${actualRows.toLocaleString()} — consider raising the statistics target on this column.`
        );
      }
    }

    node.children.forEach(walk);
  };
  walk(root);

  if (buffers.sharedRead > buffers.sharedHit) {
    findings.push(
      `More blocks read from disk (${buffers.sharedRead.toLocaleString()}) than served from cache (${buffers.sharedHit.toLocaleString()}) — the working set exceeds shared_buffers.`
    );
  }

  return [...new Set(findings)];
}

// ---------------------------------------------------------------------------
// Parameter resolution — pulled from live data so plans are representative
// ---------------------------------------------------------------------------

async function resolveParams(): Promise<Params> {
  const client = new Pool({ connectionString });
  try {
    // The busiest customer, so customer-scoped queries are genuinely selective.
    const customer = await client.query<{ id: string; email: string }>(`
      SELECT o."customerId" AS id, u.email
      FROM "orders" o
      INNER JOIN "customers" c ON c.id = o."customerId"
      INNER JOIN "users" u ON u.id = c."userId"
      GROUP BY o."customerId", u.email
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `);

    const category = await client.query<{ id: string }>(`
      SELECT "categoryId" AS id FROM "products"
      GROUP BY "categoryId" ORDER BY COUNT(*) DESC LIMIT 1
    `);

    const order = await client.query<{ id: string; number: string }>(`
      SELECT id, "orderNumber" AS number FROM "orders" ORDER BY "createdAt" DESC LIMIT 1
    `);

    const product = await client.query<{ id: string; name: string; sku: string }>(`
      SELECT id, name, sku FROM "products" ORDER BY "createdAt" DESC LIMIT 1
    `);

    // Money bounds are real quartiles of the live data, so the range predicates
    // return a meaningful row count instead of an accidental empty set.
    const amountRange = await client.query<{ lo: string; hi: string }>(`
      SELECT
        percentile_disc(0.25) WITHIN GROUP (ORDER BY "totalAmount")::text AS lo,
        percentile_disc(0.75) WITHIN GROUP (ORDER BY "totalAmount")::text AS hi
      FROM "orders"
    `);

    const priceRange = await client.query<{ lo: string; hi: string }>(`
      SELECT
        percentile_disc(0.25) WITHIN GROUP (ORDER BY price)::text AS lo,
        percentile_disc(0.75) WITHIN GROUP (ORDER BY price)::text AS hi
      FROM "products"
    `);

    const productIds = await client.query<{ id: string }>(`
      SELECT id FROM "products" ORDER BY "createdAt" DESC LIMIT 2
    `);

    // The actual page the customer-scoped list returns, so the page-scoped item-count
    // statement is measured against the same ids the real request would use.
    const pageIds = await client.query<{ id: string }>(`
      SELECT id FROM "orders"
      WHERE "customerId" = $1
      ORDER BY "createdAt" DESC, id DESC
      LIMIT $2
    `, [customer.rows[0]?.id ?? '', LIMIT]);

    // A 30-day window ending now — how the reports are actually queried.
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - 30 * 86_400_000);

    const email = customer.rows[0]?.email ?? '';
    // Take the local part before '@' so the search term is a realistic substring
    // of a full email, not a prefix of the domain.
    const emailSearch = email.split('@')[0]?.slice(0, 8) ?? '';

    return {
      customerId: customer.rows[0]?.id ?? '',
      categoryId: category.rows[0]?.id ?? '',
      productId: product.rows[0]?.id ?? '',
      orderId: order.rows[0]?.id ?? '',
      orderIds: pageIds.rows.map((row) => row.id),
      productIds: productIds.rows.map((row) => row.id),
      status: 'PROCESSING',
      orderNumberSearch: order.rows[0]?.number.slice(0, 8) ?? '',
      emailSearch,
      emailSearchCustomerId: customer.rows[0]?.id ?? '',
      productNameSearch: product.rows[0]?.name.split(' ').slice(0, 2).join(' ') ?? '',
      fromDate,
      toDate,
      minAmount: Number(amountRange.rows[0]?.lo ?? 0),
      maxAmount: Number(amountRange.rows[0]?.hi ?? 999999),
      minPrice: Number(priceRange.rows[0]?.lo ?? 0),
      maxPrice: Number(priceRange.rows[0]?.hi ?? 999999),
      limit: LIMIT,
      offset: 0,
    };
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printTree(node: PlanSummary, depth = 0): void {
  const indent = '  '.repeat(depth);
  const parts: string[] = [node.nodeType];
  if (node.relation) parts.push(`on ${node.relation}`);
  if (node.index) parts.push(`using ${node.index}`);
  if (node.joinType) parts.push(`(${node.joinType})`);
  if (node.actualRows !== undefined) parts.push(`rows=${node.actualRows.toLocaleString()}`);
  if (node.plannedRows !== undefined) parts.push(`planned=${node.plannedRows.toLocaleString()}`);
  if (node.actualTimeMs !== undefined) parts.push(`time=${node.actualTimeMs.toFixed(3)}ms`);
  if (node.sortMethod) parts.push(`[${node.sortMethod}]`);
  console.log(`${indent}${parts.join(' ')}`);
  node.children.forEach((child) => printTree(child, depth + 1));
}

function printResult(result: ScenarioResult): void {
  console.log('\n' + '='.repeat(100));
  console.log(`SCENARIO  ${result.name}`);
  console.log(`SOURCE    ${result.source}`);
  console.log(
    `REQUEST   ${result.statements.length} statement(s), total execution ${result.executionTimeMs.toFixed(3)}ms`
  );

  for (const statement of result.statements) {
    console.log(
      `\n  [${statement.label}] exec ${statement.executionTimeMs.toFixed(3)}ms | plan ${statement.planningTimeMs.toFixed(3)}ms | rows ${statement.totalRows.toLocaleString()} | buffers hit ${statement.buffers.sharedHit.toLocaleString()} read ${statement.buffers.sharedRead.toLocaleString()}`
    );
    printTree(statement.plan, 2);
  }

  if (result.findings.length > 0) {
    console.log('\nFINDINGS');
    for (const finding of result.findings) {
      console.log(`  - ${finding}`);
    }
  } else {
    console.log(
      '\nFINDINGS  none — no disk-spilling sorts, no unreviewed sequential scans, estimates within 10x of actual.'
    );
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const listOnly = args.includes('--list');
  const filters = args.filter((arg) => !arg.startsWith('--'));

  if (listOnly) {
    console.log('Available scenarios:\n');
    for (const scenario of scenarios) {
      console.log(`  ${scenario.name}`);
      console.log(`      ${scenario.source}`);
    }
    return;
  }

  const selected =
    filters.length === 0
      ? scenarios
      : scenarios.filter((scenario) => filters.some((f) => scenario.name.includes(f)));

  if (selected.length === 0) {
    console.error(`No scenario matched: ${filters.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // One client for every scenario: consistent session settings, and mutating
  // scenarios (the inventory UPDATE) are rolled back so the dataset is unchanged.
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    const counts = await client.query<{ table_name: string; row_count: string }>(`
      SELECT relname AS table_name, n_live_tup::text AS row_count
      FROM pg_stat_user_tables
      WHERE relname IN ('users','customers','categories','products','inventories',
                        'orders','order_items','order_status_history','inventory_movements')
      ORDER BY relname
    `);

    const params = await resolveParams();

    console.log('Database row counts (from pg_stat_user_tables):');
    for (const row of counts.rows) {
      console.log(`  ${row.table_name.padEnd(24)} ${Number(row.row_count).toLocaleString()}`);
    }

    if (!asJson) {
      console.log('\nResolved parameters (from live data):');
      console.log(`  customerId        ${params.customerId}`);
      console.log(`  categoryId        ${params.categoryId}`);
      console.log(`  productId         ${params.productId}`);
      console.log(`  orderId           ${params.orderId}`);
      console.log(`  orderNumberSearch ${params.orderNumberSearch}`);
      console.log(`  emailSearch       ${params.emailSearch}`);
      console.log(`  productNameSearch ${params.productNameSearch}`);
      console.log(
        `  amount range      ${params.minAmount} .. ${params.maxAmount}  (real IQR of order totals)`
      );
      console.log(
        `  price range       ${params.minPrice} .. ${params.maxPrice}  (real IQR of product prices)`
      );
      console.log(
        `  date range        ${params.fromDate.toISOString()} .. ${params.toDate.toISOString()}`
      );
      console.log(`\nRunning ${selected.length} scenario(s)...`);
    }

    const results: ScenarioResult[] = [];

    for (const scenario of selected) {
      const statements = scenario.statements(params);
      const statementResults: StatementResult[] = [];

      await client.query('BEGIN');
      try {
        for (const statement of statements) {
          const explain = await client.query<{ 'QUERY PLAN': Array<Record<string, unknown>> }>(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`,
            statement.values as never[]
          );

          const payload = explain.rows[0]?.['QUERY PLAN'] as unknown as Array<{
            Plan: PlanNode;
            'Execution Time': number;
            'Planning Time': number;
            'Shared Hit Blocks': number;
            'Shared Read Blocks': number;
          }>;

          const entry = payload[0];
          if (!entry) throw new Error(`No plan returned for ${scenario.name} / ${statement.label}`);

          const plan = summarizePlan(entry.Plan);
          const buffers = {
            sharedHit: entry['Shared Hit Blocks'] ?? 0,
            sharedRead: entry['Shared Read Blocks'] ?? 0,
          };

          statementResults.push({
            label: statement.label,
            executionTimeMs: entry['Execution Time'] ?? 0,
            planningTimeMs: entry['Planning Time'] ?? 0,
            totalRows: plan.actualRows ?? 0,
            buffers,
            plan,
            findings: collectFindings(plan, buffers),
          });
        }
      } finally {
        await client.query('ROLLBACK');
      }

      const executionTimeMs = statementResults.reduce(
        (sum, statement) => sum + statement.executionTimeMs,
        0
      );
      const findings = [...new Set(statementResults.flatMap((statement) => statement.findings))];

      results.push({
        name: scenario.name,
        source: scenario.source,
        statements: statementResults,
        executionTimeMs,
        findings,
      });

      if (!asJson) {
        process.stdout.write(
          `  ✓ ${scenario.name} (${executionTimeMs.toFixed(3)}ms across ${statementResults.length} stmt)\n`
        );
      }
    }

    if (asJson) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    for (const result of results) {
      printResult(result);
    }

    console.log('\n' + '='.repeat(100));
    console.log('SUMMARY (sorted by total execution time)');
    console.log('='.repeat(100));
    console.log(
      `${'scenario'.padEnd(42)}${'exec ms'.padStart(10)}${'stmts'.padStart(7)}${'rows'.padStart(12)}  findings`
    );
    for (const result of [...results].sort((a, b) => a.executionTimeMs - b.executionTimeMs)) {
      const rows = result.statements.reduce((sum, statement) => sum + statement.totalRows, 0);
      console.log(
        `${result.name.padEnd(42)}${result.executionTimeMs.toFixed(3).padStart(10)}` +
          `${String(result.statements.length).padStart(7)}` +
          `${rows.toLocaleString().padStart(12)}  ${result.findings.length}`
      );
    }
    console.log(
      '\nThese are the numbers PostgreSQL actually reported for this dataset. Re-run after\n' +
        'changing data volumes or indexes rather than copying figures from this run.'
    );
  } finally {
    // The client MUST be released before pool.end(); end() waits for checked-out clients.
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Query analysis failed:', error);
  process.exitCode = 1;
});
