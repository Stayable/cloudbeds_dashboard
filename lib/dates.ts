// Eastern (America/New_York) date helpers. We always reason in the property
// timezone, which auto-handles EST/EDT. All values are YYYY-MM-DD strings.

export type Preset = "today" | "yesterday" | "last7" | "last30" | "month" | "custom";

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
