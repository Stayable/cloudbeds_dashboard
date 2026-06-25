import { describe, it, expect } from "vitest";
import { buildEvictionsViews, computeDaysToFile, ROW_LABELS } from "@/lib/evictions";

// Mirrors the real "Evictions Metrics" matrix (verified 2026-06-26): metric rows
// keyed by "Primary Column", property columns titled "<id> <name>", plus "Total".
const COLUMN_TITLES = [
  "Primary Column",
  "Date",
  "4645 Lakeland",
  "2295 Kiss East",
  "8700 Orlando",
  "6802 Jax West",
  "5399 Kiss West",
  "2535 St. Augustine",
  "44199 Davenport",
  "812 Jax N",
  "Total",
];

const ROWS: Record<string, string>[] = [
  // noise rows the parser must ignore
  { "Primary Column": "6.0" },
  { "Primary Column": "2026.0" },
  { "Primary Column": "Active", "44199 Davenport": "1", Total: "14" },
  {
    "Primary Column": ROW_LABELS.open, // "Total" row = all open
    "4645 Lakeland": "2",
    "44199 Davenport": "2",
    "812 Jax N": "1",
    Total: "18",
  },
  {
    "Primary Column": ROW_LABELS.closed,
    "4645 Lakeland": "115",
    "44199 Davenport": "97",
    "812 Jax N": "26",
    Total: "787",
  },
  {
    "Primary Column": ROW_LABELS.total, // "Grand Total"
    "4645 Lakeland": "117",
    "44199 Davenport": "99",
    "812 Jax N": "27",
    Total: "805",
  },
  {
    "Primary Column": ROW_LABELS.avgDays,
    "4645 Lakeland": "17.0",
    "44199 Davenport": "24.0",
    "812 Jax N": "N/A",
    Total: "21.9545454545455",
  },
];

describe("buildEvictionsViews", () => {
  it("puts ALL first, reading the sheet's Total column", () => {
    const views = buildEvictionsViews(ROWS, COLUMN_TITLES);
    expect(views[0].key).toBe("ALL");
    expect(views[0]).toMatchObject({ open: 18, closed: 787, total: 805 });
    expect(views[0].avgDays).toBeCloseTo(21.95, 1);
  });

  it("maps each property column by its leading business ID", () => {
    const views = buildEvictionsViews(ROWS, COLUMN_TITLES);
    const dp = views.find((v) => v.key === "44199");
    expect(dp).toMatchObject({ label: "Davenport", open: 2, closed: 97, total: 99, avgDays: 24 });
    const ll = views.find((v) => v.key === "4645");
    expect(ll).toMatchObject({ open: 2, closed: 115, total: 117, avgDays: 17 });
  });

  it("treats N/A / blank avg-days as null and missing counts as 0", () => {
    const views = buildEvictionsViews(ROWS, COLUMN_TITLES);
    const jn = views.find((v) => v.key === "812");
    expect(jn?.avgDays).toBeNull();
    expect(jn?.open).toBe(1);
    // Kissimmee East has no cells in any metric row → all zero, avg null.
    const ke = views.find((v) => v.key === "2295");
    expect(ke).toMatchObject({ open: 0, closed: 0, total: 0, avgDays: null });
  });

  it("strips thousands separators in counts", () => {
    const views = buildEvictionsViews(
      [{ "Primary Column": ROW_LABELS.closed, Total: "1,234" }],
      COLUMN_TITLES,
    );
    expect(views[0].closed).toBe(1234);
  });

  it("merges a days-to-file map onto the matching views", () => {
    const dtf = new Map<string, number | null>([
      ["ALL", 12.5],
      ["44199", 9],
    ]);
    const views = buildEvictionsViews(ROWS, COLUMN_TITLES, dtf);
    expect(views.find((v) => v.key === "ALL")?.avgDaysToFile).toBe(12.5);
    expect(views.find((v) => v.key === "44199")?.avgDaysToFile).toBe(9);
    expect(views.find((v) => v.key === "4645")?.avgDaysToFile).toBeNull();
  });
});

describe("computeDaysToFile", () => {
  it("averages complaint-filed minus notice-posted per property and overall", () => {
    const m = computeDaysToFile([
      { property: "44199 Davenport", noticePosted: "2026-02-03", complaintFiled: "2026-02-13" }, // 10
      { property: "44199 Davenport", noticePosted: "2026-02-05", complaintFiled: "2026-02-09" }, // 4
      { property: "4645 Lakeland", noticePosted: "2026-01-02", complaintFiled: "2026-01-14" }, // 12
    ]);
    expect(m.get("44199")).toBe(7); // (10 + 4) / 2
    expect(m.get("4645")).toBe(12);
    expect(m.get("ALL")).toBeCloseTo((10 + 4 + 12) / 3, 5);
  });

  it("skips rows with a missing/invalid date or a negative span", () => {
    const m = computeDaysToFile([
      { property: "812 Jax N", noticePosted: "2026-02-03", complaintFiled: "" }, // missing
      { property: "812 Jax N", noticePosted: "not-a-date", complaintFiled: "2026-02-13" }, // invalid
      { property: "812 Jax N", noticePosted: "2026-02-20", complaintFiled: "2026-02-10" }, // negative
    ]);
    expect(m.get("812") ?? null).toBeNull();
    expect(m.get("ALL") ?? null).toBeNull();
  });
});
