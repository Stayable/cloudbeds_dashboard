// Split a date range into daily, weekly or monthly buckets.
//
// A bucket carries its REAL first and last date and whether the range clipped
// it, because a partial week presented as a whole one reads as a bad week. The
// caller sums within a bucket and divides once — a ratio of sums, never a mean
// of daily percentages, which would weigh a 30%-occupied day at a 153-room
// property the same as one at a 127-room property. Same rule as
// getOccupancyRollup and /report.

import { isValidYmd, shiftYmd } from "@/lib/dates";
import { McpArgError } from "./types";

export type Granularity = "daily" | "weekly" | "monthly";

export type Bucket = {
  /** "2026-08-03" for daily/weekly (the bucket's nominal start), "2026-08" monthly. */
  key: string;
  from: string;
  to: string;
  /** True when the requested range clipped this bucket short. */
  partial: boolean;
};

/** Guards against a question that would pull the whole store into one reply. */
const MAX_DAYS = 732; // two years plus a leap day

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Shape-only validation is not enough: Date.parse("2026-02-30T00:00:00Z")
// does NOT return NaN, it silently rolls forward to 2026-03-02. The regex
// only checks digit layout, so a day-of-month overflow (Feb 30, Apr 31)
// would pass both checks while the string itself stays invalid. Downstream,
// `from`/`to` are compared as raw strings ("d <= to", "cursor <= to") while
// mondayIndex/lastDayOfMonth read the engine's ROLLED interpretation of that
// same string — the two disagree, and the range silently clips at the wrong
// boundary instead of erroring. `isValidYmd` (lib/dates.ts) round-trips the
// parsed date back to YYYY-MM-DD and requires it to equal the input to catch
// this: a date that changes when it round-trips did not exist.
//
// lib/kb-parse.ts hit this same bug (a calendar-invalid snapshotDate
// understated a document's age) and used to carry its own private copy of
// this identical round-trip — two implementations of one meaning, a known
// trap in this repo (MEMORY.md "Duplicated definitions fail silently"). Both
// now import the single definition in lib/dates.ts; only the shape check
// stays local, so the two error messages below (malformed vs. calendar-
// impossible) keep their distinct wording.
function assertYmd(label: string, value: string): void {
  if (!YMD.test(value)) {
    throw new McpArgError(`${label} must be a date in YYYY-MM-DD form, got "${value}".`);
  }
  if (!isValidYmd(value)) {
    throw new McpArgError(`${label} must be a real calendar date in YYYY-MM-DD form, got "${value}".`);
  }
}

/** Day of week, 0 = Monday. */
function mondayIndex(ymd: string): number {
  return (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function lastDayOfMonth(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

function firstDayOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function bucketRange(from: string, to: string, granularity: Granularity): Bucket[] {
  assertYmd("from", from);
  assertYmd("to", to);
  if (from > to) {
    throw new McpArgError(`The start date ${from} is after the end date ${to}.`);
  }
  const spanDays = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  if (spanDays > MAX_DAYS) {
    throw new McpArgError(
      `That range is ${spanDays} days. Ask for two years or less, or use a coarser granularity.`,
    );
  }

  const out: Bucket[] = [];

  if (granularity === "daily") {
    for (let d = from; d <= to; d = shiftYmd(d, 1)) {
      out.push({ key: d, from: d, to: d, partial: false });
    }
    return out;
  }

  if (granularity === "weekly") {
    let cursor = from;
    while (cursor <= to) {
      const weekStart = shiftYmd(cursor, -mondayIndex(cursor));
      const weekEnd = shiftYmd(weekStart, 6);
      const bFrom = cursor;
      const bTo = weekEnd < to ? weekEnd : to;
      out.push({
        key: weekStart,
        from: bFrom,
        to: bTo,
        partial: bFrom !== weekStart || bTo !== weekEnd,
      });
      // bTo >= bFrom >= cursor always, so this strictly advances the cursor
      // and the loop terminates even on a single-day range.
      cursor = shiftYmd(bTo, 1);
    }
    return out;
  }

  let cursor = from;
  while (cursor <= to) {
    const monthStart = firstDayOfMonth(cursor);
    const monthEnd = lastDayOfMonth(cursor);
    const bFrom = cursor;
    const bTo = monthEnd < to ? monthEnd : to;
    out.push({
      key: cursor.slice(0, 7),
      from: bFrom,
      to: bTo,
      partial: bFrom !== monthStart || bTo !== monthEnd,
    });
    // Same termination argument as the weekly loop: bTo >= cursor always.
    cursor = shiftYmd(bTo, 1);
  }
  return out;
}
