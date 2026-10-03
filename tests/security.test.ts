import request from 'supertest';
import { createApp } from '../src/app';
import { describe, it, expect } from '@jest/globals';

const app = createApp();

describe('Security', () => {
  describe('Security Headers', () => {
    it('should include security headers from Helmet', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBeDefined();
      expect(res.headers['x-frame-options']).toBeDefined();
    });
  });

  describe('CORS', () => {
    it('should handle CORS preflight', async () => {
      const res = await request(app)
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');
      expect([200, 204]).toContain(res.status);
    });
  });
});
