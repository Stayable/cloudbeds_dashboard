import { describe, it, expect } from "vitest";
import { priorWindow, priorMonthWindow } from "@/lib/dates";

describe("priorWindow", () => {
  it("returns the equal-length window immediately before", () => {
    // 7-day window 2026-06-10..2026-06-16 -> 2026-06-03..2026-06-09
    expect(priorWindow("2026-06-10", "2026-06-16")).toEqual({
      start: "2026-06-03",
      end: "2026-06-09",
    });
  });
  it("handles a single day", () => {
    expect(priorWindow("2026-06-16", "2026-06-16")).toEqual({
      start: "2026-06-15",
      end: "2026-06-15",
    });
  });
});

describe("priorMonthWindow", () => {
  it("shifts the window back one calendar month", () => {
    expect(priorMonthWindow("2026-06-10", "2026-06-16")).toEqual({
      start: "2026-05-10",
      end: "2026-05-16",
    });
  });
  it("clamps to the last valid day when the target month is shorter", () => {
    // March 31 -> February: clamp to Feb 28 (2026 is not a leap year)
    expect(priorMonthWindow("2026-03-31", "2026-03-31")).toEqual({
      start: "2026-02-28",
      end: "2026-02-28",
    });
  });
});
