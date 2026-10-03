# Testing Documentation

## Test Categories

### Unit Tests
Pure business logic tests covering order calculations, inventory calculations, and basic operations.
- Location: tests/unit/
- Run: npm run test:unit

### Integration Tests
API endpoint integration tests covering full request/response cycles with database.
- Location: tests/integration/, tests/auth.test.ts, tests/phase11-query.test.ts
- Run: npm run test:integration

### Concurrency Tests
Concurrent access patterns to verify no overselling, no duplicate orders, and transaction integrity.
- Location: tests/concurrency/
- Run: npm run test:concurrency

### Performance Tests
Performance validation and load testing utilities.
- Location: tests/performance/
- Run: npm run test:performance

### Security Tests
Security-focused tests including headers, CORS, and basic security validations.
- Location: tests/security.test.ts

### Core Tests
Existing test suite covering all phases.
- All tests: npm run test:all

## Important Scenarios Validated

- **No Overselling:** PostgreSQL SELECT ... FOR UPDATE ensures atomic inventory reservation
- **Idempotency:** Idempotency keys scoped per customer prevent duplicate orders
- **Transaction Integrity:** All-or-nothing semantics with proper rollback on failures
- **Authorization & Access Control:** RBAC with ownership verification (IDOR prevention)
- **Rate Limiting:** Redis-backed with in-memory fallback
- **Cache Behavior:** Cache-aside with proper invalidation on mutations

## Performance Methodology

Performance measurements use:
- scripts/explain-analyze.ts - EXPLAIN ANALYZE with BUFFERS for query plans
- scripts/measure-queries.ts - Statement count and latency measurements
- Real repository/service code (not synthetic queries)
- Deterministic 50k-order dataset via db:seed:perf

## Known Limitations

- **Post-commit enqueue consistency:** Events are enqueued after transaction commit; small theoretical window if process crashes between commit and enqueue.
- **OFFSET pagination:** Expensive at very large offsets (mitigated by MAX_LIMIT=100).
- **Redis fallback:** During Redis outages, cache and rate limiting use in-memory fallback.
- **Large analytics queries:** Full unfiltered aggregations scan all matching rows by design.

