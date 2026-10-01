import { Request, Response, NextFunction } from 'express';
import { CategoryService, categoryService as defaultCategoryService } from './category.service';
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  CategoryQueryInput,
} from './category.validation';

export class CategoryController {
  constructor(private readonly service: CategoryService = defaultCategoryService) {}

  public create = async (
    req: Request<unknown, unknown, CreateCategoryInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const category = await this.service.createCategory(req.body);
      res.status(201).json({
        success: true,
        data: category,
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
      const category = await this.service.getCategoryById(req.params.id);
      res.status(200).json({
        success: true,
        data: category,
      });
    } catch (error) {
      next(error);
    }
  };

  public list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as CategoryQueryInput;
      const result = await this.service.listCategories(query);
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
    req: Request<{ id: string }, unknown, UpdateCategoryInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const category = await this.service.updateCategory(req.params.id, req.body);
      res.status(200).json({
        success: true,
        data: category,
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
      const deletedCategory = await this.service.deleteCategory(req.params.id);
      res.status(200).json({
        success: true,
        message: 'Category deleted successfully',
        data: { id: deletedCategory.id },
      });
    } catch (error) {
      next(error);
    }
  };
}

export const categoryController = new CategoryController();
