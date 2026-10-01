import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { createTestAdmin } from './helpers/auth.helper';

describe('Category APIs (/api/v1/categories)', () => {
  let createdCategoryId: string;
  let categoryWithProductsId: string;
  let adminToken: string;

  beforeAll(async () => {
    const admin = await createTestAdmin();
    adminToken = admin.accessToken;

    // Find or create a category that has products for the restriction test
    const cat = await prisma.category.findFirst({
      where: { products: { some: {} } },
    });
    if (cat) {
      categoryWithProductsId = cat.id;
    }
  });

  afterAll(async () => {
    // Cleanup any lingering test categories
    await prisma.category.deleteMany({
      where: { slug: { in: ['test-gadgets', 'test-gadgets-updated', 'unique-test-cat'] } },
    });
    await prisma.$disconnect();
  });

  describe('POST /api/v1/categories', () => {
    it('should create a new category successfully', async () => {
      const response = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Test Gadgets',
          slug: 'test-gadgets',
          description: 'Category for testing gadgets',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe('Test Gadgets');
      expect(response.body.data.slug).toBe('test-gadgets');

      createdCategoryId = response.body.data.id;
    });

    it('should return 400 validation error if name is too short', async () => {
      const response = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'A',
          slug: 'valid-slug',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 validation error if slug is not URL-friendly', async () => {
      const response = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Valid Name',
          slug: 'Invalid Slug With Spaces!',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 conflict when category name already exists', async () => {
      const response = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Test Gadgets',
          slug: 'completely-different-slug',
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DUPLICATE_CATEGORY');
    });

    it('should return 409 conflict when category slug already exists', async () => {
      const response = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Completely Different Name',
          slug: 'test-gadgets',
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DUPLICATE_CATEGORY');
    });
  });

  describe('GET /api/v1/categories', () => {
    it('should return paginated category list', async () => {
      const response = await request(app).get('/api/v1/categories').query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(10);
    });

    it('should filter categories by search term', async () => {
      const response = await request(app).get('/api/v1/categories').query({ search: 'Gadgets' });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data[0].name).toContain('Gadgets');
    });

    it('should return 400 if limit exceeds maximum allowed (100)', async () => {
      const response = await request(app).get('/api/v1/categories').query({ limit: 150 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/categories/:id', () => {
    it('should get a category by ID', async () => {
      const response = await request(app).get(`/api/v1/categories/${createdCategoryId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(createdCategoryId);
    });

    it('should return 404 CATEGORY_NOT_FOUND for non-existent ID', async () => {
      const response = await request(app).get(
        '/api/v1/categories/00000000-0000-0000-0000-000000000000'
      );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/categories/:id', () => {
    it('should partially update category name and slug', async () => {
      const response = await request(app)
        .patch(`/api/v1/categories/${createdCategoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Test Gadgets Updated',
          slug: 'test-gadgets-updated',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Test Gadgets Updated');
      expect(response.body.data.slug).toBe('test-gadgets-updated');
    });

    it('should return 400 if body is empty', async () => {
      const response = await request(app)
        .patch(`/api/v1/categories/${createdCategoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /api/v1/categories/:id', () => {
    it('should return 409 CATEGORY_HAS_PRODUCTS when deleting category with products', async () => {
      if (!categoryWithProductsId) return;

      const response = await request(app)
        .delete(`/api/v1/categories/${categoryWithProductsId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CATEGORY_HAS_PRODUCTS');
    });

    it('should delete a category with no products successfully', async () => {
      const response = await request(app)
        .delete(`/api/v1/categories/${createdCategoryId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(createdCategoryId);

      // Verify it is gone
      const verifyResponse = await request(app).get(`/api/v1/categories/${createdCategoryId}`);
      expect(verifyResponse.status).toBe(404);
    });
  });
});
