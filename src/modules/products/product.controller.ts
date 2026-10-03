import { Request, Response, NextFunction } from 'express';
import { ProductService, productService as defaultProductService } from './product.service';
import { CreateProductInput, UpdateProductInput, ProductQueryInput } from './product.validation';

export class ProductController {
  constructor(private readonly service: ProductService = defaultProductService) {}

  public create = async (
    req: Request<unknown, unknown, CreateProductInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const product = await this.service.createProduct(req.body);
      res.status(201).json({
        success: true,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  };

  public getById = async (
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const product = await this.service.getProductById(req.params.id);
      res.status(200).json({
        success: true,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  };

  public list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as ProductQueryInput;
      const result = await this.service.listProducts(query);
      res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  public update = async (
    req: Request<{ id: string }, unknown, UpdateProductInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const product = await this.service.updateProduct(req.params.id, req.body);
      res.status(200).json({
        success: true,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  };

  public delete = async (
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = await this.service.deleteProduct(req.params.id);
      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          id: result.id,
          isSoftDeleted: result.isSoftDeleted,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}

export const productController = new ProductController();
