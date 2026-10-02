import Redis, { type RedisOptions } from 'ioredis';
import { config } from '../config/env';

const redisOptions: RedisOptions = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
};

export const redis = new Redis(redisOptions);

redis.on('error', (err: Error) => {
  // Connection errors are expected if Redis is not running in some environments (e.g. unit tests).
  // We do not crash the process here; higher layers decide how to handle failures (e.g. fail-open for rate limiting).
  if (process.env.NODE_ENV !== 'test') {
    console.error('Redis error:', err.message);
  }
});
