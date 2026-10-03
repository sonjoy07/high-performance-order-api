// Cache namespace prefixes
export const CACHE_NS = {
  PRODUCTS_LIST: 'cache:products:list',
  PRODUCTS_DETAIL: 'cache:products:detail',
  CATEGORIES_LIST: 'cache:categories:list',
  CATEGORIES_DETAIL: 'cache:categories:detail',
} as const;

export const LOCK_PREFIX = 'cache:lock';
export const LOCK_TTL_SECONDS = 5;
export const LOCK_RETRY_COUNT = 3;
export const LOCK_RETRY_DELAY_MS = 100;
