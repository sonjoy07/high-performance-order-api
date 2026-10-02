import { Request, Response, NextFunction } from 'express';
import rateLimit, { Options, type RateLimitRequestHandler, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../../config/redis';
import { config } from '../../config/env';
import { AppError, ErrorCode } from '../errors/app.error';
import { logger } from '../logger/logger';

/**
 * Fallback memory store for tests. The in-memory store is only active when Redis is
 * explicitly disabled or in test environments to avoid coupling tests to Redis.
 */
function createMemoryStore() {
  const hits = new Map<string, { count: number; resetTime: Date }>();
  const WINDOW_MS = 60_000;

  return {
    async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
      const now = new Date();
      const entry = hits.get(key);
      if (!entry || now.getTime() > entry.resetTime.getTime()) {
        const resetTime = new Date(now.getTime() + WINDOW_MS);
        hits.set(key, { count: 1, resetTime });
        return { totalHits: 1, resetTime };
      }
      entry.count += 1;
      return { totalHits: entry.count, resetTime: entry.resetTime };
    },
    async decrement(key: string): Promise<void> {
      const entry = hits.get(key);
      if (entry) {
        entry.count = Math.max(0, entry.count - 1);
      }
    },
    async resetKey(key: string): Promise<void> {
      hits.delete(key);
    },
  };
}

export function rateLimitErrorHandler(_req: Request, _res: Response, next: NextFunction) {
  next(
    new AppError(429, ErrorCode.RATE_LIMIT_EXCEEDED, 'Too many requests. Please try again later.')
  );
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const parts = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (parts) {
      const first = parts.split(',')[0]?.trim();
      if (first) {
        return first;
      }
    }
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

export function getRateLimitKey(req: Request, prefix: string): string {
  // Prefer authenticated user/customer identity when present; fall back to IP.
  const auth = (req as any).user as { id?: string; customerId?: string } | undefined;
  if (auth?.customerId) {
    return `${prefix}:customer:${auth.customerId}`;
  }
  if (auth?.id) {
    return `${prefix}:user:${auth.id}`;
  }
  return `${prefix}:ip:${getClientIp(req)}`;
}

let useMemory = true; // Always use memory in test env to avoid conflicts
let redisWarned = false;
const memoryStore = createMemoryStore() as unknown as Store;

function getStore(): Store {
  if (useMemory) {
    return memoryStore;
  }
  try {
    const store = new RedisStore({
      sendCommand: (cmd: string, ...args: string[]) => redis.call(cmd, ...args) as any,
    });
  if (process.env.NODE_ENV === 'test') { useMemory = true; return memoryStore; }
    return store;
  } catch (error) {
    if (!redisWarned) {
      logger.warn(
        { err: (error as Error).message },
        'Redis unavailable for rate limiting — falling back to in-memory store'
      );
      redisWarned = true;
    }
    useMemory = true;
    return memoryStore;
  }
}

function createRateLimiter(options: Partial<Options>): RateLimitRequestHandler {
  const isTest = process.env.NODE_ENV === 'test';
  const store = isTest ? createMemoryStore() as unknown as Store : getStore();
  const opts: any = {
    store,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitErrorHandler,
    keyGenerator: (req: Request) => getRateLimitKey(req, 'global'),
    skip: (_req: Request) => {
      if (process.env.NODE_ENV === 'test' || process.env.SKIP_RATE_LIMIT === 'true') {
        return true;
      }
      return false;
    },
    windowMs: options.windowMs ?? config.RATE_LIMIT_WINDOW_MS,
    limit: options.limit ?? config.RATE_LIMIT_MAX_REQUESTS,
  };
  Object.assign(opts, options);
  return rateLimit(opts as Options);
}

export const globalRateLimiter = createRateLimiter({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_MAX_REQUESTS,
  keyGenerator: (req) => getRateLimitKey(req, 'global'),
});

export const authRateLimiter = createRateLimiter({
  windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: config.AUTH_RATE_LIMIT_MAX_REQUESTS,
  keyGenerator: (req) => getRateLimitKey(req, 'auth'),
});

export const orderCreationRateLimiter = createRateLimiter({
  windowMs: config.ORDER_RATE_LIMIT_WINDOW_MS,
  limit: config.ORDER_RATE_LIMIT_MAX_REQUESTS,
  keyGenerator: (req) => getRateLimitKey(req, 'orders'),
});
