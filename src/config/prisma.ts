import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './env';
import { logger } from '../common/logger/logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Prisma log levels are opt-in per process.
 *
 * Why SQL logging is development-only:
 *  - `query` events emit one log line per statement. Under load that is enormous I/O and
 *    would dominate the request budget.
 *  - The statement text uses `$1`-style placeholders, but `event.params` carries the bound
 *    values, which include emails, names and prices. Only the placeholder form is logged.
 *
 * Therefore: `error` always, `query`/`info`/`warn` only when explicitly opted in via
 * `PRISMA_LOG_QUERIES=true` (and never in production, where the env flag is ignored).
 * Events are forwarded to Pino at `debug` so they respect the logger's own level filter.
 */
function resolvePrismaLogLevels(): Prisma.LogLevel[] {
  if (config.NODE_ENV === 'production') {
    return ['error'];
  }

  if (config.PRISMA_LOG_QUERIES) {
    return ['query', 'info', 'warn', 'error'];
  }

  return ['warn', 'error'];
}

/**
 * Collapses a statement to a structural fingerprint so that repeated executions of the
 * same query shape are counted as one.
 *
 * Without this, `WHERE "status" = 'PROCESSING'` and `WHERE "status" = 'SHIPPED'` look like
 * different statements and the N+1 signal is lost in the noise.
 */
function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/\$\d+/g, '$?').trim();
}

/**
 * Warns when one statement shape repeats far more often than any single request could
 * justify — the signature of an N+1 access pattern.
 *
 * This is a development aid only. It deliberately makes no attempt to time queries: the
 * Prisma `query` event is emitted *after* the statement completes, so an elapsed time
 * derived from it would always be ~0ms. Real timings come from `pg_stat_statements` or
 * `EXPLAIN (ANALYZE)` (see `scripts/explain-analyze.ts`).
 */
function createRepeatedStatementDetector(): (sql: string) => void {
  const N_PLUS_ONE_THRESHOLD = 25;
  const WINDOW_MS = 60_000;

  const seen = new Map<string, { count: number; firstSeenAt: number; reported: boolean }>();

  return (sql: string) => {
    const fingerprint = normalizeSql(sql);
    const now = Date.now();
    const entry = seen.get(fingerprint);

    if (!entry || now - entry.firstSeenAt > WINDOW_MS) {
      seen.set(fingerprint, { count: 1, firstSeenAt: now, reported: false });
      return;
    }

    entry.count += 1;

    if (entry.count === N_PLUS_ONE_THRESHOLD) {
      entry.reported = true;
      logger.warn(
        { occurrences: entry.count, withinMs: WINDOW_MS, sql: fingerprint.slice(0, 500) },
        'Repeated statement shape detected — possible N+1 access pattern'
      );
    }

    if (entry.reported && entry.count % 100 === 0) {
      logger.warn(
        { occurrences: entry.count, sql: fingerprint.slice(0, 500) },
        'Repeated statement shape still accumulating'
      );
    }
  };
}

const createPrismaClient = (): PrismaClient => {
  const adapter = new PrismaPg({
    connectionString: config.DATABASE_URL,
  });

  const logLevels = resolvePrismaLogLevels();

  const client = new PrismaClient({
    adapter,
    log: logLevels,
  });

  if (logLevels.includes('query')) {
    const reportRepeatedStatement = createRepeatedStatementDetector();

    client.$on('query', (event: Prisma.QueryEvent) => {
      // `event.query` is logged as-is because it is placeholder-only. `event.params` is
      // deliberately NOT logged: it holds bound values (emails, names, amounts).
      logger.debug(
        { sql: event.query, paramCount: event.params?.length ?? 0 },
        'prisma:query'
      );

      reportRepeatedStatement(event.query);
    });

    client.$on('info', (event: Prisma.LogEvent) =>
      logger.debug({ target: event.target }, event.message)
    );
    client.$on('warn', (event: Prisma.LogEvent) =>
      logger.warn({ target: event.target }, event.message)
    );

    logger.debug('Prisma query logging enabled (development only)');
  }

  return client;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (config.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}