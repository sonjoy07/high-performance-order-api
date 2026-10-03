import { config } from '../../config/env';
import { logger } from '../logger/logger';
import { redisService } from '../../infrastructure/redis/redis.service';

/**
 * Cache-aside helper with stampede protection.
 *
 * 1. Try to read value from Redis.
 * 2. On hit → parse and return.
 * 3. On miss → try to acquire a short-lived lock.
 *    - If lock acquired → fetch from DB, store in Redis, release lock, return.
 *    - If lock not acquired → fall through and fetch from DB directly (no wait).
 * 4. On any Redis error → fall through to DB transparently.
 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds = config.CACHE_TTL_SECONDS
): Promise<T> {
  // ── 1. Try cache ──────────────────────────────────────────────────────────
  const cached = await redisService.get(key);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      // Corrupted entry — delete and recompute
      logger.warn({ key }, 'Cache corruption detected, deleting key');
      await redisService.del(key);
    }
  }

  // ── 2. Stampede protection — try to acquire lock ──────────────────────────
  const token = await redisService.acquireLock(key);

  // ── 3. Double-check cache after acquiring lock ────────────────────────────
  if (token) {
    const recheck = await redisService.get(key);
    if (recheck !== null) {
      await redisService.releaseLock(key, token);
      try {
        return JSON.parse(recheck) as T;
      } catch {
        await redisService.del(key);
      }
    }
  }

  // ── 4. Fetch from DB ──────────────────────────────────────────────────────
  try {
    const data = await fetcher();
    // Only cache on successful fetch
    void redisService.set(key, JSON.stringify(data), ttlSeconds);
    return data;
  } finally {
    if (token) {
      void redisService.releaseLock(key, token);
    }
  }
}
