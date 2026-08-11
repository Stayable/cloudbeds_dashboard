import { describe, it, expect } from "vitest";
import { defaultReviewWindow, stripReviewsPII } from "./tools-ops";
import type { ReviewsView } from "@/lib/reviews";

describe("defaultReviewWindow", () => {
  // /ops uses a lockable window stored in Neon so everyone sees the same set of
  // reviews. The MCP tool must honour it, or Rob and the dashboard disagree
  // about how many 1-star reviews there were.
  it("uses the saved window when one is stored", () => {
    const w = defaultReviewWindow("2026-08-11", JSON.stringify({ from: "2026-07-01", to: "2026-07-31" }));
    expect(w).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("falls back to the last 30 days when nothing is saved", () => {
    expect(defaultReviewWindow("2026-08-11", null)).toEqual({ from: "2026-07-13", to: "2026-08-11" });
  });

  it("falls back when the stored value is not valid JSON", () => {
    expect(defaultReviewWindow("2026-08-11", "{not json")).toEqual({ from: "2026-07-13", to: "2026-08-11" });
  });

  it("falls back when the stored JSON is missing a bound", () => {
    expect(defaultReviewWindow("2026-08-11", JSON.stringify({ from: "2026-07-01" }))).toEqual({
      from: "2026-07-13",
      to: "2026-08-11",
    });
  });
});

describe("stripReviewsPII", () => {
  // buildReviewsView's per-review list carries verbatim review text and manager
  // responses — free text a guest or a manager wrote, which can name a guest, a
  // unit, or a staff member. This MCP surface has a weaker gate than /ops (PIN),
  // so it must never carry that text. Build a fake view with an obvious "leak"
  // in every free-text field and assert none of it survives the strip.
  const fakeView: ReviewsView = {
    total: 2,
    responded: 1,
    priorTotal: 3,
    from: "2026-07-01",
    to: "2026-07-31",
    priorFrom: "2026-06-01",
    priorTo: "2026-06-30",
    byProperty: [
      {
        property: "Davenport",
        count: 2,
        responded: 1,
        priorCount: 3,
        reviews: [
          {
            review: "John Smith in room 204 was a nightmare guest",
            source: "Google",
            managerResponse: "We spoke with Jane Doe about this, called her at 555-1234",
            created: "2026-07-15",
          },
        ],
      },
    ],
  };

  it("keeps only counts and aggregates, dropping the per-review list", () => {
    const stripped = stripReviewsPII(fakeView);
    expect(stripped).toEqual({
      total: 2,
      responded: 1,
      priorTotal: 3,
      from: "2026-07-01",
      to: "2026-07-31",
      priorFrom: "2026-06-01",
      priorTo: "2026-06-30",
      byProperty: [{ property: "Davenport", count: 2, responded: 1, priorCount: 3 }],
    });
  });

  it("carries no name-like or free-text field anywhere in the output", () => {
    const stripped = stripReviewsPII(fakeView);
    const serialized = JSON.stringify(stripped);
    // No leaked review text, manager response, phone number, or the planted names.
    expect(serialized).not.toMatch(/John Smith|Jane Doe|555-1234|nightmare|spoke with/i);
    // No field that could carry free text in the first place.
    expect(serialized).not.toMatch(/"review"|"managerResponse"|"reviews"/);
  });
});
