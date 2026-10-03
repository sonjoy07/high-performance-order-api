import { SortDirection } from '../validation/query.validation';

/**
 * Deterministic ordering helper.
 *
 * `LIMIT/OFFSET` pagination is only safe when the `ORDER BY` is *total*: every row must
 * have a deterministic position, otherwise concurrent writes shift rows across page
 * boundaries and clients see duplicated or skipped records.
 *
 * Most sortable columns (`createdAt`, `status`, `totalAmount`) are non-unique, so a primary
 * sort alone is not enough. We therefore always append `id` — the primary key, therefore
 * unique — as a secondary sort in the same direction. This is also index-friendly: a
 * composite B-tree on `(customerId, createdAt, id)` can satisfy `createdAt DESC, id DESC`
 * with a single backward index scan.
 *
 * The caller supplies the model-specific Prisma order-by type (Prisma does not export a
 * generic `OrderByWithRelationInput`), which keeps the helper free of `any` casts at the
 * repository level while still preventing raw user input from reaching `orderBy`.
 */
export function buildStableOrderBy<TOrderBy extends Record<string, unknown>>(
  sortBy: string,
  direction: SortDirection,
  tieBreakerField = 'id'
): TOrderBy[] {
  if (sortBy === tieBreakerField) {
    return [{ [tieBreakerField]: direction } as unknown as TOrderBy];
  }

  return [
    { [sortBy]: direction } as unknown as TOrderBy,
    { [tieBreakerField]: direction } as unknown as TOrderBy,
  ];
}