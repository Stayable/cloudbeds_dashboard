import { describe, it, expect } from "vitest";
import { rollupToRows, portfolioRows, OCCUPANCY_TOOLS } from "./tools-occupancy";
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
    expect(rows[1].inventoryNights).toBeNull();
    expect(rows[1].adr).toBeNull();
    expect(rows[1].revpar).toBeNull();
  });

  // Important 3 (final review): the ratios weren't the only zeros-in-disguise
  // — occupiedNights/roomRevenue/oooNights came back as literal 0 for a
  // no-data bucket too, which a model will happily quote as "$0 revenue" or
  // "0 rooms sold" rather than "we don't know". All four counts must be null.
  it("nulls all four count fields (not just the ratios) for a bucket with zero banked days", () => {
    const r = rollup("LL", [{ day: "2026-08-01", occ: 60, inv: 100, rev: 6000, ooo: 3 }]);
    const rows = rollupToRows([r], bucketRange("2026-08-01", "2026-08-02", "daily"), ["LL"]);
    expect(rows[1]).toMatchObject({
      occupiedNights: null,
      inventoryNights: null,
      roomRevenue: null,
      oooNights: null,
    });
    // The day that DOES have data keeps real numbers, not nulls.
    expect(rows[0]).toMatchObject({ occupiedNights: 60, inventoryNights: 100, roomRevenue: 6000, oooNights: 3 });
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

// Critical 2 (final review): neither get_occupancy nor get_portfolio_summary
// computed a portfolio figure at all — the model was left to average
// occupancyPct across properties (a mean of ratios, exactly what spec §5
// forbids) and as likely to fold in Jacksonville North (excludeFromAggregate)
// as not, because propertySummary had no field saying it should be excluded.
describe("portfolioRows", () => {
  it("is a ratio of sums across properties within a bucket, not a mean of occupancyPct", () => {
    // LL: 60/100 = 60%. DP: 10/50 = 20%. Mean would be 40%; ratio of sums is
    // (60+10)/(100+50) = 46.67%, the same rule rollupToRows already applies
    // across days within one property.
    const ll = rollup("LL", [{ day: "2026-08-01", occ: 60, inv: 100 }]);
    const dp = rollup("DP", [{ day: "2026-08-01", occ: 10, inv: 50 }]);
    const rows = rollupToRows([ll, dp], bucketRange("2026-08-01", "2026-08-01", "daily"), ["LL", "DP"]);
    const portfolio = portfolioRows(rows);
    expect(portfolio).toHaveLength(1);
    expect(portfolio[0].occupancyPct).toBeCloseTo(70 / 150, 6);
    expect(portfolio[0].occupancyPct).not.toBeCloseTo(0.4, 3);
  });

  it("excludes Jacksonville North (excludeFromAggregate) from the total, naming it in includedCodes/not", () => {
    const ll = rollup("LL", [{ day: "2026-08-01", occ: 60, inv: 100 }]);
    // JN with an enormous count that WOULD move the total if it leaked in.
    const jn = rollup("JN", [{ day: "2026-08-01", occ: 1000, inv: 1000 }]);
    const rows = rollupToRows([ll, jn], bucketRange("2026-08-01", "2026-08-01", "daily"), ["LL", "JN"]);
    const portfolio = portfolioRows(rows);
    expect(portfolio).toHaveLength(1);
    expect(portfolio[0].occupancyPct).toBeCloseTo(0.6, 6); // LL alone, not diluted by JN
    expect(portfolio[0].includedCodes).toEqual(["LL"]);
  });

  it("names a property with no banked data for the bucket in missingCodes, without zeroing the total", () => {
    const ll = rollup("LL", [{ day: "2026-08-01", occ: 60, inv: 100, rev: 6000 }]);
    // DP has no days at all in this range -> rollupToRows nulls its row.
    const rows = rollupToRows([ll], bucketRange("2026-08-01", "2026-08-01", "daily"), ["LL", "DP"]);
    const portfolio = portfolioRows(rows);
    expect(portfolio[0].missingCodes).toEqual(["DP"]);
    expect(portfolio[0].includedCodes).toEqual(["LL"]);
    expect(portfolio[0].roomRevenue).toBe(6000); // LL's real revenue, not diluted to 0 by DP's gap
  });

  it("returns an all-null bucket, not a zeroed one, when every non-excluded property is missing data", () => {
    const rows = rollupToRows([], bucketRange("2026-08-01", "2026-08-01", "daily"), ["LL", "DP"]);
    const portfolio = portfolioRows(rows);
    expect(portfolio[0]).toMatchObject({
      occupiedNights: null,
      inventoryNights: null,
      occupancyPct: null,
      roomRevenue: null,
      adr: null,
      revpar: null,
      oooNights: null,
      includedCodes: [],
      missingCodes: ["DP", "LL"],
    });
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

  // Critical 2: get_occupancy's own rows have no portfolio total unless this
  // is wired up — the DB call fails offline (no DATABASE_URL in tests) and
  // returns [], so this only proves the field exists and is well-formed, not
  // that it holds real numbers; portfolioRows itself is exercised directly above.
  it("get_occupancy returns a portfolio array alongside rows", async () => {
    const tool = OCCUPANCY_TOOLS.find((t) => t.name === "get_occupancy")!;
    const { data } = await tool.handler({ from: "2026-08-01", to: "2026-08-01", granularity: "daily" });
    expect(Array.isArray((data as any).portfolio)).toBe(true);
  });

  it("get_occupancy rejects an unknown property, naming valid options", async () => {
    const tool = OCCUPANCY_TOOLS.find((t) => t.name === "get_occupancy")!;
    await expect(
      tool.handler({ from: "2026-08-01", to: "2026-08-01", properties: ["Lakeside"] }),
    ).rejects.toThrow(/Lakeside/);
  });

  it("get_portfolio_summary returns mtd, ytd, portfolio and excluded, each with freshness", async () => {
    const tool = OCCUPANCY_TOOLS.find((t) => t.name === "get_portfolio_summary")!;
    const { data, freshness } = await tool.handler({ asOf: "2026-08-10" });
    expect(data as any).toHaveProperty("mtd");
    expect(data as any).toHaveProperty("ytd");
    expect(data as any).toHaveProperty("excluded");
    expect((data as any).portfolio).toHaveProperty("mtd");
    expect((data as any).portfolio).toHaveProperty("ytd");
    expect(freshness).toBeTruthy();
  });

  // Important 5: the composition caveat (banked-only MTD vs. /report's
  // banked+live MTD) must ride along with the answer, not just live in the
  // tool's one-time description.
  it("get_portfolio_summary's freshness note states the MTD composition caveat", async () => {
    const tool = OCCUPANCY_TOOLS.find((t) => t.name === "get_portfolio_summary")!;
    const { freshness } = await tool.handler({ asOf: "2026-08-10" });
    expect(freshness.note).toMatch(/banked days only/i);
    expect(freshness.note).toMatch(/not the same composition/i);
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
