import { Category, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { buildStableOrderBy } from '../../common/utils/sorting';

/** Explicit projection so no internal column can leak into catalogue responses. */
export const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

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

  /**
   * Builds the SQL-equivalent `WHERE` clause for category listings.
   * Search maps to case-insensitive `ILIKE` and is served by a `pg_trgm` GIN index;
   * filtering always happens in PostgreSQL, never in Node.js.
   */
  public buildCategoryWhere(params: FindCategoriesParams): Prisma.CategoryWhereInput {
    const andConditions: Prisma.CategoryWhereInput[] = [];

    if (params.search) {
      andConditions.push({
        OR: [
          { name: { contains: params.search, mode: 'insensitive' } },
          { slug: { contains: params.search, mode: 'insensitive' } },
        ],
      });
    }

    return andConditions.length > 0 ? { AND: andConditions } : {};
  }

  /**
   * Paginated category listing with DB-side filtering, sorting and paging.
   * Ordering is made total by appending the `id` tiebreaker.
   */
  public async findMany(params: FindCategoriesParams): Promise<[Category[], number]> {
    const where = this.buildCategoryWhere(params);

    const [categories, total] = await prisma.$transaction([
      prisma.category.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: buildStableOrderBy<Prisma.CategoryOrderByWithRelationInput>(
          params.sortBy,
          params.sortOrder
        ),
        select: CATEGORY_SELECT,
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
