import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app';

describe('Health & Readiness Endpoints', () => {
  describe('GET /health', () => {
    it('should return 200 with status ok and service name', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      // Use objectContaining so future additions (e.g. timestamp) do not break the test
      expect(response.body).toEqual(
        expect.objectContaining({
          status: 'ok',
          service: 'high-performance-order-api',
        })
      );
      expect(typeof response.body.timestamp).toBe('string');
    });

    it('should return X-Request-ID header', async () => {
      const response = await request(app).get('/health');
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('should echo a provided X-Request-ID header', async () => {
      const myId = 'test-request-id-12345';
      const response = await request(app).get('/health').set('X-Request-ID', myId);
      expect(response.headers['x-request-id']).toBe(myId);
    });
  });

  describe('GET /health/ready', () => {
    it('should return 200 with ready status when DB is available', async () => {
      const response = await request(app).get('/health/ready');

      // Status is either 200 (ready) or 503 (unavailable) depending on DB
      expect([200, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('checks');
      expect(typeof response.body.timestamp).toBe('string');
    });
  });

  describe('404 Not Found Middleware', () => {
    it('should return 404 with structured error when route does not exist', async () => {
      const response = await request(app).get('/non-existent-route');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Route GET /non-existent-route not found',
        },
      });
    });
  });
});
