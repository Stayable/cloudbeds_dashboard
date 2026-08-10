import { describe, it, expect } from "vitest";
import { kbView } from "./kb-view";
import type { SearchResult, OutlineDoc } from "./kb-search";

const docs: OutlineDoc[] = [
  { slug: "a", title: "A", source: "s", snapshotDate: "2026-08-07", headings: [] },
];
const hit: SearchResult = {
  slug: "a", title: "A", heading: "H", anchor: "h",
  snapshotDate: "2026-08-07", snippetHtml: "x", score: 1,
};

describe("kbView", () => {
  it("browses the whole corpus for an empty query", () => {
    const v = kbView("", [], docs);
    expect(v.mode).toBe("browse");
    expect(v.outline).toEqual(docs);
  });

  it("browses for a whitespace-only query too", () => {
    expect(kbView("   ", [], docs).mode).toBe("browse");
  });

  it("shows results when there are any", () => {
    const v = kbView("h", [hit], docs);
    expect(v.mode).toBe("results");
    expect(v.results).toEqual([hit]);
  });

  // The honest miss: say so, repeat the query, and show the corpus. Never pad.
  it("returns the empty state WITH the corpus for a query that found nothing", () => {
    const v = kbView("zzzz", [], docs);
    expect(v.mode).toBe("empty");
    expect(v.query).toBe("zzzz");
    expect(v.results).toEqual([]);
    expect(v.outline).toEqual(docs);
  });

  it("trims the echoed query", () => {
    expect(kbView("  zzzz  ", [], docs).query).toBe("zzzz");
  });
});
