-- =========================================================================
-- Phase 11 — Database Optimization, Search, Filtering & Reporting
--
-- Index review outcome: every change below maps to a *specific* query issued by the
-- application. Redundant single-column indexes were dropped rather than kept "just in
-- case" — each one duplicates a prefix of a composite index (or, for `inventories`,
-- the unique constraint's own b-tree) and only adds write amplification.
--
-- Created (composite / access-path indexes)
--   orders            (customerId, createdAt, id)  -> customer order list + IDOR scope
--   orders            (status, createdAt, id)       -> admin status-filtered list
--   orders            (createdAt, id)               -> admin global list + date reports
--   order_items       (orderId), (productId)        -> detail projection / sales report
--   inventory_movements (productId, createdAt)      -> per-product movement ledger
--   order_status_history (orderId, changedAt)       -> order status history
--   stock_reservations (orderId, status)            -> reservation release on cancel
--   products          (categoryId, createdAt, id)   -> category browse, newest first
--   products          (createdAt)                   -> global catalogue ordering
--
-- Created (search indexes)
--   pg_trgm GIN on products.name, products.sku, orders.orderNumber, users.email
--   Substring search is `ILIKE '%term%'`, which a B-tree cannot serve. These make
--   case-insensitive search index-backed instead of a sequential scan.
--
-- Dropped (redundant)
--   orders            (customerId), (status), (createdAt)  -> prefixes of composites
--   products          (categoryId), (isActive)            -> prefix / no selectivity
--   order_status_history (orderId), (changedAt)            -> prefixes of composite
--   inventory_movements (productId), (createdAt)           -> prefixes of composite
--   stock_reservations (orderId), (status)                 -> prefixes of composite
--   inventories       (productId)                          -> duplicates @unique b-tree
--
-- Deliberately NOT indexed: `categories`. It is bounded reference data (tens of rows);
-- a sequential scan is optimal and a GIN index would be pure write overhead.
-- =========================================================================

-- Required by the gin_trgm_ops opclass below. IF NOT EXISTS keeps the migration
-- idempotent on databases where a previous run already installed it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- DropIndex
DROP INDEX IF EXISTS "inventories_productId_idx";

-- DropIndex
DROP INDEX IF EXISTS "inventory_movements_createdAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "inventory_movements_productId_idx";

-- DropIndex
DROP INDEX IF EXISTS "order_status_history_changedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "order_status_history_orderId_idx";

-- DropIndex
DROP INDEX IF EXISTS "orders_createdAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "orders_customerId_idx";

-- DropIndex
DROP INDEX IF EXISTS "orders_status_idx";

-- DropIndex
DROP INDEX IF EXISTS "products_categoryId_idx";

-- DropIndex
DROP INDEX IF EXISTS "products_isActive_idx";

-- DropIndex
DROP INDEX IF EXISTS "stock_reservations_orderId_idx";

-- DropIndex
DROP INDEX IF EXISTS "stock_reservations_status_idx";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_movements_productId_createdAt_idx" ON "inventory_movements"("productId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_status_history_orderId_changedAt_idx" ON "order_status_history"("orderId", "changedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_customerId_createdAt_id_idx" ON "orders"("customerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_status_createdAt_id_idx" ON "orders"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_createdAt_id_idx" ON "orders"("createdAt", "id");

-- CreateIndex (pg_trgm substring search)
CREATE INDEX IF NOT EXISTS "orders_orderNumber_idx" ON "orders" USING GIN ("orderNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_categoryId_createdAt_id_idx" ON "products"("categoryId", "createdAt", "id");

-- CreateIndex (pg_trgm substring search)
CREATE INDEX IF NOT EXISTS "products_name_idx" ON "products" USING GIN ("name" gin_trgm_ops);

-- CreateIndex (pg_trgm substring search)
CREATE INDEX IF NOT EXISTS "products_sku_idx" ON "products" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_reservations_orderId_status_idx" ON "stock_reservations"("orderId", "status");

-- CreateIndex (pg_trgm substring search)
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING GIN ("email" gin_trgm_ops);

-- ANALYZE so the planner picks sensible plans immediately after the index build
-- instead of waiting for autovacuum to refresh statistics.
ANALYZE "orders";
ANALYZE "order_items";
ANALYZE "order_status_history";
ANALYZE "inventory_movements";
ANALYZE "stock_reservations";
ANALYZE "products";
ANALYZE "users";