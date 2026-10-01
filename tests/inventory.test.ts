import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';

describe('Inventory APIs (/api/v1/inventory)', () => {
  let testCategoryId: string;
  let testProductId: string;
  let noInventoryProductId: string;
  let concurrencyProductId: string;

  beforeAll(async () => {
    // 1. Create a category for tests
    const category = await prisma.category.create({
      data: {
        name: 'Inventory Test Category',
        slug: 'inventory-test-category',
      },
    });
    testCategoryId = category.id;

    // 2. Create main test product with stock = 100, reserved = 20
    const mainProduct = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Inventory Tracked Item',
        slug: 'inventory-tracked-item',
        sku: 'INV-ITEM-001',
        price: '49.99',
        inventory: {
          create: {
            quantity: 100,
            reservedQuantity: 20,
            version: 1,
          },
        },
      },
    });
    testProductId = mainProduct.id;

    // 3. Create a product without inventory to test INVENTORY_NOT_FOUND
    const productWithoutInv = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Product Without Inventory',
        slug: 'product-without-inventory',
        sku: 'INV-NO-STOCK-002',
        price: '19.99',
      },
    });
    noInventoryProductId = productWithoutInv.id;

    // 4. Create dedicated product for Concurrency Test (Stock = 10, Reserved = 0)
    const concurrencyProduct = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Concurrency Test Item',
        slug: 'concurrency-test-item',
        sku: 'INV-CONCUR-003',
        price: '29.99',
        inventory: {
          create: {
            quantity: 10,
            reservedQuantity: 0,
            version: 1,
          },
        },
      },
    });
    concurrencyProductId = concurrencyProduct.id;
  });

  afterAll(async () => {
    // Clean up test data in reverse dependency order
    const productIds = [testProductId, noInventoryProductId, concurrencyProductId].filter(Boolean);

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

    await prisma.$disconnect();
  });

  describe('GET /api/v1/inventory/:productId', () => {
    it('should return current inventory and computed availableQuantity', async () => {
      const response = await request(app).get(`/api/v1/inventory/${testProductId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        productId: testProductId,
        quantity: 100,
        reservedQuantity: 20,
        availableQuantity: 80, // 100 - 20 = 80
      });
    });

    it('should return 404 PRODUCT_NOT_FOUND when product does not exist', async () => {
      const response = await request(app).get(
        '/api/v1/inventory/00000000-0000-0000-0000-000000000000'
      );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('should return 404 INVENTORY_NOT_FOUND when inventory record is missing for product', async () => {
      const response = await request(app).get(`/api/v1/inventory/${noInventoryProductId}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVENTORY_NOT_FOUND');
    });
  });

  describe('POST /api/v1/inventory/:productId/adjust - STOCK_IN', () => {
    it('should increase stock and record STOCK_IN movement', async () => {
      const response = await request(app).post(`/api/v1/inventory/${testProductId}/adjust`).send({
        quantity: 25,
        type: 'STOCK_IN',
        reason: 'Supplier restock batch #401',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        productId: testProductId,
        quantity: 125, // 100 + 25
        reservedQuantity: 20,
        availableQuantity: 105, // 125 - 20
      });

      // Verify movement ledger entry was created
      const movements = await prisma.inventoryMovement.findMany({
        where: { productId: testProductId, type: 'STOCK_IN' },
      });
      expect(movements.length).toBeGreaterThanOrEqual(1);
      expect(movements[0]?.quantity).toBe(25);
      expect(movements[0]?.referenceId).toBe('Supplier restock batch #401');
    });
  });

  describe('POST /api/v1/inventory/:productId/adjust - STOCK_OUT', () => {
    it('should decrease stock and record STOCK_OUT movement when quantity <= available', async () => {
      const response = await request(app).post(`/api/v1/inventory/${testProductId}/adjust`).send({
        quantity: 15,
        type: 'STOCK_OUT',
        reason: 'Damaged stock write-off',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        productId: testProductId,
        quantity: 110, // 125 - 15
        reservedQuantity: 20,
        availableQuantity: 90, // 110 - 20
      });
    });

    it('should return 409 INSUFFICIENT_STOCK when trying to stock-out more than availableQuantity', async () => {
      // Currently: quantity = 110, reserved = 20, available = 90.
      // Trying to stock out 95 units should be rejected even though physical quantity (110) > 95!
      const response = await request(app).post(`/api/v1/inventory/${testProductId}/adjust`).send({
        quantity: 95,
        type: 'STOCK_OUT',
        reason: 'Bulk removal',
      });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');

      // Verify stock was not deducted
      const inventory = await prisma.inventory.findUnique({
        where: { productId: testProductId },
      });
      expect(inventory?.quantity).toBe(110);
    });
  });

  describe('POST /api/v1/inventory/:productId/adjust - ADJUSTMENT', () => {
    it('should adjust physical stock to target count when target >= reservedQuantity', async () => {
      // Current: quantity = 110, reserved = 20.
      // Setting new physical count to 80.
      const response = await request(app).post(`/api/v1/inventory/${testProductId}/adjust`).send({
        quantity: 80,
        type: 'ADJUSTMENT',
        reason: 'End-of-month cycle count',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        productId: testProductId,
        quantity: 80,
        reservedQuantity: 20,
        availableQuantity: 60,
      });

      // Verify movement recorded
      const movement = await prisma.inventoryMovement.findFirst({
        where: { productId: testProductId, type: 'ADJUSTMENT' },
        orderBy: { createdAt: 'desc' },
      });
      expect(movement).toBeDefined();
      expect(movement?.quantity).toBe(30); // |80 - 110| = 30 delta
    });

    it('should return 409 INVENTORY_BELOW_RESERVED_STOCK when target count < reservedQuantity', async () => {
      // Reserved is 20. Trying to set total physical count to 15.
      const response = await request(app).post(`/api/v1/inventory/${testProductId}/adjust`).send({
        quantity: 15,
        type: 'ADJUSTMENT',
        reason: 'Erroneous count',
      });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVENTORY_BELOW_RESERVED_STOCK');

      // Verify inventory was unchanged
      const inventory = await prisma.inventory.findUnique({
        where: { productId: testProductId },
      });
      expect(inventory?.quantity).toBe(80);
    });
  });

  describe('POST /api/v1/inventory/:productId/adjust - Validation Rules', () => {
    it('should return 400 when quantity is zero or negative', async () => {
      const response = await request(app).post(`/api/v1/inventory/${testProductId}/adjust`).send({
        quantity: 0,
        type: 'STOCK_IN',
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when type is invalid (e.g. RESERVATION)', async () => {
      const response = await request(app).post(`/api/v1/inventory/${testProductId}/adjust`).send({
        quantity: 10,
        type: 'RESERVATION',
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/inventory/:productId/movements', () => {
    it('should return paginated movement history', async () => {
      const response = await request(app)
        .get(`/api/v1/inventory/${testProductId}/movements`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(3);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBeGreaterThanOrEqual(3);
    });

    it('should filter movements by movement type', async () => {
      const response = await request(app)
        .get(`/api/v1/inventory/${testProductId}/movements`)
        .query({ type: 'STOCK_IN' });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      response.body.data.forEach((m: { type: string }) => {
        expect(m.type).toBe('STOCK_IN');
      });
    });

    it('should filter movements by date range', async () => {
      const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
      const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();

      const response = await request(app)
        .get(`/api/v1/inventory/${testProductId}/movements`)
        .query({ from: pastDate, to: futureDate });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Concurrency Safety Test (SELECT ... FOR UPDATE)', () => {
    it('should handle 10 concurrent STOCK_OUT requests of 2 units on initial stock of 10: exactly 5 succeed and 5 fail with INSUFFICIENT_STOCK', async () => {
      // Product concurrencyProductId: initial quantity = 10, reserved = 0
      const initialInv = await prisma.inventory.findUnique({
        where: { productId: concurrencyProductId },
      });
      expect(initialInv?.quantity).toBe(10);

      // Launch 10 concurrent STOCK_OUT requests of 2 units each
      const requests = Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post(`/api/v1/inventory/${concurrencyProductId}/adjust`)
          .send({
            quantity: 2,
            type: 'STOCK_OUT',
            reason: `Concurrent client request #${i + 1}`,
          })
      );

      const responses = await Promise.all(requests);

      const successful = responses.filter((r) => r.status === 200);
      const failed = responses.filter((r) => r.status === 409);

      // Exactly 5 requests can be fulfilled (5 * 2 = 10 units)
      expect(successful.length).toBe(5);
      // Exactly 5 requests must be rejected with INSUFFICIENT_STOCK
      expect(failed.length).toBe(5);

      failed.forEach((res) => {
        expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
      });

      // Verify database state: Stock must be EXACTLY 0, never negative!
      const finalInv = await prisma.inventory.findUnique({
        where: { productId: concurrencyProductId },
      });
      expect(finalInv?.quantity).toBe(0);
      expect(finalInv?.reservedQuantity).toBe(0);

      // Exactly 5 STOCK_OUT movements should be recorded
      const movements = await prisma.inventoryMovement.findMany({
        where: { productId: concurrencyProductId, type: 'STOCK_OUT' },
      });
      expect(movements.length).toBe(5);
    });
  });
});
