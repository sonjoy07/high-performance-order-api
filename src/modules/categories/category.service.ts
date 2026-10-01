import { Category } from '@prisma/client';
import {
  CategoryRepository,
  categoryRepository as defaultCategoryRepo,
} from './category.repository';
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  CategoryQueryInput,
} from './category.validation';
import {
  CategoryNotFoundError,
  DuplicateCategoryError,
  CategoryHasProductsError,
} from '../../common/errors/app.error';
import { PaginatedResult } from '../../common/types/pagination';

export class CategoryService {
  constructor(private readonly repo: CategoryRepository = defaultCategoryRepo) {}

  public async createCategory(input: CreateCategoryInput): Promise<Category> {
    const existingByName = await this.repo.findByName(input.name);
    if (existingByName) {
      throw new DuplicateCategoryError(`Category with name "${input.name}" already exists`);
    }

    const existingBySlug = await this.repo.findBySlug(input.slug);
    if (existingBySlug) {
      throw new DuplicateCategoryError(`Category with slug "${input.slug}" already exists`);
    }

    return this.repo.create(input);
  }

  public async getCategoryById(id: string): Promise<Category> {
    const category = await this.repo.findById(id);
    if (!category) {
      throw new CategoryNotFoundError(`Category with ID "${id}" not found`);
    }
    return category;
  }

  public async listCategories(query: CategoryQueryInput): Promise<PaginatedResult<Category>> {
    const { page, limit, search, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const [categories, total] = await this.repo.findMany({
      skip,
      take: limit,
      search,
      sortBy,
      sortOrder,
    });

    const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);

    return {
      data: categories,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  public async updateCategory(id: string, input: UpdateCategoryInput): Promise<Category> {
    const category = await this.repo.findById(id);
    if (!category) {
      throw new CategoryNotFoundError(`Category with ID "${id}" not found`);
    }

    if (input.name && input.name !== category.name) {
      const existingByName = await this.repo.findByName(input.name);
      if (existingByName && existingByName.id !== id) {
        throw new DuplicateCategoryError(`Category with name "${input.name}" already exists`);
      }
    }

    if (input.slug && input.slug !== category.slug) {
      const existingBySlug = await this.repo.findBySlug(input.slug);
      if (existingBySlug && existingBySlug.id !== id) {
        throw new DuplicateCategoryError(`Category with slug "${input.slug}" already exists`);
      }
    }

    return this.repo.update(id, input);
  }

  public async deleteCategory(id: string): Promise<Category> {
    const category = await this.repo.findById(id);
    if (!category) {
      throw new CategoryNotFoundError(`Category with ID "${id}" not found`);
    }

    const productCount = await this.repo.countProducts(id);
    if (productCount > 0) {
      throw new CategoryHasProductsError(
        `Cannot delete category "${category.name}" because it has ${productCount} associated product(s)`
      );
    }

    return this.repo.delete(id);
  }
}

export const categoryService = new CategoryService();
