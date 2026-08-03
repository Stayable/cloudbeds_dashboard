import { describe, it, expect } from "vitest";
import { renderOccupancyPdf } from "./ops-pdf-occupancy";
import type { OccProperty } from "@/components/OccupancyView";
import type { PropertyInsights } from "@/lib/cloudbeds";
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

function occProp(overrides: Partial<OccProperty>): OccProperty {
  return {
    code: "XX",
    name: "Test Property",
    county: "Polk",
    id: "0",
    configured: true,
    capacity: 100,
    adjustment: 0,
    excludeDefault: false,
    rawOcc: 80,
    daily: [],
    live: {
      roomsOccupied: 80,
      capacity: 100,
      inHouse: 80,
      guestsInHouse: 100,
      arrivals: "5",
      arrivalsConfirmed: 5,
      departures: "3",
      departuresConfirmed: 3,
      stayovers: 75,
      roomsBlocked: 2,
      outOfService: 2,
      percentageBlocked: 2,
      bookings: 5,
      cancellations: 0,
    },
    ...overrides,
  };
}

describe("renderOccupancyPdf", () => {
  it("returns a non-empty PDF buffer for a synthetic portfolio", () => {
    const props: OccProperty[] = [
      occProp({ code: "AA", name: "Alpha", rawOcc: 90 }),
      occProp({ code: "BB", name: "Bravo", rawOcc: 55 }),
      occProp({ code: "CC", name: "Charlie", configured: false, rawOcc: null, live: null }),
    ];
    const insights: PropertyInsights[] = [
      {
        property: property({ code: "AA", name: "Alpha" }),
        configured: true,
        result: {
          ok: true,
          data: [
            { date: "2026-07-01", occupancy: 90, adr: 120, revpar: 108 },
            { date: "2026-07-02", occupancy: 88, adr: 118, revpar: 104 },
          ],
        },
      },
      {
        property: property({ code: "BB", name: "Bravo" }),
        configured: true,
        result: {
          ok: true,
          data: [{ date: "2026-07-01", occupancy: 55, adr: 90, revpar: 49.5 }],
        },
      },
      {
        property: property({ code: "CC", name: "Charlie" }),
        configured: false,
        result: null,
      },
    ];

    const buf = renderOccupancyPdf(props, { start: "2026-07-01", end: "2026-07-02" });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
