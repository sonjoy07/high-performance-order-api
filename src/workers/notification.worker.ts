import { Worker, Job, UnrecoverableError } from 'bullmq';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { config } from '../config/env';
import { logger } from '../common/logger/logger';
import { getQueueConnection } from '../queues/queue.factory';
import { OrderEventPayload } from '../jobs/order.jobs';
import { QUEUE_NAMES, WORKER_CONCURRENCY } from '../queues/queue.constants';
import { notificationService } from './notification.service';

/**
 * Processes a single order event job with full idempotency protection.
 *
 * Idempotency flow:
 *  1. Attempt to INSERT into processed_jobs (eventId, eventType) with unique constraint.
 *  2. If INSERT succeeds → process the event → mark complete.
 *  3. If INSERT fails with P2002 (unique violation) → this event was already processed → skip silently.
 *
 * This ensures at-most-once processing semantics for each logical domain event,
 * even if BullMQ delivers the same job more than once (at-least-once delivery guarantee).
 */
async function processOrderEventJob(job: Job<OrderEventPayload>): Promise<void> {
  const payload = job.data;

  logger.info(
    { jobId: job.id, eventId: payload.eventId, eventType: payload.eventType, orderId: payload.orderId, attempt: job.attemptsMade + 1 },
    'Worker: processing order event job'
  );

  // Validate payload structure
  if (!payload.eventId || !payload.eventType || !payload.orderId) {
    // Permanent error — do not retry, remove from queue
    throw new UnrecoverableError(
      `Invalid job payload: missing required fields. Job ID: ${job.id}`
    );
  }

  // Worker-side idempotency: try to claim this event atomically
  try {
    await prisma.processedJob.create({
      data: {
        eventId: payload.eventId,
        eventType: payload.eventType,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info(
        { jobId: job.id, eventId: payload.eventId, eventType: payload.eventType },
        'Worker: duplicate event detected — already processed, skipping'
      );
      return; // Idempotent skip — no side effects
    }
    // Unexpected DB error — allow BullMQ to retry
    throw err;
  }

  // Process the notification
  await notificationService.processOrderEvent(payload);

  logger.info(
    { jobId: job.id, eventId: payload.eventId, eventType: payload.eventType, orderId: payload.orderId },
    'Worker: order event job completed successfully'
  );
}

/**
 * Creates and returns the BullMQ notification worker for the order-events queue.
 * The worker runs in a separate process (`npm run worker`).
 */
export function createNotificationWorker(): Worker<OrderEventPayload> {
  const worker = new Worker<OrderEventPayload>(
    QUEUE_NAMES.ORDER_EVENTS,
    processOrderEventJob,
    {
      connection: getQueueConnection(),
      prefix: config.QUEUE_PREFIX,
      concurrency: config.WORKER_CONCURRENCY,
    }
  );

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, eventType: job.data.eventType, orderId: job.data.orderId },
      'Worker: job completed'
    );
  });

  worker.on('failed', (job, err) => {
    const jobData = job?.data;
    logger.error(
      {
        jobId: job?.id,
        queue: QUEUE_NAMES.ORDER_EVENTS,
        eventType: jobData?.eventType,
        orderId: jobData?.orderId,
        eventId: jobData?.eventId,
        error: err.message,
        attemptsMade: job?.attemptsMade,
      },
      'Worker: job failed after all retry attempts'
    );
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Worker: unexpected worker error');
  });

  logger.info(
    {
      queue: QUEUE_NAMES.ORDER_EVENTS,
      concurrency: config.WORKER_CONCURRENCY,
    },
    'Worker started'
  );

  return worker;
}
