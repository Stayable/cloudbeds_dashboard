import { describe, it, expect } from "vitest";
import { liveRows } from "./tools-live";
import type { PropertyDashboard, PropertyOoo, DashboardData, OooRoom } from "@/lib/cloudbeds";
import type { Property } from "@/config/properties";

// Fixture conventions mirror lib/occupancy.test.ts and lib/ops-pdf-ooo.test.ts —
// PropertyDashboard/PropertyOoo wrap a Property + a CloudbedsResult, they are
// not flat rows. `arrivals`/`departures` are STRINGS on the real DashboardData
// (verified in lib/cloudbeds.ts), and there is no `roomsSold` field — the real
// name is `roomsOccupied`. There is likewise no `ooo` field on PropertyOoo;
// its `result.data` is a per-room OooRoom[] that must be summarized.

function property(overrides: Partial<Property>): Property {
  return {
    id: "0",
    code: "XX",
    apiPropertyId: "1",
    name: "Test Property",
    county: "Polk",
    active: true,
    ...overrides,
  };
}

function dashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    property_now: "2026-08-11 10:00:00",
    timezone: "America/New_York",
    gmt_offset_hours: -4,
    roomsOccupied: 92,
    percentageOccupied: 73.8,
    arrivals: "3",
    departures: "5",
    inHouse: 90,
    guestsInHouse: 120,
    arrivalsConfirmed: 2,
    departuresConfirmed: 4,
    bookings: 2,
    stayovers: 85,
    cancellations: 0,
    roomsBlocked: 4,
    roomBlocks: { blocked_dates: 0, out_of_service: 4 },
    percentageBlocked: 4,
    capacity: 157,
    ...overrides,
  };
}

function oooRoom(overrides: Partial<OooRoom> = {}): OooRoom {
  return {
    room: "101",
    roomType: "Studio",
    roomTypeCode: "1DS",
    reason: "Renovation",
    startDate: "2026-08-11",
    endDate: "2026-08-11",
    category: "ooo",
    ...overrides,
  };
}

describe("liveRows", () => {
  it("pairs dashboard counts with out-of-order rooms per property", () => {
    const portfolio: PropertyDashboard[] = [
      {
        property: property({ id: "4645", code: "LL", name: "Lakeland" }),
        configured: true,
        result: { ok: true, data: dashboardData() },
        physicalRooms: null,
      },
    ];
    const ooo: PropertyOoo[] = [
      {
        property: property({ id: "4645", code: "LL", name: "Lakeland" }),
        configured: true,
        result: { ok: true, data: [oooRoom(), oooRoom({ room: "102" }), oooRoom({ room: "103", category: "other" })] },
      },
    ];
    const rows = liveRows(portfolio, ooo, ["LL"]);
    expect(rows[0]).toMatchObject({
      code: "LL",
      arrivals: 3,
      departures: 5,
      inHouse: 90,
      roomsSold: 92,
      oooRooms: 2, // only the "ooo" category counts — "other" blocks are a separate figure
    });
    expect(rows[0].unavailable).toBe(false);
  });

  // The 429-zeros lesson: a property whose fetch failed must not report zero
  // arrivals, because zero is a perfectly plausible number.
  it("marks a property unavailable rather than reporting zeros when the dashboard read failed entirely", () => {
    const rows = liveRows([], [], ["LL"]);
    expect(rows[0].unavailable).toBe(true);
    expect(rows[0].arrivals).toBeNull();
    expect(rows[0].roomsSold).toBeNull();
    expect(rows[0].note).toMatch(/could not be read/i);
  });

  it("marks a property unavailable when it has no Cloudbeds key configured", () => {
    const portfolio: PropertyDashboard[] = [
      { property: property({ id: "4645", code: "LL", name: "Lakeland" }), configured: false, result: null, physicalRooms: null },
    ];
    const rows = liveRows(portfolio, [], ["LL"]);
    expect(rows[0].unavailable).toBe(true);
    expect(rows[0].arrivals).toBeNull();
  });

  it("marks a property unavailable when the dashboard call returned an error result", () => {
    const portfolio: PropertyDashboard[] = [
      {
        property: property({ id: "4645", code: "LL", name: "Lakeland" }),
        configured: true,
        result: { ok: false, status: 429, error: "Cloudbeds returned HTTP 429" },
        physicalRooms: null,
      },
    ];
    const rows = liveRows(portfolio, [], ["LL"]);
    expect(rows[0].unavailable).toBe(true);
    expect(rows[0].arrivals).toBeNull();
  });

  it("still reports counts when only the out-of-order read failed", () => {
    const portfolio: PropertyDashboard[] = [
      {
        property: property({ id: "4645", code: "LL", name: "Lakeland" }),
        configured: true,
        result: { ok: true, data: dashboardData() },
        physicalRooms: null,
      },
    ];
    const rows = liveRows(portfolio, [], ["LL"]);
    expect(rows[0].unavailable).toBe(false);
    expect(rows[0].arrivals).toBe(3);
    expect(rows[0].oooRooms).toBeNull();
  });

  // Mirror of the previous test: the OOO read succeeds while the DASHBOARD
  // read fails. oooRooms is computed unconditionally, before the unavailable
  // branch, so it must survive here as the real summarised count — not null,
  // and not 0 (0 would be exactly the manufactured-zero failure mode this
  // task exists to prevent, just moved to a different field).
  it("still reports the out-of-order count when only the dashboard read failed", () => {
    const portfolio: PropertyDashboard[] = [
      {
        property: property({ id: "4645", code: "LL", name: "Lakeland" }),
        configured: true,
        result: { ok: false, status: 429, error: "Cloudbeds returned HTTP 429" },
        physicalRooms: null,
      },
    ];
    const ooo: PropertyOoo[] = [
      {
        property: property({ id: "4645", code: "LL", name: "Lakeland" }),
        configured: true,
        result: { ok: true, data: [oooRoom(), oooRoom({ room: "102" })] },
      },
    ];
    const rows = liveRows(portfolio, ooo, ["LL"]);
    expect(rows[0].unavailable).toBe(true);
    expect(rows[0].arrivals).toBeNull();
    expect(rows[0].oooRooms).toBe(2);
  });

  it("still reports counts when the out-of-order key is unconfigured but the dashboard key is", () => {
    const portfolio: PropertyDashboard[] = [
      {
        property: property({ id: "4645", code: "LL", name: "Lakeland" }),
        configured: true,
        result: { ok: true, data: dashboardData() },
        physicalRooms: null,
      },
    ];
    const ooo: PropertyOoo[] = [
      { property: property({ id: "4645", code: "LL", name: "Lakeland" }), configured: false, result: null },
    ];
    const rows = liveRows(portfolio, ooo, ["LL"]);
    expect(rows[0].unavailable).toBe(false);
    expect(rows[0].oooRooms).toBeNull();
  });

  it("returns no guest-identifying field", () => {
    const portfolio: PropertyDashboard[] = [
      {
        property: property({ id: "4645", code: "LL", name: "Lakeland" }),
        configured: true,
        result: { ok: true, data: dashboardData() },
        physicalRooms: null,
      },
    ];
    const ooo: PropertyOoo[] = [
      { property: property({ id: "4645", code: "LL", name: "Lakeland" }), configured: true, result: { ok: true, data: [oooRoom()] } },
    ];
    const rows = liveRows(portfolio, ooo, ["LL"]);
    expect(Object.keys(rows[0]).join(" ")).not.toMatch(/name|guest|email|phone/i);
  });
});
