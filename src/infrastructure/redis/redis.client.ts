import Redis from 'ioredis';
import { config } from '../../config/env';
import { logger } from '../../common/logger/logger';

// When null: client was explicitly disabled or never created
// The _injected flag prevents auto-creation when tests call setRedisClient(null)
let redisClient: Redis | null = null;
let isConnected = false;
let _injected = false; // true when setRedisClient() has been called explicitly

/**
 * Returns the singleton Redis client.
 * - If setRedisClient() has been called, always returns whatever was injected.
 * - Otherwise lazily creates a real ioredis connection.
 */
export function getRedisClient(): Redis | null {
  // Test override path — respect whatever was injected
  if (_injected) {
    return isConnected ? redisClient : null;
  }

  // Already created and connected
  if (redisClient && isConnected) {
    return redisClient;
  }

  // Already created but disconnected (connection failed)
  if (redisClient && !isConnected) {
    return null;
  }

  // Lazy creation — first call
  try {
    const client = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 1000,
    });

    client.on('connect', () => {
      isConnected = true;
      logger.info('Redis connected');
    });

    client.on('ready', () => {
      isConnected = true;
    });

    client.on('error', (err) => {
      isConnected = false;
      logger.warn({ err }, 'Redis error — falling back to database');
    });

    client.on('close', () => {
      isConnected = false;
    });

    client.on('end', () => {
      isConnected = false;
      if (!_injected) redisClient = null;
    });

    client.connect().catch((err) => {
      logger.warn({ err }, 'Redis initial connection failed — caching disabled');
      isConnected = false;
    });

    redisClient = client;
    return null; // Return null until 'connect'/'ready' fires
  } catch (err) {
    logger.warn({ err }, 'Failed to create Redis client — caching disabled');
    return null;
  }
}

/** Gracefully disconnect Redis (used in tests and on shutdown). */
export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
    redisClient = null;
    isConnected = false;
    _injected = false;
  }
}

/**
 * Replace the internal client (used in tests to inject a mock).
 * Pass null to disable caching for the test.
 */
export function setRedisClient(client: Redis | null): void {
  _injected = true;
  redisClient = client;
  isConnected = client !== null;
}

/** Reset injection state — call in afterEach to fully clean up. */
export function resetRedisClient(): void {
  redisClient = null;
  isConnected = false;
  _injected = false;
}
