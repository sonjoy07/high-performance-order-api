import { Request, Response, NextFunction } from 'express';
import { InventoryService, inventoryService as defaultInventoryService } from './inventory.service';
import { AdjustInventoryInput, InventoryMovementQueryInput } from './inventory.validation';

export class InventoryController {
  constructor(private readonly service: InventoryService = defaultInventoryService) {}

  public getByProductId = async (
    req: Request<{ productId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const inventory = await this.service.getInventory(req.params.productId);
      res.status(200).json({
        success: true,
        data: inventory,
      });
    } catch (error) {
      next(error);
    }
  };

  public adjustStock = async (
    req: Request<{ productId: string }, unknown, AdjustInventoryInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const updated = await this.service.adjustStock(req.params.productId, req.body);
      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  };

  public getMovements = async (
    req: Request<{ productId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const query = req.query as unknown as InventoryMovementQueryInput;
      const result = await this.service.getMovements(req.params.productId, query);
      res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const inventoryController = new InventoryController();
