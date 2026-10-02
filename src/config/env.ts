import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const isValidTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://postgres:postgres@localhost:5432/order_api'),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  QUEUE_PREFIX: z.string().default('high-performance-order-api'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  JWT_SECRET: z.string().min(1).default('change-me'),
  JWT_ACCESS_SECRET: z.string().min(1).default('access-secret-key-super-secure-min-32-chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
  JWT_REFRESH_SECRET: z.string().min(1).default('refresh-secret-key-super-secure-min-32-chars'),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
  STOCK_RESERVATION_MINUTES: z.coerce.number().int().positive().default(30),
  IDEMPOTENCY_KEY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  /**
   * IANA timezone used to resolve date-only query boundaries (`fromDate` / `toDate`).
   * Date-only values such as `2026-01-31` mean the start/end of that calendar day in
   * THIS timezone, so reports are deterministic regardless of the server's local time.
   */
  TIMEZONE: z
    .string()
    .refine(isValidTimeZone, { message: 'TIMEZONE must be a valid IANA timezone identifier' })
    .default('UTC'),
  /**
   * Enables verbose Prisma SQL logging. Never defaults to on in production: SQL text is
   * high-volume and can disclose query shapes. Production keeps error-level logging only.
   */
  PRISMA_LOG_QUERIES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),
  ORDER_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  ORDER_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(20),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Request size limits
  BODY_LIMIT: z.string().default('1mb'),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error(
      '❌ Invalid environment variables:',
      JSON.stringify(result.error.format(), null, 2)
    );
    process.exit(1);
  }

  const cfg = result.data;

  // ── Production safety guards ─────────────────────────────────────────────
  // Refuse to start in production with known-insecure default secrets.
  if (cfg.NODE_ENV === 'production') {
    const insecureDefaults = [
      ['JWT_SECRET', cfg.JWT_SECRET, 'change-me'],
      ['JWT_ACCESS_SECRET', cfg.JWT_ACCESS_SECRET, 'access-secret-key-super-secure-min-32-chars'],
      ['JWT_REFRESH_SECRET', cfg.JWT_REFRESH_SECRET, 'refresh-secret-key-super-secure-min-32-chars'],
    ] as const;

    const violations = insecureDefaults
      .filter(([, value, bad]) => value === bad || value.includes('change-me'))
      .map(([name]) => name);

    if (violations.length > 0) {
      console.error(
        `❌ Production startup refused: insecure default values detected for: ${violations.join(', ')}. ` +
          'Set strong secrets before deploying.'
      );
      process.exit(1);
    }
  }

  return cfg;
};

export const config = parseEnv();
export type Config = z.infer<typeof envSchema>;

