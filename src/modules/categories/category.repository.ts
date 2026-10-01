import { Category, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

export interface FindCategoriesParams {
  skip: number;
  take: number;
  search?: string;
  sortBy: 'name' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}

export class CategoryRepository {
  public async create(data: {
    name: string;
    slug: string;
    description?: string | null;
  }): Promise<Category> {
    return prisma.category.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
      },
    });
  }

  public async findById(id: string): Promise<Category | null> {
    return prisma.category.findUnique({
      where: { id },
    });
  }

  public async findByName(name: string): Promise<Category | null> {
    return prisma.category.findUnique({
      where: { name },
    });
  }

  public async findBySlug(slug: string): Promise<Category | null> {
    return prisma.category.findUnique({
      where: { slug },
    });
  }

  public async findMany(params: FindCategoriesParams): Promise<[Category[], number]> {
    const where: Prisma.CategoryWhereInput = {};

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { slug: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [categories, total] = await prisma.$transaction([
      prisma.category.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: {
          [params.sortBy]: params.sortOrder,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.category.count({ where }),
    ]);

    return [categories, total];
  }

  public async update(id: string, data: Prisma.CategoryUpdateInput): Promise<Category> {
    return prisma.category.update({
      where: { id },
      data,
    });
  }

  public async delete(id: string): Promise<Category> {
    return prisma.category.delete({
      where: { id },
    });
  }

  public async countProducts(categoryId: string): Promise<number> {
    return prisma.product.count({
      where: { categoryId },
    });
  }
}

export const categoryRepository = new CategoryRepository();
