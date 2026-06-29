import { describe, it, expect } from "vitest";
import { isOneStar, hasResponse, buildReviewsView, type ReviewRow } from "@/lib/reviews";

describe("isOneStar", () => {
  it("treats '1.0', '1', 1 as one-star", () => {
    expect(isOneStar("1.0")).toBe(true);
    expect(isOneStar("1")).toBe(true);
    expect(isOneStar(1)).toBe(true);
  });
  it("rejects other ratings and junk", () => {
    expect(isOneStar("2.0")).toBe(false);
    expect(isOneStar("5")).toBe(false);
    expect(isOneStar("")).toBe(false);
    expect(isOneStar(null)).toBe(false);
    expect(isOneStar("n/a")).toBe(false);
  });
});

describe("hasResponse", () => {
  it("is true only for non-empty trimmed text", () => {
    expect(hasResponse("Sorry about that")).toBe(true);
    expect(hasResponse("   ")).toBe(false);
    expect(hasResponse("")).toBe(false);
  });
});

const row = (over: Partial<ReviewRow>): ReviewRow => ({
  property: "Davenport",
  source: "Google",
  review: "Bad stay",
  managerResponse: "",
  created: "2026-06-15",
  ...over,
});

describe("buildReviewsView", () => {
  const rows: ReviewRow[] = [
    row({ property: "Davenport", created: "2026-06-10", managerResponse: "We apologize" }),
    row({ property: "Davenport", created: "2026-06-20", managerResponse: "" }),
    row({ property: "Lakeland", created: "2026-06-12", managerResponse: "Thanks" }),
    row({ property: "Lakeland", created: "2026-05-01", managerResponse: "Old one" }), // out of range
    row({ property: "Orlando", created: "2026-07-05", managerResponse: "Too new" }), // out of range
  ];

  it("counts only rows inside the inclusive window", () => {
    const v = buildReviewsView(rows, "2026-06-01", "2026-06-30");
    expect(v.total).toBe(3); // 2 Davenport + 1 Lakeland; May + July excluded
    expect(v.from).toBe("2026-06-01");
    expect(v.to).toBe("2026-06-30");
  });

  it("counts manager-responded within the window", () => {
    const v = buildReviewsView(rows, "2026-06-01", "2026-06-30");
    expect(v.responded).toBe(2); // Davenport(We apologize) + Lakeland(Thanks); the empty one doesn't count
  });

  it("groups by property, sorted by count desc", () => {
    const v = buildReviewsView(rows, "2026-06-01", "2026-06-30");
    expect(v.byProperty.map((p) => p.property)).toEqual(["Davenport", "Lakeland"]);
    const dav = v.byProperty[0];
    expect(dav.count).toBe(2);
    expect(dav.responded).toBe(1);
    // reviews sorted by created desc
    expect(dav.reviews.map((r) => r.created)).toEqual(["2026-06-20", "2026-06-10"]);
  });

  it("buckets blank property under '—' and ignores undated rows", () => {
    const v = buildReviewsView(
      [row({ property: "", created: "2026-06-05" }), row({ property: "Davenport", created: "" })],
      "2026-06-01",
      "2026-06-30",
    );
    expect(v.total).toBe(1);
    expect(v.byProperty[0].property).toBe("—");
  });
});
