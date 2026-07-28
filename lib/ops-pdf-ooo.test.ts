import { describe, it, expect } from "vitest";
import { renderOooPdf } from "./ops-pdf-ooo";
import type { PropertyOoo, PropertyDashboard } from "@/lib/cloudbeds";
import type { Property } from "@/config/properties";

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

function dashboard(capacity: number): PropertyDashboard["result"] {
  return {
    ok: true,
    data: {
      property_now: "2026-07-21 09:00:00",
      timezone: "America/New_York",
      gmt_offset_hours: -4,
      roomsOccupied: 80,
      percentageOccupied: 80,
      arrivals: "5",
      departures: "3",
      inHouse: 80,
      guestsInHouse: 100,
      arrivalsConfirmed: 5,
      departuresConfirmed: 3,
      bookings: 5,
      stayovers: 75,
      cancellations: 0,
      roomsBlocked: 2,
      roomBlocks: { blocked_dates: 0, out_of_service: 2 },
      percentageBlocked: 2,
      capacity,
    },
  };
}

describe("renderOooPdf", () => {
  it("returns a non-empty PDF buffer for a synthetic portfolio", () => {
    const ooo: PropertyOoo[] = [
      {
        property: property({ id: "4645", code: "AA", name: "Alpha" }),
        configured: true,
        result: {
          ok: true,
          data: [
            {
              room: "101",
              roomType: "Studio",
              roomTypeCode: "1DS",
              reason: "Renovation",
              startDate: "2026-07-01",
              endDate: "2026-07-31",
              category: "ooo",
            },
            {
              room: "102",
              roomType: "Studio",
              roomTypeCode: "1DS",
              reason: "Renovation",
              startDate: "2026-07-01",
              endDate: "2026-07-31",
              category: "ooo",
            },
            {
              room: "103",
              roomType: "Studio",
              roomTypeCode: "1DS",
              reason: "",
              startDate: "2026-07-01",
              endDate: "2026-07-31",
              category: "other",
            },
          ],
        },
      },
      {
        property: property({ id: "2295", code: "BB", name: "Bravo" }),
        configured: true,
        result: { ok: true, data: [] },
      },
      {
        property: property({ id: "812", code: "CC", name: "Charlie" }),
        configured: false,
        result: null,
      },
    ];
    const portfolio: PropertyDashboard[] = [
      { property: property({ id: "4645", code: "AA", name: "Alpha" }), configured: true, result: dashboard(50), physicalRooms: { count: 50, source: "getRooms" } },
      { property: property({ id: "2295", code: "BB", name: "Bravo" }), configured: true, result: dashboard(80), physicalRooms: { count: 80, source: "getRooms" } },
      { property: property({ id: "812", code: "CC", name: "Charlie" }), configured: false, result: null, physicalRooms: null },
    ];

    const buf = renderOooPdf(ooo, portfolio, "2026-07-21");
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
