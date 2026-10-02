/**
 * Timezone-aware date boundary resolution for query filters (`fromDate` / `toDate`).
 *
 * Why this exists
 * ---------------
 * `new Date('2026-01-31')` is parsed as UTC midnight by the ECMAScript spec, while
 * `new Date('2026-01-31T00:00:00')` is parsed in the *server's local* timezone. Mixing
 * the two makes report boundaries shift depending on where the process runs.
 *
 * This module resolves every date-only boundary against the single, configured
 * `TIMEZONE` (see `src/config/env.ts`) so the same request always produces the same
 * SQL predicate, and so `toDate=2026-01-31` covers the whole day rather than one instant.
 *
 * No SQL is ever built here — only `Date` instances are produced, which are then passed
 * to Prisma's typed query builder (which parameterizes every value).
 */

import { config } from '../../config/env';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAIVE_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const HAS_TIMEZONE_DESIGNATOR_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export type DateBoundary = 'startOfDay' | 'endOfDay';

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

/**
 * Returns the UTC offset (in milliseconds) of `timeZone` at the given instant.
 * Positive values are east of UTC (e.g. Asia/Tokyo => +9h).
 */
function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const lookup: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      lookup[part.type] = Number(part.value);
    }
  }

  const asUtc = Date.UTC(
    lookup.year!,
    lookup.month! - 1,
    lookup.day!,
    lookup.hour!,
    lookup.minute!,
    lookup.second!
  );

  return asUtc - instant.getTime();
}

/**
 * Converts a wall-clock time expressed in `timeZone` into the corresponding UTC instant.
 * Two passes handle daylight-saving transitions, where the naive guess can land on the
 * wrong side of the offset change.
 */
export function zonedTimeToUtc(parts: ZonedDateParts, timeZone: string): Date {
  const naiveUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );

  const firstGuessOffset = getTimeZoneOffsetMs(new Date(naiveUtc), timeZone);
  const firstGuess = new Date(naiveUtc - firstGuessOffset);

  const refinedOffset = getTimeZoneOffsetMs(firstGuess, timeZone);
  return refinedOffset === firstGuessOffset ? firstGuess : new Date(naiveUtc - refinedOffset);
}

/**
 * Returns true when the calendar fields describe a date that actually exists.
 *
 * `new Date(2026, 1, 31)` silently rolls over to 2 March, so a shape-only regex would
 * accept `2026-02-31` and quietly shift the query window. Re-reading the components back
 * after constructing the date catches every rollover, leap-year and month-length case.
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Validates that a string is either a `YYYY-MM-DD` date or a parseable ISO 8601 timestamp.
 *
 * Beyond the format shape, calendar validity is enforced: `2026-02-31`, `2026-13-01` and
 * `2026-04-31` are rejected rather than being silently normalised into a different day.
 */
export function isSupportedDateInput(raw: string): boolean {
  const value = raw.trim();
  if (!value) {
    return false;
  }

  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  if (dateOnly) {
    return isRealCalendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
  }

  const naive = NAIVE_DATETIME_PATTERN.exec(value);
  if (naive) {
    const hour = Number(naive[4]);
    const minute = Number(naive[5]);
    const second = naive[6] ? Number(naive[6]) : 0;
    if (hour > 23 || minute > 59 || second > 59) {
      return false;
    }
    return isRealCalendarDate(Number(naive[1]), Number(naive[2]), Number(naive[3]));
  }

  return !Number.isNaN(Date.parse(value));
}

/**
 * Resolves a user-supplied date filter into an absolute UTC instant.
 *
 * - `YYYY-MM-DD` (date-only)  -> start/end of that calendar day in `TIMEZONE`
 * - ISO 8601 with `Z`/offset   -> used as-is (already unambiguous)
 * - ISO 8601 without designator -> interpreted in `TIMEZONE`
 */
export function resolveDateBoundary(
  raw: string,
  boundary: DateBoundary,
  timeZone: string = config.TIMEZONE
): Date {
  const value = raw.trim();

  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return zonedTimeToUtc(
      {
        year: Number(y),
        month: Number(m),
        day: Number(d),
        hour: boundary === 'endOfDay' ? 23 : 0,
        minute: boundary === 'endOfDay' ? 59 : 0,
        second: boundary === 'endOfDay' ? 59 : 0,
        millisecond: boundary === 'endOfDay' ? 999 : 0,
      },
      timeZone
    );
  }

  if (HAS_TIMEZONE_DESIGNATOR_PATTERN.test(value)) {
    return new Date(value);
  }

  const naive = NAIVE_DATETIME_PATTERN.exec(value);
  if (naive) {
    const [, y, m, d, hh, mm, ss, ms] = naive;
    return zonedTimeToUtc(
      {
        year: Number(y),
        month: Number(m),
        day: Number(d),
        hour: Number(hh),
        minute: Number(mm),
        second: ss ? Number(ss) : 0,
        millisecond: ms ? Number(ms.padEnd(3, '0')) : 0,
      },
      timeZone
    );
  }

  // Fallback for any other format `Date.parse` accepts (e.g. "January 1, 2026").
  return new Date(value);
}