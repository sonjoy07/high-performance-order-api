import { InventoryMovement, InventoryMovementType } from '@prisma/client';
import {
  InventoryRepository,
  inventoryRepository as defaultInventoryRepo,
} from './inventory.repository';
import {
  ProductRepository,
  productRepository as defaultProductRepo,
} from '../products/product.repository';
import { AdjustInventoryInput, InventoryMovementQueryInput } from './inventory.validation';
import {
  ProductNotFoundError,
  InventoryNotFoundError,
  InsufficientStockError,
  InventoryBelowReservedStockError,
} from '../../common/errors/app.error';
import { PaginatedResult } from '../../common/types/pagination';

export interface InventoryView {
  productId: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
}

export class InventoryService {
  constructor(
    private readonly repo: InventoryRepository = defaultInventoryRepo,
    private readonly productRepo: ProductRepository = defaultProductRepo
  ) {}

  public async getInventory(productId: string): Promise<InventoryView> {
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new ProductNotFoundError(`Product with ID "${productId}" not found`);
    }

    const inventory = await this.repo.findByProductId(productId);
    if (!inventory) {
      throw new InventoryNotFoundError(`Inventory record not found for product "${productId}"`);
    }

    const availableQuantity = inventory.quantity - inventory.reservedQuantity;

    return {
      productId: inventory.productId,
      quantity: inventory.quantity,
      reservedQuantity: inventory.reservedQuantity,
      availableQuantity,
    };
  }

  public async adjustStock(productId: string, input: AdjustInventoryInput): Promise<InventoryView> {
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new ProductNotFoundError(`Product with ID "${productId}" not found`);
    }

    const existingInventory = await this.repo.findByProductId(productId);
    if (!existingInventory) {
      throw new InventoryNotFoundError(`Inventory record not found for product "${productId}"`);
    }

    const updated = await this.repo.executeLockedAdjustment(productId, (current) => {
      const availableQuantity = current.quantity - current.reservedQuantity;
      let newQuantity: number;
      let movementQuantity: number;
      let movementType: InventoryMovementType;

      switch (input.type) {
        case 'STOCK_IN': {
          newQuantity = current.quantity + input.quantity;
          movementQuantity = input.quantity;
          movementType = InventoryMovementType.STOCK_IN;
          break;
        }

        case 'STOCK_OUT': {
          // Rule: Manual stock out cannot consume reserved stock and cannot exceed available stock
          if (input.quantity > availableQuantity) {
            throw new InsufficientStockError(
              `Insufficient available stock for product "${productId}". Available: ${availableQuantity}, Requested: ${input.quantity}`
            );
          }
          newQuantity = current.quantity - input.quantity;
          movementQuantity = input.quantity;
          movementType = InventoryMovementType.STOCK_OUT;
          break;
        }

        case 'ADJUSTMENT': {
          // Rule: Absolute stock adjustment must never fall below currently active reserved quantity
          newQuantity = input.quantity;
          if (newQuantity < current.reservedQuantity) {
            throw new InventoryBelowReservedStockError(
              `Cannot adjust inventory for product "${productId}" to ${newQuantity} because ${current.reservedQuantity} units are currently reserved`
            );
          }
          movementQuantity = Math.abs(newQuantity - current.quantity);
          movementType = InventoryMovementType.ADJUSTMENT;
          break;
        }
      }

      return {
        newQuantity,
        movementQuantity,
        movementType,
        reason: input.reason,
      };
    });

    return {
      productId: updated.productId,
      quantity: updated.quantity,
      reservedQuantity: updated.reservedQuantity,
      availableQuantity: updated.quantity - updated.reservedQuantity,
    };
  }

  public async getMovements(
    productId: string,
    query: InventoryMovementQueryInput
  ): Promise<PaginatedResult<InventoryMovement>> {
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new ProductNotFoundError(`Product with ID "${productId}" not found`);
    }

    const { page, limit, type, from, to } = query;
    const skip = (page - 1) * limit;

    const [movements, total] = await this.repo.findMovements({
      productId,
      skip,
      take: limit,
      type: type as InventoryMovementType | undefined,
      from,
      to,
    });

    const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);

    return {
      data: movements,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }
}

export const inventoryService = new InventoryService();
