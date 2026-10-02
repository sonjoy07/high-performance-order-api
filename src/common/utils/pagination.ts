import { PaginationMeta } from '../types/pagination';

/**
 * Hard upper bound for any paginated endpoint.
 * No endpoint may ever return an unbounded result set: without this, a single request
 * could force PostgreSQL to materialise the entire table into Node.js memory.
 */
export const MAX_LIMIT = 100;

/** Default page size applied when the client omits `limit`. */
export const DEFAULT_LIMIT = 20;

/** Default page number applied when the client omits `page`. */
export const DEFAULT_PAGE = 1;

export interface PaginationArgs {
  /** Rows to discard (OFFSET). Pushed down into SQL, never applied in JS. */
  skip: number;
  /** Maximum rows to return (LIMIT). Pushed down into SQL, never applied in JS. */
  take: number;
}

/**
 * Translates `page`/`limit` into Prisma `skip`/`take`.
 * The multiplication is bounded because `limit` is capped at {@link MAX_LIMIT}.
 */
export function buildPaginationArgs(page: number, limit: number): PaginationArgs {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : DEFAULT_PAGE;
  const safeLimit = Math.min(Math.max(Math.floor(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  return {
    skip: (safePage - 1) * safeLimit,
    take: safeLimit,
  };
}

/**
 * Builds the consistent pagination envelope returned by every list endpoint.
 * `totalPages` is 0 when there are no matching rows, which lets clients distinguish
 * "no results" from "results were requested beyond the last page".
 */
export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const safeLimit = Math.min(Math.max(Math.floor(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : DEFAULT_PAGE;

  return {
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0,
  };
}