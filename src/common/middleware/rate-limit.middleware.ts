import { Request, Response, NextFunction } from 'express';
import rateLimit, {
  Options,
  MemoryStore,
  type ClientRateLimitInfo,
  type RateLimitRequestHandler,
  type Store,
} from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedisClient } from '../../infrastructure/redis/redis.client';
import { config } from '../../config/env';
import { AppError, ErrorCode } from '../errors/app.error';
import { logger } from '../logger/logger';

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

let redisWarned = false;

/**
 * A store that uses Redis when it is available and transparently falls back to
 * an in-memory store otherwise (documented fail-open behavior so the API stays
 * available during a Redis outage).
 *
 * Each rate limiter owns its own instance, satisfying express-rate-limit's
 * ERR_ERL_STORE_REUSE requirement (stores must not be shared between limiters).
 */
class FallbackStore implements Store {
  private readonly memory = new MemoryStore();
  private redisStore: RedisStore | null = null;
  private initOptions: Options | null = null;

  constructor(public readonly prefix: string) {}

  public init(options: Options): void {
    this.initOptions = options;
    (this.memory as any).init?.(options);
  }

  private getRedisStore(): RedisStore | null {
    if (process.env.NODE_ENV === 'test' || process.env.SKIP_RATE_LIMIT === 'true') {
      return null;
    }
    const client = getRedisClient();
    if (!client) {
      if (!redisWarned) {
        logger.warn('Redis unavailable for rate limiting - using in-memory fallback');
        redisWarned = true;
      }
      return null;
    }
    if (!this.redisStore) {
      this.redisStore = new RedisStore({
        prefix: `rl:${this.prefix}:`,
        sendCommand: (...args: string[]) =>
          client.call(...(args as [string, ...string[]])) as unknown as Promise<never>,
      });
      if (this.initOptions) {
        (this.redisStore as any).init?.(this.initOptions);
      }
    }
    return this.redisStore;
  }

  private async run<T>(op: (store: Store) => Promise<T>): Promise<T> {
    const store = this.getRedisStore();
    if (store) {
      try {
        return await op(store);
      } catch (error) {
        if (!redisWarned) {
          logger.warn(
            { err: (error as Error).message },
            'Redis rate limit store failed - falling back to in-memory store'
          );
          redisWarned = true;
        }
      }
    }
    return op(this.memory);
  }

  public async increment(key: string): Promise<ClientRateLimitInfo> {
    return this.run((store) => Promise.resolve(store.increment(key)));
  }

  public async decrement(key: string): Promise<void> {
    await this.run(async (store) => {
      await store.decrement(key);
    });
  }

  public async resetKey(key: string): Promise<void> {
    await this.run(async (store) => {
      await store.resetKey(key);
    });
  }
}

function createRateLimiter(prefix: string, options: Partial<Options>): RateLimitRequestHandler {
  const opts: any = {
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_MAX_REQUESTS,
    message: 'Too many requests. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitErrorHandler,
    keyGenerator: (req: Request) => getRateLimitKey(req, prefix),
    skip: () => process.env.NODE_ENV === 'test' || process.env.SKIP_RATE_LIMIT === 'true',
    store: new FallbackStore(prefix),
  };
  Object.assign(opts, options);
  return rateLimit(opts as Options);
}

export const globalRateLimiter = createRateLimiter('global', {
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_MAX_REQUESTS,
});

export const authRateLimiter = createRateLimiter('auth', {
  windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: config.AUTH_RATE_LIMIT_MAX_REQUESTS,
});

export const orderCreationRateLimiter = createRateLimiter('orders', {
  windowMs: config.ORDER_RATE_LIMIT_WINDOW_MS,
  limit: config.ORDER_RATE_LIMIT_MAX_REQUESTS,
});
