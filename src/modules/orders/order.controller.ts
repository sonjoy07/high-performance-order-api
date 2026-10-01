import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { OrderService, orderService as defaultOrderService } from './order.service';
import { CreateOrderItemInput } from './order.types';
import { createOrderSchema } from './order.validation';
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

  public getOrderById = async (
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const order = await this.orderService.getOrderById(req.params.id, req.user);

      res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const orderController = new OrderController();
