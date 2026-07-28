// Unit tests for `groupAvailabilityRuns` — the guard that would have caught
// Jacksonville North sitting at 70% "available" for months because only 20 of its
// ~107 unsellable renovation rooms were blocked in Cloudbeds.
import { describe, it, expect } from "vitest";
import { groupAvailabilityRuns } from "./db";

const days = (code: string, from: string, n: number, pct: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10) + i));
    return { code, day: d.toISOString().slice(0, 10), availPct: pct };
  });

describe("groupAvailabilityRuns", () => {
  it("flags a sustained high-availability run", () => {
    const out = groupAvailabilityRuns(days("JN", "2026-04-01", 30, 0.7));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ propertyCode: "JN", firstDay: "2026-04-01", lastDay: "2026-04-30", days: 30 });
    expect(out[0].avgAvailablePct).toBeCloseTo(0.7, 5);
  });

  it("ignores a run shorter than the minimum", () => {
    expect(groupAvailabilityRuns(days("LL", "2026-04-01", 6, 0.9))).toEqual([]);
    expect(groupAvailabilityRuns(days("LL", "2026-04-01", 7, 0.9))).toHaveLength(1);
  });

  it("ignores healthy occupancy", () => {
    expect(groupAvailabilityRuns(days("LL", "2026-04-01", 30, 0.05))).toEqual([]);
  });

  it("treats the threshold as inclusive", () => {
    expect(groupAvailabilityRuns(days("LL", "2026-04-01", 10, 0.25))).toHaveLength(1);
    expect(groupAvailabilityRuns(days("LL", "2026-04-01", 10, 0.2499))).toEqual([]);
  });

  it("breaks a run on a day below the threshold", () => {
    const rows = [
      ...days("LL", "2026-04-01", 8, 0.8),
      { code: "LL", day: "2026-04-09", availPct: 0.1 },
      ...days("LL", "2026-04-10", 8, 0.8),
    ];
    const out = groupAvailabilityRuns(rows);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.days)).toEqual([8, 8]);
  });

  it("does NOT bridge a calendar gap into one longer run", () => {
    // Missing 2026-04-09/10: two 8-day runs, not one 16-day run.
    const rows = [...days("LL", "2026-04-01", 8, 0.8), ...days("LL", "2026-04-11", 8, 0.8)];
    const out = groupAvailabilityRuns(rows);
    expect(out).toHaveLength(2);
    expect(out[0].lastDay).toBe("2026-04-08");
    expect(out[1].firstDay).toBe("2026-04-11");
  });

  it("never merges runs across properties", () => {
    const rows = [...days("JN", "2026-04-01", 8, 0.8), ...days("LL", "2026-04-09", 8, 0.8)];
    const out = groupAvailabilityRuns(rows);
    expect(out.map((o) => o.propertyCode)).toEqual(["JN", "LL"]);
  });

  it("breaks a run on a null percentage (no inventory that day)", () => {
    const rows = [
      ...days("LL", "2026-04-01", 8, 0.8),
      { code: "LL", day: "2026-04-09", availPct: null },
      ...days("LL", "2026-04-10", 4, 0.8),
    ];
    const out = groupAvailabilityRuns(rows);
    expect(out).toHaveLength(1);
    expect(out[0].days).toBe(8);
  });

  it("handles an empty input", () => {
    expect(groupAvailabilityRuns([])).toEqual([]);
  });

  it("reproduces the JN signature: 70% available for a full quarter", () => {
    // 89 of 127 rooms readable as bookable = 70.1%.
    const out = groupAvailabilityRuns(days("JN", "2026-04-01", 91, 89 / 127));
    expect(out).toHaveLength(1);
    expect(out[0].days).toBe(91);
    expect(out[0].avgAvailablePct).toBeCloseTo(0.7008, 3);
  });
});
