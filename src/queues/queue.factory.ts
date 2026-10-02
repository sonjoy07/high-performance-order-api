import { Queue } from 'bullmq';
import { config } from '../config/env';
import { logger } from '../common/logger/logger';
import { OrderEventPayload } from '../jobs/order.jobs';
import { QUEUE_NAMES } from './queue.constants';

/** Shared BullMQ connection options pointing at the same Redis as the cache layer */
export function getQueueConnection() {
  // BullMQ accepts a URL string via the `url` property on ioredis options
  return { url: config.REDIS_URL };
}

/** Singleton map of queue instances — avoids creating duplicate Queue objects */
const queues = new Map<string, Queue>();

/** Returns (creating lazily) a BullMQ Queue for order events */
export function getOrderEventsQueue(): Queue<OrderEventPayload> {
  const name = QUEUE_NAMES.ORDER_EVENTS;
  if (!queues.has(name)) {
    const queue = new Queue<OrderEventPayload>(name, {
      connection: getQueueConnection(),
      prefix: config.QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });

    queue.on('error', (err) => {
      logger.error({ err, queue: name }, 'BullMQ queue error');
    });

    queues.set(name, queue);
    logger.info({ queue: name }, 'BullMQ queue initialized');
  }
  return queues.get(name) as Queue<OrderEventPayload>;
}

/** Gracefully close all open queues (called on shutdown) */
export async function closeAllQueues(): Promise<void> {
  const names = Array.from(queues.keys());
  await Promise.all(
    names.map(async (name) => {
      try {
        await queues.get(name)!.close();
        logger.info({ queue: name }, 'BullMQ queue closed');
      } catch (err) {
        logger.warn({ err, queue: name }, 'Error closing BullMQ queue');
      }
    })
  );
  queues.clear();
}
