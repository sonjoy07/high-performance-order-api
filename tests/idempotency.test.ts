import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';

describe('Idempotent Order Creation APIs (POST /api/v1/orders)', () => {
  let testCategoryId: string;
  let testCustomerId: string;
  let testUserId: string;

  let productAId: string;
  let productBId: string;
  let limitedStockProductId: string;

  beforeAll(async () => {
    // 1. Create User and Customer
    const user = await prisma.user.create({
      data: {
        email: `idempotency-customer-${Date.now()}@example.com`,
        passwordHash: 'dummyHash123',
        customer: {
          create: {
            firstName: 'Idempotent',
            lastName: 'Customer',
            phone: '+1-555-8888',
          },
        },
      },
      include: { customer: true },
    });
    testUserId = user.id;
    testCustomerId = user.customer!.id;

    // 2. Create Category
    const category = await prisma.category.create({
      data: {
        name: `Idempotency Test Category ${Date.now()}`,
        slug: `idempotency-test-category-${Date.now()}`,
      },
    });
    testCategoryId = category.id;

    // 3. Create Product A (Stock: 100, Reserved: 0, Price: 80.00)
    const productA = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Idempotency Product Alpha',
        slug: `idemp-prod-alpha-${Date.now()}`,
        sku: `IDEMP-SKU-A-${Date.now()}`,
        price: '80.00',
        inventory: {
          create: {
            quantity: 100,
            reservedQuantity: 0,
            version: 1,
          },
        },
      },
    });
    productAId = productA.id;

    // 4. Create Product B (Stock: 50, Reserved: 0, Price: 45.00)
    const productB = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Idempotency Product Beta',
        slug: `idemp-prod-beta-${Date.now()}`,
        sku: `IDEMP-SKU-B-${Date.now()}`,
        price: '45.00',
        inventory: {
          create: {
            quantity: 50,
            reservedQuantity: 0,
            version: 1,
          },
        },
      },
    });
    productBId = productB.id;

    // 5. Create Product for Combined Concurrency Test (Stock: 5, Reserved: 0, Price: 25.00)
    const limitedStockProd = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Limited Stock Competition Item',
        slug: `limited-stock-comp-${Date.now()}`,
        sku: `IDEMP-SKU-LIMIT-${Date.now()}`,
        price: '25.00',
        inventory: {
          create: {
            quantity: 5,
            reservedQuantity: 0,
            version: 1,
          },
        },
      },
    });
    limitedStockProductId = limitedStockProd.id;
  });

  afterAll(async () => {
    const productIds = [productAId, productBId, limitedStockProductId].filter(Boolean);

    await prisma.stockReservation.deleteMany({
      where: { productId: { in: productIds } },
    });
    await prisma.idempotencyKey.deleteMany({
      where: { customerId: testCustomerId },
    });
    await prisma.orderStatusHistory.deleteMany({
      where: { order: { customerId: testCustomerId } },
    });
    await prisma.orderItem.deleteMany({
      where: { productId: { in: productIds } },
    });
    await prisma.order.deleteMany({
      where: { customerId: testCustomerId },
    });
    await prisma.inventoryMovement.deleteMany({
      where: { productId: { in: productIds } },
    });
    await prisma.inventory.deleteMany({
      where: { productId: { in: productIds } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: productIds } },
    });
    if (testCategoryId) {
      await prisma.category.deleteMany({ where: { id: testCategoryId } });
    }
    if (testCustomerId) {
      await prisma.customer.deleteMany({ where: { id: testCustomerId } });
    }
    if (testUserId) {
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }

    await prisma.$disconnect();
  });

  describe('Header Validation Rules', () => {
    it('should return 400 IDEMPOTENCY_KEY_REQUIRED when header is omitted', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .send({
          customerId: testCustomerId,
          items: [{ productId: productAId, quantity: 1 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect(response.body.error.message).toBe('Idempotency-Key header is required');
    });

    it('should return 400 IDEMPOTENCY_KEY_REQUIRED when header is empty or only whitespace', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Idempotency-Key', '   ')
        .send({
          customerId: testCustomerId,
          items: [{ productId: productAId, quantity: 1 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('should return 400 INVALID_IDEMPOTENCY_KEY when header exceeds 255 characters', async () => {
      const longKey = 'k'.repeat(256);
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Idempotency-Key', longKey)
        .send({
          customerId: testCustomerId,
          items: [{ productId: productAId, quantity: 1 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
    });
  });

  describe('Exact Replay (Same Key + Same Payload)', () => {
    it('should return original order response on replay without creating duplicate order or reservation', async () => {
      const idempotencyKey = `idemp-key-${Date.now()}`;
      const payload = {
        customerId: testCustomerId,
        items: [{ productId: productAId, quantity: 2 }],
      };

      // 1. Initial request
      const firstResponse = await request(app)
        .post('/api/v1/orders')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(firstResponse.status).toBe(201);
      expect(firstResponse.body.success).toBe(true);
      const initialData = firstResponse.body.data;
      expect(initialData.id).toBeDefined();

      // 2. Retry with exact same key and exact same payload
      const secondResponse = await request(app)
        .post('/api/v1/orders')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(secondResponse.status).toBe(201);
      expect(secondResponse.body.success).toBe(true);
      expect(secondResponse.body.data).toEqual(initialData);

      // Verify DB: Only ONE order was created
      const orders = await prisma.order.findMany({
        where: { id: initialData.id },
      });
      expect(orders).toHaveLength(1);

      // Verify DB: Exactly ONE set of stock reservations exists for this order
      const reservations = await prisma.stockReservation.findMany({
        where: { orderId: initialData.id },
      });
      expect(reservations).toHaveLength(1);
      expect(reservations[0]?.quantity).toBe(2);

      // Verify DB: Reserved stock is exactly 2, not 4
      const inv = await prisma.inventory.findUnique({
        where: { productId: productAId },
      });
      expect(inv?.reservedQuantity).toBe(2);
    });

    it('should return original order response when payload order items are semantically equivalent but in different order', async () => {
      const idempotencyKey = `idemp-canonical-${Date.now()}`;

      // First order: Product A then Product B
      const res1 = await request(app)
        .post('/api/v1/orders')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          customerId: testCustomerId,
          items: [
            { productId: productAId, quantity: 1 },
            { productId: productBId, quantity: 2 },
          ],
        });

      expect(res1.status).toBe(201);
      const firstOrderId = res1.body.data.id;

      // Second order with SAME key: Product B then Product A (different input ordering)
      const res2 = await request(app)
        .post('/api/v1/orders')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          customerId: testCustomerId,
          items: [
            { productId: productBId, quantity: 2 },
            { productId: productAId, quantity: 1 },
          ],
        });

      expect(res2.status).toBe(201);
      expect(res2.body.data.id).toBe(firstOrderId);
    });
  });

  describe('Key Reuse with Different Payload (409 Conflict)', () => {
    it('should return 409 IDEMPOTENCY_KEY_REUSED when same key is used with a different quantity', async () => {
      const idempotencyKey = `idemp-reuse-test-${Date.now()}`;

      // First request: quantity = 2
      const firstRes = await request(app)
        .post('/api/v1/orders')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          customerId: testCustomerId,
          items: [{ productId: productAId, quantity: 2 }],
        });

      expect(firstRes.status).toBe(201);

      // Second request with SAME key: quantity = 5
      const secondRes = await request(app)
        .post('/api/v1/orders')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          customerId: testCustomerId,
          items: [{ productId: productAId, quantity: 5 }],
        });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.success).toBe(false);
      expect(secondRes.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(secondRes.body.error.message).toContain(
        'The idempotency key was already used with a different request'
      );
    });
  });

  describe('Failed Request Recovery (No Poisoned Keys)', () => {
    it('should rollback idempotency record if order fails and allow subsequent retry with same key', async () => {
      const idempotencyKey = `idemp-failed-order-${Date.now()}`;

      // 1. Initial attempt fails due to insufficient stock (asking for 1000 units)
      const failRes = await request(app)
        .post('/api/v1/orders')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          customerId: testCustomerId,
          items: [{ productId: productBId, quantity: 1000 }],
        });

      expect(failRes.status).toBe(409);
      expect(failRes.body.error.code).toBe('INSUFFICIENT_STOCK');

      // Verify that no IdempotencyKey row was permanently committed
      const storedKey = await prisma.idempotencyKey.findUnique({
        where: { customerId_key: { customerId: testCustomerId, key: idempotencyKey } },
      });
      expect(storedKey).toBeNull();

      // 2. Client retries with the SAME key but with an affordable quantity (1 unit)
      const successRes = await request(app)
        .post('/api/v1/orders')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          customerId: testCustomerId,
          items: [{ productId: productBId, quantity: 1 }],
        });

      expect(successRes.status).toBe(201);
      expect(successRes.body.success).toBe(true);

      // Verify idempotency record is now committed with response data
      const finalStoredKey = await prisma.idempotencyKey.findUnique({
        where: { customerId_key: { customerId: testCustomerId, key: idempotencyKey } },
      });
      expect(finalStoredKey).toBeDefined();
      expect(finalStoredKey?.responseStatus).toBe(201);
    });
  });

  describe('Concurrent Duplicate Requests (Race Condition Safety)', () => {
    it('should handle 10 concurrent requests with the SAME key and payload: exactly 1 order created, all 10 return identical response', async () => {
      const sharedKey = `shared-concurrent-key-${Date.now()}`;
      const payload = {
        customerId: testCustomerId,
        items: [{ productId: productAId, quantity: 2 }],
      };

      // Initial reserved quantity
      const initialInv = await prisma.inventory.findUnique({
        where: { productId: productAId },
      });
      const initialReserved = initialInv?.reservedQuantity ?? 0;

      // Launch 10 simultaneous requests
      const requests = Array.from({ length: 10 }, () =>
        request(app).post('/api/v1/orders').set('Idempotency-Key', sharedKey).send(payload)
      );

      const responses = await Promise.all(requests);

      // All 10 responses must return 201 Created
      responses.forEach((res) => {
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
      });

      // All 10 responses must return the EXACT same order ID and orderNumber
      const firstOrderId = responses[0]?.body.data.id;
      const firstOrderNumber = responses[0]?.body.data.orderNumber;

      responses.forEach((res) => {
        expect(res.body.data.id).toBe(firstOrderId);
        expect(res.body.data.orderNumber).toBe(firstOrderNumber);
      });

      // Verify in DB: Exactly ONE order was created
      const orders = await prisma.order.findMany({
        where: { id: firstOrderId },
      });
      expect(orders).toHaveLength(1);

      // Verify in DB: Reserved stock increased by ONLY 2 units (not 20!)
      const finalInv = await prisma.inventory.findUnique({
        where: { productId: productAId },
      });
      expect(finalInv?.reservedQuantity).toBe(initialReserved + 2);
    });
  });

  describe('Combined Concurrency Scenario (Different Keys Competing for Limited Stock)', () => {
    it('should correctly combine idempotency and row-level stock locking when different keys compete for stock', async () => {
      // limitedStockProductId has stock = 5, reserved = 0
      const initialInv = await prisma.inventory.findUnique({
        where: { productId: limitedStockProductId },
      });
      expect(initialInv?.quantity).toBe(5);
      expect(initialInv?.reservedQuantity).toBe(0);

      // Request A with key-A requests 5 units
      // Request B with key-B requests 5 units
      const keyA = `comp-key-A-${Date.now()}`;
      const keyB = `comp-key-B-${Date.now()}`;

      const requests = [
        request(app)
          .post('/api/v1/orders')
          .set('Idempotency-Key', keyA)
          .send({
            customerId: testCustomerId,
            items: [{ productId: limitedStockProductId, quantity: 5 }],
          }),
        request(app)
          .post('/api/v1/orders')
          .set('Idempotency-Key', keyB)
          .send({
            customerId: testCustomerId,
            items: [{ productId: limitedStockProductId, quantity: 5 }],
          }),
      ];

      const [res1, res2] = await Promise.all(requests);
      const statuses = [res1?.status, res2?.status].sort();

      // Exactly one succeeds (201) and one fails with 409 INSUFFICIENT_STOCK
      expect(statuses).toEqual([201, 409]);

      // Database verification: Exactly 1 order created, reserved = 5, available = 0
      const finalInv = await prisma.inventory.findUnique({
        where: { productId: limitedStockProductId },
      });
      expect(finalInv?.quantity).toBe(5);
      expect(finalInv?.reservedQuantity).toBe(5);
    });
  });
});
