import { describe, it, expect } from "vitest";
import { buildReservationSummary } from "@/lib/reservations";
import type { PropertyReservations } from "@/lib/cloudbeds";

function prop(over: Partial<PropertyReservations> = {}): PropertyReservations {
  return {
    property: { code: "DP" } as PropertyReservations["property"],
    configured: true,
    result: null,
    ...over,
  };
}

describe("buildReservationSummary", () => {
  it("sums totals and merges mixes over reporting properties only", () => {
    const list: PropertyReservations[] = [
      prop({
        result: {
          ok: true,
          data: {
            rooms: 10, roomNights: 100, guests: 12, grandTotal: 5000, paid: 4000, balanceDue: 1000,
            statusMix: { "In-House": 6, "Confirmed": 4, "Cancelled": 2 },
            leaseMix: { monthly: 3, weekly: 2, transient: 5, total: 10 },
            roomTypeCategoryMix: { Private: 8, Shared: 2 },
          },
        },
      }),
      prop({
        result: {
          ok: true,
          data: {
            rooms: 5, roomNights: 40, guests: 5, grandTotal: 2500, paid: 2500, balanceDue: 0,
            statusMix: { "In-House": 5, "Confirmed": 1 },
            leaseMix: { monthly: 1, weekly: 0, transient: 4, total: 5 },
            roomTypeCategoryMix: { Private: 5 },
          },
        },
      }),
      // not reporting — must be ignored
      prop({ configured: false, result: null }),
      prop({ result: { ok: false, status: 500, error: "boom" } }),
    ];

    const s = buildReservationSummary(list);
    expect(s.reporting).toBe(2);
    expect(s.rooms).toBe(15);
    expect(s.roomNights).toBe(140);
    expect(s.grandTotal).toBe(7500);
    expect(s.paid).toBe(6500);
    expect(s.balanceDue).toBe(1000);
    expect(s.statusMix).toEqual({ "In-House": 11, "Confirmed": 5, "Cancelled": 2 });
    expect(s.leaseMix).toEqual({ monthly: 4, weekly: 2, transient: 9, total: 15 });
    expect(s.roomTypeCategoryMix).toEqual({ Private: 13, Shared: 2 });
  });

  it("returns zeroed summary when nothing reports", () => {
    const s = buildReservationSummary([prop({ result: { ok: false, status: 0, error: "x" } })]);
    expect(s.reporting).toBe(0);
    expect(s.rooms).toBe(0);
    expect(s.statusMix).toEqual({});
  });
});
