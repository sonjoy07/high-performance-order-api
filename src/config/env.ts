import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://postgres:postgres@localhost:5432/order_api'),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  JWT_SECRET: z.string().min(1).default('change-me'),
  STOCK_RESERVATION_MINUTES: z.coerce.number().int().positive().default(30),
  IDEMPOTENCY_KEY_TTL_HOURS: z.coerce.number().int().positive().default(24),
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
  return result.data;
};

export const config = parseEnv();
export type Config = z.infer<typeof envSchema>;
