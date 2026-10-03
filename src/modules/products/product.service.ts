import { Prisma } from '@prisma/client';
import {
  ProductRepository,
  productRepository as defaultProductRepo,
  ProductWithCategory,
} from './product.repository';
import {
  CategoryRepository,
  categoryRepository as defaultCategoryRepo,
} from '../categories/category.repository';
import { CreateProductInput, UpdateProductInput, ProductQueryInput } from './product.validation';
import {
  ProductNotFoundError,
  InvalidCategoryError,
  DuplicateSkuError,
  DuplicateProductError,
} from '../../common/errors/app.error';
import { PaginatedResult } from '../../common/types/pagination';
import { withCache } from '../../common/cache/cache.helper';
import { redisService } from '../../infrastructure/redis/redis.service';
import { CACHE_NS } from '../../infrastructure/redis/redis.constants';
import { buildProductDetailKey, buildProductListKey } from '../../common/cache/cache-key.builder';


export interface DeleteProductResult {
  id: string;
  isSoftDeleted: boolean;
  message: string;
}

export class ProductService {
  constructor(
    private readonly repo: ProductRepository = defaultProductRepo,
    private readonly categoryRepo: CategoryRepository = defaultCategoryRepo
  ) {}

  public async createProduct(input: CreateProductInput): Promise<ProductWithCategory> {
    const category = await this.categoryRepo.findById(input.categoryId);
    if (!category) {
      throw new InvalidCategoryError(
        `Invalid category ID "${input.categoryId}": category does not exist`
      );
    }

    const existingSku = await this.repo.findBySku(input.sku);
    if (existingSku) {
      throw new DuplicateSkuError(`Product with SKU "${input.sku}" already exists`);
    }

    const existingSlug = await this.repo.findBySlug(input.slug);
    if (existingSlug) {
      throw new DuplicateProductError(`Product with slug "${input.slug}" already exists`);
    }

    const created = await this.repo.create({
      categoryId: input.categoryId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      sku: input.sku,
      price: input.price,
      isActive: input.isActive,
    });

    // Invalidate product list cache — new product changes list results
    await redisService.delPattern(`${CACHE_NS.PRODUCTS_LIST}:*`);

    return created;
  }

  public async getProductById(id: string): Promise<ProductWithCategory> {
    const cacheKey = buildProductDetailKey(id);
    const product = await withCache(cacheKey, () => this.repo.findById(id));
    if (!product) {
      throw new ProductNotFoundError(`Product with ID "${id}" not found`);
    }
    return product;
  }

  public async listProducts(
    query: ProductQueryInput
  ): Promise<PaginatedResult<ProductWithCategory>> {
    const { page, limit, search, categoryId, minPrice, maxPrice, isActive, sortBy, sortOrder } =
      query;

    const skip = (page - 1) * limit;
    const cacheKey = buildProductListKey({ page, limit, search, categoryId, minPrice, maxPrice, isActive, sortBy, sortOrder });

    return withCache(cacheKey, async () => {
      const [products, total] = await this.repo.findMany({
        skip,
        take: limit,
        search,
        categoryId,
        minPrice,
        maxPrice,
        isActive,
        sortBy,
        sortOrder,
      });

      const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);

      return {
        data: products,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      };
    });
  }

  public async updateProduct(id: string, input: UpdateProductInput): Promise<ProductWithCategory> {
    const product = await this.repo.findById(id);
    if (!product) {
      throw new ProductNotFoundError(`Product with ID "${id}" not found`);
    }

    if (input.categoryId && input.categoryId !== product.categoryId) {
      const category = await this.categoryRepo.findById(input.categoryId);
      if (!category) {
        throw new InvalidCategoryError(
          `Invalid category ID "${input.categoryId}": category does not exist`
        );
      }
    }

    if (input.sku && input.sku !== product.sku) {
      const existingSku = await this.repo.findBySku(input.sku);
      if (existingSku && existingSku.id !== id) {
        throw new DuplicateSkuError(`Product with SKU "${input.sku}" already exists`);
      }
    }

    if (input.slug && input.slug !== product.slug) {
      const existingSlug = await this.repo.findBySlug(input.slug);
      if (existingSlug && existingSlug.id !== id) {
        throw new DuplicateProductError(`Product with slug "${input.slug}" already exists`);
      }
    }

    const updateData: Prisma.ProductUpdateInput = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.slug !== undefined) updateData.slug = input.slug;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.sku !== undefined) updateData.sku = input.sku;
    if (input.price !== undefined) updateData.price = new Prisma.Decimal(input.price);
    if (input.isActive !== undefined) updateData.isActive = input.isActive;
    if (input.categoryId !== undefined) {
      updateData.category = { connect: { id: input.categoryId } };
    }

    const updated = await this.repo.update(id, updateData);

    // Invalidate detail key and all list keys
    await Promise.all([
      redisService.del(buildProductDetailKey(id)),
      redisService.delPattern(`${CACHE_NS.PRODUCTS_LIST}:*`),
    ]);

    return updated;
  }

  public async deleteProduct(id: string): Promise<DeleteProductResult> {
    const product = await this.repo.findById(id);
    if (!product) {
      throw new ProductNotFoundError(`Product with ID "${id}" not found`);
    }

    const orderItemCount = await this.repo.countOrderItems(id);
    const reservationCount = await this.repo.countStockReservations(id);

    if (orderItemCount > 0 || reservationCount > 0) {
      // Historical references exist: soft-delete to preserve data integrity
      await this.repo.softDelete(id);

      // Invalidate cache
      await Promise.all([
        redisService.del(buildProductDetailKey(id)),
        redisService.delPattern(`${CACHE_NS.PRODUCTS_LIST}:*`),
      ]);

      return {
        id,
        isSoftDeleted: true,
        message:
          'Product has historical order or reservation records and was deactivated (soft-deleted) to preserve data integrity',
      };
    }

    // No historical order records: safe to hard delete
    await this.repo.hardDelete(id);

    // Invalidate cache
    await Promise.all([
      redisService.del(buildProductDetailKey(id)),
      redisService.delPattern(`${CACHE_NS.PRODUCTS_LIST}:*`),
    ]);

    return {
      id,
      isSoftDeleted: false,
      message: 'Product deleted successfully',
    };
  }
}

export const productService = new ProductService();
