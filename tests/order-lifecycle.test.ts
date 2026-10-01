import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import { OrderStatus, ReservationStatus, UserRole, InventoryMovementType } from '@prisma/client';
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { generateAccessToken } from '../src/modules/auth/auth.utils';
import {
  canTransitionOrderStatus,
  isCancellableStatus,
  ALLOWED_STATUS_TRANSITIONS,
} from '../src/modules/orders/order.validation';
import { orderRepository } from '../src/modules/orders/order.repository';

describe('Phase 8: Order Cancellation & Status Management', () => {
  // Test Entities
  let customerAUserId: string;
  let customerACustomerId: string;
  let customerAToken: string;

  let customerBUserId: string;
  let customerBCustomerId: string;
  let customerBToken: string;

  let adminUserId: string;
  let adminToken: string;

  let testCategoryId: string;
  let product1Id: string;
  let product2Id: string;
  const createdProductIds: string[] = [];

  // Helper to create an order directly for testing
  const createTestOrder = async (
    customerId: string,
    items: { productId: string; quantity: number; price: string }[],
    status: OrderStatus = OrderStatus.PENDING
  ) => {
    const orderNumber = `ORD-TEST-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    let totalAmount = 0;
    const orderItemsData = items.map((item) => {
      const lineTotal = Number(item.price) * item.quantity;
      totalAmount += lineTotal;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: lineTotal.toFixed(2),
      };
    });

    const order = await prisma.order.create({
      data: {
        customerId,
        orderNumber,
        status,
        totalAmount: totalAmount.toFixed(2),
        items: {
          create: orderItemsData,
        },
      },
      include: { items: true },
    });

    // If PENDING or CONFIRMED, create active stock reservations and reserve inventory
    if (status === OrderStatus.PENDING || status === OrderStatus.CONFIRMED) {
      for (const item of items) {
        await prisma.stockReservation.create({
          data: {
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            status: ReservationStatus.ACTIVE,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        });

        await prisma.inventory.update({
          where: { productId: item.productId },
          data: {
            reservedQuantity: { increment: item.quantity },
          },
        });

        await prisma.inventoryMovement.create({
          data: {
            productId: item.productId,
            type: InventoryMovementType.RESERVATION,
            quantity: item.quantity,
            referenceType: 'ORDER',
            referenceId: order.id,
          },
        });
      }

      await prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: status,
          changedBy: null,
          reason: 'Initial test order creation',
        },
      });
    }

    return order;
  };

  beforeAll(async () => {
    // 1. Create Customer A
    const userA = await prisma.user.create({
      data: {
        email: `customerA-${Date.now()}@example.com`,
        passwordHash: 'dummyHashA',
        role: UserRole.CUSTOMER,
        customer: {
          create: {
            firstName: 'Alice',
            lastName: 'Customer',
            phone: '+1-555-0101',
          },
        },
      },
      include: { customer: true },
    });
    customerAUserId = userA.id;
    customerACustomerId = userA.customer!.id;
    customerAToken = generateAccessToken(customerAUserId, UserRole.CUSTOMER);

    // 2. Create Customer B
    const userB = await prisma.user.create({
      data: {
        email: `customerB-${Date.now()}@example.com`,
        passwordHash: 'dummyHashB',
        role: UserRole.CUSTOMER,
        customer: {
          create: {
            firstName: 'Bob',
            lastName: 'Customer',
            phone: '+1-555-0102',
          },
        },
      },
      include: { customer: true },
    });
    customerBUserId = userB.id;
    customerBCustomerId = userB.customer!.id;
    customerBToken = generateAccessToken(customerBUserId, UserRole.CUSTOMER);

    // 3. Create Admin User
    const adminUser = await prisma.user.create({
      data: {
        email: `admin-${Date.now()}@example.com`,
        passwordHash: 'dummyHashAdmin',
        role: UserRole.ADMIN,
      },
    });
    adminUserId = adminUser.id;
    adminToken = generateAccessToken(adminUserId, UserRole.ADMIN);

    // 4. Create Category
    const category = await prisma.category.create({
      data: {
        name: `Lifecycle Category ${Date.now()}`,
        slug: `lifecycle-category-${Date.now()}`,
      },
    });
    testCategoryId = category.id;

    // 5. Create Product 1 (Stock: 100, Reserved: 0)
    const product1 = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Lifecycle Product 1',
        slug: `lifecycle-prod-1-${Date.now()}`,
        sku: `LC-SKU-1-${Date.now()}`,
        price: '40.00',
        inventory: {
          create: {
            quantity: 100,
            reservedQuantity: 0,
            version: 1,
          },
        },
      },
    });
    product1Id = product1.id;
    createdProductIds.push(product1Id);

    // 6. Create Product 2 (Stock: 50, Reserved: 0)
    const product2 = await prisma.product.create({
      data: {
        categoryId: testCategoryId,
        name: 'Lifecycle Product 2',
        slug: `lifecycle-prod-2-${Date.now()}`,
        sku: `LC-SKU-2-${Date.now()}`,
        price: '60.00',
        inventory: {
          create: {
            quantity: 50,
            reservedQuantity: 0,
            version: 1,
          },
        },
      },
    });
    product2Id = product2.id;
    createdProductIds.push(product2Id);
  });

  afterAll(async () => {
    // Clean up created test data
    if (createdProductIds.length > 0) {
      await prisma.stockReservation.deleteMany({
        where: { productId: { in: createdProductIds } },
      });
      await prisma.orderItem.deleteMany({
        where: { productId: { in: createdProductIds } },
      });
      await prisma.orderStatusHistory.deleteMany({
        where: {
          order: {
            customerId: { in: [customerACustomerId, customerBCustomerId].filter(Boolean) },
          },
        },
      });
      await prisma.order.deleteMany({
        where: { customerId: { in: [customerACustomerId, customerBCustomerId].filter(Boolean) } },
      });
      await prisma.inventoryMovement.deleteMany({
        where: { productId: { in: createdProductIds } },
      });
      await prisma.inventory.deleteMany({
        where: { productId: { in: createdProductIds } },
      });
      await prisma.product.deleteMany({
        where: { id: { in: createdProductIds } },
      });
    }

    if (testCategoryId) {
      await prisma.category.deleteMany({ where: { id: testCategoryId } });
    }

    await prisma.customer.deleteMany({
      where: { id: { in: [customerACustomerId, customerBCustomerId].filter(Boolean) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [customerAUserId, customerBUserId, adminUserId].filter(Boolean) } },
    });

    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. Unit Tests for State Machine & Rules
  // =========================================================================
  describe('1. State Transition Matrix & Policy Unit Tests', () => {
    it('should validate all legal order status transitions', () => {
      expect(canTransitionOrderStatus(OrderStatus.PENDING, OrderStatus.CONFIRMED)).toBe(true);
      expect(canTransitionOrderStatus(OrderStatus.PENDING, OrderStatus.CANCELLED)).toBe(true);
      expect(canTransitionOrderStatus(OrderStatus.CONFIRMED, OrderStatus.PROCESSING)).toBe(true);
      expect(canTransitionOrderStatus(OrderStatus.CONFIRMED, OrderStatus.CANCELLED)).toBe(true);
      expect(canTransitionOrderStatus(OrderStatus.PROCESSING, OrderStatus.SHIPPED)).toBe(true);
      expect(canTransitionOrderStatus(OrderStatus.SHIPPED, OrderStatus.DELIVERED)).toBe(true);
    });

    it('should reject all illegal order status transitions', () => {
      // Direct jump violations
      expect(canTransitionOrderStatus(OrderStatus.PENDING, OrderStatus.SHIPPED)).toBe(false);
      expect(canTransitionOrderStatus(OrderStatus.PENDING, OrderStatus.DELIVERED)).toBe(false);
      expect(canTransitionOrderStatus(OrderStatus.CONFIRMED, OrderStatus.SHIPPED)).toBe(false);
      expect(canTransitionOrderStatus(OrderStatus.CONFIRMED, OrderStatus.DELIVERED)).toBe(false);

      // Ineligible cancellations
      expect(canTransitionOrderStatus(OrderStatus.PROCESSING, OrderStatus.CANCELLED)).toBe(false);
      expect(canTransitionOrderStatus(OrderStatus.SHIPPED, OrderStatus.CANCELLED)).toBe(false);
      expect(canTransitionOrderStatus(OrderStatus.DELIVERED, OrderStatus.CANCELLED)).toBe(false);

      // Terminal state modifications
      expect(canTransitionOrderStatus(OrderStatus.CANCELLED, OrderStatus.PENDING)).toBe(false);
      expect(canTransitionOrderStatus(OrderStatus.CANCELLED, OrderStatus.CONFIRMED)).toBe(false);
      expect(canTransitionOrderStatus(OrderStatus.DELIVERED, OrderStatus.PROCESSING)).toBe(false);
      expect(canTransitionOrderStatus(OrderStatus.DELIVERED, OrderStatus.SHIPPED)).toBe(false);
    });

    it('should correctly classify cancellable vs non-cancellable statuses', () => {
      expect(isCancellableStatus(OrderStatus.PENDING)).toBe(true);
      expect(isCancellableStatus(OrderStatus.CONFIRMED)).toBe(true);
      expect(isCancellableStatus(OrderStatus.PROCESSING)).toBe(false);
      expect(isCancellableStatus(OrderStatus.SHIPPED)).toBe(false);
      expect(isCancellableStatus(OrderStatus.DELIVERED)).toBe(false);
      expect(isCancellableStatus(OrderStatus.CANCELLED)).toBe(false);
    });

    it('should define terminal states with empty transition targets', () => {
      expect(ALLOWED_STATUS_TRANSITIONS[OrderStatus.DELIVERED]).toEqual([]);
      expect(ALLOWED_STATUS_TRANSITIONS[OrderStatus.CANCELLED]).toEqual([]);
    });
  });

  // =========================================================================
  // 2. Customer Order Cancellation
  // =========================================================================
  describe('2. POST /api/v1/orders/:orderId/cancel (Cancellation Flow)', () => {
    it('should successfully cancel customer own PENDING order and release stock', async () => {
      // Initial inventory
      const invBefore = await prisma.inventory.findUnique({ where: { productId: product1Id } });
      const initialReserved = invBefore!.reservedQuantity;

      // Create a PENDING order with 2 units of product 1
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 2, price: '40.00' },
      ]);

      const invAfterCreate = await prisma.inventory.findUnique({
        where: { productId: product1Id },
      });
      expect(invAfterCreate!.reservedQuantity).toBe(initialReserved + 2);

      // Cancel the order as Customer A
      const res = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ reason: 'Customer changed mind' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(order.id);
      expect(res.body.data.status).toBe(OrderStatus.CANCELLED);

      // Verify DB State:
      // 1. Order status is CANCELLED
      const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
      expect(updatedOrder!.status).toBe(OrderStatus.CANCELLED);

      // 2. Inventory reservedQuantity decremented by 2, physical quantity UNCHANGED
      const invAfterCancel = await prisma.inventory.findUnique({
        where: { productId: product1Id },
      });
      expect(invAfterCancel!.reservedQuantity).toBe(initialReserved);
      expect(invAfterCancel!.quantity).toBe(invBefore!.quantity);

      // 3. StockReservation transitioned to RELEASED with releasedAt timestamp
      const reservations = await prisma.stockReservation.findMany({
        where: { orderId: order.id },
      });
      expect(reservations.length).toBe(1);
      expect(reservations[0]!.status).toBe(ReservationStatus.RELEASED);
      expect(reservations[0]!.releasedAt).not.toBeNull();

      // 4. InventoryMovement of type RELEASE was logged
      const releaseMovements = await prisma.inventoryMovement.findMany({
        where: {
          productId: product1Id,
          type: InventoryMovementType.RELEASE,
          referenceId: order.id,
        },
      });
      expect(releaseMovements.length).toBe(1);
      expect(releaseMovements[0]!.quantity).toBe(2);
      expect(releaseMovements[0]!.referenceType).toBe('ORDER');

      // 5. OrderStatusHistory logged
      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.id },
        orderBy: { changedAt: 'asc' },
      });
      expect(history.length).toBe(2);
      const cancelEntry = history[1]!;
      expect(cancelEntry.fromStatus).toBe(OrderStatus.PENDING);
      expect(cancelEntry.toStatus).toBe(OrderStatus.CANCELLED);
      expect(cancelEntry.changedBy).toBe(customerAUserId);
      expect(cancelEntry.reason).toBe('Customer changed mind');
    });

    it('should successfully cancel customer own CONFIRMED order', async () => {
      const order = await createTestOrder(
        customerACustomerId,
        [{ productId: product2Id, quantity: 1, price: '60.00' }],
        OrderStatus.CONFIRMED
      );

      const res = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(OrderStatus.CANCELLED);

      // Verify status history
      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.id, toStatus: OrderStatus.CANCELLED },
      });
      expect(history.length).toBe(1);
      expect(history[0]!.fromStatus).toBe(OrderStatus.CONFIRMED);
    });

    it('should forbid Customer B from cancelling Customer A order (IDOR protection)', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 1, price: '40.00' },
      ]);

      const res = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ reason: 'Malicious cancellation attempt' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ORDER_ACCESS_DENIED');

      // Verify order is still PENDING
      const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
      expect(dbOrder!.status).toBe(OrderStatus.PENDING);
    });

    it('should allow Admin to cancel any customer order', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 1, price: '40.00' },
      ]);

      const res = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Admin operational cancellation' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(OrderStatus.CANCELLED);

      // Verify history recorded admin user ID
      const history = await prisma.orderStatusHistory.findFirst({
        where: { orderId: order.id, toStatus: OrderStatus.CANCELLED },
      });
      expect(history?.changedBy).toBe(adminUserId);
    });

    it('should return 404 ORDER_NOT_FOUND when cancelling a non-existent order', async () => {
      const nonExistentOrderId = '00000000-0000-0000-0000-000000000000';

      const res = await request(app)
        .post(`/api/v1/orders/${nonExistentOrderId}/cancel`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('should reject cancellation if order is in PROCESSING, SHIPPED, or DELIVERED status', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 1, price: '40.00' },
      ]);

      // Move order to PROCESSING
      await prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PROCESSING },
      });

      const res = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send();

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ORDER_CANCELLATION_NOT_ALLOWED');
    });

    it('should safely reject repeated cancellation on an already CANCELLED order (Idempotency)', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 1, price: '40.00' },
      ]);

      // First cancel succeeds
      const res1 = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send();
      expect(res1.status).toBe(200);

      const invAfterFirstCancel = await prisma.inventory.findUnique({
        where: { productId: product1Id },
      });

      // Second cancel on the same order must fail safely with 409 ORDER_ALREADY_CANCELLED
      const res2 = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send();

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('ORDER_ALREADY_CANCELLED');

      // Verify reservedQuantity was NOT decremented again
      const invAfterSecondCancel = await prisma.inventory.findUnique({
        where: { productId: product1Id },
      });
      expect(invAfterSecondCancel!.reservedQuantity).toBe(invAfterFirstCancel!.reservedQuantity);

      // Verify no duplicate RELEASE movements
      const releaseMovements = await prisma.inventoryMovement.findMany({
        where: { referenceId: order.id, type: InventoryMovementType.RELEASE },
      });
      expect(releaseMovements.length).toBe(1);
    });
  });

  // =========================================================================
  // 3. Admin Order Status Update API
  // =========================================================================
  describe('3. PATCH /api/v1/orders/:orderId/status (Status Management)', () => {
    it('should forbid customer users from updating order status', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 1, price: '40.00' },
      ]);

      const res = await request(app)
        .patch(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ status: OrderStatus.CONFIRMED });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow Admin to progress order through complete valid lifecycle', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 1, price: '40.00' },
      ]);

      // 1. PENDING -> CONFIRMED
      const res1 = await request(app)
        .patch(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.CONFIRMED, reason: 'Payment confirmed' });
      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe(OrderStatus.CONFIRMED);

      // 2. CONFIRMED -> PROCESSING
      const res2 = await request(app)
        .patch(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.PROCESSING, reason: 'Order sent to fulfillment' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe(OrderStatus.PROCESSING);

      // 3. PROCESSING -> SHIPPED
      const res3 = await request(app)
        .patch(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.SHIPPED, reason: 'Dispatched via carrier' });
      expect(res3.status).toBe(200);
      expect(res3.body.data.status).toBe(OrderStatus.SHIPPED);

      // 4. SHIPPED -> DELIVERED
      const res4 = await request(app)
        .patch(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.DELIVERED, reason: 'Delivered to recipient' });
      expect(res4.status).toBe(200);
      expect(res4.body.data.status).toBe(OrderStatus.DELIVERED);

      // Verify complete history in DB
      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.id },
        orderBy: { changedAt: 'asc' },
      });
      // Initial + 4 transitions = 5 records
      expect(history.length).toBe(5);
      expect(history[1]!.toStatus).toBe(OrderStatus.CONFIRMED);
      expect(history[2]!.toStatus).toBe(OrderStatus.PROCESSING);
      expect(history[3]!.toStatus).toBe(OrderStatus.SHIPPED);
      expect(history[4]!.toStatus).toBe(OrderStatus.DELIVERED);
    });

    it('should reject invalid status transitions with 422 ORDER_STATUS_TRANSITION_NOT_ALLOWED', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 1, price: '40.00' },
      ]);

      // Direct jump: PENDING -> SHIPPED is illegal
      const res = await request(app)
        .patch(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.SHIPPED });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ORDER_STATUS_TRANSITION_NOT_ALLOWED');
    });

    it('should execute full cancellation workflow when Admin updates status to CANCELLED', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 3, price: '40.00' },
      ]);

      const res = await request(app)
        .patch(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.CANCELLED, reason: 'Admin cancelled order' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(OrderStatus.CANCELLED);

      // Verify stock reservation released
      const reservation = await prisma.stockReservation.findFirst({
        where: { orderId: order.id },
      });
      expect(reservation?.status).toBe(ReservationStatus.RELEASED);

      // Verify RELEASE movement created
      const movement = await prisma.inventoryMovement.findFirst({
        where: { referenceId: order.id, type: InventoryMovementType.RELEASE },
      });
      expect(movement?.quantity).toBe(3);
    });
  });

  // =========================================================================
  // 4. Order History API
  // =========================================================================
  describe('4. GET /api/v1/orders/:orderId/history (Audit Trail)', () => {
    it('should allow customer to view chronological status history of their own order', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 1, price: '40.00' },
      ]);

      // Transition to CONFIRMED
      await request(app)
        .patch(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.CONFIRMED, reason: 'Admin verified' });

      const res = await request(app)
        .get(`/api/v1/orders/${order.id}/history`)
        .set('Authorization', `Bearer ${customerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);

      const [entry1, entry2] = res.body.data;
      expect(entry1.fromStatus).toBeNull();
      expect(entry1.toStatus).toBe(OrderStatus.PENDING);
      expect(entry1.createdAt).toBeDefined();

      expect(entry2.fromStatus).toBe(OrderStatus.PENDING);
      expect(entry2.toStatus).toBe(OrderStatus.CONFIRMED);
      expect(entry2.changedBy).toBe(adminUserId);
      expect(entry2.reason).toBe('Admin verified');
    });

    it('should forbid customer from viewing another customer order history', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 1, price: '40.00' },
      ]);

      const res = await request(app)
        .get(`/api/v1/orders/${order.id}/history`)
        .set('Authorization', `Bearer ${customerBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORDER_ACCESS_DENIED');
    });

    it('should allow Admin to view any customer order history', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 1, price: '40.00' },
      ]);

      const res = await request(app)
        .get(`/api/v1/orders/${order.id}/history`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 5. Transaction Rollback Reliability Test
  // =========================================================================
  describe('5. Transaction Rollback Reliability Test', () => {
    it('should completely roll back all changes if an error occurs mid-cancellation', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 2, price: '40.00' },
      ]);

      const invBefore = await prisma.inventory.findUnique({ where: { productId: product1Id } });
      const reservedBefore = invBefore!.reservedQuantity;

      // Force an error at the final step inside the transaction: createStatusHistory
      const originalCreateStatusHistory = orderRepository.createStatusHistory;
      jest.spyOn(orderRepository, 'createStatusHistory').mockImplementationOnce(async () => {
        throw new Error('SIMULATED_TRANSACTION_FAILURE');
      });

      try {
        const res = await request(app)
          .post(`/api/v1/orders/${order.id}/cancel`)
          .set('Authorization', `Bearer ${customerAToken}`)
          .send();

        expect(res.status).toBe(500);
      } finally {
        // Restore repository implementation
        orderRepository.createStatusHistory = originalCreateStatusHistory;
      }

      // Verify atomicity & complete rollback:
      // 1. Order status is UNCHANGED (still PENDING)
      const orderAfterRollback = await prisma.order.findUnique({ where: { id: order.id } });
      expect(orderAfterRollback!.status).toBe(OrderStatus.PENDING);

      // 2. Inventory reservedQuantity is UNCHANGED
      const invAfterRollback = await prisma.inventory.findUnique({
        where: { productId: product1Id },
      });
      expect(invAfterRollback!.reservedQuantity).toBe(reservedBefore);

      // 3. StockReservation is still ACTIVE
      const reservations = await prisma.stockReservation.findMany({
        where: { orderId: order.id },
      });
      expect(reservations[0]!.status).toBe(ReservationStatus.ACTIVE);
      expect(reservations[0]!.releasedAt).toBeNull();

      // 4. No RELEASE movement was persisted
      const releaseMovements = await prisma.inventoryMovement.findMany({
        where: { referenceId: order.id, type: InventoryMovementType.RELEASE },
      });
      expect(releaseMovements.length).toBe(0);

      // 5. No CANCELLED history record exists
      const cancelHistory = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.id, toStatus: OrderStatus.CANCELLED },
      });
      expect(cancelHistory.length).toBe(0);
    });
  });

  // =========================================================================
  // 6. Concurrency Tests (Real PostgreSQL Integration)
  // =========================================================================
  describe('6. Concurrency Tests (PostgreSQL Row-Level Locking)', () => {
    it('should handle 2 concurrent cancellation requests on the same order with exactly 1 success', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 2, price: '40.00' },
        { productId: product2Id, quantity: 1, price: '60.00' },
      ]);

      const inv1Before = await prisma.inventory.findUnique({ where: { productId: product1Id } });
      const inv2Before = await prisma.inventory.findUnique({ where: { productId: product2Id } });

      // Fire 2 concurrent cancellation requests simultaneously
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/v1/orders/${order.id}/cancel`)
          .set('Authorization', `Bearer ${customerAToken}`)
          .send({ reason: 'Concurrent cancel 1' }),
        request(app)
          .post(`/api/v1/orders/${order.id}/cancel`)
          .set('Authorization', `Bearer ${customerAToken}`)
          .send({ reason: 'Concurrent cancel 2' }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one succeeds (200), exactly one is rejected as already cancelled (409)
      expect(statuses).toEqual([200, 409]);

      // Verify stock was released exactly once (decremented by 2 and 1)
      const inv1After = await prisma.inventory.findUnique({ where: { productId: product1Id } });
      const inv2After = await prisma.inventory.findUnique({ where: { productId: product2Id } });

      expect(inv1After!.reservedQuantity).toBe(inv1Before!.reservedQuantity - 2);
      expect(inv2After!.reservedQuantity).toBe(inv2Before!.reservedQuantity - 1);

      // Exactly 1 RELEASE movement per product
      const movements1 = await prisma.inventoryMovement.findMany({
        where: {
          productId: product1Id,
          referenceId: order.id,
          type: InventoryMovementType.RELEASE,
        },
      });
      expect(movements1.length).toBe(1);

      const movements2 = await prisma.inventoryMovement.findMany({
        where: {
          productId: product2Id,
          referenceId: order.id,
          type: InventoryMovementType.RELEASE,
        },
      });
      expect(movements2.length).toBe(1);

      // Exactly 1 CANCELLED transition history record
      const cancelHistory = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.id, toStatus: OrderStatus.CANCELLED },
      });
      expect(cancelHistory.length).toBe(1);
    });

    it('should safely handle concurrent Cancel vs Confirm requests without corruption', async () => {
      const order = await createTestOrder(customerACustomerId, [
        { productId: product1Id, quantity: 2, price: '40.00' },
      ]);

      // Fire Cancel and Confirm concurrently
      const [cancelRes, confirmRes] = await Promise.all([
        request(app)
          .post(`/api/v1/orders/${order.id}/cancel`)
          .set('Authorization', `Bearer ${customerAToken}`)
          .send({ reason: 'Race cancellation' }),
        request(app)
          .patch(`/api/v1/orders/${order.id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: OrderStatus.CONFIRMED, reason: 'Race confirmation' }),
      ]);

      // One of two valid outcomes must have happened deterministically:
      // Case A: Cancel won first -> Cancel is 200, Confirm gets 422 ORDER_STATUS_TRANSITION_NOT_ALLOWED
      // Case B: Confirm won first -> Confirm is 200, Cancel then executed on CONFIRMED order -> Cancel is 200 (order ends CANCELLED)
      if (cancelRes.status === 200 && confirmRes.status === 422) {
        expect(confirmRes.body.error.code).toBe('ORDER_STATUS_TRANSITION_NOT_ALLOWED');
        const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
        expect(dbOrder!.status).toBe(OrderStatus.CANCELLED);
      } else {
        expect(confirmRes.status).toBe(200);
        expect(cancelRes.status).toBe(200);
        const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
        expect(dbOrder!.status).toBe(OrderStatus.CANCELLED);
      }

      // In either outcome, the final database state must be fully consistent:
      // Stock reservation must be RELEASED
      const reservation = await prisma.stockReservation.findFirst({
        where: { orderId: order.id },
      });
      expect(reservation?.status).toBe(ReservationStatus.RELEASED);

      // Order status is CANCELLED
      const finalOrder = await prisma.order.findUnique({ where: { id: order.id } });
      expect(finalOrder?.status).toBe(OrderStatus.CANCELLED);
    });
  });
});
