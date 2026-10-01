import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/app';

describe('Health & Error Handling Middleware', () => {
  describe('GET /health', () => {
    it('should return 200 with status ok and service name', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        service: 'high-performance-order-api',
      });
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
