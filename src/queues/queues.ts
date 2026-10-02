import { randomUUID } from 'crypto';
import { JobsOptions } from 'bullmq';
import { logger } from '../common/logger/logger';
import { getOrderEventsQueue } from '../queues/queue.factory';
import {
  OrderEventPayload,
  OrderCreatedEvent,
  OrderCancelledEvent,
  OrderStatusChangedEvent,
} from '../jobs/order.jobs';
import { ORDER_EVENT_TYPES, OrderEventType, JOB_DEFAULT_OPTS } from '../queues/queue.constants';
import { OrderStatus } from '@prisma/client';

/**
 * Maps an OrderStatus to the appropriate OrderEventType.
 * Returns null for statuses that don't map to an event (e.g. PENDING).
 */
function statusToEventType(status: OrderStatus): OrderEventType | null {
  const map: Partial<Record<OrderStatus, OrderEventType>> = {
    [OrderStatus.CONFIRMED]: ORDER_EVENT_TYPES.ORDER_CONFIRMED,
    [OrderStatus.PROCESSING]: ORDER_EVENT_TYPES.ORDER_PROCESSING,
    [OrderStatus.SHIPPED]: ORDER_EVENT_TYPES.ORDER_SHIPPED,
    [OrderStatus.DELIVERED]: ORDER_EVENT_TYPES.ORDER_DELIVERED,
    [OrderStatus.CANCELLED]: ORDER_EVENT_TYPES.ORDER_CANCELLED,
  };
  return map[status] ?? null;
}

/**
 * Enqueues an ORDER_CREATED domain event.
 *
 * IMPORTANT: This must be called AFTER the DB transaction commits.
 * Calling it before commit risks orphaned jobs referencing uncommitted data.
 *
 * Uses a deterministic job ID (`order-created:{orderId}`) to prevent accidental
 * duplicate enqueueing for the same order.
 */
export async function enqueueOrderCreated(params: {
  orderId: string;
  customerId: string;
  orderNumber: string;
  totalAmount: string;
}): Promise<void> {
  try {
    const queue = getOrderEventsQueue();
    const eventId = randomUUID();
    const payload: OrderCreatedEvent = {
      eventId,
      eventType: ORDER_EVENT_TYPES.ORDER_CREATED,
      orderId: params.orderId,
      customerId: params.customerId,
      orderNumber: params.orderNumber,
      totalAmount: params.totalAmount,
      occurredAt: new Date().toISOString(),
    };

    const opts: JobsOptions = {
      ...JOB_DEFAULT_OPTS,
      jobId: `order-created:${params.orderId}`, // deterministic — prevents accidental duplicate enqueue
    };

    await queue.add(ORDER_EVENT_TYPES.ORDER_CREATED, payload, opts);
    logger.info({ orderId: params.orderId, eventId, jobId: opts.jobId }, 'ORDER_CREATED job enqueued');
  } catch (err) {
    // Log but do NOT throw — queue failure must not break the order API response
    logger.error({ err, orderId: params.orderId }, 'Failed to enqueue ORDER_CREATED job');
  }
}

/**
 * Enqueues an ORDER_CANCELLED domain event after successful cancellation commit.
 */
export async function enqueueOrderCancelled(params: {
  orderId: string;
  customerId: string;
  reason?: string;
}): Promise<void> {
  try {
    const queue = getOrderEventsQueue();
    const eventId = randomUUID();
    const payload: OrderCancelledEvent = {
      eventId,
      eventType: ORDER_EVENT_TYPES.ORDER_CANCELLED,
      orderId: params.orderId,
      customerId: params.customerId,
      reason: params.reason,
      occurredAt: new Date().toISOString(),
    };

    const opts: JobsOptions = {
      ...JOB_DEFAULT_OPTS,
      jobId: `order-cancelled:${params.orderId}`,
    };

    await queue.add(ORDER_EVENT_TYPES.ORDER_CANCELLED, payload, opts);
    logger.info({ orderId: params.orderId, eventId }, 'ORDER_CANCELLED job enqueued');
  } catch (err) {
    logger.error({ err, orderId: params.orderId }, 'Failed to enqueue ORDER_CANCELLED job');
  }
}

/**
 * Enqueues a status-change domain event after a successful DB commit.
 * Covers: CONFIRMED, PROCESSING, SHIPPED, DELIVERED.
 */
export async function enqueueOrderStatusChanged(params: {
  orderId: string;
  newStatus: OrderStatus;
}): Promise<void> {
  const eventType = statusToEventType(params.newStatus);
  if (!eventType) {
    logger.debug(
      { orderId: params.orderId, status: params.newStatus },
      'No event defined for this status — skipping enqueue'
    );
    return;
  }

  try {
    const queue = getOrderEventsQueue();
    const eventId = randomUUID();
    const payload: OrderStatusChangedEvent = {
      eventId,
      eventType: eventType as OrderStatusChangedEvent['eventType'],
      orderId: params.orderId,
      occurredAt: new Date().toISOString(),
    };

    const opts: JobsOptions = {
      ...JOB_DEFAULT_OPTS,
      jobId: `${eventType.toLowerCase().replace('_', '-')}:${params.orderId}`,
    };

    await queue.add(eventType, payload, opts);
    logger.info({ orderId: params.orderId, eventType, eventId }, 'Order status change job enqueued');
  } catch (err) {
    logger.error(
      { err, orderId: params.orderId, status: params.newStatus },
      'Failed to enqueue order status change job'
    );
  }
}
