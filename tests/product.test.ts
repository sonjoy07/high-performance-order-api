import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { createTestAdmin } from './helpers/auth.helper';

describe('Product APIs (/api/v1/products)', () => {
  let testCategoryId: string;
  let createdProductId: string;
  let adminToken: string;

  beforeAll(async () => {
    const admin = await createTestAdmin();
    adminToken = admin.accessToken;

    // Ensure we have a valid category for testing
    const cat = await prisma.category.findFirst();
    if (cat) {
      testCategoryId = cat.id;
    } else {
      const newCat = await prisma.category.create({
        data: {
          name: 'Test Category For Products',
          slug: 'test-category-for-products',
        },
      });
      testCategoryId = newCat.id;
    }
  });

  afterAll(async () => {
    // Cleanup created test products
    if (createdProductId) {
      await prisma.inventoryMovement.deleteMany({ where: { productId: createdProductId } });
      await prisma.inventory.deleteMany({ where: { productId: createdProductId } });
      await prisma.product.deleteMany({ where: { id: createdProductId } });
    }
    await prisma.product.deleteMany({
      where: { sku: { in: ['TEST-PROD-001', 'TEST-PROD-002', 'TEST-PROD-003'] } },
    });
    await prisma.$disconnect();
  });

  describe('POST /api/v1/products', () => {
    it('should create a new product successfully with inventory record', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId: testCategoryId,
          name: 'Test Wireless Earbuds',
          slug: 'test-wireless-earbuds',
          description: 'True wireless noise cancelling earbuds for test',
          sku: 'TEST-PROD-001',
          price: 99.99,
          isActive: true,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe('Test Wireless Earbuds');
      expect(response.body.data.sku).toBe('TEST-PROD-001');
      expect(response.body.data.category).toBeDefined();
      expect(response.body.data.category.id).toBe(testCategoryId);

      createdProductId = response.body.data.id;

      // Verify linked inventory was initialized
      const inventory = await prisma.inventory.findUnique({
        where: { productId: createdProductId },
      });
      expect(inventory).toBeDefined();
      expect(inventory?.quantity).toBe(0);
    });

    it('should return 400 INVALID_CATEGORY when categoryId does not exist', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId: '00000000-0000-0000-0000-000000000000',
          name: 'Invalid Category Product',
          slug: 'invalid-cat-prod',
          sku: 'TEST-PROD-002',
          price: 49.99,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CATEGORY');
    });

    it('should return 409 DUPLICATE_SKU when SKU already exists', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId: testCategoryId,
          name: 'Duplicate SKU Product',
          slug: 'duplicate-sku-prod',
          sku: 'TEST-PROD-001',
          price: 79.99,
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DUPLICATE_SKU');
    });

    it('should return 409 DUPLICATE_PRODUCT when slug already exists', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId: testCategoryId,
          name: 'Duplicate Slug Product',
          slug: 'test-wireless-earbuds',
          sku: 'TEST-PROD-003',
          price: 79.99,
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DUPLICATE_PRODUCT');
    });

    it('should return 400 VALIDATION_ERROR when price is negative', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId: testCategoryId,
          name: 'Negative Price Product',
          slug: 'negative-price-prod',
          sku: 'TEST-PROD-NEG',
          price: -10,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/products/:id', () => {
    it('should get product by ID including category details', async () => {
      const response = await request(app).get(`/api/v1/products/${createdProductId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(createdProductId);
      expect(response.body.data.category).toBeDefined();
      expect(response.body.data.category.id).toBe(testCategoryId);
    });

    it('should return 404 PRODUCT_NOT_FOUND for non-existent ID', async () => {
      const response = await request(app).get(
        '/api/v1/products/00000000-0000-0000-0000-000000000000'
      );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('GET /api/v1/products', () => {
    it('should list products with pagination metadata', async () => {
      const response = await request(app).get('/api/v1/products').query({ page: 1, limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(5);
      expect(response.body.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('should filter products by search query across name and SKU', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ search: 'TEST-PROD-001' });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].sku).toBe('TEST-PROD-001');
    });

    it('should filter products by minPrice and maxPrice range', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ minPrice: 90, maxPrice: 110 });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      response.body.data.forEach((p: { price: string }) => {
        const numPrice = Number(p.price);
        expect(numPrice).toBeGreaterThanOrEqual(90);
        expect(numPrice).toBeLessThanOrEqual(110);
      });
    });

    it('should sort products by price ascending', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ sortBy: 'price', sortOrder: 'asc', limit: 10 });

      expect(response.status).toBe(200);
      const prices = response.body.data.map((p: { price: string }) => Number(p.price));
      for (let i = 0; i < prices.length - 1; i++) {
        expect(prices[i]!).toBeLessThanOrEqual(prices[i + 1]!);
      }
    });

    it('should sort products by price descending', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ sortBy: 'price', sortOrder: 'desc', limit: 10 });

      expect(response.status).toBe(200);
      const prices = response.body.data.map((p: { price: string }) => Number(p.price));
      for (let i = 0; i < prices.length - 1; i++) {
        expect(prices[i]!).toBeGreaterThanOrEqual(prices[i + 1]!);
      }
    });

    it('should return 400 if minPrice > maxPrice', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ minPrice: 200, maxPrice: 50 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /api/v1/products/:id', () => {
    it('should partially update product price and description', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${createdProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          price: 119.99,
          description: 'Updated description for testing',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Number(response.body.data.price)).toBe(119.99);
      expect(response.body.data.description).toBe('Updated description for testing');
    });

    it('should return 404 for updating non-existent product', async () => {
      const response = await request(app)
        .patch('/api/v1/products/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 100 });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/products/:id', () => {
    it('should delete a product without historical orders', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${createdProductId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(createdProductId);

      // Verify product is removed
      const checkResponse = await request(app).get(`/api/v1/products/${createdProductId}`);
      expect(checkResponse.status).toBe(404);
    });
  });
});
