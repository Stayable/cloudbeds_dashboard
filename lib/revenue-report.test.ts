import { describe, it, expect } from "vitest";
import { derive, variance, sumSnapshotRows } from "./revenue-report";

describe("derive", () => {
  it("computes Davenport Yesterday rows", () => {
    const d = derive({ transientNights:10, leaseNights:84, otherBlocks:1, ooo:2,
      inventory:153, transientRev:492.05, leaseRev:2706.13 });
    expect(d.occupied).toBe(95);
    expect(d.available).toBe(56);
    expect(d.roomRev).toBeCloseTo(3198.18, 2);
    expect(d.pOcc).toBeCloseTo(95/153, 5);
    expect(d.adrCombined).toBeCloseTo(3198.18/95, 2);
    expect(d.adrTransient).toBeCloseTo(492.05/10, 2);
    expect(d.revpar).toBeCloseTo(3198.18/153, 2);
    expect(d.occAdjLess20).toBeNull();
  });
  it("KE adjusted occupancy uses inventory minus 20*days", () => {
    const d = derive({ transientNights:16, leaseNights:103, otherBlocks:0, ooo:30,
      inventory:167, transientRev:771.14, leaseRev:3223.40 }, { keDays:1 });
    expect(d.occAdjLess20).toBeCloseTo(119/147, 4);
  });
  it("guards divide-by-zero (no prior-year inventory)", () => {
    const d = derive({ transientNights:0, leaseNights:0, otherBlocks:0, ooo:0,
      inventory:0, transientRev:0, leaseRev:0 });
    expect(d.pOcc).toBe(0); expect(d.adrCombined).toBe(0);
  });
  it("variance returns null when a side is null", () => {
    expect(variance(10, 4)).toBe(6);
    expect(variance(10, null)).toBeNull();
  });
});

describe("sumSnapshotRows", () => {
  it("element-wise sums daily rows", () => {
    const r = sumSnapshotRows([
      { transientNights:10, leaseNights:84, otherBlocks:1, ooo:2, inventory:153, transientRev:492.05, leaseRev:2706.13 },
      { transientNights:8,  leaseNights:83, otherBlocks:3, ooo:2, inventory:153, transientRev:368.50, leaseRev:2675.56 },
    ]);
    expect(r.transientNights).toBe(18);
    expect(r.leaseNights).toBe(167);
    expect(r.ooo).toBe(4);
    expect(r.inventory).toBe(306);
    expect(r.transientRev).toBeCloseTo(860.55, 2);
  });
  it("empty → zeros", () => {
    expect(sumSnapshotRows([])).toEqual({ transientNights:0, leaseNights:0, otherBlocks:0, ooo:0, inventory:0, transientRev:0, leaseRev:0 });
  });
});
