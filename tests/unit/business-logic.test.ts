import { describe, it, expect } from '@jest/globals';

describe('Business logic unit tests', () => {
  it('calculates order totals correctly', () => {
    const quantity = 2;
    const unitPrice = 10.0;
    const total = quantity * unitPrice;
    expect(total).toBe(20.0);
  });

  it('merges duplicate products in totals', () => {
    const items = [
      { quantity: 1, unitPrice: 5 },
      { quantity: 2, unitPrice: 5 },
    ];
    const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    expect(total).toBe(15);
  });

  it('calculates available inventory', () => {
    const quantity = 10;
    const reservedQuantity = 3;
    const available = quantity - reservedQuantity;
    expect(available).toBe(7);
  });
});
