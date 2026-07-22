import { describe, it, expect } from "vitest";
import { renderReviewsPdf } from "./ops-pdf-reviews";
import type { ReviewsView } from "@/lib/reviews";

function baseView(overrides: Partial<ReviewsView>): ReviewsView {
  return {
    total: 0,
    responded: 0,
    priorTotal: 0,
    from: "2026-06-22",
    to: "2026-07-21",
    priorFrom: "2026-05-23",
    priorTo: "2026-06-21",
    byProperty: [],
    ...overrides,
  };
}

describe("renderReviewsPdf", () => {
  it("returns a non-empty PDF buffer for a synthetic portfolio", () => {
    const view = baseView({
      total: 7,
      responded: 4,
      priorTotal: 5,
      byProperty: [
        {
          property: "Jacksonville West",
          count: 5,
          responded: 3,
          priorCount: 2,
          reviews: [
            {
              review:
                "Room was not cleaned properly and the AC was broken for two days during our stay.",
              source: "Google",
              managerResponse: "We apologize and have addressed this with housekeeping.",
              created: "2026-07-15",
            },
            {
              review: "Front desk was rude.",
              source: "Yelp",
              managerResponse: "",
              created: "2026-07-10",
            },
          ],
        },
        {
          property: "Davenport",
          count: 2,
          responded: 1,
          priorCount: 3,
          reviews: [
            {
              review: "Noise from construction next door.",
              source: "Google",
              managerResponse: "Construction completed, thank you for your patience.",
              created: "2026-07-05",
            },
          ],
        },
      ],
    });

    const buf = renderReviewsPdf(view, { configured: true, error: null });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a valid not-connected PDF when no Smartsheet token is configured", () => {
    const view = baseView({});
    const buf = renderReviewsPdf(view, { configured: false, error: null });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a valid PDF when Smartsheet returns an error", () => {
    const view = baseView({});
    const buf = renderReviewsPdf(view, {
      configured: true,
      error: "Smartsheet returned HTTP 401",
    });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
