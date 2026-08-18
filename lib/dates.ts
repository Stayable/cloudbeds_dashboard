// Eastern (America/New_York) date helpers. We always reason in the property
// timezone, which auto-handles EST/EDT. All values are YYYY-MM-DD strings.

export type Preset = "today" | "yesterday" | "last7" | "last30" | "month" | "custom";

/** THE SINGLE DEFINITION of "when yesterday's daily capture runs," in Eastern
 *  wall-clock hours (Kyle, 08/10/26 — matches the upstream "History and
 *  Forecast" report's own move to 6am). Read by BOTH the capture cron's DST
 *  window guard (`app/api/cron/capture-daily/route.ts`) and the empty-state
 *  message that tells a user why "Yesterday" is still blank
 *  (`lib/occupancy.ts` — `pendingCaptureNote`). One constant, not a "6" typed
 *  twice: this repo has been bitten before by one meaning with two
 *  definitions that quietly drift apart (see MEMORY.md). */
export const DAILY_CAPTURE_ET_HOUR = 6;

/** THE SINGLE DEFINITION of "when the due-out room walk list is delivered," in
 *  Eastern wall-clock hours (Kyle, 08/14/26). Read by the due-out cron's DST
 *  window guard (`app/api/cron/due-outs/route.ts`) and by the card's own
 *  wording, so the hour a reader is told cannot drift from the hour that runs.
 *
 *  This hour is not cosmetic. The list is defined as reservations Cloudbeds
 *  still reports `In-House` — as guests depart, they leave the list. Probed
 *  08/14/26: Davenport's 4 due-outs that day all read `Checked Out` by 2pm ET,
 *  so the list was empty. Moving this later does not report a quiet morning, it
 *  reports nothing. */
export const DUE_OUT_ET_HOUR = 9;

/** Whether a string is a real YYYY-MM-DD calendar date.
 *
 *  Shape-only regex is not enough: `Date.parse("2026-02-30T00:00:00Z")` does
 *  NOT return NaN, it silently rolls forward to 2026-03-02. A caller that only
 *  checks digit layout would accept a date that never existed. Round-tripping
 *  the parsed date back to YYYY-MM-DD and requiring it to equal the input
 *  catches that: a date that changes when it round-trips did not exist.
 *
 *  THE SINGLE DEFINITION. `lib/kb-parse.ts` and `lib/mcp/buckets.ts` each used
 *  to carry their own private copy of exactly this check — two independent
 *  implementations of one meaning, the known failure mode recorded in
 *  MEMORY.md ("Duplicated definitions fail silently"). Both now import this
 *  one instead. */
export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === ymd;
}

/** Today's calendar date in Eastern time. */
export function easternToday(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Minutes past Eastern midnight right now (0-1439). DST-aware, so it means the
 *  same wall-clock thing in EST and EDT.
 *
 *  Why this exists: Vercel Cron schedules are fixed UTC, so a single entry
 *  drifts an hour against Eastern twice a year. The daily report must land in a
 *  30-minute Eastern window (Kyle, 08/03/26), which is narrower than that drift
 *  — so two UTC entries are scheduled an hour apart and the route uses this to
 *  run on exactly the one that is currently correct. */
export function easternMinutesNow(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  // en-GB renders midnight as 24 in some ICU versions.
  return (get("hour") % 24) * 60 + get("minute");
}

/** Convert an ISO datetime (e.g. "2026-06-27T01:27:09Z") to its Eastern calendar
 *  date (YYYY-MM-DD). Returns "" for an unparseable input. */
export function easternDateOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Shift a YYYY-MM-DD string by N days (pure calendar math, DST-safe). */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** First day of the month for a YYYY-MM-DD string. */
export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** Resolve a preset (or custom start/end) to a concrete [start, end] range. */
export function resolveRange(
  preset: string | undefined,
  customStart?: string,
  customEnd?: string,
): { preset: Preset; start: string; end: string } {
  const today = easternToday();
  switch (preset) {
    case "today":
      return { preset: "today", start: today, end: today };
    case "yesterday": {
      const y = shiftYmd(today, -1);
      return { preset: "yesterday", start: y, end: y };
    }
    case "last30":
      return { preset: "last30", start: shiftYmd(today, -29), end: today };
    case "month":
      return { preset: "month", start: monthStart(today), end: today };
    case "custom":
      if (customStart && customEnd) {
        // Guard against reversed ranges.
        const [start, end] = customStart <= customEnd ? [customStart, customEnd] : [customEnd, customStart];
        return { preset: "custom", start, end };
      }
      return { preset: "last7", start: shiftYmd(today, -6), end: today };
    case "last7":
    default:
      return { preset: "last7", start: shiftYmd(today, -6), end: today };
  }
}

/** Inclusive day count of a range. */
export function dayCount(start: string, end: string): number {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const a = Date.UTC(ys, ms - 1, ds);
  const b = Date.UTC(ye, me - 1, de);
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** The equal-length window immediately before [start, end] (inclusive). */
export function priorWindow(start: string, end: string): { start: string; end: string } {
  const len = dayCount(start, end); // inclusive day count
  return { start: shiftYmd(start, -len), end: shiftYmd(end, -len) };
}

/** Shift a YYYY-MM-DD back one calendar month, clamping the day to a valid date. */
function shiftMonth(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const targetMonth = m === 1 ? 12 : m - 1;
  const targetYear = m === 1 ? y - 1 : y;
  // Last day of the target month (day 0 of the following month, UTC).
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Same-shaped window one calendar month earlier (both ends clamped). */
export function priorMonthWindow(start: string, end: string): { start: string; end: string } {
  return { start: shiftMonth(start), end: shiftMonth(end) };
}
