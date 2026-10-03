import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from '../utils/pagination';
import { isSupportedDateInput, resolveDateBoundary } from '../utils/date';
import { normalizeMoneyInput, toDecimal } from '../utils/money';

/**
 * Reusable query-string validation primitives.
 *
 * Every list/filter/report endpoint composes its schema from these fragments so that
 * pagination limits, sort whitelists, date-range semantics and money parsing are defined
 * exactly once instead of being copy-pasted (and drifting) across modules.
 *
 * Design rules enforced here:
 *  1. No unbounded result sets — `limit` is hard-capped at {@link MAX_LIMIT}.
 *  2. Sort fields are explicit whitelists, never raw user input forwarded to `orderBy`.
 *  3. Date inputs are validated here and converted to `Date` by the repository layer,
 *     using the configured `TIMEZONE` and the typed Prisma query builder.
 *  4. Money stays decimal — filters are compared with `Prisma.Decimal`, never floats.
 */

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const pageSchema = z.coerce
  .number()
  .int('Page must be an integer')
  .min(1, 'Page must be at least 1')
  .default(DEFAULT_PAGE);

export const limitSchema = z.coerce
  .number()
  .int('Limit must be an integer')
  .min(1, 'Limit must be at least 1')
  .max(MAX_LIMIT, `Limit cannot exceed ${MAX_LIMIT}`)
  .default(DEFAULT_LIMIT);

/** Reusable `page` / `limit` object fragment — spread into a query schema. */
export const paginationFields = {
  page: pageSchema,
  limit: limitSchema,
} as const;

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

/**
 * Builds a whitelist-backed `sortBy` schema.
 * Any value outside the whitelist is rejected with 400 instead of reaching `orderBy`,
 * which prevents the `orderBy: { [req.query.sortBy]: ... }` injection foot-gun.
 */
export function createSortBySchema<const T extends readonly string[]>(
  allowed: T,
  defaultValue: T[number]
) {
  const message = `sortBy must be one of: ${allowed.join(', ')}`;
  return z.enum(allowed, { error: message }).default(defaultValue);
}

/** The only sort directions accepted anywhere in the API. */
export type SortDirection = z.infer<typeof sortOrderSchema>;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Reusable free-text search term. Trimming keeps `?search=%20` from matching everything. */
export function createSearchSchema(maxLength = 120) {
  return z
    .string()
    .trim()
    .max(maxLength, `Search term must not exceed ${maxLength} characters`)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional();
}

// ---------------------------------------------------------------------------
// Boolean flags
// ---------------------------------------------------------------------------

export const booleanQuerySchema = z.preprocess((value) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}, z.boolean('Expected a boolean value ("true" or "false")'));

// ---------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------

const dateInputSchema = z
  .string()
  .trim()
  .min(1, 'Date must not be empty')
  .refine(isSupportedDateInput, {
    message: 'Invalid date. Use YYYY-MM-DD or an ISO 8601 timestamp',
  });

/** Reusable `fromDate` / `toDate` fragment (still raw strings). */
export const dateRangeFields = {
  fromDate: dateInputSchema.optional(),
  toDate: dateInputSchema.optional(),
} as const;

/**
 * Cross-field check for a `fromDate` / `toDate` pair.
 * Date-only boundaries are resolved with the configured timezone before comparing,
 * so `fromDate=2026-01-31&toDate=2026-01-31` is a valid single-day range.
 */
export function refineDateRange(
  data: { fromDate?: string; toDate?: string },
  ctx: z.RefinementCtx
): void {
  if (!data.fromDate || !data.toDate) {
    return;
  }

  const from = resolveDateBoundary(data.fromDate, 'startOfDay');
  const to = resolveDateBoundary(data.toDate, 'endOfDay');

  if (from.getTime() > to.getTime()) {
    ctx.addIssue({
      code: 'custom',
      message: 'fromDate must be earlier than or equal to toDate',
      path: ['fromDate'],
    });
  }
}

// ---------------------------------------------------------------------------
// Money range
// ---------------------------------------------------------------------------

const moneyInputSchema = z
  .string()
  .trim()
  .min(1, 'Amount must not be empty')
  .transform((value, ctx) => {
    const normalized = normalizeMoneyInput(value);
    if (normalized === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Amount must be a non-negative number with at most 2 decimal places',
      });
      return z.NEVER;
    }
    return normalized;
  });

/**
 * A single money query parameter (`minPrice`, `maxAmount`, ...).
 * Validated and canonicalized as an exact decimal string — never routed through a float.
 */
export const moneyInput = moneyInputSchema.optional();

/** Reusable `minAmount` / `maxAmount` fragment producing canonical decimal strings. */
export const moneyRangeFields = {
  minAmount: moneyInputSchema.optional(),
  maxAmount: moneyInputSchema.optional(),
} as const;

/** Cross-field check for a money range, performed with exact `Decimal` comparison. */
export function refineMoneyRange(
  data: { minAmount?: string; maxAmount?: string },
  ctx: z.RefinementCtx
): void {
  if (!data.minAmount || !data.maxAmount) {
    return;
  }

  if (toDecimal(data.minAmount).greaterThan(toDecimal(data.maxAmount))) {
    ctx.addIssue({
      code: 'custom',
      message: 'minAmount cannot be greater than maxAmount',
      path: ['minAmount'],
    });
  }
}

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------

/**
 * Builds a Zod enum from a Prisma enum so status filters can never drift from the schema,
 * while preserving the literal union type for the repository layer.
 */
export function createStatusSchema<T extends Record<string, string>>(prismaEnum: T) {
  const values = Object.values(prismaEnum) as [T[keyof T], ...T[keyof T][]];
  return z.enum(values, {
    error: `status must be one of: ${values.join(', ')}`,
  });
}

// ---------------------------------------------------------------------------
// Bounded result caps (reports)
// ---------------------------------------------------------------------------

export function createCountLimitSchema(defaultValue: number) {
  return z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(MAX_LIMIT, `Limit cannot exceed ${MAX_LIMIT}`)
    .default(defaultValue);
}

// ---------------------------------------------------------------------------
// Translation helpers: validated strings -> typed Prisma filters
// ---------------------------------------------------------------------------

export interface DecimalRangeInput {
  min?: string;
  max?: string;
}

export interface DateRangeInput {
  from?: string;
  to?: string;
}

/**
 * Converts validated money strings into a `Prisma.DecimalFilter`.
 * Values are pushed into SQL as numeric parameters; no JS float arithmetic is involved.
 */
export function toDecimalFilter(range: DecimalRangeInput): Prisma.DecimalFilter | undefined {
  if (range.min === undefined && range.max === undefined) {
    return undefined;
  }

  const filter: Prisma.DecimalFilter = {};
  if (range.min !== undefined) {
    filter.gte = toDecimal(range.min);
  }
  if (range.max !== undefined) {
    filter.lte = toDecimal(range.max);
  }
  return filter;
}

/**
 * Converts validated date strings into a `Prisma.DateTimeFilter` using the configured
 * application timezone for day-level boundaries.
 */
export function toDateTimeFilter(range: DateRangeInput): Prisma.DateTimeFilter | undefined {
  if (range.from === undefined && range.to === undefined) {
    return undefined;
  }

  const filter: Prisma.DateTimeFilter = {};
  if (range.from !== undefined) {
    filter.gte = resolveDateBoundary(range.from, 'startOfDay');
  }
  if (range.to !== undefined) {
    filter.lte = resolveDateBoundary(range.to, 'endOfDay');
  }
  return filter;
}