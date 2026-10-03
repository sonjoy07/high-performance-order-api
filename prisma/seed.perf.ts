/**
 * ============================================================================
 * Phase 11 — Performance dataset generator
 * ============================================================================
 *
 * PURPOSE
 * -------
 * Index and query plans cannot be judged on a 30-row table: the planner will happily
 * choose a sequential scan there, which proves nothing. This script builds a dataset
 * large enough that the *difference* between an index scan and a sequential scan is
 * visible in `EXPLAIN (ANALYZE, BUFFERS)` output, so `scripts/explain-analyze.ts`
 * can report real numbers.
 *
 * WHAT IT DOES
 * ------------
 * Generates a realistic, deliberately *skewed* dataset:
 *  - orders are not uniformly distributed over customers (a Zipf-like tail) so that
 *    index selectivity is representative rather than artificially flat;
 *  - products are not uniformly popular, again via a weighted tail;
 *  - `createdAt` is spread across `PERF_DAYS` days with more recent days busier,
 *    which is what real order tables look like;
 *  - statuses follow a weighted distribution so revenue reports have something to
 *    separate (notably a realistic minority of CANCELLED orders).
 *
 * WHY SET-BASED / BATCHED
 * ----------------------
 * Inserting 150k+ rows one-at-a-time takes minutes. `createMany` in batches inserts
 * thousands of rows per statement, so a full seed completes in seconds.
 *
 * WHY DETERMINISTIC
 * -----------------
 * A seeded PRNG (mulberry32) means two runs produce byte-identical data, so an
 * EXPLAIN comparison is reproducible and a before/after index comparison is fair.
 *
 * USAGE
 * -----
 *   npm run db:seed:perf                      # additive, default volumes
 *   PERF_ORDERS=200000 npm run db:seed:perf   # scale up
 *   npm run db:seed:perf -- --reset           # wipe and rebuild (destroys dev data)
 *
 * NOTE: this script is additive by default and uses the `PERF-` order-number prefix
 * so it never collides with the functional seed's `ORD-YYYYMMDD-HEX` numbers.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import {
  InventoryMovementType,
  OrderStatus,
  Prisma,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/order_api';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// ---------------------------------------------------------------------------
// Volumes (env-overridable)
// ---------------------------------------------------------------------------

const NUM_CATEGORIES = int('PERF_CATEGORIES', 25);
const NUM_PRODUCTS = int('PERF_PRODUCTS', 500);
const NUM_CUSTOMERS = int('PERF_CUSTOMERS', 2000);
const NUM_ORDERS = int('PERF_ORDERS', 50000);
const NUM_DAYS = int('PERF_DAYS', 180);
const MIN_ITEMS = int('PERF_MIN_ITEMS', 1);
const MAX_ITEMS = int('PERF_MAX_ITEMS', 5);

/** Rows per `createMany` / batched raw statement. */
const BATCH_SIZE = int('PERF_BATCH_SIZE', 2000);

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, received "${raw}"`);
  }
  return parsed;
}

function bool(name: string): boolean {
  return process.argv.includes(`--${name}`) || process.env[`PERF_${name.toUpperCase()}`] === 'true';
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, deterministic PRNG. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(int('PERF_SEED', 20260101));

function randInt(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

/**
 * Weighted index selection producing a skewed (long-tail) distribution.
 * `weights[i]` is the relative frequency of picking index `i`, so early entries
 * dominate — this is what real customer/product popularity looks like.
 */
function weightedIndex(weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rand() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i]!;
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

/** 1/n-ish falloff: index 0 is very popular, the tail is long. */
function zipfWeights(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, 0.7));
}

// ---------------------------------------------------------------------------
// Realistic-looking text (searchable by substring, like the real catalogue)
// ---------------------------------------------------------------------------

const CATEGORY_NOUNS = [
  'Electronics', 'Books', 'Home', 'Kitchen', 'Garden', 'Sports', 'Toys', 'Health',
  'Beauty', 'Automotive', 'Office', 'Music', 'Pet Supplies', 'Travel', 'Fitness',
  'Clothing', 'Footwear', 'Jewelry', 'Luggage', 'Grocery', 'Baby', 'Gaming',
  'Photography', 'Crafts', 'Outdoor',
] as const;

const PRODUCT_ADJECTIVES = [
  'Wireless', 'Premium', 'Classic', 'Compact', 'Rugged', 'Ultra', 'Eco', 'Smart',
  'Portable', 'Professional', 'Deluxe', 'Essential', 'Advanced', 'Lightweight',
  'Durable', 'Ergonomic', 'Modular', 'Insulated', 'Foldable', 'Rechargeable',
] as const;

const PRODUCT_NOUNS = [
  'Headphones', 'Notebook', 'Blender', 'Backpack', 'Keyboard', 'Monitor', 'Lamp',
  'Speaker', 'Wallet', 'Sneakers', 'Bottle', 'Desk', 'Chair', 'Camera', 'Tripod',
  'Router', 'Charger', 'Jacket', 'Watch', 'Rug', 'Pan', 'Kettle', 'Mouse', 'Hub',
  'Stand', 'Pillow', 'Sheet', 'Toy', 'Puzzle', 'Skillet', 'Planter', 'Toolkit',
] as const;

const SKU_PREFIXES = ['SKU', 'ITM', 'PRD', 'REF', 'CAT'] as const;
const FIRST_NAMES = [
  'Amaya', 'Bruno', 'Chloe', 'Dinesh', 'Elena', 'Farid', 'Grace', 'Hiroshi',
  'Imani', 'Jonas', 'Kavya', 'Liam', 'Mei', 'Noor', 'Oscar', 'Priya',
  'Quinn', 'Ravi', 'Sofia', 'Tariq', 'Uma', 'Viktor', 'Wendy', 'Xiulan',
  'Yusuf', 'Zara',
] as const;
const LAST_NAMES = [
  'Abebe', 'Bergman', 'Costa', 'Duarte', 'Eriksen', 'Fontaine', 'Gupta', 'Haddad',
  'Ibrahim', 'Jensen', 'Kowalski', 'Lindqvist', 'Mwangi', 'Nakamura', 'Okafor',
  'Petrov', 'Quintero', 'Rossi', 'Sato', 'Tanaka', 'Ustinov', 'Vasquez', 'Wagner',
  'Xu', 'Yilmaz', 'Zhang',
] as const;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Batched insert helper
// ---------------------------------------------------------------------------

/** Splits an array into fixed-size chunks. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function progress(label: string, done: number, total: number): void {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  process.stdout.write(`\r  ${label}: ${done.toLocaleString()}/${total.toLocaleString()} (${pct}%)`);
  if (done >= total) process.stdout.write('\n');
}

// ---------------------------------------------------------------------------
// Reset (optional)
// ---------------------------------------------------------------------------

async function reset(): Promise<void> {
  console.log('🗑️  Truncating all tables (--reset)...');
  // TRUNCATE ... CASCADE is one statement and far faster than ordered deletes.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "stock_reservations", "order_status_history", "order_items", "orders",
      "idempotency_keys", "inventory_movements", "inventories", "products",
      "categories", "customers", "refresh_tokens", "users"
    RESTART IDENTITY CASCADE
  `);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * `createdAt` skewed toward recent days.
 * A uniform distribution would make date-range predicates look artificially selective.
 */
function orderTimestamp(now: number, dayIndex: number): Date {
  // dayIndex 0 = oldest day, NUM_DAYS - 1 = today.
  const daysAgo = NUM_DAYS - 1 - dayIndex;
  // Bias toward "today" by cubing a uniform draw within the day.
  const fractionOfDay = rand() ** 3;
  return new Date(now - daysAgo * 86_400_000 - (1 - fractionOfDay) * 86_400_000);
}

async function seedCategoriesAndProducts(): Promise<
  Array<{ id: string; price: Prisma.Decimal }>
> {
  console.log('\n📦 Seeding categories & products...');

  const categoryIds: string[] = [];
  const categoryRows = Array.from({ length: NUM_CATEGORIES }, (_, i) => {
    const id = crypto.randomUUID();
    categoryIds.push(id);
    const noun = CATEGORY_NOUNS[i % CATEGORY_NOUNS.length]!;
    // Namespaced so re-running the additive perf seed can never collide with the
    // functional seed's categories (`name` and `slug` are both unique).
    const suffix = i < CATEGORY_NOUNS.length ? '' : ` ${Math.floor(i / CATEGORY_NOUNS.length) + 1}`;
    const name = `Perf ${noun}${suffix}`;
    return {
      id,
      name,
      slug: slugify(name),
      description: `Perf dataset category: ${name}`,
      createdAt: orderTimestamp(Date.now(), randInt(0, NUM_DAYS - 1)),
    };
  });

  for (const batch of chunk(categoryRows, BATCH_SIZE)) {
    await prisma.category.createMany({ data: batch });
  }
  progress('categories', categoryRows.length, NUM_CATEGORIES);

  const productRows = Array.from({ length: NUM_PRODUCTS }, (_, i) => {
    const code = String(i + 1).padStart(6, '0');
    const name = `${pick(PRODUCT_ADJECTIVES)} ${pick(PRODUCT_NOUNS)} ${code}`;
    // Price built from integer cents via Decimal — never a JS float.
    return {
      id: crypto.randomUUID(),
      categoryId: categoryIds[weightedIndex(categoryWeights)]!,
      name,
      slug: `${slugify(name)}-${code}`,
      description: `Perf dataset product: ${name}`,
      sku: `${pick(SKU_PREFIXES)}-${code}-${randInt(1000, 9999)}`,
      price: new Prisma.Decimal(randInt(199, 250_000)).div(100),
      isActive: rand() < 0.85,
      createdAt: orderTimestamp(Date.now(), randInt(0, NUM_DAYS - 1)),
    };
  });

  for (const batch of chunk(productRows, BATCH_SIZE)) {
    await prisma.product.createMany({ data: batch });
  }
  progress('products', productRows.length, NUM_PRODUCTS);

  // Inventory rows: one per product, with enough stock that the functional suite is
  // not starved by the perf dataset.
  const inventoryRows = productRows.map((product) => ({
    productId: product.id,
    quantity: randInt(500, 5000),
    reservedQuantity: 0,
  }));

  for (const batch of chunk(inventoryRows, BATCH_SIZE)) {
    await prisma.inventory.createMany({ data: batch });
  }
  progress('inventories', inventoryRows.length, NUM_PRODUCTS);

  return productRows.map((product) => ({ id: product.id, price: product.price }));
}

// Weights are built once at module scope so category popularity is skewed but stable.
const categoryWeights = zipfWeights(Math.max(NUM_CATEGORIES, 1));
const customerWeights = zipfWeights(Math.max(NUM_CUSTOMERS, 1));
const productWeights = zipfWeights(Math.max(NUM_PRODUCTS, 1));

async function seedCustomers(
  sharedHash: string
): Promise<{ userIds: string[]; customerIds: string[] }> {
  console.log('\n👥 Seeding customers...');

  const userIds: string[] = [];
  const customerIds: string[] = [];

  const userRows = Array.from({ length: NUM_CUSTOMERS }, (_, i) => {
    const id = crypto.randomUUID();
    const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const last = LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length]!;
    userIds.push(id);
    return {
      id,
      email: `perf.${slugify(first)}.${slugify(last)}.${i}@perf.example.com`,
      passwordHash: sharedHash,
      role: UserRole.CUSTOMER,
      createdAt: orderTimestamp(Date.now(), randInt(0, NUM_DAYS - 1)),
    };
  });

  const customerRows = userRows.map((user, i) => {
    const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const last = LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length]!;
    const id = crypto.randomUUID();
    customerIds.push(id);
    return {
      id,
      userId: user.id,
      firstName: first,
      lastName: last,
      phone: `+1-555-${String(1000 + (i % 9000))}`,
      createdAt: user.createdAt,
    };
  });

  for (const batch of chunk(userRows, BATCH_SIZE)) {
    await prisma.user.createMany({ data: batch });
  }
  for (const batch of chunk(customerRows, BATCH_SIZE)) {
    await prisma.customer.createMany({ data: batch });
  }
  progress('customers', userRows.length, NUM_CUSTOMERS);

  return { userIds, customerIds };
}

/** Weighted status distribution; CANCELLED is a realistic minority. */
const STATUS_WEIGHTS: Array<[OrderStatus, number]> = [
  [OrderStatus.DELIVERED, 40],
  [OrderStatus.SHIPPED, 15],
  [OrderStatus.PROCESSING, 12],
  [OrderStatus.CONFIRMED, 8],
  [OrderStatus.PENDING, 18],
  [OrderStatus.CANCELLED, 7],
];

function pickStatus(): OrderStatus {
  const total = STATUS_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [status, weight] of STATUS_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return status;
  }
  return OrderStatus.DELIVERED;
}

async function seedOrders(
  customerIds: string[],
  products: Array<{ id: string; price: Prisma.Decimal }>
): Promise<void> {
  console.log('\n🧾 Seeding orders, items, history & movements...');

  if (NUM_ORDERS === 0 || customerIds.length === 0 || products.length === 0) {
    console.log('  (skipped — no orders requested or no reference data)');
    return;
  }

  const now = Date.now();
  const statusOrder = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PROCESSING,
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED,
  ];

  let created = 0;

  for (let batchStart = 0; batchStart < NUM_ORDERS; batchStart += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, NUM_ORDERS - batchStart);
    const orderRows: Array<{
      id: string;
      customerId: string;
      orderNumber: string;
      status: OrderStatus;
      totalAmount: Prisma.Decimal;
      createdAt: Date;
      updatedAt: Date;
    }> = [];
    const itemRows: Array<{
      id: string;
      orderId: string;
      productId: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      totalPrice: Prisma.Decimal;
      createdAt: Date;
    }> = [];
    const historyRows: Array<{
      id: string;
      orderId: string;
      fromStatus: OrderStatus | null;
      toStatus: OrderStatus;
      changedAt: Date;
      reason: string;
    }> = [];
    const movementRows: Array<{
      productId: string;
      type: InventoryMovementType;
      quantity: number;
      referenceType: string;
      referenceId: string;
      createdAt: Date;
    }> = [];

    for (let i = 0; i < batchSize; i += 1) {
      const seq = batchStart + i + 1;
      const orderId = crypto.randomUUID();
      const customerId = customerIds[weightedIndex(customerWeights)]!;
      const status = pickStatus();
      const createdAt = orderTimestamp(now, Math.floor(rand() * NUM_DAYS));

      const lineCount = randInt(MIN_ITEMS, Math.max(MIN_ITEMS, MAX_ITEMS));
      // De-duplicate product ids within an order (the API merges them; be faithful).
      const chosen = new Set<string>();
      let totalAmount = new Prisma.Decimal(0);

      for (let line = 0; line < lineCount; line += 1) {
        const productIndex = weightedIndex(productWeights);
        const product = products[productIndex]!;
        if (chosen.has(product.id)) continue;
        chosen.add(product.id);

        const quantity = randInt(1, 4);
        const totalPrice = product.price.mul(quantity);
        totalAmount = totalAmount.add(totalPrice);

        itemRows.push({
          id: crypto.randomUUID(),
          orderId,
          productId: product.id,
          quantity,
          unitPrice: product.price,
          totalPrice,
          createdAt,
        });

        if (status !== OrderStatus.CANCELLED) {
          movementRows.push({
            productId: product.id,
            type: InventoryMovementType.RESERVATION,
            quantity,
            referenceType: 'ORDER',
            referenceId: orderId,
            createdAt,
          });
        }
      }

      orderRows.push({
        id: orderId,
        customerId,
        orderNumber: `PERF-${String(seq).padStart(9, '0')}`,
        status,
        totalAmount,
        createdAt,
        updatedAt: createdAt,
      });

      // A realistic status trail: every order has at least its creation entry.
      historyRows.push({
        id: crypto.randomUUID(),
        orderId,
        fromStatus: null,
        toStatus: OrderStatus.PENDING,
        changedAt: createdAt,
        reason: 'Perf dataset order created',
      });

      // Build the lifecycle trail. CANCELLED is terminal and is always reached *from*
      // some forward status, so a cancelled order gets that status's trail plus a final
      // transition into CANCELLED — which is what the order-detail history renders.
      const forwardIndex =
        status === OrderStatus.CANCELLED ? randInt(0, statusOrder.length - 1) : statusOrder.indexOf(status);

      for (let step = 1; step <= forwardIndex; step += 1) {
        historyRows.push({
          id: crypto.randomUUID(),
          orderId,
          fromStatus: statusOrder[step - 1]!,
          toStatus: statusOrder[step]!,
          changedAt: new Date(createdAt.getTime() + step * 3_600_000),
          reason: `Perf dataset transition to ${statusOrder[step]}`,
        });
      }

      if (status === OrderStatus.CANCELLED) {
        historyRows.push({
          id: crypto.randomUUID(),
          orderId,
          fromStatus: statusOrder[forwardIndex]!,
          toStatus: OrderStatus.CANCELLED,
          changedAt: new Date(createdAt.getTime() + (forwardIndex + 1) * 3_600_000),
          reason: 'Perf dataset order cancelled',
        });
      }
    }

    await prisma.order.createMany({ data: orderRows });
    for (const batch of chunk(itemRows, BATCH_SIZE)) {
      await prisma.orderItem.createMany({ data: batch });
    }
    for (const batch of chunk(historyRows, BATCH_SIZE)) {
      await prisma.orderStatusHistory.createMany({ data: batch });
    }
    for (const batch of chunk(movementRows, BATCH_SIZE)) {
      await prisma.inventoryMovement.createMany({ data: batch });
    }

    created += batchSize;
    progress('orders', created, NUM_ORDERS);
  }
}

/** Refresh planner statistics so EXPLAIN reflects the final table sizes. */
async function refreshStatistics(): Promise<void> {
  console.log('\n📊 Refreshing planner statistics (ANALYZE)...');
  await prisma.$executeRawUnsafe('ANALYZE');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = Date.now();

  console.log('🚀 Phase 11 performance dataset');
  console.log(
    `   categories=${NUM_CATEGORIES} products=${NUM_PRODUCTS} customers=${NUM_CUSTOMERS} ` +
      `orders=${NUM_ORDERS} days=${NUM_DAYS} items/order=${MIN_ITEMS}-${MAX_ITEMS}`
  );

  if (bool('reset')) {
    await reset();
  }

  // One shared hash: these accounts are never used to authenticate, and hashing
  // thousands of passwords would dominate seed time for no benefit.
  const sharedHash = await bcrypt.hash('PerfDatasetPassword123!', 10);

  const products = await seedCategoriesAndProducts();
  const { customerIds } = await seedCustomers(sharedHash);
  await seedOrders(customerIds, products);
  await refreshStatistics();

  const [counts] = await Promise.all([
    prisma.$queryRaw<Array<{ table_name: string; row_count: bigint }>>`
      SELECT relname AS table_name, n_live_tup AS row_count
      FROM pg_stat_user_tables
      WHERE relname IN ('users','customers','categories','products','inventories','orders','order_items','order_status_history','inventory_movements')
      ORDER BY relname
    `,
  ]);

  console.log('\n📋 Row counts (from pg_stat_user_tables):');
  for (const row of counts ?? []) {
    console.log(`   ${row.table_name.padEnd(24)} ${Number(row.row_count).toLocaleString()}`);
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✅ Performance dataset ready in ${seconds}s.`);
  console.log('   Next: npm run perf:explain');
}

main()
  .catch((error) => {
    console.error('\n❌ Performance seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
