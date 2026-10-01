import { Request, Response, NextFunction } from 'express';
import { OrderService, orderService as defaultOrderService } from './order.service';
import { CreateOrderInput } from './order.types';

export class OrderController {
  constructor(private readonly orderService: OrderService = defaultOrderService) {}

  public createOrder = async (
    req: Request<unknown, unknown, CreateOrderInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const idempotencyKey = req.headers['idempotency-key'];
      const result = await this.orderService.createOrder(req.body, idempotencyKey);

      res.status(result.statusCode).json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const orderController = new OrderController();
