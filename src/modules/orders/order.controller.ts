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
      const order = await this.orderService.createOrder(req.body);

      res.status(201).json({
        success: true,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const orderController = new OrderController();
