/**
 * Worker entry point — run separately from the API server.
 *
 * Start with: npm run worker
 *
 * The worker listens on the order-events BullMQ queue and processes:
 *  - ORDER_CREATED
 *  - ORDER_CANCELLED
 *  - ORDER_CONFIRMED / PROCESSING / SHIPPED / DELIVERED
 *
 * Graceful shutdown on SIGTERM / SIGINT:
 *  1. Stop accepting new jobs
 *  2. Wait for in-flight jobs to complete
 *  3. Close worker and queue connections
 *  4. Exit cleanly
 */

import { logger } from './common/logger/logger';
import { createNotificationWorker } from './workers/notification.worker';
import { closeAllQueues } from './queues/queue.factory';
import { prisma } from './config/prisma';
import { config } from './config/env';

logger.info(
  {
    nodeEnv: config.NODE_ENV,
    redisUrl: config.REDIS_URL.replace(/:[^:@]+@/, ':***@'), // mask password if present
    workerConcurrency: config.WORKER_CONCURRENCY,
    queuePrefix: config.QUEUE_PREFIX,
  },
  'Starting notification worker process'
);

const worker = createNotificationWorker();

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Worker shutting down gracefully...`);

  try {
    // Stop accepting new jobs and wait for in-flight jobs to complete
    await worker.close();
    logger.info('Worker closed — all in-flight jobs finished');

    // Close BullMQ queue connections
    await closeAllQueues();
    logger.info('All queues closed');

    // Close Prisma connection
    await prisma.$disconnect();
    logger.info('Database connection closed');

    logger.info('Worker shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during worker shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Worker: Unhandled Rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Worker: Uncaught Exception — terminating');
  process.exit(1);
});
