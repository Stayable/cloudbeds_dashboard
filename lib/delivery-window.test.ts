import { describe, it, expect } from "vitest";
import { easternMinutesNow } from "@/lib/dates";

// The daily report must land 10:30-11:00 ET (Kyle, 08/03/26). Vercel Cron is
// fixed UTC, so a single entry drifts an hour across the DST boundary — wider
// than the window. Two entries an hour apart + the route's guard mean exactly
// one fires. These pin that arithmetic, because getting it wrong is silent:
// the report simply arrives at the wrong time, or twice.
const WINDOW_START = 10 * 60 + 15;
const WINDOW_END = 11 * 60;
const inWindow = (m: number) => m >= WINDOW_START && m <= WINDOW_END;

const at = (iso: string) => easternMinutesNow(new Date(iso));
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

describe("easternMinutesNow", () => {
  it("converts UTC to Eastern wall-clock in summer (EDT, UTC-4)", () => {
    expect(hhmm(at("2026-08-03T14:30:00Z"))).toBe("10:30");
    expect(hhmm(at("2026-08-03T15:30:00Z"))).toBe("11:30");
  });

  it("converts UTC to Eastern wall-clock in winter (EST, UTC-5)", () => {
    expect(hhmm(at("2026-01-15T14:30:00Z"))).toBe("9:30");
    expect(hhmm(at("2026-01-15T15:30:00Z"))).toBe("10:30");
  });

  it("handles Eastern midnight as 0, not 1440", () => {
    expect(at("2026-08-03T04:00:00Z")).toBe(0);
  });
});

describe("the two cron entries fire exactly once per day, year-round", () => {
  // Sample both sides of each DST transition plus midsummer/midwinter.
  const days = ["2026-01-15", "2026-03-07", "2026-03-09", "2026-08-03", "2026-11-01", "2026-11-02", "2026-12-20"];

  it("has exactly one of 14:30/15:30 UTC inside the window on every sampled day", () => {
    for (const day of days) {
      const hits = ["14:30", "15:30"].filter((t) => inWindow(at(`${day}T${t}:00Z`)));
      expect(hits.length, `${day} fired ${hits.length} times (${hits.join(", ")})`).toBe(1);
    }
  });

  it("never fires at the OLD 10:00 UTC time, which was 06:00 ET", () => {
    for (const day of days) expect(inWindow(at(`${day}T10:00:00Z`))).toBe(false);
  });

  it("lands at 10:30 ET on both sides of the DST boundary", () => {
    expect(hhmm(at("2026-08-03T14:30:00Z"))).toBe("10:30"); // EDT
    expect(hhmm(at("2026-01-15T15:30:00Z"))).toBe("10:30"); // EST
  });
});
