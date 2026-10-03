import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { config } from '../src/config/env';
import { createTestAdmin, createTestCustomer } from './helpers/auth.helper';
import { UserRole } from '@prisma/client';

describe('Authentication & Authorization Module (/api/v1/auth)', () => {
  let adminToken: string;
  let customerUser: { id: string; email: string };
  let customerToken: string;
  let customerId: string;
  let otherCustomerToken: string;
  let otherCustomerId: string;

  beforeAll(async () => {
    const admin = await createTestAdmin();
    adminToken = admin.accessToken;

    const customer1 = await createTestCustomer();
    customerUser = customer1.user;
    customerToken = customer1.accessToken;
    customerId = customer1.customer.id;

    const customer2 = await createTestCustomer();
    otherCustomerToken = customer2.accessToken;
    otherCustomerId = customer2.customer.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ========================================================
  // 1. User Registration
  // ========================================================
  describe('POST /api/v1/auth/register', () => {
    it('should successfully register a new customer user and customer profile', async () => {
      const email = `new-user-${Date.now()}@example.com`;
      const response = await request(app).post('/api/v1/auth/register').send({
        email,
        password: 'ValidPassword123!',
        firstName: 'Alice',
        lastName: 'Wonderland',
        phone: '+1-555-7777',
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.id).toBeDefined();
      expect(response.body.data.user.email).toBe(email.toLowerCase());
      expect(response.body.data.user.role).toBe(UserRole.CUSTOMER);
      expect(response.body.data.user).not.toHaveProperty('passwordHash');

      expect(response.body.data.customer).toBeDefined();
      expect(response.body.data.customer.firstName).toBe('Alice');
      expect(response.body.data.customer.lastName).toBe('Wonderland');
      expect(response.body.data.customer.phone).toBe('+1-555-7777');
    });

    it('should default firstName and lastName when omitted from payload', async () => {
      const email = `default-names-${Date.now()}@example.com`;
      const response = await request(app).post('/api/v1/auth/register').send({
        email,
        password: 'ValidPassword123!',
      });

      expect(response.status).toBe(201);
      expect(response.body.data.customer.firstName).toBe('Customer');
      expect(response.body.data.customer.lastName).toBe('User');
    });

    it('should return 409 EMAIL_ALREADY_EXISTS when registering existing email', async () => {
      const email = `dup-${Date.now()}@example.com`;
      // First registration
      await request(app).post('/api/v1/auth/register').send({
        email,
        password: 'ValidPassword123!',
      });

      // Second registration with same email (even with different case)
      const response = await request(app).post('/api/v1/auth/register').send({
        email: email.toUpperCase(),
        password: 'DifferentPassword123!',
      });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('should return 400 validation error for invalid email', async () => {
      const response = await request(app).post('/api/v1/auth/register').send({
        email: 'invalid-email-format',
        password: 'ValidPassword123!',
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 validation error for weak/short password (< 8 chars)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: `valid-${Date.now()}@example.com`,
          password: 'short',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should never allow privilege escalation to ADMIN via public registration', async () => {
      const email = `escalate-${Date.now()}@example.com`;
      const response = await request(app).post('/api/v1/auth/register').send({
        email,
        password: 'ValidPassword123!',
        role: 'ADMIN', // Attacker attempts to pass ADMIN
      });

      expect(response.status).toBe(201);
      expect(response.body.data.user.role).toBe(UserRole.CUSTOMER);

      const dbUser = await prisma.user.findUnique({ where: { email } });
      expect(dbUser?.role).toBe(UserRole.CUSTOMER);
    });
  });

  // ========================================================
  // 2. User Login
  // ========================================================
  describe('POST /api/v1/auth/login', () => {
    const loginEmail = `login-test-${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    beforeAll(async () => {
      await request(app).post('/api/v1/auth/register').send({
        email: loginEmail,
        password,
      });
    });

    it('should successfully log in with valid credentials and return tokens', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: loginEmail,
        password,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data.tokenType).toBe('Bearer');
      expect(response.body.data.expiresIn).toBe(900); // 15m in seconds
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });

    it('should return 401 INVALID_CREDENTIALS for wrong password', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: loginEmail,
        password: 'WrongPassword999!',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should return generic 401 INVALID_CREDENTIALS for unknown email (no email leaking)', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'unknown-non-existent-user@example.com',
        password: 'AnyPassword123!',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  // ========================================================
  // 3. Access Token Verification & Middleware
  // ========================================================
  describe('Authentication Middleware & Access Token Verification', () => {
    it('should allow access to protected endpoint with valid Bearer access token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(customerUser.id);
    });

    it('should return 401 UNAUTHENTICATED when Authorization header is missing', async () => {
      const response = await request(app).get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('should return 401 UNAUTHENTICATED for malformed Authorization header', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Basic 123456');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('should return 401 INVALID_ACCESS_TOKEN for token signed with wrong secret', async () => {
      const fakeToken = jwt.sign(
        { sub: customerUser.id, role: UserRole.CUSTOMER, type: 'access' },
        'wrong-secret-key'
      );

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${fakeToken}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('should return 401 ACCESS_TOKEN_EXPIRED for expired access token', async () => {
      const expiredToken = jwt.sign(
        { sub: customerUser.id, role: UserRole.CUSTOMER, type: 'access' },
        config.JWT_ACCESS_SECRET,
        { expiresIn: '-1s' }
      );

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ACCESS_TOKEN_EXPIRED');
    });

    it('should reject refresh token when presented as an access token', async () => {
      const refreshToken = jwt.sign(
        { sub: customerUser.id, tokenId: 'some-token-id', type: 'refresh' },
        config.JWT_ACCESS_SECRET // even if signed with access secret, type is refresh
      );

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refreshToken}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_ACCESS_TOKEN');
    });
  });

  // ========================================================
  // 4. Refresh Token Rotation & Reuse Protection
  // ========================================================
  describe('POST /api/v1/auth/refresh', () => {
    it('should successfully rotate tokens on valid refresh request', async () => {
      const email = `rot-${Date.now()}@example.com`;
      await request(app).post('/api/v1/auth/register').send({
        email,
        password: 'Password123!',
      });

      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email,
        password: 'Password123!',
      });

      const { refreshToken: originalRefresh } = loginRes.body.data;

      // Refresh
      const refreshRes = await request(app).post('/api/v1/auth/refresh').send({
        refreshToken: originalRefresh,
      });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.data.accessToken).toBeDefined();
      expect(refreshRes.body.data.refreshToken).toBeDefined();
      expect(refreshRes.body.data.refreshToken).not.toBe(originalRefresh);

      // Verify the new access token works
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refreshRes.body.data.accessToken}`);
      expect(meRes.status).toBe(200);

      // Attempt to reuse old rotated refresh token -> must be rejected with REVOKED_REFRESH_TOKEN
      const reuseRes = await request(app).post('/api/v1/auth/refresh').send({
        refreshToken: originalRefresh,
      });

      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body.success).toBe(false);
      expect(reuseRes.body.error.code).toBe('REVOKED_REFRESH_TOKEN');
    });

    it('should return 401 INVALID_REFRESH_TOKEN for malformed or forged refresh token', async () => {
      const forged = jwt.sign(
        { sub: customerUser.id, tokenId: 'fake', type: 'refresh' },
        'wrong-refresh-secret'
      );

      const response = await request(app).post('/api/v1/auth/refresh').send({
        refreshToken: forged,
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should return 401 REFRESH_TOKEN_EXPIRED for expired refresh token', async () => {
      const expiredRefresh = jwt.sign(
        { sub: customerUser.id, tokenId: 'expired-id', type: 'refresh' },
        config.JWT_REFRESH_SECRET,
        { expiresIn: '-1s' }
      );

      const response = await request(app).post('/api/v1/auth/refresh').send({
        refreshToken: expiredRefresh,
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('REFRESH_TOKEN_EXPIRED');
    });
  });

  // ========================================================
  // 5. Logout & Revocation
  // ========================================================
  describe('POST /api/v1/auth/logout', () => {
    it('should successfully log out and prevent subsequent refresh with the revoked token', async () => {
      const email = `logout-user-${Date.now()}@example.com`;
      await request(app).post('/api/v1/auth/register').send({
        email,
        password: 'Password123!',
      });

      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email,
        password: 'Password123!',
      });

      const { accessToken, refreshToken } = loginRes.body.data;

      // Logout
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken });

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);
      expect(logoutRes.body.message).toBe('Logged out successfully');

      // Attempt to refresh using logged out token -> REVOKED_REFRESH_TOKEN
      const refreshRes = await request(app).post('/api/v1/auth/refresh').send({
        refreshToken,
      });

      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body.error.code).toBe('REVOKED_REFRESH_TOKEN');
    });
  });

  // ========================================================
  // 6. Role-Based Access Control (RBAC)
  // ========================================================
  describe('Role-Based Access Control (RBAC)', () => {
    it('should reject CUSTOMER role accessing ADMIN-only endpoint with 403 FORBIDDEN', async () => {
      const response = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          name: 'Forbidden Category',
          slug: `forbidden-cat-${Date.now()}`,
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow ADMIN role to access ADMIN-only endpoint', async () => {
      const response = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Admin Allowed Category ${Date.now()}`,
          slug: `admin-cat-${Date.now()}`,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  // ========================================================
  // 7. Customer Ownership Protection (IDOR Prevention)
  // ========================================================
  describe('Order Ownership Protection & IDOR Prevention', () => {
    let orderAId: string;
    let testProductId: string;

    beforeAll(async () => {
      // Create category & product for order creation
      const category = await prisma.category.create({
        data: {
          name: `Ownership Cat ${Date.now()}`,
          slug: `ownership-cat-${Date.now()}`,
        },
      });

      const product = await prisma.product.create({
        data: {
          categoryId: category.id,
          name: 'Ownership Product',
          slug: `ownership-prod-${Date.now()}`,
          sku: `OWN-SKU-${Date.now()}`,
          price: '50.00',
          inventory: {
            create: {
              quantity: 20,
              reservedQuantity: 0,
            },
          },
        },
      });
      testProductId = product.id;

      // Create an order for Customer 1
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', `idem-ownership-${Date.now()}`)
        .send({
          items: [{ productId: testProductId, quantity: 1 }],
        });

      expect(orderRes.status).toBe(201);
      orderAId = orderRes.body.data.id;
    });

    it('should allow Customer A to access their own order', async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${orderAId}`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(orderAId);
    });

    it('should forbid Customer B from accessing Customer A order with 403 ORDER_ACCESS_DENIED', async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${orderAId}`)
        .set('Authorization', `Bearer ${otherCustomerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ORDER_ACCESS_DENIED');
    });

    it('should allow ADMIN to access Customer A order', async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${orderAId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(orderAId);
    });

    it('should return 404 ORDER_NOT_FOUND for non-existent order ID', async () => {
      const response = await request(app)
        .get('/api/v1/orders/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
    });
  });

  // ========================================================
  // 8. Order Creation Security & Idempotency Scoping
  // ========================================================
  describe('Order Creation Security & Idempotency Scoping', () => {
    let orderProductId: string;

    beforeAll(async () => {
      const category = await prisma.category.create({
        data: {
          name: `Sec Cat ${Date.now()}`,
          slug: `sec-cat-${Date.now()}`,
        },
      });

      const product = await prisma.product.create({
        data: {
          categoryId: category.id,
          name: 'Security Test Product',
          slug: `sec-prod-${Date.now()}`,
          sku: `SEC-SKU-${Date.now()}`,
          price: '75.00',
          inventory: {
            create: {
              quantity: 100,
              reservedQuantity: 0,
            },
          },
        },
      });
      orderProductId = product.id;
    });

    it('should derive customer identity from JWT and ignore any client-supplied customerId', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', `secure-order-${Date.now()}`)
        .send({
          customerId: otherCustomerId, // Attacker customer attempts to bill or create order as another customer
          items: [{ productId: orderProductId, quantity: 2 }],
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      // Verify in DB that the order belongs to the authenticated customer, NOT otherCustomerId!
      const dbOrder = await prisma.order.findUnique({
        where: { id: response.body.data.id },
      });
      expect(dbOrder?.customerId).toBe(customerId);
      expect(dbOrder?.customerId).not.toBe(otherCustomerId);
    });

    it('should isolate idempotency keys between different customers', async () => {
      const sharedKey = `shared-idem-key-${Date.now()}`;

      // Customer 1 creates order with sharedKey
      const res1 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', sharedKey)
        .send({
          items: [{ productId: orderProductId, quantity: 1 }],
        });
      expect(res1.status).toBe(201);

      // Customer 2 creates order with same sharedKey -> should create an independent order for Customer 2
      const res2 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .set('Idempotency-Key', sharedKey)
        .send({
          items: [{ productId: orderProductId, quantity: 1 }],
        });
      expect(res2.status).toBe(201);

      // The two orders must be distinct
      expect(res1.body.data.id).not.toBe(res2.body.data.id);
    });
  });

  // ========================================================
  // 9. Complete End-to-End Auth Lifecycle Integration
  // ========================================================
  describe('Full End-to-End Authentication Flow', () => {
    it('should execute complete register -> login -> me -> protected -> refresh -> logout flow', async () => {
      const e2eEmail = `e2e-user-${Date.now()}@example.com`;
      const e2ePassword = 'LifecyclePassword123!';

      // 1. Register
      const regRes = await request(app).post('/api/v1/auth/register').send({
        email: e2eEmail,
        password: e2ePassword,
        firstName: 'Lifecycle',
        lastName: 'Tester',
      });
      expect(regRes.status).toBe(201);

      // 2. Login
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: e2eEmail,
        password: e2ePassword,
      });
      expect(loginRes.status).toBe(200);
      const { accessToken: initialAccess, refreshToken: initialRefresh } = loginRes.body.data;

      // 3. GET /auth/me
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${initialAccess}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.email).toBe(e2eEmail.toLowerCase());
      expect(meRes.body.data.customer.firstName).toBe('Lifecycle');

      // 4. Refresh token
      const refreshRes = await request(app).post('/api/v1/auth/refresh').send({
        refreshToken: initialRefresh,
      });
      expect(refreshRes.status).toBe(200);
      const { accessToken: newAccess, refreshToken: newRefresh } = refreshRes.body.data;
      expect(newAccess).toBeDefined();
      expect(newRefresh).not.toBe(initialRefresh);

      // 5. Old refresh token cannot be reused
      const oldRefreshRes = await request(app).post('/api/v1/auth/refresh').send({
        refreshToken: initialRefresh,
      });
      expect(oldRefreshRes.status).toBe(401);
      expect(oldRefreshRes.body.error.code).toBe('REVOKED_REFRESH_TOKEN');

      // 6. Access protected route with new access token
      const newMeRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newAccess}`);
      expect(newMeRes.status).toBe(200);

      // 7. Logout
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${newAccess}`)
        .send({ refreshToken: newRefresh });
      expect(logoutRes.status).toBe(200);

      // 8. New refresh token is now revoked
      const afterLogoutRefresh = await request(app).post('/api/v1/auth/refresh').send({
        refreshToken: newRefresh,
      });
      expect(afterLogoutRefresh.status).toBe(401);
      expect(afterLogoutRefresh.body.error.code).toBe('REVOKED_REFRESH_TOKEN');
    });
  });
});
