import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import { UserRole } from '@prisma/client';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { generateAccessToken } from '../src/modules/auth/auth.utils';

describe('Order Creation & Stock Reservation APIs (/api/v1/orders)', () => {
  let testCategoryId: string;
  let testCustomerId: string;
  let testUserId: string;
  let customerToken: string;

  let productAId: string;
  let productBId: string;
  let productNoInvId: string;
  let singleStockProductId: string;
  let tenStockProductId: string;

  beforeAll(async () => {
    // 1. Create a customer & user
    const user = await prisma.user.create({
      data: {
        email: `test-order-customer-${Date.now()}@example.com`,
        passwordHash: 'dummyHash123',
        customer: {
          create: {
            firstName: 'OrderTester',
            lastName: 'Customer',
            phone: '+1-555-9999',
          },
        },
      },
      include: { customer: true },
    });
    testUserId = user.id;
    testCustomerId = user.customer!.id;
    customerToken = generateAccessToken(testUserId, UserRole.CUSTOMER);

    // 2. Create Category
    const category = await prisma.category.create({
      data: {
        name: `Order Test Category ${Date.now()}`,
        slug: `order-test-category-${Date.now()}`,
      },
    });
    testCategoryId = category.id;

    // 3. Create Product A (Stock: 50, Reserved: 0, Price: 100.00)
    const productA = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Order Product Alpha',
        slug: `order-product-alpha-${Date.now()}`,
        sku: `ORD-SKU-A-${Date.now()}`,
        price: '100.00',
        inventory: {
          create: {
            quantity: 50,
            reservedQuantity: 0,
            version: 1,
          },
        },
      },
    });
    productAId = productA.id;

    // 4. Create Product B (Stock: 25, Reserved: 5, Price: 50.50) -> Available: 20
    const productB = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Order Product Beta',
        slug: `order-product-beta-${Date.now()}`,
        sku: `ORD-SKU-B-${Date.now()}`,
        price: '50.50',
        inventory: {
          create: {
            quantity: 25,
            reservedQuantity: 5,
            version: 1,
          },
        },
      },
    });
    productBId = productB.id;

    // 5. Create Product with NO inventory record
    const productNoInv = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Order Product No Inv',
        slug: `order-product-no-inv-${Date.now()}`,
        sku: `ORD-SKU-NO-INV-${Date.now()}`,
        price: '20.00',
      },
    });
    productNoInvId = productNoInv.id;

    // 6. Create product with exactly 1 in stock for race condition test
    const singleStockProduct = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Single Stock Product',
        slug: `single-stock-product-${Date.now()}`,
        sku: `ORD-SKU-SINGLE-${Date.now()}`,
        price: '15.00',
        inventory: {
          create: {
            quantity: 1,
            reservedQuantity: 0,
            version: 1,
          },
        },
      },
    });
    singleStockProductId = singleStockProduct.id;

    // 7. Create product with 10 in stock for 10-concurrent-orders test
    const tenStockProduct = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Ten Stock Product',
        slug: `ten-stock-product-${Date.now()}`,
        sku: `ORD-SKU-TEN-${Date.now()}`,
        price: '10.00',
        inventory: {
          create: {
            quantity: 10,
            reservedQuantity: 0,
            version: 1,
          },
        },
      },
    });
    tenStockProductId = tenStockProduct.id;
  });

  afterAll(async () => {
    // Clean up created data
    const productIds = [
      productAId,
      productBId,
      productNoInvId,
      singleStockProductId,
      tenStockProductId,
    ].filter(Boolean);

    await prisma.stockReservation.deleteMany({
      where: { productId: { in: productIds } },
    });
    await prisma.orderItem.deleteMany({
      where: { productId: { in: productIds } },
    });
    await prisma.orderStatusHistory.deleteMany({
      where: { order: { customerId: testCustomerId } },
    });
    await prisma.order.deleteMany({
      where: { customerId: testCustomerId },
    });
    await prisma.idempotencyKey.deleteMany({
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
      await prisma.category.deleteMany({
        where: { id: testCategoryId },
      });
    }
    if (testCustomerId) {
      await prisma.customer.deleteMany({
        where: { id: testCustomerId },
      });
    }
    if (testUserId) {
      await prisma.user.deleteMany({
        where: { id: testUserId },
      });
    }

    await prisma.$disconnect();
  });

  describe('Validation & Precondition Checks', () => {
    it('should reject order with empty items array with 400 VALIDATION_ERROR', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          items: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject order with non-positive quantity with 400 VALIDATION_ERROR', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          items: [{ productId: productAId, quantity: 0 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject order with invalid customerId format with 400 VALIDATION_ERROR if passed', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          customerId: 'not-a-uuid',
          items: [{ productId: productAId, quantity: 1 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 CUSTOMER_NOT_FOUND when user has no linked customer record', async () => {
      const orphanUser = await prisma.user.create({
        data: {
          email: `orphan-order-${Date.now()}@example.com`,
          passwordHash: 'dummyHash123',
          role: UserRole.CUSTOMER,
        },
      });
      const orphanToken = generateAccessToken(orphanUser.id, UserRole.CUSTOMER);

      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${orphanToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          items: [{ productId: productAId, quantity: 1 }],
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('should return 404 PRODUCT_NOT_FOUND when a product does not exist in DB', async () => {
      const nonExistentProductId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          items: [{ productId: nonExistentProductId, quantity: 1 }],
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('should return 404 INVENTORY_NOT_FOUND when product has no inventory record', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          items: [{ productId: productNoInvId, quantity: 1 }],
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVENTORY_NOT_FOUND');
    });
  });

  describe('Duplicate Product Handling', () => {
    it('should merge duplicate product IDs into a single item with summed quantity before transaction', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          items: [
            { productId: productAId, quantity: 2 },
            { productId: productAId, quantity: 3 },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0]).toEqual({
        productId: productAId,
        quantity: 5, // 2 + 3 = 5
        unitPrice: '100.00',
        totalPrice: '500.00', // 5 * 100.00
      });
      expect(response.body.data.totalAmount).toBe('500.00');

      // Verify DB inventory: reservedQuantity should be incremented by 5
      const inv = await prisma.inventory.findUnique({
        where: { productId: productAId },
      });
      expect(inv?.reservedQuantity).toBe(5);
      expect(inv?.quantity).toBe(50); // physical quantity intact
    });
  });

  describe('Order Creation & Stock Reservation Lifecycle', () => {
    it('should create order, reserve stock, and record audit trails for multi-product order', async () => {
      // productA current: qty 50, res 5 (from previous test), available = 45. We request 2.
      // productB current: qty 25, res 5, available = 20. We request 3.
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          items: [
            { productId: productAId, quantity: 2 },
            { productId: productBId, quantity: 3 },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const orderData = response.body.data;
      expect(orderData.id).toBeDefined();
      expect(orderData.orderNumber).toMatch(/^ORD-\d{8}-[A-F0-9]{8}$/);
      expect(orderData.status).toBe('PENDING');

      // Total calculation: (2 * 100.00) + (3 * 50.50) = 200.00 + 151.50 = 351.50
      expect(orderData.totalAmount).toBe('351.50');
      expect(orderData.items).toHaveLength(2);

      // Verify StockReservation records created
      const reservations = await prisma.stockReservation.findMany({
        where: { orderId: orderData.id },
      });
      expect(reservations).toHaveLength(2);
      reservations.forEach((r) => {
        expect(r.status).toBe('ACTIVE');
        expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(Date.now());
      });

      // Verify Inventory Movements created
      const movements = await prisma.inventoryMovement.findMany({
        where: { referenceId: orderData.id, type: 'RESERVATION', referenceType: 'ORDER' },
      });
      expect(movements).toHaveLength(2);

      // Verify OrderStatusHistory record created
      const statusHistory = await prisma.orderStatusHistory.findMany({
        where: { orderId: orderData.id },
      });
      expect(statusHistory).toHaveLength(1);
      expect(statusHistory[0]?.fromStatus).toBeNull();
      expect(statusHistory[0]?.toStatus).toBe('PENDING');
      expect(statusHistory[0]?.reason).toBe('Order created');
    });

    it('should preserve historical unitPrice on OrderItem even if product price subsequently changes', async () => {
      // 1. Create order when product A price is 100.00
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          items: [{ productId: productAId, quantity: 1 }],
        });

      expect(response.status).toBe(201);
      const orderId = response.body.data.id;
      expect(response.body.data.items[0].unitPrice).toBe('100.00');

      // 2. Change product A price in catalog to 199.99
      await prisma.product.update({
        where: { id: productAId },
        data: { price: '199.99' },
      });

      // 3. Inspect existing OrderItem in DB
      const orderItem = await prisma.orderItem.findFirst({
        where: { orderId, productId: productAId },
      });
      expect(orderItem?.unitPrice.toString()).toBe('100');

      // Revert product A price back for consistency
      await prisma.product.update({
        where: { id: productAId },
        data: { price: '100.00' },
      });
    });
  });

  describe('Transaction Rollback on Insufficient Stock', () => {
    it('should rollback entire transaction when any product in order has insufficient stock', async () => {
      // Current available:
      // Product A: quantity = 50, reserved = 8. Available = 42.
      // Product B: quantity = 25, reserved = 8. Available = 17.
      const initialInvA = await prisma.inventory.findUnique({ where: { productId: productAId } });
      const initialInvB = await prisma.inventory.findUnique({ where: { productId: productBId } });

      // Request Product A (2 units - AVAILABLE) and Product B (1000 units - INSUFFICIENT)
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          items: [
            { productId: productAId, quantity: 2 },
            { productId: productBId, quantity: 1000 },
          ],
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(response.body.error.message).toContain('Insufficient stock for product');

      // CRITICAL VERIFICATION: Complete Rollback
      // Product A's reservedQuantity must NOT have increased!
      const afterInvA = await prisma.inventory.findUnique({ where: { productId: productAId } });
      const afterInvB = await prisma.inventory.findUnique({ where: { productId: productBId } });

      expect(afterInvA?.reservedQuantity).toBe(initialInvA?.reservedQuantity);
      expect(afterInvB?.reservedQuantity).toBe(initialInvB?.reservedQuantity);

      // Verify no orphan orders or items were committed
      const recentOrders = await prisma.order.findMany({
        where: {
          customerId: testCustomerId,
          items: { some: { productId: productBId, quantity: 1000 } },
        },
      });
      expect(recentOrders).toHaveLength(0);
    });
  });

  describe('Concurrency & Race Condition Safety (Overselling Prevention)', () => {
    it('should handle 2 concurrent requests competing for the LAST 1 available item: exactly 1 succeeds and 1 fails with INSUFFICIENT_STOCK', async () => {
      // singleStockProductId: Stock = 1, Reserved = 0
      const initialInv = await prisma.inventory.findUnique({
        where: { productId: singleStockProductId },
      });
      expect(initialInv?.quantity).toBe(1);
      expect(initialInv?.reservedQuantity).toBe(0);

      // Send 2 concurrent requests simultaneously for quantity = 1 (different idempotency keys)
      const requests = [
        request(app)
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${customerToken}`)
          .set('Idempotency-Key', crypto.randomUUID())
          .send({
            items: [{ productId: singleStockProductId, quantity: 1 }],
          }),
        request(app)
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${customerToken}`)
          .set('Idempotency-Key', crypto.randomUUID())
          .send({
            items: [{ productId: singleStockProductId, quantity: 1 }],
          }),
      ];

      const [res1, res2] = await Promise.all(requests);
      const statuses = [res1?.status, res2?.status].sort();

      // Exactly one 201 Created and one 409 Conflict
      expect(statuses).toEqual([201, 409]);

      const failedResponse = res1?.status === 409 ? res1 : res2;
      expect(failedResponse?.body.error.code).toBe('INSUFFICIENT_STOCK');

      // Final DB state: Stock = 1, Reserved = 1, Available = 0
      const finalInv = await prisma.inventory.findUnique({
        where: { productId: singleStockProductId },
      });
      expect(finalInv?.quantity).toBe(1);
      expect(finalInv?.reservedQuantity).toBe(1);

      // Only 1 StockReservation must exist for this product
      const reservations = await prisma.stockReservation.findMany({
        where: { productId: singleStockProductId },
      });
      expect(reservations).toHaveLength(1);
    });

    it('should handle 10 concurrent requests of 2 units on initial stock of 10: exactly 5 succeed and 5 fail with INSUFFICIENT_STOCK', async () => {
      // tenStockProductId: Stock = 10, Reserved = 0
      const initialInv = await prisma.inventory.findUnique({
        where: { productId: tenStockProductId },
      });
      expect(initialInv?.quantity).toBe(10);
      expect(initialInv?.reservedQuantity).toBe(0);

      // Send 10 concurrent requests for quantity = 2 (each with its own unique idempotency key)
      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/v1/orders')
          .set('Authorization', `Bearer ${customerToken}`)
          .set('Idempotency-Key', crypto.randomUUID())
          .send({
            items: [{ productId: tenStockProductId, quantity: 2 }],
          })
      );

      const responses = await Promise.all(requests);

      const successful = responses.filter((r) => r.status === 201);
      const failed = responses.filter((r) => r.status === 409);

      // Exactly 5 orders can be fulfilled (5 * 2 = 10)
      expect(successful).toHaveLength(5);
      // Exactly 5 orders must fail with INSUFFICIENT_STOCK
      expect(failed).toHaveLength(5);

      failed.forEach((res) => {
        expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
      });

      // Final DB state: quantity = 10, reservedQuantity = 10, availableQuantity = 0
      const finalInv = await prisma.inventory.findUnique({
        where: { productId: tenStockProductId },
      });
      expect(finalInv?.quantity).toBe(10);
      expect(finalInv?.reservedQuantity).toBe(10);

      // Exactly 5 reservations created
      const reservations = await prisma.stockReservation.findMany({
        where: { productId: tenStockProductId },
      });
      expect(reservations).toHaveLength(5);
    });
  });
});
