# high-performance-order-api

A production-grade, high-performance Order Processing & Inventory Management REST API built with Node.js, Express, TypeScript, PostgreSQL, Prisma ORM, and modern backend architectural patterns.

---

## Tech Stack

- **Runtime & Language:** Node.js (v22+), TypeScript (Strict Mode)
- **Web Framework:** Express.js
- **Database & ORM:** PostgreSQL 18, Prisma ORM 7 (`@prisma/adapter-pg`)
- **In-Memory Store & Cache:** Redis *(configured for future phases)*
- **Job & Queue Management:** BullMQ *(configured for future phases)*
- **Validation:** Zod
- **Structured Logging:** Pino, Pino-HTTP, Pino-Pretty
- **Testing:** Jest, Supertest, ts-jest
- **Code Quality:** ESLint (Flat Config), Prettier
- **Containerization:** Docker, Docker Compose *(prepared for future phases)*

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
│   │   └── orders/              # Order creation, reservation & concurrency module
│   │       ├── order.controller.ts
│   │       ├── order.repository.ts
│   │       ├── order.route.ts
│   │       ├── order.service.ts
│   │       ├── order.types.ts
│   │       └── order.validation.ts
│   ├── jobs/                    # BullMQ job workers and consumers (for future phases)
│   ├── queues/                  # BullMQ queue producers and definitions (for future phases)
│   ├── events/                  # Domain events and pub/sub handlers (for future phases)
│   ├── app.ts                   # Express application setup
│   └── server.ts                # Server startup and graceful termination
├── tests/                       # Automated test suites (Jest + Supertest)
│   ├── category.test.ts         # Category API integration tests
│   ├── health.test.ts           # Health & 404 integration tests
│   ├── inventory.test.ts        # Inventory & Concurrency integration tests
│   ├── order.test.ts            # Order Creation & Concurrency integration tests
│   └── product.test.ts          # Product API integration tests
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

| Method | Endpoint | Description | Status Code |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/categories` | Create a new category | `201 Created` |
| `GET` | `/api/v1/categories` | List categories with search & pagination | `200 OK` |
| `GET` | `/api/v1/categories/:id` | Get category details by ID | `200 OK` |
| `PATCH` | `/api/v1/categories/:id` | Partially update category details | `200 OK` |
| `DELETE` | `/api/v1/categories/:id` | Delete category (rejected if products are assigned) | `200 OK` |

---

## Product API

Base path: `/api/v1/products`

| Method | Endpoint | Description | Status Code |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/products` | Create a product with linked inventory record | `201 Created` |
| `GET` | `/api/v1/products` | List products with filtering, search, sorting & pagination | `200 OK` |
| `GET` | `/api/v1/products/:id` | Get product details with category | `200 OK` |
| `PATCH` | `/api/v1/products/:id` | Partially update product details | `200 OK` |
| `DELETE` | `/api/v1/products/:id` | Safe product deletion (soft delete if historical references exist) | `200 OK` |

---

## Inventory Management API

Base path: `/api/v1/inventory`

| Method | Endpoint | Description | Status Code |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/inventory/:productId` | Retrieve stock levels & computed available quantity | `200 OK` |
| `POST` | `/api/v1/inventory/:productId/adjust` | Perform transaction-safe stock adjustment with row locking | `200 OK` |
| `GET` | `/api/v1/inventory/:productId/movements` | Query paginated movement audit ledger with type & date filters | `200 OK` |

### Stock Levels & Available Quantity Calculation

The inventory module maintains physical reality in the database:

$$\text{availableQuantity} = \text{quantity} - \text{reservedQuantity}$$

* `quantity`: Physical stock currently located in the warehouse.
* `reservedQuantity`: Stock earmarked for pending checkout sessions (cannot be consumed or sold).
* `availableQuantity`: Dynamically computed on read. It is not stored as a separate column to avoid state desynchronization and race conditions.

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
   * Increases physical stock: $\text{newQuantity} = \text{currentQuantity} + \text{quantity}$.
   * Creates an `InventoryMovement` of type `STOCK_IN`.
2. **`STOCK_OUT`:**
   * Decreases physical stock: $\text{newQuantity} = \text{currentQuantity} - \text{quantity}$.
   * **Invariable Rule:** Manual stock-out cannot consume reserved stock ($\text{quantity} \le \text{availableQuantity}$). If $\text{quantity} > \text{availableQuantity}$, the operation is rejected with `409 INSUFFICIENT_STOCK`.
   * Physical quantity can never drop below zero.
3. **`ADJUSTMENT` (Cycle Count / Physical Audit):**
   * Sets the new absolute physical quantity on hand to the provided `quantity`.
   * **Invariable Rule:** $\text{newQuantity} \ge \text{reservedQuantity}$. If an adjustment attempts to reduce total physical stock below the currently active reservations, the transaction fails with `409 INVENTORY_BELOW_RESERVED_STOCK`.
   * Creates an `InventoryMovement` of type `ADJUSTMENT` recording the delta.

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
* `productId`: Reference to product catalog.
* `type`: Movement classification (`STOCK_IN`, `STOCK_OUT`, `RESERVATION`, `RELEASE`, `ADJUSTMENT`).
* `quantity`: Delta of units affected.
* `referenceType`: Context tag (e.g. `MANUAL_ADJUSTMENT`, `INITIAL_STOCK`, `ORDER`).
* `referenceId`: Optional reason or external reference.
* `createdAt`: Microsecond-precision timestamp.

---

## Order API & Concurrency Control

Base path: `/api/v1/orders`

| Method | Endpoint | Description | Status Code |
| :--- | :--- | :--- | :--- |
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
* **Transaction 1:** Locks Product A $\to$ attempts to lock Product B.
* **Transaction 2:** Locks Product B $\to$ attempts to lock Product A.
* Both transactions block waiting for the other to release its lock, forming a cyclic dependency. PostgreSQL terminates one transaction with a `40P01 (deadlock_detected)` error.

By sorting all `productId`s alphabetically (ascending) before acquiring any row locks, all transactions acquire locks in the identical order ($A \to B \to C$). The wait-for graph is strictly directed and acyclic ($DAG$), mathematically eliminating deadlocks.

#### 4. Why Reservation Instead of Reducing Physical Quantity?
Physical quantity ($\text{quantity}$) reflects actual items stored in the warehouse bin. When an order is placed, goods are not yet picked or shipped; they are merely held while checkout completes. 
* Decreasing physical stock immediately leads to discrepancies during warehouse cycle counts and physical audits.
* By isolating $\text{reservedQuantity}$, available stock is dynamically derived ($\text{availableQuantity} = \text{quantity} - \text{reservedQuantity}$).
* If an order expires, cancels, or fails payment, the reservation is released ($\text{reservedQuantity} -= \text{held}$) without touching physical warehouse ledger counts. When the order is eventually packed and fulfilled, physical quantity is decremented alongside reservation consumption.

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

| HTTP Status | Error Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Schema validation failed (e.g. quantity $\le 0$, invalid UUID). |
| `400 Bad Request` | `INVALID_CATEGORY` | `categoryId` provided on product creation does not exist. |
| `400 Bad Request` | `INVALID_ORDER` | Malformed order data. |
| `404 Not Found` | `PRODUCT_NOT_FOUND` | Product ID does not exist in database. |
| `404 Not Found` | `CUSTOMER_NOT_FOUND`| Customer ID does not exist in database. |
| `404 Not Found` | `CATEGORY_NOT_FOUND` | Category ID does not exist. |
| `404 Not Found` | `INVENTORY_NOT_FOUND` | Product exists but has no inventory record. |
| `409 Conflict` | `INSUFFICIENT_STOCK` | Requested quantity exceeds available stock ($\text{quantity} - \text{reservedQuantity}$). |
| `409 Conflict` | `INVENTORY_BELOW_RESERVED_STOCK` | Target adjustment is lower than current `reservedQuantity`. |
| `409 Conflict` | `DUPLICATE_CATEGORY` | Category name or slug already in use. |
| `409 Conflict` | `DUPLICATE_PRODUCT` | Product slug already in use. |
| `409 Conflict` | `DUPLICATE_SKU` | Product SKU already in use. |
| `409 Conflict` | `CATEGORY_HAS_PRODUCTS` | Attempted deletion of category with assigned products. |
| `500 Internal Error`| `ORDER_CREATION_FAILED` | Internal error while processing order creation. |
| `500 Internal Error`| `INTERNAL_SERVER_ERROR`| Uncaught system exception. |

---

## Local Development & Testing

### Run Tests

```bash
npm test
```

* **58 automated integration tests** across Health, Category, Product, Inventory, and Order suites.
* Includes real concurrent race condition verification under PostgreSQL row-level locking.

* Includes real concurrent race condition verification under PostgreSQL row-level locking.

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
