import { describe, expect, it } from "vitest";
import { buildOccProperties, displayOcc, adjustedOcc } from "@/lib/occupancy";
import type { DashboardData, PropertyDashboard } from "@/lib/cloudbeds";
import type { OccupancyRollup } from "@/lib/db";
import type { Property } from "@/config/properties";

// Kissimmee East is the live case: /getRooms lists 167 rooms, but
// getDashboard.capacity reports 168 — an aggregate-only phantom room that is
// absent from the per-room-type counts (audited 07/28/26 across all 8
// properties; Lakeland 157/157 is the clean control). The occupancy views must
// show real rooms, not the inflated aggregate.
const KE: Property = {
  id: "2295",
  code: "KE",
  apiPropertyId: "210986",
  name: "Kissimmee East",
  county: "Osceola",
  active: true,
  capacityAdjustment: -20,
  adjustmentNote: "20 rooms out for renovation",
};

function dashboard(capacity: number): DashboardData {
  return {
    property_now: "2026-07-27 10:00:00",
    timezone: "America/New_York",
    gmt_offset_hours: -4,
    roomsOccupied: 124,
    percentageOccupied: 73.8,
    arrivals: "9",
    departures: "7",
    inHouse: 124,
    guestsInHouse: 190,
    arrivalsConfirmed: 6,
    departuresConfirmed: 5,
    bookings: 4,
    stayovers: 115,
    cancellations: 1,
    roomsBlocked: 0,
    roomBlocks: { blocked_dates: 0, out_of_service: 0 },
    percentageBlocked: 0,
    capacity,
  };
}

// One banked day: 123 occupied of 167 inventory, $4,363.55 room revenue.
// These are KE's real 2026-07-30 figures, so the derived percentages below are
// the ones /report publishes for that day.
const rollup: OccupancyRollup[] = [
  {
    code: "KE",
    occupied: 123,
    inventory: 167,
    transientNights: 26,
    leaseNights: 96,
    roomRev: 4363.55,
    ooo: 24,
    days: [{ day: "2026-07-30", pOcc: 123 / 167 }],
  },
];

describe("buildOccProperties inventory source", () => {
  it("prefers the room-list count over the inflated getDashboard capacity", () => {
    const portfolio: PropertyDashboard[] = [
      {
        property: KE,
        configured: true,
        result: { ok: true, data: dashboard(168) },
        physicalRooms: { count: 167, source: "getRooms" },
      },
    ];

    const [ke] = buildOccProperties(portfolio, rollup);
    expect(ke.capacity).toBe(167);
    expect(ke.live?.capacity).toBe(167);
  });

  it("falls back to getDashboard capacity when the room list is unavailable", () => {
    const portfolio: PropertyDashboard[] = [
      {
        property: KE,
        configured: true,
        result: { ok: true, data: dashboard(168) },
        physicalRooms: { count: 168, source: "getDashboard" },
      },
    ];

    const [ke] = buildOccProperties(portfolio, rollup);
    expect(ke.capacity).toBe(168);
  });

  it("still reports zero capacity when the property has no dashboard result", () => {
    const portfolio: PropertyDashboard[] = [
      { property: KE, configured: false, result: null, physicalRooms: null },
    ];

    const [ke] = buildOccProperties(portfolio, rollup);
    expect(ke.capacity).toBe(0);
    expect(ke.live).toBeNull();
  });
});

describe("occupancy is derived from snapshots, not Data Insights", () => {
  const portfolio: PropertyDashboard[] = [
    {
      property: KE,
      configured: true,
      result: { ok: true, data: dashboard(168) },
      physicalRooms: { count: 167, source: "getRooms" },
    },
  ];

  it("computes occupancy as occupied / inventory, matching /report", () => {
    const [ke] = buildOccProperties(portfolio, rollup);
    // 123/167 = 73.65%. Data Insights reported 73.81% for the same day because
    // it divides rooms SOLD by a capacity of 168. That 0.6pp is the bug.
    expect(ke.rawOcc).toBeCloseTo((123 / 167) * 100, 6);
  });

  it("derives ADR and RevPAR from the same banked revenue", () => {
    const [ke] = buildOccProperties(portfolio, rollup);
    expect(ke.adr).toBeCloseTo(4363.55 / 123, 6);
    expect(ke.revpar).toBeCloseTo(4363.55 / 167, 6);
  });

  it("carries the raw sums so a portfolio figure can be weighted correctly", () => {
    const [ke] = buildOccProperties(portfolio, rollup);
    expect(ke.occupiedNights).toBe(123);
    expect(ke.inventoryNights).toBe(167);
    expect(ke.roomRev).toBeCloseTo(4363.55, 6);
  });

  it("does NOT bake KE's -20 adjustment into the headline occupancy", () => {
    // This is the regression that made /ops read 83.0% where /report read 73.7%.
    const [ke] = buildOccProperties(portfolio, rollup);
    expect(displayOcc(ke)).toBe(ke.rawOcc);
  });

  it("exposes the adjusted figure separately, as /report's own extra row does", () => {
    const [ke] = buildOccProperties(portfolio, rollup);
    // 123 / (167 - 20) = 83.67%
    expect(adjustedOcc(ke)).toBeCloseTo((123 / 147) * 100, 4);
  });

  it("returns null adjusted occupancy for a property with no adjustment", () => {
    expect(adjustedOcc({ rawOcc: 80, capacity: 157, adjustment: 0 })).toBeNull();
  });

  it("yields nulls, not zeros, for a property with no banked days in range", () => {
    const [ke] = buildOccProperties(portfolio, []);
    expect(ke.rawOcc).toBeNull();
    expect(ke.adr).toBeNull();
    expect(ke.revpar).toBeNull();
    expect(ke.daily).toEqual([]);
  });
});
