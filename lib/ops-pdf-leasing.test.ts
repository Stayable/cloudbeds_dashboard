import { describe, it, expect } from "vitest";
import { renderLeasingPdf } from "./ops-pdf-leasing";
import { FUNNEL_STAGES, STAGE, type LeasingView } from "@/lib/leasing";

// Derived from FUNNEL_STAGES rather than a hand-written label map. The 08/07/26
// stage rename found that this fixture's own copy of the keys kept the suite
// green while the real PDF rendered zeros — the fixture must not be able to
// disagree with the app about what a stage is called.
function stages(counts: Partial<Record<string, number>>) {
  return FUNNEL_STAGES.map((s) => ({ key: s.key, label: s.label, n: counts[s.key] ?? 0 }));
}

describe("renderLeasingPdf", () => {
  it("returns a non-empty PDF buffer for a synthetic portfolio", () => {
    const views: LeasingView[] = [
      {
        key: "ALL",
        label: "All properties",
        stages: stages({ [STAGE.leads]: 100, [STAGE.engaged]: 80, [STAGE.toursBooked]: 40, [STAGE.toursAttended]: 30, [STAGE.appsStarted]: 20, [STAGE.appsApproved]: 15, [STAGE.leased]: 10 }),
        cancelled: 5,
        leadToTour: 40,
        tourToLease: 33.3,
        leadToLease: 10,
        tourAttendanceRecorded: null,
        pipeline: [
          { status: "Inquiry", n: 60 },
          { status: "Applicant", n: 20 },
          { status: "Leased", n: 10 },
          { status: "Cancelled", n: 5 },
        ],
      },
      {
        key: "DP",
        label: "Davenport",
        stages: stages({ [STAGE.leads]: 60, [STAGE.engaged]: 50, [STAGE.toursBooked]: 25, [STAGE.toursAttended]: 20, [STAGE.appsStarted]: 12, [STAGE.appsApproved]: 10, [STAGE.leased]: 8 }),
        cancelled: 3,
        leadToTour: 41.7,
        tourToLease: 40,
        leadToLease: 13.3,
        tourAttendanceRecorded: null,
        pipeline: [
          { status: "Inquiry", n: 35 },
          { status: "Applicant", n: 12 },
          { status: "Leased", n: 8 },
        ],
      },
      {
        key: "LL",
        label: "Lakeland",
        stages: stages({ [STAGE.leads]: 40, [STAGE.engaged]: 30, [STAGE.toursBooked]: 15, [STAGE.toursAttended]: 10, [STAGE.appsStarted]: 8, [STAGE.appsApproved]: 5, [STAGE.leased]: 2 }),
        cancelled: 2,
        leadToTour: 37.5,
        tourToLease: 20,
        leadToLease: 5,
        tourAttendanceRecorded: null,
        pipeline: [
          { status: "Inquiry", n: 25 },
          { status: "Applicant", n: 8 },
          { status: "Leased", n: 2 },
          { status: "Cancelled", n: 2 },
        ],
      },
    ];

    const buf = renderLeasingPdf(views, true, { start: "2026-07-01", end: "2026-07-21" });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a valid not-connected PDF when the funnel is empty", () => {
    const buf = renderLeasingPdf([], false, { start: "2026-07-01", end: "2026-07-21" });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
