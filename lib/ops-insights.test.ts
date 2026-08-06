import { describe, it, expect } from "vitest";
import { occupancyInsights, leasingInsights, reviewsInsights, oooInsights } from "./ops-insights";
import { newOpsDoc, finishPdf } from "./ops-pdf-kit";
import type { OccProperty } from "@/components/OccupancyView";
import { FUNNEL_STAGES, STAGE, type LeasingView } from "./leasing";
import type { ReviewsView } from "./reviews";
import type { PropertyOoo } from "./cloudbeds";
import type { Property } from "@/config/properties";

// --- fixtures -----------------------------------------------------------

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
    live: null,
    ...overrides,
  };
}

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

// --- occupancyInsights ----------------------------------------------------

describe("occupancyInsights", () => {
  it("returns the friendly empty-state string when no property has a reading", () => {
    expect(occupancyInsights([])).toEqual(["No occupancy data for this period."]);
    expect(
      occupancyInsights([occProp({ rawOcc: null })]),
    ).toEqual(["No occupancy data for this period."]);
  });

  it("names the leader, the sub-65% laggard, OOO drag, and the weighted portfolio line", () => {
    const props: OccProperty[] = [
      occProp({ code: "AA", name: "Alpha", capacity: 100, rawOcc: 90 }),
      occProp({
        code: "BB",
        name: "Bravo",
        capacity: 100,
        rawOcc: 50,
        live: {
          roomsOccupied: 50,
          capacity: 100,
          inHouse: 50,
          guestsInHouse: 60,
          arrivals: "2",
          arrivalsConfirmed: 2,
          departures: "1",
          departuresConfirmed: 1,
          stayovers: 40,
          roomsBlocked: 15,
          outOfService: 15,
          percentageBlocked: 15,
          bookings: 1,
          cancellations: 0,
        },
      }),
      // Excluded from the aggregate -- should never surface as leader/laggard.
      occProp({ code: "JN", name: "Jax North", capacity: 50, rawOcc: 5, excludeDefault: true }),
    ];
    const out = occupancyInsights(props);
    expect(out).toContain("Alpha leads the portfolio at 90.0% occupancy.");
    expect(out).toContain("Bravo trails the portfolio at 50.0% occupancy.");
    expect(out).toContain("Bravo is below the 65% occupancy target at 50.0%.");
    expect(out).toContain("Bravo has 15 rooms out of order (15.0% of capacity) -- an occupancy drag.");
    expect(out.some((s) => s.startsWith("Portfolio weighted occupancy:"))).toBe(true);
    expect(out.join(" ")).not.toContain("Jax North");
  });
});

// --- leasingInsights --------------------------------------------------------

// Built from FUNNEL_STAGES, not a hand-written copy of the keys. The 08/07/26
// stage rename showed why: this fixture's own literals kept the suite green while
// leasingInsights read zeros from the real (renamed) stages.
function stagesWith(counts: Partial<Record<string, number>>) {
  return FUNNEL_STAGES.map((s) => ({ key: s.key, label: s.label, n: counts[s.key] ?? 0 }));
}

function leasingView(overrides: Partial<LeasingView>): LeasingView {
  return {
    key: "XX",
    label: "Test",
    stages: stagesWith({}),
    cancelled: 0,
    leadToTour: null,
    tourToLease: null,
    tourAttendanceRecorded: null,
    leadToLease: null,
    pipeline: [],
    ...overrides,
  };
}

describe("leasingInsights", () => {
  it("returns the friendly empty-state string with no views", () => {
    expect(leasingInsights([])).toEqual(["No leasing data for this period."]);
  });

  it("names best/worst conversion, a stalled funnel, top cancellations, and the portfolio rate", () => {
    const views: LeasingView[] = [
      leasingView({
        key: "ALL",
        label: "All properties",
        stages: stagesWith({ [STAGE.leads]: 30, [STAGE.leased]: 6 }),
        leadToLease: 20,
      }),
      leasingView({
        key: "AA",
        label: "Alpha",
        stages: stagesWith({ [STAGE.leads]: 20, [STAGE.leased]: 6 }),
        leadToLease: 30,
        cancelled: 2,
      }),
      leasingView({
        key: "BB",
        label: "Bravo",
        stages: stagesWith({ [STAGE.leads]: 10 }),
        leadToLease: 0,
        cancelled: 5,
      }),
    ];
    const out = leasingInsights(views);
    expect(out).toContain("Alpha converts leads to leases best at 30.0%.");
    expect(out).toContain("Bravo converts leads to leases worst at 0.0%.");
    expect(out).toContain("Bravo has 10 leads and zero leases this period -- stalled funnel.");
    expect(out).toContain("Bravo has the most cancellations at 5.");
    expect(out).toContain("Portfolio lead-to-lease conversion: 20.0%.");
  });
});

// --- reviewsInsights --------------------------------------------------------

describe("reviewsInsights", () => {
  it("returns the friendly empty-state string with no reviews", () => {
    const view: ReviewsView = {
      total: 0,
      responded: 0,
      priorTotal: 0,
      from: "2026-07-01",
      to: "2026-07-31",
      priorFrom: "2026-06-01",
      priorTo: "2026-06-30",
      byProperty: [],
    };
    expect(reviewsInsights(view)).toEqual(["No 1-star review data for this period."]);
  });

  it("names the top property, unaddressed count, and an up trend", () => {
    const view: ReviewsView = {
      total: 5,
      responded: 2,
      priorTotal: 3,
      from: "2026-07-01",
      to: "2026-07-31",
      priorFrom: "2026-06-01",
      priorTo: "2026-06-30",
      byProperty: [
        { property: "Alpha", count: 3, responded: 1, priorCount: 1, reviews: [] },
        { property: "Bravo", count: 2, responded: 1, priorCount: 2, reviews: [] },
      ],
    };
    const out = reviewsInsights(view);
    expect(out).toContain("Alpha has the most 1-star reviews this period (3).");
    expect(out).toContain("3 of 5 1-star reviews have no manager response.");
    expect(out).toContain("1-star reviews are up vs the prior period (5 vs 3).");
  });

  it("reports flat and fully-addressed when nothing changed and all have responses", () => {
    const view: ReviewsView = {
      total: 2,
      responded: 2,
      priorTotal: 2,
      from: "2026-07-01",
      to: "2026-07-31",
      priorFrom: "2026-06-01",
      priorTo: "2026-06-30",
      byProperty: [{ property: "Alpha", count: 2, responded: 2, priorCount: 2, reviews: [] }],
    };
    const out = reviewsInsights(view);
    expect(out).toContain("All 2 1-star reviews this period have a manager response.");
    expect(out).toContain("1-star reviews are flat vs the prior period (2).");
  });
});

// --- oooInsights ------------------------------------------------------------

describe("oooInsights", () => {
  it("returns the friendly empty-state string with no configured/ok data", () => {
    const ooo: PropertyOoo[] = [{ property: property({ code: "AA" }), configured: false, result: null }];
    expect(oooInsights(ooo)).toEqual(["No out-of-order data for this period."]);
  });

  it("bases 'most blocked' on TOTAL, splits portfolio OOO vs Other, and keeps top reason", () => {
    const ooo: PropertyOoo[] = [
      {
        property: property({ code: "AA", name: "Alpha" }),
        configured: true,
        result: {
          ok: true,
          data: [
            { room: "101", roomType: "Studio", roomTypeCode: "1DS", reason: "Renovation", startDate: "2026-07-01", endDate: "2026-07-31", category: "ooo" },
            { room: "102", roomType: "Studio", roomTypeCode: "1DS", reason: "Renovation", startDate: "2026-07-01", endDate: "2026-07-31", category: "other" },
          ],
        },
      },
      {
        property: property({ code: "BB", name: "Bravo" }),
        configured: true,
        result: {
          ok: true,
          data: [
            { room: "201", roomType: "Studio", roomTypeCode: "1DS", reason: "Maintenance", startDate: "2026-07-01", endDate: "2026-07-31", category: "ooo" },
          ],
        },
      },
    ];
    const out = oooInsights(ooo);
    // Alpha has 2 TOTAL blocked rooms (1 ooo + 1 other) vs Bravo's 1 -- "most
    // blocked" ranks by total, not just the ooo category.
    expect(out).toContain("Alpha has the most blocked rooms (2).");
    // Portfolio: Alpha(1 ooo, 1 other) + Bravo(1 ooo, 0 other) = 2 ooo, 1 other, 3 total.
    expect(out).toContain("Portfolio total blocked rooms: 3 (2 out-of-order, 1 other blocks).");
    expect(out).toContain("Top block reason: Renovation (2 rooms).");
  });
});

// --- kit smoke test ----------------------------------------------------------

describe("ops-pdf-kit", () => {
  it("finishPdf(newOpsDoc()) returns a non-empty %PDF- buffer", () => {
    const buf = finishPdf(newOpsDoc());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
