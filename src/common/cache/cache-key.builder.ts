import { CACHE_NS } from '../../infrastructure/redis/redis.constants';

/**
 * Builds a deterministic cache key for product list queries.
 * Query params are sorted to normalize key regardless of property insertion order.
 */
export function buildProductListKey(params: Record<string, unknown>): string {
  const normalized = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return `${CACHE_NS.PRODUCTS_LIST}:${normalized || 'default'}`;
}

/** Builds the cache key for a single product detail. */
export function buildProductDetailKey(productId: string): string {
  return `${CACHE_NS.PRODUCTS_DETAIL}:${productId}`;
}

/**
 * Builds a deterministic cache key for category list queries.
 */
export function buildCategoryListKey(params: Record<string, unknown>): string {
  const normalized = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return `${CACHE_NS.CATEGORIES_LIST}:${normalized || 'default'}`;
}

/** Builds the cache key for a single category detail. */
export function buildCategoryDetailKey(categoryId: string): string {
  return `${CACHE_NS.CATEGORIES_DETAIL}:${categoryId}`;
}
