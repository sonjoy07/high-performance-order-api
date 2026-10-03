# high-performance-order-api

A high-performance Order Processing & Inventory Management REST API built with Node.js, Express, TypeScript, PostgreSQL, Prisma ORM, Redis, BullMQ, and modern backend architectural patterns.

Designed to handle high-concurrency order placement, strict inventory consistency with zero overselling, customer-scoped idempotent request retries, distributed cache-aside caching, and asynchronous event-driven background processing.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture & Layering](#architecture--layering)
- [Key Technical Decisions](#key-technical-decisions)
- [Project Structure](#project-structure)
- [Database Design & Indexing](#database-design--indexing)
- [Concurrency & Overselling Prevention](#concurrency--overselling-prevention)
- [Idempotency & Safe Request Retries](#idempotency--safe-request-retries)
- [Caching & Stampede Mitigation](#caching--stampede-mitigation)
- [Background Processing & Queue Architecture](#background-processing--queue-architecture)
- [Authentication & Authorization](#authentication--authorization)
- [Order Lifecycle & Status Management](#order-lifecycle--status-management)
- [API Documentation (Swagger / OpenAPI)](#api-documentation-swagger--openapi)
- [API Endpoints](#api-endpoints)
- [Error Handling Standards](#error-handling-standards)
- [Testing & Verification](#testing--verification)
- [Local Development Setup](#local-development-setup)
- [Docker & Production Runtime](#docker--production-runtime)
- [Environment Variables](#environment-variables)
- [Database Migrations & Seeding](#database-migrations--seeding)
- [Production Considerations & Architectural Trade-offs](#production-considerations--architectural-trade-offs)
- [Submission Notes](#submission-notes)

---

## Project Overview

`high-performance-order-api` solves the core architectural challenges of high-volume e-commerce order management:

1. **Race Conditions & Overselling:** Prevents overselling when concurrent requests compete for the same stock using PostgreSQL row-level locks (`SELECT ... FOR UPDATE`).
2. **Deadlock Elimination:** Uses deterministic lock acquisition ordering (alphabetical sort by `productId`) to avoid cyclic dependency deadlocks during multi-product order checkout.
3. **Safe Network Retries:** Employs customer-scoped `Idempotency-Key` headers with SHA-256 payload hashing to ensure duplicate network transmissions return the original response without creating duplicate orders or reservations.
4. **Decoupled Background Tasks:** Uses BullMQ and Redis to process order notifications and side effects outside of the synchronous database transaction.
5. **Read Scalability:** Employs Redis cache-aside caching with automated pattern-based invalidation, TTLs, and lock-based cache stampede mitigation.
6. **Strict Access Boundaries:** Enforces JWT-based authentication, database-persisted refresh token rotation with reuse detection, and Role-Based Access Control (`CUSTOMER`, `ADMIN`) with ownership verification (IDOR protection).

---

## Features

- **Category & Product Management:** Full CRUD with hierarchical categorization, trigram GIN-indexed full-text search across names and SKUs, active-state filtering, and soft-delete safeguards for products with order history.
- **Inventory Tracking & Auditing:** Real-time physical vs reserved stock tracking, dynamic available quantity calculation (quantity - reservedQuantity), manual stock adjustments (`STOCK_IN`, `STOCK_OUT`, `ADJUSTMENT`), and an immutable movement audit ledger.
- **Transactional Order Placement:** Atomic order creation, inventory reservation, order line persistence, and status history logging within a single PostgreSQL transaction.
- **Order Cancellation & Stock Release:** Transaction-safe cancellation from `PENDING` or `CONFIRMED` status, releasing active stock reservations and recording `RELEASE` inventory movements.
- **Order Status State Machine:** Centralized transition matrix governing order status progression (`PENDING` -> `CONFIRMED` -> `PROCESSING` -> `SHIPPED` -> `DELIVERED`).
- **Idempotent Order Creation:** Client-driven idempotency keys with payload validation, automatic transaction rollback on failure (no poisoned keys), and concurrent duplicate synchronization via database unique constraints.
- **Redis Caching:** Cache-aside caching for categories and products with SCAN-based pattern invalidation on mutations and distributed lock-based stampede mitigation.
- **Asynchronous Workers:** BullMQ-based background worker handling domain events (`ORDER_CREATED`, `ORDER_CANCELLED`, `ORDER_CONFIRMED`, `ORDER_PROCESSING`, `ORDER_SHIPPED`, `ORDER_DELIVERED`) with exponential backoff retries and worker-side idempotency tracking via `ProcessedJob`.
- **Administrative Reporting:** Database-aggregated metrics for order totals, status distribution, daily/monthly revenue time series, and product sales rankings.
- **Security & Rate Limiting:** Layered security using Helmet headers, CORS restrictions, request ID tracking (`X-Request-ID`), and tiered rate limiters (global, authentication, order creation) backed by Redis.
- **Interactive API Documentation:** Full OpenAPI 3.0 specification served via Swagger UI at `/api/docs`.
- **Production Containerization:** Multi-stage Docker build with non-root user execution, `dumb-init` signal handling, Docker Compose orchestration with PostgreSQL 16, Redis 7, API server, and background worker.

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Runtime** | Node.js | v22+ (LTS) | Server runtime environment |
| **Language** | TypeScript | v6.0 | Strict-mode type safety across all layers |
| **Framework** | Express.js | v5.2 | HTTP routing, middleware, and request dispatching |
| **Database** | PostgreSQL | 16 (Alpine) | ACID relational storage, row locking, trigram indexing |
| **ORM / Driver** | Prisma ORM | v7.10 | Type-safe schema, migrations, `@prisma/adapter-pg` driver |
| **Cache & Store** | Redis | 7 (Alpine) | Cache-aside caching, rate limiting store, BullMQ message broker |
| **Redis Client** | ioredis | v6.0 | High-performance Redis client with connection pooling & Lua support |
| **Queue / Worker** | BullMQ | v6.3 | Job queues, delayed retries, exponential backoff, worker concurrency |
| **Validation** | Zod | v4.6 | Runtime request payload, query, and parameter schema validation |
| **Logging** | Pino & Pino-HTTP | v10.3 / v11.0 | Fast JSON structured logging with request correlation IDs |
| **Authentication** | jsonwebtoken & bcryptjs | v9.0 / v3.0 | Stateless JWT signing, bcrypt password hashing (10 rounds) |
| **Rate Limiting** | express-rate-limit | v8.7 | Rate limiting middleware with Redis store integration (`rate-limit-redis`) |
| **Security** | Helmet & CORS | v8.3 / v2.8 | HTTP security headers and Cross-Origin Resource Sharing control |
| **API Docs** | Swagger JSDoc & UI | v6.3 / v5.0 | OpenAPI 3.0 specification generation and interactive documentation |
| **Testing** | Jest & Supertest | v30.5 / v7.3 | Integration, concurrency, unit, and API regression testing |
| **Test Mocks** | ioredis-mock | v8.13 | In-memory Redis simulation for isolated test execution |
| **Process Control** | dumb-init | Alpine | PID 1 init system for container signal handling and zombie reaping |

---

## Architecture & Layering

The codebase enforces a clean, layered architecture with strict separation of concerns:

```text
                           ┌─────────────────────────┐
                           │      HTTP Client        │
                           └────────────┬────────────┘
                                        │
                                        ▼
                           ┌─────────────────────────┐
                           │   Express Application   │
                           │ (Middleware, Rate Limit,│
                           │  Helmet, Request ID)    │
                           └────────────┬────────────┘
                                        │
                                        ▼
                           ┌─────────────────────────┐
                           │       Controller        │  HTTP unwrapping & status codes
                           └────────────┬────────────┘  (No business logic / direct DB)
                                        │
                                        ▼
                           ┌─────────────────────────┐
                           │     Service Layer       │  Domain logic, transactions,
                           └──────┬───────────┬──────┘  cache & queue coordination
                                  │           │
                     ┌────────────┘           └────────────┐
                     ▼                                     ▼
        ┌─────────────────────────┐           ┌─────────────────────────┐
        │       Repository        │           │   Infrastructure Layer  │
        │ (Prisma Client queries) │           │ (Redis Client / BullMQ) │
        └────────────┬────────────┘           └────────────┬────────────┘
                     │                                     │
                     ▼                                     ▼
        ┌─────────────────────────┐           ┌─────────────────────────┐
        │       PostgreSQL 16     │           │         Redis 7         │
        └─────────────────────────┘           └────────────┬────────────┘
                                                           │
                                                           ▼
                                              ┌─────────────────────────┐
                                              │      BullMQ Worker      │
                                              │  (Notification Service) │
                                              └─────────────────────────┘
```

### Layer Responsibilities

1. **Routes & Middleware:** URL routing, request parsing, authentication token verification, rate limiting, and Zod schema validation before passing control to controllers.
2. **Controllers:** Extract HTTP request inputs (`params`, `query`, `body`, `user`), invoke service methods, format output responses, and forward unhandled exceptions to error middleware. Controllers do not execute Prisma queries directly.
3. **Services:** Core business logic, transaction boundaries (`prisma.$transaction`), domain state validation, inventory availability checks, and post-commit background job scheduling.
4. **Repositories:** Data access layer encapsulating Prisma model queries, query projection, ordering, pagination parameters, and explicit locking statements.
5. **Infrastructure:** Redis client management, cache key builders, distributed locking helpers, BullMQ queue definitions, and worker processors.

---

## Key Technical Decisions

### 1. Transactional Order Creation
Order creation spans six database tables: `orders`, `order_items`, `inventories`, `stock_reservations`, `inventory_movements`, and `order_status_history`. Wrapping these operations in a single atomic PostgreSQL transaction guarantees ACID consistency: if any item lacks stock or any constraint fails, the entire transaction rolls back cleanly with no orphan records.

### 2. Pessimistic Concurrency Control (`SELECT ... FOR UPDATE`)
Stock availability is checked and updated under row-level exclusive locks acquired via `SELECT ... FOR UPDATE`. Competing transactions for the same inventory rows queue at the database level and read the freshly committed stock values upon acquiring the lock, preventing race conditions and overselling.

### 3. Deterministic Lock Ordering
When an order contains multiple products, their IDs are normalized, merged, and sorted alphabetically before acquiring locks. Every concurrent transaction attempts to acquire locks in the exact same order (A -> B -> C). This eliminates circular wait conditions, significantly reducing deadlock risk under high concurrency.

### 4. Stock Reservation Pattern
Order placement increments `reservedQuantity` without altering physical `quantity`. Goods remain accounted for during warehouse audits. If an order is cancelled or expires, the reservation is released (`reservedQuantity -= held`) without altering physical inventory. Physical stock is only decremented upon fulfillment.

### 5. Client-Driven Idempotency
Order creation requires an `Idempotency-Key` header. Requests compute a canonical SHA-256 hash of the customer identity and items. The key is claimed inside the database transaction. Duplicate requests return the original response without re-executing inventory reservations, while payload mismatches under the same key return `409 IDEMPOTENCY_KEY_REUSED`.

### 6. Cache-Aside with Stampede Mitigation
Catalogue data (products and categories) uses a Redis cache-aside strategy with configurable TTLs. To mitigate cache stampedes on popular uncached keys, the `withCache` helper acquires a short-lived Redis mutex lock (`SET lock:key token EX lockTtl NX`) so that only one worker fetches from PostgreSQL while concurrent reads wait or read the repopulated cache.

### 7. Decoupled Asynchronous Workers
Order event notifications (`ORDER_CREATED`, `ORDER_CANCELLED`, etc.) are queued to BullMQ **after** the database transaction has committed. A dedicated worker process handles notifications with 3 retry attempts and exponential backoff. The worker enforces idempotency by recording processed events in a PostgreSQL `processed_jobs` table.

### 8. Stateless JWT with Refresh Token Rotation
Authentication uses short-lived JWT access tokens (15m) and long-lived refresh tokens (7d). Refresh tokens are stored in the database as SHA-256 hashes. Upon refresh, the presented token is revoked and a new pair is issued (rotation). If a revoked token is presented, the system treats it as potential reuse and blocks the request.

---

## Project Structure

```text
high-performance-order-api/
├── prisma/
│   ├── migrations/              # Database migration SQL history
│   ├── schema.prisma            # Prisma schema models, indexes, and relations
│   ├── seed.ts                  # Standard development seed data
│   └── seed.perf.ts             # High-volume performance benchmark seed
├── src/
│   ├── app.ts                   # Express application setup & middleware assembly
│   ├── server.ts                # HTTP API server entry point & graceful shutdown
│   ├── worker.ts                # BullMQ worker process entry point & graceful shutdown
│   ├── config/
│   │   ├── env.ts               # Environment configuration with Zod validation
│   │   ├── prisma.ts            # Singleton PrismaClient with PostgreSQL adapter
│   │   └── swagger.ts           # Swagger/OpenAPI 3.0 JSDoc specification
│   ├── common/
│   │   ├── cache/               # Cache key builders and withCache stampede helper
│   │   ├── errors/              # Centralized application errors and AppError hierarchy
│   │   ├── logger/              # Pino structured logger singleton
│   │   ├── middleware/          # Request logger, error handler, rate limiters, auth guards
│   │   ├── types/               # Shared pagination, response, and user token types
│   │   └── utils/               # Currency decimal formatting, sorting, and pagination helpers
│   ├── infrastructure/
│   │   └── redis/               # ioredis client, RedisService, distributed lock helpers
│   ├── jobs/
│   │   └── order.jobs.ts        # Order event payload interfaces and types
│   ├── queues/
│   │   ├── queue.constants.ts   # Queue names, event types, and default retry options
│   │   ├── queue.factory.ts     # BullMQ queue instances and connection management
│   │   └── queues.ts            # Producer helper functions (enqueueOrderCreated, etc.)
│   ├── workers/
│   │   ├── notification.service.ts # Notification handler implementation
│   │   └── notification.worker.ts  # BullMQ worker runner with ProcessedJob idempotency
│   └── modules/
│       ├── auth/                # Authentication, token rotation, RBAC, user profile
│       ├── categories/          # Category CRUD, pagination, caching
│       ├── health/              # Liveness (/health) and readiness (/health/ready) probes
│       ├── inventory/           # Stock levels, adjustments, movement audit ledger
│       ├── orders/              # Order placement, locking, cancellation, history
│       ├── products/            # Product catalog, search, filtering, soft-delete
│       └── reports/             # Administrative financial and order metrics
├── tests/                       # Automated test suites (Jest + Supertest)
│   ├── auth.test.ts             # Authentication, token rotation, RBAC, IDOR tests
│   ├── cache.test.ts            # Redis caching, invalidation, and fallback tests
│   ├── category.test.ts         # Category endpoints, pagination, validation
│   ├── health.test.ts           # Health & readiness probes, 404 handler
│   ├── idempotency.test.ts      # Replay, hash conflicts, concurrency, rollback tests
│   ├── inventory.test.ts        # Stock adjustments, negative stock rejection, locks
│   ├── order.test.ts            # Order creation, row locking, race conditions
│   ├── order-lifecycle.test.ts  # State machine, cancellation, stock release, race safety
│   ├── phase11-query.test.ts    # Search, filtering, indexing, and report aggregates
│   ├── product.test.ts          # Product catalog CRUD, price boundary filtering, soft delete
│   ├── security.test.ts         # Security headers, parameter tampering, SQL injection
│   └── unit/                    # Unit tests for pure domain and business logic
├── docker-compose.yml           # Multi-container orchestration (postgres, redis, api, worker)
├── Dockerfile                   # Multi-stage production container build
├── .dockerignore                # Excluded build artifacts and local secrets
├── .env.example                 # Documented environment variable template
├── package.json                 # Dependencies and npm script targets
├── tsconfig.json                # TypeScript compiler configuration
└── README.md                    # Project documentation
```

---

## Database Design & Indexing

The schema models an enterprise order-processing engine with strict referential integrity:

```text
 ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
 │    User      │──────<│ RefreshToken │       │   Category   │
 └──────┬───────┘       └──────────────┘       └──────┬───────┘
        │ 1:1                                         │ 1:N
        ▼                                             ▼
 ┌──────────────┐                              ┌──────────────┐
 │   Customer   │──────┐                       │   Product    │
 └──────┬───────┘      │                       └──────┬───────┘
        │ 1:N          │ 1:N                          │ 1:1
        ▼              ▼                              ▼
 ┌──────────────┐ ┌──────────────┐             ┌──────────────┐
 │    Order     │ │IdempotencyKey│             │  Inventory   │
 └──────┬───────┘ └──────────────┘             └──────┬───────┘
        │ 1:N                                         │ 1:N
        ├──────────────────────┬──────────────────────┤
        ▼                      ▼                      ▼
 ┌──────────────┐       ┌──────────────┐       ┌─────────────────┐
 │  OrderItem   │       │StockReservat.│       │InventoryMovement│
 └──────────────┘       └──────────────┘       └─────────────────┘
        │ 1:N
        ▼
 ┌──────────────────┐
 │OrderStatusHistory│
 └──────────────────┘
```

### Specialized Indexing Strategy

1. **Trigram GIN Indexes (`pg_trgm`):**
   - Applied to `products(name)`, `products(sku)`, and `orders(orderNumber)`.
   - Enables fast `ILIKE '%term%'` substring searches backed by index scans instead of sequential table scans.
2. **Composite B-Tree Indexes for Access Paths:**
   - `orders(customerId, createdAt, id)`: Serves customer order history with pagination and deterministic sorting.
   - `orders(status, createdAt, id)`: Serves administrative order status filtering with total tiebreaker ordering.
   - `orders(createdAt, id)`: Serves global administrative order lists and date-range reporting aggregations.
   - `products(categoryId, createdAt, id)`: Serves category browsing with default "newest first" ordering.
   - `stock_reservations(orderId, status)`: Accelerates order cancellation sweeps looking for `status = 'ACTIVE'`.
   - `inventory_movements(productId, createdAt)`: Supports product movement audit trail queries.
   - `order_status_history(orderId, changedAt)`: Serves chronological order status history with zero runtime sort nodes.
3. **Unique Constraints:**
   - `idempotency_keys(customerId, key)`: Guarantees customer-scoped idempotency key uniqueness.
   - `refresh_tokens(tokenHash)`: Guarantees one active session record per token.
   - `processed_jobs(eventId, eventType)`: Prevents duplicate background worker execution.

---

## Concurrency & Overselling Prevention

### The Overselling Problem

In high-concurrency environments, naive stock checks fail due to race conditions:

1. Request A and Request B both read Product X stock: quantity = 10, reserved = 8, which means available = 2.
2. Both requests want 2 units (2 <= 2).
3. Without locking, both approve checkout and update reserved = 8 + 2 = 10.
4. The combined reservation becomes 12 against a physical quantity of 10. The stock is oversold.

### Solution: Row-Level Locking (`SELECT ... FOR UPDATE`)

Our implementation serializes access per inventory row inside an atomic PostgreSQL transaction:

```text
Client Request
      │
      ▼
BEGIN TRANSACTION
      │
      ▼
Lock Order Row (during cancellation or status update)
      │
      ▼
Sort Product IDs Alphabetically: [P-001, P-002, P-003]
      │
      ▼
SELECT * FROM inventories WHERE productId IN ($1, $2, $3)
ORDER BY productId FOR UPDATE
      │  (Concurrent requests for overlapping products wait here)
      ▼
Evaluate Stock Availability:
  availableQuantity = quantity - reservedQuantity
  IF requestedQuantity > availableQuantity:
      ROLLBACK TRANSACTION (Throw 409 INSUFFICIENT_STOCK)
      │
      ▼ (All items available)
Increment reservedQuantity by requested amounts
      │
      ▼
INSERT INTO stock_reservations (...)
INSERT INTO inventory_movements (type: 'RESERVATION', ...)
INSERT INTO orders (...)
INSERT INTO order_items (...)
INSERT INTO order_status_history (toStatus: 'PENDING', ...)
INSERT INTO idempotency_keys (...)
      │
      ▼
COMMIT TRANSACTION (Row locks released; next queued transaction sees updated stock)
```

### Deterministic Lock Ordering & Deadlock Reduction

When orders contain multiple items, concurrent transactions locking items in random order cause cyclic deadlocks:

- **Tx 1:** Holds lock on Product A -> requests lock on Product B.
- **Tx 2:** Holds lock on Product B -> requests lock on Product A.
- Both transactions block permanently until PostgreSQL detects the deadlock and aborts one.

**Mitigation:** `mergeAndSortOrderItems()` consolidates duplicate line items and sorts all `productId` values in ascending lexicographical order prior to acquiring any locks. Because every transaction acquires row locks in the exact same sequence (A -> B -> C), cyclic wait-for dependencies are prevented at the application level, significantly reducing deadlock risk.

---

## Idempotency & Safe Request Retries

Order creation is protected by customer-scoped idempotency:

```text
Request: POST /api/v1/orders
Header: Idempotency-Key: <unique-client-key>
Body: { "items": [...] }
```

### Processing Flow

1. **Header Validation:** The key must be a non-empty string (max 255 chars).
2. **Canonical Payload Hashing:** Computes a SHA-256 hash of the authenticated customer ID and normalized, sorted items.
3. **Fast-Path Check:** Queries existing idempotency records for `(customerId, key)`:
   - **Same Key + Same Hash:** Returns the cached original response (`201 Created`). No duplicate order or stock reservation is created.
   - **Same Key + Different Hash:** Throws `409 IDEMPOTENCY_KEY_REUSED` to prevent accidental key collisions with differing payloads.
4. **Transactional Insertion:** If the key is fresh, it is inserted into `idempotency_keys` inside the order transaction.
5. **Concurrent Duplicate Requests:** If two identical requests hit the server concurrently, PostgreSQL's `@@unique([customerId, key])` constraint blocks the second transaction. Upon the first transaction committing, the second encounters error `P2002`, catches it, polls for the committed record, and returns the stored `201` response.
6. **No Poisoned Keys:** If order placement fails due to business validation (e.g. `INSUFFICIENT_STOCK`), the transaction issues an immediate `ROLLBACK`, discarding the uncommitted idempotency key. The client can retry with the same key once inventory is replenished.

---

## Caching & Stampede Mitigation

Read-heavy endpoints implement a Redis cache-aside pattern to reduce PostgreSQL query load:

```text
Client GET Request
       │
       ▼
Check Redis Cache
 ├── Cache HIT  ──► Deserialize JSON & Return Response (PostgreSQL bypassed)
 └── Cache MISS
       │
       ▼
Try Acquire Mutex Lock (SET lock:key token EX 5 NX)
 ├── Lock ACQUIRED:
 │     1. Query PostgreSQL
 │     2. Write to Redis with TTL (default: 300s)
 │     3. Release Lock via Lua script (safe compare-and-delete)
 │     4. Return Data
 └── Lock NOT Acquired:
       Fallback: Fetch directly from PostgreSQL without blocking
```

### Invalidation Strategy

Mutating operations explicitly invalidate affected cache keys via Redis `SCAN` matching:

- Category creation, update, or deletion invalidates `categories:*`.
- Product creation, update, or deletion invalidates `products:*`.
- Stock adjustments invalidate `products:*` and inventory views.

### Redis Resilience

If the Redis connection drops or fails, all cache and lock operations catch the exception, log a warning, and fall back to PostgreSQL transparently. The API remains fully functional during Redis outages.

---

## Background Processing & Queue Architecture

Non-critical side effects are processed asynchronously using BullMQ and Redis:

```text
API Server                                            Worker Process
┌──────────────────────────────┐                      ┌──────────────────────────────┐
│ Order Transaction Commits    │                      │ BullMQ Worker                │
│             │                │                      │ (concurrency: 5)             │
│             ▼                │                      │              │               │
│ Enqueue Event to BullMQ      │                      │              ▼               │
│ (Queue: 'order-events')      │───► Redis Queue ────►│ Check ProcessedJob Table     │
│  - ORDER_CREATED             │                      │ (eventId, eventType unique)  │
│  - ORDER_CANCELLED           │                      │  - If duplicate: skip        │
│  - ORDER_CONFIRMED           │                      │  - If new: insert & process  │
│  - ORDER_SHIPPED             │                      │              │               │
└──────────────────────────────┘                      │              ▼               │
                                                      │ Send Notification / Email    │
                                                      └──────────────────────────────┘
```

### Worker Configuration

- **Queue Name:** `order-events` (configurable via `QUEUE_PREFIX`).
- **Concurrency:** 5 concurrent jobs per worker instance (`WORKER_CONCURRENCY`).
- **Retry Strategy:** 3 attempts with exponential backoff (initial delay: 1,000ms -> 2,000ms -> 4,000ms).
- **Job Retention:** Retains 100 completed jobs and 500 failed jobs for administrative inspection.
- **Worker-Side Idempotency:** The worker records `(eventId, eventType)` in the `processed_jobs` table under a unique constraint. If a job is delivered more than once (at-least-once delivery), subsequent attempts are skipped without duplicate side effects.
- **Graceful Shutdown:** On `SIGTERM` / `SIGINT`, the worker finishes active jobs, closes BullMQ connections, disconnects Prisma, and exits cleanly.

---

## Authentication & Authorization

### Token Architecture

- **Access Token:** Stateless JWT, signed with `JWT_ACCESS_SECRET`, 15-minute lifetime (`JWT_ACCESS_EXPIRES_IN=15m`). Contains `userId` and `role`.
- **Refresh Token:** Cryptographically random string, signed with `JWT_REFRESH_SECRET`, 7-day lifetime (`JWT_REFRESH_EXPIRES_IN=7d`). Stored in PostgreSQL as a SHA-256 hash (`refresh_tokens.tokenHash`).

### Refresh Token Rotation & Revocation

1. When a client requests `POST /api/v1/auth/refresh`, the server verifies the JWT and validates the hash in `refresh_tokens`.
2. The current refresh token is revoked (`revokedAt = new Date()`).
3. A new access token and refresh token pair is issued and persisted.
4. If an already-revoked refresh token is presented, the server rejects it with `401 REVOKED_REFRESH_TOKEN`, mitigating token theft replay.
5. `POST /api/v1/auth/logout` explicitly revokes the presented refresh token.

### Role-Based Access Control (RBAC) & IDOR Protection

- **Roles:** `CUSTOMER` and `ADMIN`.
- **Customer Identity Derivation:** When creating an order (`POST /api/v1/orders`), any client-supplied `customerId` in the body is discarded. The customer is derived strictly from `req.user.id`.
- **Insecure Direct Object Reference (IDOR) Safeguards:** Customers can only inspect or cancel their own orders (`order.customerId === customer.id`). Attempting to access another customer's order returns `403 ORDER_ACCESS_DENIED`. Administrators can inspect and cancel any order.

---

## Order Lifecycle & Status Management

Orders transition through a deterministic lifecycle enforced by a centralized domain transition matrix (`canTransitionOrderStatus`):

```text
       PENDING
       ├───► CONFIRMED
       └───► CANCELLED (Terminal)
               ▲
               │
       CONFIRMED
       ├───► PROCESSING
       └───► CANCELLED (Terminal)

       PROCESSING
       └───► SHIPPED

       SHIPPED
       └───► DELIVERED (Terminal)

       DELIVERED
       └───► [None] (Terminal)

       CANCELLED
       └───► [None] (Terminal)
```

### Transition Rules

- **Allowed Cancellations:** Orders can be cancelled **only** from `PENDING` or `CONFIRMED` status.
- **Forbidden Cancellations:** Attempting to cancel orders in `PROCESSING`, `SHIPPED`, or `DELIVERED` status is rejected with `422 ORDER_CANCELLATION_NOT_ALLOWED`.
- **Terminal States:** `CANCELLED` and `DELIVERED` cannot transition to any other status.
- **Status Auditing:** Every status change inserts an immutable record into `order_status_history` recording `fromStatus`, `toStatus`, `changedBy`, `reason`, and timestamp.

---

## API Documentation (Swagger / OpenAPI)

Interactive API documentation is generated via `swagger-jsdoc` and rendered through Swagger UI.

### Local URL

```text
http://localhost:5000/api/docs
```

Swagger UI provides:
- Complete endpoint listings organized by tags (`Auth`, `Categories`, `Products`, `Inventory`, `Orders`, `Reports`).
- Interactive "Try it out" test consoles for every endpoint.
- Request payload schemas, parameter descriptions, and type constraints.
- Response structures and error definitions (`ErrorResponse`).
- Bearer JWT authentication header configuration.

---

## API Endpoints

### Authentication (`/api/v1/auth`)

| Method | Path | Auth | Roles | Description | Status |
|---|---|---|---|---|---|
| `POST` | `/api/v1/auth/register` | None | Public | Register new customer account | `201 Created` |
| `POST` | `/api/v1/auth/login` | None | Public | Login with email & password | `200 OK` |
| `POST` | `/api/v1/auth/refresh` | None | Public | Refresh access token using refresh token | `200 OK` |
| `POST` | `/api/v1/auth/logout` | Bearer | All | Revoke active refresh token | `200 OK` |
| `GET` | `/api/v1/auth/me` | Bearer | All | Get profile of authenticated user | `200 OK` |

### Categories (`/api/v1/categories`)

| Method | Path | Auth | Roles | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/categories` | None | Public | List categories with search, sorting, pagination | `200 OK` |
| `GET` | `/api/v1/categories/:id` | None | Public | Get single category by UUID | `200 OK` |
| `POST` | `/api/v1/categories` | Bearer | `ADMIN` | Create a new category | `201 Created` |
| `PATCH` | `/api/v1/categories/:id` | Bearer | `ADMIN` | Update category details | `200 OK` |
| `DELETE` | `/api/v1/categories/:id` | Bearer | `ADMIN` | Delete category (rejected if products exist) | `200 OK` |

### Products (`/api/v1/products`)

| Method | Path | Auth | Roles | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/products` | None | Public | Search & filter products (trigram GIN indexed) | `200 OK` |
| `GET` | `/api/v1/products/:id` | None | Public | Get product details by UUID | `200 OK` |
| `POST` | `/api/v1/products` | Bearer | `ADMIN` | Create product with linked inventory | `201 Created` |
| `PATCH` | `/api/v1/products/:id` | Bearer | `ADMIN` | Update product details | `200 OK` |
| `DELETE` | `/api/v1/products/:id` | Bearer | `ADMIN` | Soft-delete product if order history exists | `200 OK` |

### Inventory (`/api/v1/inventory`)

| Method | Path | Auth | Roles | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/inventory/:productId` | Bearer | `ADMIN` | Get physical, reserved, and available stock | `200 OK` |
| `POST` | `/api/v1/inventory/:productId/adjust` | Bearer | `ADMIN` | Adjust stock (`STOCK_IN`, `STOCK_OUT`, `ADJUSTMENT`) | `200 OK` |
| `GET` | `/api/v1/inventory/:productId/movements` | Bearer | `ADMIN` | View paginated inventory movement audit trail | `200 OK` |

### Orders (`/api/v1/orders`)

| Method | Path | Auth | Roles | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/orders` | Bearer | All | List orders (customer: own; admin: all + filters) | `200 OK` |
| `POST` | `/api/v1/orders` | Bearer | All | Idempotent transactional order creation | `201 Created` / `200 OK` |
| `GET` | `/api/v1/orders/:orderId` | Bearer | All | Get order details with items and status | `200 OK` |
| `POST` | `/api/v1/orders/:orderId/cancel` | Bearer | All | Cancel eligible order & release reservations | `200 OK` |
| `PATCH` | `/api/v1/orders/:orderId/status` | Bearer | `ADMIN` | Update status via domain state machine | `200 OK` |
| `GET` | `/api/v1/orders/:orderId/history` | Bearer | All | View chronological order status audit trail | `200 OK` |

### Reports (`/api/v1/reports` — Admin Only)

| Method | Path | Auth | Roles | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/api/v1/reports/orders/status-summary` | Bearer | `ADMIN` | Order count breakdown by status | `200 OK` |
| `GET` | `/api/v1/reports/orders` | Bearer | `ADMIN` | Order count, total revenue, average order value | `200 OK` |
| `GET` | `/api/v1/reports/revenue` | Bearer | `ADMIN` | Revenue time series grouped by day or month | `200 OK` |
| `GET` | `/api/v1/reports/products` | Bearer | `ADMIN` | Top-selling products ranked by units sold & revenue | `200 OK` |

### Health & Readiness (`/health`)

| Method | Path | Auth | Roles | Description | Status |
|---|---|---|---|---|---|
| `GET` | `/health` | None | Public | Liveness probe (HTTP server alive) | `200 OK` |
| `GET` | `/health/ready` | None | Public | Readiness probe (probes PostgreSQL & Redis) | `200 OK` / `503 Service Unavailable` |

---

## Error Handling Standards

All API responses follow a consistent JSON format:

### Standard Error Response

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock for product Wireless Noise-Cancelling Headphones Pro"
  }
}
```

### Validation Error Response (`400 Bad Request`)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "items.0.quantity",
        "message": "Quantity must be greater than 0"
      }
    ]
  }
}
```

### Error Code Reference

| HTTP Status | Error Code | Description |
|---|---|---|
| `400 Bad Request` | `VALIDATION_ERROR` | Schema validation failed on body, query, or params. |
| `401 Unauthorized` | `UNAUTHENTICATED` | Missing or malformed Bearer authorization token. |
| `401 Unauthorized` | `INVALID_CREDENTIALS` | Invalid email address or password. |
| `401 Unauthorized` | `INVALID_ACCESS_TOKEN` | Token signature is invalid or expired. |
| `401 Unauthorized` | `ACCESS_TOKEN_EXPIRED` | Access token has passed its expiration time. |
| `401 Unauthorized` | `INVALID_REFRESH_TOKEN` | Refresh token is malformed, unrecognized, or forged. |
| `401 Unauthorized` | `REFRESH_TOKEN_EXPIRED` | Refresh token has passed its 7-day expiration time. |
| `401 Unauthorized` | `REVOKED_REFRESH_TOKEN` | Presented refresh token was previously revoked. |
| `403 Forbidden` | `FORBIDDEN` | Authenticated role lacks permission for the endpoint. |
| `403 Forbidden` | `ORDER_ACCESS_DENIED` | Customer attempting to access or cancel another customer's order. |
| `404 Not Found` | `RESOURCE_NOT_FOUND` | Unmatched route or endpoint. |
| `404 Not Found` | `USER_NOT_FOUND` | User account does not exist. |
| `404 Not Found` | `CUSTOMER_NOT_FOUND` | Customer profile does not exist for the authenticated user. |
| `404 Not Found` | `PRODUCT_NOT_FOUND` | Product ID does not exist in catalog. |
| `404 Not Found` | `CATEGORY_NOT_FOUND` | Category ID does not exist. |
| `404 Not Found` | `INVENTORY_NOT_FOUND` | Inventory record missing for product. |
| `404 Not Found` | `ORDER_NOT_FOUND` | Order ID does not exist. |
| `404 Not Found` | `STOCK_RESERVATION_NOT_FOUND` | No active stock reservation found for cancellation. |
| `409 Conflict` | `EMAIL_ALREADY_EXISTS` | Email address is already registered. |
| `409 Conflict` | `DUPLICATE_CATEGORY` | Category name or slug already in use. |
| `409 Conflict` | `DUPLICATE_PRODUCT` | Product slug already in use. |
| `409 Conflict` | `DUPLICATE_SKU` | Product SKU already in use. |
| `409 Conflict` | `CATEGORY_HAS_PRODUCTS` | Cannot delete category with assigned products. |
| `409 Conflict` | `IDEMPOTENCY_KEY_REUSED` | Idempotency key reused with a different request payload. |
| `409 Conflict` | `INSUFFICIENT_STOCK` | Requested quantity exceeds available stock (quantity - reservedQuantity). |
| `409 Conflict` | `INVENTORY_BELOW_RESERVED_STOCK` | Manual adjustment cannot drop physical stock below active reservations. |
| `409 Conflict` | `ORDER_ALREADY_CANCELLED` | Order has already been cancelled. |
| `422 Unprocessable` | `ORDER_CANCELLATION_NOT_ALLOWED` | Order is in non-cancellable state (`PROCESSING`, `SHIPPED`, `DELIVERED`). |
| `422 Unprocessable` | `ORDER_STATUS_TRANSITION_NOT_ALLOWED` | Requested transition violates the state machine matrix. |
| `429 Too Many Requests` | `TOO_MANY_REQUESTS` | Rate limit threshold exceeded. |
| `500 Internal Error` | `INTERNAL_SERVER_ERROR` | Uncaught exception. Stack traces are suppressed in production. |

---

## Testing & Verification

The project includes an automated test suite executed via Jest and Supertest against a live PostgreSQL test database:

```bash
# Run unit and API tests
npm test

# Run integration test suites
npm run test:integration

# Run all test suites
npm run test:all

# Run concurrency test suites sequentially
npm run test:concurrency

# Run test coverage analysis
npm run test:coverage
```

### Test Suite Structure

The test suite contains **184 automated tests across 12 test suites**:

1. `tests/auth.test.ts` (28 tests): User registration, credential verification, access token validation, refresh token rotation, revocation, RBAC role enforcement, and IDOR protection.
2. `tests/cache.test.ts` (25 tests): Redis cache-aside hits and misses, SCAN pattern invalidation on mutations, double-checked stampede protection, and transparent fallback during Redis outages.
3. `tests/category.test.ts` (14 tests): Category creation, slug uniqueness, pagination, search, updates, and deletion constraint checks.
4. `tests/health.test.ts` (5 tests): Liveness `/health`, readiness `/health/ready` probing PostgreSQL and Redis, and structured 404 handler responses.
5. `tests/idempotency.test.ts` (15 tests): Idempotent replays (`201`), hash mismatch conflict detection (`409`), concurrent duplicate deduplication via database unique constraints, and transaction rollback recovery without poisoned keys.
6. `tests/inventory.test.ts` (16 tests): Stock level retrieval, `STOCK_IN` and `STOCK_OUT` calculations, negative stock rejection, and movement audit ledgers.
7. `tests/order.test.ts` (14 tests): Transactional order creation, inventory reservation, row-level locking verification, and overselling prevention.
8. `tests/order-lifecycle.test.ts` (22 tests): Centralized state machine transitions, cancellation permission rules, reservation release, and concurrent cancel vs confirm race safety.
9. `tests/phase11-query.test.ts` (15 tests): Trigram GIN full-text search, date-range and amount filtering, composite index queries, and financial report aggregations.
10. `tests/product.test.ts` (18 tests): Product catalog CRUD, price boundary filtering, inventory linkage, and soft-delete safeguards.
11. `tests/security.test.ts` (10 tests): Helmet security headers, SQL injection resistance, malformed body rejection, and UUID validation.
12. `tests/unit/business-logic.test.ts` (2 tests): Unit testing for pure calculation functions and state transition rules.

### Code Quality Commands

```bash
# Type check TypeScript without emitting files
npx tsc --noEmit

# Run ESLint analysis
npm run lint

# Check formatting with Prettier
npm run format:check

# Compile production JavaScript build
npm run build
```

---

## Local Development Setup

### Prerequisites

- **Node.js:** v22.x or later
- **PostgreSQL:** v16.x or later
- **Redis:** v7.x or later
- **npm:** v10.x or later

### Setup Steps

1. **Clone the repository and install dependencies:**

   ```bash
   git clone <repository-url>
   cd high-performance-order-api
   npm install
   ```

2. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

   Update `DATABASE_URL` and `REDIS_URL` in `.env` to point to your local PostgreSQL and Redis instances.

3. **Run database migrations:**

   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

4. **Seed the database with sample data:**

   ```bash
   npm run db:seed
   ```

5. **Start the API server (development mode with hot-reloading):**

   ```bash
   npm run dev
   ```

   The API server starts on `http://localhost:5000`.

6. **Start the BullMQ background worker (in a separate terminal):**

   ```bash
   npm run worker
   ```

7. **Access the API documentation:**

   Open `http://localhost:5000/api/docs` in your browser.

---

## Docker & Production Runtime

The project includes production containerization orchestrated via Docker Compose.

### Quick Start (Docker Compose)

```bash
# Build production images and start all 4 services
docker compose up --build

# Run in detached mode
docker compose up -d --build

# Stop containers (named data volumes are preserved)
docker compose down

# Stop and wipe database and cache volumes
docker compose down -v
```

### Services Overview

| Service | Container Image | Port (Host:Container) | Healthcheck | Purpose |
|---|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `5432:5432` | `pg_isready -U postgres -d order_api` | Relational database with persistent volume |
| `redis` | `redis:7-alpine` | `6379:6379` | `redis-cli ping` | In-memory cache & BullMQ broker with RDB persistence |
| `api` | `high-performance-order-api:latest` | `5000:5000` | `wget -qO- http://localhost:5000/health` | Express API server (runs migrations on startup) |
| `worker` | `high-performance-order-api:latest` | None (background) | Depends on healthy API & Redis | BullMQ background notification worker |

### Dockerfile Highlights

- **Multi-Stage Build:**
  - `deps`: Installs full dependencies (`npm ci`) needed for build tools.
  - `build`: Runs `npx prisma generate` and `npm run build` (`tsc`).
  - `production`: Installs only production dependencies (`npm ci --omit=dev`), copies compiled `dist/`, and uses `node:22-alpine`.
- **Security:** Runs as a non-root `nodejs` user (UID 1001). Excludes `.env`, tests, and development tooling.
- **Process Management:** Uses `dumb-init` as PID 1 to ensure proper signal forwarding (`SIGTERM`/`SIGINT`) and prevent zombie process leaks.

### Graceful Shutdown Sequence

Both the API and worker implement graceful termination:

**API Server:**
1. Stops accepting new incoming HTTP connections (`server.close()`).
2. Awaits completion of in-flight requests.
3. Closes BullMQ queue producer connections.
4. Closes Redis connections.
5. Disconnects Prisma PostgreSQL client.
6. Exits with code 0 (15-second timeout safety net).

**Worker Process:**
1. Pauses BullMQ worker to prevent claiming new jobs.
2. Awaits completion of currently running jobs (`worker.close()`).
3. Closes queue connections.
4. Disconnects Prisma client.
5. Exits with code 0.

---

## Environment Variables

| Variable | Required | Default (Dev) | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | Application runtime environment (`development`, `test`, `production`) |
| `PORT` | Yes | `5000` | HTTP port on which Express listens |
| `DATABASE_URL` | Yes | `postgresql://...` | PostgreSQL connection string (use `postgres` service name in Docker) |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection URL (use `redis` service name in Docker) |
| `CACHE_TTL_SECONDS` | No | `300` | Default cache-aside Time-To-Live in seconds |
| `QUEUE_PREFIX` | No | `high-performance-order-api` | Prefix for BullMQ Redis queue keys |
| `WORKER_CONCURRENCY` | No | `5` | Maximum parallel jobs processed by the worker |
| `JWT_SECRET` | Yes | `change-me` | Legacy secret key fallback |
| `JWT_ACCESS_SECRET` | Yes | `change-me-access` | Cryptographic secret for signing access tokens (min 32 chars) |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Lifetime of access tokens (`15m`, `1h`, etc.) |
| `JWT_REFRESH_SECRET` | Yes | `change-me-refresh` | Cryptographic secret for signing refresh tokens (min 32 chars) |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Lifetime of refresh tokens (`7d`, `30d`, etc.) |
| `STOCK_RESERVATION_MINUTES` | No | `30` | Duration before an unfulfilled stock reservation expires |
| `IDEMPOTENCY_KEY_TTL_HOURS` | No | `24` | Retention period for idempotency records in hours |
| `TIMEZONE` | No | `UTC` | IANA timezone for report date-range boundary calculations |
| `PRISMA_LOG_QUERIES` | No | `false` | Enable verbose Prisma SQL query logging (disabled in production) |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Global rate limit window duration in milliseconds (1 minute) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Maximum requests allowed per IP within global window |
| `AUTH_RATE_LIMIT_WINDOW_MS` | No | `60000` | Auth endpoints rate limit window in milliseconds |
| `AUTH_RATE_LIMIT_MAX_REQUESTS` | No | `10` | Maximum auth requests allowed per IP per minute |
| `ORDER_RATE_LIMIT_WINDOW_MS` | No | `60000` | Order creation rate limit window in milliseconds |
| `ORDER_RATE_LIMIT_MAX_REQUESTS` | No | `20` | Maximum order creation requests allowed per customer IP per minute |
| `CORS_ORIGINS` | No | `http://localhost:3000` | Comma-separated list of allowed CORS origins |
| `BODY_LIMIT` | No | `1mb` | Maximum allowed request body payload size |

---

## Database Migrations & Seeding

### Migration Strategy

- **Development:** Use `npx prisma migrate dev` to create and apply incremental migration files while developing schema changes.
- **Production / CI / Docker:** Use `npx prisma migrate deploy` (or `npm run db:migrate`). This applies all pending migrations in an idempotent manner and **never prompts to reset** the database.

### Seeding Scripts

The database seed (`prisma/seed.ts`) populates realistic demonstration records:

- **1 Administrator User:** `admin@orderapi.com` / `AdminPassword123!` (`role: ADMIN`)
- **1 Customer User & Profile:** `john.doe@example.com` / `CustomerPassword123!` (`role: CUSTOMER`, Name: John Doe)
- **2 Categories:** `Electronics`, `Home & Kitchen`
- **4 Products with Initial Stock & Movements:**
  - `Wireless Noise-Cancelling Headphones Pro` (Stock: 120, Price: $199.99)
  - `Ergonomic Mechanical Keyboard (Brown Switch)` (Stock: 10, Price: $129.50)
  - `Digital Smart Air Fryer XL (6.5L)` (Stock: 60, Price: $149.99)
  - `Compact Espresso Machine 15-Bar` (Stock: 25, Price: $289.00)
- **2 Demonstration Orders:**
  - `ORD-SEED-001`: Status `CONFIRMED`
  - `ORD-SEED-002`: Status `SHIPPED`

Run seed script:

```bash
npm run db:seed
```

For performance benchmarks, a separate generator creates 1,000+ products, 10,000+ orders, and 50,000+ items:

```bash
npm run db:seed:perf
```

---

## Production Considerations & Architectural Trade-offs

1. **Post-Commit Queue Enqueue vs Transactional Outbox:**
   - Order domain events are enqueued to BullMQ immediately after `prisma.$transaction` commits.
   - *Trade-off:* In the rare event that the application process crashes in the few milliseconds between the database commit and the Redis queue write, the order exists in PostgreSQL but the notification event is not enqueued.
   - *Rationale:* For this system, post-commit enqueueing avoids the operational complexity of an Outbox polling process or Change Data Capture (CDC) engine while guaranteeing that uncommitted or rolled-back orders never generate phantom events.
2. **Pessimistic Row Locking vs Optimistic Locking:**
   - The system utilizes pessimistic row locks (`SELECT ... FOR UPDATE`) over optimistic version checking.
   - *Trade-off:* High contention on a single product serializes transactions and increases queue latency.
   - *Rationale:* Under flash-sale scenarios where stock drops from 1 to 0, optimistic locking causes widespread transaction retries and rollback thrashing. Pessimistic locking ensures every transaction that obtains the lock makes definitive, reliable progress.
3. **Redis Fallback Degradation:**
   - In the event of a Redis outage, cache operations fall back to PostgreSQL and rate limiting degrades to in-memory tracking.
   - *Trade-off:* Database query load increases during cache outages.
   - *Rationale:* Preserves business continuity and checkout availability over strict cache dependency.
4. **Offset-Based Pagination:**
   - Standard queries utilize `LIMIT` and `OFFSET` with total count calculations.
   - *Trade-off:* High offsets (e.g. page 5,000) scan and discard rows in PostgreSQL.
   - *Rationale:* Offset pagination satisfies standard administrative UI requirements and sorting flexibility. For extreme dataset depths, cursor-based pagination is recommended.

---

## Submission Notes

This project represents a completed backend engineering assessment implementation:

- [x] Strict concurrency control with zero overselling verified under automated tests.
- [x] Safe request retries with customer-scoped database idempotency.
- [x] Complete ACID transaction wrapping order creation, inventory reservations, movements, and status history.
- [x] Robust cancellation workflow with atomic stock reservation release.
- [x] Distributed cache-aside caching with stampede protection and pattern invalidation.
- [x] Decoupled BullMQ event processing with worker idempotency.
- [x] JWT authentication with refresh token rotation and IDOR protection.
- [x] Trigram GIN and composite B-tree indexing for query optimization.
- [x] Complete OpenAPI 3.0 specification served via Swagger UI.
- [x] Multi-stage Docker containerization with non-root security and healthchecks.
