import { OrderEventType, ORDER_EVENT_TYPES } from '../queues/queue.constants';

/**
 * Base shape for all order domain events published to BullMQ.
 *
 * eventId   — Stable UUID generated once at enqueueing time. Never changes across retries.
 * eventType — Discriminant for the worker to route processing.
 * orderId   — ID of the affected order.
 * occurredAt — ISO 8601 timestamp of when the domain event occurred.
 */
export interface BaseOrderEvent {
  eventId: string;
  eventType: OrderEventType;
  orderId: string;
  occurredAt: string;
}

export interface OrderCreatedEvent extends BaseOrderEvent {
  eventType: typeof ORDER_EVENT_TYPES.ORDER_CREATED;
  customerId: string;
  orderNumber: string;
  totalAmount: string;
}

export interface OrderCancelledEvent extends BaseOrderEvent {
  eventType: typeof ORDER_EVENT_TYPES.ORDER_CANCELLED;
  customerId: string;
  reason?: string;
}

export interface OrderStatusChangedEvent extends BaseOrderEvent {
  eventType:
    | typeof ORDER_EVENT_TYPES.ORDER_CONFIRMED
    | typeof ORDER_EVENT_TYPES.ORDER_PROCESSING
    | typeof ORDER_EVENT_TYPES.ORDER_SHIPPED
    | typeof ORDER_EVENT_TYPES.ORDER_DELIVERED;
}

/** Union type for all valid job payloads on the order-events queue */
export type OrderEventPayload = OrderCreatedEvent | OrderCancelledEvent | OrderStatusChangedEvent;
