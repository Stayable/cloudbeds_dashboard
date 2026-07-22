import { describe, it, expect } from "vitest";
import { renderLeasingPdf } from "./ops-pdf-leasing";
import type { LeasingView } from "@/lib/leasing";

function stages(counts: Partial<Record<string, number>>) {
  const labels: Record<string, string> = {
    prospect: "Leads",
    prospect_engaged: "Engaged",
    tour_booked: "Tours booked",
    tour_attended: "Tours attended",
    application_started: "Apps started",
    application_approved: "Apps approved",
    lease_completed: "Leased",
  };
  return Object.keys(labels).map((key) => ({ key, label: labels[key], n: counts[key] ?? 0 }));
}

describe("renderLeasingPdf", () => {
  it("returns a non-empty PDF buffer for a synthetic portfolio", () => {
    const views: LeasingView[] = [
      {
        key: "ALL",
        label: "All properties",
        stages: stages({ prospect: 100, prospect_engaged: 80, tour_booked: 40, tour_attended: 30, application_started: 20, application_approved: 15, lease_completed: 10 }),
        cancelled: 5,
        leadToTour: 40,
        tourToLease: 33.3,
        leadToLease: 10,
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
        stages: stages({ prospect: 60, prospect_engaged: 50, tour_booked: 25, tour_attended: 20, application_started: 12, application_approved: 10, lease_completed: 8 }),
        cancelled: 3,
        leadToTour: 41.7,
        tourToLease: 40,
        leadToLease: 13.3,
        pipeline: [
          { status: "Inquiry", n: 35 },
          { status: "Applicant", n: 12 },
          { status: "Leased", n: 8 },
        ],
      },
      {
        key: "LL",
        label: "Lakeland",
        stages: stages({ prospect: 40, prospect_engaged: 30, tour_booked: 15, tour_attended: 10, application_started: 8, application_approved: 5, lease_completed: 2 }),
        cancelled: 2,
        leadToTour: 37.5,
        tourToLease: 20,
        leadToLease: 5,
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
