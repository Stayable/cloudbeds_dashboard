import { describe, it, expect } from "vitest";
import { DAILY_CAPTURE_ET_HOUR, easternMinutesNow } from "@/lib/dates";

// The 06:00 ET daily capture (app/api/cron/capture-daily/route.ts) has the
// same DST problem as the 10:30 ET report: Vercel Cron is fixed UTC, so a
// single entry drifts an hour against Eastern wall-clock across the DST
// boundary. Two entries an hour apart (vercel.json: 10:00 UTC, 11:00 UTC)
// plus the route's guard mean exactly one fires. These pin that arithmetic —
// mirrors lib/delivery-window.test.ts, which covers the analogous 10:30 ET
// guard.
const WINDOW_START = DAILY_CAPTURE_ET_HOUR * 60;
const WINDOW_END = (DAILY_CAPTURE_ET_HOUR + 1) * 60;
const inWindow = (m: number) => m >= WINDOW_START && m < WINDOW_END;

const at = (iso: string) => easternMinutesNow(new Date(iso));
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

describe("capture-daily DST window", () => {
  it("lands at 6:00 ET in summer via the 10:00 UTC entry", () => {
    expect(hhmm(at("2026-08-11T10:00:00Z"))).toBe("6:00"); // EDT, UTC-4
  });

  it("lands at 6:00 ET in winter via the 11:00 UTC entry", () => {
    expect(hhmm(at("2026-01-15T11:00:00Z"))).toBe("6:00"); // EST, UTC-5
  });

  it("the summer entry's winter twin (11:00 UTC) is 7:00 ET, not 6:00", () => {
    expect(hhmm(at("2026-08-11T11:00:00Z"))).toBe("7:00");
  });

  it("the winter entry's summer twin (10:00 UTC) is 5:00 ET, not 6:00", () => {
    expect(hhmm(at("2026-01-15T10:00:00Z"))).toBe("5:00");
  });

  // Sample both sides of each DST transition plus midsummer/midwinter — same
  // dates lib/delivery-window.test.ts uses.
  const days = ["2026-01-15", "2026-03-07", "2026-03-09", "2026-08-03", "2026-11-01", "2026-11-02", "2026-12-20"];

  it("has exactly one of 10:00/11:00 UTC inside the window on every sampled day", () => {
    for (const day of days) {
      const hits = ["10:00", "11:00"].filter((t) => inWindow(at(`${day}T${t}:00Z`)));
      expect(hits.length, `${day} fired ${hits.length} times (${hits.join(", ")})`).toBe(1);
    }
  });

  it("never admits both entries on the same day (they are 60 min apart, window is 60 min wide)", () => {
    for (const day of days) {
      const bothIn = inWindow(at(`${day}T10:00:00Z`)) && inWindow(at(`${day}T11:00:00Z`));
      expect(bothIn).toBe(false);
    }
  });

  it("never fires at the OLD 03:00 UTC capture-blocks time (unrelated cron, must not collide)", () => {
    for (const day of days) expect(inWindow(at(`${day}T03:00:00Z`))).toBe(false);
  });
});
