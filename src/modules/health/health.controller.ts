import { Request, Response } from 'express';

export class HealthController {
  public static getHealth(_req: Request, res: Response): void {
    res.status(200).json({
      status: 'ok',
      service: 'high-performance-order-api',
    });
  }
}
