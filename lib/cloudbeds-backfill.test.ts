import { describe, it, expect } from "vitest";
import { sumRevenueByClass } from "./cloudbeds";

// Pure classify+sum helper backing backfillRevenue's getRoomRevenueByPlanDay
// (see revenue-backfill-brief.md). Does NOT touch the DB or Cloudbeds — those
// are exercised live, not in unit tests.
describe("sumRevenueByClass", () => {
  it("splits transient vs lease revenue by rate-plan classification", () => {
    const r = sumRevenueByClass([
      { plan: "Base Rate", amount: 300.0 },
      { plan: "Monthly Lease", amount: 2000.0 },
      { plan: "Weekly Lease", amount: 500.0 },
      { plan: "Discounted Weekly Rate", amount: 192.05 },
    ]);
    expect(r.transient).toBeCloseTo(492.05, 2);
    expect(r.lease).toBeCloseTo(2500.0, 2);
  });

  it("empty input -> zeros", () => {
    expect(sumRevenueByClass([])).toEqual({ transient: 0, lease: 0 });
  });

  it("a multi-plan comma-joined string classifies as lease if any segment matches", () => {
    const r = sumRevenueByClass([{ plan: "Base Rate, Monthly Lease", amount: 100 }]);
    expect(r.lease).toBe(100);
    expect(r.transient).toBe(0);
  });

  it("long term keyword classifies as lease", () => {
    const r = sumRevenueByClass([{ plan: "Long Term Special", amount: 250 }]);
    expect(r.lease).toBe(250);
    expect(r.transient).toBe(0);
  });
});
