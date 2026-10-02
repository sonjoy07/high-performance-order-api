import { randomUUID } from 'crypto';
import { getRedisClient } from './redis.client';
import { logger } from '../../common/logger/logger';
import {
  LOCK_PREFIX,
  LOCK_TTL_SECONDS,
  LOCK_RETRY_COUNT,
  LOCK_RETRY_DELAY_MS,
} from './redis.constants';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wraps ioredis operations with graceful error handling. */
export const redisService = {
  /** Read a cached value. Returns null on miss or Redis failure. */
  async get(key: string): Promise<string | null> {
    const client = getRedisClient();
    if (!client) return null;
    try {
      return await client.get(key);
    } catch (err) {
      logger.warn({ err, key }, 'Redis GET failed');
      return null;
    }
  },

  /** Write a value with optional TTL (seconds). */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = getRedisClient();
    if (!client) return;
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await client.setex(key, ttlSeconds, value);
      } else {
        await client.set(key, value);
      }
    } catch (err) {
      logger.warn({ err, key }, 'Redis SET failed');
    }
  },

  /** Delete one or more keys. */
  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const client = getRedisClient();
    if (!client) return;
    try {
      await client.del(...keys);
    } catch (err) {
      logger.warn({ err, keys }, 'Redis DEL failed');
    }
  },

  /** Delete all keys matching a glob pattern via SCAN (no KEYS in prod). */
  async delPattern(pattern: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return;
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      logger.warn({ err, pattern }, 'Redis DEL pattern failed');
    }
  },

  /**
   * Acquire a distributed lock using SET NX EX.
   * Returns the lock token (UUID) if acquired, null otherwise.
   */
  async acquireLock(key: string): Promise<string | null> {
    const client = getRedisClient();
    if (!client) return null;

    const lockKey = `${LOCK_PREFIX}:${key}`;
    const token = randomUUID();

    for (let attempt = 0; attempt <= LOCK_RETRY_COUNT; attempt++) {
      try {
        const result = await client.set(lockKey, token, 'EX', LOCK_TTL_SECONDS, 'NX');
        if (result === 'OK') {
          return token;
        }
      } catch (err) {
        logger.warn({ err, lockKey }, 'Redis lock acquire attempt failed');
        return null;
      }

      if (attempt < LOCK_RETRY_COUNT) {
        await sleep(LOCK_RETRY_DELAY_MS * Math.pow(2, attempt));
      }
    }

    return null; // Could not acquire — caller falls through to DB
  },

  /**
   * Release a lock only if the caller owns it (compare-and-delete via Lua).
   */
  async releaseLock(key: string, token: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return;

    const lockKey = `${LOCK_PREFIX}:${key}`;
    const luaScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    try {
      await client.eval(luaScript, 1, lockKey, token);
    } catch (err) {
      logger.warn({ err, lockKey }, 'Redis lock release failed');
    }
  },
};
