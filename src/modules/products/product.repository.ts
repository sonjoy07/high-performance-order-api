import { Prisma, Product } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { buildStableOrderBy } from '../../common/utils/sorting';
import { toDecimalFilter } from '../../common/validation/query.validation';

export interface FindProductsParams {
  skip: number;
  take: number;
  search?: string;
  categoryId?: string;
  minPrice?: string;
  maxPrice?: string;
  isActive?: boolean;
  sortBy: 'name' | 'price' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}

export type ProductWithCategory = Product & {
  category: {
    id: string;
    name: string;
    slug: string;
  };
};

/**
 * Explicit projection for product reads.
 *
 * Using `select` instead of `include` guarantees that any column added to the `Product`
 * model later (internal flags, denormalized counters, audit columns) is *not* silently
 * shipped to clients, and keeps the `EXPLAIN` output stable across schema evolution.
 */
export const PRODUCT_SELECT = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  description: true,
  sku: true,
  price: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
} satisfies Prisma.ProductSelect;

export class ProductRepository {
  public async create(data: {
    categoryId: string;
    name: string;
    slug: string;
    description?: string | null;
    sku: string;
    price: number;
    isActive: boolean;
  }): Promise<ProductWithCategory> {
    return prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          categoryId: data.categoryId,
          name: data.name,
          slug: data.slug,
          description: data.description ?? null,
          sku: data.sku,
          price: new Prisma.Decimal(data.price),
          isActive: data.isActive,
          inventory: {
            create: {
              quantity: 0,
              reservedQuantity: 0,
              version: 1,
            },
          },
        },
        include: {
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      });

      return product;
    });
  }

  public async findById(id: string): Promise<ProductWithCategory | null> {
    return prisma.product.findUnique({
      where: { id },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  public async findByIds(
    ids: string[],
    tx?: Prisma.TransactionClient
  ): Promise<ProductWithCategory[]> {
    const client = tx ?? prisma;
    return client.product.findMany({
      where: {
        id: { in: ids },
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  public async findBySku(sku: string): Promise<Product | null> {
    return prisma.product.findUnique({
      where: { sku },
    });
  }

  public async findBySlug(slug: string): Promise<Product | null> {
    return prisma.product.findUnique({
      where: { slug },
    });
  }

  /**
   * Builds the SQL-equivalent `WHERE` clause for the product catalogue.
   *
   * Search uses case-insensitive `ILIKE '%term%'`, which a plain B-tree cannot serve —
   * the accompanying `pg_trgm` GIN indexes make it index-backed. The predicate is built
   * once and shared by the page query and the `count` query so the two can never disagree.
   */
  public buildProductWhere(params: FindProductsParams): Prisma.ProductWhereInput {
    const andConditions: Prisma.ProductWhereInput[] = [];

    if (params.categoryId) {
      andConditions.push({ categoryId: params.categoryId });
    }

    if (params.isActive !== undefined) {
      andConditions.push({ isActive: params.isActive });
    }

    const priceFilter = toDecimalFilter({ min: params.minPrice, max: params.maxPrice });
    if (priceFilter) {
      andConditions.push({ price: priceFilter });
    }

    if (params.search) {
      andConditions.push({
        OR: [
          { name: { contains: params.search, mode: 'insensitive' } },
          { sku: { contains: params.search, mode: 'insensitive' } },
          { slug: { contains: params.search, mode: 'insensitive' } },
        ],
      });
    }

    return andConditions.length > 0 ? { AND: andConditions } : {};
  }

  /**
   * Paginated catalogue listing.
   *
   * `WHERE`, `ORDER BY`, `LIMIT` and `OFFSET` are all executed by PostgreSQL; the
   * `id` tiebreaker keeps ordering total so paging cannot duplicate or drop rows.
   * `findMany` and `count` share a transaction for a consistent snapshot.
   */
  public async findMany(params: FindProductsParams): Promise<[ProductWithCategory[], number]> {
    const where = this.buildProductWhere(params);

    const [products, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: buildStableOrderBy<Prisma.ProductOrderByWithRelationInput>(
          params.sortBy,
          params.sortOrder
        ),
        select: PRODUCT_SELECT,
      }),
      prisma.product.count({ where }),
    ]);

    return [products, total];
  }

  public async update(id: string, data: Prisma.ProductUpdateInput): Promise<ProductWithCategory> {
    return prisma.product.update({
      where: { id },
      data,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  public async countOrderItems(productId: string): Promise<number> {
    return prisma.orderItem.count({
      where: { productId },
    });
  }

  public async countStockReservations(productId: string): Promise<number> {
    return prisma.stockReservation.count({
      where: { productId },
    });
  }

  public async softDelete(id: string): Promise<Product> {
    return prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  public async hardDelete(id: string): Promise<Product> {
    return prisma.$transaction(async (tx) => {
      await tx.inventoryMovement.deleteMany({ where: { productId: id } });
      await tx.inventory.deleteMany({ where: { productId: id } });
      return tx.product.delete({ where: { id } });
    });
  }
}

export const productRepository = new ProductRepository();
