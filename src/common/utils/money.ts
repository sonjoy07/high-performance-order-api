import { Prisma } from '@prisma/client';

/**
 * Money handling helpers.
 *
 * Monetary values are stored as PostgreSQL `NUMERIC(12,2)` and mapped to
 * `Prisma.Decimal` (decimal.js). Comparisons and range checks are therefore always
 * performed with `Decimal` arithmetic — never with JavaScript floating-point numbers,
 * which cannot represent values such as `0.1 + 0.2` exactly and would silently skew
 * financial filters and report totals.
 */

/** Matches a non-negative monetary literal with at most 2 decimal places (NUMERIC(12,2)). */
const MONEY_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

/** Canonical string form of a money value, always with exactly 2 decimal places. */
export type MoneyString = string;

/**
 * Validates a user-supplied money value without coercing it through `Number`.
 * Returns the trimmed input string so callers can build `Prisma.Decimal` filters.
 */
export function normalizeMoneyInput(raw: string): MoneyString | null {
  const value = raw.trim();
  if (!MONEY_PATTERN.test(value)) {
    return null;
  }
  // Drop redundant leading zeros / trailing zeros so cache keys and logs stay canonical.
  return new Prisma.Decimal(value).toFixed(2);
}

/** Parses a canonical money string into a `Prisma.Decimal`. */
export function toDecimal(value: MoneyString | number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/**
 * Serializes a decimal monetary value for JSON responses using fixed 2-decimal precision.
 * Falls back to `"0.00"` for `null` so clients always receive a string, never a float.
 */
export function formatMoney(
  value: Prisma.Decimal | Prisma.DecimalJsLike | number | string | null | undefined
): MoneyString {
  if (value === null || value === undefined) {
    return new Prisma.Decimal(0).toFixed(2);
  }

  // `DecimalJsLike` (Prisma's raw-driver representation) is not accepted by the Decimal
  // constructor, but always round-trips losslessly through its string form.
  const input =
    typeof value === 'object' && !(value instanceof Prisma.Decimal)
      ? (value as Prisma.DecimalJsLike).toString()
      : value;

  return new Prisma.Decimal(input as string | number).toFixed(2);
}