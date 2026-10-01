import { Prisma, Product } from '@prisma/client';
import { prisma } from '../../config/prisma';

export interface FindProductsParams {
  skip: number;
  take: number;
  search?: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
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

  public async findMany(params: FindProductsParams): Promise<[ProductWithCategory[], number]> {
    const andConditions: Prisma.ProductWhereInput[] = [];

    if (params.categoryId) {
      andConditions.push({ categoryId: params.categoryId });
    }

    if (params.isActive !== undefined) {
      andConditions.push({ isActive: params.isActive });
    }

    if (params.minPrice !== undefined || params.maxPrice !== undefined) {
      const priceFilter: Prisma.DecimalFilter = {};
      if (params.minPrice !== undefined) {
        priceFilter.gte = new Prisma.Decimal(params.minPrice);
      }
      if (params.maxPrice !== undefined) {
        priceFilter.lte = new Prisma.Decimal(params.maxPrice);
      }
      andConditions.push({ price: priceFilter });
    }

    if (params.search) {
      andConditions.push({
        OR: [
          { name: { contains: params.search, mode: 'insensitive' } },
          { sku: { contains: params.search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.ProductWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

    const [products, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: {
          [params.sortBy]: params.sortOrder,
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
