import { app } from './app';
import { config } from './config/env';
import { logger } from './common/logger/logger';
import { prisma } from './config/prisma';
import { disconnectRedis } from './infrastructure/redis/redis.client';
import { closeAllQueues } from './queues/queue.factory';

const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    `🚀 Server running on port ${config.PORT}`
  );
  logger.info(`🏥 Health: http://localhost:${config.PORT}/health`);
  logger.info(`✅ Ready:  http://localhost:${config.PORT}/health/ready`);
  logger.info(`📖 Docs:   http://localhost:${config.PORT}/api/docs`);
});

/**
 * Graceful shutdown sequence:
 *  1. Stop accepting new HTTP requests
 *  2. Wait for active requests to complete (server.close)
 *  3. Close BullMQ queue connections
 *  4. Disconnect Redis
 *  5. Disconnect Prisma / PostgreSQL
 *  6. Exit
 *
 * Force-exits after 15 seconds if anything hangs.
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Received shutdown signal — starting graceful shutdown');

  // Force-exit safety net
  const forceTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out after 15s — forcing exit');
    process.exit(1);
  }, 15_000).unref();

  try {
    // 1. Stop accepting new connections; wait for in-flight requests to finish
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    logger.info('HTTP server closed');

    // 2. Close BullMQ queue connections (producer side)
    await closeAllQueues();
    logger.info('BullMQ queues closed');

    // 3. Disconnect Redis
    await disconnectRedis();
    logger.info('Redis disconnected');

    // 4. Disconnect Prisma / PostgreSQL
    await prisma.$disconnect();
    logger.info('Database disconnected');

    clearTimeout(forceTimer);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during graceful shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled Promise Rejection — inspect and fix');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception — process will terminate');
  process.exit(1);
});
