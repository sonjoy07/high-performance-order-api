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
│   │   └── products/            # Product catalog & inventory module
│   │       ├── product.controller.ts
│   │       ├── product.repository.ts
│   │       ├── product.route.ts
│   │       ├── product.service.ts
│   │       └── product.validation.ts
│   ├── jobs/                    # BullMQ job workers and consumers (for future phases)
│   ├── queues/                  # BullMQ queue producers and definitions (for future phases)
│   ├── events/                  # Domain events and pub/sub handlers (for future phases)
│   ├── app.ts                   # Express application setup
│   └── server.ts                # Server startup and graceful termination
├── tests/                       # Automated test suites (Jest + Supertest)
│   ├── category.test.ts         # Category API integration tests
│   ├── health.test.ts           # Health & 404 integration tests
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
| `PATCH` | `/api/v1/categories/:id` | Partially update category name, slug, or description | `200 OK` |
| `DELETE` | `/api/v1/categories/:id` | Delete category (rejected if products are assigned) | `200 OK` |

### Create Category Payload (`POST /api/v1/categories`)

```json
{
  "name": "Electronics",
  "slug": "electronics",
  "description": "Computing devices, smartphones, and accessories"
}
```

---

## Product API

Base path: `/api/v1/products`

| Method | Endpoint | Description | Status Code |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/products` | Create a product with linked inventory | `201 Created` |
| `GET` | `/api/v1/products` | List products with filtering, search, sorting & pagination | `200 OK` |
| `GET` | `/api/v1/products/:id` | Get product details with category | `200 OK` |
| `PATCH` | `/api/v1/products/:id` | Partially update product details | `200 OK` |
| `DELETE` | `/api/v1/products/:id` | Safe product deletion (soft delete if historical orders exist) | `200 OK` |

### Create Product Payload (`POST /api/v1/products`)

```json
{
  "categoryId": "ee13d707-3121-4870-adaf-8171443ac14b",
  "name": "Wireless Noise-Cancelling Headphones",
  "slug": "wireless-noise-cancelling-headphones",
  "description": "High-fidelity wireless headphones with 40-hour battery life",
  "sku": "TECH-WNC-001",
  "price": 199.99,
  "isActive": true
}
```

---

## Filtering, Pagination & Sorting

### Product Filtering Query Parameters

Filtering parameters can be combined freely on `GET /api/v1/products`:

* `search`: Case-insensitive partial matching across **Product Name** and **SKU** (`contains`, `mode: 'insensitive'`).
* `categoryId`: Filter products by parent category UUID.
* `minPrice`: Filter products with price $\ge$ `minPrice`.
* `maxPrice`: Filter products with price $\le$ `maxPrice`. (Validated: `minPrice <= maxPrice`).
* `isActive`: Boolean flag (`true` or `false`) to filter active catalog items.

**Example Request:**
```http
GET /api/v1/products?search=headphone&categoryId=ee13d707-3121-4870-adaf-8171443ac14b&minPrice=50&maxPrice=300&isActive=true&page=1&limit=20&sortBy=price&sortOrder=asc
```

### Pagination Implementation

All list endpoints implement offset pagination:

$$\text{offset} = (\text{page} - 1) \times \text{limit}$$

* `page`: Integer $\ge 1$ (default: `1`).
* `limit`: Integer $\ge 1$ and $\le 100$ (default: `20`, maximum: `100`).
* Protected against memory exhaustion: Limits $> 100$ or $< 1$ trigger immediate `400 VALIDATION_ERROR`.

**Pagination Response Structure:**
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 245,
    "totalPages": 13
  }
}
```

### Sorting & Field Whitelisting

Sorting inputs are strictly validated against whitelisted database fields to prevent arbitrary query injection:

* **Product Sort Fields (`sortBy`):** `name`, `price`, `createdAt`, `updatedAt` (default: `createdAt`).
* **Category Sort Fields (`sortBy`):** `name`, `createdAt`, `updatedAt` (default: `createdAt`).
* **Sort Direction (`sortOrder`):** `asc` (ascending) or `desc` (descending, default: `desc`).

---

## Query Optimization & N+1 Prevention

1. **Relation Loading without N+1:**
   * Products list queries use Prisma relation joins (`include: { category: { select: { id: true, name: true, slug: true } } }`).
   * This executes a single optimized PostgreSQL SQL join, avoiding the classic anti-pattern of 1 query for products + $N$ individual queries for each category.
2. **Selective Field Projections:**
   * Only necessary fields are returned; internal password hashes, system metadata, or unindexed blobs are excluded.
3. **Index Utilization:**
   * Queries leverage composite and single-column B-tree indexes defined in Phase 2:
     * `products_categoryId_idx`, `products_isActive_idx`, `products_createdAt_idx`
     * Unique B-tree indexes on `sku` and `slug`
4. **Concurrent Count & Data Queries:**
   * `prisma.$transaction([findManyQuery, countQuery])` executes the paginated fetch and total count concurrently over a single pooled connection.

---

## Validation Architecture

Request validation is handled declaratively using **Zod** via [`validateRequest`](file:///d:/projects/assignment/high-performance-order-api/src/common/middleware/validate.middleware.ts):

* **Fail-Fast:** Requests with invalid payloads, malformed URL slugs, negative prices, or out-of-range pagination limits are rejected before executing any database query.
* **URL-Friendly Slugs:** Enforces lowercase alphanumeric kebab-case: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`.
* **Clean Error Formatting:** Validation failures format issues into a `{ field, message }` array within the standard error envelope.

---

## Error Handling Standards

All errors conform to a consistent JSON format:

```json
{
  "success": false,
  "error": {
    "code": "CATEGORY_HAS_PRODUCTS",
    "message": "Cannot delete category \"Electronics\" because it has 3 associated product(s)"
  }
}
```

### Domain Error Codes

| HTTP Status | Error Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Request body, query, or params failed Zod schema checks. |
| `400 Bad Request` | `INVALID_CATEGORY` | `categoryId` provided on product creation does not exist. |
| `404 Not Found` | `CATEGORY_NOT_FOUND` | Category with the specified ID was not found. |
| `404 Not Found` | `PRODUCT_NOT_FOUND` | Product with the specified ID was not found. |
| `409 Conflict` | `DUPLICATE_CATEGORY` | Category name or slug is already taken. |
| `409 Conflict` | `DUPLICATE_PRODUCT` | Product slug already exists. |
| `409 Conflict` | `DUPLICATE_SKU` | Product SKU already exists. |
| `409 Conflict` | `CATEGORY_HAS_PRODUCTS` | Attempted to delete a category that still contains products. |
| `500 Internal Error`| `INTERNAL_SERVER_ERROR`| Uncaught system exception (sanitized in production). |

---

## Local Development & Testing

### Run Tests

```bash
npm test
```

* Executes 32 automated integration tests across Health, Category, and Product suites using Jest & Supertest.

### Start Development Server

```bash
npm run dev
```

### Production Build & Verification

```bash
# Type check without compilation
npx tsc --noEmit

# Production build
npm run build

# Linting
npm run lint

# Code formatting check
npm run format:check
```
