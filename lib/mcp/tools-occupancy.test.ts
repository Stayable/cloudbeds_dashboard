import { describe, it, expect } from "vitest";
import { rollupToRows, OCCUPANCY_TOOLS } from "./tools-occupancy";
import { bucketRange } from "./buckets";
import { McpArgError } from "./types";
import type { OccupancyRollup } from "@/lib/db";

// Builds a fixture with REAL per-day occupied/inventory/roomRev/ooo, not just
// the derived pOcc percentage. This is deliberately richer than the shape
// getOccupancyRollup used to return, because reconstructing per-day counts
// from a whole-period average (the brief's original approach) is only exact
// when inventory is constant across the period — see the "varying inventory"
// test below, which is the case that approach gets wrong. lib/db.ts was
// extended (additively) to carry these per-day fields for exactly this reason.
const rollup = (
  code: string,
  days: { day: string; occ: number; inv: number; rev?: number; ooo?: number }[],
): OccupancyRollup => ({
  code,
  occupied: days.reduce((n, d) => n + d.occ, 0),
  inventory: days.reduce((n, d) => n + d.inv, 0),
  transientNights: 0,
  leaseNights: 0,
  roomRev: days.reduce((n, d) => n + (d.rev ?? 0), 0),
  ooo: days.reduce((n, d) => n + (d.ooo ?? 0), 0),
  days: days.map((d) => ({
    day: d.day,
    pOcc: d.occ / d.inv,
    occupied: d.occ,
    inventory: d.inv,
    roomRev: d.rev ?? 0,
    ooo: d.ooo ?? 0,
  })),
});

describe("rollupToRows", () => {
  it("computes occupancy as a ratio of sums, not a mean of daily rates", () => {
    // 60/100 on day one, 20/50 on day two. Ratio of sums = 80/150 = 53.3%.
    // Mean of rates would be (60% + 40%) / 2 = 50% — the wrong answer.
    const r = rollup("LL", [
      { day: "2026-08-01", occ: 60, inv: 100 },
      { day: "2026-08-02", occ: 20, inv: 50 },
    ]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-02", "weekly"), ["LL"]);
    expect(rows[0].occupancyPct).toBeCloseTo(80 / 150, 6);
    expect(rows[0].occupancyPct).not.toBeCloseTo(0.5, 3);
  });

  it("splits days across daily buckets, exactly, even though inventory varies day to day", () => {
    // Inventory is NOT constant across the period (100 then 50) — the case
    // where reconstructing per-day counts from the period average would be
    // wrong. Summing real per-day counts must still get each day exactly right.
    const r = rollup("LL", [
      { day: "2026-08-01", occ: 60, inv: 100 },
      { day: "2026-08-02", occ: 20, inv: 50 },
    ]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-02", "daily"), ["LL"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ occupancyPct: expect.closeTo(0.6, 6), occupiedNights: 60, inventoryNights: 100 });
    expect(rows[1]).toMatchObject({ occupancyPct: expect.closeTo(0.4, 6), occupiedNights: 20, inventoryNights: 50 });
  });

  it("carries the bucket's real dates and its partial flag", () => {
    const r = rollup("LL", [{ day: "2026-08-05", occ: 50, inv: 100 }]);
    const rows = rollupToRows([r], bucketRange("2026-08-05", "2026-08-09", "weekly"), ["LL"]);
    expect(rows[0]).toMatchObject({ from: "2026-08-05", to: "2026-08-09", partial: true });
  });

  // A day with no banked capture must not become a zero-occupancy day.
  it("returns null occupancy for a bucket with no data, never 0", () => {
    const r = rollup("LL", [{ day: "2026-08-01", occ: 60, inv: 100 }]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-02", "daily"), ["LL"]);
    expect(rows[1].occupancyPct).toBeNull();
    expect(rows[1].inventoryNights).toBe(0);
    expect(rows[1].adr).toBeNull();
    expect(rows[1].revpar).toBeNull();
  });

  it("emits a row per requested property even when one has no data at all", () => {
    const r = rollup("LL", [{ day: "2026-08-01", occ: 60, inv: 100 }]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-01", "daily"), ["LL", "DP"]);
    expect(rows.map((x) => x.code).sort()).toEqual(["DP", "LL"]);
    expect(rows.find((x) => x.code === "DP")!.occupancyPct).toBeNull();
  });

  it("derives ADR and RevPAR from the same summed room revenue", () => {
    const r = rollup("LL", [
      { day: "2026-08-01", occ: 60, inv: 100, rev: 6000 },
      { day: "2026-08-02", occ: 20, inv: 50, rev: 2200 },
    ]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-02", "weekly"), ["LL"]);
    // occupied 80, revenue 8200 -> adr 102.5; inventory 150 -> revpar 54.67
    // (rows round money figures to cents, so revpar is 2dp, not exact)
    expect(rows[0].adr).toBeCloseTo(8200 / 80, 6);
    expect(rows[0].revpar).toBeCloseTo(8200 / 150, 2);
    expect(rows[0].roomRevenue).toBeCloseTo(8200, 6);
  });

  it("sums out-of-order nights within the bucket", () => {
    const r = rollup("LL", [
      { day: "2026-08-01", occ: 60, inv: 100, ooo: 3 },
      { day: "2026-08-02", occ: 20, inv: 50, ooo: 5 },
    ]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-02", "weekly"), ["LL"]);
    expect(rows[0].oooNights).toBe(8);
  });

  it("returns no guest-identifying field", () => {
    const r = rollup("LL", [{ day: "2026-08-01", occ: 60, inv: 100 }]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-01", "daily"), ["LL"]);
    expect(Object.keys(rows[0]).join(" ")).not.toMatch(/name|guest|email|phone/i);
  });
});

describe("OCCUPANCY_TOOLS", () => {
  it("declares list_properties, get_occupancy and get_portfolio_summary", () => {
    expect(OCCUPANCY_TOOLS.map((t) => t.name).sort()).toEqual([
      "get_occupancy",
      "get_portfolio_summary",
      "list_properties",
    ]);
  });

  it("list_properties returns the 8 properties with freshness attached", async () => {
    const tool = OCCUPANCY_TOOLS.find((t) => t.name === "list_properties")!;
    const { data, freshness } = await tool.handler({});
    expect((data as any).properties.length).toBe(8);
    expect(freshness).toBeTruthy();
    // "config", not "snapshot" — the property list is static config, never
    // a measured figure (lib/mcp/types.ts Freshness).
    expect(freshness.source).toBe("config");
  });

  it("get_occupancy surfaces excluded properties rather than silently dropping them", async () => {
    const tool = OCCUPANCY_TOOLS.find((t) => t.name === "get_occupancy")!;
    const { data } = await tool.handler({ from: "2026-08-01", to: "2026-08-01", granularity: "daily" });
    expect(data as any).toHaveProperty("excluded");
    expect(Array.isArray((data as any).excluded)).toBe(true);
  });

  it("get_occupancy rejects an unknown property, naming valid options", async () => {
    const tool = OCCUPANCY_TOOLS.find((t) => t.name === "get_occupancy")!;
    await expect(
      tool.handler({ from: "2026-08-01", to: "2026-08-01", properties: ["Lakeside"] }),
    ).rejects.toThrow(/Lakeside/);
  });

  it("get_portfolio_summary returns mtd, ytd and excluded, each with freshness", async () => {
    const tool = OCCUPANCY_TOOLS.find((t) => t.name === "get_portfolio_summary")!;
    const { data, freshness } = await tool.handler({ asOf: "2026-08-10" });
    expect(data as any).toHaveProperty("mtd");
    expect(data as any).toHaveProperty("ytd");
    expect(data as any).toHaveProperty("excluded");
    expect(freshness).toBeTruthy();
  });

  // asOf used to reach getOccupancyRollup unchecked — a malformed date would
  // silently build a garbage yearStart string rather than erroring.
  it("get_portfolio_summary rejects a malformed asOf, naming the argument", async () => {
    const tool = OCCUPANCY_TOOLS.find((t) => t.name === "get_portfolio_summary")!;
    await expect(tool.handler({ asOf: "not-a-date" })).rejects.toThrow(McpArgError);
    await expect(tool.handler({ asOf: "not-a-date" })).rejects.toThrow(/asOf/);
  });

  it("get_portfolio_summary rejects a calendar-impossible asOf (Feb 30)", async () => {
    const tool = OCCUPANCY_TOOLS.find((t) => t.name === "get_portfolio_summary")!;
    await expect(tool.handler({ asOf: "2026-02-30" })).rejects.toThrow(McpArgError);
  });

  it("no declared tool exposes a guest-identifying field on its handler output shape", async () => {
    for (const tool of OCCUPANCY_TOOLS) {
      const args =
        tool.name === "get_occupancy"
          ? { from: "2026-08-01", to: "2026-08-01" }
          : tool.name === "get_portfolio_summary"
            ? { asOf: "2026-08-10" }
            : {};
      const { data } = await tool.handler(args);
      // Property names (e.g. "Jacksonville North") legitimately appear in
      // list_properties and in `excluded` — this checks for GUEST identity,
      // not the absence of the word "name".
      expect(JSON.stringify(data)).not.toMatch(/guest|email|phone/i);
    }
  });
});
