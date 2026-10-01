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
│   │   └── inventory/           # Inventory & stock tracking module
│   │       ├── inventory.controller.ts
│   │       ├── inventory.repository.ts
│   │       ├── inventory.route.ts
│   │       ├── inventory.service.ts
│   │       └── inventory.validation.ts
│   ├── jobs/                    # BullMQ job workers and consumers (for future phases)
│   ├── queues/                  # BullMQ queue producers and definitions (for future phases)
│   ├── events/                  # Domain events and pub/sub handlers (for future phases)
│   ├── app.ts                   # Express application setup
│   └── server.ts                # Server startup and graceful termination
├── tests/                       # Automated test suites (Jest + Supertest)
│   ├── category.test.ts         # Category API integration tests
│   ├── health.test.ts           # Health & 404 integration tests
│   ├── inventory.test.ts        # Inventory & Concurrency integration tests
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

## Error Handling Standards

All errors return uniform JSON responses:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient available stock for product \"b7fe631a\""
  }
}
```

### Domain Error Codes Reference

| HTTP Status | Error Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Schema validation failed (e.g. quantity $\le 0$). |
| `400 Bad Request` | `INVALID_CATEGORY` | `categoryId` provided on product creation does not exist. |
| `404 Not Found` | `PRODUCT_NOT_FOUND` | Product ID does not exist in database. |
| `404 Not Found` | `CATEGORY_NOT_FOUND` | Category ID does not exist. |
| `404 Not Found` | `INVENTORY_NOT_FOUND` | Product exists but has no inventory record. |
| `409 Conflict` | `INSUFFICIENT_STOCK` | Requested stock-out exceeds available stock ($\text{quantity} - \text{reserved}$). |
| `409 Conflict` | `INVENTORY_BELOW_RESERVED_STOCK` | Target adjustment is lower than current `reservedQuantity`. |
| `409 Conflict` | `DUPLICATE_CATEGORY` | Category name or slug already in use. |
| `409 Conflict` | `DUPLICATE_PRODUCT` | Product slug already in use. |
| `409 Conflict` | `DUPLICATE_SKU` | Product SKU already in use. |
| `409 Conflict` | `CATEGORY_HAS_PRODUCTS` | Attempted deletion of category with assigned products. |
| `500 Internal Error`| `INTERNAL_SERVER_ERROR`| Uncaught system exception. |

---

## Local Development & Testing

### Run Tests

```bash
npm test
```

* **46 automated integration tests** across Health, Category, Product, and Inventory suites.
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
