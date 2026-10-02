# high-performance-order-api

A high-performance Order Processing & Inventory Management REST API built with Node.js, Express, TypeScript, PostgreSQL, Prisma ORM, and modern backend architectural patterns.

---

## Tech Stack

- **Runtime & Language:** Node.js (v22+), TypeScript (Strict Mode)
- **Web Framework:** Express.js
- **Database & ORM:** PostgreSQL 18, Prisma ORM 7 (`@prisma/adapter-pg`)
- **In-Memory Cache:** Redis 7, ioredis 6 (cache-aside pattern, stampede protection)
- **Job & Queue Management:** BullMQ _(configured for future phases)_
- **Validation:** Zod
- **Structured Logging:** Pino, Pino-HTTP, Pino-Pretty
- **Testing:** Jest, Supertest, ts-jest, ioredis-mock
- **Code Quality:** ESLint (Flat Config), Prettier
- **Containerization:** Docker, Docker Compose (Redis service included)

---

## Architecture & Layering

The project adheres to a strict separation of concerns across all modules:

```text
Route             → HTTP method and path mapping + Zod request validation
  ↓
Controller        → Request unwrapping, parameter extraction, response serialization (No business rules)
  ↓
Service           → Domain rules, business constraints, coordination across repositories
  ↓
Repository        → Direct Prisma queries, database projections, atomic transactions
  ↓
Prisma ORM       → Type-safe query engine via @prisma/adapter-pg
  ↓
PostgreSQL        → Relational persistence with B-Tree indexes and referential integrity
```

### Folder Structure

```text
high-performance-order-api/
├── prisma/
│   ├── migrations/              # Prisma migration history
│   │   └── 20261001174629_init/ # Baseline database schema migration
│   ├── schema.prisma            # Prisma schema models, enums, indexes, and relations
│   └── seed.ts                  # Database seeding script with realistic demo data
├── src/
│   ├── config/
│   │   ├── env.ts               # Environment configuration with Zod runtime validation
│   │   └── prisma.ts            # Singleton PrismaClient instance with PostgreSQL adapter
│   ├── common/
│   │   ├── errors/              # Centralized application errors and ErrorCode enum
│   │   │   └── app.error.ts
│   │   ├── middleware/          # Global Express middleware
│   │   │   ├── error.middleware.ts
│   │   │   ├── not-found.middleware.ts
│   │   │   ├── request-logger.middleware.ts
│   │   │   └── validate.middleware.ts # Zod request validation middleware
│   │   ├── logger/              # Pino structured logger configuration
│   │   │   └── logger.ts
│   │   └── types/               # Shared pagination and API response interfaces
│   │       └── pagination.ts
│   ├── modules/                 # Modular domain features
│   │   ├── health/              # Health check module
│   │   │   ├── health.controller.ts
│   │   │   └── health.route.ts
│   │   ├── auth/                # Authentication & Authorization module
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.middleware.ts
│   │   │   ├── auth.repository.ts
│   │   │   ├── auth.route.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.types.ts
│   │   │   ├── auth.utils.ts
│   │   │   └── auth.validation.ts
│   │   ├── categories/          # Category management module
│   │   │   ├── category.controller.ts
│   │   │   ├── category.repository.ts
│   │   │   ├── category.route.ts
│   │   │   ├── category.service.ts
│   │   │   └── category.validation.ts
│   │   ├── products/            # Product catalog & inventory module
│   │   │   ├── product.controller.ts
│   │   │   ├── product.repository.ts
│   │   │   ├── product.route.ts
│   │   │   ├── product.service.ts
│   │   │   └── product.validation.ts
│   │   ├── inventory/           # Inventory & stock tracking module
│   │   │   ├── inventory.controller.ts
│   │   │   ├── inventory.repository.ts
│   │   │   ├── inventory.route.ts
│   │   │   ├── inventory.service.ts
│   │   │   └── inventory.validation.ts
│   │   ├── orders/              # Order creation, reservation & concurrency module
│   │   │   ├── order.controller.ts
│   │   │   ├── order.repository.ts
│   │   │   ├── order.route.ts
│   │   │   ├── order.service.ts
│   │   │   ├── order.types.ts
│   │   │   └── order.validation.ts
│   │   └── idempotency/         # Header validation, hashing & idempotency repository
│   │       ├── idempotency.repository.ts
│   │       ├── idempotency.service.ts
│   │       ├── idempotency.types.ts
│   │       └── idempotency.utils.ts
│   ├── types/                   # TypeScript ambient declarations (Express.Request augmentation)
│   │   └── express.d.ts
│   ├── jobs/                    # BullMQ job workers and consumers (for future phases)
│   ├── queues/                  # BullMQ queue producers and definitions (for future phases)
│   ├── events/                  # Domain events and pub/sub handlers (for future phases)
│   ├── app.ts                   # Express application setup
│   └── server.ts                # Server startup and graceful termination
├── tests/                       # Automated test suites (Jest + Supertest)
│   ├── auth.test.ts             # Authentication, RBAC & IDOR tests
│   ├── category.test.ts         # Category API integration tests
│   ├── health.test.ts           # Health & 404 integration tests
│   ├── idempotency.test.ts      # Idempotency & Replay integration tests
│   ├── inventory.test.ts        # Inventory & Concurrency integration tests
│   ├── order.test.ts            # Order Creation & Concurrency integration tests
│   ├── product.test.ts          # Product API integration tests
│   └── helpers/                 # Test auth and setup helpers
│       └── auth.helper.ts
├── .env                         # Local environment configuration
├── .env.example                 # Template for required environment variables
├── .gitignore                   # Ignored files and directories for Git
├── eslint.config.js             # Modern ESLint Flat Configuration
├── prettier.config.js           # Prettier code formatting rules
├── package.json                 # Project dependencies and npm scripts
├── prisma.config.ts             # Prisma 7 CLI and datasource configuration
├── tsconfig.json                # TypeScript compiler configuration (strict mode)
└── README.md                    # Project documentation
```

---

## Category API

Base path: `/api/v1/categories`

| Method   | Endpoint                 | Description                                         | Status Code   |
| :------- | :----------------------- | :-------------------------------------------------- | :------------ |
| `POST`   | `/api/v1/categories`     | Create a new category                               | `201 Created` |
| `GET`    | `/api/v1/categories`     | List categories with search & pagination            | `200 OK`      |
| `GET`    | `/api/v1/categories/:id` | Get category details by ID                          | `200 OK`      |
| `PATCH`  | `/api/v1/categories/:id` | Partially update category details                   | `200 OK`      |
| `DELETE` | `/api/v1/categories/:id` | Delete category (rejected if products are assigned) | `200 OK`      |

---

## Product API

Base path: `/api/v1/products`

| Method   | Endpoint               | Description                                                        | Status Code   |
| :------- | :--------------------- | :----------------------------------------------------------------- | :------------ |
| `POST`   | `/api/v1/products`     | Create a product with linked inventory record                      | `201 Created` |
| `GET`    | `/api/v1/products`     | List products with filtering, search, sorting & pagination         | `200 OK`      |
| `GET`    | `/api/v1/products/:id` | Get product details with category                                  | `200 OK`      |
| `PATCH`  | `/api/v1/products/:id` | Partially update product details                                   | `200 OK`      |
| `DELETE` | `/api/v1/products/:id` | Safe product deletion (soft delete if historical references exist) | `200 OK`      |

---

## Inventory Management API

Base path: `/api/v1/inventory`

| Method | Endpoint                                 | Description                                                    | Status Code |
| :----- | :--------------------------------------- | :------------------------------------------------------------- | :---------- |
| `GET`  | `/api/v1/inventory/:productId`           | Retrieve stock levels & computed available quantity            | `200 OK`    |
| `POST` | `/api/v1/inventory/:productId/adjust`    | Perform transaction-safe stock adjustment with row locking     | `200 OK`    |
| `GET`  | `/api/v1/inventory/:productId/movements` | Query paginated movement audit ledger with type & date filters | `200 OK`    |

### Stock Levels & Available Quantity Calculation

The inventory module maintains physical reality in the database:

$$\text{availableQuantity} = \text{quantity} - \text{reservedQuantity}$$

- `quantity`: Physical stock currently located in the warehouse.
- `reservedQuantity`: Stock earmarked for pending checkout sessions (cannot be consumed or sold).
- `availableQuantity`: Dynamically computed on read. It is not stored as a separate column to avoid state desynchronization and race conditions.

**Get Inventory Response:**

```json
{
  "success": true,
  "data": {
    "productId": "ee13d707-3121-4870-adaf-8171443ac14b",
    "quantity": 100,
    "reservedQuantity": 20,
    "availableQuantity": 80
  }
}
```

### Stock Adjustment Types

Manual stock adjustments are performed via `POST /api/v1/inventory/:productId/adjust`:

```json
{
  "quantity": 25,
  "type": "STOCK_IN",
  "reason": "Supplier shipment batch #401"
}
```

1. **`STOCK_IN`:**
   - Increases physical stock: $\text{newQuantity} = \text{currentQuantity} + \text{quantity}$.
   - Creates an `InventoryMovement` of type `STOCK_IN`.
2. **`STOCK_OUT`:**
   - Decreases physical stock: $\text{newQuantity} = \text{currentQuantity} - \text{quantity}$.
   - **Invariable Rule:** Manual stock-out cannot consume reserved stock ($\text{quantity} \le \text{availableQuantity}$). If $\text{quantity} > \text{availableQuantity}$, the operation is rejected with `409 INSUFFICIENT_STOCK`.
   - Physical quantity can never drop below zero.
3. **`ADJUSTMENT` (Cycle Count / Physical Audit):**
   - Sets the new absolute physical quantity on hand to the provided `quantity`.
   - **Invariable Rule:** $\text{newQuantity} \ge \text{reservedQuantity}$. If an adjustment attempts to reduce total physical stock below the currently active reservations, the transaction fails with `409 INVENTORY_BELOW_RESERVED_STOCK`.
   - Creates an `InventoryMovement` of type `ADJUSTMENT` recording the delta.

---

### Concurrency & Row-Level Locking (`SELECT ... FOR UPDATE`)

To prevent race conditions, lost updates, and overselling during high-concurrency order bursts, stock modifications execute inside an atomic database transaction using PostgreSQL row-level locks:

```text
Incoming Request
      ↓
BEGIN TRANSACTION
      ↓
SELECT * FROM "inventories" WHERE "productId" = $1 FOR UPDATE
      ↓  (Concurrent transactions for the same product BLOCK and WAIT here)
Read latest committed state
      ↓
Validate stock availability (quantity >= 0, quantity - reserved >= requested)
      ↓
UPDATE "inventories" SET quantity = $newQuantity, version = version + 1
      ↓
INSERT INTO "inventory_movements" (...)
      ↓
COMMIT (Row lock released; next waiting transaction acquires lock and sees fresh state)
```

#### Why `FOR UPDATE` is Essential:

Without row locking, two simultaneous requests reading stock at $10$ could both approve a stock-out of $7$, resulting in $-4$ (negative stock) or a lost update where one write overwrites the other. With `FOR UPDATE`, PostgreSQL forces serial execution per product, guaranteeing that only the first request succeeds ($10 \to 3$), and the second request immediately encounters $\text{available} = 3 < 7$ and fails cleanly with `409 INSUFFICIENT_STOCK`.

---

### Immutable Audit Trail (`InventoryMovement`)

Every stock modification creates an immutable ledger entry recording:

- `productId`: Reference to product catalog.
- `type`: Movement classification (`STOCK_IN`, `STOCK_OUT`, `RESERVATION`, `RELEASE`, `ADJUSTMENT`).
- `quantity`: Delta of units affected.
- `referenceType`: Context tag (e.g. `MANUAL_ADJUSTMENT`, `INITIAL_STOCK`, `ORDER`).
- `referenceId`: Optional reason or external reference.
- `createdAt`: Microsecond-precision timestamp.

---

## Order API & Concurrency Control

Base path: `/api/v1/orders`

| Method | Endpoint         | Description                                                | Status Code   |
| :----- | :--------------- | :--------------------------------------------------------- | :------------ |
| `POST` | `/api/v1/orders` | Create order, lock rows, reserve stock & log audit history | `201 Created` |

### Request Format

```json
{
  "customerId": "8f3e2b1a-9876-4321-bcde-1234567890ab",
  "items": [
    {
      "productId": "ee13d707-3121-4870-adaf-8171443ac14b",
      "quantity": 2
    },
    {
      "productId": "9cbedf09-5dc5-41f6-8564-3c342d1f9a28",
      "quantity": 1
    }
  ]
}
```

### Response Format (`201 Created`)

```json
{
  "success": true,
  "data": {
    "id": "e45bf90a-1234-4567-89ab-cdef01234567",
    "orderNumber": "ORD-20261002-7F3A9D1B",
    "status": "PENDING",
    "totalAmount": "259.98",
    "items": [
      {
        "productId": "ee13d707-3121-4870-adaf-8171443ac14b",
        "quantity": 2,
        "unitPrice": "100.00",
        "totalPrice": "200.00"
      },
      {
        "productId": "9cbedf09-5dc5-41f6-8564-3c342d1f9a28",
        "quantity": 1,
        "unitPrice": "59.98",
        "totalPrice": "59.98"
      }
    ]
  }
}
```

---

### Order Creation Flow

```text
Request (customerId, items)
   ↓
Validate Payload (Zod schema: UUID format, non-empty array, quantity > 0)
   ↓
Normalize Items (Merge duplicate product IDs by summing quantities)
   ↓
Sort Product IDs Ascending (Global Lock Ordering / Deadlock Prevention)
   ↓
BEGIN TRANSACTION
   │
   ├── Step 1: Validate customer exists (404 CUSTOMER_NOT_FOUND)
   │
   ├── Step 2: Validate products exist and are active (404 PRODUCT_NOT_FOUND)
   │
   ├── Step 3: Lock inventory rows deterministically (SELECT ... FOR UPDATE)
   │
   ├── Step 4: Check available stock (available = quantity - reservedQuantity)
   │           └── If requested > available: Abort & Rollback (409 INSUFFICIENT_STOCK)
   │
   ├── Step 5: Compute historical prices & order totals (Arbitrary-precision Decimals)
   │
   ├── Step 6: Create Order (status: PENDING, unique orderNumber)
   │
   ├── Step 7: Create OrderItems (freezing unitPrice at order creation time)
   │
   ├── Step 8: Update Inventory (reservedQuantity += requestedQuantity)
   │
   ├── Step 9: Create StockReservations (status: ACTIVE, expiresAt configured)
   │
   ├── Step 10: Create InventoryMovements (type: RESERVATION, referenceType: ORDER)
   │
   ├── Step 11: Create OrderStatusHistory (fromStatus: null, toStatus: PENDING)
   │
   └── COMMIT TRANSACTION
```

---

### Architecture & Concurrency Design Deep-Dive

#### 1. Why `FOR UPDATE`?

Without pessimistic row locking, simultaneous requests experience classic **lost updates** and **read-skew anomalies**:

1. Client A and Client B both read Product X stock with $\text{available} = 5$.
2. Client A requests 4 units; Client B requests 4 units.
3. Both pass the application availability check ($4 \le 5$).
4. Both commit, pushing $\text{reservedQuantity} = 8$ against physical stock of $5$ (causing negative available stock $-3$ and overselling).

Executing `SELECT ... FOR UPDATE` acquires an exclusive row-level lock on the `inventories` record. Competing transactions requesting the same row are forced to queue at the database level until the holding transaction commits or rolls back. When a queued transaction is granted the lock, it immediately reads the freshly committed stock values, reliably evaluating stock reality.

#### 2. Why ONE Transaction?

Order placement touches six related tables: `orders`, `order_items`, `inventories`, `stock_reservations`, `inventory_movements`, and `order_status_history`. Wrapping these operations in a single atomic PostgreSQL transaction ensures **Atomicity and Consistency (ACID)**. If any precondition fails (e.g. one item out of five lacks stock, or a database constraint fails), the entire transaction rolls back. No partial orders, unreserved items, orphan ledger entries, or phantom inventory locks are left behind.

#### 3. Why Deterministic Lock Ordering?

When multi-item orders lock rows dynamically in user-supplied request order, **deadlocks** are inevitable under concurrent load:

- **Transaction 1:** Locks Product A $\to$ attempts to lock Product B.
- **Transaction 2:** Locks Product B $\to$ attempts to lock Product A.
- Both transactions block waiting for the other to release its lock, forming a cyclic dependency. PostgreSQL terminates one transaction with a `40P01 (deadlock_detected)` error.

By sorting all `productId`s alphabetically (ascending) before acquiring any row locks, all transactions acquire locks in the identical order ($A \to B \to C$). The wait-for graph is strictly directed and acyclic ($DAG$), mathematically eliminating deadlocks.

#### 4. Why Reservation Instead of Reducing Physical Quantity?

Physical quantity ($\text{quantity}$) reflects actual items stored in the warehouse bin. When an order is placed, goods are not yet picked or shipped; they are merely held while checkout completes.

- Decreasing physical stock immediately leads to discrepancies during warehouse cycle counts and physical audits.
- By isolating $\text{reservedQuantity}$, available stock is dynamically derived ($\text{availableQuantity} = \text{quantity} - \text{reservedQuantity}$).
- If an order expires, cancels, or fails payment, the reservation is released ($\text{reservedQuantity} -= \text{held}$) without touching physical warehouse ledger counts. When the order is eventually packed and fulfilled, physical quantity is decremented alongside reservation consumption.

#### 5. How Does the System Prevent Overselling?

Overselling prevention is guaranteed by the combination of:

1. **Pessimistic serialization:** `SELECT ... FOR UPDATE` serializes access per inventory row.
2. **Fresh evaluated state:** Stock availability ($\text{quantity} - \text{reservedQuantity} \ge \text{requested}$) is verified after the lock is acquired.
3. **Database check constraints:** Enforced non-negative boundaries in PostgreSQL ensure `reservedQuantity` can never exceed `quantity`.
4. **All-or-nothing rollback:** If any item fails, zero inventory is claimed.

#### 6. What Happens When One Product Has Insufficient Stock?

In a multi-product order (e.g., ordering 2 units of Product A and 1000 units of Product B):

1. Product A is locked and validated (available).
2. Product B is locked; availability check detects insufficient stock.
3. An `InsufficientStockError (409)` is thrown.
4. Prisma aborts the transaction and issues an immediate `ROLLBACK` to PostgreSQL.
5. All acquired row locks on Product A and Product B are released.
6. Neither Product A nor Product B has its `reservedQuantity` incremented; no order records, items, reservations, or audit movements are committed.

---

## Idempotency & Safe Request Retries

The order creation endpoint is protected by database-enforced idempotency to prevent duplicate orders caused by client retries, network timeouts, or double clicks.

### Why Idempotency?

In distributed network systems, network connections can drop after the server has processed an order but before the client receives the response. Without idempotency, client retries or automatic network resends would create duplicate orders and multiple stock reservations.

### How It Works

```text
Client Request (with Idempotency-Key header)
  ↓
Validate Header (non-empty string, max 255 chars)
  ↓
Compute Canonical Request Hash (SHA-256 of customerId and normalized items)
  ↓
Check Existing Key (customerId + key)
  ├── Existing + Same Hash: Return cached original response (201 Created)
  ├── Existing + Different Hash: Reject with 409 IDEMPOTENCY_KEY_REUSED
  └── New / Expired:
       ↓
  Begin PostgreSQL Transaction
       ↓
  Validate Customer
       ↓
  Claim Idempotency Key (INSERT into idempotency_keys)
       ↓
  Lock Inventory (SELECT ... FOR UPDATE)
       ↓
  Validate Stock Availability
       ↓
  Create Order & OrderItems
       ↓
  Create StockReservations & Movements
       ↓
  Store Response in Idempotency Record (responseStatus, responseBody)
       ↓
  COMMIT
       ↓
  Return Order Response
```

### Same Key + Same Request (Replay)

When the client retries with the same `Idempotency-Key` and an identical or semantically equivalent payload (e.g. rearranged items or unmerged duplicates that resolve to the same canonical structure), the server returns the cached response with the original HTTP status (`201 Created`). No duplicate orders or additional stock reservations are created.

### Same Key + Different Request (409 Conflict)

If a client attempts to reuse an existing `Idempotency-Key` with a different payload (e.g. altered quantity or different product IDs), the request is rejected with `409 Conflict` and code `IDEMPOTENCY_KEY_REUSED`. This prevents accidental collisions and misuse.

### Concurrent Duplicate Requests (Unique Constraint Synchronization)

When multiple concurrent requests arrive with the exact same `(customerId, key)` at the exact same millisecond:

1. Both attempt to insert into `idempotency_keys` inside their respective transactions.
2. PostgreSQL's unique constraint (`@@unique([customerId, key])`) serializes the transactions: the first transaction claims the row; subsequent transactions pause and block on the unique index lock.
3. When the first transaction commits with the completed response, the waiting transactions unblock and encounter a unique constraint violation (`P2002`).
4. The waiting transactions catch the conflict, query the committed response, verify the request hash, and return the exact same `201 Created` response.
5. Exactly one order is created in the database.

### Failed Transactions (No Poisoned Keys)

If an order fails (e.g. `INSUFFICIENT_STOCK` or validation failure):

1. The transaction issues an immediate `ROLLBACK`.
2. The tentative `IdempotencyKey` record is rolled back alongside the rest of the transaction.
3. The key is not poisoned. The client is free to retry with the same key once the underlying issue is resolved.

### Key Expiration (TTL)

- Idempotency keys have a configurable Time-To-Live (`IDEMPOTENCY_KEY_TTL_HOURS`, default: `24` hours).
- Expired keys encountered during request evaluation are automatically removed and treated as fresh keys.

---

## Authentication & Authorization

Phase 7 implements production-grade stateless JWT authentication, database-persisted refresh token rotation with reuse detection, Role-Based Access Control (RBAC), and Customer Ownership Protection (IDOR prevention).

### Core Token Architecture

1. **Access Token:**
   - Short-lived (15 minutes by default: `JWT_ACCESS_EXPIRES_IN=15m`).
   - Compact, stateless JWT payload:
     ```json
     {
       "sub": "user-id",
       "role": "CUSTOMER",
       "type": "access"
     }
     ```
   - Passed via the standard HTTP header: `Authorization: Bearer <access-token>`.
   - Verified by `authenticate` middleware without database lookups for high-throughput performance.

2. **Refresh Token:**
   - Long-lived (7 days by default: `JWT_REFRESH_EXPIRES_IN=7d`).
   - Cryptographically random unique token ID (`tokenId` UUID v4):
     ```json
     {
       "sub": "user-id",
       "tokenId": "550e8400-e29b-41d4-a716-446655440000",
       "type": "refresh"
     }
     ```
   - **Database Hashing:** Plaintext refresh tokens are **never stored** in the database. Only a deterministic SHA-256 hash (`crypto.createHash('sha256').update(token).digest('hex')`) is persisted in the `refresh_tokens` table. Even if the database is leaked, raw refresh tokens cannot be used to forge sessions.

3. **Refresh Token Rotation & Reuse Detection:**
   - Each invocation of `POST /api/v1/auth/refresh` immediately revokes the consumed refresh token and issues a newly generated token pair.
   - If an attacker or client attempts to replay a revoked refresh token, the server detects the reuse and immediately halts execution with `401 REVOKED_REFRESH_TOKEN`.

4. **Logout & Revocation:**
   - `POST /api/v1/auth/logout` takes `{ refreshToken }` and stamps `revokedAt = now()` on the corresponding record in PostgreSQL.

---

### Authentication Flow

```text
[ Client ]                     [ Express / Middleware ]                [ PostgreSQL ]
    |                                     |                                   |
    |--- POST /api/v1/auth/login -------->|                                   |
    |    { email, password }              |--- Verify bcrypt password ------->|
    |                                     |--- Store SHA-256 tokenHash ------>|
    |<-- { accessToken, refreshToken } ---|                                   |
    |                                     |                                   |
    |--- Request + Bearer <accessToken> ->| (Verified locally via JWT Secret) |
    |<-- 200 OK Response -----------------|                                   |
    |                                     |                                   |
    |--- Access Token Expires ------------|                                   |
    |--- POST /api/v1/auth/refresh ------>|                                   |
    |    { refreshToken }                 |--- Check not revoked & not exp -->|
    |                                     |--- Atomic Rotation (Revoke+New) ->|
    |<-- { newAccess, newRefresh } -------|                                   |
    |                                     |                                   |
    |--- POST /api/v1/auth/logout ------->|--- Mark revokedAt = now() ------->|
    |<-- 200 Logged out successfully -----|                                   |
```

---

### Authorization & RBAC Matrix

| Endpoint                                 | Method   | Required Role     | Description                                                      |
| :--------------------------------------- | :------- | :---------------- | :--------------------------------------------------------------- |
| `/health`                                | `GET`    | **Public**        | Liveness check                                                   |
| `/api/v1/auth/register`                  | `POST`   | **Public**        | Customer user & profile registration                             |
| `/api/v1/auth/login`                     | `POST`   | **Public**        | Issues Access + Refresh token pair                               |
| `/api/v1/auth/refresh`                   | `POST`   | **Public**        | Rotates refresh token and issues new tokens                      |
| `/api/v1/auth/logout`                    | `POST`   | **Authenticated** | Revokes current refresh session                                  |
| `/api/v1/auth/me`                        | `GET`    | **Authenticated** | Returns authenticated user & customer profile                    |
| `/api/v1/categories`                     | `GET`    | **Public**        | List & filter categories                                         |
| `/api/v1/categories/:id`                 | `GET`    | **Public**        | Get category by ID                                               |
| `/api/v1/categories`                     | `POST`   | **ADMIN**         | Create new category                                              |
| `/api/v1/categories/:id`                 | `PATCH`  | **ADMIN**         | Update category                                                  |
| `/api/v1/categories/:id`                 | `DELETE` | **ADMIN**         | Delete category                                                  |
| `/api/v1/products`                       | `GET`    | **Public**        | List, filter, search, sort products                              |
| `/api/v1/products/:id`                   | `GET`    | **Public**        | Get product by ID                                                |
| `/api/v1/products`                       | `POST`   | **ADMIN**         | Create product + initialize inventory                            |
| `/api/v1/products/:id`                   | `PATCH`  | **ADMIN**         | Update product                                                   |
| `/api/v1/products/:id`                   | `DELETE` | **ADMIN**         | Delete product                                                   |
| `/api/v1/inventory/:productId`           | `GET`    | **ADMIN**         | View physical and available stock                                |
| `/api/v1/inventory/:productId/adjust`    | `POST`   | **ADMIN**         | Stock in/out or manual count adjustment                          |
| `/api/v1/inventory/:productId/movements` | `GET`    | **ADMIN**         | Audit ledger of inventory movements                              |
| `/api/v1/orders`                         | `POST`   | **Authenticated** | Creates order with stock reservation                             |
| `/api/v1/orders/:orderId/cancel`         | `POST`   | **Authenticated** | Cancels order & releases reserved stock (Customer owns or Admin) |
| `/api/v1/orders/:orderId/status`         | `PATCH`  | **ADMIN**         | Updates order status with lifecycle validation                   |
| `/api/v1/orders/:orderId/history`        | `GET`    | **Authenticated** | Chronological audit trail (Customer owns or Admin)               |
| `/api/v1/orders/:id`                     | `GET`    | **Authenticated** | View order details (enforces customer ownership)                 |

---

### Customer Ownership Protection & IDOR Prevention

1. **Server-Side Customer Identity Derivation:**
   - Clients **never control `customerId`** during order creation (`POST /api/v1/orders`).
   - Even if a malicious client sends `customerId: "other-customer-uuid"`, the controller completely discards it and resolves the customer strictly via `req.user.id` from the verified JWT.
2. **Order Access Control (`GET /api/v1/orders/:id`):**
   - If accessed by a `CUSTOMER`, the service enforces `order.customerId === authenticatedCustomer.id`.
   - Access attempts across customer boundaries are denied with `403 ORDER_ACCESS_DENIED`.
   - Users with the `ADMIN` role can inspect any customer order.
3. **Customer-Scoped Idempotency:**
   - Idempotency is enforced by the unique constraint `(customerId, key)`. A key used by Customer A is isolated from Customer B, preventing cross-tenant replay or replay collision.

---

### Security Decisions & Best Practices

- **Argon2 / Bcrypt Hashing:** Passwords hashed using bcrypt (10 rounds). Passwords and password hashes are never returned in responses and never printed to log streams.
- **Constant-Time Comparison:** When non-existent emails attempt login, a dummy hash comparison is performed to defeat user enumeration timing attacks.
- **No Plaintext Refresh Tokens in Database:** Database breach resistance is guaranteed by storing only SHA-256 digests.
- **Separation of Token Secrets:** Access tokens and Refresh tokens use independent signing secrets (`JWT_ACCESS_SECRET` vs `JWT_REFRESH_SECRET`) and different lifetimes.
- **Type Enforcement:** Refresh tokens cannot be presented as access tokens (`type === 'access'` check) and vice-versa.

---

## Phase 8: Order Cancellation & Status Management

### 1. Centralized Order Lifecycle State Machine

The order status transitions are strictly governed by a centralized domain transition matrix (`canTransitionOrderStatus`):

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

#### Allowed & Forbidden Transitions

| Current Status | Target Status | Permitted? | Notes                                |
| :------------- | :------------ | :--------- | :----------------------------------- |
| `PENDING`      | `CONFIRMED`   | **Yes**    | Standard progression                 |
| `PENDING`      | `CANCELLED`   | **Yes**    | Stock reservation released           |
| `CONFIRMED`    | `PROCESSING`  | **Yes**    | Fulfillment begins                   |
| `CONFIRMED`    | `CANCELLED`   | **Yes**    | Stock reservation released           |
| `PROCESSING`   | `SHIPPED`     | **Yes**    | Carrier handover                     |
| `SHIPPED`      | `DELIVERED`   | **Yes**    | Final successful delivery            |
| `PROCESSING`   | `CANCELLED`   | **No**     | 422 `ORDER_CANCELLATION_NOT_ALLOWED` |
| `SHIPPED`      | `CANCELLED`   | **No**     | 422 `ORDER_CANCELLATION_NOT_ALLOWED` |
| `DELIVERED`    | `CANCELLED`   | **No**     | 422 `ORDER_CANCELLATION_NOT_ALLOWED` |
| `CANCELLED`    | _Any_         | **No**     | Terminal state; 409 or 422           |
| `DELIVERED`    | _Any_         | **No**     | Terminal state; 422                  |

---

### 2. Endpoints Specification

#### A. Cancel Order API

```http
POST /api/v1/orders/:orderId/cancel
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "reason": "Customer requested cancellation"
}
```

- **Authentication:** Required (Bearer Access Token).
- **Role Requirements:**
  - `CUSTOMER`: Can only cancel their own order (`order.customerId === customer.id` derived from JWT; verified against IDOR).
  - `ADMIN`: Can cancel any customer's eligible order.
- **Eligible Statuses:** `PENDING` or `CONFIRMED`.
- **Response (`200 OK`):**

```json
{
  "success": true,
  "data": {
    "id": "f762de15-bdc1-45e8-a8aa-2da107e05224",
    "orderNumber": "ORD-20261001-A1B2C3D4",
    "status": "CANCELLED",
    "totalAmount": "100.00",
    "items": [
      {
        "productId": "product-uuid",
        "quantity": 2,
        "unitPrice": "50.00",
        "totalPrice": "100.00"
      }
    ]
  }
}
```

- **Possible Errors:**
  - `401 UNAUTHENTICATED`: Missing or invalid token.
  - `403 ORDER_ACCESS_DENIED`: Customer attempting to cancel another customer's order.
  - `404 ORDER_NOT_FOUND`: Order ID does not exist.
  - `409 ORDER_ALREADY_CANCELLED`: Order was already cancelled (safe idempotency guard).
  - `422 ORDER_CANCELLATION_NOT_ALLOWED`: Order is in `PROCESSING`, `SHIPPED`, or `DELIVERED` status.

#### B. Update Order Status API

```http
PATCH /api/v1/orders/:orderId/status
Authorization: Bearer <adminAccessToken>
Content-Type: application/json

{
  "status": "CONFIRMED",
  "reason": "Payment verified"
}
```

- **Authentication:** Required (Bearer Access Token).
- **Role Requirements:** Strictly `ADMIN` only. Customer requests are rejected with `403 FORBIDDEN`.
- **Cancellation Delegation:** When `status` is `CANCELLED`, automatically delegates to the atomic cancellation and reservation release workflow.
- **Response (`200 OK`):** Updated `OrderResponseView` object.
- **Possible Errors:**
  - `400 VALIDATION_ERROR`: Invalid status enum value.
  - `401 UNAUTHENTICATED`: Missing or invalid token.
  - `403 FORBIDDEN`: Non-admin user attempting status modification.
  - `404 ORDER_NOT_FOUND`: Order ID does not exist.
  - `422 ORDER_STATUS_TRANSITION_NOT_ALLOWED`: Invalid lifecycle transition.

#### C. Order Status History API

```http
GET /api/v1/orders/:orderId/history
Authorization: Bearer <accessToken>
```

- **Authentication:** Required (Bearer Access Token).
- **Role Requirements:**
  - `CUSTOMER`: Can view only their own order history.
  - `ADMIN`: Can view any order's history.
- **Response (`200 OK`):**

```json
{
  "success": true,
  "data": [
    {
      "id": "history-uuid-1",
      "orderId": "order-uuid",
      "fromStatus": null,
      "toStatus": "PENDING",
      "changedBy": null,
      "reason": "Order created",
      "createdAt": "2026-10-01T21:00:00.000Z"
    },
    {
      "id": "history-uuid-2",
      "orderId": "order-uuid",
      "fromStatus": "PENDING",
      "toStatus": "CONFIRMED",
      "changedBy": "admin-uuid",
      "reason": "Payment verified",
      "createdAt": "2026-10-01T21:05:00.000Z"
    }
  ]
}
```

---

### 3. Transactional Stock Reservation Release & Concurrency Strategy

Cancellation executes inside **one atomic PostgreSQL transaction**:

```text
Request (POST /orders/:id/cancel)
   ↓
Authentication & Authorization Check
   ↓
BEGIN TRANSACTION
   │
   ├── Step 1: Lock Order Row (SELECT ... FROM orders WHERE id = $1 FOR UPDATE)
   │           └── Freshly evaluated status prevents race conditions
   │
   ├── Step 2: Validate Cancellability (PENDING or CONFIRMED only)
   │           ├── If CANCELLED: Abort & Rollback (409 ORDER_ALREADY_CANCELLED)
   │           └── If PROCESSING/SHIPPED/DELIVERED: Abort & Rollback (422 ORDER_CANCELLATION_NOT_ALLOWED)
   │
   ├── Step 3: Fetch ACTIVE StockReservations
   │
   ├── Step 4: Group Quantities by Product & Sort Alphabetically (Deadlock Prevention)
   │
   ├── Step 5: Lock Inventory Rows Deterministically (SELECT ... FROM inventories FOR UPDATE)
   │
   ├── Step 6: Decrement reservedQuantity (Physical quantity is strictly UNCHANGED!)
   │
   ├── Step 7: Create InventoryMovement (type: RELEASE, referenceType: ORDER, referenceId: orderId)
   │
   ├── Step 8: Update StockReservations (status: RELEASED, releasedAt: now())
   │
   ├── Step 9: Update Order (status: CANCELLED)
   │
   ├── Step 10: Create OrderStatusHistory (fromStatus, toStatus: CANCELLED, changedBy: userId)
   │
   └── COMMIT TRANSACTION
```

#### Key Architectural Highlights:

1. **Physical Quantity Preservation:** Physical warehouse inventory (`quantity`) was never decremented at order creation time; only `reservedQuantity` was claimed. Therefore, cancellation **only decrements `reservedQuantity`**.
2. **Deadlock-Free Row Locking:** Just as in Phase 5, all product IDs are sorted lexicographically (`localeCompare`) before acquiring inventory row locks.
3. **Double-Cancellation Prevention:** If two concurrent cancel requests arrive simultaneously, the first acquires the lock, transitions the order, and commits. The second request, unblocked from `FOR UPDATE`, reads the fresh status `CANCELLED` and rejects safely with `409 ORDER_ALREADY_CANCELLED` without double-releasing stock or duplicating ledger records.
4. **Cancel vs Confirm Race Protection:** Concurrent Cancel and Confirm requests are serialized by the row-level lock on the order table. If Cancel commits first, Confirm fails with `422 ORDER_STATUS_TRANSITION_NOT_ALLOWED`. If Confirm commits first, Cancel evaluates the new status `CONFIRMED` (which is cancellable) and cleanly releases stock. The database always concludes in a consistent state.

---

### 4. Database Index Architecture Review

The database indexes directly support high-throughput order processing and audit reporting:

| Model                | Index Field(s) | Primary Purpose / Performance Rationale                                           |
| :------------------- | :------------- | :-------------------------------------------------------------------------------- |
| `Order`              | `[customerId]` | Essential for B-Tree lookup of customer orders and IDOR ownership checks.         |
| `Order`              | `[status]`     | Speeds up filtering orders by lifecycle state across admin consoles.              |
| `Order`              | `[createdAt]`  | Supports high-performance chronological sorting on customer and admin dashboards. |
| `OrderStatusHistory` | `[orderId]`    | Eliminates sequential table scans when loading order audit trails (`/history`).   |
| `OrderStatusHistory` | `[changedAt]`  | Guarantees ordered history extraction without expensive in-memory sorts.          |
| `StockReservation`   | `[orderId]`    | Fast retrieval of reservations associated with an order during cancellation.      |
| `StockReservation`   | `[status]`     | Speeds up querying `ACTIVE` reservations for release and expiration cleanup.      |
| `StockReservation`   | `[expiresAt]`  | Optimized for background worker sweeper queries targeting expired reservations.   |
| `InventoryMovement`  | `[productId]`  | Instant retrieval of inventory movement ledger for a given product.               |
| `InventoryMovement`  | `[createdAt]`  | Fast time-window filtering (`from`/`to`) for stock movement reconciliation.       |

---

## Error Handling Standards

All errors return uniform JSON responses:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock for product Wireless Headphones"
  }
}
```

### Domain Error Codes Reference

| HTTP Status          | Error Code                            | Trigger Condition                                                                         |
| :------------------- | :------------------------------------ | :---------------------------------------------------------------------------------------- |
| `400 Bad Request`    | `VALIDATION_ERROR`                    | Schema validation failed (e.g. quantity $\le 0$, invalid UUID).                           |
| `400 Bad Request`    | `INVALID_ORDER_STATUS`                | Provided status value is not part of the `OrderStatus` enum.                              |
| `400 Bad Request`    | `IDEMPOTENCY_KEY_REQUIRED`            | Missing or empty `Idempotency-Key` header.                                                |
| `400 Bad Request`    | `INVALID_IDEMPOTENCY_KEY`             | `Idempotency-Key` exceeds 255 characters or is invalid type.                              |
| `400 Bad Request`    | `INVALID_CATEGORY`                    | `categoryId` provided on product creation does not exist.                                 |
| `400 Bad Request`    | `INVALID_ORDER`                       | Malformed order data.                                                                     |
| `401 Unauthorized`   | `UNAUTHENTICATED`                     | Missing or malformed `Authorization` header.                                              |
| `401 Unauthorized`   | `INVALID_CREDENTIALS`                 | Incorrect email or password during login.                                                 |
| `401 Unauthorized`   | `INVALID_ACCESS_TOKEN`                | Access token signature invalid or invalid token type.                                     |
| `401 Unauthorized`   | `ACCESS_TOKEN_EXPIRED`                | Access token expiration timestamp has elapsed.                                            |
| `401 Unauthorized`   | `INVALID_REFRESH_TOKEN`               | Refresh token invalid or malformed.                                                       |
| `401 Unauthorized`   | `REFRESH_TOKEN_EXPIRED`               | Refresh token expiration timestamp has elapsed.                                           |
| `401 Unauthorized`   | `REVOKED_REFRESH_TOKEN`               | Reused or revoked refresh token presented.                                                |
| `403 Forbidden`      | `FORBIDDEN`                           | Insufficient role permissions (e.g. `CUSTOMER` accessing `ADMIN` endpoint).               |
| `403 Forbidden`      | `ORDER_ACCESS_DENIED`                 | Customer attempting to access or cancel another customer's order (IDOR).                  |
| `404 Not Found`      | `USER_NOT_FOUND`                      | User account does not exist.                                                              |
| `404 Not Found`      | `PRODUCT_NOT_FOUND`                   | Product ID does not exist in database.                                                    |
| `404 Not Found`      | `CUSTOMER_NOT_FOUND`                  | Customer profile does not exist in database.                                              |
| `404 Not Found`      | `CATEGORY_NOT_FOUND`                  | Category ID does not exist.                                                               |
| `404 Not Found`      | `INVENTORY_NOT_FOUND`                 | Product exists but has no inventory record.                                               |
| `404 Not Found`      | `ORDER_NOT_FOUND`                     | Order ID does not exist.                                                                  |
| `404 Not Found`      | `STOCK_RESERVATION_NOT_FOUND`         | No active stock reservation found for the specified order.                                |
| `409 Conflict`       | `EMAIL_ALREADY_EXISTS`                | Email address is already registered.                                                      |
| `409 Conflict`       | `IDEMPOTENCY_KEY_REUSED`              | Idempotency key reused with a different request payload.                                  |
| `409 Conflict`       | `INSUFFICIENT_STOCK`                  | Requested quantity exceeds available stock ($\text{quantity} - \text{reservedQuantity}$). |
| `409 Conflict`       | `INVENTORY_BELOW_RESERVED_STOCK`      | Target adjustment is lower than current `reservedQuantity`.                               |
| `409 Conflict`       | `ORDER_ALREADY_CANCELLED`             | Order has already been cancelled; prevents redundant stock release.                       |
| `409 Conflict`       | `DUPLICATE_CATEGORY`                  | Category name or slug already in use.                                                     |
| `409 Conflict`       | `DUPLICATE_PRODUCT`                   | Product slug already in use.                                                              |
| `409 Conflict`       | `DUPLICATE_SKU`                       | Product SKU already in use.                                                               |
| `409 Conflict`       | `CATEGORY_HAS_PRODUCTS`               | Attempted deletion of category with assigned products.                                    |
| `422 Unprocessable`  | `ORDER_CANCELLATION_NOT_ALLOWED`      | Order is in non-cancellable state (`PROCESSING`, `SHIPPED`, `DELIVERED`).                 |
| `422 Unprocessable`  | `ORDER_STATUS_TRANSITION_NOT_ALLOWED` | Requested status transition violates the state machine matrix.                            |
| `500 Internal Error` | `ORDER_CREATION_FAILED`               | Internal error while processing order creation.                                           |
| `500 Internal Error` | `INTERNAL_SERVER_ERROR`               | Uncaught system exception.                                                                |

---

## Local Development & Testing

### Run Tests

```bash
npm test
```

- **116 automated integration and concurrency tests** across Health, Auth, Category, Product, Inventory, Order, Idempotency, and Order Lifecycle suites.
- Includes real concurrent race condition verification under PostgreSQL row-level locking, cancellation idempotency, cancel vs confirm race safety, token rotation tests, and IDOR customer ownership verification.

### Start Development Server

```bash
npm run dev
```

### Code Quality & Build Checks

```bash
npx tsc --noEmit
npm run lint
npm run format:check
npm run build
```

---

## Phase 9 — Redis Caching & Cache Invalidation

### Overview

Phase 9 introduces Redis caching via the **cache-aside pattern** to reduce redundant PostgreSQL queries on read-heavy, stable data.

**Cached resources:** Products and Categories only.
**Not cached:** Inventory, Orders, Auth tokens.

### Architecture

```text
Request
  ↓
Service
  ├─ withCache(key, fetcher)
  │    ├─ Redis HIT  → return parsed JSON
  │    └─ Redis MISS → acquire lock → fetch DB → store in Redis → return
  └─ On Redis failure → fallback to DB transparently
```

### Infrastructure

| File | Purpose |
|---|---|
| `src/infrastructure/redis/redis.client.ts` | Singleton ioredis client, lazy connect, graceful failure |
| `src/infrastructure/redis/redis.service.ts` | `get`, `set`, `del`, `delPattern` (SCAN-based), `acquireLock`, `releaseLock` |
| `src/infrastructure/redis/redis.constants.ts` | Cache namespace prefixes, lock config |
| `src/common/cache/cache-key.builder.ts` | Deterministic sorted-param key builders |
| `src/common/cache/cache.helper.ts` | `withCache()` — cache-aside with stampede protection |

### Cache Key Strategy

```text
cache:products:list:{sorted-query-params}     # Product list with all filter/sort/page params
cache:products:detail:{productId}             # Single product detail
cache:categories:list:{sorted-query-params}   # Category list
cache:categories:detail:{categoryId}          # Single category detail
cache:lock:{main-key}                         # Distributed lock key (5s TTL, NX)
```

### Stampede Protection

When a cache key is missing:

1. Attempt to acquire a distributed lock (`SET key token NX EX 5`).
2. If acquired → double-check cache (another process may have populated it) → fetch DB → populate cache → release lock.
3. If not acquired → fall through directly to DB (no waiting, avoids lock-wait pile-up).
4. Lock is always released in `finally` and auto-expires after 5 seconds.

### Cache Invalidation Strategy

Cache is invalidated **after** the DB write succeeds (never before):

| Operation | Invalidated Keys |
|---|---|
| `createProduct` | All product list keys (`cache:products:list:*`) |
| `updateProduct` | Product detail key + all product list keys |
| `deleteProduct` (hard or soft) | Product detail key + all product list keys |
| `createCategory` | All category list keys (`cache:categories:list:*`) |
| `updateCategory` | Category detail key + all category list keys |
| `deleteCategory` | Category detail key + all category list keys |

Pattern deletion uses Redis `SCAN` (cursor-based) instead of `KEYS` to avoid blocking the server.

### Graceful Redis Failure

All Redis operations are wrapped in try/catch. If Redis is unavailable:
- `get` returns `null` (triggers cache miss → DB fallback)
- `set`, `del`, `delPattern`, lock operations are silent no-ops
- No error is surfaced to the HTTP client

### Configuration

```env
REDIS_URL=redis://localhost:6379
CACHE_TTL_SECONDS=300
```

### Starting Redis (Development)

Use the included Docker Compose:

```bash
# Start Redis
docker compose up -d redis

# Verify
docker compose ps
```

### Testing

Cache tests use `ioredis-mock` — no live Redis required for CI:

```bash
npx jest --testPathPatterns="cache"
```

**Test coverage (25 tests):**

| Suite | Tests |
|---|---|
| `cache-key.builder` | Deterministic keys, empty param filtering |
| `redisService` | get/set/del/delPattern, lock acquire/release, null-client fallback |
| `withCache` | Cache miss → DB, cache hit, corruption recovery, Redis-null fallback, stampede (2nd wave) |
| `ProductService — caching` | Detail caching, update invalidation |
| `CategoryService — caching` | Detail caching, delete invalidation, create list invalidation |

## Phase 11: Query Optimization, Indexing & N+1 Elimination

### Database-side Querying (Non-negotiable)
- All list endpoints push filtering, pagination (LIMIT/OFFSET), sorting, and totals into PostgreSQL. The API never loads entire tables into Node.js to paginate or filter them.
- Order lists use explicit field projections, stable sort construction (uildStableOrderBy), and MAX_LIMIT=100 enforced by the shared pagination utilities. The secondary sort id DESC is always appended when the primary sort is not id to guarantee deterministic paging under ties.
- Decimal filters are exact (
umeric(12,2)) and date-only filters are timezone-aware: 	oDate is normalized to the end of the calendar day using a validated TIMEZONE (configured via env.TIMEZONE), with impossible calendar dates rejected by Zod.
- Admin-only customer-email search resolves matching customerIds via a single bounded lookup (indCustomerIdsMatchingEmail, capped at 500 ids and logged on truncation) instead of a Prisma relation join chain. This keeps the predicate indexable (customerId IN (...)) and avoids the 50k-row join the relation form emitted.
- Product/category listing uses explicit selects, substring search with ILIKE against indexed text columns, and decimal-safe range predicates.

### Index Review & Migration
- Orders: (customerId, createdAt, id) for customer-scoped lists, (status, createdAt, id) for status filters, (createdAt, id) for global lists, and trigram GIN on orderNumber (pg_trgm extension). These match the exact predicates/order-bys issued by the application.
- Inventory movements: (productId, createdAt) replaces separate single-column indexes and directly supports the WHERE productId = ? AND createdAt <= ? ORDER BY createdAt DESC LIMIT ? access pattern.
- Order status history: (orderId, changedAt).
- Reservations: (orderId, status) retained alongside existing product/expiry indexes.
- Products: (categoryId, createdAt, id), retained createdAt, trigram GIN on 
ame and sku. The isActive column was deliberately left unindexed (low selectivity).
- Users: trigram GIN on email.
- Migration: prisma/migrations/20261002000000_phase11_query_indexes/migration.sql creates pg_trgm, idempotently adds/removes indexes, and runs ANALYZE at the end. prisma migrate diff confirms no drift between schema and migration state.
- Database inspection is possible without psql using the raw pg client (scripts/explain-analyze.ts).

### N+1 Elimination (measured)
- Order list item counts: removed Prisma's relation _count (which materialised an aggregate over the entire order_items table per request). Introduced a page-scoped count: fetch the page's order ids (	ake <= MAX_LIMIT), then orderItem.groupBy by orderId for only those ids (countItemsForOrders + ttachItemCounts). This drops the derived table from every page and keeps the GROUP BY bounded to at most 100 groups. Measured: the legacy _count form ran ~101 ms on the 50k-order dataset; the page-scoped form runs ~1.3 ms for the default list (see scripts/explain-analyze.ts).
- Inventory writes: removed per-line round-trips during order creation/cancellation. Acquire all required inventory rows in one sorted SELECT ... FOR UPDATE (one query regardless of line count), compute and apply all eservedQuantity deltas in one set-based UPDATE ... FROM (VALUES ...), and insert reservations/movements in batched createMany calls. Reservation release is a single updateMany by id IN (...). Existing tests (141/141) continue to pass after this refactor.
- Email search: the relation-based filter produced a LEFT JOIN chain that prevented index use; the id-probe form executes the email match via trigram index and then probes orders.customerId IN (...). Measured: legacy relation filter ~171 ms; id-probe form ~9.1 ms on the same dataset.

### Reporting
- All reports are ADMIN-only and execute SQL-side aggregations only. GET /api/v1/reports/orders/status-summary returns every OrderStatus key (default 0) to guarantee a stable shape for clients. 
- GET /api/v1/reports/orders groups all statuses so cancelledOrders and cancelledRevenue are always populated; realized revenue and average order value are computed from non-cancelled rows only (business rule). 
- GET /api/v1/reports/revenue: with includeCancelled=false (default) 	otalRevenue/orderCount/verageOrderValue reflect realized revenue; includeCancelled=true flips them to gross value. Cancelled figures are always broken out separately. 
- GET /api/v1/reports/products uses a single raw SQL join/group with ORDER BY totalRevenue DESC, totalQuantitySold DESC, productId ASC and returns exact decimal strings for both revenue and quantity.

### Query Logging
- Development-only: PRISMA_LOG_QUERIES=true enables query events. The logger no longer attempts to reconstruct query durations from the event (the query event is post-execution) and never logs bound parameter values � only placeholder SQL and the parameter count. A lightweight repeated-statement detector warns on suspicious recurrence (N+1 heuristic). Production is forced to ['error'].

### Observed Performance (EXPLAIN ANALYZE, 50k orders)
Representative numbers from scripts/explain-analyze.ts against the perf dataset (cold/typical single request):
- orders:customer-list-default (page + total + scoped item counts): ~1.3�2.1 ms (4 statements). No sequential scan on the page path; uses composite indexes.
- orders:list-legacy-relation-count (documented before-fix): ~101 ms (single statement) due to aggregating order_items in full before LIMIT.
- orders:search-customer-email-substring (id probe): ~9.1 ms (3 statements). 
- orders:search-customer-email-legacy-relation-filter (documented before-fix): ~171 ms (2 statements) due to join chain preventing index use.
- eports:status-summary-group-by (full scan): ~15.9 ms (1 statement). The unfiltered GROUP BY over all statuses performs a sequential scan by design (and is reported in findings as intentional given the table size/predicate).
- eports:product-sales-join-group: ~79 ms (1 statement) for a bounded top-N over joined aggregates.

See docs/phase11-query-plans.md (or the raw output of 
pm run perf:explain) for full plan trees, buffers, row estimates and findings.

### Tooling
- scripts/explain-analyze.ts � runs 21 scenarios with EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON), validates estimates and sorts/IO, and prints a markdown-style summary. Statements mirror Prisma's actual emitted SQL (captured via query events). Includes both current implementations and legacy forms to make the measured improvement explicit.
- scripts/measure-queries.ts � counts repository-level statements per request path (via Prisma query events) and reports wall-clock averages/min/max across iterations. The tool drives the real repository/service code, not hand-written SQL, so it reflects the exact query count the application issues.
- 
pm run typecheck � runs 	sc --noEmit and 	sc -p tsconfig.scripts.json --noEmit.
- 
pm run db:seed:perf / 
pm run db:seed:reset � generates a large, deterministic performance dataset (additive by default; --reset clears orders/inventory history/products/categories/customers/users first).
- 
pm run perf:explain � executes the EXPLAIN scenarios against the current database.
- 
pm run perf:queries � executes the statement-count/latency measurements.

### Tests
- Added 	ests/phase11-query.test.ts (35 tests): order list behaviour (search, filters, date boundaries, decimal ranges, stable sorting, pagination envelope, ownership, MAX_LIMIT and whitelist enforcement), N+1 regression guards (page-scoped item counts called once regardless of page size, skipped on empty pages, email search uses bounded id lookup only when requested, customer search never traverses customer fields), product/category behaviour, and reporting semantics (role guards, status-summary shape, realized/gross revenue with cancelled breakdown, order summary breakdown, top-products bounds). Tests derive report expectations from the live database so they remain correct against the 50k-row dataset as well as a fresh seeded dataset.
- All existing unit and integration tests (176 total) still pass after the refactors.


## Phase 12: API Security Hardening, Rate Limiting & API Documentation

### Security Architecture
- **Authentication & Authorization:** JWT-based authentication with access/refresh token rotation. Admin-only endpoints enforced via role guards; customer endpoints enforce ownership (IDOR prevention).
- **Password Security:** Passwords hashed using bcrypt (10 rounds). Passwords never returned in responses or logged.
- **Token Security:** Access and refresh tokens use separate secrets and lifetimes. Refresh tokens stored as SHA-256 digests in database. Refresh tokens cannot be used as access tokens (type validation).
- **Timing Attack Resistance:** Dummy hash comparison performed for non-existent emails during login to prevent user enumeration.
- **Input Validation:** Comprehensive Zod validation on all request bodies, params, and query strings with detailed error messages.
- **SQL Injection Prevention:** Parameterized queries via Prisma ORM; no raw string concatenation in queries.

### Rate Limiting
- **Redis-backed with fallback:** Rate limiting uses Redis via rate-limit-redis. If Redis is unavailable, the system falls back to in-memory store (fail-open with warning logged once) to preserve API availability.
- **Configurable tiers:** Global (60000/100), Auth (60000/10 on auth endpoints), Orders (60000/20 on POST /api/v1/orders).
- **Identity-based keys:** Prefer authenticated identity (customerId > user.id), fallback to client IP. trust proxy enabled.
- **Rate limit exceeded:** Returns HTTP 429 with ErrorCode.RATE_LIMIT_EXCEEDED and standard rate-limit headers.
- **Test behavior:** Rate limiting can be skipped in tests via SKIP_RATE_LIMIT=true.

### Security Middleware
- **Helmet:** Security headers enabled.
- **CORS:** Configured via CORS_ORIGINS (comma-separated). * rejected by default; credentials supported.
- **Body size limits:** JSON/urlencoded payloads limited by BODY_LIMIT (default 1mb).
- **Request logging:** Pino request logging with sensitive data redaction.
- **Error hardening:** Production 500 errors return generic message 'An unexpected error occurred.' with full details logged server-side.

### API Documentation
- **Swagger/OpenAPI:** Interactive API documentation available at GET /api/docs.
- **Authentication:** Bearer JWT authentication documented via components.securitySchemes.bearerAuth.
- **Coverage:** Auth, Categories, Products, Inventory, Orders, and Reports endpoints documented with schemas, parameters, and examples (fake data only).
- **Usage:** Access /api/docs in browser; for authenticated endpoints, click Authorize and provide a valid JWT access token (Bearer <token>).

