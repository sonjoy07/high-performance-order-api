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

The project adheres to a strict separation of concerns:

```text
server.ts         → Process lifecycle, port binding, and graceful shutdown
   ↓
app.ts            → Express app configuration, security headers, middleware pipeline
   ↓
routes            → Routing definitions and HTTP method mapping
   ↓
controllers       → HTTP request handling, response formatting, status codes
   ↓
services          → Core business logic, transactions, and domain rules
   ↓
repositories      → Data persistence, database queries, and cache operations
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
│   │   ├── env.ts               # Environment and application configuration with Zod validation
│   │   └── prisma.ts            # Singleton PrismaClient instance with PostgreSQL adapter
│   ├── common/
│   │   ├── errors/              # Centralized application errors and ErrorCode enum
│   │   ├── middleware/          # Global middleware (request logger, error handler, 404 handler)
│   │   └── logger/              # Pino structured logger configuration
│   ├── modules/                 # Feature-based business modules
│   │   └── health/              # Health check module (controller, route)
│   ├── jobs/                    # BullMQ job workers and consumers (for future phases)
│   ├── queues/                  # BullMQ queue producers and definitions (for future phases)
│   ├── events/                  # Domain events and pub/sub handlers (for future phases)
│   ├── app.ts                   # Express application setup
│   └── server.ts                # Server startup and graceful termination
├── tests/                       # Unit and integration tests (Jest + Supertest)
│   └── health.test.ts
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

## Database Architecture

### Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    USER ||--o| CUSTOMER : "profile (1:1)"
    CUSTOMER ||--o{ ORDER : "places (1:N)"
    CUSTOMER ||--o{ IDEMPOTENCY_KEY : "creates (1:N)"
    CATEGORY ||--o{ PRODUCT : "classifies (1:N)"
    PRODUCT ||--|| INVENTORY : "maintains stock (1:1)"
    PRODUCT ||--o{ INVENTORY_MOVEMENT : "audit trail (1:N)"
    PRODUCT ||--o{ ORDER_ITEM : "ordered in (1:N)"
    PRODUCT ||--o{ STOCK_RESERVATION : "reserved in (1:N)"
    ORDER ||--|{ ORDER_ITEM : "contains items (1:N)"
    ORDER ||--o{ ORDER_STATUS_HISTORY : "tracks transitions (1:N)"
    ORDER ||--o{ STOCK_RESERVATION : "reserves stock (1:N)"

    USER {
        string id PK
        string email UK
        string passwordHash
        enum role
        datetime createdAt
        datetime updatedAt
    }

    CUSTOMER {
        string id PK
        string userId FK,UK
        string firstName
        string lastName
        string phone
        datetime createdAt
        datetime updatedAt
    }

    CATEGORY {
        string id PK
        string name UK
        string slug UK
        string description
        datetime createdAt
        datetime updatedAt
    }

    PRODUCT {
        string id PK
        string categoryId FK
        string name
        string slug UK
        string description
        string sku UK
        decimal price
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    INVENTORY {
        string id PK
        string productId FK,UK
        int quantity
        int reservedQuantity
        int version
        datetime createdAt
        datetime updatedAt
    }

    INVENTORY_MOVEMENT {
        string id PK
        string productId FK
        enum type
        int quantity
        string referenceType
        string referenceId
        datetime createdAt
    }

    ORDER {
        string id PK
        string customerId FK
        string orderNumber UK
        enum status
        decimal totalAmount
        datetime createdAt
        datetime updatedAt
    }

    ORDER_ITEM {
        string id PK
        string orderId FK
        string productId FK
        int quantity
        decimal unitPrice
        decimal totalPrice
        datetime createdAt
    }

    ORDER_STATUS_HISTORY {
        string id PK
        string orderId FK
        enum fromStatus
        enum toStatus
        datetime changedAt
        string reason
    }

    STOCK_RESERVATION {
        string id PK
        string orderId FK
        string productId FK
        int quantity
        enum status
        datetime expiresAt
        datetime createdAt
        datetime releasedAt
    }

    IDEMPOTENCY_KEY {
        string id PK
        string key
        string customerId FK
        string requestHash
        int responseStatus
        jsonb responseBody
        datetime createdAt
        datetime expiresAt
    }
```

### Main Entities & Design Decisions

1. **User & Customer (`1:1` via unique `userId`):**
   * `User` isolates authentication and credentials (`email`, `passwordHash`, `role`).
   * `Customer` encapsulates profile details (`firstName`, `lastName`, `phone`).
   * **Decision:** `userId` on `Customer` is strictly marked `@unique`. An authenticated customer user should have exactly one customer profile to prevent split order histories and account ambiguity. Non-customer users (e.g. `ADMIN`) do not require a `Customer` profile.

2. **Category & Product (`1:N`):**
   * Products belong to a Category (`categoryId`).
   * Products enforce unique `sku` (Stock Keeping Unit) and `slug` for clean URL resolution.
   * `isActive` flag enables soft-deactivation without deleting historical catalog references.

3. **Inventory & Optimistic Concurrency:**
   * `Inventory` maintains a strict `1:1` relationship with `Product` (`productId` is `@unique`).
   * Separate `quantity` (physical stock on hand) and `reservedQuantity` (stock earmarked for unfulfilled checkout sessions) to prevent overselling.
   * An integer `version` field is included to facilitate lock-free **optimistic concurrency control** (`WHERE id = ? AND version = ?`) during high-throughput order bursts.

4. **Inventory Movements (Audit Trail):**
   * Append-only ledger recording all stock changes (`STOCK_IN`, `STOCK_OUT`, `RESERVATION`, `RELEASE`, `ADJUSTMENT`).
   * Correlates each movement with a `referenceType` (e.g., `ORDER`, `INITIAL_STOCK`, `PURCHASE_ORDER`) and optional `referenceId`.

5. **Order & Historical Immutability (`OrderItem`):**
   * `Order` contains human-readable unique `orderNumber` and an enumerated lifecycle state (`PENDING`, `CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED`).
   * **Crucial Immutability Invariant:** `OrderItem.unitPrice` and `OrderItem.totalPrice` record the exact price negotiated at checkout time. Historical order data **never** references live product catalog prices, preserving invoicing and accounting accuracy even if catalog prices change or products are retired.

6. **Order Status History:**
   * Append-only transition log capturing `fromStatus` -> `toStatus`, `changedAt`, and an optional `reason` (e.g. "Payment confirmed", "Customer cancelled").

7. **Stock Reservation:**
   * Protects against overselling during checkout hold windows before final payment confirmation.
   * Tracks statuses: `ACTIVE`, `RELEASED`, `CONSUMED`, `EXPIRED`, along with `expiresAt` and `releasedAt`.

8. **Idempotency Key:**
   * Guards against duplicate charges and double-orders caused by network timeouts or retry loops.
   * Enforces composite uniqueness: `@@unique([customerId, key])`, scoping client keys per customer.
   * Caches `requestHash`, `responseStatus`, and `responseBody` (JSONB) with an `expiresAt` timestamp for TTL eviction.

---

### Money Handling: Why `Decimal` instead of `Float`

Financial quantities (`Product.price`, `Order.totalAmount`, `OrderItem.unitPrice`, `OrderItem.totalPrice`) are strictly defined as PostgreSQL `DECIMAL(12, 2)`:

* **No Binary Approximations:** Floating-point numbers (`FLOAT`, `DOUBLE PRECISION`, IEEE 754) store values as base-2 fractions, causing notorious rounding errors (e.g., `0.1 + 0.2 = 0.30000000000000004`). In e-commerce, accumulating fractional discrepancies across thousands of line items causes unbalanced ledgers, invoice disputes, and tax audit failures.
* **Exact Base-10 Arithmetic:** PostgreSQL `DECIMAL/NUMERIC` provides arbitrary-precision base-10 storage. In TypeScript, Prisma maps this directly to `Prisma.Decimal` (powered by `decimal.js`), ensuring zero precision drift during arithmetic calculations.

---

### Referential Integrity & Deletion Strategy

To prevent silent data corruption or loss of financial audit history, destructive cascades are strictly forbidden on critical business entities:

| Relationship | Behavior (`onDelete`) | Architectural Rationale |
| :--- | :--- | :--- |
| `Category -> Product` | `Restrict` | Prevents accidental deletion of categories that have active products. |
| `Product -> OrderItem` | `Restrict` | **Strict financial compliance:** A product that was ordered by customers in historical orders cannot be deleted. If retired, set `isActive = false`. |
| `Product -> Inventory` | `Restrict` | Protects against deleting products without properly reconciling or auditing inventory. |
| `Product -> InventoryMovement`| `Restrict` | Inventory movements are immutable audit records; they must never be deleted. |
| `Customer -> Order` | `Restrict` | A customer with historical transactions cannot be deleted. Financial and order records must remain intact. |
| `User -> Customer` | `Restrict` | Prevents deletion of user credentials while an active customer profile exists. |
| `Order -> OrderItem` | `Cascade` | Order items form a composite aggregate root with the parent order. |
| `Order -> OrderStatusHistory` | `Cascade` | Status history belongs to the lifecycle of that specific order entity. |
| `Order -> StockReservation` | `Restrict` | Prevents deleting an order with active stock holds. Reservations must be explicitly released or consumed. |
| `Product -> StockReservation`| `Restrict` | Cannot delete a product while reservations are active. |
| `Customer -> IdempotencyKey` | `Cascade` | Transient idempotency records may be cleaned up if a customer is ever purged. |

---

### Indexing Strategy

Indexes are applied intentionally based on anticipated production access patterns:

* `Product.categoryId`: Efficient filtering of catalog items by category (`WHERE categoryId = ?`).
* `Product.isActive`: Filtering active items in customer-facing storefronts (`WHERE isActive = true`).
* `Product.createdAt`: Sorting by newest arrivals and supporting cursor-based pagination.
* `Inventory.productId`: Fast `O(1)` index lookup for inventory checks during stock reservations and checkout.
* `InventoryMovement.productId`: Retrieving full audit history of stock adjustments for a specific product.
* `InventoryMovement.createdAt`: Date-range filtering and chronologically ordered inventory auditing.
* `Order.customerId`: Fast order history lookup for customer dashboards (`WHERE customerId = ? ORDER BY createdAt DESC`).
* `Order.status`: Operational queue queries for admin fulfillment dashboards (`WHERE status IN ('CONFIRMED', 'PROCESSING')`).
* `Order.createdAt`: Financial period queries, analytics reporting, and paginated order listings.
* `OrderItem.orderId`: Immediate retrieval of line items when fetching an order details page.
* `OrderItem.productId`: Aggregating product sales and reporting on best-selling items.
* `OrderStatusHistory.orderId`: Reconstructing chronological timeline for an order.
* `OrderStatusHistory.changedAt`: Timeline sorting and SLA fulfillment duration analytics.
* `StockReservation.orderId`: Resolving active reservations linked to a checkout session.
* `StockReservation.productId`: Computing current net available inventory (`quantity - active reservations`).
* `StockReservation.status`: Fast lookup of `ACTIVE` holds.
* `StockReservation.expiresAt`: Supporting background worker queries to release expired reservations (`WHERE status = 'ACTIVE' AND expiresAt <= NOW()`).
* `IdempotencyKey.[customerId, key]`: Unique composite index ensuring fast collision checks per customer.
* `IdempotencyKey.expiresAt`: Enabling TTL purge routines to sweep expired keys.

---

## Local Development Setup

### Prerequisites

- Node.js (v20.x or v22.x recommended)
- npm (v10+ recommended)
- PostgreSQL (v16+ running locally or in Docker on port `5432`)

### 1. Clone & Install Dependencies

```bash
cd high-performance-order-api
npm install
```

### 2. Environment Configuration

Create or update `.env` file:

```env
NODE_ENV=development
PORT=5000

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/order_api

REDIS_HOST=localhost
REDIS_PORT=6379

JWT_SECRET=change-me
```

### 3. Database Migration & Seeding

```bash
# Generate Prisma Client
npm run prisma:generate

# Run migrations against PostgreSQL
npm run prisma:migrate

# Seed database with realistic development data
npm run db:seed
```

### 4. Prisma Studio (Database GUI)

```bash
npm run prisma:studio
```

---

## How to Run the Project

### Start in Development Mode (with hot-reload)

```bash
npm run dev
```

### Build for Production

```bash
npm run build
```

### Start in Production Mode

```bash
npm start
```

### Run Tests

```bash
npm test
```

### Run Linter & Formatter

```bash
# Check linting
npm run lint

# Automatically fix lint issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

---

## Health Endpoint

A lightweight health check endpoint is available to monitor service availability:

### Request

```http
GET /health
Host: localhost:5000
```

### Response

- **Status Code:** `200 OK`
- **Content-Type:** `application/json`

```json
{
  "status": "ok",
  "service": "high-performance-order-api"
}
```

---

## Error Handling Standard

All application errors return a consistent and structured JSON response:

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Route GET /unknown not found"
  }
}
```

When validation fails, an optional `details` array provides field-level feedback:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email address"
      }
    ]
  }
}
```
