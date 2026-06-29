// Pure builders for the Operations "1-Star Reviews" section. No I/O — the
// Smartsheet fetch lives in lib/smartsheet.ts (getOneStarReviews); here we just
// filter to a date window and group by property so the logic is unit-testable.
//
// PII posture: we surface the review text, source, manager response and date
// only. The reviews sheet's Reviewer Name column is never read (lib/smartsheet).

export type ReviewRow = {
  property: string;
  source: string;
  review: string;
  managerResponse: string;
  created: string; // Eastern YYYY-MM-DD (already normalized at fetch time)
};

export type PropertyReviews = {
  property: string;
  count: number;
  responded: number; // how many of this property's 1-star reviews have a manager response
  reviews: { review: string; source: string; managerResponse: string; created: string }[];
};

export type ReviewsView = {
  total: number; // # of 1-star reviews in the window
  responded: number; // # of those with a manager response
  from: string;
  to: string;
  byProperty: PropertyReviews[]; // sorted by count desc
};

/** A rating counts as 1-star when it parses to 1 (the sheet stores "1.0"). */
export function isOneStar(rating: unknown): boolean {
  const n = parseFloat(String(rating ?? "").trim());
  return Number.isFinite(n) && Math.round(n) === 1;
}

/** A review is "manager responded" when the Manager Response cell is non-empty. */
export function hasResponse(s: string): boolean {
  return !!s && s.trim().length > 0;
}

/** Build the section view: filter 1-star rows to [from, to] (inclusive, on the
 *  Eastern created date), then group by property with per-group counts. Input
 *  rows are assumed already filtered to 1-star. */
export function buildReviewsView(rows: ReviewRow[], from: string, to: string): ReviewsView {
  const inRange = rows.filter((r) => r.created && r.created >= from && r.created <= to);

  const byProp = new Map<string, PropertyReviews>();
  for (const r of inRange) {
    const key = r.property?.trim() || "—";
    let g = byProp.get(key);
    if (!g) {
      g = { property: key, count: 0, responded: 0, reviews: [] };
      byProp.set(key, g);
    }
    g.count++;
    if (hasResponse(r.managerResponse)) g.responded++;
    g.reviews.push({
      review: r.review,
      source: r.source,
      managerResponse: r.managerResponse,
      created: r.created,
    });
  }

  const byProperty = [...byProp.values()].sort(
    (a, b) => b.count - a.count || a.property.localeCompare(b.property),
  );
  for (const g of byProperty) g.reviews.sort((a, b) => b.created.localeCompare(a.created));

  return {
    total: inRange.length,
    responded: inRange.filter((r) => hasResponse(r.managerResponse)).length,
    from,
    to,
    byProperty,
  };
}
