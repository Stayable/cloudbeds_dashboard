import { describe, expect, it } from "vitest";
import {
  avgCallSeconds,
  breakdown,
  byProperty,
  dailySeries,
  prettyLabel,
  shareOf,
  taskResolutionRate,
} from "./elise-insights";
import type { EliseMetricRow } from "./db";

const row = (
  code: string,
  day: string,
  metric: string,
  dimension: string,
  n: number,
  total = 0,
): EliseMetricRow => ({ code, day, metric, dimension, n, total });

describe("prettyLabel", () => {
  it("maps known raw values", () => {
    expect(prettyLabel("voice_ai")).toBe("Voice AI");
    expect(prettyLabel("after_hours")).toBe("After hours");
    expect(prettyLabel("ESCORTED")).toBe("Escorted");
  });

  it("title-cases and de-slugs unknown values", () => {
    expect(prettyLabel("no-longer-interested")).toBe("No longer interested");
    expect(prettyLabel("leased-elsewhere")).toBe("Leased elsewhere");
  });
});

describe("breakdown", () => {
  const rows = [
    row("DP", "2026-07-01", "lead_source", "Zillow", 10),
    row("DP", "2026-07-02", "lead_source", "Zillow", 5),
    row("LL", "2026-07-01", "lead_source", "Google Business", 20),
    row("DP", "2026-07-01", "channel", "Voice", 99),
  ];

  it("sums across days and ranks by volume", () => {
    const b = breakdown(rows, "lead_source");
    expect(b.total).toBe(35);
    expect(b.slices.map((s) => s.label)).toEqual(["Google Business", "Zillow"]);
    expect(b.slices[0].pct).toBeCloseTo(20 / 35);
  });

  it("ignores other metrics", () => {
    expect(breakdown(rows, "lead_source").slices.some((s) => s.n === 99)).toBe(false);
  });

  it("filters to one property", () => {
    const b = breakdown(rows, "lead_source", { code: "DP" });
    expect(b.total).toBe(15);
    expect(b.slices).toHaveLength(1);
  });

  it("collapses the long tail into Other without losing volume", () => {
    const many = Array.from({ length: 8 }, (_, i) => row("DP", "2026-07-01", "src", `s${i}`, 10 - i));
    const b = breakdown(many, "src", { limit: 3 });
    expect(b.slices).toHaveLength(4);
    expect(b.slices.at(-1)!.label).toBe("Other");
    expect(b.slices.reduce((s, x) => s + x.n, 0)).toBe(b.total);
  });

  it("returns an empty breakdown for an unknown metric", () => {
    const b = breakdown(rows, "nope");
    expect(b.total).toBe(0);
    expect(b.slices).toEqual([]);
  });
});

describe("shareOf", () => {
  const rows = [
    row("DP", "2026-07-01", "ai_booked", "ai", 30),
    row("DP", "2026-07-01", "ai_booked", "human", 10),
    row("LL", "2026-07-01", "ai_booked", "human", 10),
  ];

  it("computes the dimension's share of the metric", () => {
    expect(shareOf(rows, "ai_booked", "ai")).toBeCloseTo(30 / 50);
  });

  it("scopes to one property", () => {
    expect(shareOf(rows, "ai_booked", "ai", { code: "DP" })).toBeCloseTo(0.75);
    expect(shareOf(rows, "ai_booked", "ai", { code: "LL" })).toBe(0);
  });

  it("returns null (not 0) when the metric has no rows", () => {
    expect(shareOf(rows, "ai_booked", "ai", { code: "KE" })).toBeNull();
    expect(shareOf([], "ai_booked", "ai")).toBeNull();
  });
});

describe("avgCallSeconds", () => {
  it("divides summed duration by call count", () => {
    const rows = [
      row("DP", "2026-07-01", "voice_answered", "voice_ai", 10, 1200),
      row("DP", "2026-07-01", "voice_answered", "unanswered", 10, 0),
    ];
    expect(avgCallSeconds(rows)).toBe(60);
  });

  it("returns null with no calls", () => {
    expect(avgCallSeconds([])).toBeNull();
  });
});

describe("taskResolutionRate", () => {
  it("uses total as the resolved count", () => {
    const rows = [
      row("DP", "2026-07-01", "task_type", "CallBack", 100, 90),
      row("LL", "2026-07-01", "task_type", "CallBack", 100, 80),
    ];
    expect(taskResolutionRate(rows)).toBeCloseTo(0.85);
    expect(taskResolutionRate(rows, { code: "DP" })).toBeCloseTo(0.9);
  });

  it("returns null with no tasks", () => {
    expect(taskResolutionRate([])).toBeNull();
  });
});

describe("byProperty", () => {
  it("ranks properties by total volume", () => {
    const rows = [
      row("DP", "2026-07-01", "channel", "Voice", 5),
      row("DP", "2026-07-02", "channel", "Email", 5),
      row("LL", "2026-07-01", "channel", "Voice", 30),
    ];
    expect(byProperty(rows, "channel")).toEqual([
      { code: "LL", n: 30 },
      { code: "DP", n: 10 },
    ]);
  });
});

describe("dailySeries", () => {
  it("sums dimensions per day in date order", () => {
    const rows = [
      row("DP", "2026-07-02", "channel", "Voice", 2),
      row("DP", "2026-07-01", "channel", "Voice", 1),
      row("DP", "2026-07-01", "channel", "Email", 4),
    ];
    expect(dailySeries(rows, "channel")).toEqual([
      { day: "2026-07-01", n: 5 },
      { day: "2026-07-02", n: 2 },
    ]);
  });
});
