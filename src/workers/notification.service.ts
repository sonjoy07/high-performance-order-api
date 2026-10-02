import { logger } from '../../common/logger/logger';
import { OrderEventPayload } from '../../jobs/order.jobs';
import { ORDER_EVENT_TYPES } from '../../queues/queue.constants';

/**
 * NotificationProvider interface.
 * Implement this interface to plug in a real email/SMS/push provider in future.
 */
export interface NotificationProvider {
  sendOrderNotification(event: OrderEventPayload): Promise<void>;
}

/**
 * LogNotificationProvider — production-ready stub that logs simulated notifications.
 *
 * Replace this with a real email/SMS provider (e.g. SendGrid, Twilio) when required.
 * The interface contract ensures a clean swap without changing the worker.
 */
export class LogNotificationProvider implements NotificationProvider {
  async sendOrderNotification(event: OrderEventPayload): Promise<void> {
    switch (event.eventType) {
      case ORDER_EVENT_TYPES.ORDER_CREATED:
        logger.info(
          {
            eventId: event.eventId,
            eventType: event.eventType,
            orderId: event.orderId,
            customerId: event.customerId,
            orderNumber: event.orderNumber,
            totalAmount: event.totalAmount,
          },
          '[Notification] Order created — email confirmation would be sent to customer'
        );
        break;

      case ORDER_EVENT_TYPES.ORDER_CANCELLED:
        logger.info(
          {
            eventId: event.eventId,
            eventType: event.eventType,
            orderId: event.orderId,
            customerId: event.customerId,
            reason: event.reason,
          },
          '[Notification] Order cancelled — cancellation confirmation would be sent to customer'
        );
        break;

      case ORDER_EVENT_TYPES.ORDER_CONFIRMED:
      case ORDER_EVENT_TYPES.ORDER_PROCESSING:
      case ORDER_EVENT_TYPES.ORDER_SHIPPED:
      case ORDER_EVENT_TYPES.ORDER_DELIVERED:
        logger.info(
          {
            eventId: event.eventId,
            eventType: event.eventType,
            orderId: event.orderId,
          },
          `[Notification] Order status changed to ${event.eventType} — status update notification would be sent`
        );
        break;

      default: {
        const _exhaustive: never = event;
        logger.warn(
          { event: _exhaustive },
          '[Notification] Unknown event type — no notification sent'
        );
      }
    }

    // Simulate async provider latency (remove in production)
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * NotificationService — orchestrates event routing to the registered provider.
 * Validates payload before dispatching.
 */
export class NotificationService {
  constructor(private readonly provider: NotificationProvider = new LogNotificationProvider()) {}

  async processOrderEvent(event: OrderEventPayload): Promise<void> {
    if (!event.eventId || !event.eventType || !event.orderId) {
      throw new Error(
        `Invalid order event payload: missing required fields. Got: ${JSON.stringify(event)}`
      );
    }

    logger.debug(
      { eventId: event.eventId, eventType: event.eventType, orderId: event.orderId },
      'NotificationService: processing order event'
    );

    await this.provider.sendOrderNotification(event);
  }
}

export const notificationService = new NotificationService();
