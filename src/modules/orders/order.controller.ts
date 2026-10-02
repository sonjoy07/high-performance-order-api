import { Request, Response, NextFunction } from 'express';
import { OrderStatus, UserRole } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { OrderService, orderService as defaultOrderService } from './order.service';
import { CreateOrderItemInput } from './order.types';
import {
  cancelOrderSchema,
  createOrderSchema,
  orderIdParamSchema,
  orderQuerySchema,
  updateOrderStatusSchema,
} from './order.validation';
import { AuthenticationError, CustomerNotFoundError } from '../../common/errors/app.error';

export interface CreateOrderRequestBody {
  items: CreateOrderItemInput[];
  customerId?: string; // Optional in payload, but strictly ignored in favor of authenticated customer
}

export class OrderController {
  constructor(private readonly orderService: OrderService = defaultOrderService) {}

  public createOrder = async (
    req: Request<unknown, unknown, CreateOrderRequestBody>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      // Validate request body
      createOrderSchema.parse(req.body);

      // Derive customer strictly from authenticated user token
      let customer = await prisma.customer.findUnique({
        where: { userId: req.user.id },
      });

      if (!customer) {
        if (req.user.role === UserRole.ADMIN) {
          customer = await prisma.customer.create({
            data: {
              userId: req.user.id,
              firstName: 'Admin',
              lastName: 'User',
            },
          });
        } else {
          throw new CustomerNotFoundError(
            'Authenticated user does not have an associated customer profile'
          );
        }
      }

      const idempotencyKey = req.headers['idempotency-key'];

      // Note: We deliberately use derived customer.id, overriding any client-supplied customerId
      const result = await this.orderService.createOrder(
        {
          customerId: customer.id,
          items: req.body.items,
        },
        idempotencyKey
      );

      res.status(result.statusCode).json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      next(error);
    }
  };

  public listOrders = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      // Re-validate defensively: the route already validated, but the controller is also
      // unit-testable in isolation and must never trust unvalidated query input.
      const query = orderQuerySchema.parse(req.query);

      const result = await this.orderService.listOrders(query, req.user);

      res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  public getOrderById = async (
    req: Request<{ id?: string; orderId?: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const orderId = req.params.orderId ?? req.params.id!;
      orderIdParamSchema.parse({ orderId });

      const order = await this.orderService.getOrderById(orderId, req.user);

      res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };

  public cancelOrder = async (
    req: Request<{ orderId?: string; id?: string }, unknown, { reason?: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const orderId = req.params.orderId ?? req.params.id!;
      orderIdParamSchema.parse({ orderId });
      if (req.body && Object.keys(req.body).length > 0) {
        cancelOrderSchema.parse(req.body);
      }

      const order = await this.orderService.cancelOrder(orderId, req.user, req.body?.reason);

      res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };

  public updateOrderStatus = async (
    req: Request<
      { orderId?: string; id?: string },
      unknown,
      { status: OrderStatus; reason?: string }
    >,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const orderId = req.params.orderId ?? req.params.id!;
      orderIdParamSchema.parse({ orderId });
      updateOrderStatusSchema.parse(req.body);

      const order = await this.orderService.updateOrderStatus(
        orderId,
        req.body.status,
        req.user,
        req.body.reason
      );

      res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };

  public getOrderHistory = async (
    req: Request<{ orderId?: string; id?: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const orderId = req.params.orderId ?? req.params.id!;
      orderIdParamSchema.parse({ orderId });

      const history = await this.orderService.getOrderHistory(orderId, req.user);

      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const orderController = new OrderController();
