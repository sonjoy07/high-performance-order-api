# high-performance-order-api

A production-grade, high-performance Order Processing & Inventory Management REST API built with Node.js, Express, TypeScript, and modern backend architectural patterns.

---

## Tech Stack

- **Runtime & Language:** Node.js (v22+), TypeScript (Strict Mode)
- **Web Framework:** Express.js
- **Database & ORM:** PostgreSQL, Prisma ORM *(configured for Phase 2)*
- **In-Memory Store & Cache:** Redis *(configured for Phase 2)*
- **Job & Queue Management:** BullMQ *(configured for Phase 2)*
- **Validation:** Zod
- **Structured Logging:** Pino, Pino-HTTP, Pino-Pretty
- **Testing:** Jest, Supertest, ts-jest
- **Code Quality:** ESLint (Flat Config), Prettier
- **Containerization:** Docker, Docker Compose *(prepared for Phase 2)*

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
├── src/
│   ├── config/                  # Environment and application configuration with Zod validation
│   ├── common/
│   │   ├── errors/              # Centralized application errors and ErrorCode enum
│   │   ├── middleware/          # Global middleware (request logger, error handler, 404 handler)
│   │   └── logger/              # Pino logger configuration
│   ├── modules/                 # Feature-based business modules (e.g. health, and future modules)
│   │   └── health/              # Health check module (controller, route)
│   ├── jobs/                    # BullMQ job workers and consumers (for future phases)
│   ├── queues/                  # BullMQ queue producers and definitions (for future phases)
│   ├── events/                  # Domain events and pub/sub handlers (for future phases)
│   ├── app.ts                   # Express application setup
│   └── server.ts                # Server startup and graceful termination
├── tests/                       # Unit and integration tests (Jest + Supertest)
│   └── health.test.ts
├── .env.example                 # Template for required environment variables
├── .gitignore                   # Ignored files and directories for Git
├── eslint.config.js             # Modern ESLint Flat Configuration
├── prettier.config.js           # Prettier code formatting rules
├── package.json                 # Project dependencies and npm scripts
├── tsconfig.json                # TypeScript compiler configuration (strict mode)
└── README.md                    # Project documentation
```

---

## Local Development Setup

### Prerequisites

- Node.js (v20.x or v22.x recommended)
- npm (v10+ recommended)

### 1. Clone & Install Dependencies

```bash
cd high-performance-order-api
npm install
```

### 2. Environment Variable Setup

Copy the example environment configuration:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Default `.env` values:

```env
NODE_ENV=development
PORT=5000

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/order_api

REDIS_HOST=localhost
REDIS_PORT=6379

JWT_SECRET=change-me
```

> **Note:** Environment variables are strictly validated on startup using **Zod**. If any required variable is missing or malformed, the process exits immediately with a descriptive error.

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
