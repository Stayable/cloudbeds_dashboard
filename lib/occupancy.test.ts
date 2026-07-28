import { describe, expect, it } from "vitest";
import { buildOccProperties } from "@/lib/occupancy";
import type { DashboardData, PropertyDashboard, PropertyInsights } from "@/lib/cloudbeds";
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

const insights: PropertyInsights[] = [
  {
    property: KE,
    configured: true,
    result: { ok: true, data: [{ date: "2026-07-27", occupancy: 73.81, adr: 90, revpar: 66 }] },
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

    const [ke] = buildOccProperties(portfolio, insights);
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

    const [ke] = buildOccProperties(portfolio, insights);
    expect(ke.capacity).toBe(168);
  });

  it("still reports zero capacity when the property has no dashboard result", () => {
    const portfolio: PropertyDashboard[] = [
      { property: KE, configured: false, result: null, physicalRooms: null },
    ];

    const [ke] = buildOccProperties(portfolio, insights);
    expect(ke.capacity).toBe(0);
    expect(ke.live).toBeNull();
  });
});
