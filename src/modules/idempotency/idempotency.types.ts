export interface CanonicalOrderPayload {
  customerId: string;
  items: {
    productId: string;
    quantity: number;
  }[];
}

export interface IdempotencyResult<T> {
  isExisting: boolean;
  statusCode: number;
  data: T;
}
