// Queue names used across the application
export const QUEUE_NAMES = {
  ORDER_EVENTS: 'order-events',
} as const;

// Event type strings for order domain events
export const ORDER_EVENT_TYPES = {
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_PROCESSING: 'ORDER_PROCESSING',
  ORDER_SHIPPED: 'ORDER_SHIPPED',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
} as const;

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[keyof typeof ORDER_EVENT_TYPES];

// Job retention config — keep recent jobs for debugging without growing Redis indefinitely
export const JOB_RETENTION = {
  /** Keep up to 100 completed jobs */
  removeOnComplete: { count: 100 },
  /** Keep up to 500 failed jobs for inspection / manual replay */
  removeOnFail: { count: 500 },
} as const;

// Retry strategy: 3 attempts with exponential backoff
export const JOB_DEFAULT_OPTS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000, // 1s → 2s → 4s
  },
  ...JOB_RETENTION,
} as const;

// Worker concurrency — processes up to 5 notification jobs simultaneously
export const WORKER_CONCURRENCY = 5;
