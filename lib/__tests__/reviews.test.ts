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

  describe("previous-segment comparison", () => {
    // Current window: last 7 days [06-08, 06-14]. Prior equal-length window is
    // the 7 days immediately before: [06-01, 06-07].
    const trendRows: ReviewRow[] = [
      row({ property: "Davenport", created: "2026-06-10" }), // current
      row({ property: "Davenport", created: "2026-06-12" }), // current
      row({ property: "Davenport", created: "2026-06-03" }), // prior
      row({ property: "Davenport", created: "2026-06-05" }), // prior
      row({ property: "Davenport", created: "2026-06-06" }), // prior
      row({ property: "Lakeland", created: "2026-06-09" }), // current only
      row({ property: "Orlando", created: "2026-06-02" }), // prior only
      row({ property: "Orlando", created: "2026-05-20" }), // before prior window — ignored
    ];

    it("exposes the equal-length previous window immediately before [from,to]", () => {
      const v = buildReviewsView(trendRows, "2026-06-08", "2026-06-14");
      expect(v.priorFrom).toBe("2026-06-01");
      expect(v.priorTo).toBe("2026-06-07");
    });

    it("counts current and prior totals per the two windows", () => {
      const v = buildReviewsView(trendRows, "2026-06-08", "2026-06-14");
      expect(v.total).toBe(3); // 2 Davenport + 1 Lakeland
      expect(v.priorTotal).toBe(4); // 3 Davenport + 1 Orlando
    });

    it("sets priorCount per property and includes prior-only properties", () => {
      const v = buildReviewsView(trendRows, "2026-06-08", "2026-06-14");
      const byName = Object.fromEntries(v.byProperty.map((p) => [p.property, p]));
      expect(byName.Davenport.count).toBe(2);
      expect(byName.Davenport.priorCount).toBe(3); // improved
      expect(byName.Lakeland.count).toBe(1);
      expect(byName.Lakeland.priorCount).toBe(0); // worsened (new)
      expect(byName.Orlando.count).toBe(0); // dropped to zero this window
      expect(byName.Orlando.priorCount).toBe(1);
      expect(byName.Orlando.reviews).toEqual([]); // no current-window detail rows
    });

    it("scales the prior window to match the current window length (14 days)", () => {
      // Current [06-01, 06-14] → prior [05-18, 05-31].
      const v = buildReviewsView(
        [row({ property: "Davenport", created: "2026-05-20" })],
        "2026-06-01",
        "2026-06-14",
      );
      expect(v.priorFrom).toBe("2026-05-18");
      expect(v.priorTo).toBe("2026-05-31");
      expect(v.priorTotal).toBe(1);
    });
  });
});
